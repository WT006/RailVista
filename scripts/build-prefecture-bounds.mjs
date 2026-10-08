/**
 * 从 DataV 省级/市级 GeoJSON 抽出简化 WGS-84 地级界，供图集按真实政区归市。
 * 源数据为 GCJ-02，写入前转到 WGS-84（与 OSM 景点一致）。
 *
 *   node scripts/build-prefecture-bounds.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../apps/web/src/data/prefectureBounds.json');
const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound';

const DIRECT = new Set(['110000', '120000', '310000', '500000', '710000', '810000', '820000']);

const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function transformLat(x, y) {
  let ret = -100 + 2 * x - 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return ret;
}
function transformLng(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return ret;
}
function delta(lng, lat) {
  let dLat = transformLat(lng - 105, lat - 35);
  let dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { dLng, dLat };
}
function gcj02ToWgs84(lng, lat) {
  const { dLng, dLat } = delta(lng, lat);
  const lngWgs = lng - dLng;
  const latWgs = lat - dLat;
  const { dLng: dLng2, dLat: dLat2 } = delta(lngWgs, latWgs);
  return [lng - dLng2, lat - dLat2];
}

function shortProv(name) {
  return String(name || '')
    .replace(/维吾尔自治区|壮族自治区|回族自治区|特别行政区|自治区|省|市$/g, '')
    .trim();
}

function shortCity(name, prov) {
  let n = String(name || '').trim();
  if (!n) return '';
  n = n.replace(/特别行政区$/g, '');
  if (n === '北京市' || n === '北京') return '北京';
  if (n === '天津市' || n === '天津') return '天津';
  if (n === '上海市' || n === '上海') return '上海';
  if (n === '重庆市' || n === '重庆') return '重庆';
  n = n.replace(/市$/g, '');
  n = n.replace(
    /蒙古族藏族自治州|藏族羌族自治州|傣族景颇族自治州|布依族苗族自治州|苗族侗族自治州|土家族苗族自治州|朝鲜族自治州|哈萨克自治州|回族自治州|蒙古自治州|藏族自治州|彝族自治州|傣族自治州|白族自治州|傈僳族自治州|壮族苗族自治州|哈尼族彝族自治州$/g,
    '',
  );
  n = n.replace(/地区$/g, '');
  n = n.replace(/盟$/g, '');
  n = n.replace(/林区$/g, '');
  if (n === '恩施土家族苗族自治州') n = '恩施';
  if (prov && (n === prov || n.startsWith(prov))) {
    if (n === '吉林') return '吉林';
  }
  return n;
}

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}
function pointSegDist2(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist2(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, [a[0] + t * dx, a[1] + t * dy]);
}
function simplifyRing(ring, eps) {
  if (ring.length <= 8) return ring;
  const eps2 = eps * eps;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let maxD = 0;
    let maxK = i;
    const a = ring[i];
    const b = ring[j];
    for (let k = i + 1; k < j; k++) {
      const d = pointSegDist2(ring[k], a, b);
      if (d > maxD) {
        maxD = d;
        maxK = k;
      }
    }
    if (maxD > eps2) {
      keep[maxK] = 1;
      stack.push([i, maxK], [maxK, j]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

function ringsOf(geom) {
  if (!geom) return [];
  const out = [];
  if (geom.type === 'Polygon') out.push(geom.coordinates);
  else if (geom.type === 'MultiPolygon') out.push(...geom.coordinates);
  return out;
}

function toWgsRing(ring) {
  const pts = [];
  for (const c of ring) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const [lng, lat] = gcj02ToWgs84(Number(c[0]), Number(c[1]));
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    pts.push([Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
  }
  while (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
    pts.pop();
  }
  return pts;
}

function ringArea(ring) {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return Math.abs(a) / 2;
}

function bboxOfRings(polys) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function skipFeature(name, bbox) {
  if (!name) return true;
  if (name.includes('九段') || String(name).includes('JD')) return true;
  if (name.includes('三沙')) return true;
  const [minLng, minLat, maxLng, maxLat] = bbox;
  if (maxLng - minLng > 12 && maxLat - minLat > 8 && !/新疆|西藏|内蒙古|青海|黑龙江/.test(name)) return true;
  return false;
}

function encodePolys(polys) {
  return polys.map((poly) =>
    poly.map((ring) => {
      const flat = [];
      for (const [lng, lat] of ring) {
        flat.push(Math.round(lng * 1e4), Math.round(lat * 1e4));
      }
      return flat;
    }),
  );
}

async function main() {
  const nation = await fetchJson(`${BASE}/100000_full.json`);
  const units = [];
  const seen = new Set();

  for (const f of nation.features || []) {
    const adcode = String(f.properties?.adcode ?? '');
    const fullName = String(f.properties?.name ?? '');
    if (!adcode || adcode.includes('JD')) continue;
    const prov = shortProv(fullName);
    if (DIRECT.has(adcode)) {
      const city = shortCity(fullName, prov);
      const polys = [];
      for (const poly of ringsOf(f.geometry)) {
        const converted = poly.map(toWgsRing).filter((r) => r.length >= 3).map((r) => simplifyRing(r, 0.012));
        if (converted[0]?.length >= 3) polys.push(converted);
      }
      if (!polys.length) continue;
      const b = bboxOfRings(polys);
      if (skipFeature(fullName, b)) continue;
      const key = `${prov}|${city}`;
      if (seen.has(key)) continue;
      seen.add(key);
      units.push({
        p: prov,
        n: city,
        a: Math.round(polys.reduce((s, poly) => s + ringArea(poly[0]), 0) * 1e4) / 1e4,
        b,
        g: encodePolys(polys),
      });
      continue;
    }

    await new Promise((r) => setTimeout(r, 120));
    let cityFc;
    try {
      cityFc = await fetchJson(`${BASE}/${adcode}_full.json`);
    } catch (e) {
      console.warn('skip', adcode, fullName, e.message);
      continue;
    }
    let nAdd = 0;
    for (const cf of cityFc.features || []) {
      const cName = String(cf.properties?.name ?? '');
      const city = shortCity(cName, prov);
      if (!city) continue;
      const polys = [];
      for (const poly of ringsOf(cf.geometry)) {
        const converted = poly.map(toWgsRing).filter((r) => r.length >= 3).map((r, idx) => simplifyRing(r, idx === 0 ? 0.01 : 0.02));
        if (converted[0]?.length >= 3) polys.push(converted);
      }
      if (!polys.length) continue;
      const b = bboxOfRings(polys);
      if (skipFeature(cName, b) || skipFeature(city, b)) continue;
      const key = `${prov}|${city}`;
      if (seen.has(key)) continue;
      seen.add(key);
      units.push({
        p: prov,
        n: city,
        a: Math.round(polys.reduce((s, poly) => s + ringArea(poly[0]), 0) * 1e4) / 1e4,
        b,
        g: encodePolys(polys),
      });
      nAdd += 1;
    }
    console.log(prov, nAdd);
  }

  units.sort((x, y) => x.p.localeCompare(y.p, 'zh') || x.n.localeCompare(y.n, 'zh'));
  const json = {
    note: '图集展示用地级界（WGS-84，DataV GCJ 转写并抽稀）。不写回景点库。',
    units,
  };
  writeFileSync(OUT, JSON.stringify(json));
  const kb = Math.round(Buffer.byteLength(JSON.stringify(json)) / 1024);
  console.log('wrote', units.length, 'units', kb, 'KB', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
