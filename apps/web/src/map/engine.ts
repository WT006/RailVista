/**
 * MapLibre + 天地图瓦片适配层。
 * 页面只依赖本模块，勿直接 new maplibregl.*（Atlas 聚合/热力除外的封装也在此）。
 */
import {
  AttributionControl,
  GeoJSONSource,
  LngLatBounds,
  Map as MlMapCtor,
  Marker as MlMarkerCtor,
  Popup as MlPopupCtor,
  type LngLatBoundsLike,
  type Map as MlMap,
  type Marker as MlMarker,
  type Popup as MlPopup,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Supercluster from 'supercluster';

const maplibregl = {
  Map: MlMapCtor,
  Marker: MlMarkerCtor,
  Popup: MlPopupCtor,
  LngLatBounds,
  AttributionControl,
  GeoJSONSource,
};
import { tiandituAttributionHtml } from './attribution';
import {
  applyBasemapVisibility,
  buildDualBasemapStyle,
  buildOverlayStyle,
  syncYashiGreyClass,
  type BasemapMode,
} from './tiandituStyle';
import { resolveBasemapTileSource } from './tileSource';

export type LngLat = [number, number];
export type { BasemapMode };

export interface MapHandle {
  /** 业务层 map（透明）：铁路 / 景点 / Marker / 热力画在这里，真彩 */
  raw: MlMap;
  destroy(): void;
  fitBounds(
    coords: LngLat[],
    padding?: number | { top: number; right: number; bottom: number; left: number },
    animate?: boolean,
  ): void;
  setZoomAndCenter(zoom: number, center: LngLat, animate?: boolean): void;
  setZoom(zoom: number): void;
  setCenter(center: LngLat): void;
  panTo(center: LngLat, animate?: boolean): void;
  getZoom(): number;
  getCenter(): LngLat;
  resize(): void;
  setBasemapMode(mode: BasemapMode): void;
  getBasemapMode(): BasemapMode;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  clearInfoWindow(): void;
  /** 当前打开的自定义弹窗（适配层内部跟踪） */
  _openPopup: MlPopup | null;
  _basemapMode: BasemapMode;
  _tk: string;
  _overlaySeq: number;
  _attributionEl: HTMLElement | null;
  /** 下层底图 map（瓦片 + 雅士灰滤镜）；业务代码勿直接操作 */
  _basemap: MlMap;
}

export interface PolylineOptions {
  path: LngLat[];
  color?: string;
  weight?: number;
  opacity?: number;
  dashed?: boolean;
  dashArray?: number[];
  zIndex?: number;
  id?: string;
  onClick?: () => void;
}

export interface PolylineHandle {
  id: string;
  setPath(path: LngLat[]): void;
  setStyle(opts: Partial<Pick<PolylineOptions, 'color' | 'weight' | 'opacity' | 'dashed'>>): void;
  show(): void;
  hide(): void;
  remove(): void;
  getBoundsCoords(): LngLat[];
}

export interface MarkerOptions {
  position: LngLat;
  contentHtml: string;
  zIndex?: number;
  /** CSS transform origin hint: 'center' | 'bottom' */
  anchor?: 'center' | 'bottom' | 'top';
  title?: string;
}

export interface MarkerHandle {
  setPosition(pos: LngLat): void;
  getPosition(): LngLat;
  show(): void;
  hide(): void;
  onClick(handler: () => void): void;
  setContent(html: string): void;
  remove(): void;
  /** 供 fitBounds 收集 */
  getPositionOrNull(): LngLat | null;
}

export interface InfoWindowOptions {
  contentHtml?: string;
  offsetPx?: [number, number];
  maxWidth?: number;
}

export interface InfoWindowHandle {
  setContent(html: string): void;
  open(map: MapHandle, pos: LngLat): void;
  close(): void;
}

export interface ClusterPoint {
  id: string | number;
  lng: number;
  lat: number;
  properties?: Record<string, unknown>;
}

export interface HeatPoint {
  lng: number;
  lat: number;
  weight?: number;
}

let engineReady: Promise<void> | null = null;

/** 幂等预热（MapLibre 为 npm 包，无需插 script；保留与旧 loadAmap 对称的调用点） */
export function loadMapEngine(): Promise<void> {
  if (!engineReady) {
    engineReady = Promise.resolve();
  }
  return engineReady;
}

/** @deprecated 用 resolveBasemapTileSource / basemapConfigError */
export function requireTiandituTk(): string {
  const src = resolveBasemapTileSource();
  if (src.mode === 'direct') return src.tk;
  // 代理模式前端无 Key；保留此函数以免旧调用崩掉
  return (import.meta.env.VITE_TIANDITU_TK || '').trim() || 'proxy';
}

function paddingToObj(
  padding?: number | { top: number; right: number; bottom: number; left: number },
): { top: number; right: number; bottom: number; left: number } {
  if (padding == null) return { top: 40, right: 40, bottom: 40, left: 40 };
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return padding;
}

function ensureAttribution(container: HTMLElement): HTMLElement {
  let el = container.querySelector('.rv-map-attribution') as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'rv-map-attribution';
    el.textContent = tiandituAttributionHtml();
    container.appendChild(el);
  }
  return el;
}

