/**
 * 万里路书 · 精品自驾公路 —— 线路读取服务。
 *
 * 纪律：
 *   - 列表只读 _index.json（禁止遍历目录，248 走廊的历史教训）。
 *   - 详情按需读单条线路 JSON + 独立 highlights JSON。
 *   - 全部数据为构建脚本预生成（scripts/build-drive-route.mjs），运行时不抓取网络。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DriveRoute, DriveHighlight, DriveRouteLite } from '@railvista/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVE_DIR = join(__dirname, '../../../../data/presets/drive-routes');

export interface DriveIndex {
  version: number;
  updated: string;
  routes: DriveRouteLite[];
}

let indexCache: DriveIndex | null = null;

export function getDriveIndex(): DriveIndex {
  if (indexCache) return indexCache;
  const path = join(DRIVE_DIR, '_index.json');
  if (!existsSync(path)) {
    return { version: 1, updated: '', routes: [] };
  }
  indexCache = JSON.parse(readFileSync(path, 'utf8')) as DriveIndex;
  return indexCache;
}

export function getDriveRoute(id: string): DriveRoute | null {
  const lite = getDriveIndex().routes.find((r) => r.id === id);
  if (!lite) return null;
  const path = join(DRIVE_DIR, lite.file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DriveRoute;
  } catch {
    return null;
  }
}

export function getDriveHighlights(id: string): DriveHighlight[] {
  const path = join(DRIVE_DIR, `${id}.highlights.json`);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DriveHighlight[];
  } catch {
    return [];
  }
}

export function driveStats(): {
  routeCount: number;
  totalKm: number;
  highlightCount: number;
  updated: string;
} {
  const idx = getDriveIndex();
  const totalKm = idx.routes.reduce((s, r) => s + r.totalKm, 0);
  const highlightCount = idx.routes.reduce((s, r) => s + r.highlightCount, 0);
  return {
    routeCount: idx.routes.length,
    totalKm: Math.round(totalKm * 10) / 10,
    highlightCount,
    updated: idx.updated,
  };
}
