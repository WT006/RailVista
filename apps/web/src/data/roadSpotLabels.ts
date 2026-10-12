/**
 * 沿程景点分类中文标签（列表卡片 / 全屏地图气泡 / 即将到达 三处共用一份）。
 *
 * 为什么要抽出来：这三处曾各写一份 `categoryLabel`，只有卡片版带子类中文映射，
 * 于是地图气泡里会露出 `viewpoint.landmark` 这种原始英文码。
 * 枚举口径与 data/roads/roadside-spots.json 的 `category` 字段严格一致
 * （`dim.sub` 两段式，dim/sub 都是封闭集合，扩充前先跑
 * `node -e "…统计 category 分布…"` 核对实际取值）。
 *
 * 未知取值不猜：原样回显英文码，便于发现数据侧新增了未登记的枚举。
 */

export const SPOT_DIM_LABEL: Record<string, string> = {
  nature: '自然',
  culture: '人文',
  engineering: '工程',
  viewpoint: '观景',
  experience: '体验',
  service: '服务',
};

export const SPOT_SUB_LABEL: Record<string, string> = {
  // 自然
  mountain: '山地',
  canyon: '峡谷',
  glacier: '冰川瀑布',
  lake: '湖泊河流',
  river: '河流',
  wetland: '湿地',
  forest: '森林',
  grassland: '草原',
  desert: '沙漠',
  // 人文
  'ancient-town': '古镇',
  village: '村寨',
  temple: '寺庙道观',
  heritage: '古迹',
  red: '红色',
  ruin: '遗址',
  // 工程
  bridge: '桥梁',
  pass: '垭口',
  tunnel: '隧道',
  dam: '水利枢纽',
  'spiral-road': '盘山公路',
  'service-area': '服务区',
  // 观景
  landmark: '地标',
  'scenic-byway': '沿路风景',
  'observation-deck': '观景台',
  sunrise: '日出观景',
  // 体验
  'hot-spring': '温泉',
};

/** `viewpoint.landmark` → `观景 · 地标`；未知段原样回显 */
export function spotCategoryLabel(category: string | undefined): string {
  if (!category) return '';
  const [dim, sub] = category.split('.');
  const dimText = SPOT_DIM_LABEL[dim] ?? dim;
  if (!sub) return dimText;
  return `${dimText} · ${SPOT_SUB_LABEL[sub] ?? sub}`;
}