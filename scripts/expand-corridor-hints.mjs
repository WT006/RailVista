// A2 走廊 stationsHint 扩充辅助：校验候选站在 stations-geo 有坐标且距折线 ≤12km
// 用法: node scripts/expand-corridor-hints.mjs            （检查模式，只打印）
//       node scripts/expand-corridor-hints.mjs --write    （通过校验的站合并进 hints）
//       node scripts/expand-corridor-hints.mjs --auto     （S6 自动扩充全部走廊）
//       node scripts/expand-corridor-hints.mjs --auto --write  （自动扩充并写入）
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRailwayMetrics, projectToRailway } from '../packages/shared/dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corridorsDir = join(root, 'data/presets/corridors');
const geo = JSON.parse(readFileSync(join(root, 'data/stations-geo.json'), 'utf8'));

const WANT = process.argv.includes('--write');
const AUTO = process.argv.includes('--auto');

/**
 * 候选 hints（按线补齐真实停靠/枢纽站，站序按线路走向）
 * 原则：只收「实际停靠/跨线枢纽」，不收「可能经过」的站（invariants）
 * 人工表优先级高于 --auto 自动结果
 */
const CANDIDATES = {
  // 京广线（普速）：补株洲（京广↔沪昆枢纽）+ 沿线主要普速站
  jingguangxian: ['北京', '保定', '石家庄', '邢台', '邯郸', '安阳', '新乡', '郑州', '许昌', '漯河', '信阳', '汉口', '武昌', '岳阳', '长沙', '株洲', '衡阳', '郴州', '韶关东', '广州', '广州白云'],
  // 沪昆线（普速）：杭州南≠杭州西（K512 终到杭州南），补株洲东侧+杭州南
  hukunxian: ['上海', '嘉兴', '杭州南', '诸暨', '义乌', '金华', '衢州', '上饶', '鹰潭', '新余', '宜春', '萍乡', '株洲', '娄底', '怀化', '凯里', '贵阳', '安顺', '六盘水', '宣威', '曲靖', '昆明'],
  // 黎湛线：补河唇（河茂线起点，hemao∩lizhan 断链枢纽）
  lizhan: ['黎塘', '贵港', '玉林', '陆川', '河唇', '遂溪', '湛江'],
  // 兰新线（普速）：补河西走廊干线站
  lanxinxian: ['兰州', '河口南', '武威', '金昌', '张掖', '酒泉', '嘉峪关', '玉门', '柳园', '哈密', '鄯善', '吐鲁番', '乌鲁木齐'],
  // 京哈线（普速）：补沈阳北、四平（K553 类经停）
  jinghaxian: ['北京', '唐山北', '秦皇岛', '山海关', '锦州', '沈阳北', '四平', '长春', '哈尔滨'],
  // 海南东环：补美兰/文昌（C7871「没过美兰」）
  hainandong: ['海口', '海口东', '美兰', '文昌', '琼海', '博鳌', '万宁', '神州', '陵水', '亚龙湾', '三亚'],
  // 广珠城际：补珠海北（C7601 终点）及沿线城际站
  guangzhu: ['广州南', '顺德', '容桂', '南头', '小榄', '珠海北', '明珠', '珠海'],
};

/** --auto 参数 */
// 普通站 ≤2km（与 verify-corridor-geometry 的 over2/majorityBad 断言口径一致）
const AUTO_SNAP_KM = 2;
// 跨线枢纽豁免距离（数量受 over2 占比上限保护）
const AUTO_HUB_SNAP_KM = 12;
// 最终 hints 中 >2km 站（枢纽）占比上限，超过则丢弃最远的枢纽
const AUTO_OVER2_RATIO_MAX = 0.4;
const AUTO_MIN_GAP_KM = 30;
const AUTO_MAX_HINTS = 30;
const AUTO_BBOX_PAD_DEG = 0.12;

function normalizeHint(name) {
  return String(name || '').replace(/站$/g, '').trim();
}

function corridorBBox(railway) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of railway) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

function inBBox(lng, lat, b, pad) {
  return lng >= b.minLng - pad && lng <= b.maxLng + pad && lat >= b.minLat - pad && lat <= b.maxLat + pad;
}

