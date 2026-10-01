/**
 * 景点六维分类的展示元数据（docs/scenic-schema-v3.md §3）。
 *
 * 只负责「展示」：颜色、短标签、排序；不参与任何几何或判定逻辑。
 * RouteDetail（分组列表）与 AtlasMap（点位着色 + 图例）共用同一份定义。
 */
export type SpotDimensionKey =
  | 'geo'
  | 'nature'
  | 'culture'
  | 'history'
  | 'construct'
  | 'architecture';

export type DimensionMeta = {
  key: SpotDimensionKey | 'other';
  /** 完整维度名，用于分组标题 */
  label: string;
  /** 2 字短标签，用于徽章 */
  short: string;
  /** 地图点位 / 徽章配色 */
  color: string;
};

export const SPOT_DIMENSIONS: DimensionMeta[] = [
  { key: 'geo', label: '大地理', short: '地貌', color: '#38bdf8' },
  { key: 'nature', label: '大自然', short: '生态', color: '#34d399' },
  { key: 'culture', label: '大人文', short: '人文', color: '#f472b6' },
  { key: 'history', label: '大历史', short: '史迹', color: '#fbbf24' },
  { key: 'construct', label: '大国建造', short: '工程', color: '#a78bfa' },
  { key: 'architecture', label: '大国建筑', short: '建筑', color: '#fb923c' },
];

/** 数据尚未打维度标签的景点归入「其它」，不丢弃也不伪造分类 */
export const UNCLASSIFIED_DIMENSION: DimensionMeta = {
  key: 'other',
  label: '沿线风光',
  short: '其它',
  color: '#94a3b8',
};

export function dimensionMeta(key: string | undefined | null): DimensionMeta {
  return SPOT_DIMENSIONS.find((d) => d.key === key) || UNCLASSIFIED_DIMENSION;
}

export function isKnownDimension(key: string | undefined | null): boolean {
  return SPOT_DIMENSIONS.some((d) => d.key === key);
}

/**
 * v2 `category` → 六维兜底。
 * 当前 scenic-spots 仅约十余条有 dimensions，其余只靠 category；
 * 侧栏维度筛选若只认 dimensions，会点了像没反应（筛成空集）。
 */
const CATEGORY_TO_DIMENSION: Record<string, SpotDimensionKey> = {
  lake: 'geo',
  mountain: 'geo',
  gorge: 'geo',
  desert: 'geo',
  grassland: 'nature',
  engineering: 'construct',
  architecture: 'architecture',
};

/** 解析景点有效维度：优先 dimensions，缺省时用 category 映射 */
export function resolveSpotDimensions(input: {
  dimensions?: string[] | null;
  category?: string | null;
}): string[] {
  const dims = (input.dimensions || []).filter((d): d is string => isKnownDimension(d));
  if (dims.length) return dims;
  const mapped = input.category ? CATEGORY_TO_DIMENSION[input.category] : undefined;
  return mapped ? [mapped] : [];
}

/** 点位主色：取第一个已知维度，无维度用中性灰 */
export function dimensionColor(
  dimensions?: string[] | null,
  category?: string | null,
): string {
  const list = resolveSpotDimensions({ dimensions, category });
  if (list.length) return dimensionMeta(list[0]).color;
  return UNCLASSIFIED_DIMENSION.color;
}

/** 转义后用于 AMap InfoWindow / Marker 的 HTML 片段 */
export function escHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
