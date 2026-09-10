/**
 * 从 china-hsr-simulation 的 hsr-rails.geojson 提取干线走廊
 * 用法:
 *   node scripts/extract-corridor-from-hsr.mjs 京沪高铁 jinghu
 *   node scripts/extract-corridor-from-hsr.mjs 京广高速线 jingguang --download
 *   node scripts/extract-corridor-from-hsr.mjs 沪昆高速线 hukun --axis ew
 *   # 多名称用 | 拼接（沪昆主线+沪杭段）:
 *   node scripts/extract-corridor-from-hsr.mjs "沪昆高速线|沪昆高速铁路" hukun --axis ew
 *   node scripts/extract-corridor-from-hsr.mjs 徐兰高速线 xulan --axis ew
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const lineNameArg = process.argv[2] || '京沪高铁';
const lineNames = lineNameArg.split('|').map((s) => s.trim()).filter(Boolean);
const lineName = lineNames[0];
const outId = process.argv[3] || 'jinghu';
const wantDownload = process.argv.includes('--download');
const wantReverse = process.argv.includes('--reverse');
const axisArg = process.argv.find((a) => a.startsWith('--axis='));
const axisFlag = process.argv.includes('--axis')
  ? process.argv[process.argv.indexOf('--axis') + 1]
  : axisArg?.slice('--axis='.length);
/** ns: 北→南；ew: 东→西；auto: 按外接矩形长边判断 */
const axis = axisFlag || 'auto';

const CACHE = join(__dirname, '../data/presets/corridors/_hsr-rails.geojson');
const CDN =
  'https://cdn.jsdelivr.net/gh/linroger/china-hsr-simulation@main/public/hsr-rails.geojson';

