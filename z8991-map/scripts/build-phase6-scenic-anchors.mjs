/**
 * 风景线第六/七期：无完整 OSM relation 时，用锚站稠密折线入库（同 kunli/lixiang 模式）
 * node scripts/build-phase6-scenic-anchors.mjs
 *
 * 后续若补到 OSM relation，可用 build-corridor-from-osm-relation.mjs 覆盖。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '../data/presets/corridors');
mkdirSync(outDir, { recursive: true });

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

function dist(a, b) {
  return Math.hypot(a.lng - b.lng, a.lat - b.lat);
}

function densify(anchors, stepKm = 1.5) {
  const out = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const d = haversine(a, b);
    const n = Math.max(1, Math.ceil(d / stepKm));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({
        lng: a.lng + (b.lng - a.lng) * t,
        lat: a.lat + (b.lat - a.lat) * t,
      });
    }
  }
  out.push(anchors[anchors.length - 1]);
  return out;
}

function simplify(line, minKm = 0.4) {
  if (!line.length) return [];
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    if (haversine(out.at(-1), line[i]) >= minKm) out.push(line[i]);
  }
  const last = line.at(-1);
  if (dist(out.at(-1), last) > 0.0001) out.push(last);
  return out;
}

function writeCorridor({ id, name, sourceNames, note, anchors }) {
  const railway = simplify(densify(anchors, 1.5)).map((p) => [
    Number(p.lng.toFixed(6)),
    Number(p.lat.toFixed(6)),
  ]);
  let km = 0;
  for (let i = 1; i < railway.length; i++) {
    km += haversine(
      { lng: railway[i - 1][0], lat: railway[i - 1][1] },
      { lng: railway[i][0], lat: railway[i][1] },
    );
  }
  const meta = {
    id,
    name,
    source: 'anchors',
    sourceNames,
    note: note || '锚站稠密折线；待 OSM relation 覆盖为精确轨',
    stationsHint: anchors.map((a) => a.name),
    railway,
  };
  const path = join(outDir, `${id}.json`);
  writeFileSync(path, JSON.stringify(meta));
  console.log('written', id, 'pts', railway.length, 'km', km.toFixed(0));
}

/** 第六期：高优先缺 OSM */
const phase6 = [
  {
    id: 'hanghuang',
    name: '杭黄高铁',
    sourceNames: ['杭黄高铁', '杭黄客运专线'],
    note: '杭州东→黄山北；锚点示意，待 OSM/hsr 覆盖',
    anchors: [
      { name: '杭州东', lng: 120.212, lat: 30.289 },
      { name: '富阳', lng: 119.95, lat: 30.05 },
      { name: '桐庐', lng: 119.727725, lat: 29.791394 },
      { name: '建德', lng: 119.28, lat: 29.49 },
      { name: '千岛湖', lng: 119.1880833, lat: 29.7374 },
      { name: '三阳', lng: 118.75, lat: 29.85 },
      { name: '绩溪北', lng: 118.412, lat: 29.935 },
      { name: '歙县北', lng: 118.405, lat: 29.924 },
      { name: '黄山北', lng: 118.225, lat: 29.783 },
    ],
  },
  {
    id: 'chihuang',
    name: '池黄高铁',
    sourceNames: ['池黄高速线', '池黄高铁'],
    anchors: [
      { name: '池州', lng: 117.49, lat: 30.66 },
      { name: '九华山', lng: 117.75, lat: 30.55 },
      { name: '黄山西', lng: 118.05, lat: 30.15 },
      { name: '黟县东', lng: 118.1, lat: 29.95 },
      { name: '黄山北', lng: 118.225, lat: 29.783 },
    ],
  },
  {
    id: 'fuping',
    name: '福平铁路',
    sourceNames: ['福平铁路', '福州至平潭铁路'],
    anchors: [
      { name: '福州', lng: 119.3, lat: 26.08 },
      { name: '福州南', lng: 119.39, lat: 25.99 },
      { name: '长乐', lng: 119.52, lat: 25.96 },
      { name: '长乐东', lng: 119.62, lat: 25.9 },
      { name: '长乐南', lng: 119.68, lat: 25.78 },
      { name: '平潭', lng: 119.78, lat: 25.52 },
    ],
  },
  {
    id: 'chuanqing',
    name: '川青铁路',
    sourceNames: ['川青铁路', '成兰铁路'],
    note: '已开通成都东→黄胜关段锚点',
    anchors: [
      { name: '成都东', lng: 104.121, lat: 30.592 },
      { name: '青白江东', lng: 104.28, lat: 30.82 },
      { name: '三星堆', lng: 104.2, lat: 31.0 },
      { name: '什邡西', lng: 104.05, lat: 31.15 },
      { name: '绵竹南', lng: 104.15, lat: 31.28 },
      { name: '安州', lng: 104.4, lat: 31.55 },
      { name: '高川', lng: 103.95, lat: 31.7 },
      { name: '茂县', lng: 103.85, lat: 31.68 },
      { name: '镇江关', lng: 103.75, lat: 32.2 },
      { name: '松潘', lng: 103.6, lat: 32.65 },
      { name: '黄龙九寨', lng: 103.72, lat: 32.82 },
      { name: '黄胜关', lng: 103.78, lat: 33.05 },
    ],
  },
  {
    id: 'lalin',
    name: '拉林铁路',
    sourceNames: ['拉林铁路', '拉萨至林芝铁路'],
    anchors: [
      { name: '拉萨', lng: 91.07, lat: 29.623 },
      { name: '贡嘎', lng: 90.98, lat: 29.3 },
      { name: '扎囊', lng: 91.33, lat: 29.25 },
      { name: '山南', lng: 91.77, lat: 29.24 },
      { name: '桑日', lng: 92.02, lat: 29.26 },
      { name: '加查', lng: 92.58, lat: 29.14 },
      { name: '朗县', lng: 93.07, lat: 29.05 },
      { name: '米林', lng: 94.2, lat: 29.22 },
      { name: '岗嘎', lng: 94.35, lat: 29.3 },
      { name: '林芝', lng: 94.36, lat: 29.57 },
    ],
  },
  {
    id: 'dunge',
    name: '敦格铁路',
    sourceNames: ['敦格铁路', '敦煌至格尔木铁路'],
    anchors: [
      { name: '敦煌', lng: 94.783, lat: 40.168 },
      { name: '阿克塞', lng: 94.34, lat: 39.63 },
      { name: '肃北', lng: 94.88, lat: 39.51 },
      { name: '马海', lng: 94.8, lat: 38.2 },
      { name: '鱼卡', lng: 94.35, lat: 37.85 },
      { name: '大柴旦', lng: 95.37, lat: 37.85 },
      { name: '饮马峡', lng: 95.5, lat: 37.2 },
      { name: '格尔木', lng: 94.907, lat: 36.383 },
    ],
  },
  {
    id: 'yiwan',
    name: '宜万铁路',
    sourceNames: ['宜万铁路', '宜昌至万州铁路'],
    anchors: [
      { name: '宜昌东', lng: 111.461, lat: 30.659 },
      { name: '巴东', lng: 110.37, lat: 30.83 },
      { name: '建始', lng: 109.72, lat: 30.6 },
      { name: '恩施', lng: 109.48, lat: 30.3 },
      { name: '利川', lng: 108.94, lat: 30.29 },
      { name: '万州', lng: 108.4, lat: 30.8 },
    ],
  },
  {
    id: 'dunbai',
    name: '敦白高铁',
    sourceNames: ['敦白高铁', '沈佳高速敦白段'],
    anchors: [
      { name: '敦化', lng: 128.23, lat: 43.37 },
      { name: '大石头南', lng: 128.45, lat: 43.2 },
      { name: '安图西', lng: 128.55, lat: 42.9 },
      { name: '长白山', lng: 128.15, lat: 42.4 },
    ],
  },
  {
    id: 'zhanghu',
    name: '张呼高铁',
    sourceNames: ['张呼高铁', '张家口至呼和浩特高速铁路'],
    anchors: [
      { name: '张家口', lng: 114.877, lat: 40.75 },
      { name: '怀安', lng: 114.4, lat: 40.7 },
      { name: '兴和北', lng: 113.85, lat: 40.95 },
      { name: '乌兰察布', lng: 113.12, lat: 41.0 },
      { name: '卓资东', lng: 112.55, lat: 40.9 },
      { name: '呼和浩特东', lng: 111.758, lat: 40.85 },
    ],
  },
  {
    id: 'jingzhang',
    name: '京张高铁',
    sourceNames: ['京张高铁', '京张城际铁路'],
    anchors: [
      { name: '北京北', lng: 116.353, lat: 39.945 },
      { name: '清河', lng: 116.314, lat: 40.039 },
      { name: '八达岭长城', lng: 116.01, lat: 40.36 },
      { name: '怀来', lng: 115.55, lat: 40.4 },
      { name: '张家口', lng: 114.877, lat: 40.75 },
    ],
  },
];

