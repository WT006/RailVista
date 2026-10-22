/**
 * 应用版本唯一来源。
 *
 * 规则：任何一次功能/修复改动都必须同步更新 CHANGELOG.md（仓库根目录），
 * 并在需要时按 SemVer 递增这里的 APP_VERSION（小迭代递增修订号）。
 * 前端首页显示的版本号直接读取本文件，因此不会出现文档与界面不一致。
 */
export const APP_VERSION = '0.13.0';

/** 版本对应的发布/变更摘要，便于 UI 展示（与 CHANGELOG.md 首条一致） */
export const APP_VERSION_SUMMARY =
  '四条模块联动：走完铁路/自驾提示留纪念票、下车站底栏常驻当地玩法、自驾可选路书库经典环线、存票自动点亮中国足迹';

export const APP_VERSION_DATE = '2026-10-22';

export type AppVersionInfo = {
  version: string;
  summary: string;
  date: string;
};

export function appVersionInfo(): AppVersionInfo {
  return { version: APP_VERSION, summary: APP_VERSION_SUMMARY, date: APP_VERSION_DATE };
}
