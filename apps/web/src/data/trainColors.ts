/**
 * 车次类型前缀专属色板（单一来源）。
 *
 * 强制约束：前缀键盘字母块、车次列表色条、车次号文字三处只能从这里取色，
 * 不得硬编码（与 roadColors / ticket 色板同级纪律）。
 * 每类一个可区分色，落在深色玻璃底上均 ≥ 3:1 对比；纯数字普速用中性灰。
 */
export const TRAIN_COLORS: Record<string, string> = {
  G: '#4d9fff', // 高铁 · 蓝
  D: '#35c2a5', // 动车 · 青绿
  C: '#7fb4d8', // 城际 · 青蓝
  Z: '#9d8cf0', // 直达 · 紫
  T: '#e0915a', // 特快 · 橙
  K: '#74bd89', // 快速 · 黄绿
  L: '#8a97a8', // 临客 · 灰蓝
  S: '#6aa9f0', // 市郊 · 天蓝
  Y: '#e5769f', // 旅游 · 品红
  '': '#a3aebd', // 普速(纯数字) · 灰
};

/** 安全取色：未知前缀回落到普速灰 */
export function trainColor(prefix: string | undefined): string {
  return TRAIN_COLORS[prefix ?? ''] ?? TRAIN_COLORS[''];
}
