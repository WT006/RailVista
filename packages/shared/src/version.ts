/**
 * 应用版本唯一来源。
 *
 * 规则：任何一次功能/修复改动都必须同步更新 CHANGELOG.md（仓库根目录），
 * 并在需要时按 SemVer 递增这里的 APP_VERSION（小迭代递增修订号）。
 * 前端首页显示的版本号直接读取本文件，因此不会出现文档与界面不一致。
 */
export const APP_VERSION = '0.2.5';

/** 版本对应的发布/变更摘要，便于 UI 展示（与 CHANGELOG.md 首条一致） */
export const APP_VERSION_SUMMARY =
  '车次前缀专属色 + 键盘排版优化（每类车次一色，车次列表同色对应）';

/** ISO 日期：本次版本号最后一次递增的日期 */
export const APP_VERSION_DATE = '2026-09-28';

export type AppVersionInfo = {
  version: string;
  summary: string;
  date: string;
};

export function appVersionInfo(): AppVersionInfo {
  return { version: APP_VERSION, summary: APP_VERSION_SUMMARY, date: APP_VERSION_DATE };
}
