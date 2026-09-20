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

/** 精品走廊均为高铁仿真轨；G/D/C 以外（K/T/Z 等）不得套用 */
export function isHsrTrainCode(trainCode?: string): boolean {
  return !!trainCode && /^[GDC]/i.test(String(trainCode).trim());
}

/**
 * 高铁走廊判定：仿真源 / 名称含高铁·高速·城际·客专 / 已知客运专线 id。
 * 普速车禁止命中此类走廊。
 * 注意：OSM 入库的「石济客专」「甬台温铁路」等 source 仅为 osm，必须靠名称或 id 识别，
 * 否则 G/D 会被 filterKind=hsr 整条跳过，地图退回站间直线并报「偏离铁路较远」。
 */
const KNOWN_HSR_CORRIDOR_IDS = new Set([
  'xiashen',
  'hanghuang',
  'hamu',
  'hainandong',
  'jingzhang',
  'zhanghu',
  'chenggui',
  'yugui',
  'yuli',
  'chuanqing',
  'zhonglao',
  'fuping',
  'yinlan',
  'lanxin',
  'hefu',
  // P0 OSM 客运专线（名称可能是「…铁路/客专」不含「高铁」字样）
  'shitai',
  'shiji',
  'hebang',
  'nanguang',
  'yuwan',
  'yongtaiwen',
  'lianzhen',
  'haqi',
  'changhui',
  // 同病：名称「…铁路」但跑 G/D/C，须进白名单（坑 #23）
  'xiangpu',
  'ganlong',
  'hutong',
  'qingyan',
  'wenfu',
  'hanyi',
  'longxia',
  'shenmao',
  'qinglian',
  'maozhan',
  'guangxiyanhai',
  'qianzhangchang',
  'huzhune',
  'musui',
  // P1
  'jiaojikezhuan',
  'guangshenchengji',
  'chengmianle',
  'ningan',
  // P0 补洞：名称「…铁路」但跑 G/D
  'heining',
  'hewu',
]);

export function isHsrCorridor(c: Pick<CorridorPreset, 'id' | 'name' | 'source'>): boolean {
  const src = String(c.source || '');
  const name = String(c.name || '');
  if (/china-hsr|hsr-rails|local-hsr-graph|simulation/i.test(src)) return true;
  if (/高铁|高速|城际|客专|客运专线/.test(name)) return true;
  if (KNOWN_HSR_CORRIDOR_IDS.has(c.id)) return true;
  return false;
}

export function isConventionalCorridor(c: Pick<CorridorPreset, 'id' | 'name' | 'source'>): boolean {
  return !isHsrCorridor(c);
}

let cache: CorridorPreset[] | null = null;
/** 目录内 json 的最新 mtime；变更后自动重载，避免二期入库后仍命中旧缓存 */
let cacheMtimeMs = 0;

/** 测试或热更新时可清空 */
export function clearCorridorCache(): void {
  cache = null;
  cacheMtimeMs = 0;
  // 延迟清路网缓存，避免循环依赖
  import('./corridorNetwork.js')
    .then((m) => m.clearCorridorNetworkCache())
    .catch(() => undefined);
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
  // 本站就是走廊站（精确命中）则不算冲突——走廊 hints 常同时含温州北/温州南
  if (hints.some((h) => normalize(h) === n)) return false;
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
  const files = readdirSync(corridorsDir).filter(
    (f) => f.endsWith('.json') && !f.startsWith('_') && !f.includes('__'),
  );
  cache = files
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(corridorsDir, f), 'utf8')) as CorridorPreset;
      return raw;
    })
    .filter((c) => c.railway?.length >= 2 && c.id && !String(c.id).includes('__'));
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

/** 是否贴近走廊折线首/末端（同城异站终点：贵阳东≈贵阳北） */
function nearCorridorTerminus(
  corridor: CorridorPreset,
  stop: CorridorStop,
  maxKm = 12,
): boolean {
  if (stop.lng == null || stop.lat == null || corridor.railway.length < 2) return false;
  const a = corridor.railway[0];
  const b = corridor.railway[corridor.railway.length - 1];
  const pt = { lng: Number(stop.lng), lat: Number(stop.lat) };
  const d0 = haversineKm({ lng: a[0], lat: a[1] }, pt);
  const d1 = haversineKm({ lng: b[0], lat: b[1] }, pt);
  return Math.min(d0, d1) <= maxKm;
}

/**
 * 首末站必须属于该走廊（站名或投影），避免「部分重合」误匹配京沪等干线。
 * 同城异站（贵阳东 vs 贵阳北）：仅当贴走廊末端且贴线时放行，避免安阳类平行站误套。
 * 非 hint 站投影阈值 15km（原 40km 过宽：上海虹桥/南通西会误套沪宁沿江并在张家港断线）。
 */