/** 第七期：中优先 */
const phase7 = [
  {
    id: 'geku',
    name: '格库铁路',
    sourceNames: ['格库铁路', '格尔木至库尔勒铁路'],
    anchors: [
      { name: '格尔木', lng: 94.907, lat: 36.383 },
      { name: '花土沟', lng: 90.85, lat: 38.25 },
      { name: '若羌', lng: 88.17, lat: 39.02 },
      { name: '尉犁', lng: 86.26, lat: 41.34 },
      { name: '库尔勒', lng: 86.15, lat: 41.73 },
    ],
  },
  {
    id: 'yuli',
    name: '渝利铁路',
    sourceNames: ['渝利铁路', '重庆至利川铁路'],
    anchors: [
      { name: '重庆北', lng: 106.55, lat: 29.61 },
      { name: '涪陵北', lng: 107.35, lat: 29.72 },
      { name: '丰都', lng: 107.7, lat: 29.9 },
      { name: '石柱县', lng: 108.12, lat: 30.0 },
      { name: '利川', lng: 108.94, lat: 30.29 },
    ],
  },
  {
    id: 'zhonglao',
    name: '中老铁路国内段',
    sourceNames: ['玉磨铁路', '中老铁路', '昆磨铁路'],
    note: '昆明南→磨憨国内段锚点',
    anchors: [
      { name: '昆明南', lng: 102.854, lat: 24.887 },
      { name: '玉溪', lng: 102.55, lat: 24.35 },
      { name: '峨山', lng: 102.4, lat: 24.17 },
      { name: '元江', lng: 102.0, lat: 23.6 },
      { name: '墨江', lng: 101.68, lat: 23.43 },
      { name: '宁洱', lng: 101.05, lat: 23.05 },
      { name: '普洱', lng: 100.97, lat: 22.78 },
      { name: '西双版纳', lng: 100.92, lat: 22.0 },
      { name: '橄榄坝', lng: 100.93, lat: 21.85 },
      { name: '勐腊', lng: 101.57, lat: 21.48 },
      { name: '磨憨', lng: 101.68, lat: 21.18 },
    ],
  },
  {
    id: 'hainanxi',
    name: '海南西环高铁',
    sourceNames: ['海南西环高铁', '海南环岛高铁线西段'],
    anchors: [
      { name: '三亚', lng: 109.51, lat: 18.3 },
      { name: '乐东', lng: 109.1, lat: 18.55 },
      { name: '东方', lng: 108.68, lat: 19.1 },
      { name: '金月湾', lng: 108.9, lat: 19.45 },
      { name: '儋州', lng: 109.45, lat: 19.55 },
      { name: '临高南', lng: 109.7, lat: 19.8 },
      { name: '海口', lng: 110.17, lat: 19.99 },
    ],
  },
  {
    id: 'xiangqian',
    name: '湘黔铁路',
    sourceNames: ['湘黔铁路', '沪昆铁路湘黔段'],
    anchors: [
      { name: '株洲', lng: 113.15, lat: 27.84 },
      { name: '湘潭', lng: 112.91, lat: 27.87 },
      { name: '娄底', lng: 112.0, lat: 27.73 },
      { name: '冷水江东', lng: 111.45, lat: 27.68 },
      { name: '新化', lng: 111.3, lat: 27.73 },
      { name: '溆浦', lng: 110.6, lat: 27.92 },
      { name: '怀化', lng: 109.98, lat: 27.55 },
      { name: '凯里', lng: 107.98, lat: 26.59 },
      { name: '贵定', lng: 107.23, lat: 26.58 },
      { name: '贵阳', lng: 106.67, lat: 26.58 },
    ],
  },
  {
    id: 'linha',
    name: '临哈铁路',
    sourceNames: ['临哈铁路', '临河至哈密铁路'],
    note: '胡杨专列常用段：包头/临河→额济纳',
    anchors: [
      { name: '呼和浩特', lng: 111.66, lat: 40.85 },
      { name: '包头', lng: 109.99, lat: 40.6 },
      { name: '临河', lng: 107.4, lat: 40.75 },
      { name: '额济纳', lng: 101.07, lat: 41.96 },
    ],
  },
  {
    id: 'diandong',
    name: '滇越铁路云南段',
    sourceNames: ['滇越铁路', '昆河铁路'],
    note: '米轨观光参考；几何为锚点示意',
    anchors: [
      { name: '昆明北', lng: 102.72, lat: 25.06 },
      { name: '宜良', lng: 103.15, lat: 24.92 },
      { name: '开远', lng: 103.27, lat: 23.71 },
      { name: '碧色寨', lng: 103.4, lat: 23.45 },
      { name: '屏边', lng: 103.68, lat: 22.98 },
      { name: '河口', lng: 103.95, lat: 22.52 },
    ],
  },
];

console.log('=== phase 6 ===');
for (const c of phase6) writeCorridor(c);
console.log('=== phase 7 ===');
for (const c of phase7) writeCorridor(c);

console.log('\nphase-6/7 anchors done');
// 仅补缺，不覆盖已有 stations-geo（避免 OSM 毛刺把枢纽纠偏飞）
spawnSync(process.execPath, [join(__dirname, 'seed-missing-stations-geo.mjs')], {
  stdio: 'inherit',
});
