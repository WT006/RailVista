import type { StyleSpecification } from 'maplibre-gl';
import { TIANDITU_SOURCE_LABEL } from './attribution';

export type BasemapMode = 'standard' | 'satellite';

const SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7'] as const;

/**
 * 图层 id 前缀：切底图时按前缀批量开关。
 * 道路分档会新增/减少 std-* 图层，用前缀判定可避免维护一份易失配的 id 名单。
 */
const STD = 'std-';
const SAT = 'sat-';

/**
 * 底图 map 浅灰背景：经雅士灰滤镜反相后贴近旧高德 grey 陆面（≈#1a1c22）。
 * 业务图层在透明 overlay map 上绘制，不受滤镜影响。
 */
export const MAP_STYLE_BG = '#e8ecf1';

export type TileLayerId = 'vec' | 'cva' | 'img' | 'cia';

/** 直连天地图（开发兜底；Key 会暴露在浏览器） */
function wmtsDirectUrl(layer: TileLayerId, tk: string): string {
  return (
    `https://t{s}.tianditu.gov.cn/${layer}_w/wmts` +
    `?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default` +
    `&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}` +
    `&tk=${encodeURIComponent(tk)}`
  );
}

/** 走 BFF 反代缓存：/api/map-tiles/{layer}/{z}/{y}/{x} */
function wmtsProxyUrl(layer: TileLayerId, base: string): string {
  const root = base.replace(/\/$/, '');
  return `${root}/${layer}/{z}/{y}/{x}`;
}

export type BasemapTileSource =
  | { mode: 'proxy'; baseUrl: string }
  | { mode: 'direct'; tk: string };

/**
 * 天地图公开 WMTS 只有 256px 瓦片、无 @2x。
 * Retina 上若 tileSize=256，一张图要拉满 2× 物理像素 → 发糊。
 * dpr≥1.5 时用 128：引擎多请求约一级瓦片，256 贴图对齐物理像素（费带宽换清晰）。
 */
function rasterTileSize(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return dpr >= 1.5 ? 128 : 256;
}

/**
 * 瓦片级 = 屏幕 zoom + log2(512 / tileSize)：
 * tileSize 256 深 1 级，128 深 2 级。
 *
 * 这条换算是整张地图「信息量对不上」的根因所在：
 * 天地图的注记和道路是按**瓦片级**预渲染的（z9 出乡镇、z10 出县道、z12 出 POI），
 * 而 style 里的 ['zoom'] 表达式算的是**屏幕 zoom**。
 * 早先按屏幕 zoom 设阈值，等于用「浅档的视图」去调「深档的内容」——
 * 2× 屏（tileSize 128）下屏幕 zoom 6.6 实际已经在看 z8.6 的瓦片，
 * 所以视角还很大就冒出一屏乡镇名。
 *
 * 下面所有注记/换档阈值都写成「内容级 contentZoom」，构建 style 时再减掉这个偏移。
 */
function tileZoomOffset(): number {
  return Math.round(Math.log2(512 / rasterTileSize()));
}

function rasterSource(layer: TileLayerId, src: BasemapTileSource, maxzoom = 18) {
  const tiles =
    src.mode === 'proxy'
      ? [wmtsProxyUrl(layer, src.baseUrl)]
      : SUBDOMAINS.map((s) => wmtsDirectUrl(layer, src.tk).replace('{s}', s));
  return {
    type: 'raster' as const,
    tiles,
    tileSize: rasterTileSize(),
    attribution: TIANDITU_SOURCE_LABEL,
    maxzoom,
  };
}

/**
 * 注记（地名）曲线。**横轴是瓦片级 contentZoom**（构建 style 时减去 tileZoomOffset）。
 *
 * 天地图注记按瓦片级预渲染：z8 = 市/县，z9 起冒乡镇，z10 起街道，z12 起 POI——
 * 一张图上没法只要「县」不要「镇」，所以只能「越放大、字越多、整体越淡」：
 * 让地名随缩放单调增加（符合看地图的直觉），但每上一档密度就压一次，
 * 免得高档位的乡镇/街道名把铁路和路线盖住。
 */
