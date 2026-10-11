/**
 * 应用版本唯一来源。
 *
 * 规则：任何一次功能/修复改动都必须同步更新 CHANGELOG.md（仓库根目录），
 * 并在需要时按 SemVer 递增这里的 APP_VERSION（小迭代递增修订号）。
 * 前端首页显示的版本号直接读取本文件，因此不会出现文档与界面不一致。
 */
export const APP_VERSION = '0.10.0';

/** 版本对应的发布/变更摘要，便于 UI 展示（与 CHANGELOG.md 首条一致） */
export const APP_VERSION_SUMMARY =
  '自驾线两处重构：跨省 OD 走通本地公路网 A*（不再是两点直线）；公路景点库重建为 3.7 万条高德运营数据，补齐方位/评分/开放时间/到达方式';

export const APP_VERSION_DATE = '2026-10-12';

export type AppVersionInfo = {
  version: string;
  summary: string;
  date: string;
};

export function appVersionInfo(): AppVersionInfo {
  return { version: APP_VERSION, summary: APP_VERSION_SUMMARY, date: APP_VERSION_DATE };
}
