/**
 * 万里路书 · 自驾页「全国公路网背景地图」离线数据生成（对标 scripts/build-china-backdrop.mjs）。
 *
 * 用法：node scripts/build-drive-backdrop.mjs
 *
 * 产物：apps/web/src/data/driveBackdrop.ts
 *   - CHINA_ROAD_NETWORK：各等级公路的折线（viewBox 坐标），供 canvas 描线
 *   - CHINA_ROAD_HEAT：公路侧景点热力点（viewBox 坐标）
 *
 * 数据源与纪律：
 *   - 投影参数复用 chinaBackdrop.ts 的 CHINA_MERCATOR_BOUNDS，与首页背景地图严格同坐标系；
 *   - 几何取 data/roads/geom/*.json 的 **points + segments**；
 *     ⚠️ 关键：诊断发现 points 与 segments 互不相交，G318 的真实上海段（121°E）
 *     只存在于 segments 里（主链 bbox 仅 91~103°E）。背景图是"观感用途"而非导航，
 *     因此这里把两部分都画出来，才能呈现完整的全国公路网骨架。
 *   - 构建期一次性生成并冻结进工程，运行时零网络请求、不依赖在线地图服务。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R = join(__dirname, '..');
const GEOM_DIR = join(R, 'data/roads/geom');
const IDX_DIR = join(R, 'data/roads/index');
const SPOTS = join(R, 'data/roads/roadside-spots.json');
const OUT = join(R, 'apps/web/src/data/driveBackdrop.ts');
const NET_OUT = join(R, 'apps/web/src/data/driveRoadNetwork.ts');

// 与 chinaBackdrop.ts 严格一致（保证两套背景同坐标系，切换无跳变）
const B = { minX: 1.2828581027, maxX: 2.3578445245, minY: 0.0670400688, maxY: 1.1112870864 };
const VIEW_W = 1000;
const VIEW_H = 971;

function lngLatToViewBox(lng, lat) {
  const x = lng * (Math.PI / 180);
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));
  const px = ((x - B.minX) / (B.maxX - B.minX)) * VIEW_W;
  const py = VIEW_H - ((y - B.minY) / (B.maxY - B.minY)) * VIEW_H;
  return [px, py];
}

const r1 = (n) => Math.round(n * 10) / 10;

// ── 1. 公路几何 ──────────────────────────────────────────────────────────────
const entries = new Map();
for (const f of ['national.json', 'expressway.json', 'provincial.json']) {
  const p = join(IDX_DIR, f);
  if (!existsSync(p)) continue;
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  for (const r of raw.roads ?? []) entries.set(r.key, r);
}

/**
 * 按 viewBox 弧长重采样：间距 ~SAMPLE_UNITS 取一点。
 * 背景图铺满时 1 viewBox 单位 ≈ 1.7px，间距 3.5 单位 ≈ 6px，
 * 视觉上仍是连续平滑的线，同时把点数压到可内联的规模。
 */
const SAMPLE_UNITS = 4;
const MAX_PTS_PER_ROAD = 420;

function resample(viewBoxPts) {
  if (viewBoxPts.length < 2) return viewBoxPts;
  const out = [viewBoxPts[0]];
  let acc = 0;
  for (let i = 1; i < viewBoxPts.length; i += 1) {
    const [px, py] = out[out.length - 1];
    const [cx, cy] = viewBoxPts[i];
    acc += Math.hypot(cx - px, cy - py);
    if (acc >= SAMPLE_UNITS) {
      out.push([cx, cy]);
      acc = 0;
    }
  }
  const last = viewBoxPts[viewBoxPts.length - 1];
  out.push(last);
  if (out.length > MAX_PTS_PER_ROAD) {
    // 兜底：超长线路按步长均匀取样（极少数超长高速/国道才会走到这里）
    const step = (out.length - 1) / (MAX_PTS_PER_ROAD - 1);
    const thinned = [out[0]];
    let prev = 0;
    for (let i = 1; i < MAX_PTS_PER_ROAD - 1; i += 1) {
      const idx = Math.round(i * step);
      if (idx > prev) { thinned.push(out[idx]); prev = idx; }
    }
    thinned.push(out[out.length - 1]);
    return thinned;
  }
  return out;
}

const roads = [];
let totalRawPts = 0;
let totalOutPts = 0;

for (const [key, entry] of entries) {
  const fp = join(GEOM_DIR, `${key.replace(/[^\w:]/g, '_')}.json`);
  if (!existsSync(fp)) continue;
  let g;
  try { g = JSON.parse(readFileSync(fp, 'utf8')); } catch { continue; }
  if (!Array.isArray(g.points) || g.points.length < 2) continue;

  // points（主链） + segments（孤链，含真实全线走向）都纳入
  const chains = [g.points, ...(Array.isArray(g.segments) ? g.segments : [])]
    .filter((c) => Array.isArray(c) && c.length >= 2);

  const polylines = [];
  for (const chain of chains) {
    totalRawPts += chain.length;
    const vb = chain
      .map((pt) => lngLatToViewBox(pt[0], pt[1]))
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= -20 && x <= VIEW_W + 20 && y >= -20 && y <= VIEW_H + 20);
    const pts = resample(vb)
      .map(([x, y]) => [Math.round(x), Math.round(y)])
      .filter(([x, y], i, arr) => i === 0 || i === arr.length - 1 || x !== arr[i - 1][0] || y !== arr[i - 1][1]);
    if (pts.length >= 2) polylines.push(pts);
    totalOutPts += pts.length;
  }
  if (!polylines.length) continue;

  roads.push({ key, ref: entry.ref, cls: entry.class, lines: polylines });
}

