/**
 * 生成「我的中国足迹」立体地图所需的静态几何数据
 *
 * 输入：
 *   apps/web/public/geo/china-provinces.json  省级 GeoJSON（DataV.GeoAtlas，含九段线）
 *   apps/web/public/geo/city-coords.json      370 个城市坐标
 * 输出：
 *   apps/web/src/data/chinaFootprintGeom.ts
 *
 * 投影：Albers 等积圆锥（中国标准参数，中央经线 105°E，双标准纬线 25°N / 47°N）
 *   —— 该投影下中国轮廓最接近常见「雄鸡」形状，优于墨卡托（北方过度拉伸）
 *
 * 每个省输出一条 path：顶面、侧壁堆叠、省界、点击热区全部 <use> 引用同一条。
 * 侧壁不能用抽稀后的简化轮廓——折线会在凹进去的省界上「抄近路」，
 * 侧壁比顶面胖出一圈，省界处漏黑边。反正 <use> 只存一份，全精度不额外占体积。
 *
 * 用法：node scripts/gen-footprint-map.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const GEO_PATH = resolve(ROOT, 'apps/web/public/geo/china-provinces.json');
const CITY_PATH = resolve(ROOT, 'apps/web/public/geo/city-coords.json');
const OUT_PATH = resolve(ROOT, 'apps/web/src/data/chinaFootprintGeom.ts');

/** 画布设计宽度（viewBox 单位，非像素） */
const VIEW_W = 1000;
/** 画布内边距，给 3D 抬升与光晕留余量 */
const PAD = 16;
/** 侧壁堆叠层数 */
const LAYERS = 6;
/** 单层挤出厚度（viewBox 单位） */
const LAYER_STEP = 2.6;

// ── Albers 等积圆锥投影（中国标准参数） ────────────────────────────────────
const LAMBDA0 = (105 * Math.PI) / 180; // 中央经线 105°E
const PHI0 = (35 * Math.PI) / 180; // 投影原点纬线 35°N
const PHI1 = (25 * Math.PI) / 180; // 第一标准纬线 25°N
const PHI2 = (47 * Math.PI) / 180; // 第二标准纬线 47°N

const ALB_N = (Math.sin(PHI1) + Math.sin(PHI2)) / 2;
const ALB_C = Math.cos(PHI1) ** 2 + 2 * ALB_N * Math.sin(PHI1);
const ALB_RHO0 = Math.sqrt(ALB_C - 2 * ALB_N * Math.sin(PHI0)) / ALB_N;

/**
 * 经纬度 → Albers 平面坐标（y 向下为正，北在上）
 * @param {number} lng 经度
 * @param {number} lat 纬度
 */
function albers(lng, lat) {
  const lam = (lng * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const theta = ALB_N * (lam - LAMBDA0);
  const rho = Math.sqrt(ALB_C - 2 * ALB_N * Math.sin(phi)) / ALB_N;
  // 标准式 y = rho0 - rho*cos(theta) 是「北为负」，SVG 需要北在上，故取反
  return [rho * Math.sin(theta), -(ALB_RHO0 - rho * Math.cos(theta))];
}

/** 把若干环序列化为一条 SVG path（保留 1 位小数） */
function ringsToPath(rings) {
  const parts = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    let d = `M${ring[0][0].toFixed(1)} ${ring[0][1].toFixed(1)}`;
    for (let i = 1; i < ring.length; i++) {
      d += `L${ring[i][0].toFixed(1)} ${ring[i][1].toFixed(1)}`;
    }
    parts.push(`${d}Z`);
  }
  return parts.join('');
}

// ── 读数据 ────────────────────────────────────────────────────────────────
const geo = JSON.parse(readFileSync(GEO_PATH, 'utf8'));
const cityRaw = JSON.parse(readFileSync(CITY_PATH, 'utf8'));

/** 九段线：name 为空、adchar 为 JD 的要素，单独作为装饰线输出，不可点 */
const nineDashFeatures = [];
const provinceFeatures = [];
for (const f of geo.features) {
  const name = f.properties?.name ?? '';
  const adchar = f.properties?.adchar ?? '';
  if (!name || adchar === 'JD') nineDashFeatures.push(f);
  else provinceFeatures.push(f);
}

// ── 投影所有坐标，同时求整体 bbox ─────────────────────────────────────────
let minX = Infinity;
let minY = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;

