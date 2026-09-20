/**
 * 把「非 on_track 却贴在轨上」的景点挪到地貌侧（规则：钉本体/大面积适度靠轨，禁止吸轨面）
 * 已离轨 ≥ minOffKm 的不动。
 *
 * node scripts/fix-scenic-off-rail.mjs
 * node scripts/fix-scenic-off-rail.mjs --write
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const MIN_OFF_KM = 0.8; // 已 ≥ 此距离视为够准，不动
const TARGET_OFF_KM = 2.8; // 目标侧向偏移

function hv(a, b) {
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

function project(path, lng, lat) {
  let best = { distKm: Infinity, point: { lng: path[0][0], lat: path[0][1] }, i: 1 };
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((lng - a[0]) * dx + (lat - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const point = { lng: a[0] + dx * t, lat: a[1] + dy * t };
    const distKm = hv({ lng, lat }, point);
    if (distKm < best.distKm) best = { distKm, point, i };
  }
  return best;
}

function loadCorridors() {
  const dir = join(root, 'data/presets/corridors');
  const map = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f.includes('__')) continue;
    const c = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (c.id && c.railway?.length >= 2) map.set(c.id, c.railway);
  }
  const z = join(root, 'data/presets/z8991-railway.json');
  if (existsSync(z)) map.set('qingzang', JSON.parse(readFileSync(z, 'utf8')));
  return map;
}

function preferId(spotId, corridors) {
  const m = String(spotId).match(/^([a-z0-9]+)-/);
  if (m && corridors.has(m[1])) return m[1];
  return null;
}

function nearestRail(corridors, lng, lat, prefer) {
  let best = null;
  const order = prefer ? [prefer, ...corridors.keys()] : [...corridors.keys()];
  const seen = new Set();
  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const path = corridors.get(id);
    if (!path) continue;
    const p = project(path, lng, lat);
    if (!best || p.distKm < best.distKm) best = { corridorId: id, path, ...p };
    if (prefer && id === prefer && p.distKm < 40) break;
  }
  return best;
}

/** 沿折线前进方向左侧偏移 kmSide 公里 */
function offsetLeft(path, proj, kmSide) {
  const i = Math.max(1, Math.min(path.length - 1, proj.i));
  const a = path[i - 1];
  const b = path[i];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lat0 = proj.point.lat;
  const mLat = 111320;
  const mLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  // along vector in meters
  const ax = dx * mLng;
  const ay = dy * mLat;
  const alen = Math.hypot(ax, ay) || 1;
  // left normal
  const nx = -ay / alen;
  const ny = ax / alen;
  const olng = (nx * kmSide * 1000) / mLng;
  const olat = (ny * kmSide * 1000) / mLat;
  return {
    lng: Number((proj.point.lng + olng).toFixed(6)),
    lat: Number((proj.point.lat + olat).toFixed(6)),
  };
}

function cleanQueryName(name) {
  return String(name)
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/方向/g, '')
    .replace(/远眺/g, '')
    .trim();
}

