/**
 * 万里路书 · 自驾页背景数据生成（scripts/build-drive-backdrop.mjs）
 *
 * 用法：node scripts/build-drive-backdrop.mjs
 * 产物：apps/web/src/data/driveBackdrop.ts —— 只含**景点热力点**（viewBox 坐标）。
 *
 * v0.6.0 变更：全国路网不再以折线形式内联（790 万条可通行道路 / 1.5 万条编号公路
 * 无法用折线承载），改由构建期离线渲染的位图承担：
 *   scripts/build-drive-network-raster.mjs → apps/web/public/drive-network.png
 * 本脚本因此只负责"景点星点"这一层，与路网位图在同一条 canvas 上叠加。
 *
 * 纪律：投影参数与 chinaBackdrop.ts（铁路背景）严格一致，两套背景同坐标系、切换无跳变。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R = join(__dirname, '..');
const SPOTS = join(R, 'data/roads/roadside-spots.json');
const OUT = join(R, 'apps/web/src/data/driveBackdrop.ts');

// 与 chinaBackdrop.ts 严格一致（保证两套背景同坐标系）
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

/**
 * 背景星点上限：公路景点库已扩充到 1.2 万+ 条，全量内联会把主模块顶到 250KB+，
 * 且密到糊成一团（背景是"观感用途"，不是数据视图）。按观赏权重取前 N 个即可。
 */
const MAX_HEAT_POINTS = 1200;

const raw = existsSync(SPOTS) ? JSON.parse(readFileSync(SPOTS, 'utf8')) : { spots: [] };
const spots = Array.isArray(raw.spots) ? raw.spots : [];
const heat = [];
let migratedSkipped = 0;
for (const s of spots) {
  /*
   * 排除从铁路侧迁移来的条目。
   * ⚠️ 历史 bug：这里曾写成 `source.includes('rail')`，但迁移条目的 source 实际是
   * `migrated:curated` / `migrated:ai_reviewed` / `migrated:preset` / `migrated:ai_generated`，
   * 一个都不含 "rail" —— 过滤完全失效，624 条铁路"车窗观赏"点一直被画在公路背景上
   * （需求方明确指出的严重问题）。判断条件必须是前缀匹配。
   */
  if (String(s.source ?? '').startsWith('migrated')) {
    migratedSkipped += 1;
    continue;
  }
  if (!Number.isFinite(s.lng) || !Number.isFinite(s.lat)) continue;
  const [x, y] = lngLatToViewBox(s.lng, s.lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
  if (x < -20 || x > VIEW_W + 20 || y < -20 || y > VIEW_H + 20) continue;
  const base = Math.max(0, Math.min(1, (s.score ?? 44) / 100));
  const w = Math.min(1, base + (s.category?.startsWith('viewpoint') ? 0.15 : 0));
  heat.push([r1(x), r1(y), Math.round(w * 100) / 100]);
}
const heatPicked = [...heat].sort((a, b) => b[2] - a[2]).slice(0, MAX_HEAT_POINTS);

const body = `/**
 * 自驾页背景层的离线静态数据（景点星点）。
 *
 * ⚠️ 由 scripts/build-drive-backdrop.mjs 自动生成，请勿手改。
 * 生成时间：${new Date().toISOString()}
 *
 * 全国路网本身不在本文件里：它由构建期离线渲染的位图承载
 * （apps/web/public/drive-network.png，脚本 scripts/build-drive-network-raster.mjs），
 * 由 DriveBackdropMap 组件在运行时按需加载并叠加星点。
 */

/** viewBox 尺寸（与 CHINA_OUTLINE_VIEWBOX 一致） */
export const DRIVE_BACKDROP_VIEWBOX = { width: ${VIEW_W}, height: ${VIEW_H} } as const;

/** [x, y, weight]：viewBox 坐标下的公路侧景点热力点，weight 为观赏权重(0–1) */
export type DriveHeatPoint = readonly [x: number, y: number, w: number];

export const CHINA_ROAD_HEAT: readonly DriveHeatPoint[] = [
${heatPicked.map(([x, y, w]) => '  [' + x + ', ' + y + ', ' + w + '],').join('\n')}
] as const;
`;

writeFileSync(OUT, body, 'utf8');
console.log('✓ ' + OUT + '  (' + (body.length / 1024).toFixed(1) + ' KB)');
console.log('  景点热力点 ' + heatPicked.length + ' / 公路原生 ' + heat.length + ' / 总 ' + spots.length + '（已排除铁路迁移条 ' + migratedSkipped + '）');
