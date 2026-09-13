import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterSpotsAlongRailway, type ScenicSpot, type ScenicSpotInput } from '@railvista/shared';

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

/** 用行程折线过滤全局风景库；无命中返回 [] */
export function matchScenicSpotsForRailway(
  coords: [number, number][] | null | undefined,
): ScenicSpot[] {
  if (!coords || coords.length < 2) return [];
  return filterSpotsAlongRailway(loadScenicSpots(), coords);
}