/** Vue/Pinia 响应式数组不能直接进 GeoJSON Worker，须打成纯坐标 */
function toPlainPath(path: LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const c of path) {
    if (!c || c.length < 2) continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    out.push([lng, lat]);
  }
  return out;
}

/**
 * 到顶之后把「放大」这条路彻底掐住。
 *
 * MapLibre 的 maxZoom 只保证最终相机不越界，手势本身仍在跑：滚轮/触控板的惯性事件
 * 会持续触发 easeTo，到顶后表现为地图在极小的区间里抖；双击也会再发起一次放大动画。
 * 这里在**捕获阶段**拦掉「向上放大」的事件（早于 MapLibre 挂在 canvas 上的监听器），
 * 到顶就是真的不动；缩小方向完全不受影响。
 *
 * 返回解绑函数，destroy 时调用。
 */
function lockZoomInAtMax(el: HTMLElement, map: MlMap, maxZoom: number): () => void {
  const atMax = () => map.getZoom() >= maxZoom - 1e-3;

  const onWheel = (ev: WheelEvent) => {
    if (ev.deltaY >= 0) return;
    if (!atMax()) return;
    ev.preventDefault();
    ev.stopPropagation();
  };
  const onDblClick = (ev: MouseEvent) => {
    if (!atMax()) return;
    ev.preventDefault();
    ev.stopPropagation();
  };
  // pinch 用两指距离判定：间距变大 = 放大，到顶就整段吞掉
  let pinchStart = 0;
  const touchDistance = (ev: TouchEvent) =>
    Math.hypot(ev.touches[0]!.clientX - ev.touches[1]!.clientX, ev.touches[0]!.clientY - ev.touches[1]!.clientY);
  const onTouchStart = (ev: TouchEvent) => {
    pinchStart = ev.touches.length === 2 ? touchDistance(ev) : 0;
  };
  const onTouchMove = (ev: TouchEvent) => {
    if (ev.touches.length !== 2 || !pinchStart) return;
    const spread = touchDistance(ev) - pinchStart;
    if (spread <= 0 || !atMax()) return;
    ev.stopPropagation();
  };

  el.addEventListener('wheel', onWheel, { capture: true, passive: false });
  el.addEventListener('dblclick', onDblClick, { capture: true });
  el.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  el.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });

  return () => {
    el.removeEventListener('wheel', onWheel, true);
    el.removeEventListener('dblclick', onDblClick, true);
    el.removeEventListener('touchstart', onTouchStart, true);
    el.removeEventListener('touchmove', onTouchMove, true);
  };
}

/**
 * 地图最大缩放。
 *
 * 天地图 vec/cva 瓦片最多到 z18，但 z15 之后屏幕里只剩街区轮廓、没有新信息
 * （注记 z10.6 起已关，站区 z15 一屏约 2.9km 足够认站点周边），
 * 再放大只是把瓦片拉大、越拉越糊，还会把街巷网格铺满整屏。
 * z14 = 5.8km / z15 = 2.9km / z16 = 1.5km（1440px 屏宽，纬度 32°）。
 */
export const MAP_MAX_ZOOM = 15;

