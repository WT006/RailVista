// 同编号异路散段拆分（detach）：把 segments 中距主链过远的分量移入 detachedSegments。
// 背景：X/Y/C 编号在省内各县复用（吉林_Y1 的 5 个散段距主链 57~546km），
//       G/E 的散段多为绕城/并行段。它们不是主链的断链，挂在主链下会让
//       DriveTrip 取景横跨全省、主链被挤成一条线（"Y 乡道很差"的观感来源）。
// 处理：散段三代表点（首/中/尾）到主链抽稀链的最小距离 > DETACH_KM → 移出 segments。
//       1~15km 保留（真断链/近旁平行段，继续以虚线诚实呈现）。
//       detachedSegments 数据保留在 geom 文件中；topo builder 会以 line=65535
//       （跨线边哨兵，prefer 永不命中）继续建边，寻路连通性不受影响。
// 幂等：重复运行无变动即不写回。可选环境变量：
//   DETACH_KM   阈值 km，默认 15
//   DETACH_ONLY 仅处理匹配该类的 key，如 'Y'（匹配 *_Y\d）、'S'；空 = 全部
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { haversineKm } from './lib/overpass.mjs';

const DIR = join(process.cwd(), 'data/roads/geom');
const DETACH_KM = Number(process.env.DETACH_KM || 15);
const ONLY = process.env.DETACH_ONLY || '';
const ONLY_RE = ONLY ? new RegExp(`^.+_(${ONLY})\\d`) : null;

if (!existsSync(DIR)) {
  console.error('geom 目录不存在');
  process.exit(1);
}

/** 主链抽稀到 ≤600 点，供距离比对 */
function decimate(pts, n = 600) {
  if (pts.length <= n) return pts;
  const step = (pts.length - 1) / (n - 1);
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(pts[Math.round(i * step)]);
  out[out.length - 1] = pts[pts.length - 1];
  return out;
}

/** 段三代表点到主链抽稀链的最小距离（km） */
function minDistToChain(seg, chain) {
  const m = seg.length;
  const reps = [seg[0], seg[Math.floor(m / 2)], seg[m - 1]];
  let best = Infinity;
  for (const p of reps) {
    for (const c of chain) {
      const d = haversineKm([p[0], p[1]], [c[0], c[1]]);
      if (d < best) best = d;
      if (best < 0.05) return best;
    }
  }
  return best;
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
let touched = 0, moved = 0, kept = 0, alreadyDetached = 0, skippedNoSeg = 0;
const samples = [];
for (const f of files) {
  const key = f.replace(/\.json$/, '');
  if (ONLY_RE && !ONLY_RE.test(key)) continue;
  let g;
  try {
    g = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  } catch {
    continue;
  }
  if (!Array.isArray(g.points) || g.points.length < 2) continue;
  if (!Array.isArray(g.segments) || g.segments.length === 0) {
    skippedNoSeg += 1;
    continue;
  }
  const chain = decimate(g.points);
  const keep = [];
  const out = [];
  for (const seg of g.segments) {
    if (!Array.isArray(seg) || seg.length < 2) {
      keep.push(seg);
      continue;
    }
    const d = minDistToChain(seg, chain);
    if (d > DETACH_KM) {
      out.push(seg);
      moved += 1;
      if (samples.length < 8) samples.push({ key, dKm: Math.round(d), len: seg.length });
    } else {
      keep.push(seg);
      kept += 1;
    }
  }
  if (out.length === 0) continue;
  g.segments = keep;
  g.detachedSegments = [...(Array.isArray(g.detachedSegments) ? g.detachedSegments : []), ...out];
  alreadyDetached = g.detachedSegments.length;
  g.detachedCount = g.detachedSegments.length;
  // componentCount ≈ 主链 1 + 保留近段分量数（detach 后的诚实分量数）
  g.componentCount = 1 + keep.length;
  writeFileSync(join(DIR, f), JSON.stringify(g));
  touched += 1;
}
console.log(`detach 完成: 改写 ${touched} 文件 / 移出 ${moved} 段 / 保留 ${kept} 段 / 无散段 ${skippedNoSeg}`);
console.log('样例:', JSON.stringify(samples));