/**
 * 把 GeoJSON 几何投影成 [ring, ring, ...]（已投影坐标）
 * @param geometry GeoJSON geometry
 * @param trackBbox 是否并入全局 bbox；九段线走附图，需传 false 避免把主图拉长
 * @param southSplit 若提供，位于该纬度以南的环会被移出主图，单独返回（南海诸岛）
 */
function projectGeometry(geometry, trackBbox = true, southSplit = null) {
  const rings = [];
  const southern = [];
  const pushPolygon = (poly) => {
    for (const ring of poly) {
      if (southSplit !== null) {
        let minLat = Infinity;
        for (const [, lat] of ring) if (lat < minLat) minLat = lat;
        if (minLat < southSplit) {
          southern.push(ring);
          continue;
        }
      }
      const projected = ring.map(([lng, lat]) => {
        const [x, y] = albers(lng, lat);
        if (trackBbox) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        return [x, y];
      });
      rings.push(projected);
    }
  };
  if (geometry.type === 'Polygon') pushPolygon(geometry.coordinates);
  else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) pushPolygon(poly);
  }
  return { rings, southern };
}

/** 南海诸岛岛礁剥离纬度：海南省数据含西沙/中沙/南沙共 120+ 个岛礁环，
 *  最南至 3.8°N。若并入主图会把画布纵向拉长近一倍，故按国家标准地图
 *  的表达方式，将其移入右下角「南海诸岛」附图。17.5°N 可完整保留海南本岛。 */
const SOUTH_SPLIT_LAT = 17.5;

/** 从主图剥离出来的南海岛礁（原始经纬度），稍后与九段线一起画进附图 */
const southIslandsRaw = [];

const projected = provinceFeatures.map((f) => {
  const { rings, southern } = projectGeometry(f.geometry, true, SOUTH_SPLIT_LAT);
  for (const ring of southern) southIslandsRaw.push(ring);
  return {
    name: f.properties.name,
    adcode: Number(f.properties.adcode) || 0,
    center: f.properties.center ?? f.properties.centroid ?? [0, 0],
    rings,
  };
});

// 九段线单独记录投影坐标：它位于南海（最南约北纬 3.4°），若纳入主图 bbox
// 会把画布纵向拉长近一倍，使大陆主体被压小。按国家标准地图的表达方式，
// 南海诸岛以右下角「附图」呈现，故这里先暂存原始投影坐标，稍后单独归一化。
const nineDashRingsRaw = [];
for (const f of nineDashFeatures) {
  for (const ring of projectGeometry(f.geometry, false).rings) nineDashRingsRaw.push(ring);
}

// 城市点也纳入主图 bbox 计算，避免边缘城市被裁掉
const citiesProjected = cityRaw.map((c) => {
  const [x, y] = albers(c.lng, c.lat);
  if (x < minX) minX = x;
  if (x > maxX) maxX = x;
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
  return { name: c.name, adcode: c.adcode, province: c.province, x, y };
});

// ── 归一化到 viewBox ──────────────────────────────────────────────────────
const spanX = maxX - minX;
const spanY = maxY - minY;
const usableW = VIEW_W - PAD * 2;
const scale = usableW / spanX;
const viewH = Math.round(spanY * scale + PAD * 2);

/** 投影坐标 → viewBox 坐标 */
function toView([x, y]) {
  return [(x - minX) * scale + PAD, (y - minY) * scale + PAD];
}

const provinces = projected.map((p) => {
  const viewRings = p.rings.map((r) => r.map(toView));

  const [cx, cy] = toView(albers(p.center[0], p.center[1]));

  // 外接框：金色覆层用铺满框的矩形 + clipPath 裁出省形，避免再画一遍省界
  let bx1 = Infinity;
  let by1 = Infinity;
  let bx2 = -Infinity;
  let by2 = -Infinity;
  for (const ring of viewRings) {
    for (const [x, y] of ring) {
      if (x < bx1) bx1 = x;
      if (y < by1) by1 = y;
      if (x > bx2) bx2 = x;
      if (y > by2) by2 = y;
    }
  }

  return {
    name: p.name,
    adcode: p.adcode,
    d: ringsToPath(viewRings),
    cx: Number(cx.toFixed(1)),
    cy: Number(cy.toFixed(1)),
    /** [minX, minY, maxX, maxY] */
    box: [bx1, by1, bx2, by2].map((v) => Number(v.toFixed(1))),
  };
});

// 画家算法：北（y 小）先画，南（y 大）后画，保证近处省份正确遮挡远处侧壁
provinces.sort((a, b) => a.cy - b.cy);