export function createMap(
  el: HTMLElement,
  opts: {
    center?: LngLat;
    zoom?: number;
    basemap?: BasemapMode;
    /** 默认 true：在 overlay 自绘省界/境界线（底图路网淡化后补回轮廓） */
    adminBoundaries?: boolean;
    /** 默认 MAP_MAX_ZOOM（15）；传更小的值可进一步收紧 */
    maxZoom?: number;
  } = {},
): MapHandle {
  const tileSource = resolveBasemapTileSource();
  const mode: BasemapMode = opts.basemap || 'standard';
  const center = opts.center || ([104, 35] as LngLat);
  const zoom = opts.zoom ?? 5;
  const maxZoom = opts.maxZoom ?? MAP_MAX_ZOOM;
  const wantAdminBoundaries = opts.adminBoundaries !== false;

  /*
   * 双 map 叠层：底图 canvas 可安全做雅士灰滤镜（对标 amap://styles/grey）；
   * 业务层在透明 overlay 上真彩绘制。单 canvas + CSS filter 会把铁路/热力一并染色，故拆开。
   */
  el.classList.add('rv-map-stack');
  el.replaceChildren();

  const basemapEl = document.createElement('div');
  basemapEl.className = 'rv-map-basemap';
  const overlayEl = document.createElement('div');
  overlayEl.className = 'rv-map-overlay';
  el.append(basemapEl, overlayEl);

  // 与设备像素对齐，避免 canvas 本身发糊（瓦片清晰度另见 rasterTileSize）
  const pixelRatio = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 3);

  const basemap = new maplibregl.Map({
    container: basemapEl,
    style: buildDualBasemapStyle(tileSource, mode),
    center,
    zoom,
    maxZoom,
    interactive: false,
    attributionControl: false,
    pixelRatio,
  });

  // overlay 必须 alpha，否则透明 background 层仍被不透明 WebGL 背板盖住底图
  const raw = new maplibregl.Map({
    container: overlayEl,
    style: buildOverlayStyle(),
    center,
    zoom,
    maxZoom,
    attributionControl: false,
    pixelRatio,
    canvasContextAttributes: { alpha: true, antialias: true },
  });

  syncYashiGreyClass(basemapEl, mode);

  const syncBasemapCamera = () => {
    basemap.jumpTo({
      center: raw.getCenter(),
      zoom: raw.getZoom(),
      bearing: raw.getBearing(),
      pitch: raw.getPitch(),
    });
  };
  raw.on('move', syncBasemapCamera);
  raw.on('moveend', syncBasemapCamera);

  raw.addControl(
    new maplibregl.AttributionControl({
      compact: true,
      customAttribution: tiandituAttributionHtml(),
    }),
    'bottom-right',
  );

  const attributionEl = ensureAttribution(el);
  const unlockZoomIn = lockZoomInAtMax(el, raw, maxZoom);

  const handle: MapHandle = {
    raw,
    _basemap: basemap,
    _openPopup: null,
    _basemapMode: mode,
    _tk: tileSource.mode === 'direct' ? tileSource.tk : 'proxy',
    _overlaySeq: 0,
    _attributionEl: attributionEl,
    destroy() {
      handle.clearInfoWindow();
      unlockZoomIn();
      raw.off('move', syncBasemapCamera);
      raw.off('moveend', syncBasemapCamera);
      raw.remove();
      basemap.remove();
      el.classList.remove('rv-map-stack');
      el.replaceChildren();
    },
    fitBounds(coords, padding, animate = true) {
      if (!coords.length) return;
      const plain = toPlainPath(coords);
      if (!plain.length) return;
      const b = new maplibregl.LngLatBounds(plain[0], plain[0]);
      for (const c of plain) b.extend(c);
      if (b.isEmpty()) return;
      raw.fitBounds(b as LngLatBoundsLike, {
        padding: paddingToObj(padding),
        animate,
        maxZoom: 14,
      });
    },
    setZoomAndCenter(zoomNext, centerNext, animate = true) {
      if (animate) {
        raw.easeTo({ center: centerNext, zoom: zoomNext });
      } else {
        raw.jumpTo({ center: centerNext, zoom: zoomNext });
      }
    },
    setZoom(zoomNext) {
      raw.setZoom(zoomNext);
    },
    setCenter(centerNext) {
      raw.setCenter(centerNext);
    },
    panTo(centerNext, animate = true) {
      if (animate) raw.easeTo({ center: centerNext, duration: 400 });
      else raw.jumpTo({ center: centerNext });
    },
    getZoom() {
      return raw.getZoom();
    },
    getCenter() {
      const c = raw.getCenter();
      return [c.lng, c.lat];
    },
    resize() {
      raw.resize();
      basemap.resize();
      syncBasemapCamera();
    },
    setBasemapMode(next) {
      if (next === handle._basemapMode) return;
      handle._basemapMode = next;
      applyBasemapVisibility(basemap, next);
      syncYashiGreyClass(basemapEl, next);
    },
    getBasemapMode() {
      return handle._basemapMode;
    },
    on(event, handler) {
      raw.on(event as any, handler);
    },
    off(event, handler) {
      raw.off(event as any, handler);
    },
    clearInfoWindow() {
      if (handle._openPopup) {
        handle._openPopup.remove();
        handle._openPopup = null;
      }
    },
  };

  if (wantAdminBoundaries) {
    void ensureAdminBoundaries(handle);
  }

  return handle;
}

