/**
 * 用各走廊折线补齐 / 纠正 stations-geo 中的干线枢纽坐标。
 *
 * 规则：
 * - 非 corridor 来源（OSM/手标等）永不覆盖，并作为锚点
 * - 走廊折线常有折返毛刺，禁止对全程做等分插值（会把新乡东插到郑州以南）
 * - 在相邻锚点的站序区间内，按站序比例插值 progress，再落到折线上
 * - 多走廊同站：优先选「同时靠近最多条走廊」的插值点
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
/** 锚点投影到走廊的最大偏离 */
const ANCHOR_MAX_KM = 45;

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

function buildMetrics(coords) {
  const path = coords.map(([lng, lat]) => ({ lng, lat, distFromStart: 0 }));
  let lengthKm = 0;
  for (let i = 1; i < path.length; i++) {
    lengthKm += haversine(path[i - 1], path[i]);
    path[i].distFromStart = lengthKm;
  }
  return { path, lengthKm };
}

function pointAtProgress(path, lengthKm, progress) {
  if (!path.length) return null;
  if (lengthKm <= 0) return { lng: path[0].lng, lat: path[0].lat };
  const target = Math.max(0, Math.min(1, progress)) * lengthKm;
  for (let i = 1; i < path.length; i++) {
    if (path[i].distFromStart >= target) {
      const a = path[i - 1];
      const b = path[i];
      const seg = b.distFromStart - a.distFromStart || 1;
      const t = (target - a.distFromStart) / seg;
      return {
        lng: a.lng + (b.lng - a.lng) * t,
        lat: a.lat + (b.lat - a.lat) * t,
      };
    }
  }
  const last = path[path.length - 1];
  return { lng: last.lng, lat: last.lat };
}

function projectToRailway(path, lengthKm, lng, lat) {
  let best = { distKm: Infinity, progress: 0, point: path[0] };
  if (!path.length || lengthKm <= 0) return best;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = b.distFromStart - a.distFromStart || 1;
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    const t = Math.max(
      0,
      Math.min(1, ((lng - a.lng) * dx + (lat - a.lat) * dy) / (dx * dx + dy * dy || 1)),
    );
    const point = { lng: a.lng + dx * t, lat: a.lat + dy * t };
    const distKm = haversine({ lng, lat }, point);
    const progress = (a.distFromStart + segLen * t) / lengthKm;
    if (distKm < best.distKm) best = { distKm, progress, point };
  }
  return best;
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

function isTrustedGeo(entry) {
  if (!entry || entry.lng == null || entry.lat == null) return false;
  const src = String(entry.source || '');
  return !src.startsWith('corridor:');
}

/**
 * 在 hint 站序上用可信锚点约束 progress，避免折线折返导致等分错位。
 */
function progressForHints(hints, railway, geo) {
  const { path, lengthKm } = buildMetrics(railway);
  if (lengthKm <= 0 || hints.length < 2) return null;

  /** @type {Array<{ index: number, progress: number }>} */
  const anchors = [{ index: 0, progress: 0 }];

  for (let i = 1; i < hints.length - 1; i++) {
    const name = hints[i];
    const existing = geo[name];
    if (!isTrustedGeo(existing)) continue;
    const proj = projectToRailway(
      path,
      lengthKm,
      Number(existing.lng),
      Number(existing.lat),
    );
    if (proj.distKm > ANCHOR_MAX_KM) continue;
    const last = anchors[anchors.length - 1];
    // 锚点 progress 必须沿站序非降，否则跳过（脏锚点）
    if (proj.progress + 0.002 < last.progress) continue;
    anchors.push({ index: i, progress: proj.progress });
  }

  anchors.push({ index: hints.length - 1, progress: 1 });

  // 若相邻锚点 progress 倒挂（极端脏数据），拉平
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i].progress < anchors[i - 1].progress) {
      anchors[i].progress = anchors[i - 1].progress;
    }
  }

  const out = new Array(hints.length);
  for (let i = 0; i < hints.length; i++) {
    let left = anchors[0];
    let right = anchors[anchors.length - 1];
    for (let a = 0; a < anchors.length; a++) {
      if (anchors[a].index <= i) left = anchors[a];
      if (anchors[a].index >= i) {
        right = anchors[a];
        break;
      }
    }
    if (left.index === right.index) {
      out[i] = left.progress;
    } else {
      const t = (i - left.index) / (right.index - left.index);
      out[i] = left.progress + t * (right.progress - left.progress);
    }
  }
  return { progresses: out, path, lengthKm, anchorCount: anchors.length };
}

/** @type {Map<string, Array<{ id: string, pt: {lng:number,lat:number}, railway: number[][] }>>} */
const candidates = new Map();

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));

for (const file of readdirSync(corridorsDir).filter((f) => f.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(join(corridorsDir, file), 'utf8'));
  const hints = (c.stationsHint || [])
    .map((h) => String(h).replace(/站$/, '').trim())
    .filter(Boolean);
  const railway = c.railway || [];
  if (hints.length < 2 || railway.length < 2) continue;

  const placed = progressForHints(hints, railway, geo);
  if (!placed) continue;

  for (let i = 0; i < hints.length; i++) {
    const name = hints[i];
    const pt = pointAtProgress(placed.path, placed.lengthKm, placed.progresses[i]);
    if (!pt) continue;
    if (!candidates.has(name)) candidates.set(name, []);
    candidates.get(name).push({ id: c.id, pt, railway });
  }
}

let added = 0;
let kept = 0;
let corrected = 0;

for (const [name, list] of candidates) {
  const best = pickBest(list);
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
    if (moved > 20) {
      console.log(
        `corrected ${name}: moved ${moved.toFixed(1)}km ` +
          `${existing.lng},${existing.lat} → ${next.lng},${next.lat} (${next.source})`,
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

// 抽样校验：京广若干站 lat 应北→南单调（相对可信锚点）
const jgCheck = ['邯郸东', '鹤壁东', '新乡东', '郑州东', '许昌东', '漯河西'];
let prevLat = Infinity;
for (const n of jgCheck) {
  const g = geo[n];
  if (!g) {
    console.warn('missing', n);
    continue;
  }
  console.log(n, g.lat.toFixed(3), g.lng.toFixed(3), g.source || 'trusted');
  if (g.lat > prevLat + 0.05) {
    console.warn(`WARN ${n} lat rose vs previous — possible residual error`);
  }
  prevLat = g.lat;
}
