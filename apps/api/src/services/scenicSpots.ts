import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filterSpotsAlongRailway,
  type FilterSpotsOptions,
  type ScenicSpot,
  type ScenicSpotInput,
} from '@railvista/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const spotsPath = join(__dirname, '../../../../data/presets/scenic-spots.json');

type LibraryFile = {
  version?: number;
  spots?: ScenicSpotInput[];
};

let cache: ScenicSpotInput[] | null = null;
let cacheMtimeMs = 0;

export function clearScenicSpotCache(): void {
  cache = null;
  cacheMtimeMs = 0;
}

function fileMtimeMs(): number {
  if (!existsSync(spotsPath)) return 0;
  try {
    return statSync(spotsPath).mtimeMs;
  } catch {
    return 0;
  }
}

export function loadScenicSpots(): ScenicSpotInput[] {
  const mtime = fileMtimeMs();
  if (cache && mtime === cacheMtimeMs) return cache;
  if (!existsSync(spotsPath)) {
    cache = [];
    cacheMtimeMs = mtime;
    return cache;
  }
  try {
    const raw = JSON.parse(readFileSync(spotsPath, 'utf8')) as LibraryFile;
    cache = Array.isArray(raw.spots) ? raw.spots : [];
  } catch (e) {
    console.warn('[scenic] failed to load scenic-spots.json', e);
    cache = [];
  }
  cacheMtimeMs = mtime;
  return cache;
}

/**
 * 用行程折线过滤全局风景库；无命中返回 []。
 *
 * 0.1.1：结果带运行时左右侧判定（sideRuntime / sideConfidence / sideNeedsReview）。
 * `reversed` 表示本次行程方向与 `sideRefDirection` 基准相反；不传时视为同向。
 * 注意：方位以「本次车次实际行进方向」的几何判定为准，与数据里存储的 side 冲突时
 * 只降级为 low 置信度并写入原因，不会强行翻面去迁就数据。
 */
export function matchScenicSpotsForRailway(
  coords: [number, number][] | null | undefined,
  options: FilterSpotsOptions = {},
): ScenicSpot[] {
  if (!coords || coords.length < 2) return [];
  return filterSpotsAlongRailway(loadScenicSpots(), coords, options);
}