/** overlay 行政区划源/层 id（业务线通过 moveLayer 顶到上层，本层保持在底） */
const ADMIN_SRC = 'rv-admin-boundaries';
const ADMIN_PROVINCE_LAYER = 'rv-admin-province';
const ADMIN_BORDER_LAYER = 'rv-admin-border';
const ADMIN_GEOJSON_URL = '/geo/china-admin-boundaries.json';

/**
 * 天地图 vec 把路网与国界/省界烧在同一张栅格上，ROAD_FADE 压路时境界一起淡。
 * overlay 自绘：省界（淡珊瑚）+ 国土外轮廓/邻国交界（红，kind=national）。
 * 国界几何由 scripts/extract-china-national-border.mjs 合并省级面得到。
 */
async function ensureAdminBoundaries(map: MapHandle): Promise<void> {
  await waitForStyle(map);
  const raw = map.raw;
  if (raw.getSource(ADMIN_SRC)) return;

  raw.addSource(ADMIN_SRC, {
    type: 'geojson',
    data: ADMIN_GEOJSON_URL,
  });

  // 省界：淡珊瑚细线（含内陆省界；外缘会被上层红色国界盖住）
  raw.addLayer({
    id: ADMIN_PROVINCE_LAYER,
    type: 'line',
    source: ADMIN_SRC,
    filter: ['==', ['get', 'kind'], 'province'],
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
    },
    paint: {
      'line-color': '#c4786a',
      'line-opacity': 0.55,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3,
        0.6,
        6,
        0.9,
        10,
        1.2,
        13,
        1.5,
      ],
    },
  });

  // 国界：合并各省后的国土外轮廓 + 原「境界线」补段，整段红色
  raw.addLayer({
    id: ADMIN_BORDER_LAYER,
    type: 'line',
    source: ADMIN_SRC,
    filter: ['==', ['get', 'kind'], 'national'],
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
    },
    paint: {
      'line-color': '#e11d2e',
      'line-opacity': 0.9,
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3,
        1.0,
        6,
        1.4,
        10,
        1.8,
        13,
        2.2,
      ],
    },
  });

  sendAdminBoundariesToBack(raw);
}

/** 把行政区划层沉到 overlay 最底，避免盖住铁路/景点 */
function sendAdminBoundariesToBack(raw: MlMap): void {
  const layers = raw.getStyle()?.layers ?? [];
  const firstBusiness = layers.find(
    (l) => l.id !== ADMIN_PROVINCE_LAYER && l.id !== ADMIN_BORDER_LAYER,
  );
  if (!firstBusiness) return;
  try {
    if (raw.getLayer(ADMIN_PROVINCE_LAYER)) {
      raw.moveLayer(ADMIN_PROVINCE_LAYER, firstBusiness.id);
    }
    if (raw.getLayer(ADMIN_BORDER_LAYER)) {
      raw.moveLayer(ADMIN_BORDER_LAYER, firstBusiness.id);
    }
  } catch {
    /* style 尚未就绪时忽略 */
  }
}

function nextOverlayId(map: MapHandle, prefix: string): string {
  map._overlaySeq += 1;
  return `${prefix}-${map._overlaySeq}`;
}

/**
 * 样式 JSON 是否已解析、可 addSource/addLayer。
 * 禁止用 isStyleLoaded()：它会等「每一个 source 都 loaded」，
 * 全国图串行加 ~200 条线时会把后续 await 拖成数分钟，景点永远画不出来。
 */
function isStylesheetReady(raw: MlMap): boolean {
  try {
    const style = (raw as unknown as { style?: { _loaded?: boolean } }).style;
    if (style?._loaded) return true;
    const spec = raw.getStyle?.();
    return Array.isArray(spec?.layers);
  } catch {
    return false;
  }
}

