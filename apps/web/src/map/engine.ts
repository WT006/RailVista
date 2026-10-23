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

export function requireTiandituTk(): string {
  const tk = (import.meta.env.VITE_TIANDITU_TK || '').trim();
  if (!tk) {
    throw new Error('未配置 VITE_TIANDITU_TK（apps/web/.env）');
  }
  return tk;
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

export function createMap(
  el: HTMLElement,
  opts: { center?: LngLat; zoom?: number; basemap?: BasemapMode } = {},
): MapHandle {
  const tk = requireTiandituTk();
  const mode: BasemapMode = opts.basemap || 'standard';
  const center = opts.center || ([104, 35] as LngLat);
  const zoom = opts.zoom ?? 5;

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
    style: buildDualBasemapStyle(tk, mode),
    center,
    zoom,
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

  const handle: MapHandle = {
    raw,
    _basemap: basemap,
    _openPopup: null,
    _basemapMode: mode,
    _tk: tk,
    _overlaySeq: 0,
    _attributionEl: attributionEl,
    destroy() {
      handle.clearInfoWindow();
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

  return handle;
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