function main() {
  const corridors = loadCorridors();
  const spotsDoc = JSON.parse(readFileSync(join(root, 'data/presets/scenic-spots.json'), 'utf8'));
  const spots = spotsDoc.spots;
  const truthPath = join(root, 'data/presets/_scenic-wikidata-truths.json');
  const truthByQ = new Map();
  if (existsSync(truthPath)) {
    for (const it of JSON.parse(readFileSync(truthPath, 'utf8')).items || []) {
      if (it.queryName && it.lng != null) truthByQ.set(it.queryName, it);
    }
  }

  // 明确保留：近期人工校过的具名/渝贵等
  const protect = new Set([
    'daxi-pingyao',
    'xulan-huashan',
    'daxi-yellow-river-yongji',
    'daxi-taiyuan-basin',
    'yinxi-xianyang',
    'xulan-tianshui',
    'loushanguan',
    'zunyi-karst',
    'yugui-qijiang',
    'yugui-tongzi',
    'yugui-zunyi-city',
    'yugui-xifeng',
    'yuzhu-peak',
    'geladandong',
    'qinghai-lake',
  ]);

  const changes = [];
  const skipped = [];

  for (const s of spots) {
    if (s.visibility === 'on_track') {
      skipped.push({ id: s.id, reason: 'on_track_allowed' });
      continue;
    }
    if (protect.has(s.id)) {
      skipped.push({ id: s.id, reason: 'protected_precise' });
      continue;
    }

    const prefer = preferId(s.id, corridors);
    const rail = nearestRail(corridors, s.lng, s.lat, prefer);
    if (!rail) {
      skipped.push({ id: s.id, reason: 'no_rail' });
      continue;
    }
    if (rail.distKm >= MIN_OFF_KM) {
      skipped.push({ id: s.id, reason: 'already_off_rail', distRailKm: +rail.distKm.toFixed(2) });
      continue;
    }

    const q = cleanQueryName(s.name);
    const truth = truthByQ.get(q);
    let next = null;
    let method = '';

    if (truth) {
      const moved = hv(s, truth);
      const tRail = nearestRail(corridors, truth.lng, truth.lat, prefer);
      // 真值可信：相对旧点不太飞，且自身离轨已 ≥ 0.8 或在合理窗景距离内
      if (moved <= 80 && tRail && tRail.distKm >= MIN_OFF_KM && tRail.distKm <= 45) {
        next = { lng: Number(truth.lng.toFixed(6)), lat: Number(truth.lat.toFixed(6)) };
        method = 'truth';
      } else if (moved <= 80 && tRail && tRail.distKm < MIN_OFF_KM) {
        // 真值也贴轨 → 从真值投影点侧向偏移
        next = offsetLeft(tRail.path, tRail, TARGET_OFF_KM);
        method = 'truth_then_offset';
      }
    }

    if (!next) {
      next = offsetLeft(rail.path, rail, TARGET_OFF_KM);
      method = 'perp_offset';
    }

    const after = nearestRail(corridors, next.lng, next.lat, prefer);
    const distAfter = after ? after.distKm : null;

    // 保证仍能匹配：window 默认 8，若偏移后 >8 则补 maxDistKm
    let maxDistKm = s.maxDistKm;
    let visibility = s.visibility;
    if (distAfter != null && distAfter > (maxDistKm ?? (visibility === 'distant' ? 35 : 8))) {
      if (visibility === 'window' && distAfter > 8) {
        // 大面积靠轨一般 2.8km，不会触发；若触发则抬 max
        maxDistKm = Math.ceil(distAfter * 1.2 * 10) / 10;
      }
    }
    if (visibility === 'window' && (!maxDistKm || maxDistKm < 10)) maxDistKm = 10;

    changes.push({
      id: s.id,
      name: s.name,
      method,
      corridorId: rail.corridorId,
      before: { lng: s.lng, lat: s.lat, distRailKm: +rail.distKm.toFixed(3) },
      after: { lng: next.lng, lat: next.lat, distRailKm: distAfter != null ? +distAfter.toFixed(2) : null },
      maxDistKm: maxDistKm ?? null,
      visibility,
    });

    if (WRITE) {
      s.lng = next.lng;
      s.lat = next.lat;
      if (maxDistKm != null) s.maxDistKm = maxDistKm;
    }
  }

  const logPath = join(root, 'tmp/scenic-off-rail-fix-log.md');
  const lines = [
    '# 景点离轨修正日志',
    '',
    `> 日期：2026-09-15 ｜ 规则：非 \`on_track\` 禁止贴轨；已离轨 ≥ ${MIN_OFF_KM} km 不动；问题点侧向约 ${TARGET_OFF_KM} km 或改用可信真值。`,
    '',
    `## 摘要`,
    '',
    `- 扫描景点：${spots.length}`,
    `- 本次修改：${changes.length}`,
    `- 跳过：${skipped.length}（含 on_track / 已准 / 保护名单）`,
    `- 写入：${WRITE ? '是（scenic-spots.json + patches）' : '否（dry-run）'}`,
    '',
    '## 修改明细',
    '',
    '| id | 名称 | 方法 | 走廊 | 原离轨km | 新离轨km | 新坐标 |',
    '|---|---|---|---|---:|---:|---|',
  ];
  for (const c of changes) {
    lines.push(
      `| ${c.id} | ${c.name} | ${c.method} | ${c.corridorId} | ${c.before.distRailKm} | ${c.after.distRailKm ?? '-'} | ${c.after.lng}, ${c.after.lat} |`,
    );
  }
  lines.push('', '## 保护/跳过样例（不完整）', '');
  const protectSkip = skipped.filter((x) => x.reason === 'protected_precise' || x.reason === 'already_off_rail').slice(0, 40);
  for (const s of protectSkip) {
    lines.push(`- \`${s.id}\`: ${s.reason}${s.distRailKm != null ? ` (${s.distRailKm} km)` : ''}`);
  }
  lines.push('');
  writeFileSync(logPath, lines.join('\n'), 'utf8');
  console.log(`log -> ${logPath}`);
  console.log(`changes ${changes.length}, skipped ${skipped.length}, write=${WRITE}`);

  if (WRITE) {
    spotsDoc.updated = '2026-09-15';
    spotsDoc.note =
      '策展+校准+离轨修正：具名钉本体，大面积适度靠轨（禁止贴轨面）。';
    writeFileSync(join(root, 'data/presets/scenic-spots.json'), JSON.stringify(spotsDoc, null, 2) + '\n', 'utf8');

    const patchPath = join(root, 'data/presets/scenic-spot-calibration-patches.json');
    const patchDoc = existsSync(patchPath)
      ? JSON.parse(readFileSync(patchPath, 'utf8'))
      : { version: 1, patches: [] };
    const byId = new Map((patchDoc.patches || []).map((p) => [p.id, p]));
    for (const c of changes) {
      byId.set(c.id, {
        id: c.id,
        lng: c.after.lng,
        lat: c.after.lat,
        visibility: c.visibility,
        maxDistKm: c.maxDistKm,
        reason: `off_rail_fix_2026-09-15:${c.method}`,
      });
    }
    patchDoc.patches = [...byId.values()];
    patchDoc.updated = '2026-09-15';
    patchDoc.note = 'includes off-rail fix 2026-09-15';
    writeFileSync(patchPath, JSON.stringify(patchDoc, null, 2) + '\n', 'utf8');
    console.log(`updated scenic-spots.json + patches (${changes.length})`);
  }
}

main();