export const ANNOTATION_FADE = {
  /** [contentZoom, raster-opacity] */
  stops: [
    [5.6, 0],
    [6.2, 0.95],
    [8.4, 0.95],
    [9.2, 0.6],
    [11, 0.55],
    [15, 0.5],
  ],
} as const;

/**
 * 注记层 raster-opacity：把 contentZoom 阈值换算成屏幕 zoom 的表达式。
 * offset = log2(512 / tileSize)，见 tileZoomOffset()。
 */
function annotationOpacityPaint(offset: number): NonNullable<
  Extract<StyleSpecification['layers'][number], { type: 'raster' }>['paint']
> {
  const stops: Array<number | string> = [];
  for (const [contentZoom, opacity] of ANNOTATION_FADE.stops) {
    stops.push(Math.round((contentZoom - offset) * 100) / 100, opacity);
  }
  return {
    'raster-opacity': ['interpolate', ['linear'], ['zoom'], ...stops],
  } as NonNullable<RasterLayer['paint']>;
}


/**
 * 道路分级（raster 天地图只能「整级换档」，做不到按道路等级过滤）。
 *
 * 天地图 vec 瓦片按瓦片级预渲染泛化：
 *   z9   = 高速 + 国道（无县道、无城区路网）
 *   z10  = 加县道
 *   z11+ = 加城区路网、地铁、街巷
 * 所以瓦片级一旦要到 z10（会带县道），就改取 capZoom 的瓦片放大（overzoom），
 * 只保留高速/国道骨架；屏幕贴到站区级别（until 以上）再回真实级别。
 *
 * 代价：中段是 2×–4× 放大的软边（暗色细线下几乎看不出）；
 * 关闭 enabled 即回退到原始单档行为。
 */
export const ROAD_LOD = {
  enabled: true,
  /** 降档取用的瓦片级：只留高速/国道 */
  capZoom: 9,
  /** 瓦片级达到该值（天地图 z10 起加县道）就开始降档 */
  fromContent: 10,
  /** 屏幕 zoom 到这一档恢复真实级别（贴近看站区需要街道参照） */
  until: 12.5,
} as const;

/**
 * 路网按「屏幕上的密度」渐进显影，而不是一直全亮：
 * - 广域视角（z5–8）一屏要铺下整个省/大区，高速+国道会织成一整张网，
 *   压到 0.25–0.55 只当纹理，省界/水系/城市名才是主体的轮廓；
 * - 越放大屏幕里剩下的路越少，才让它逐步立起来（z10.5 到 0.95），
 *   「紫色高速、橙色国道」以及国界/省界这些细线都在这个档位才真正看得清；
 * - z≥12.5 街巷回到原生瓦片、密度又上去，再压回 0.6。
 *
 * 注意：天地图 vec 是一张烧好的栅格，路网、国界/省界、水系全在同一张图上，
 * 没有独立图层可调——想让「界线」比「路」更重，只能把界线从底图里拿出来自绘
 *（见 engine.ts `ensureAdminBoundaries` + `/geo/china-admin-boundaries.json`）。
 */
export const ROAD_FADE = {
  /** [zoom, raster-opacity] */
  stops: [
    [5, 0.25],
    [7, 0.36],
    [8.5, 0.55],
    [10.5, 0.95],
    [12.4, 0.95],
    [13.6, 0.6],
  ],
} as const;

type RasterLayer = Extract<StyleSpecification['layers'][number], { type: 'raster' }>;
type Visibility = 'visible' | 'none';

/** 底图线网的不透明度：zoom 表达式，低倍淡成纹理、放大才立起来 */
function vecOpacityPaint() {
  return {
    'raster-opacity': [
      'interpolate',
      ['linear'],
      ['zoom'],
      ...ROAD_FADE.stops.flat(),
    ],
  } as NonNullable<RasterLayer['paint']>;
}