function waitForStyle(map: MapHandle): Promise<void> {
  const raw = map.raw;
  if (isStylesheetReady(raw)) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      raw.off('styledata', onStyle);
      resolve();
    };
    raw.once('load', finish);
    const onStyle = () => {
      if (isStylesheetReady(raw)) finish();
    };
    raw.on('styledata', onStyle);
    // worker 异常时 load 可能永不触发，避免卡死后续 Marker
    window.setTimeout(finish, 8000);
  });
}

export interface MultiPolylineOptions extends Omit<PolylineOptions, 'path'> {
  /** 多条折线合成一个 GeoJSON source（全国路网用，避免数百次 addSource） */
  paths: LngLat[][];
}

function linePaint(opts: {
  color?: string;
  weight?: number;
  opacity?: number;
  dashed?: boolean;
  dashArray?: number[];
}) {
  return {
    'line-color': opts.color || '#3b82f6',
    'line-width': opts.weight ?? 4,
    'line-opacity': opts.opacity ?? 0.9,
    ...(opts.dashed ? { 'line-dasharray': opts.dashArray || [2, 2] } : {}),
  };
}

function bindLineLayer(
  map: MapHandle,
  opts: {
    id: string;
    sourceId: string;
    layerId: string;
    getBoundsCoords: () => LngLat[];
    setData: (data: GeoJSON.Feature | GeoJSON.FeatureCollection) => void;
    onClick?: () => void;
  },
): PolylineHandle {
  const raw = map.raw;
  const { layerId, sourceId } = opts;

  try {
    raw.moveLayer(layerId);
  } catch {
    /* ignore */
  }

  const clickHandler = opts.onClick
    ? () => {
        opts.onClick?.();
      }
    : null;
  const onEnter = () => {
    raw.getCanvas().style.cursor = 'pointer';
  };
  const onLeave = () => {
    raw.getCanvas().style.cursor = '';
  };
  if (clickHandler) {
    raw.on('click', layerId, clickHandler);
    (raw as any).on('mouseenter', layerId, onEnter);
    (raw as any).on('mouseleave', layerId, onLeave);
  }

  return {
    id: opts.id,
    setPath(next) {
      const path = toPlainPath(next);
      opts.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: path },
      });
    },
    setStyle(s) {
      if (s.color != null) raw.setPaintProperty(layerId, 'line-color', s.color);
      if (s.weight != null) raw.setPaintProperty(layerId, 'line-width', s.weight);
      if (s.opacity != null) raw.setPaintProperty(layerId, 'line-opacity', s.opacity);
      if (s.dashed != null) {
        if (s.dashed) raw.setPaintProperty(layerId, 'line-dasharray', [2, 2]);
        else raw.setPaintProperty(layerId, 'line-dasharray', undefined as any);
      }
    },
    show() {
      try {
        raw.setLayoutProperty(layerId, 'visibility', 'visible');
      } catch {
        /* ignore */
      }
    },
    hide() {
      try {
        raw.setLayoutProperty(layerId, 'visibility', 'none');
      } catch {
        /* ignore */
      }
    },
    remove() {
      try {
        if (clickHandler) {
          raw.off('click', layerId, clickHandler);
          (raw as any).off('mouseenter', layerId, onEnter);
          (raw as any).off('mouseleave', layerId, onLeave);
        }
        if (raw.getLayer(layerId)) raw.removeLayer(layerId);
        if (raw.getSource(sourceId)) raw.removeSource(sourceId);
      } catch {
        /* ignore */
      }
    },
    getBoundsCoords: opts.getBoundsCoords,
  };
}

export async function addPolyline(map: MapHandle, opts: PolylineOptions): Promise<PolylineHandle> {
  await waitForStyle(map);
  const id = opts.id || nextOverlayId(map, 'pl');
  const sourceId = `${id}-src`;
  const layerId = `${id}-layer`;
  const raw = map.raw;

  let path = toPlainPath(opts.path);
  const feature = (): GeoJSON.Feature<GeoJSON.LineString> => ({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: path,
    },
  });

  if (raw.getSource(sourceId)) {
    (raw.getSource(sourceId) as GeoJSONSource).setData(feature());
  } else {
    raw.addSource(sourceId, { type: 'geojson', data: feature() });
    raw.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: linePaint(opts),
    });
  }

  return bindLineLayer(map, {
    id,
    sourceId,
    layerId,
    onClick: opts.onClick,
    getBoundsCoords: () => path,
    setData: (data) => {
      if (data.type === 'Feature' && data.geometry.type === 'LineString') {
        path = toPlainPath(data.geometry.coordinates as LngLat[]);
      }
      const src = raw.getSource(sourceId) as GeoJSONSource | undefined;
      if (src) src.setData(data);
    },
  });
}