const HINTS = {
  jinghu: [
    '北京南', '天津南', '沧州西', '德州东', '济南西', '泰安', '曲阜东', '滕州东', '枣庄',
    '徐州东', '宿州东', '蚌埠南', '定远', '滁州', '南京南', '镇江南', '丹阳北', '常州北',
    '无锡东', '苏州北', '昆山南', '上海虹桥',
  ],
  jingguang: [
    '北京西', '涿州东', '高碑店东', '保定东', '定州东', '正定机场', '石家庄', '高邑西',
    '邢台东', '邯郸东', '安阳东', '鹤壁东', '新乡东', '郑州东', '许昌东', '漯河西',
    '驻马店西', '明港东', '信阳东', '孝感北', '武汉', '咸宁北', '赤壁北', '岳阳东',
    '汨罗东', '长沙南', '株洲西', '衡山西', '衡阳东', '耒阳西', '郴州西', '韶关东',
    '英德西', '清远', '广州北', '广州南',
  ],
  hukun: [
    '上海虹桥', '嘉兴南', '杭州东', '义乌', '金华', '衢州', '上饶', '鹰潭北', '南昌西',
    '高安', '新余北', '宜春', '萍乡北', '醴陵东', '长沙南', '湘潭北', '韶山南', '娄底南',
    '邵阳北', '新化南', '溆浦南', '怀化南', '芷江', '新晃西', '铜仁南', '三穗', '凯里南',
    '贵定北', '贵阳北', '平坝南', '安顺西', '关岭', '普安县', '盘州', '富源北', '曲靖北',
    '嵩明', '昆明南',
  ],
  xulan: [
    '徐州东', '萧县北', '永城北', '商丘', '民权北', '兰考南', '开封北', '郑州东',
    '巩义南', '洛阳龙门', '渑池南', '三门峡南', '灵宝西', '华山北', '渭南北', '临潼东',
    '西安北', '咸阳北', '杨陵南', '岐山', '宝鸡南', '东岔', '天水南', '秦安', '通渭',
    '定西北', '榆中', '兰州西',
  ],
  jingha: [
    '北京朝阳', '顺义西', '怀柔南', '密云', '兴隆西', '安匠', '承德南', '平泉北',
    '牛河梁', '喀左', '朝阳', '北票', '阜新', '黑山北', '新民北', '沈阳', '沈阳北',
    '铁岭西', '开原西', '昌图西', '四平东', '公主岭南', '长春西', '德惠西', '扶余北',
    '双城北', '哈尔滨西',
  ],
  haida: [
    '沈阳', '沈阳北', '沈阳南', '辽阳', '鞍山西', '海城西', '营口东', '盖州西',
    '鲅鱼圈', '瓦房店西', '普湾', '大连北', '大连',
  ],
  // —— 第二期：沿海 / 沿江分段 ——
  qingrong: [
    '青岛', '青岛北', '即墨北', '莱西北', '莱阳', '海阳北', '桃村北', '烟台南',
    '牟平', '威海北', '威海', '文登东', '荣成',
  ],
  xulian: [
    '徐州东', '邳州东', '新沂南', '东海县', '连云港', '连云港东',
  ],
  yantong: [
    '盐城', '盐城大丰', '东台', '海安', '如皋南', '南通西', '南通',
  ],
  huhang: [
    '上海虹桥', '松江南', '金山北', '嘉善南', '嘉兴南', '桐乡', '海宁西', '余杭', '杭州东',
  ],
  hangtai: [
    // 源折线北端靠近绍兴北；保留杭州东便于站名命中（偏离时截取会吸附到折线端）
    '杭州东', '绍兴北', '嵊州新昌', '天台山', '临海', '台州', '温岭',
  ],
  hangwen: [
    // 源折线北端靠近桐庐东；杭州西作站名端点
    '杭州西', '桐庐东', '富阳西', '浦江', '义乌', '横店', '磐安南', '仙居南',
    '楠溪江', '温州北', '温州南',
  ],
  fuxia: [
    '福州南', '福清西', '福清', '莆田', '仙游', '惠安', '泉州东', '泉州', '晋江',
    '厦门北', '厦门',
  ],
  guangshengang: [
    '广州南', '庆盛', '虎门', '光明城', '深圳北', '福田', '香港西九龙',
  ],
  huningyanjiang: [
    '太仓', '常熟', '张家港', '江阴', '武进', '惠山', '南京南',
  ],
  zhengyu: [
    '郑州东', '长葛北', '禹州', '平顶山西', '方城东', '南阳南', '邓州东', '襄阳东',
    '南漳', '荆门西', '当阳西', '宜昌北', '兴山', '巴东北', '巫山', '奉节', '云阳',
    '万州北', '梁平南', '垫江', '长寿北', '重庆北',
  ],
  chengyu: [
    '成都东', '简阳南', '资阳北', '资中北', '内江北', '隆昌北', '荣昌北', '大足南',
    '永川东', '璧山', '沙坪坝', '重庆西', '重庆北',
  ],
  // —— 第三期：八纵八横补网 + 宁杭等关键段 ——
  ninghang: [
    '南京南', '江宁', '溧水', '瓦屋山', '溧阳', '宜兴', '长兴', '湖州', '德清', '杭州东',
  ],
  hefu: [
    '合肥南', '长临河', '巢湖东', '无为', '铜陵北', '南陵', '泾县', '旌德', '绩溪北',
    '黄山北', '婺源', '德兴', '上饶', '五府山', '武夷山北', '建瓯西', '南平市', '古田北',
    '闽清北', '福州', '福州南',
  ],
  hangchang: [
    '杭州东', '诸暨', '义乌', '金华', '衢州', '玉山南', '上饶', '弋阳', '鹰潭北', '抚州东',
    '进贤南', '南昌西',
  ],
  daxi: [
    '大同南', '怀仁东', '应县西', '山阴', '朔州', '宁武西', '原平西', '忻州西', '阳曲西',
    '太原南', '晋中', '太谷西', '祁县东', '平遥古城', '介休东', '霍州东', '洪洞西', '临汾西',
    '襄汾西', '侯马西', '闻喜西', '运城北', '永济北', '大荔', '渭南北', '西安北',
  ],
  xicheng: [
    '西安北', '鄠邑', '佛坪', '洋县西', '城固北', '汉中', '宁强南', '广元', '剑门关',
    '青川', '江油', '绵阳', '德阳', '广汉北', '青白江东', '新都东', '成都东',
  ],
  yinxi: [
    '银川', '灵武北', '吴忠', '红寺堡北', '同心南', '固原', '六盘山', '平凉', '华亭南',
    '崇信', '灵台', '庆阳', '彬州东', '永寿西', '乾县', '礼泉南', '兴平北', '咸阳北', '西安北',
  ],
  yinlan: [
    '银川', '河东机场', '灵武北', '吴忠', '中宁东', '中卫南', '景泰', '白银南', '兰州新区',
    '兰州西',
  ],
  guiguang: [
    '贵阳北', '龙里北', '贵定县', '都匀东', '三都县', '榕江', '从江', '三江南', '桂林西',
    '阳朔', '恭城', '钟山西', '贺州', '怀集', '广宁', '肇庆东', '三水南', '佛山西', '广州南',
  ],
  guinan: [
    '贵阳北', '都匀东', '独山', '荔波', '南丹', '河池西', '都安', '马山', '南宁东',
  ],
  nankun: [
    '南宁东', '南宁', '百色', '田阳', '田东北', '富宁', '广南县', '丘北', '弥勒', '石林西',
    '昆明南',
  ],
  yukun: [
    '重庆西', '江津北', '永川南', '泸州', '南溪北', '宜宾西', '兴文', '威信', '镇雄',
    '毕节', '织金北', '大方南', '宣威北', '曲靖北', '嵩明', '昆明南',
  ],
  zhengtai: [
    '郑州东', '焦作西', '修武西', '获嘉南', '新乡南', '辉县西', '鹤壁西', '淇县东', '汤阴东',
    '安阳西', '鹤壁', '晋城东', '高平东', '长治东', '潞城', '襄垣东', '武乡东', '榆社西',
    '太谷西', '晋中', '太原南',
  ],
  rilan: [
    '日照西', '莒南北', '临沂北', '费县北', '平邑', '泗水南', '曲阜东', '兖州东', '济宁东',
    '嘉祥北', '巨野北', '菏泽东', '东明东', '兰考南',
  ],
};