// ── 南海诸岛附图 ──────────────────────────────────────────────────────────
// 单独取九段线自身的 bbox，等比缩放后放進右下角的小方框，符合国家标准地图表达
const INSET_W = 96;
const INSET_PAD = 8;
let ndMinX = Infinity;
let ndMinY = Infinity;
let ndMaxX = -Infinity;
let ndMaxY = -Infinity;
for (const ring of nineDashRingsRaw) {
  for (const [x, y] of ring) {
    if (x < ndMinX) ndMinX = x;
    if (x > ndMaxX) ndMaxX = x;
    if (y < ndMinY) ndMinY = y;
    if (y > ndMaxY) ndMaxY = y;
  }
}
// 岛礁一并纳入附图 bbox，使其与九段线的相对位置保持真实
const ndIslandsRaw = southIslandsRaw.map((ring) => ring.map(([lng, lat]) => albers(lng, lat)));
for (const ring of ndIslandsRaw) {
  for (const [x, y] of ring) {
    if (x < ndMinX) ndMinX = x;
    if (x > ndMaxX) ndMaxX = x;
    if (y < ndMinY) ndMinY = y;
    if (y > ndMaxY) ndMaxY = y;
  }
}
const ndSpanX = ndMaxX - ndMinX;
const ndSpanY = ndMaxY - ndMinY;
const ndScale = (INSET_W - INSET_PAD * 2) / ndSpanX;
const insetH = Math.round(ndSpanY * ndScale + INSET_PAD * 2);
/** 附图左下角锚点，贴主图右下角 */
const INSET_X = VIEW_W - INSET_W - 10;
const INSET_Y = viewH - insetH - 10;
const ndMap = (r) =>
  r.map(([x, y]) => [
    (x - ndMinX) * ndScale + INSET_PAD,
    (y - ndMinY) * ndScale + INSET_PAD,
  ]);
const nineDash = ringsToPath(nineDashRingsRaw.map(ndMap));
/** 南海诸岛岛礁（从海南省剥离），画在附图九段线之内 */
const southIslands = ringsToPath(ndIslandsRaw.map(ndMap));
const nineDashBox = {
  x: INSET_X,
  y: INSET_Y,
  w: INSET_W,
  h: insetH,
};

const cities = citiesProjected.map((c) => {
  const [x, y] = toView([c.x, c.y]);
  return {
    name: c.name,
    adcode: c.adcode,
    province: c.province,
    x: Number(x.toFixed(1)),
    y: Number(y.toFixed(1)),
  };
});
cities.sort((a, b) => a.province.localeCompare(b.province) || a.name.localeCompare(b.name));

// ── 经纬网 + 图幅边框（装饰层）────────────────────────────────────────────
// 极淡的经纬线垫在陆地之下，给地图一层「测绘底图」的质感。
// 采样密度 2°：Albers 下经线与纬线都是曲线，两点连直线会明显走样。
const GRAT_WINDOW = { lng: [73, 135.5], lat: [15.5, 54.5] };
const GRAT_STEP = 10;
const GRAT_SAMPLE = 2;

