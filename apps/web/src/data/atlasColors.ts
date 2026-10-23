/**
 * atlas 全国地图 · 数据语义色板（集中声明，严禁分散硬编码）。
 *
 * 与 data/roadColors.ts 同级纪律：图例 / 图层 / 热力 / 描边等「地图数据色」
 * 只能从这里取；主题色（品牌/文本/描边）仍走 tokens.css 语义令牌。
 */

/** 景点来源色（与铁路侧星点、公路侧星点同色） */
export const ATLAS_ORIGIN_COLORS = {
  all: '#9aa7b8',
  rail: '#4d9fff',
  road: '#ffb84d',
} as const;

/** 铁路线路描边（与品牌 accent 同色，地图画布用） */
export const ATLAS_RAIL_STROKE = '#4d9fff';

/** 铁路线路悬停描边（accent-hover 的镜像值，画布取色回退用） */
export const ATLAS_RAIL_HOVER_STROKE = '#74b2ff';

/**
 * 行程地图折线（overlay 真彩，与 --rail / accent 对齐）。
 */
export const TRIP_RAIL_STROKE_BRIGHT = '#4d9fff';

/** 行程地图：车头/霞光描边 */
export const TRIP_GLOW_STROKE = '#ff7a1a';

/** 行程地图：线路高亮描边 */
export const TRIP_HIGHLIGHT_STROKE = '#a78bfa';

/** 天象聚焦路段：金色时刻 */
export const TRIP_SKY_GOLDEN_STROKE = '#ffc107';

/** 天象聚焦路段：蓝色时刻 */
export const TRIP_SKY_BLUE_STROKE = '#00b0ff';

/** 天象聚焦路段：日出/日落 */
export const TRIP_SKY_SUN_STROKE = '#ff5722';

/** 未选中线路网络描边（低饱和灰蓝） */
export const ATLAS_NETWORK_STROKE = '#7a8494';

/** 热力图色阶（评分 → 颜色） */
export const ATLAS_HEAT_GRADIENT: Record<string, string> = {
  '0.25': '#38bdf8',
  '0.45': '#34d399',
  '0.65': '#fbbf24',
  '0.85': '#fb923c',
  '1': '#f87171',
};
