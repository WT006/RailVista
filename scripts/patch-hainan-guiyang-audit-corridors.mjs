/**
 * 修复：海南西环断口 + 贵阳北/宜宾西等错位坐标 + 哈牡端点缺坐标
 * + 成贵/渝贵末端桥接贵阳北
 *
 *   node scripts/patch-hainan-guiyang-audit-corridors.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const geoPath = join(root, 'data/stations-geo.json');

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function densify(a, b, stepKm = 2) {
  const from = { lng: a[0], lat: a[1] };
  const to = { lng: b[0], lat: b[1] };
  const d = haversine(from, to);
  const n = Math.max(1, Math.ceil(d / stepKm));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([
      Number((from.lng + (to.lng - from.lng) * t).toFixed(6)),
      Number((from.lat + (to.lat - from.lat) * t).toFixed(6)),
    ]);
  }
  return out;
}

function densifyVia(points, stepKm = 2) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const seg = densify(out[out.length - 1], points[i], stepKm).slice(1);
    out.push(...seg);
  }
  return out;
}

function buildMetrics(coords) {
  const path = coords.map(([lng, lat]) => ({ lng, lat, distFromStart: 0 }));
  let lengthKm = 0;
  for (let i = 1; i < path.length; i++) {
    lengthKm += haversine(path[i - 1], path[i]);
    path[i].distFromStart = lengthKm;
  }
  return { path, lengthKm };
}

function projectToRailway(path, lengthKm, lng, lat) {
  let best = { distKm: Infinity, progress: 0, point: path[0] };
  if (!path.length || lengthKm <= 0) return best;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = b.distFromStart - a.distFromStart || 1;
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    const t = Math.max(
      0,
      Math.min(1, ((lng - a.lng) * dx + (lat - a.lat) * dy) / (dx * dx + dy * dy || 1)),
    );
    const point = { lng: a.lng + dx * t, lat: a.lat + dy * t };
    const distKm = haversine({ lng, lat }, point);
    const progress = (a.distFromStart + segLen * t) / lengthKm;
    if (distKm < best.distKm) best = { distKm, progress, point };
  }
  return best;
}

function maxJump(railway) {
  let max = 0;
  let at = 0;
  for (let i = 1; i < railway.length; i++) {
    const d = haversine(
      { lng: railway[i - 1][0], lat: railway[i - 1][1] },
      { lng: railway[i][0], lat: railway[i][1] },
    );
    if (d > max) {
      max = d;
      at = i;
    }
  }
  return { max, at };
}

function bridgeCorridorEnd(c, target, maxEndKm = 8) {
  const end = c.railway[c.railway.length - 1];
  const d = haversine(
    { lng: end[0], lat: end[1] },
    { lng: target[0], lat: target[1] },
  );
  if (d <= 0.5 || d > 40) return d;
  if (d <= maxEndKm) {
    const bridged = densify(end, target, 1.5).slice(1);
    c.railway = [...c.railway, ...bridged];
  }
  return d;
}

// —— 1) 海南西环：黄流→崖州/凤凰机场前 断口桥接 ——
const hainanxiPath = join(root, 'data/presets/corridors/hainanxi.json');
const hainanxi = JSON.parse(readFileSync(hainanxiPath, 'utf8'));
const jump = maxJump(hainanxi.railway);
console.log('hainanxi before maxJump', jump.max.toFixed(1), '@', jump.at);

if (jump.max > 20) {
  const i = jump.at;
  const from = hainanxi.railway[i - 1];
  const to = hainanxi.railway[i];
  // 经乐东、崖州示意落点（西环实际走向），避免 45km 飞线
  const via = [
    from,
    [109.0337, 18.4486], // 乐东一带轨
    [109.1535, 18.3782], // 崖州
    to,
  ];
  const bridge = densifyVia(via, 2);
  hainanxi.railway = [
    ...hainanxi.railway.slice(0, i - 1),
    ...bridge,
    ...hainanxi.railway.slice(i + 1),
  ];
  hainanxi.note =
    (hainanxi.note || '') +
    '；黄流→崖州源数据断口约45km，经乐东/崖州 densify 桥接（非飞线）';
  hainanxi.source = `${hainanxi.source || 'hsr'}+ledong-bridge`;
}

const hxAfter = maxJump(hainanxi.railway);
console.log('hainanxi after maxJump', hxAfter.max.toFixed(1), '@', hxAfter.at);
writeFileSync(hainanxiPath, JSON.stringify(hainanxi));

// —— 2) stations-geo 纠正 ——
const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const WIKI = {
  贵阳北: { lng: 106.6725, lat: 26.6225 },
  宜宾西: { lng: 104.6033361, lat: 28.7257667 },
  兴文: { lng: 105.244562, lat: 28.338113 },
  哈尔滨: { lng: 126.6238972, lat: 45.7584583 },
  牡丹江: { lng: 129.6062222, lat: 44.589775 },
};

for (const [name, pt] of Object.entries(WIKI)) {
  const prev = geo[name];
  const d = prev
    ? haversine({ lng: prev.lng, lat: prev.lat }, pt)
    : Infinity;
  geo[name] = { name, lng: pt.lng, lat: pt.lat, source: 'manual:wiki' };
  console.log('geo wiki', name, prev ? `was dΔ=${d.toFixed(1)}km` : 'NEW');
}

// 西环站：投影纠正（走廊来源可覆盖）
const { path: hxPath, lengthKm: hxLen } = buildMetrics(hainanxi.railway);
for (const name of ['海口', '临高南', '儋州', '东方', '乐东', '三亚']) {
  const prev = geo[name];
  if (!prev) continue;
  if (prev.source === 'manual:wiki') continue;
  const p = projectToRailway(hxPath, hxLen, prev.lng, prev.lat);
  if (p.distKm >= 2.5 && p.distKm < 40) {
    geo[name] = {
      name,
      lng: Number(p.point.lng.toFixed(6)),
      lat: Number(p.point.lat.toFixed(6)),
      source: 'corridor:hainanxi',
    };
    console.log('geo snap', name, 'was d', p.distKm.toFixed(1));
  }
}

// 成贵：毕节/威信/镇雄曾被 yukun 标飞 → 投影到成贵
const chengguiPath = join(root, 'data/presets/corridors/chenggui.json');
const chenggui = JSON.parse(readFileSync(chengguiPath, 'utf8'));
const { path: cgPath, lengthKm: cgLen } = buildMetrics(chenggui.railway);

// 毕节大致在成贵中南段：用走廊上最靠近 (105.29, 27.30) 的点
const bijieGuess = projectToRailway(cgPath, cgLen, 105.29, 27.3);
geo['毕节'] = {
  name: '毕节',
  lng: Number(bijieGuess.point.lng.toFixed(6)),
  lat: Number(bijieGuess.point.lat.toFixed(6)),
  source: 'corridor:chenggui',
};
console.log('geo 毕节 snap d', bijieGuess.distKm.toFixed(1), 'prog', (bijieGuess.progress * 100).toFixed(0) + '%');

for (const [name, guess] of [
  ['威信', [105.05, 27.85]],
  ['镇雄', [104.95, 27.45]],
  ['乐山', [103.75, 29.55]],
  ['犍为', [103.95, 29.2]],
  ['长宁', [104.95, 28.55]],
]) {
  const prev = geo[name];
  if (prev?.source === 'manual:wiki') continue;
  if (prev && !String(prev.source || '').includes('yukun') && prev.source !== 'corridor:guinan') {
    // 已有较可信坐标则只在严重偏离时纠正
    const p = projectToRailway(cgPath, cgLen, prev.lng, prev.lat);
    if (p.distKm < 25) continue;
  }
  const p = projectToRailway(cgPath, cgLen, guess[0], guess[1]);
  if (p.distKm < 30) {
    geo[name] = {
      name,
      lng: Number(p.point.lng.toFixed(6)),
      lat: Number(p.point.lat.toFixed(6)),
      source: 'corridor:chenggui',
    };
    console.log('geo', name, '→ chenggui');
  }
}

// 宜宾西/兴文已 wiki；再核对贴合
for (const name of ['宜宾西', '兴文', '贵阳北']) {
  const s = geo[name];
  const p = projectToRailway(cgPath, cgLen, s.lng, s.lat);
  console.log('chenggui fit', name, 'd', p.distKm.toFixed(1), 'prog', (p.progress * 100).toFixed(0) + '%');
}

// —— 3) 成贵/渝贵末端桥接贵阳北 ——
const gyb = [geo['贵阳北'].lng, geo['贵阳北'].lat];
const dCg = bridgeCorridorEnd(chenggui, gyb, 12);
chenggui.note =
  (chenggui.note || '') +
  (dCg > 0.5 ? `；末端桥接贵阳北 wiki（原距约${dCg.toFixed(1)}km）` : '');
if (dCg > 0.5) chenggui.source = `${chenggui.source || 'hsr'}+guiyangbei-end`;
writeFileSync(chengguiPath, JSON.stringify(chenggui));
console.log('chenggui end→贵阳北', dCg.toFixed(1), 'km, pts', chenggui.railway.length);

const yuguiPath = join(root, 'data/presets/corridors/yugui.json');
const yugui = JSON.parse(readFileSync(yuguiPath, 'utf8'));
const dYg = bridgeCorridorEnd(yugui, gyb, 12);
yugui.note =
  (yugui.note || '') +
  (dYg > 0.5 ? `；末端桥接贵阳北 wiki（原距约${dYg.toFixed(1)}km）` : '');
if (dYg > 0.5) yugui.source = `${yugui.source || 'hsr'}+guiyangbei-end`;
writeFileSync(yuguiPath, JSON.stringify(yugui));
console.log('yugui end→贵阳北', dYg.toFixed(1), 'km, pts', yugui.railway.length);

// 哈牡：尚志南/亚布力西/海林北 用走廊插值粗标（仅缺省时）
const hamuPath = join(root, 'data/presets/corridors/hamu.json');
const hamu = JSON.parse(readFileSync(hamuPath, 'utf8'));
const { path: hmPath, lengthKm: hmLen } = buildMetrics(hamu.railway);
for (const [name, frac] of [
  ['尚志南', 0.35],
  ['亚布力西', 0.55],
  ['海林北', 0.85],
]) {
  if (geo[name]?.source === 'manual:wiki') continue;
  const target = frac * hmLen;
  let pt = hmPath[hmPath.length - 1];
  for (const p of hmPath) {
    if (p.distFromStart >= target) {
      pt = p;
      break;
    }
  }
  geo[name] = {
    name,
    lng: Number(pt.lng.toFixed(6)),
    lat: Number(pt.lat.toFixed(6)),
    source: 'corridor:hamu',
  };
  console.log('geo hamu', name);
}

// 厦深缺站：走廊等分粗标
const xiashen = JSON.parse(
  readFileSync(join(root, 'data/presets/corridors/xiashen.json'), 'utf8'),
);
const { path: xsPath, lengthKm: xsLen } = buildMetrics(xiashen.railway);
for (const [name, frac] of [
  ['揭阳', 0.45],
  ['汕尾', 0.7],
  ['惠州南', 0.88],
]) {
  if (geo[name] && geo[name].source !== 'corridor:yukun') continue;
  const target = frac * xsLen;
  let pt = xsPath[xsPath.length - 1];
  for (const p of xsPath) {
    if (p.distFromStart >= target) {
      pt = p;
      break;
    }
  }
  geo[name] = {
    name,
    lng: Number(pt.lng.toFixed(6)),
    lat: Number(pt.lat.toFixed(6)),
    source: 'corridor:xiashen',
  };
  console.log('geo xiashen', name);
}

// 东环缺站
const hainandong = JSON.parse(
  readFileSync(join(root, 'data/presets/corridors/hainandong.json'), 'utf8'),
);
const { path: hdPath, lengthKm: hdLen } = buildMetrics(hainandong.railway);
for (const [name, frac] of [
  ['海口东', 0.08],
  ['文昌', 0.25],
  ['琼海', 0.45],
  ['万宁', 0.65],
  ['陵水', 0.82],
]) {
  if (geo[name]?.lng != null && !String(geo[name].source || '').includes('yukun')) continue;
  const target = frac * hdLen;
  let pt = hdPath[hdPath.length - 1];
  for (const p of hdPath) {
    if (p.distFromStart >= target) {
      pt = p;
      break;
    }
  }
  geo[name] = {
    name,
    lng: Number(pt.lng.toFixed(6)),
    lat: Number(pt.lat.toFixed(6)),
    source: 'corridor:hainandong',
  };
  console.log('geo hainandong', name);
}

writeFileSync(geoPath, JSON.stringify(geo));
console.log('stations-geo written');

// QC summary
for (const id of ['hainanxi', 'hainandong', 'xiashen', 'hamu', 'chenggui', 'yugui']) {
  const c = JSON.parse(
    readFileSync(join(root, 'data/presets/corridors', `${id}.json`), 'utf8'),
  );
  const { path, lengthKm } = buildMetrics(c.railway);
  const mj = maxJump(c.railway);
  const hints = c.stationsHint || [];
  let worst = ['', 0];
  for (const h of hints) {
    const s = geo[h];
    if (!s) {
      if (worst[1] < 999) worst = [h + '?', 999];
      continue;
    }
    const p = projectToRailway(path, lengthKm, s.lng, s.lat);
    if (p.distKm > worst[1]) worst = [h, p.distKm];
  }
  console.log(
    'QC',
    id,
    'len',
    lengthKm.toFixed(0),
    'maxJ',
    mj.max.toFixed(1),
    'worstHint',
    worst[0],
    typeof worst[1] === 'number' ? worst[1].toFixed(1) : worst[1],
  );
}
