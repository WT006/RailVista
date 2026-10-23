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

function wmtsUrl(layer: 'vec' | 'cva' | 'img' | 'cia', tk: string): string {
  return (
    `https://t{s}.tianditu.gov.cn/${layer}_w/wmts` +
    `?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default` +
    `&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}` +
    `&tk=${encodeURIComponent(tk)}`
  );
}

/**
 * 天地图公开 WMTS 只有 256px 瓦片、无 @2x。
 * Retina 上若 tileSize=256，一张图要拉满 2× 物理像素 → 发糊。
 * dpr≥1.5 时用 128：引擎多请求约一级瓦片，256 贴图对齐物理像素（费带宽换清晰）。
 */
function rasterTileSize(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return dpr >= 1.5 ? 128 : 256;
}

function rasterSource(layer: 'vec' | 'cva' | 'img' | 'cia', tk: string, maxzoom = 18) {
  return {
    type: 'raster' as const,
    tiles: SUBDOMAINS.map((s) => wmtsUrl(layer, tk).replace('{s}', s)),
    tileSize: rasterTileSize(),
    attribution: TIANDITU_SOURCE_LABEL,
    maxzoom,
  };
}

/**
 * 注记（地名）分三档，与 Atlas 公路 LOD 对齐：
 * - 全国/大区视角（< hideBelow）完全关掉，给景点·路线留空；
 * - 中段（fullAt 以上）全开；
 * - 中高倍（dimFrom 以上）收到 0：天地图把市/县/乡镇/街道/POI 画在同一张注记瓦片上，
 *   栅格没法只留「大名字」，所以高倍一律收起，免得满屏小地名。
 *
 * 天地图注记按 zoom 预渲染：z8 只有市/县名，z9 起乡镇，z10 起街道，z12 起 POI。
 */
export const ANNOTATION_FADE = {
  hideBelow: 5.2,
  fullAt: 6.4,
  dimFrom: 9.5,
  dimTo: 10.6,
  /** 淡出后的不透明度：0 = 高倍不再显示底图地名 */
  dimLevel: 0,
} as const;

/** 注记层 raster-opacity：zoom 表达式，无需 JS 监听 */
function annotationOpacityPaint(): NonNullable<
  Extract<StyleSpecification['layers'][number], { type: 'raster' }>['paint']
> {
  return {
    'raster-opacity': [
      'interpolate',
      ['linear'],
      ['zoom'],
      ANNOTATION_FADE.hideBelow,
      0,
      ANNOTATION_FADE.fullAt,
      1,
      ANNOTATION_FADE.dimFrom,
      1,
      ANNOTATION_FADE.dimTo,
      ANNOTATION_FADE.dimLevel,
    ],
  };
}

/**
 * 注记收到 0 之后这层就没内容了：把 maxzoom 卡在淡出点，
 * 让 MapLibre 认为该 source 在高倍不可用（`Layer.isHidden(zoom)` 参与 source 的 used 判定），
 * 顺带省掉高倍时的注记瓦片请求。
 */
const ANNOTATION_MAXZOOM = ANNOTATION_FADE.dimLevel === 0 ? ANNOTATION_FADE.dimTo : 18;

/**
 * 道路分级（raster 天地图只能「整级换档」，做不到按道路等级过滤）。
 *
 * 天地图 vec 瓦片按 zoom 预渲染泛化：
 *   z9   = 高速 + 国道（无县道、无城区路网）
 *   z10  = 加县道
 *   z11+ = 加城区路网、地铁、街巷
 * 因此在最杂的中段（from → until）改用 capZoom 的瓦片放大（overzoom），
 * 一次性把细小道路滤掉，只保留高速/国道骨架；贴到站区级别（until 以上）再回真实级别。
 *
 * 代价：中段是 2×–4× 放大的软边（暗色细线下几乎看不出）；
 * 关闭 enabled 即回退到原始单档行为。
 */
export const ROAD_LOD = {
  enabled: true,
  /** 降档取用的瓦片级别：只留高速/国道 */
  capZoom: 9,
  /** 从该 zoom 起降档 */
  from: 10,
  /** 到该 zoom 起恢复真实级别（贴近看站区需要街道参照） */
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
 * 没有独立图层可调——想让「界线」比「路」更重，只能把界线从底图里拿出来自绘。
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

function vecLayers(stdVis: Visibility): RasterLayer[] {
  const paint = vecOpacityPaint();
  const base = { type: 'raster' as const, layout: { visibility: stdVis }, paint };
  if (!ROAD_LOD.enabled) {
    return [{ id: `${STD}vec`, source: `${STD}vec`, minzoom: 0, maxzoom: 18, ...base }];
  }
  return [
    { id: `${STD}vec`, source: `${STD}vec`, minzoom: 0, maxzoom: ROAD_LOD.from, ...base },
    { id: `${STD}vec-lo`, source: `${STD}vec-lo`, minzoom: ROAD_LOD.from, maxzoom: ROAD_LOD.until, ...base },
    { id: `${STD}vec-hi`, source: `${STD}vec`, minzoom: ROAD_LOD.until, maxzoom: 18, ...base },
  ];
}

/**
 * 仅底图瓦片（供下层 basemap map 使用）。
 * 雅士灰滤镜只加在该 map 的 canvas 上，见 map.css `.rv-map-basemap`。
 */
export function buildDualBasemapStyle(tk: string, mode: BasemapMode = 'standard'): StyleSpecification {
  const stdVis: Visibility = mode === 'standard' ? 'visible' : 'none';
  const satVis: Visibility = mode === 'satellite' ? 'visible' : 'none';
  const annPaint = annotationOpacityPaint();
  const sources: Record<string, ReturnType<typeof rasterSource>> = {
    [`${STD}vec`]: rasterSource('vec', tk),
    [`${STD}cva`]: rasterSource('cva', tk),
    [`${SAT}img`]: rasterSource('img', tk),
    [`${SAT}cia`]: rasterSource('cia', tk),
  };
  if (ROAD_LOD.enabled) {
    // 同层第二条 source：maxzoom 卡在 capZoom，z>capZoom 由引擎放大该级瓦片
    sources[`${STD}vec-lo`] = rasterSource('vec', tk, ROAD_LOD.capZoom);
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
      ...vecLayers(stdVis),
      {
        id: `${STD}cva`,
        type: 'raster',
        source: `${STD}cva`,
        layout: { visibility: stdVis },
        minzoom: 0,
        maxzoom: ANNOTATION_MAXZOOM,
        paint: annPaint,
      },
      { id: `${SAT}img`, type: 'raster', source: `${SAT}img`, layout: { visibility: satVis }, minzoom: 0, maxzoom: 18 },
      {
        id: `${SAT}cia`,
        type: 'raster',
        source: `${SAT}cia`,
        layout: { visibility: satVis },
        minzoom: 0,
        maxzoom: ANNOTATION_MAXZOOM,
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
export function buildStandardStyle(tk: string): StyleSpecification {
  return buildDualBasemapStyle(tk, 'standard');
}

/** @deprecated 用 buildDualBasemapStyle */
export function buildSatelliteStyle(tk: string): StyleSpecification {
  return buildDualBasemapStyle(tk, 'satellite');
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
