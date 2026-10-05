/**
 * 按 2022 规划起讫点给已落盘几何重新定向 / 缝合主链。
 *
 *   node scripts/repair-road-corridor.mjs
 *   node scripts/repair-road-corridor.mjs --key G318
 *
 * 不发明新折线：只把已有连通分量沿 from→to 轴排序，8km 内缝合城区断档。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeGaps, orderAndStitchAlongAxis, polylineM } from './lib/road-assemble.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GEOM_DIR = join(ROOT, 'data/roads/geom');
const PLAN = join(ROOT, 'data/roads/authoritative/plan-2022-national.json');
const PLACES = join(ROOT, 'data/roads/places-geo.json');

const only = process.argv.includes('--key')
  ? process.argv[process.argv.indexOf('--key') + 1]
  : null;

const plan = existsSync(PLAN)
  ? Object.fromEntries((JSON.parse(readFileSync(PLAN, 'utf8')).roads ?? []).map((r) => [r.ref, r]))
  : {};
const places = new Map();
if (existsSync(PLACES)) {
  for (const p of JSON.parse(readFileSync(PLACES, 'utf8')).places ?? []) {
    if (p.name && Number.isFinite(p.lng) && Number.isFinite(p.lat)) places.set(p.name, p);
  }
}

function lookupPlace(name) {
  if (!name) return null;
  const raw = String(name).replace(/（.*?）/g, '').trim();
  if (places.has(raw)) return places.get(raw);
  for (const [n, p] of places) {
    if (raw.startsWith(n) || n.startsWith(raw)) return p;
  }
  return null;
}

function axisOf(key, polylines) {
  const spec = plan[key];
  const fromP = spec ? lookupPlace(spec.fromPlace) : null;
  const toP = spec ? lookupPlace(spec.toPlace) : null;
  if (fromP && toP) return { from: [fromP.lng, fromP.lat], to: [toP.lng, toP.lat] };
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const pts of polylines) {
    for (const p of pts) {
      if (p[0] < minLng) minLng = p[0];
      if (p[0] > maxLng) maxLng = p[0];
      if (p[1] < minLat) minLat = p[1];
      if (p[1] > maxLat) maxLat = p[1];
    }
  }
  if (maxLng - minLng >= maxLat - minLat) {
    return { from: [maxLng, (minLat + maxLat) / 2], to: [minLng, (minLat + maxLat) / 2] };
  }
  return { from: [(minLng + maxLng) / 2, maxLat], to: [(minLng + maxLng) / 2, minLat] };
}

function haversineKm(a, b) {
  return polylineM([a, b]) / 1000;
}

const files = existsSync(GEOM_DIR)
  ? readdirSync(GEOM_DIR).filter((f) => f.endsWith('.json') && (!only || f.startsWith(only)))
  : [];

let changed = 0;
for (const f of files) {
  const path = join(GEOM_DIR, f);
  let g;
  try {
    g = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    continue;
  }
  if (!Array.isArray(g.points) || g.points.length < 2) continue;
  const polylines = [g.points, ...(Array.isArray(g.segments) ? g.segments : [])];
  const axis = axisOf(g.key ?? f.replace(/\.json$/, ''), polylines);
  const { components, stitchedGaps } = orderAndStitchAlongAxis(polylines, axis.from, axis.to, 8000);
  if (!components.length) continue;
  components.sort((a, b) => b.lengthM - a.lengthM);
  const main = components[0];
  const rest = components.slice(1).map((c) => c.points);
  const gaps = computeGaps(components);
  const totalM = components.reduce((s, c) => s + c.lengthM, 0);
  const start = main.points[0];
  const end = main.points[main.points.length - 1];
  const dFrom = haversineKm(start, axis.from);
  const dTo = haversineKm(end, axis.to);
  g.points = main.points;
  g.segments = rest;
  g.gapAnnotations = gaps;
  g.componentCount = components.length;
  g.stitchedGaps = (g.stitchedGaps ?? 0) + stitchedGaps;
  g.drawnKm = Math.round((totalM / 1000) * 10) / 10;
  g.endpointsUnverified = dFrom > 80 || dTo > 80;
  g.endpointDistanceKm = {
    from: Math.round(dFrom * 10) / 10,
    to: Math.round(dTo * 10) / 10,
  };
  const cum = [0];
  for (let i = 1; i < g.points.length; i += 1) {
    cum.push(cum[i - 1] + polylineM([g.points[i - 1], g.points[i]]) / 1000);
  }
  g.cumKm = cum.map((x) => Math.round(x * 100) / 100);
  writeFileSync(path, JSON.stringify(g));
  changed += 1;
  console.log(
    `${g.key || f}  comps ${components.length}  main ${(main.lengthM / 1000).toFixed(1)}km  ` +
      `fromΔ ${g.endpointDistanceKm.from}km toΔ ${g.endpointDistanceKm.to}km  stitch+${stitchedGaps}`,
  );
}
console.log(`repaired ${changed} / ${files.length}`);