// ── 2. 公路侧景点热力 ────────────────────────────────────────────────────────
const spotsRaw = JSON.parse(readFileSync(SPOTS, 'utf8'));
const spots = spotsRaw.spots ?? spotsRaw;
const heat = [];
for (const s of spots) {
  if (!Number.isFinite(s.lng) || !Number.isFinite(s.lat)) continue;
  const [x, y] = lngLatToViewBox(s.lng, s.lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
  if (x < -20 || x > VIEW_W + 20 || y < -20 || y > VIEW_H + 20) continue;
  // 权重：以 score 为主，观景类略加权（与铁路侧 weight 语义对齐，0–1）
  const base = Math.max(0, Math.min(1, (s.score ?? 44) / 100));
  const w = Math.min(1, base + (s.category?.startsWith('viewpoint') ? 0.15 : 0));
  heat.push([r1(x), r1(y), Math.round(w * 100) / 100]);
}

// ── 3. 输出 ──────────────────────────────────────────────────────────────────
/** 扁平编码：`[x0,y0,x1,y1,...]` —— 省掉每点的方括号，体积约为嵌套数组的一半 */
const fmtLine = (pts) => pts.map(([x, y]) => `${x},${y}`).join(',');
const fmtPoly = (lines) => lines.map((l) => `[${fmtLine(l)}]`).join(',');

const body = `/**
 * 自驾页「全国公路网背景地图」的离线静态数据。
 *
 * ⚠️ 由 scripts/build-drive-backdrop.mjs 自动生成，请勿手改。
 * 数据源：data/roads/geom/*.json（points + segments）+ data/roads/roadside-spots.json。
 * 生成时间：${new Date().toISOString()}
 *
 * 设计意图：与首页（铁路）背景共用同一套投影参数与观感规格 ——
 * 极淡的中国轮廓 + 公路网光带 + 公路侧景点星点 + 指针径向高光，
 * 运行时不发起任何网络请求、不依赖在线地图服务。
 *
 * 注意：几何取 points 与 segments 的并集。诊断显示两者互不相交，
 * 例如 G318 的真实上海段（121°E）只存在于 segments，而主链 bbox 仅 91~103°E。
 * 背景图属"观感用途"，并集才能呈现完整路网骨架；导航/里程仍以 points 为准。
 */

/** viewBox 尺寸（与 CHINA_OUTLINE_VIEWBOX 一致） */
export const DRIVE_BACKDROP_VIEWBOX = { width: ${VIEW_W}, height: ${VIEW_H} } as const;

/**
 * 一条公路的折线组。lines 中每条为扁平坐标流（x0,y0,x1,y1 交替），
 * 由 unpackLine() 还原为点数组，避免嵌套数组带来的体积开销。
 */
export interface BackdropRoad {
  key: string;
  ref: string;
  cls: string;
  lines: readonly number[][];
}

/** 扁平坐标流 → 折线点数组 */
export function unpackLine(flat: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

/** [x, y, weight]：viewBox 坐标下的公路侧景点热力点，weight 为观赏权重(0–1) */
export type DriveHeatPoint = readonly [x: number, y: number, w: number];

export const CHINA_ROAD_HEAT: readonly DriveHeatPoint[] = [
${heat.map(([x, y, w]) => `  [${x}, ${y}, ${w}],`).join('\n')}
] as const;

/**
 * 公路网折线单独成块、由组件动态 import() 懒加载（不进主 bundle）。
 * 主模块只留轮廓参数与景点星点，保证首屏零阻塞；
 * 路网描线到达后再淡入，视觉上是"路网逐渐点亮"。
 */
export const ROAD_NETWORK_CHUNK = () => import('../data/driveRoadNetwork.js');
`;

const netLines = roads.map((r) => `  { key: '${r.key}', ref: '${r.ref}', cls: '${r.cls}', lines: [${fmtPoly(r.lines)}] },`).join('\n');
const netSize = Buffer.byteLength(netLines);

const netBody = `/**
 * 自驾背景 · 全国公路网折线（懒加载块）。
 *
 * ⚠️ 由 scripts/build-drive-backdrop.mjs 自动生成，请勿手改。
 * 生成时间：${new Date().toISOString()}
 *
 * 体积较大（约 ${Math.round(netSize / 1024)}KB），因此与 driveBackdrop.ts 分离，
 * 由 DriveBackdropMap 组件动态 import() 加载，不进主 bundle。
 */

import type { BackdropRoad } from './driveBackdrop.js';

/** 全国公路网：每条公路的折线组（扁平坐标流） */
export const CHINA_ROAD_NETWORK: readonly BackdropRoad[] = [
${netLines}
] as const;
`;

writeFileSync(OUT, body, 'utf8');
writeFileSync(NET_OUT, netBody, 'utf8');

const byCls = {};
for (const r of roads) byCls[r.cls] = (byCls[r.cls] ?? 0) + 1;
console.log(`✓ ${OUT}  (${(body.length / 1024).toFixed(1)} KB)`);
console.log(`✓ ${NET_OUT}  (${(netBody.length / 1024).toFixed(1)} KB)`);
console.log(`  公路 ${roads.length} 条（${JSON.stringify(byCls)}）`);
console.log(`  折线点 ${totalRawPts} → ${totalOutPts}`);
console.log(`  景点热力点 ${heat.length} / ${spots.length}`);
