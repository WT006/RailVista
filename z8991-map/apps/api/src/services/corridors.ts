import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRailwayMetrics,
  haversineKm,
  projectToRailway,
  slicePolylineByOd,
} from '@railvista/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const corridorsDir = join(__dirname, '../../../../data/presets/corridors');

export type CorridorPreset = {
  id: string;
  name: string;
  osmRelation?: number;
  source: string;
  stationsHint: string[];
  railway: [number, number][];
};

export type CorridorStop = { name: string; lng?: number; lat?: number };

let cache: CorridorPreset[] | null = null;
/** 目录内 json 的最新 mtime；变更后自动重载，避免二期入库后仍命中旧缓存 */
let cacheMtimeMs = 0;

/** 测试或热更新时可清空 */
export function clearCorridorCache(): void {
  cache = null;
  cacheMtimeMs = 0;
}

function corridorsDirMtimeMs(): number {
  if (!existsSync(corridorsDir)) return 0;
  let max = 0;
  try {
    max = Math.max(max, statSync(corridorsDir).mtimeMs);
  } catch {
    /* ignore */
  }
  for (const f of readdirSync(corridorsDir).filter((x) => x.endsWith('.json'))) {
    try {
      max = Math.max(max, statSync(join(corridorsDir, f)).mtimeMs);
    } catch {
      /* ignore */
    }
  }
  return max;
}

function normalize(name: string): string {
  return name.replace(/站$/g, '').trim();
}

/** 去掉末尾方位后缀，用于区分「嘉兴」与「嘉兴南」 */
function stationStem(name: string): string {
  return normalize(name).replace(/[东西南北]$/u, '');
}

function hasDirectionSuffix(name: string): boolean {
  return /[东西南北]$/u.test(normalize(name));
}

/**
 * 站名匹配：精确 / 去「站」后相等 / 合理包含。
 * 禁止「嘉兴」≈「嘉兴南」、「杭州南」≈「杭州东」——同词干方位不同视为不同站。
 */
function namesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const sa = stationStem(na);
  const sb = stationStem(nb);
  if (sa === sb && sa.length >= 2 && na !== nb && (hasDirectionSuffix(na) || hasDirectionSuffix(nb))) {
    return false;
  }
  return na.includes(nb) || nb.includes(na);
}

/** 行程站与走廊 hints 存在「同城不同方位站」冲突（如杭州南 vs 杭州东） */
function hasDirectionalConflict(name: string, hints: string[]): boolean {
  const n = normalize(name);
  const stem = stationStem(n);
  if (stem.length < 2) return false;
  return hints.some((h) => {
    const nh = normalize(h);
    if (nh === n) return false;
    if (stationStem(nh) !== stem) return false;
    return hasDirectionSuffix(nh) || hasDirectionSuffix(n);
  });
}

function onHints(name: string, hints: string[]): boolean {
  return hints.some((h) => namesMatch(name, h));
}

export function loadCorridors(): CorridorPreset[] {
  const mtime = corridorsDirMtimeMs();
  if (cache && mtime <= cacheMtimeMs) return cache;
  if (!existsSync(corridorsDir)) {
    cache = [];
    cacheMtimeMs = mtime;
    return cache;
  }
  const files = readdirSync(corridorsDir).filter((f) => f.endsWith('.json'));
  cache = files
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(corridorsDir, f), 'utf8')) as CorridorPreset;
      return raw;
    })
    .filter((c) => c.railway?.length >= 2);
  cacheMtimeMs = mtime;
  console.log(`[corridors] loaded ${cache.length}: ${cache.map((c) => c.id).join(', ')}`);
  return cache;
}

function nearCorridor(
  corridor: CorridorPreset,
  stop: CorridorStop,
  maxKm = 35,
): boolean {
  if (stop.lng == null || stop.lat == null) return false;
  const { path, lengthKm } = buildRailwayMetrics(corridor.railway);
  if (lengthKm <= 0) return false;
  const proj = projectToRailway(path, lengthKm, stop.lng, stop.lat);
  return proj.distKm <= maxKm;
}

/** 首末站必须属于该走廊（站名或投影），避免「部分重合」误匹配京沪等干线 */
function endpointsBelong(
  corridor: CorridorPreset,
  first: CorridorStop,
  last: CorridorStop,
  hints: string[],
): boolean {
  const endOk = (stop: CorridorStop) => {
    if (onHints(stop.name, hints)) return true;
    // 杭州南 不能靠「离杭州东走廊很近」冒充沪杭高铁终点
    if (hasDirectionalConflict(stop.name, hints)) return false;
    return nearCorridor(corridor, stop, 40);
  };
  return endOk(first) && endOk(last);
}

function geoFitScore(corridor: CorridorPreset, stops: CorridorStop[]): number {
  const withCoord = stops.filter((s) => s.lng != null && s.lat != null);
  if (withCoord.length < 2) return 0;
  let near = 0;
  for (const s of withCoord) {
    if (nearCorridor(corridor, s, 35)) near += 1;
  }
  return near / withCoord.length;
}

/**
 * 按首末站归属 + 几何贴合（主）/ 站名命中（辅）匹配精品走廊。
 * 长途车经停多、站名不全在 hints 里时，仍可靠几何命中京广等干线。
 */