function endpointsBelong(
  corridor: CorridorPreset,
  first: CorridorStop,
  last: CorridorStop,
  hints: string[],
): boolean {
  const endOk = (stop: CorridorStop) => {
    if (onHints(stop.name, hints)) return true;
    if (hasDirectionalConflict(stop.name, hints)) {
      return nearCorridorTerminus(corridor, stop, 12) && nearCorridor(corridor, stop, 15);
    }
    return nearCorridor(corridor, stop, 15);
  };
  return endOk(first) && endOk(last);
}

function geoFitScore(corridor: CorridorPreset, stops: CorridorStop[], hints: string[]): number {
  const withCoord = stops.filter((s) => s.lng != null && s.lat != null);
  if (withCoord.length < 2) return 0;
  let near = 0;
  let eligible = 0;
  for (const s of withCoord) {
    if (hasDirectionalConflict(s.name, hints)) {
      // 终点同城异站：贴末端仍计入贴合（否则双站 OD 贵阳东会把 geoScore 打成 0）
      if (nearCorridorTerminus(corridor, s, 12) && nearCorridor(corridor, s, 15)) {
        eligible += 1;
        near += 1;
      }
      continue;
    }
    eligible += 1;
    if (nearCorridor(corridor, s, 20)) near += 1;
  }
  if (eligible < 2) return 0;
  return near / eligible;
}

/**
 * 「平行站误套」冲突比：贴走廊末端的同城异站（南通西 vs hints 南通）不计入，
 * 否则短途 OD 会被 conflictRatio≥0.2 误杀精品走廊。
 */
function directionalConflictRatio(
  stops: CorridorStop[],
  hints: string[],
  corridor?: CorridorPreset,
): number {
  if (!stops.length) return 0;
  let n = 0;
  for (const s of stops) {
    if (!hasDirectionalConflict(s.name, hints)) continue;
    if (
      corridor &&
      nearCorridorTerminus(corridor, s, 12) &&
      nearCorridor(corridor, s, 15)
    ) {
      continue;
    }
    n += 1;
  }
  return n / stops.length;
}

/** 站到走廊折线最短距离（km）；无坐标则 Infinity */
function distToCorridor(corridor: CorridorPreset, stop: CorridorStop): number {
  if (stop.lng == null || stop.lat == null || !corridor.railway?.length) return Infinity;
  const { path, lengthKm } = buildRailwayMetrics(corridor.railway);
  if (lengthKm <= 0) return Infinity;
  return projectToRailway(path, lengthKm, Number(stop.lng), Number(stop.lat)).distKm;
}

/**
 * K/T/Z 默认真普速，但部分车实际走行高铁（如 Z509 兰新高铁经西宁）。
 * 仅在强证据时放开高铁候选，避免 Z5 之类误套京广高铁：
 * - ≥2 个带方位的中间站命中该高铁 hints 且贴线（张掖西/临泽南…），或
 * - 存在「孤点」中间站：贴高铁 (&lt;8km) 却远离已选普速 (&gt;40km)（西宁 vs 兰新线河西）
 */
export function stopsEvidenceHsrOverride(
  stops: CorridorStop[],
  hsr: CorridorPreset,
  conventionalBest: CorridorPreset | null,
): boolean {
  if (!isHsrCorridor(hsr) || stops.length < 2) return false;
  const hints = (hsr.stationsHint || []).map(normalize).filter(Boolean);
  if (hints.length < 2) return false;
  if (!endpointsBelong(hsr, stops[0], stops[stops.length - 1], hints)) return false;

  const geo = geoFitScore(hsr, stops, hints);
  let directionalMids = 0;
  for (const s of stops.slice(1, -1)) {
    if (!onHints(s.name, hints)) continue;
    if (!hasDirectionSuffix(s.name)) continue;
    if (nearCorridor(hsr, s, 15)) directionalMids += 1;
  }
  if (directionalMids >= 2 && geo >= 0.6) return true;

  if (conventionalBest) {
    for (const s of stops.slice(1, -1)) {
      const dH = distToCorridor(hsr, s);
      const dC = distToCorridor(conventionalBest, s);
      if (dH < 8 && dC > 40 && geo >= 0.55) return true;
    }
  }
  return false;
}