function vecLayers(stdVis: Visibility, offset: number): RasterLayer[] {
  const paint = vecOpacityPaint();
  const base = { type: 'raster' as const, layout: { visibility: stdVis }, paint };
  if (!ROAD_LOD.enabled) {
    return [{ id: `${STD}vec`, source: `${STD}vec`, minzoom: 0, maxzoom: 18, ...base }];
  }
  // 内容级阈值换算成屏幕 zoom，才能和 source 的瓦片级 maxzoom 对上
  const from = Math.max(0, ROAD_LOD.fromContent - offset);
  return [
    { id: `${STD}vec`, source: `${STD}vec`, minzoom: 0, maxzoom: from, ...base },
    { id: `${STD}vec-lo`, source: `${STD}vec-lo`, minzoom: from, maxzoom: ROAD_LOD.until, ...base },
    { id: `${STD}vec-hi`, source: `${STD}vec`, minzoom: ROAD_LOD.until, maxzoom: 18, ...base },
  ];
}

/**
 * 仅底图瓦片（供下层 basemap map 使用）。
 * 雅士灰滤镜只加在该 map 的 canvas 上，见 map.css `.rv-map-basemap`。
 */
export function buildDualBasemapStyle(
  tileSource: BasemapTileSource,
  mode: BasemapMode = 'standard',
): StyleSpecification {
  const stdVis: Visibility = mode === 'standard' ? 'visible' : 'none';
  const satVis: Visibility = mode === 'satellite' ? 'visible' : 'none';
  const offset = tileZoomOffset();
  const annPaint = annotationOpacityPaint(offset);
  const sources: Record<string, ReturnType<typeof rasterSource>> = {
    [`${STD}vec`]: rasterSource('vec', tileSource),
    [`${STD}cva`]: rasterSource('cva', tileSource),
    [`${SAT}img`]: rasterSource('img', tileSource),
    [`${SAT}cia`]: rasterSource('cia', tileSource),
  };
  if (ROAD_LOD.enabled) {
    // 同层第二条 source：maxzoom 卡在 capZoom，瓦片级超过它就由引擎放大该级瓦片
    sources[`${STD}vec-lo`] = rasterSource('vec', tileSource, ROAD_LOD.capZoom);
  }
  return {
    version: 8,
    sources,
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': MAP_STYLE_BG },
      },
      ...vecLayers(stdVis, offset),
      {
        id: `${STD}cva`,
        type: 'raster',
        source: `${STD}cva`,
        layout: { visibility: stdVis },
        minzoom: 0,
        maxzoom: 18,
        paint: annPaint,
      },
      { id: `${SAT}img`, type: 'raster', source: `${SAT}img`, layout: { visibility: satVis }, minzoom: 0, maxzoom: 18 },
      {
        id: `${SAT}cia`,
        type: 'raster',
        source: `${SAT}cia`,
        layout: { visibility: satVis },
        minzoom: 0,
        maxzoom: 18,
        paint: annPaint,
      },
    ],
  };
}

/** 上层透明 style：铁路 / 景点 / 热力等业务层画在这里，真彩不受底图滤镜影响 */
export function buildOverlayStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': 'rgba(0,0,0,0)' },
      },
    ],
  };
}

/** @deprecated 用 buildDualBasemapStyle */
export function buildStandardStyle(tileSource: BasemapTileSource): StyleSpecification {
  return buildDualBasemapStyle(tileSource, 'standard');
}

/** @deprecated 用 buildDualBasemapStyle */
export function buildSatelliteStyle(tileSource: BasemapTileSource): StyleSpecification {
  return buildDualBasemapStyle(tileSource, 'satellite');
}

/** 按 id 前缀批量切底图：标准 = std-*，卫星 = sat-* */
export function applyBasemapVisibility(
  map: {
    getStyle(): StyleSpecification | undefined;
    setLayoutProperty(id: string, k: string, v: string): void;
  },
  mode: BasemapMode,
): void {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    const isStd = layer.id.startsWith(STD);
    const isSat = layer.id.startsWith(SAT);
    if (!isStd && !isSat) continue;
    const visible = isStd ? mode === 'standard' : mode === 'satellite';
    try {
      map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
    } catch {
      /* ignore */
    }
  }
}

/** 标准底图开雅士灰滤镜（只作用 basemap 容器，对标 amap://styles/grey）；卫星保持真彩 */
export function syncYashiGreyClass(container: HTMLElement, mode: BasemapMode): void {
  container.classList.toggle('rv-map--yashi-grey', mode === 'standard');
}