/** 跨线枢纽：出现在 ≥2 条走廊 stationsHint 的站（S6 无条件入选规则） */
function collectHubNames(allCorridors) {
  const count = new Map();
  for (const c of allCorridors) {
    for (const h of c.stationsHint || []) {
      const k = normalizeHint(h);
      if (!k) continue;
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  return new Set([...count.entries()].filter(([, n]) => n >= 2).map(([k]) => k));
}

/**
 * S6 --auto 模式：对每条走廊自动扩充 stationsHint。
 * 流水线：bbox 快筛 → ≤12km 投影 → progress 排序 → 贪心选点（≥30km 间隔，
 * 跨线枢纽豁免）→ 与人工 CANDIDATES 合并（人工优先不删）→ 去重 → 上限 30。
 */
function autoExpand() {
  const files = readdirSync(corridorsDir).filter((f) => f.endsWith('.json'));
  const all = files.map((f) => ({
    id: f.replace(/\.json$/, ''),
    data: JSON.parse(readFileSync(join(corridorsDir, f), 'utf8')),
  }));
  const hubs = collectHubNames(all.map((x) => x.data));

  // 站名 → 坐标（stations-geo）
  const stations = Object.entries(geo)
    .filter(([, v]) => v?.lng != null && v?.lat != null)
    .map(([name, v]) => ({ name, lng: v.lng, lat: v.lat }));

  let totalHintBefore = 0;
  let totalHintAfter = 0;
  let sparseBefore = 0;
  let sparseAfter = 0;
  const changed = [];

  for (const { id, data: c } of all) {
    if (!c.railway || c.railway.length < 2) continue;
    const { path, lengthKm } = buildRailwayMetrics(c.railway);
    const bbox = corridorBBox(c.railway);

    // 人工候选优先
    const manualHints = (CANDIDATES[id] || []).slice();
    const before = (c.stationsHint || []).map(normalizeHint);
    totalHintBefore += before.length;
    if (before.length < 4) sparseBefore++;

    // bbox 快筛 + 距折线分层：普通站 ≤5km（保 verify majority 断言），跨线枢纽 ≤12km
    const near = [];
    for (const st of stations) {
      if (!inBBox(st.lng, st.lat, bbox, AUTO_BBOX_PAD_DEG)) continue;
      const isHub = hubs.has(normalizeHint(st.name));
      const limit = isHub ? AUTO_HUB_SNAP_KM : AUTO_SNAP_KM;
      const proj = projectToRailway(path, lengthKm, st.lng, st.lat);
      if (proj.distKm <= limit) {
        near.push({ name: st.name, progress: proj.progress, distKm: proj.distKm, isHub });
      }
    }
    near.sort((a, b) => a.progress - b.progress);

    // 贪心选点：≥30km 间隔；跨线枢纽无条件入选
    const minGapDeg = AUTO_MIN_GAP_KM / 111;
    const picked = [];
    let lastProgressDist = -Infinity;
    for (const cand of near) {
      const gapDeg = (cand.progress - lastProgressDist) * lengthKm / 111;
      if (picked.length > 0 && gapDeg < minGapDeg && !cand.isHub) continue;
      picked.push(cand);
      lastProgressDist = cand.progress;
      if (picked.length >= AUTO_MAX_HINTS) break;
    }

    // 最终 over2 占比保护：>2km 站（枢纽）占比超限则丢弃最远的枢纽（人工条目豁免）
    const manualSet = new Set(manualHints.map(normalizeHint));
    const autoOver2 = picked.filter((p) => p.distKm > 2);
    const finalKnownCount = picked.length + (c.stationsHint || []).length;
    if (finalKnownCount >= 3 && autoOver2.length / finalKnownCount > AUTO_OVER2_RATIO_MAX) {
      const maxHubKm = AUTO_OVER2_RATIO_MAX * finalKnownCount;
      const keepHubs = autoOver2.sort((a, b) => a.distKm - b.distKm).slice(0, Math.floor(maxHubKm));
      const keepKeys = new Set(keepHubs.map((p) => normalizeHint(p.name)));
      const filtered = picked.filter(
        (p) => p.distKm <= 2 || keepKeys.has(normalizeHint(p.name)),
      );
      picked.length = 0;
      picked.push(...filtered);
    }

    // 与既有 hints + 人工 CANDIDATES 合并（人工优先、不删既有/人工）
    // 首末位保护：odStart/odEnd 断言看 hints 首末站——强制原 hints 字面首/末站
    // 保持首末位（无论其有无坐标），其余站（既有中间 + auto 新选）按 progress 排序
    const existingNamed = (c.stationsHint || []).map(normalizeHint).filter(Boolean);
    const literalFirst = (c.stationsHint || [])[0] || null;
    const literalLast = (c.stationsHint || []).length > 1 ? c.stationsHint[c.stationsHint.length - 1] : null;
    const literalFirstN = normalizeHint(literalFirst || '');
    const literalLastN = normalizeHint(literalLast || '');
    const progOf = (name) => {
      const g = geo[name] || geo[`${name}站`];
      if (!g?.lng) return null;
      return projectToRailway(path, lengthKm, g.lng, g.lat).progress;
    };
    const existingProgs = existingNamed
      .map((n) => ({ n, p: progOf(n) }))
      .filter((x) => x.p != null);

    const merged = [];
    const seen = new Set();
    const push = (name) => {
      const k = normalizeHint(name);
      if (!k || seen.has(k)) return;
      seen.add(k);
      merged.push(name);
    };
    for (const h of manualHints) push(h);
    if (literalFirstN) push(literalFirstN);
    const middle = [
      ...picked.map((p) => ({ name: p.name, p: p.progress })),
      ...existingProgs
        .slice(1, -1)
        .map((x) => ({ name: x.n, p: x.p })),
    ]
      .filter((x) => normalizeHint(x.name) !== literalFirstN && normalizeHint(x.name) !== literalLastN)
      .sort((a, b) => a.p - b.p);
    for (const x of middle) push(x.name);
    for (const h of c.stationsHint || []) push(h);
    for (const h of manualHints) push(h);
    if (literalLastN && literalLastN !== literalFirstN) {
      const idx = merged.findIndex((x) => normalizeHint(x) === literalLastN);
      if (idx >= 0 && idx !== merged.length - 1) {
        merged.splice(idx, 1);
        merged.push(literalLast);
      } else if (idx < 0) {
        merged.push(literalLast);
      }
    }
    const finalHints = merged.slice(0, AUTO_MAX_HINTS);
    // 上限截断后必须保住字面首末站
    if (literalFirstN && normalizeHint(finalHints[0]) !== literalFirstN) {
      finalHints[0] = literalFirst;
    }
    if (
      literalLastN &&
      finalHints.length > 1 &&
      normalizeHint(finalHints[finalHints.length - 1]) !== literalLastN
    ) {
      finalHints[finalHints.length - 1] = literalLast;
    }

    totalHintAfter += finalHints.length;
    if (finalHints.length < 4) sparseAfter++;
    if (JSON.stringify(finalHints) !== JSON.stringify(c.stationsHint)) {
      changed.push({ id, before: (c.stationsHint || []).length, after: finalHints.length });
      if (WANT) {
        c.stationsHint = finalHints;
        writeFileSync(join(corridorsDir, `${id}.json`), JSON.stringify(c, null, 2) + '\n', 'utf8');
      }
    }
    console.log(
      `[auto] ${id}: near=${near.length} picked=${picked.length} hints ${(c.stationsHint || []).length}→${finalHints.length}`,
    );
  }

  console.log(`\n[auto] corridors=${all.length} changed=${changed.length}${WANT ? ' (WRITTEN)' : ' (dry-run)'}`);
  console.log(`[auto] total hints ${totalHintBefore}→${totalHintAfter}, hint<4 corridors ${sparseBefore}→${sparseAfter}`);
  const biggest = changed.sort((a, b) => b.after - a.after).slice(0, 10);
  for (const ch of biggest) console.log(`  ${ch.id}: ${ch.before}→${ch.after}`);
  console.log('');
  console.log('[auto] NOTE: --write 后请执行 verify-corridor-geometry --strict 与 patrol-data --strict');
}

if (AUTO) {
  autoExpand();
} else {
  runManual();
}

function runManual() {
for (const [id, candidates] of Object.entries(CANDIDATES)) {
  const file = join(corridorsDir, `${id}.json`);
  if (!existsSync(file)) {
    console.log(`[${id}] 走廊文件不存在，跳过`);
    continue;
  }
  const c = JSON.parse(readFileSync(file, 'utf8'));
  const { path, lengthKm } = buildRailwayMetrics(c.railway);
  const existing = new Set((c.stationsHint || []).map((h) => h.replace(/站$/g, '').trim()));
  const pass = [];
  const report = [];
  for (const name of candidates) {
    const g = geo[name];
    if (!g || g.lng == null) {
      report.push(`  ✗ ${name}: stations-geo 无坐标`);
      continue;
    }
    const proj = projectToRailway(path, lengthKm, g.lng, g.lat);
    if (proj.distKm > 12) {
      report.push(`  ✗ ${name}: 距折线 ${proj.distKm.toFixed(1)}km >12`);
      continue;
    }
    const mark = existing.has(name) ? '·' : '+';
    pass.push(name);
    report.push(`  ${mark} ${name}: ${proj.distKm.toFixed(2)}km @ ${(proj.progress * 100).toFixed(0)}%`);
  }
  console.log(`[${id}] 候选 ${candidates.length}，通过 ${pass.length}`);
  for (const line of report) console.log(line);
  if (WANT && pass.length) {
    const merged = [];
    for (const h of pass) {
      if (!merged.some((x) => x.replace(/站$/g, '') === h.replace(/站$/g, ''))) merged.push(h);
    }
    c.stationsHint = merged;
    writeFileSync(file, JSON.stringify(c, null, 2) + '\n', 'utf8');
    console.log(`  → 已写入 ${merged.length} 个 hints`);
  }
  console.log('');
}
}