/** 多条折线一个 source/layer：全国示意路网用，避免数百次 addSource 卡死主线程 */
export async function addMultiPolyline(
  map: MapHandle,
  opts: MultiPolylineOptions,
): Promise<PolylineHandle> {
  await waitForStyle(map);
  const id = opts.id || nextOverlayId(map, 'mpl');
  const sourceId = `${id}-src`;
  const layerId = `${id}-layer`;
  const raw = map.raw;

  let paths = opts.paths.map((p) => toPlainPath(p)).filter((p) => p.length >= 2);
  const collection = (): GeoJSON.FeatureCollection<GeoJSON.LineString> => ({
    type: 'FeatureCollection',
    features: paths.map((coordinates) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates },
    })),
  });

  if (raw.getSource(sourceId)) {
    (raw.getSource(sourceId) as GeoJSONSource).setData(collection());
  } else {
    raw.addSource(sourceId, { type: 'geojson', data: collection() });
    raw.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: linePaint(opts),
    });
  }

  return bindLineLayer(map, {
    id,
    sourceId,
    layerId,
    onClick: opts.onClick,
    getBoundsCoords: () => paths.flat(),
    setData: (data) => {
      const src = raw.getSource(sourceId) as GeoJSONSource | undefined;
      if (src) src.setData(data);
    },
  });
}

export function addMarker(map: MapHandle, opts: MarkerOptions): MarkerHandle {
  const el = document.createElement('div');
  el.className = 'rv-map-marker';
  el.innerHTML = opts.contentHtml;
  if (opts.title) el.title = opts.title;
  if (opts.zIndex != null) el.style.zIndex = String(opts.zIndex);

  const anchor = opts.anchor || 'center';
  const marker: MlMarker = new maplibregl.Marker({
    element: el,
    anchor,
  })
    .setLngLat(opts.position)
    .addTo(map.raw);

  let visible = true;
  let pos: LngLat = [...opts.position];
  let clickHandler: (() => void) | null = null;
  const onDomClick = (e: Event) => {
    e.stopPropagation();
    clickHandler?.();
  };
  el.addEventListener('click', onDomClick);

  return {
    setPosition(p) {
      pos = [...p];
      marker.setLngLat(p);
    },
    getPosition() {
      return pos;
    },
    show() {
      visible = true;
      el.style.display = '';
    },
    hide() {
      visible = false;
      el.style.display = 'none';
    },
    onClick(handler) {
      clickHandler = handler;
    },
    setContent(html) {
      el.innerHTML = html;
    },
    remove() {
      el.removeEventListener('click', onDomClick);
      marker.remove();
    },
    getPositionOrNull() {
      return visible ? pos : null;
    },
  };
}

export function createInfoWindow(opts: InfoWindowOptions = {}): InfoWindowHandle {
  let content = opts.contentHtml || '';
  const offset = opts.offsetPx || [0, -12];
  let popup: MlPopup | null = null;

  return {
    setContent(html) {
      content = html;
      popup?.setHTML(html);
    },
    open(map, pos) {
      map.clearInfoWindow();
      popup = new maplibregl.Popup({
        // 卡片 HTML 自带 .map-info-card__close，勿再挂 MapLibre 默认 ×
        closeButton: false,
        closeOnClick: false,
        offset,
        maxWidth: opts.maxWidth ? `${opts.maxWidth}px` : '320px',
        className: 'rv-map-popup',
        anchor: 'bottom',
      })
        .setLngLat(pos)
        .setHTML(content)
        .addTo(map.raw);
      map._openPopup = popup;
      const opened = popup;
      opened.on('close', () => {
        if (map._openPopup === opened) map._openPopup = null;
      });
    },
    close() {
      popup?.remove();
      popup = null;
    },
  };
}

