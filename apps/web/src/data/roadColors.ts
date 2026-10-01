/**
 * 公路等级单一色板（PRD §11.2，对标铁路 TRAIN_COLORS 的纪律）。
 *
 * 强制约束：编号徽标、地图线色、沿程景点标记三处只能从这里取色，
 * 不得出现硬编码颜色（v0.2.5 在车次配色上定下的纪律，公路版照抄）。
 */
import type { RoadClass } from '@railvista/shared';

export const ROAD_COLORS: Record<RoadClass, string> = {
  expressway: '#ffb84d', // 国家高速 · 琥珀
  national: '#4d9fff', // 普通国道 · 宇宙蓝（与 accent 同色，最重）
  provincial: '#7ee0c0', // 省道 · 青绿
  county: '#b79cff', // 县道 · 紫
  township: '#9aa7b8', // 乡道 · 灰蓝
  village: '#6b7280', // 村道 · 深灰
};

export const ROAD_CLASS_LABELS: Record<RoadClass, string> = {
  expressway: '国家高速',
  national: '普通国道',
  provincial: '省道',
  county: '县道',
  township: '乡道',
  village: '村道',
};

/** 安全取色：未知等级回落到国道蓝（避免硬编码颜色扩散到调用方） */
export function roadColor(cls: string | undefined): string {
  return ROAD_COLORS[cls as RoadClass] ?? ROAD_COLORS.national;
}

export function roadClassLabel(cls: string | undefined): string {
  return ROAD_CLASS_LABELS[cls as RoadClass] ?? '公路';
}

/** 编号前缀 → 等级（编号键盘高亮用；G+4 位与 G1~G99 为高速，见 PRD §3.2） */
export function classOfRef(ref: string): RoadClass {
  if (/^G\d{4}$/.test(ref)) return 'expressway';
  if (/^G\d{1,2}$/.test(ref)) return 'expressway';
  if (/^G\d{1,3}[WEN]?$/.test(ref)) return 'national';
  if (/^S/.test(ref)) return 'provincial';
  if (/^X/.test(ref)) return 'county';
  if (/^Y/.test(ref)) return 'township';
  if (/^C/.test(ref)) return 'village';
  return 'national';
}
