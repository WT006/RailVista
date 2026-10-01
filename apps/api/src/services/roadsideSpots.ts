/**
 * 万里路书 · 全国公路旅游网 —— 公路侧景点库服务（PRD §6）。
 *
 * 数据：data/roads/roadside-spots.json（构建脚本预生成，运行时不抓网络）。
 * 加载后即建 0.05° 网格索引（spotGrid），沿程匹配只投影路线 bbox 覆盖格内
 * 的候选（PRD §5.2 性能要求：参与量压到 300~800 个，单次 <30ms）。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AlongRouteOptions, AlongSpot, RoadChapter, RoadGeometryNode, RoadsideSpot } from '@railvista/shared';
import { buildSpotGrid, spotsAlongRoute, type SpotGrid } from '@railvista/shared';
import { computeCumKm } from '@railvista/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPOTS_PATH = join(__dirname, '../../../../data/roads/roadside-spots.json');

export interface RoadsideSpotsFile {
  version: number;
  updated: string;
  note?: string;
  spots: RoadsideSpot[];
}

interface SpotsState {
  mtime: number;
  file: RoadsideSpotsFile;
  grid: SpotGrid;
}

let state: SpotsState | null = null;

function loadSpots(): SpotsState | null {
  if (!existsSync(SPOTS_PATH)) return null;
  const mtime = statSync(SPOTS_PATH).mtimeMs;
  if (state && state.mtime === mtime) return state;
  try {
    const file = JSON.parse(readFileSync(SPOTS_PATH, 'utf8')) as RoadsideSpotsFile;
    const spots = Array.isArray(file.spots) ? file.spots : [];
    state = { mtime, file: { ...file, spots }, grid: buildSpotGrid(spots) };
    return state;
  } catch {
    return null;
  }
}

export function getRoadsideSpots(): RoadsideSpot[] {
  return loadSpots()?.file.spots ?? [];
}

export function roadsideSpotsMeta(): { count: number; updated: string; note?: string } {
  const s = loadSpots();
  return {
    count: s?.file.spots.length ?? 0,
    updated: s?.file.updated ?? '',
    note: s?.file.note,
  };
}

/** 沿程匹配：网格候选 → filterSpotsAlongRoad（PRD §5.2/§5.3） */
export function matchSpotsAlong(
  coords: [number, number, number?][],
  opts: AlongRouteOptions = {},
): AlongSpot[] {
  const s = loadSpots();
  if (!s || coords.length < 2) return [];
  return spotsAlongRoute(s.file.spots, s.grid, coords, opts);
}

/**
 * 沿程章节：按里程窗口（默认 120km）切段；几何自带 nodes（城市/垭口）时
 * 优先用 node 位置做段界（C2 整条公路入口）。
 */
export function buildChapters(
  coords: [number, number, number?][],
  totalKm: number,
  nodes?: RoadGeometryNode[],
): RoadChapter[] {
  if (nodes && nodes.length >= 2) {
    const chapters: RoadChapter[] = [];
    for (let i = 1; i < nodes.length; i += 1) {
      const a = nodes[i - 1]!;
      const b = nodes[i]!;
      if (b.atKm - a.atKm < 5) continue;
      chapters.push({ title: `${a.name} — ${b.name}`, fromKm: a.atKm, toKm: b.atKm });
    }
    if (chapters.length) return chapters;
  }
  const windowKm = 120;
  const cum = computeCumKm(coords);
  const chapters: RoadChapter[] = [];
  for (let from = 0; from < totalKm; from += windowKm) {
    const to = Math.min(from + windowKm, totalKm);
    chapters.push({ title: `第 ${chapters.length + 1} 段 · ${Math.round(from)}—${Math.round(to)} km`, fromKm: Math.round(from), toKm: Math.round(to) });
    if (to >= totalKm) break;
  }
  return chapters;
}