function scoreCorridorCandidate(
  c: CorridorPreset,
  stops: CorridorStop[],
  first: CorridorStop,
  last: CorridorStop,
): { score: number; hit: number } | null {
  const hints = (c.stationsHint || []).map(normalize).filter(Boolean);
  if (hints.length < 2) return null;
  if (!endpointsBelong(c, first, last, hints)) return null;

  let hit = 0;
  for (const s of stops) {
    if (onHints(s.name, hints)) hit += 1;
  }
  const nameScore = hit / stops.length;
  const geoScore = geoFitScore(c, stops, hints);
  const conflictRatio = directionalConflictRatio(stops, hints, c);
  const endpointsNamed = onHints(first.name, hints) && onHints(last.name, hints);
  // 大量「安阳/鹤壁」类平行普速站 → 拒绝京广高铁等走廊
  if (conflictRatio >= 0.2 && hit < Math.max(3, Math.ceil(stops.length * 0.25))) {
    return null;
  }
  const score = geoScore * 0.65 + nameScore * 0.35;
  const accept =
    geoScore >= 0.5 ||
    (endpointsNamed && hit >= 2) ||
    (hit >= 3 && nameScore >= 0.35);
  if (!accept) return null;
  return { score, hit };
}

/**
 * 按首末站归属 + 几何贴合（主）/ 站名命中（辅）匹配精品走廊。
 * G/D → 仅高铁走廊；C → 高铁+普速客运（丽香等）；K/T/Z → 仅普速走廊
 * （例外：时刻表强证据表明实际走高铁时，见 stopsEvidenceHsrOverride）。
 */
export function matchCorridor(
  stops: CorridorStop[],
  opts?: { trainCode?: string },
): { corridor: CorridorPreset; score: number } | null {
  const corridors = loadCorridors();
  if (!corridors.length || stops.length < 2) return null;

  const trainCode = opts?.trainCode;
  const code = trainCode != null ? String(trainCode).trim() : '';
  /** all | hsr | conventional */
  let filterKind: 'all' | 'hsr' | 'conventional' = 'all';
  if (code) {
    // C 必须单独分支：不可写进 /^[GDC]/，否则永远走 hsr、城际走廊被跳过
    if (/^[GD]/i.test(code)) filterKind = 'hsr';
    else if (/^C/i.test(code)) filterKind = 'all'; // 城际可走客运专线或普速客运走廊
    else filterKind = 'conventional';
  }

  const first = stops[0];
  const last = stops[stops.length - 1];
  type BestHit = { corridor: CorridorPreset; score: number; hit: number };
  let best: BestHit | null = null;

  const consider = (c: CorridorPreset) => {
    const scored = scoreCorridorCandidate(c, stops, first, last);
    if (!scored) return;
    const { score, hit } = scored;
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
  };

  for (const c of corridors) {
    if (filterKind === 'hsr' && !isHsrCorridor(c)) continue;
    if (filterKind === 'conventional' && !isConventionalCorridor(c)) continue;
    consider(c);
  }

  // K/T/Z：普速命中后，若时刻表像「跑在高铁上」（西宁孤点 / 张掖西…），再比高铁候选
  if (filterKind === 'conventional') {
    const convBest = best as BestHit | null;
    for (const c of corridors) {
      if (!isHsrCorridor(c)) continue;
      if (!stopsEvidenceHsrOverride(stops, c, convBest?.corridor ?? null)) continue;
      consider(c);
    }
  }

  const winner = best as BestHit | null;
  return winner ? { corridor: winner.corridor, score: winner.score } : null;
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

  let sliced = slicePolylineByOd(corridor.railway, from, to);
  if (!sliced || sliced.length < 2) return null;

  // 枢纽站常离主线折线 0.3–几 km（郑州东/虹桥等）：把行程首末接到切片，避免站标与蓝线断连
  sliced = attachOdApproaches(sliced, from, to);

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

/** 切片端点与行程 OD 之间短引线（仅 <8km，避免假飞线） */
function attachOdApproaches(
  coords: [number, number][],
  from: { lng: number; lat: number },
  to: { lng: number; lat: number },
): [number, number][] {
  if (coords.length < 2) return coords;
  const out: [number, number][] = coords.map((c) => [c[0], c[1]]);
  const start = { lng: out[0][0], lat: out[0][1] };
  const end = { lng: out[out.length - 1][0], lat: out[out.length - 1][1] };
  const d0 = haversineKm(from, start);
  const d1 = haversineKm(to, end);
  if (d0 > 0.2 && d0 < 8) {
    out.unshift([Number(from.lng.toFixed(6)), Number(from.lat.toFixed(6))]);
  }
  if (d1 > 0.2 && d1 < 8) {
    out.push([Number(to.lng.toFixed(6)), Number(to.lat.toFixed(6))]);
  }
  return out;
}