export function matchCorridor(
  stops: CorridorStop[],
): { corridor: CorridorPreset; score: number } | null {
  const corridors = loadCorridors();
  if (!corridors.length || stops.length < 2) return null;

  const first = stops[0];
  const last = stops[stops.length - 1];
  let best: { corridor: CorridorPreset; score: number; hit: number } | null = null;

  for (const c of corridors) {
    const hints = (c.stationsHint || []).map(normalize).filter(Boolean);
    if (hints.length < 2) continue;
    if (!endpointsBelong(c, first, last, hints)) continue;

    let hit = 0;
    for (const s of stops) {
      if (onHints(s.name, hints)) hit += 1;
    }
    const nameScore = hit / stops.length;
    const geoScore = geoFitScore(c, stops);
    const endpointsNamed = onHints(first.name, hints) && onHints(last.name, hints);
    // 综合分：几何权重大，避免「站名覆盖率」卡死长途车
    const score = geoScore * 0.65 + nameScore * 0.35;

    const accept =
      geoScore >= 0.5 ||
      (endpointsNamed && hit >= 2) ||
      (hit >= 3 && nameScore >= 0.35);

    if (!accept) continue;

    // 分数接近时优先更短走廊，避免沪杭等分段 OD 误套整条沪昆巨折线
    const shorter =
      best &&
      Math.abs(score - best.score) <= 0.05 &&
      c.railway.length < best.corridor.railway.length;
    if (
      !best ||
      score > best.score + 0.05 ||
      shorter ||
      (Math.abs(score - best.score) <= 0.05 && hit > best.hit)
    ) {
      best = { corridor: c, score, hit };
    }
  }
  return best ? { corridor: best.corridor, score: best.score } : null;
}

/** 截取后校验：多数有坐标的经停站应落在走廊附近 */
export function corridorFitsStops(
  coords: [number, number][],
  stops: CorridorStop[],
  maxKm = 40,
): boolean {
  const withCoord = stops.filter((s) => s.lng != null && s.lat != null);
  if (withCoord.length < 2 || coords.length < 2) return false;
  const { path, lengthKm } = buildRailwayMetrics(coords);
  if (lengthKm <= 0) return false;

  let near = 0;
  for (const s of withCoord) {
    const proj = projectToRailway(path, lengthKm, Number(s.lng), Number(s.lat));
    if (proj.distKm <= maxKm) near += 1;
  }
  // 长途车偶有站名/坐标偏差，过半贴合即可
  return near >= Math.ceil(withCoord.length * 0.55);
}

function resolveOdEndpoint(
  stop: CorridorStop,
  corridor: CorridorPreset,
  role: 'from' | 'to',
): { lng: number; lat: number } | null {
  const hints = (corridor.stationsHint || []).map(normalize).filter(Boolean);
  if (!hints.length || !corridor.railway?.length) {
    if (stop.lng != null && stop.lat != null && Number.isFinite(stop.lng) && Number.isFinite(stop.lat)) {
      return { lng: Number(stop.lng), lat: Number(stop.lat) };
    }
    return null;
  }
  const terminalHints =
    role === 'from'
      ? [hints[0], hints[1]].filter(Boolean)
      : [hints[hints.length - 1], hints[hints.length - 2]].filter(Boolean);
  const namedTerminal = onHints(stop.name, terminalHints);
  const railEnd =
    role === 'from' ? corridor.railway[0] : corridor.railway[corridor.railway.length - 1];

  if (stop.lng != null && stop.lat != null && Number.isFinite(stop.lng) && Number.isFinite(stop.lat)) {
    const pt = { lng: Number(stop.lng), lat: Number(stop.lat) };
    // 名称是走廊端点，但坐标偏离折线（源数据缺市区引线 / 站坐标偏差）时，改用折线端点
    // 阈值对齐 slicePolylineByOd（当前构建 25km / 源码 45km），取更严的 25 避免截取直接 null
    if (namedTerminal && !nearCorridor(corridor, { name: stop.name, ...pt }, 25)) {
      return { lng: railEnd[0], lat: railEnd[1] };
    }
    return pt;
  }
  // 缺坐标：名称命中走廊首/末枢纽时用折线端点，禁止用中间站顶替
  if (namedTerminal) {
    return { lng: railEnd[0], lat: railEnd[1] };
  }
  return null;
}

export function sliceCorridorForStops(
  corridor: CorridorPreset,
  stops: CorridorStop[],
): [number, number][] | null {
  if (stops.length < 2) return null;
  // 必须用行程真正的首末站截取；缺坐标时用走廊端点/本地库兜底，绝不用中间站顶替
  const from = resolveOdEndpoint(stops[0], corridor, 'from');
  const to = resolveOdEndpoint(stops[stops.length - 1], corridor, 'to');
  if (!from || !to) return null;

  const sliced = slicePolylineByOd(corridor.railway, from, to);
  if (!sliced || sliced.length < 2) return null;

  const stopsForFit = stops.map((s, i) => {
    if (i === 0) return { ...s, lng: from.lng, lat: from.lat };
    if (i === stops.length - 1) return { ...s, lng: to.lng, lat: to.lat };
    return s;
  });
  if (!corridorFitsStops(sliced, stopsForFit)) return null;

  const withCoord = stopsForFit.filter((s) => s.lng != null && s.lat != null);
  const stationKm = withCoord.reduce((sum, s, i) => {
    if (i === 0) return 0;
    const prev = withCoord[i - 1];
    return (
      sum +
      haversineKm(
        { lng: Number(prev.lng), lat: Number(prev.lat) },
        { lng: Number(s.lng), lat: Number(s.lat) },
      )
    );
  }, 0);
  const { lengthKm: railKm } = buildRailwayMetrics(sliced);
  if (stationKm > 80 && railKm < stationKm * 0.45) return null;

  return sliced;
}
