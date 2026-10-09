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
