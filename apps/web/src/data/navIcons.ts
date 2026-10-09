import { BookOpenText, Car, Map, Ticket, TrainFront } from 'lucide-vue-next';
import type { Component } from 'vue';

/**
 * 主导航图标映射（HarmonyOS Symbol 的 Web 等价实现）。
 *
 * - 底部页签与侧边 Tab 共用同一份映射，保证两种形态图标一致（《响应式应用架构》：
 *   侧边 Tab 的导航选项继承底部 Tab）；
 * - 图标尺寸取规范默认值 24vp（《底部页签》：图标大小默认为 24×24vp）；
 * - key 与 `APP_NAV_ITEMS` 的 id 一一对应，缺省回退到 map.js 的 Map 图标。
 */
export const NAV_ICONS: Record<string, Component> = {
  rail: TrainFront,
  drive: Car,
  atlas: Map,
  ticket: Ticket,
  roadbook: BookOpenText,
};

/** 取图标组件（未知 id 回退 Map，避免渲染空档） */
export function navIcon(id: string): Component {
  return NAV_ICONS[id] ?? Map;
}
