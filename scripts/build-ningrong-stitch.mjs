/**
 * 宁蓉铁路：拼接既有走廊（合宁/合武/汉宜/宜万切利川/渝利）+ 西段 OSM bbox via-legs
 *   node --max-old-space-size=8192 scripts/build-ningrong-stitch.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrDir = join(root, 'data/presets/corridors');

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function load(id) {
  return JSON.parse(readFileSync(join(corrDir, `${id}.json`), 'utf8')).railway;
}

function nearestIdx(line, pt) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < line.length; i++) {
    const d = haversine(line[i], pt);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { i: best, d: bestD };
}

function appendSeg(out, seg, { fromIdx = 0, toIdx = null } = {}) {
  const i0 = fromIdx ?? 0;
  const i1 = toIdx ?? seg.length - 1;
  let pts = seg.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
  if (i0 > i1) pts = [...pts].reverse();
  if (!out.length) {
    out.push(...pts);
    return;
  }
  const gap = haversine(out.at(-1), pts[0]);
  if (gap > 25) {
    console.warn('stitch gap', gap.toFixed(1), 'km at', out.at(-1), '→', pts[0]);
  }
  out.push(...pts.slice(gap < 0.8 ? 1 : 0));
}

const 南京南 = [118.7987, 31.9689];
const 合肥南 = [117.316, 31.798];
const 汉口 = [114.2494144, 30.6216514];
const 宜昌东 = [111.4608, 30.6586];
const 利川 = [108.880932, 30.279718];
const 重庆北 = [106.461517, 29.555794];
const 成都东 = [104.120906, 30.59167];

const out = [];

// 1) 合宁 合肥南→南京南，反向成 南京南→合肥南
{
  const seg = load('heining');
  const a = nearestIdx(seg, 南京南);
  const b = nearestIdx(seg, 合肥南);
  console.log('heining snap 南京南', a.d.toFixed(2), '合肥南', b.d.toFixed(2));
  appendSeg(out, seg, { fromIdx: a.i, toIdx: b.i });
}

// 2) 合武 合肥南→汉口
{
  const seg = load('hewu');
  const a = nearestIdx(seg, 合肥南);
  const b = nearestIdx(seg, 汉口);
  console.log('hewu snap', a.d.toFixed(2), b.d.toFixed(2));
  appendSeg(out, seg, { fromIdx: a.i, toIdx: b.i });
}

// 3) 汉宜 汉口→宜昌东
{
  const seg = load('hanyi');
  const a = nearestIdx(seg, 汉口);
  const b = nearestIdx(seg, 宜昌东);
  console.log('hanyi snap', a.d.toFixed(2), b.d.toFixed(2));
  appendSeg(out, seg, { fromIdx: a.i, toIdx: b.i });
}

// 4) 宜万 宜昌东→利川（切掉万州支）
{
  const seg = load('yiwan');
  const a = nearestIdx(seg, 宜昌东);
  const b = nearestIdx(seg, 利川);
  console.log('yiwan snap 宜昌东', a.d.toFixed(2), '利川', b.d.toFixed(2), 'idx', a.i, b.i);
  appendSeg(out, seg, { fromIdx: a.i, toIdx: b.i });
}

// 5) 渝利 利川→重庆北（源是重庆北→利川，反向）
{
  const seg = load('yuli');
  const a = nearestIdx(seg, 利川);
  const b = nearestIdx(seg, 重庆北);
  console.log('yuli snap 利川', a.d.toFixed(2), '重庆北', b.d.toFixed(2));
  appendSeg(out, seg, { fromIdx: a.i, toIdx: b.i });
}

console.log('east stitch pts', out.length, 'end', out.at(-1));

// 6) 西段 重庆北→成都东：OSM bbox via-legs（遂渝/遂成无独立走廊）
const westId = 'ningrong__west';
const legs = `${重庆北[0]},${重庆北[1]};105.565,30.508;${成都东[0]},${成都东[1]}`;
const r = spawnSync(
  process.execPath,
  [
    join(__dirname, 'build-corridor-via-legs.mjs'),
    westId,
    '--name',
    '宁蓉西段',
    '--pad',
    '0.55',
    '--tol',
    '0.03',
    '--hint',
    '重庆北,遂宁,成都东',
    '--legs',
    legs,
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } },
);
if (r.status !== 0) {
  console.error('west via-legs failed');
  process.exit(r.status || 1);
}
const west = load(westId);
appendSeg(out, west);
const westPath = join(corrDir, `${westId}.json`);
if (existsSync(westPath)) unlinkSync(westPath);

// simplify
const simplified = [out[0]];
for (let i = 1; i < out.length; i++) {
  if (haversine(simplified.at(-1), out[i]) >= 0.4) simplified.push(out[i]);
}
simplified.push(out.at(-1));

let km = 0;
let maxJ = 0;
for (let i = 1; i < simplified.length; i++) {
  const d = haversine(simplified[i - 1], simplified[i]);
  km += d;
  if (d > maxJ) maxJ = d;
}
console.log('ningrong km', km.toFixed(1), 'maxJ', maxJ.toFixed(1), 'pts', simplified.length);

const meta = {
  id: 'ningrong',
  name: '宁蓉铁路',
  source: 'stitch:heining+hewu+hanyi+yiwan+yuli+osm-west',
  sourceNames: ['宁蓉铁路', '沪蓉线', '合宁', '合武', '汉宜', '宜万', '渝利'],
  stationsHint: ['南京南', '合肥南', '汉口', '宜昌东', '利川', '重庆北', '遂宁', '成都东'],
  note: 'stitch existing corridors + west via-legs; not hsr-rails extract',
  railway: simplified.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]),
};
writeFileSync(join(corrDir, 'ningrong.json'), JSON.stringify(meta));
console.log('written ningrong');
