/**
 * 小确幸分类色板（单一来源）。
 *
 * 驱动三处：分类色条、卡片左侧色条、地图标记 —— 改色只改这一处。
 * 参照 TRAIN_COLORS 的同构做法：Record<分类, hex>，落在 Cinematic Ink 深色玻璃底上均 ≥ 3:1 对比。
 */

export const HIGHLIGHT_COLORS: Record<string, string> = {
  viewpoint: '#4d9fff', // 观景 · 蓝
  landform: '#e0915a', // 地貌 · 橙
  roadside: '#e0b155', // 路边奇观 · 琥珀
  engineering: '#7fb4d8', // 大国工程 · 青蓝
  water: '#35c2a5', // 水景 · 青绿
  pasture: '#74bd89', // 草原 · 黄绿
  village: '#e5769f', // 村落 · 品红
  ruin: '#9d8cf0', // 遗址 · 紫
  plant: '#6cc27f', // 植被 · 绿
  night: '#6aa9f0', // 星空 · 天蓝
  food: '#e0765c', // 美食 · 珊瑚
  curve: '#8a97a8', // 驾驶乐趣 · 灰蓝
};

export const HIGHLIGHT_LABELS: Record<string, string> = {
  viewpoint: '观景',
  landform: '地貌',
  roadside: '路边奇观',
  engineering: '大国工程',
  water: '水景',
  pasture: '草原',
  village: '村落',
  ruin: '遗址',
  plant: '植被',
  night: '星空',
  food: '美食',
  curve: '驾驶乐趣',
};

export function highlightColor(category: string): string {
  return HIGHLIGHT_COLORS[category] ?? '#a3aebd';
}

export function highlightLabel(category: string): string {
  return HIGHLIGHT_LABELS[category] ?? category;
}