const DISPLAY_NAME = {
  hukun: '沪昆高铁',
  jingguang: '京广高铁',
  xulan: '徐兰高铁',
  jingha: '京哈高铁',
  haida: '沈大高铁',
  jinghu: '京沪高铁',
  qingrong: '青荣城际',
  xulian: '徐连高铁',
  yantong: '盐通高铁',
  huhang: '沪杭高铁',
  hangtai: '杭台高铁',
  hangwen: '杭温高铁',
  fuxia: '福厦高铁',
  guangshengang: '广深港高铁',
  huningyanjiang: '沪宁沿江高铁',
  zhengyu: '郑渝高铁',
  chengyu: '成渝高铁',
  ninghang: '宁杭高铁',
  hefu: '合福高铁',
  hangchang: '杭昌高铁',
  daxi: '大西高铁',
  xicheng: '西成高铁',
  yinxi: '银西高铁',
  yinlan: '银兰高铁',
  guiguang: '贵广高铁',
  guinan: '贵南高铁',
  nankun: '南昆高铁',
  yukun: '渝昆高铁',
  zhengtai: '郑太高铁',
  rilan: '日兰高铁',
};

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

async function ensureGeojson() {
  if (existsSync(CACHE) && !wantDownload) return CACHE;
  console.log('Downloading', CDN);
  const res = await fetch(CDN, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, buf);
  console.log('cached', CACHE, `${(buf.length / 1024 / 1024).toFixed(2)} MB`);
  return CACHE;
}

function pickEndpoints(allPts, mode) {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of allPts) {
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
  }
  const resolved =
    mode === 'auto'
      ? maxLng - minLng >= maxLat - minLat
        ? 'ew'
        : 'ns'
      : mode;

  let start;
  let end;
  if (resolved === 'ew') {
    start = allPts.reduce((a, b) => (a.lng >= b.lng ? a : b)); // 东
    end = allPts.reduce((a, b) => (a.lng <= b.lng ? a : b)); // 西
  } else {
    start = allPts.reduce((a, b) => (a.lat >= b.lat ? a : b)); // 北
    end = allPts.reduce((a, b) => (a.lat <= b.lat ? a : b)); // 南
  }
  // 若端点对过近，改用距 start 最远点
  if (haversine(start, end) < 80) {
    end = allPts.reduce((a, b) => (haversine(start, b) > haversine(start, a) ? b : a));
  }
  return { start, end, axis: resolved };
}

const path = await ensureGeojson();
const g = JSON.parse(readFileSync(path, 'utf8'));
const nameSet = new Set(lineNames);
const segs = [];
for (const f of g.features || []) {
  if (!nameSet.has(f.properties?.name)) continue;
  const geom = f.geometry;
  if (!geom) continue;
  const lines =
    geom.type === 'LineString'
      ? [geom.coordinates]
      : geom.type === 'MultiLineString'
        ? geom.coordinates
        : [];
  for (const coords of lines) {
    if (coords.length < 2) continue;
    segs.push({ pts: coords.map(([lng, lat]) => ({ lng, lat })), used: false });
  }
}
if (!segs.length) {
  const names = new Set(
    (g.features || []).map((f) => f.properties?.name).filter(Boolean),
  );
  console.error('line not found:', lineNames.join('|'));
  console.error(
    'available sample:',
    [...names].filter((n) => n.includes(lineName.slice(0, 2))).slice(0, 20),
  );
  process.exit(1);
}
console.log('names', lineNames.join(' | '), 'segments', segs.length);

const allPts = segs.flatMap((s) => s.pts);
const { start: ORIGIN, end: DEST, axis: usedAxis } = pickEndpoints(allPts, axis);
console.log(
  'axis',
  usedAxis,
  'start',
  ORIGIN.lng.toFixed(3),
  ORIGIN.lat.toFixed(3),
  'end',
  DEST.lng.toFixed(3),
  DEST.lat.toFixed(3),
);

let startIdx = 0;
let startRev = false;
let startD = Infinity;
for (let i = 0; i < segs.length; i++) {
  const s = segs[i];
  const d0 = dist(ORIGIN, s.pts[0]);
  const d1 = dist(ORIGIN, s.pts.at(-1));
  if (d0 < startD) {
    startD = d0;
    startIdx = i;
    startRev = false;
  }
  if (d1 < startD) {
    startD = d1;
    startIdx = i;
    startRev = true;
  }
}

