/**
 * P0-1 收尾复核 —— **按 QA 口径**：全量扫 15117 个 geom 文件，
 * 统计「存在无高亮段的路数」与「无高亮段总数」。
 *
 * 判定：某段高亮折线为空（章节区间与「抽稀后主链的里程覆盖」无交集）即无高亮。
 * 新实现下抽稀链的里程 = 全分辨率 cumKm 按同一下标切片，故抽稀链覆盖 [0, fullChainKm]。
 */
import { readFileSync, readdirSync } from 'node:fs';

const GEOM = 'data/roads/geom';
const NODE_KM_TOLERANCE = 1.35;
const NODE_MIN_GAP_KM = 5;

function hav(a, b, c, d) {
  const R = 6371;
  const dLat = ((d - b) * Math.PI) / 180;
  const dLng = ((c - a) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((b * Math.PI) / 180) * Math.cos((d * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function cum(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i += 1) c[i] = c[i - 1] + hav(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return c;
}
/** 与 roadNetwork.decimatePoints 一致：按索引等分 */
function decimateIdx(points, maxPoints) {
  if (points.length <= maxPoints) return points.map((_, i) => i);
  const step = (points.length - 1) / (maxPoints - 1);
  const out = [];
  for (let i = 0; i < maxPoints; i += 1) out.push(Math.round(i * step));
  return out;
}

/** 复刻 sanitizePlaceNodes 的过滤 + 排序 + 最小间距剪枝 */
function sanitize(nodes, totalKm) {
  const limit = totalKm > 0 ? totalKm * NODE_KM_TOLERANCE : Infinity;
  const seen = new Set();
  const out = [];
  for (const n of nodes) {
    const name = (n?.name ?? '').trim();
    const atKm = n?.atKm;
    if (!name || !Number.isFinite(atKm) || atKm < 0 || atKm > limit) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, atKm });
  }
  out.sort((a, b) => a.atKm - b.atKm);
  const pruned = [];
  for (const n of out) {
    const last = pruned[pruned.length - 1];
    if (last && n.atKm - last.atKm < NODE_MIN_GAP_KM) { pruned[pruned.length - 1] = n; continue; }
    pruned.push(n);
  }
  return pruned;
}

/** 复刻 buildChapters：地名优先，否则 120km 兜底（夹到主链实绘长度） */
function chaptersOf(nodes, totalKm, chainKm) {
  const usable = sanitize(nodes || [], totalKm);
  if (usable.length >= 2) {
    const chs = [];
    for (let i = 1; i < usable.length; i += 1) {
      const a = usable[i - 1];
      const b = usable[i];
      if (b.atKm - a.atKm < 5) continue;
      chs.push({ fromKm: a.atKm, toKm: b.atKm });
    }
    if (chs.length) return { chs, byPlace: true };
  }
  const windowTotal = chainKm > 0 ? Math.min(totalKm, chainKm) : totalKm;
  if (!(windowTotal > 0)) return { chs: [], byPlace: false };
  const round1 = (v) => Math.round(v * 10) / 10;
  const chs = [];
  for (let from = 0; from < windowTotal; from += 120) {
    const to = Math.min(from + 120, windowTotal);
    const rf = round1(from), rt = round1(to);
    if (rt > rf) chs.push({ fromKm: rf, toKm: rt });
    if (to >= windowTotal) break;
  }
  return { chs, byPlace: false };
}

const files = readdirSync(GEOM).filter((f) => f.endsWith('.json'));
let scanned = 0;
let roadsWithChapters = 0;
let segTotal = 0;
let segByPlace = 0;
let segFallback = 0;
let roadsWithMissing = 0;
let missingTotal = 0;
/** [旧] 前端在抽稀链上重算里程 —— 对照用 */
let missingTotalOld = 0;
let roadsWithMissingOld = 0;
const samples = [];
const roadsWithMissingOldDirty = new Set();

for (const f of files) {
  let g;
  try { g = JSON.parse(readFileSync(`${GEOM}/${f}`, 'utf8')); } catch { continue; }
  if (!Array.isArray(g.points) || g.points.length < 2) continue;
  scanned += 1;

  const full = cum(g.points);
  const chainKm = full[full.length - 1];
  const totalKm = Number.isFinite(g.totalKm) ? g.totalKm : chainKm;
  const { chs, byPlace } = chaptersOf(g.nodes, totalKm, chainKm);
  if (!chs.length) continue;
  roadsWithChapters += 1;

  const idx = decimateIdx(g.points, 600);
  // 新：全分辨率 cumKm 按同一下标切片 → 覆盖到 fullChainKm（误差 0）
  const kmNew = full[idx[idx.length - 1]];
  // 旧：前端在抽稀链上重算 haversine
  const decOld = idx.map((i) => g.points[i]);
  const kmOld = cum(decOld)[decOld.length - 1];

  let roadMissing = 0;
  for (const c of chs) {
    segTotal += 1;
    if (byPlace) segByPlace += 1; else segFallback += 1;
    const lo = Math.max(0, c.fromKm);
    if (!(Math.min(c.toKm, kmNew) > lo)) {
      roadMissing += 1;
      if (samples.length < 10) samples.push(`${f} 段 ${c.fromKm}—${c.toKm} (抽稀链覆盖 0—${kmNew.toFixed(1)})`);
    }
    if (!(Math.min(c.toKm, kmOld) > lo)) { missingTotalOld += 1; roadsWithMissingOldDirty.add(f); }
  }
  if (roadMissing) { roadsWithMissing += 1; missingTotal += roadMissing; }
}

console.log('════ P0-1 收尾复核（QA 口径：全量 geom 文件）════');
console.log(`扫描 geom 文件        : ${scanned} / 目录共 ${files.length}`);
console.log(`有分段的路            : ${roadsWithChapters}`);
console.log(`段总数                : ${segTotal}（地名段 ${segByPlace} / 120km兜底段 ${segFallback}）`);
console.log(`[旧] 存在无高亮段的路数: ${roadsWithMissingOldDirty.size}`);
console.log(`[旧] 无高亮段总数      : ${missingTotalOld}`);
console.log(`[新] 存在无高亮段的路数: ${roadsWithMissing}`);
console.log(`[新] 无高亮段总数      : ${missingTotal}   ${missingTotal === 0 ? '✔ 达标（要求 0）' : '✘'}`);
if (samples.length) console.log('样本:\n  ' + samples.join('\n  '));
