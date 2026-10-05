/**
 * 万里路书 · 全国公路旅游网 —— 公路侧景点库服务（PRD §6）。
 *
 * 数据：data/roads/roadside-spots.json（构建脚本预生成，运行时不抓网络）。
 * 加载后即建 0.05° 网格索引（spotGrid），沿程匹配只投影路线 bbox 覆盖格内
 * 的候选（PRD §5.2 性能要求：参与量压到 300~800 个，单次 <30ms）。
 *
 * 加载时同时按 CHINA_LAND_BBOX（P2-3 境外 POI 过滤）剔除境外 POI：
 *   - 防御 OSM 批量抓取时 province 误标（曾实测把 lng≈135 的伯力博物馆错放为"黑龙江"）
 *   - 防御网格候选越界命中（如途径东北三江口的路线，35km buffer 会扩到外东北）
 *   - 元信息 roadsideSpotsMeta() 暴露 droppedOob，便于前端在「数据声明」卡片告知用户
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AlongRouteOptions, AlongSpot, RoadChapter, RoadGeometryNode, RoadsideSpot } from '@railvista/shared';
import { buildSpotGrid, computeCumKm, partitionByChinaLand, spotsAlongRoute, type SpotGrid } from '@railvista/shared';

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
  /** 加载时按 CHINA_LAND_BBOX 剔除的境外 / 非法坐标 POI 数 */
  droppedOob: number;
}

let state: SpotsState | null = null;

function loadSpots(): SpotsState | null {
  if (!existsSync(SPOTS_PATH)) return null;
  const mtime = statSync(SPOTS_PATH).mtimeMs;
  if (state && state.mtime === mtime) return state;
  try {
    const file = JSON.parse(readFileSync(SPOTS_PATH, 'utf8')) as RoadsideSpotsFile;
    const raw = Array.isArray(file.spots) ? file.spots : [];
    const { kept, dropped } = partitionByChinaLand(raw);
    state = {
      mtime,
      file: { ...file, spots: kept },
      grid: buildSpotGrid(kept),
      droppedOob: dropped.length,
    };
    return state;
  } catch {
    return null;
  }
}

/** 加载后的境内 POI 列表（不含境外与非法坐标）。 */
export function getRoadsideSpots(): RoadsideSpot[] {
  return loadSpots()?.file.spots ?? [];
}

/**
 * POI 库元信息：用于前端「数据声明」卡片。
 * droppedOob 是本次进程启动时被 CHINA_LAND_BBOX 剔除的境外 POI 数；
 * OSM 批量抓取里实测常有几条到十几条，province 字段会被错放为邻国边境省。
 */