let line = startRev ? [...segs[startIdx].pts].reverse() : [...segs[startIdx].pts];
segs[startIdx].used = true;
const progress = (p) => haversine(ORIGIN, p);

function pickNext(maxD, minGain) {
  const tail = line.at(-1);
  const prog = progress(tail);
  let best = null;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].used) continue;
    for (const rev of [false, true]) {
      const pts = rev ? [...segs[i].pts].reverse() : segs[i].pts;
      const d = dist(tail, pts[0]);
      if (d > maxD) continue;
      const gain = progress(pts.at(-1)) - prog;
      if (gain < minGain) continue;
      const score = d * 800 - gain * 2;
      if (!best || score < best.score) best = { i, pts, score };
    }
  }
  return best;
}

let stalled = 0;
while (haversine(line.at(-1), DEST) > 2 && stalled < 5) {
  const best =
    pickNext(0.05, -3) ||
    pickNext(0.12, -2) ||
    pickNext(0.25, 1) ||
    pickNext(0.5, 3) ||
    pickNext(1.0, 5);
  if (!best) {
    stalled += 1;
    continue;
  }
  stalled = 0;
  segs[best.i].used = true;
  line.push(...best.pts.slice(1));
}

if (haversine(line.at(-1), DEST) > 5) {
  let guard = 0;
  while (haversine(line.at(-1), DEST) > 2 && guard++ < 800) {
    const tail = line.at(-1);
    let best = null;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].used) continue;
      for (const rev of [false, true]) {
        const pts = rev ? [...segs[i].pts].reverse() : segs[i].pts;
        const d = dist(tail, pts[0]);
        if (d > 0.8) continue;
        const closer = haversine(pts.at(-1), DEST) - haversine(tail, DEST);
        if (closer > 2) continue;
        const score = d * 1000 + closer * 10;
        if (!best || score < best.score) best = { i, pts, score };
      }
    }
    if (!best) break;
    segs[best.i].used = true;
    line.push(...best.pts.slice(1));
  }
}

let out = [line[0]];
for (let i = 1; i < line.length; i++) {
  if (haversine(out.at(-1), line[i]) >= 0.45) out.push(line[i]);
}
if (dist(out.at(-1), line.at(-1)) > 0.0001) out.push(line.at(-1));

/** 去掉抽稀后仍存在的折返毛刺（联络线/双向拼接） */
function removeBacktracks(pts, dest) {
  if (pts.length < 3) return pts;
  const startToDest = haversine(pts[0], dest) || 1;
  const cleaned = [pts[0]];
  let maxProg = 0;
  for (let i = 1; i < pts.length; i++) {
    const prog = 1 - haversine(pts[i], dest) / startToDest;
    // 允许小幅噪声；明显回退则丢弃
    if (prog >= maxProg - 0.004) {
      cleaned.push(pts[i]);
      maxProg = Math.max(maxProg, prog);
    }
  }
  // 保证终点
  if (dist(cleaned.at(-1), pts.at(-1)) > 0.0001) cleaned.push(pts.at(-1));
  return cleaned.length >= 2 ? cleaned : pts;
}

out = removeBacktracks(out, DEST);

if (wantReverse) {
  out = [...out].reverse();
  console.log('reversed polyline direction');
  // 反向后再清一次毛刺（相对新终点）
  out = removeBacktracks(out, out.at(-1));
}

let km = 0;
for (let i = 1; i < out.length; i++) {
  km += haversine(out[i - 1], out[i]);
}
const coords = out.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
// reverse 后：终点应对齐原北端 ORIGIN；否则对齐 DEST
const endTarget = wantReverse ? ORIGIN : DEST;
const remainKm = haversine(out.at(-1), endTarget);
console.log(
  'simplified',
  coords.length,
  'km',
  km.toFixed(1),
  'remainToDestKm',
  remainKm.toFixed(1),
  'start',
  coords[0],
  'end',
  coords.at(-1),
);

if (km < 100 || remainKm > 50) {
  console.warn(
    'WARNING: corridor may be incomplete (km or remainToDest). Check line name / axis.',
  );
}

const outDir = join(__dirname, '../data/presets/corridors');
mkdirSync(outDir, { recursive: true });
const meta = {
  id: outId,
  name: DISPLAY_NAME[outId] || lineName,
  source: 'china-hsr-simulation/hsr-rails.geojson',
  sourceNames: lineNames,
  stationsHint: HINTS[outId] || [],
  railway: coords,
};
const outPath = join(outDir, `${outId}.json`);
writeFileSync(outPath, JSON.stringify(meta));
console.log('written', outPath, `${(Buffer.byteLength(JSON.stringify(meta)) / 1024).toFixed(1)} KB`);
