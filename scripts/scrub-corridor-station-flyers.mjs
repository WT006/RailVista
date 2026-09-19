/**
 * 纠正「飞到错误走廊」的 stations-geo：
 * 仅覆盖 source 以 corridor: 开头、且距本走廊折线 > FLY_KM 的站；
 * 用同走廊两侧贴轨锚站做 progress 插值再投影（禁止全程等分）。
 *
 *   node scripts/scrub-corridor-station-flyers.mjs
 *   node scripts/scrub-corridor-station-flyers.mjs --write
 *   node scripts/scrub-corridor-station-flyers.mjs --write --id hukun
 */
import { readFileSync, writeFileSync, readdirSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrDir = join(root, 'data/presets/corridors');
const geoPath = join(root, 'data/stations-geo.json');
const logPath = join(root, 'docs/corridor-calibration-log.md');

const wantWrite = process.argv.includes('--write');
const onlyId = (() => {
  const i = process.argv.indexOf('--id');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const FLY_KM = 15;
const ANCHOR_ON_RAIL_KM = 2.5;
/** 锚站在站序上最多隔这么远，防止杭州东..高安跨半条线乱插 */
const MAX_ANCHOR_INDEX_GAP = 6;

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

function buildPath(coords) {
  const path = coords.map(([lng, lat]) => ({ lng, lat, distFromStart: 0 }));
  let lengthKm = 0;
  for (let i = 1; i < path.length; i++) {
    lengthKm += haversine(path[i - 1], path[i]);
    path[i].distFromStart = lengthKm;
  }
  return { path, lengthKm };
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
    if (distKm < best.distKm) {
      best = {
        distKm,
        progress: (a.distFromStart + segLen * t) / lengthKm,
        point,
      };
    }
  }
  return best;
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
      return { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t };
    }
  }
  const last = path[path.length - 1];
  return { lng: last.lng, lat: last.lat };
}

function ensureLogHeader() {
  if (!existsSync(dirname(logPath))) mkdirSync(dirname(logPath), { recursive: true });
  if (!existsSync(logPath)) {
    writeFileSync(
      logPath,
      '# 走廊校准日志\n\n| 时间 | 走廊 | 动作 | 结果 |\n|------|------|------|------|\n',
    );
  }
}

function logRow(id, action, result) {
  ensureLogHeader();
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  appendFileSync(logPath, `| ${ts} | ${id} | ${action} | ${result} |\n`);
}

function canOverwrite(src) {
  if (!src) return true;
  return String(src).startsWith('corridor:');
}

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const files = readdirSync(corrDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
let fixed = 0;
let skipped = 0;

for (const f of files) {
  const c = JSON.parse(readFileSync(join(corrDir, f), 'utf8'));
  const id = c.id || f.replace(/\.json$/, '');
  if (onlyId && id !== onlyId) continue;
  if (!c.railway?.length || !c.stationsHint?.length) continue;

  const { path, lengthKm } = buildPath(c.railway);
  const hints = c.stationsHint;
  const onRail = [];
  for (let i = 0; i < hints.length; i++) {
    const name = hints[i];
    const s = geo[name];
    if (!s?.lng) {
      onRail.push({ i, name, ok: false });
      continue;
    }
    const proj = projectToRailway(path, lengthKm, s.lng, s.lat);
    onRail.push({
      i,
      name,
      ok: proj.distKm <= ANCHOR_ON_RAIL_KM,
      distKm: proj.distKm,
      progress: proj.progress,
      src: s.source,
    });
  }

  const changes = [];
  for (let i = 0; i < hints.length; i++) {
    const name = hints[i];
    const s = geo[name];
    if (!s?.lng) continue;
    const proj = projectToRailway(path, lengthKm, s.lng, s.lat);
    if (proj.distKm <= FLY_KM) continue;
    if (!canOverwrite(s.source)) {
      skipped += 1;
      continue;
    }

    let left = null;
    let right = null;
    for (let j = i - 1; j >= 0; j--) {
      if (onRail[j].ok) {
        left = onRail[j];
        break;
      }
    }
    for (let j = i + 1; j < hints.length; j++) {
      if (onRail[j].ok) {
        right = onRail[j];
        break;
      }
    }
    if (!left || !right || right.progress <= left.progress) continue;
    if (right.i - left.i > MAX_ANCHOR_INDEX_GAP) continue;

    // 若该站来自其它走廊，且距「来源走廊」更近，则交给来源走廊修，避免抢点
    const src = String(s.source || '');
    if (src.startsWith('corridor:')) {
      const srcId = src.slice('corridor:'.length);
      if (srcId && srcId !== id) {
        const srcPath = join(corrDir, `${srcId}.json`);
        if (existsSync(srcPath)) {
          const srcC = JSON.parse(readFileSync(srcPath, 'utf8'));
          if (srcC.railway?.length) {
            const sm = buildPath(srcC.railway);
            const toSrc = projectToRailway(sm.path, sm.lengthKm, s.lng, s.lat).distKm;
            // 已贴在来源走廊上 → 不抢；飞离来源走廊才允许本走廊纠正
            if (toSrc <= FLY_KM) {
              skipped += 1;
              continue;
            }
          }
        }
      }
    }

    const span = right.i - left.i;
    const t = (i - left.i) / span;
    const progress = left.progress + (right.progress - left.progress) * t;
    const pt = pointAtProgress(path, lengthKm, progress);
    if (!pt) continue;

    const before = proj.distKm;
    const after = projectToRailway(path, lengthKm, pt.lng, pt.lat).distKm;
    changes.push(
      `${name} ${before.toFixed(1)}→${after.toFixed(2)}km via ${left.name}..${right.name}`,
    );
    if (wantWrite) {
      geo[name] = {
        lng: Number(pt.lng.toFixed(6)),
        lat: Number(pt.lat.toFixed(6)),
        source: `corridor:${id}`,
      };
      fixed += 1;
    }
  }

  if (changes.length) {
    console.log(`${wantWrite ? 'FIX' : 'DRY'} ${id}: ${changes.join('; ')}`);
    logRow(id, wantWrite ? 'scrub-flyers' : 'scrub-flyers-dry', changes.join('; '));
  }
}

if (wantWrite) {
  writeFileSync(geoPath, JSON.stringify(geo, null, 0));
}
console.log(`\nMODE ${wantWrite ? 'write' : 'dry-run'} fixed=${fixed} skippedProtected=${skipped}`);
