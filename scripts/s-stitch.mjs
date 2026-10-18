// s-stitch.mjs — 断笔缝合：把端点距离 <1km 且方向连续的散段缝回主链
// 背景：OSM 乡道/县道 way 常是"断笔绘制"——相邻 way 端点不共享节点但几何上仅差
// 几十~几百米，此前装配只认共享节点/同编号邻接，导致 293 条 Y 乡道 6-8 组件碎线。
// 策略：贪心最近端点缝合 + 方向连续性校验（防 U 型错接）；接不上的诚实保留。
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STITCH_KM = Number(process.env.STITCH_KM || 1.0);
// 行进连续判据：主链行进方向 vs 散段离开接缝方向夹角 ≤ DIR_DEG（差 180° 的"指向接缝"角需先翻转）
const DIR_DEG = Number(process.env.STITCH_DIR_DEG || 30);
const GEOM_DIR = 'data/roads/geom';

const R = 6371, rad = Math.PI / 180;
const dist = (a, b) => 2 * R * Math.asin(Math.sqrt(
  Math.sin((a[1] - b[1]) * rad / 2) ** 2 +
  Math.cos(a[1] * rad) * Math.cos(b[1] * rad) *
  Math.sin((a[0] - b[0]) * rad / 2) ** 2));

// 链端进入方向角（度，0-360）：以 atHead 指定端为端点，取样点距自适应短链
function endBearing(pts, atHead) {
  const n = pts.length;
  const k = Math.min(4, n - 1); // 取样点距（2 点链时 k=1）
  const near = pts[atHead ? 0 : n - 1];
  const far = pts[atHead ? k : n - 1 - k];
  const y = (near[0] - far[0]) * Math.cos(((near[1] + far[1]) / 2) * rad);
  const x = near[1] - far[1];
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
// 从端点继续延伸的方向（散段被接续时的走向）
function extendBearing(pts) {
  const n = pts.length;
  const k = Math.min(4, n - 1);
  const from = pts[0], to = pts[k];
  const y = (to[0] - from[0]) * Math.cos(((to[1] + from[1]) / 2) * rad);
  const x = to[1] - from[1];
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
const angDiff = (a, b) => {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
// 行进连续：链行进方向 a 与散段"指向被接端"方向 b 相差应 ≈180°（散段离开接缝 = b+180）
const travelOk = (a, b) => angDiff(a, (b + 180) % 360) <= DIR_DEG;

function cumKmOf(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + dist(points[i - 1], points[i]));
  return cum;
}

let files = readdirSync(GEOM_DIR).filter((f) => f.endsWith('.json') && !f.includes('spot'));
// 可选：仅处理指定前缀（REBUILD_CLS 风格）
const only = process.env.STITCH_CLS; // 'Y' | 'X' | 'S' ...
if (only) files = files.filter((f) => new RegExp(`^.+_${only}\\d`).test(f));

let touched = 0, stitchedSegs = 0, fullyJoined = 0, totalBefore = 0, totalAfter = 0;
const changes = [];

for (const f of files) {
  const p = join(GEOM_DIR, f);
  let g;
  try { g = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
  const segs = g.segments || [];
  if (!segs.length || !g.points?.length) continue;
  // 官方拆分结构不动
  if (g.reuseSplit || g.officialSegmentMissing) continue;

  const before = 1 + segs.length;
  // 生长模型：从主链两端贪心吸收散段
  const chain = g.points.map((pt) => [...pt]); // 拷贝
  const pool = segs.map((s) => s.map((pt) => [...pt]));
  const stitchGaps = [];
  let joined = 0;

  for (let round = 0; round < 200; round += 1) {
    let best = null;
    for (let si = 0; si < pool.length; si += 1) {
      const s = pool[si];
      if (s.length < 2) continue;
      // 主链尾 ←→ 散段头（散段正序 push）
      {
        const d = dist(chain[chain.length - 1], s[0]);
        if (d < STITCH_KM && (!best || d < best.d)) {
          if (travelOk(endBearing(chain, false), endBearing(s, true))) best = { si, tail: true, d };
        }
      }
      // 主链尾 ←→ 散段尾（散段需 reverse）
      {
        const d = dist(chain[chain.length - 1], s[s.length - 1]);
        if (d < STITCH_KM && (!best || d < best.d)) {
          if (travelOk(endBearing(chain, false), endBearing(s, false))) best = { si, tail: true, d };
        }
      }
      // 主链头 ←→ 散段头（散段 reverse 后 unshift）
      {
        const d = dist(chain[0], s[0]);
        if (d < STITCH_KM && (!best || d < best.d)) {
          if (travelOk(endBearing(chain, true), endBearing(s, true))) best = { si, head: true, segHead: true, d };
        }
      }
      // 主链头 ←→ 散段尾（散段正序 unshift）
      {
        const d = dist(chain[0], s[s.length - 1]);
        if (d < STITCH_KM && (!best || d < best.d)) {
          if (travelOk(endBearing(chain, true), endBearing(s, false))) best = { si, head: true, segHead: false, d };
        }
      }
    }
    if (!best) break;
    const s = pool[best.si];
    pool.splice(best.si, 1);
    if (best.head) {
      // 拼到链头：链头后接散段，散段方向需从其被接端走向远端
      const rev = best.segHead; // segHead=true：散段头被接 → 散段需 reverse 后拼接
      const body = rev ? [...s].reverse() : s;
      chain.unshift(...body);
    } else {
      // 拼到链尾：best.tail=true 表示散段头被接 → 正序；false 表示散段尾被接 → reverse
      const body = best.tail ? s : [...s].reverse();
      chain.push(...body);
    }
    joined += 1;
    stitchGaps.push(Math.round(best.d * 1000));
  }

  if (!joined) continue;
  const after = 1 + pool.length;
  const cum = cumKmOf(chain);
  const segKm = pool.reduce((acc, s) => acc + cumKmOf(s)[cumKmOf(s).length - 1], 0);
  const totalKm = Math.round((cum[cum.length - 1] + segKm) * 10) / 10;
  g.points = chain;
  g.cumKm = cum.map((c) => Math.round(c * 1000)); // 历史约定：米量纲（运行时会重算）
  g.totalKm = totalKm;
  g.componentCount = after;
  g.segments = pool;
  g.stitched = true;
  g.stitchCount = joined;
  g.stitchMaxM = Math.max(...stitchGaps);
  writeFileSync(p, JSON.stringify(g));
  touched += 1;
  stitchedSegs += joined;
  totalBefore += before;
  totalAfter += after;
  if (pool.length === 0) fullyJoined += 1;
  if (touched <= 15) changes.push(`${f}: ${before}→${after} 组件, 缝合 ${joined} 段, 最大断口 ${g.stitchMaxM}m`);
}

console.log(`缝合完成: ${touched} 条文件, 缝回 ${stitchedSegs} 段`);
console.log(`完全连贯(0 散段): ${fullyJoined} 条`);
console.log(`组件总数: ${totalBefore} → ${totalAfter}`);
console.log(changes.slice(0, 15).join('\n'));