/** 简易聚合：supercluster + HTML Marker；zoom/move 时刷新 */
export function setCluster(
  map: MapHandle,
  points: ClusterPoint[],
  render: {
    cluster: (count: number, lng: number, lat: number, leaves: ClusterPoint[]) => string;
    leaf: (p: ClusterPoint) => string;
  },
  onLeafClick?: (p: ClusterPoint) => void,
): { clear(): void } {
  const index = new Supercluster<{ id: string | number }>({
    radius: 56,
    maxZoom: 16,
  });
  index.load(
    points.map((p) => ({
      type: 'Feature' as const,
      properties: { id: p.id, ...p.properties, __rv: p },
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    })),
  );

  let markers: MarkerHandle[] = [];

  const leafFromFeature = (f: any, lng: number, lat: number): ClusterPoint =>
    (f?.properties?.__rv || {
      id: f?.properties?.id,
      lng,
      lat,
      properties: f?.properties,
    }) as ClusterPoint;

  const refresh = () => {
    for (const m of markers) m.remove();
    markers = [];
    const b = map.raw.getBounds();
    const zoom = Math.round(map.raw.getZoom());
    const clusters = index.getClusters(
      [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      zoom,
    );
    for (const c of clusters) {
      const [lng, lat] = c.geometry.coordinates as LngLat;
      const props = c.properties as any;
      if (props.cluster) {
        const leaves = index
          .getLeaves(props.cluster_id, Math.min(props.point_count, 80))
          .map((f) => {
            const [x, y] = f.geometry.coordinates as LngLat;
            return leafFromFeature(f, x, y);
          });
        const html = render.cluster(props.point_count, lng, lat, leaves);
        const m = addMarker(map, {
          position: [lng, lat],
          contentHtml: html,
          zIndex: 50,
          anchor: 'center',
        });
        m.onClick(() => {
          const expansion = index.getClusterExpansionZoom(props.cluster_id);
          map.setZoomAndCenter(expansion, [lng, lat]);
        });
        markers.push(m);
      } else {
        const leaf = leafFromFeature({ properties: props }, lng, lat);
        const html = render.leaf(leaf);
        const m = addMarker(map, {
          position: [lng, lat],
          contentHtml: html,
          zIndex: 60,
          anchor: 'center',
        });
        if (onLeafClick) m.onClick(() => onLeafClick(leaf));
        markers.push(m);
      }
    }
  };

  const onMove = () => refresh();
  map.raw.on('moveend', onMove);
  map.raw.on('zoomend', onMove);
  if (map.raw.isStyleLoaded()) refresh();
  else map.raw.once('load', refresh);

  return {
    clear() {
      map.raw.off('moveend', onMove);
      map.raw.off('zoomend', onMove);
      for (const m of markers) m.remove();
      markers = [];
    },
  };
}

const HEAT_SOURCE = 'rv-heat-src';
const HEAT_LAYER = 'rv-heat-layer';

export async function setHeatmap(
  map: MapHandle,
  points: HeatPoint[],
  opts: { radius?: number; opacity?: number } = {},
): Promise<{ clear(): void }> {
  await waitForStyle(map);
  const raw = map.raw;
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      properties: { weight: p.weight ?? 1 },
      geometry: {
        type: 'Point',
        coordinates: [Number(p.lng), Number(p.lat)],
      },
    })),
  };

  if (raw.getSource(HEAT_SOURCE)) {
    (raw.getSource(HEAT_SOURCE) as GeoJSONSource).setData(data);
  } else {
    raw.addSource(HEAT_SOURCE, { type: 'geojson', data });
    raw.addLayer({
      id: HEAT_LAYER,
      type: 'heatmap',
      source: HEAT_SOURCE,
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 1, 1],
        'heatmap-intensity': 1,
        'heatmap-radius': opts.radius ?? 24,
        'heatmap-opacity': opts.opacity ?? 0.75,
      },
    });
  }

  return {
    clear() {
      try {
        if (raw.getLayer(HEAT_LAYER)) raw.removeLayer(HEAT_LAYER);
        if (raw.getSource(HEAT_SOURCE)) raw.removeSource(HEAT_SOURCE);
      } catch {
        /* ignore */
      }
    },
  };
}

/** 样式切换后需重挂的覆盖物：调用方监听 'style.load' */
export function onStyleReady(map: MapHandle, fn: () => void): () => void {
  const handler = () => fn();
  map.raw.on('style.load', handler);
  return () => map.raw.off('style.load', handler);
}

export { maplibregl };
