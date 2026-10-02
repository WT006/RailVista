/**
 * 应用版本唯一来源。
 *
 * 规则：任何一次功能/修复改动都必须同步更新 CHANGELOG.md（仓库根目录），
 * 并在需要时按 SemVer 递增这里的 APP_VERSION（小迭代递增修订号）。
 * 前端首页显示的版本号直接读取本文件，因此不会出现文档与界面不一致。
 */
export const APP_VERSION = '0.6.2';

/** 版本对应的发布/变更摘要，便于 UI 展示（与 CHANGELOG.md 首条一致） */
export const APP_VERSION_SUMMARY =
  '自驾页体验修复：卡片透明度对齐铁路页、沉浸光感去黄回归主题色、顶栏提升为 App 级消除模糊闪变、公路详情页按鸿蒙规范重构、地图加载超时与重试加固';

export const APP_VERSION_DATE = '2026-10-03';

export type AppVersionInfo = {
  version: string;
  summary: string;
  date: string;
};

export function appVersionInfo(): AppVersionInfo {
  return { version: APP_VERSION, summary: APP_VERSION_SUMMARY, date: APP_VERSION_DATE };
}