/** 把一段经纬度折线投影成 viewBox path */
function geoPath(points) {
  return points
    .map(([lng, lat], i) => {
      const [x, y] = toView(albers(lng, lat));
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join('');
}

const graticuleLines = [];
for (let lng = Math.ceil(GRAT_WINDOW.lng[0] / GRAT_STEP) * GRAT_STEP; lng <= GRAT_WINDOW.lng[1]; lng += GRAT_STEP) {
  const pts = [];
  for (let lat = GRAT_WINDOW.lat[0]; lat <= GRAT_WINDOW.lat[1]; lat += GRAT_SAMPLE) pts.push([lng, lat]);
  graticuleLines.push(geoPath(pts));
}
for (let lat = Math.ceil(GRAT_WINDOW.lat[0] / GRAT_STEP) * GRAT_STEP; lat <= GRAT_WINDOW.lat[1]; lat += GRAT_STEP) {
  const pts = [];
  for (let lng = GRAT_WINDOW.lng[0]; lng <= GRAT_WINDOW.lng[1]; lng += GRAT_SAMPLE) pts.push([lng, lat]);
  graticuleLines.push(geoPath(pts));
}
/** 图幅边框：沿窗口四边逐点采样，是一条微微弯曲的闭合曲线 */
const framePts = [];
for (let lng = GRAT_WINDOW.lng[0]; lng <= GRAT_WINDOW.lng[1]; lng += GRAT_SAMPLE) framePts.push([lng, GRAT_WINDOW.lat[0]]);
for (let lat = GRAT_WINDOW.lat[0]; lat <= GRAT_WINDOW.lat[1]; lat += GRAT_SAMPLE) framePts.push([GRAT_WINDOW.lng[1], lat]);
for (let lng = GRAT_WINDOW.lng[1]; lng >= GRAT_WINDOW.lng[0]; lng -= GRAT_SAMPLE) framePts.push([lng, GRAT_WINDOW.lat[1]]);
for (let lat = GRAT_WINDOW.lat[1]; lat >= GRAT_WINDOW.lat[0]; lat -= GRAT_SAMPLE) framePts.push([GRAT_WINDOW.lng[0], lat]);
const graticuleFrame = `${geoPath(framePts)}Z`;

// ── 输出 TS ───────────────────────────────────────────────────────────────
const banner = `// 由 scripts/gen-footprint-map.mjs 自动生成，请勿手工编辑
// 源数据：apps/web/public/geo/china-provinces.json + city-coords.json
// 投影：Albers 等积圆锥（中央经线 105°E，双标准纬线 25°N / 47°N）
`;

const out = `${banner}
/** 立体地图 viewBox 尺寸 */
export const FOOTPRINT_VIEWBOX = { w: ${VIEW_W}, h: ${viewH} } as const;

/** 侧壁堆叠层数与单层厚度（viewBox 单位） */
export const FOOTPRINT_EXTRUDE = { layers: ${LAYERS}, step: ${LAYER_STEP} } as const;

export interface FootprintProvinceGeom {
  /** 省名，与 GeoJSON properties.name 一致，例：广东省 */
  name: string;
  /** 行政区划代码 */
  adcode: number;
  /** 省界 path（全精度）。顶面 / 侧壁堆叠 / 省界 / 点击热区都 <use> 引用这一条 */
  d: string;
  /** 省会/中心点在 viewBox 中的位置，作为金色覆层的缩放原点 */
  cx: number;
  cy: number;
  /** [minX, minY, maxX, maxY] 外接框，金色覆层用铺满框的矩形再被省形 clipPath 裁切 */
  box: [number, number, number, number];
}

export interface FootprintCityGeom {
  name: string;
  adcode: number;
  province: string;
  x: number;
  y: number;
}

/** 34 个省级行政区，已按等距视角的远近排序（北 → 南），直接顺序渲染即可正确遮挡 */
export const FOOTPRINT_PROVINCES: FootprintProvinceGeom[] = ${JSON.stringify(provinces)};

/** 370 个城市坐标（已投影到同一 viewBox） */
export const FOOTPRINT_CITIES: FootprintCityGeom[] = ${JSON.stringify(cities)};

/** 南海诸岛 · 九段线，作为装饰性描边渲染，不参与点亮与点击 */
export const FOOTPRINT_NINE_DASH =
  ${JSON.stringify(nineDash)};

/** 南海诸岛附图框在主图中的位置与尺寸 */
export const FOOTPRINT_INSET_BOX = ${JSON.stringify(nineDashBox)} as const;

/** 南海诸岛岛礁（西沙/中沙/南沙，从海南省剥离），画在附图九段线之内 */
export const FOOTPRINT_SOUTH_ISLANDS =
  ${JSON.stringify(southIslands)};

/** 经纬网：垫在陆地之下的装饰线，逐条 path（经线与纬线在 Albers 下均为曲线） */
export const FOOTPRINT_GRATICULE_LINES: string[] = ${JSON.stringify(graticuleLines)};

/** 图幅边框：经纬窗口的闭合轮廓，给地图一张「测绘底图」的边界 */
export const FOOTPRINT_GRATICULE_FRAME =
  ${JSON.stringify(graticuleFrame)};
`;

writeFileSync(OUT_PATH, out, 'utf8');

const fullLen = provinces.reduce((s, p) => s + p.d.length, 0);
console.log(`[footprint] 省 ${provinces.length} 个 · 城市 ${cities.length} 个 · 九段线 ${nineDashRingsRaw.length} 环`);
console.log(`[footprint] viewBox ${VIEW_W} x ${viewH}`);
console.log(`[footprint] 省界 path 合计 ${(fullLen / 1024).toFixed(1)} KB · 顶面与 ${LAYERS} 层侧壁共用同一份 <use> 引用`);
console.log(`[footprint] 输出 ${OUT_PATH}`);