export function roadsideSpotsMeta(): {
  count: number;
  totalLoaded: number;
  droppedOob: number;
  updated: string;
  note?: string;
} {
  const s = loadSpots();
  return {
    count: s?.file.spots.length ?? 0,
    totalLoaded: (s?.file.spots.length ?? 0) + (s?.droppedOob ?? 0),
    droppedOob: s?.droppedOob ?? 0,
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
 * 沿程章节：优先按几何自带的**地名锚点**（nodes）切段，缺地名时退回 120km 里程等分。
 *
 * v0.6.5 两个关键修正（都源于实测数据缺陷，不改会写出荒谬分段）：
 *
 * 1. **量纲守卫**：历史 geom 的 `nodes[].atKm` 有两套量纲并存 ——
 *    `scripts/fill-road-place-anchors.mjs` 新写入的是 **km**，而 2026-09 之前
 *    落盘的老文件是 **米**（实测 G318 nodes 末值 1385010，而该路 drawnKm=6331.5）。
 *    直接拿来求 fromKm/toKm 会写出「0—1385010 km」。这里按 `totalKm` 做上限校验：
 *    锚点必须落在 [0, totalKm*1.35] 内（1.35 容差覆盖「官方里程 vs 主链长度」差异），
 *    否则整体丢弃 nodes、退回里程等分。
 *
 * 2. **端点守卫**：B2-1 曾因 `endpointsUnverified`（端点地名与几何首末点相距 >50km）
 *    把 nodes 整体禁用。实测干线里 208 条命中该标记，而它们的 nodes 是
 *    `fill-road-place-anchors.mjs` 沿**几何本身**反查出来的中途地名，与「起讫点声明」
 *    无关 —— 因此端点不可信不再牵连中途地名。真正的端点声明由 UI 侧
 *    「端点待核」提示单独降级处理。
 *
 * @param coords 主链坐标
 * @param totalKm 名义里程（km）
 * @param nodes 几何自带的地名锚点（可能为空、或量纲不可信）
 */
export function buildChapters(
  coords: [number, number, number?][],
  totalKm: number,
  nodes?: RoadGeometryNode[],
): RoadChapter[] {
  const usable = sanitizePlaceNodes(nodes, totalKm);
  if (usable.length >= 2) {
    const chapters: RoadChapter[] = [];
    for (let i = 1; i < usable.length; i += 1) {
      const a = usable[i - 1]!;
      const b = usable[i]!;
      if (b.atKm - a.atKm < 5) continue;
      chapters.push({
        title: `${a.name} — ${b.name}`,
        fromKm: a.atKm,
        toKm: b.atKm,
        fromSource: a.source,
        toSource: b.source,
        fromType: a.type,
        toType: b.type,
      });
    }
    if (chapters.length) return chapters;
  }
  // ── 退化：等里程窗口 ──
  //
  // v0.6.5（P0-1）：里程窗口必须**夹到主链实绘长度**。
  // `totalKm` 是全线名义里程（去重后、含未贯通的其它连通分量），而 coords 只是
  // 主链 —— 两者差距很大（G111 totalKm=2848.6 但主链仅 847.6km；G345 4094.7 vs 341.6）。
  // 原实现按 totalKm 切 120km 窗口，会切出大量**主链上根本没有点**的段：
  // 实测 G111 24 段里 16 段、G345 35 段里 32 段点不中 → 地图上「点了没反应」。
  // 夹到主链长度后，每一段都必然对应真实折线。
  const chainKm = coords.length >= 2 ? (computeCumKm(coords)[coords.length - 1] ?? 0) : 0;
  const windowTotal = chainKm > 0 ? Math.min(totalKm, chainKm) : totalKm;
  if (!(windowTotal > 0)) return [];
  const windowKm = 120;
  // v0.6.5：保留 1 位小数而非取整。极短编号（主链仅 0.1~0.5km，如 G1502 / 上海_Y101）
  // 取整会把段落塌成 `0—0`，于是 `min(0, 0.4) > max(0, 0)` 不成立 → 整段被判无高亮。
  // 实测这类文件全库有 218 个，是「无高亮段」清零后的最后一批。
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  const chapters: RoadChapter[] = [];
  for (let from = 0; from < windowTotal; from += windowKm) {
    const to = Math.min(from + windowKm, windowTotal);
    const fromKm = round1(from);
    const toKm = round1(to);
    // 零长度段一律不生成：极短编号（主链 0.04~120.04km，如 广西_S307 / 广西_S318）
    // 四舍五入后会塌成 `120—120` / `0—0`，而前端按「区间与折线求交」判定高亮，
    // 零长度段必然求交为空 → 被计入「无高亮段」。宁可不分段，也不产出坏段。
    if (toKm > fromKm) {
      chapters.push({ title: `第 ${chapters.length + 1} 段 · ${fromKm}—${toKm} km`, fromKm, toKm });
    }
    if (to >= windowTotal) break;
  }
  return chapters;
}

/** 锚点里程上限的容差系数：锚点是沿主链反查的，主链长度可能略短于名义里程 */
const NODE_KM_TOLERANCE = 1.35;
/** 相邻锚点的最小里程间隔（km），过近的锚点切出的段没有意义 */
const NODE_MIN_GAP_KM = 5;

/**
 * 过滤不可信的地名锚点：非有限值、超出里程量程、里程非单调、同名重复。
 * 返回按 atKm 升序、同名去重后的可用锚点（保留 source 字段供 UI 分级展示）。
 * @param nodes 原始锚点
 * @param totalKm 名义里程（km），用于量程校验；<=0 时跳过量程校验
 */
export function sanitizePlaceNodes(
  nodes: RoadGeometryNode[] | undefined,
  totalKm: number,
): RoadGeometryNode[] {
  if (!Array.isArray(nodes) || !nodes.length) return [];
  const limitKm = totalKm > 0 ? totalKm * NODE_KM_TOLERANCE : Infinity;
  const seen = new Set<string>();
  const out: RoadGeometryNode[] = [];
  for (const n of nodes) {
    const name = (n?.name ?? '').trim();
    const atKm = n?.atKm;
    // 名地为空 / 里程非有限 / 负里程 / 超出量程（米量纲老数据会在这里被拦下）
    if (!name || !Number.isFinite(atKm) || atKm < 0 || atKm > limitKm) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    // 历史节点无 source 字段（一律由站名兜底生成），保守标注为 'station'
    out.push({ name, atKm, type: n.type, source: n.source ?? 'station' });
  }
  out.sort((a, b) => a.atKm - b.atKm);
  // 去掉间距过近的锚点（保留每段里里程更靠后的那个，避免出现 3km 的碎段）
  const pruned: RoadGeometryNode[] = [];
  for (const n of out) {
    const last = pruned[pruned.length - 1];
    if (last && n.atKm - last.atKm < NODE_MIN_GAP_KM) {
      pruned[pruned.length - 1] = n;
      continue;
    }
    pruned.push(n);
  }
  return pruned;
}
