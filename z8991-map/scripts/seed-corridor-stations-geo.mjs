/**
 * 用各走廊折线按站序插值，补齐 / 纠正 stations-geo 中的干线枢纽坐标。
 *
 * 规则：
 * - 非 corridor 来源（OSM/手标等）永不覆盖
 * - 多走廊同站：优先选「同时靠近最多条走廊」的插值点（避免沪昆线性插值把上饶甩飞后压过合福）
 * - 单走廊：直接用该走廊插值
 *
 * node scripts/seed-corridor-stations-geo.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const corridorsDir = join(__dirname, '../data/presets/corridors');
const geoPath = join(__dirname, '../data/stations-geo.json');

/** 认为「落在走廊上」的距离阈值 */
const ON_RAIL_KM = 20;

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function pointAtKm(coords, targetKm) {
  if (!coords.length) return null;
  if (targetKm <= 0) return { lng: coords[0][0], lat: coords[0][1] };
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
    const b = { lng: coords[i][0], lat: coords[i][1] };
    const seg = haversine(a, b);
    if (acc + seg >= targetKm) {
      const t = seg > 0 ? (targetKm - acc) / seg : 0;
      return {
        lng: a.lng + (b.lng - a.lng) * t,
        lat: a.lat + (b.lat - a.lat) * t,
      };
    }
    acc += seg;
  }
  const last = coords[coords.length - 1];
  return { lng: last[0], lat: last[1] };
}

function lineLengthKm(coords) {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    sum += haversine(
      { lng: coords[i - 1][0], lat: coords[i - 1][1] },
      { lng: coords[i][0], lat: coords[i][1] },
    );
  }
  return sum;
}

function nearestOnRail(coords, lng, lat) {
  let best = { d: Infinity, lng: coords[0][0], lat: coords[0][1] };
  for (const [x, y] of coords) {
    const d = haversine({ lng, lat }, { lng: x, lat: y });
    if (d < best.d) best = { d, lng: x, lat: y };
  }
  return best;
}

function corridorsNearCount(pt, list) {
  let n = 0;
  for (const item of list) {
    if (nearestOnRail(item.railway, pt.lng, pt.lat).d <= ON_RAIL_KM) n += 1;
  }
  return n;
}

/**
 * 多走廊同站：选「落在最多走廊附近」的插值；并列时选离其它候选总距最小者。
 */
function pickBest(list) {
  if (list.length === 1) {
    return { pt: list[0].pt, id: list[0].id };
  }
  let best = null;
  for (const item of list) {
    const near = corridorsNearCount(item.pt, list);
    let sum = 0;
    for (const other of list) sum += haversine(item.pt, other.pt);
    const score = { near, sum, pt: item.pt, id: item.id };
    if (
      !best ||
      score.near > best.near ||
      (score.near === best.near && score.sum < best.sum)
    ) {
      best = score;
    }
  }
  return best;
}

/** @type {Map<string, Array<{ id: string, pt: {lng:number,lat:number}, railway: number[][] }>>} */
const candidates = new Map();

for (const file of readdirSync(corridorsDir).filter((f) => f.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(join(corridorsDir, file), 'utf8'));
  const hints = c.stationsHint || [];
  const railway = c.railway || [];
  if (hints.length < 2 || railway.length < 2) continue;
  const totalKm = lineLengthKm(railway);
  for (let i = 0; i < hints.length; i++) {
    const name = String(hints[i]).replace(/站$/, '').trim();
    if (!name) continue;
    const frac = hints.length === 1 ? 0 : i / (hints.length - 1);
    const pt = pointAtKm(railway, totalKm * frac);
    if (!pt) continue;
    if (!candidates.has(name)) candidates.set(name, []);
    candidates.get(name).push({ id: c.id, pt, railway });
  }
}

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
let added = 0;
let kept = 0;
let corrected = 0;

for (const [name, list] of candidates) {
  const best = pickBest(list);
  // 吸附到得分最高候选自己的折线（保证落在精品线上）
  const snap = nearestOnRail(
    list.find((x) => x.id === best.id).railway,
    best.pt.lng,
    best.pt.lat,
  );
  const next = {
    name,
    lng: Number(snap.lng.toFixed(6)),
    lat: Number(snap.lat.toFixed(6)),
    source: `corridor:${best.id}`,
  };

  const existing = geo[name];
  if (existing?.lng != null && existing?.lat != null) {
    const src = String(existing.source || '');
    if (!src.startsWith('corridor:')) {
      kept += 1;
      continue;
    }
    const moved = haversine(
      { lng: Number(existing.lng), lat: Number(existing.lat) },
      { lng: next.lng, lat: next.lat },
    );
    if (moved < 1) {
      kept += 1;
      continue;
    }
    geo[name] = next;
    corrected += 1;
    if (name === '上饶' || moved > 30) {
      console.log(
        `corrected ${name}: moved ${moved.toFixed(1)}km ` +
          `${existing.lng},${existing.lat} → ${next.lng},${next.lat} (${next.source}, near=${corridorsNearCount(next, list)}/${list.length})`,
      );
    }
    continue;
  }

  geo[name] = next;
  added += 1;
}

writeFileSync(geoPath, JSON.stringify(geo));
console.log(
  'stations-geo updated: added',
  added,
  'corrected',
  corrected,
  'kept',
  kept,
  'total',
  Object.keys(geo).length,
);
console.log('上饶', geo['上饶']);
