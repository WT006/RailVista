/**
 * 把高德核验过的真实景点写入指定路线的 pois[]（行级精准插入，不重排整文件）。
 * 同时支持给路线 cities[] 补一个缺失城市（消除「城市不在 cities 中」warn）。
 *
 * 纪律：所有坐标来自高德核验；intro/tagline 仅写可考的事实，不编具体票价/时刻。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ADDITIONS = [
  {
    file: 'data/presets/roadbooks/tibet-access-north.json',
    routeId: 'xinjiang-tibet-line',
    pois: [
      {
        id: 'xtl-p-muztagh', name: '慕士塔格峰', province: '新疆', city: '喀什地区', category: 'mountain',
        lng: 74.9507, lat: 38.2855,
        tagline: '海拔约 7509 米的「冰山之父」，帕米尔的标志性雪峰。',
        intro: '位于喀什通往塔什库尔干的 G314 沿线，山体浑圆、冰川发育完整，被称作「冰山之父」。它与脚下的喀拉库勒湖共同构成帕米尔最经典的画面，晴天时雪峰倒映湖中。接近与攀登通常从喀拉库勒湖一侧的大本营出发，普通游客多在湖边观景台远眺。',
        mustSee: true, visitHours: 1, ticketNote: '观景随喀拉库勒湖景区，进入与游览以景区管理公告为准',
      },
      {
        id: 'xtl-p-karakul', name: '喀拉库勒湖', province: '新疆', city: '喀什地区', category: 'water',
        lng: 75.0635, lat: 38.4417,
        tagline: '慕士塔格峰脚下的高山湖，雪峰倒影的天然镜面。',
        intro: '紧邻慕士塔格峰的高山湖泊，湖水随光线在蓝与绿之间转换，晴朗时雪峰完整倒映湖面。湖畔是柯尔克孜牧民的夏季牧场，可近距离感受帕米尔牧区生活，也是从喀什前往塔什库尔干途中最值得停留的观景组合。',
        mustSee: true, visitHours: 1, ticketNote: '湖区属喀拉库勒湖景区，开放与门票以景区公告为准',
      },
      {
        id: 'xtl-p-tashkurgan', name: '塔什库尔干石头城', province: '新疆', city: '喀什地区', category: 'ruin',
        lng: 75.238, lat: 37.7828,
        tagline: '帕米尔高原上的汉代西域戍堡，俯瞰金草滩。',
        intro: '位于塔什库尔干县城边的石头城遗址，兴于汉代、延续至唐代，曾是葱岭古道上重要的军事与商旅枢纽。遗址建在台地之上，与脚下的阿拉尔金草滩、远处连绵雪峰同框，是帕米尔人文与自然交织的代表性场景。',
        visitHours: 1, ticketNote: '遗址与金草滩联票管理，开放时间以景区公告为准',
      },
      {
        id: 'xtl-p-khunjerab', name: '红其拉甫口岸', province: '新疆', city: '喀什地区', category: 'culture',
        lng: 75.2312, lat: 37.7645,
        tagline: '中巴边境口岸，海拔约 4700 米的天路终点。',
        intro: '地处帕米尔高原中巴边境的公路口岸，是中国与巴基斯坦喀喇昆仑公路的对接点，海拔约 4700 米。口岸联检建筑与界碑是典型打卡点，周边为高寒荒原；前往需提前确认开放与通行政策，且高原反应风险显著。',
        visitHours: 0.5, ticketNote: '口岸通行与开放受双边政策与季节影响，出行前务必确认',
      },
    ],
  },
  {
    file: 'data/presets/roadbooks/tibet-rings.json',
    routeId: 'ali-grand-loop',
    citiesAdd: ['山南'],
    pois: [
      {
        id: 'agli-p-yamdrok', name: '羊卓雍措', province: '西藏', city: '山南', category: 'water',
        lng: 90.6193, lat: 29.1905,
        tagline: '西藏三大圣湖之一，蜿蜒在冈底斯山脉间的蓝丝带。',
        intro: '简称羊湖，与纳木错、玛旁雍措并称西藏三大圣湖。湖水在群山间蜿蜒出极不规则的岸线，从岗巴拉山口俯瞰是一片深邃的蓝。湖区有观景台供停留，也可沿湖岸多个角度欣赏湖光与远山。',
        mustSee: true, visitHours: 1.5, ticketNote: '湖岸观景台分段管理，开放与收费以景区公告为准',
      },
      {
        id: 'agli-p-karola', name: '卡若拉冰川', province: '西藏', city: '日喀则', category: 'mountain',
        lng: 90.1665, lat: 28.8833,
        tagline: '从公路边就能望见的海洋性冰川，离 G349 极近。',
        intro: '位于浪卡子县与江孜之间的卡若拉山口附近，是西藏离公路最近的冰川之一，冰舌从乃钦康桑峰垂下、几乎触到 G349 路面。受气候变暖影响冰舌持续退缩，是直观感受冰川变化的地点。',
        visitHours: 0.5, ticketNote: '冰川观景区域管理，进入与门票以景区公告为准',
      },
      {
        id: 'agli-p-everest', name: '珠穆朗玛峰大本营', province: '西藏', city: '日喀则', category: 'mountain',
        lng: 86.8434, lat: 28.1648,
        tagline: '世界之巅脚下的观景营地，遥望珠峰旗云。',
        intro: '位于定日县扎西宗乡，是普通游客能抵达的珠峰最近观景点（环保车换乘后到达）。营地面向珠峰，天气好时可清晰看到峰顶与旗云，夜晚银河与日照金山是主要看点。海拔约 5200 米，需防范高原反应。',
        mustSee: true, visitHours: 2, ticketNote: '入山景区需预约并换乘环保车，开放与限流以景区公告为准',
      },
      {
        id: 'agli-p-shishapangma', name: '希夏邦马峰', province: '西藏', city: '日喀则', category: 'mountain',
        lng: 85.7817, lat: 28.3485,
        tagline: '唯一完全在中国境内的 8000 米级山峰。',
        intro: '海拔 8027 米，是全球 14 座 8000 米级山峰中唯一一座整体位于中国境内的，地处聂拉木县。从 318 国道接近可在佩枯措北岸远眺其完整山体，是阿里—日喀则走廊上少有的超高峰观景点。',
        visitHours: 0.5, ticketNote: '为沿途远眺点，靠近与停留以交管与景区公告为准',
      },
      {
        id: 'agli-p-bamco', name: '巴木措', province: '西藏', city: '那曲', category: 'water',
        lng: 90.5798, lat: 31.2334,
        tagline: '纳木错东北侧的高原湖，人少而水色浓烈。',
        intro: '位于班戈县，地处纳木错东北、念青唐古拉山以北的高原面上。相比纳木错景区更安静，湖水呈现出浓烈的蓝绿，周边为开阔牧场，是阿里大北线（班戈—当雄段）上值得停留的小众湖泊。',
        visitHours: 1, ticketNote: '湖岸为开放牧场区域，停留与通行以当地管理为准',
      },
    ],
  },
  {
    file: 'data/presets/roadbooks/tibet-access-south.json',
    routeId: 'yunnan-tibet-line',
    pois: [
      {
        id: 'ytl-p-namcha', name: '南迦巴瓦峰', province: '西藏', city: '林芝', category: 'mountain',
        lng: 95.0561, lat: 29.6284,
        tagline: '林芝的「羞女峰」，中国最美雪山之一。',
        intro: '喜马拉雅东端的最高峰，海拔 7782 米，常年云遮雾绕、难得露面，得名「羞女峰」。位于林芝米林，与雅鲁藏布大峡谷相邻，是观山与峡谷同框的核心。最佳观赏期在秋冬晴朗少云的清晨与傍晚。',
        mustSee: true, visitHours: 1.5, ticketNote: '观景点分布在峡谷与色季拉山口一带，开放以景区公告为准',
      },
      {
        id: 'ytl-p-yarlung', name: '雅鲁藏布大峡谷', province: '西藏', city: '林芝', category: 'landform',
        lng: 94.9375, lat: 29.6128,
        tagline: '世界最深的峡谷，围绕南迦巴瓦的马蹄形大拐弯。',
        intro: '雅鲁藏布江在林芝米林—派镇一带切出世界最深的峡谷，围绕南迦巴瓦峰形成巨大的马蹄形拐弯。景区可乘船或徒步进入，沿途瀑布、桃林与雪山同框，是大拐弯与垂直植被带景观的集中展示区。',
        mustSee: true, visitHours: 3, ticketNote: '景区需购票并按规定线路游览，以公告为准',
      },
      {
        id: 'ytl-p-basum', name: '巴松措', province: '西藏', city: '林芝', category: 'water',
        lng: 93.9679, lat: 30.0079,
        tagline: '林芝深处的国家 5A 湖泊，湖心孤岛寺庙。',
        intro: '位于工布江达县的高山堰塞湖，湖水清澈呈墨绿，湖心岛上有错宗工巴寺，是藏东南少有的「湖中寺」景观。周边森林环抱，四季皆景，春天湖边桃林与雪山相映。',
        visitHours: 2, ticketNote: '景区为 5A 管理，门票与游船以公告为准',
      },
      {
        id: 'ytl-p-galing', name: '嘎朗湖', province: '西藏', city: '林芝', category: 'water',
        lng: 95.6049, lat: 29.9039,
        tagline: '波密冰川脚下的湿地湖泊，桃花季最出片。',
        intro: '位于波密县嘎朗村一带的高原湿地湖泊，背靠念青唐古拉东段冰川群，湖水静谧、倒映雪山森林。每年三月下旬至四月，湖畔桃花与远处冰川同框，是波密桃花沟区域最具代表性的取景点之一。',
        visitHours: 1, ticketNote: '湖畔为乡村与湿地开放区域，停留以当地管理为准',
      },
    ],
  },
  {
    file: 'data/presets/roadbooks/tibet-access-south.json',
    routeId: 'sichuan-tibet-south',
    pois: [
      {
        id: 'cts-p-namcha', name: '南迦巴瓦峰', province: '西藏', city: '林芝', category: 'mountain',
        lng: 95.0561, lat: 29.6284,
        tagline: '林芝的「羞女峰」，中国最美雪山之一。',
        intro: '喜马拉雅东端的最高峰，海拔 7782 米，常年云遮雾绕、难得露面，得名「羞女峰」。位于林芝米林，与雅鲁藏布大峡谷相邻，是观山与峡谷同框的核心。最佳观赏期在秋冬晴朗少云的清晨与傍晚。',
        mustSee: true, visitHours: 1.5, ticketNote: '观景点分布在峡谷与色季拉山口一带，开放以景区公告为准',
      },
      {
        id: 'cts-p-yarlung', name: '雅鲁藏布大峡谷', province: '西藏', city: '林芝', category: 'landform',
        lng: 94.9375, lat: 29.6128,
        tagline: '世界最深的峡谷，围绕南迦巴瓦的马蹄形大拐弯。',
        intro: '雅鲁藏布江在林芝米林—派镇一带切出世界最深的峡谷，围绕南迦巴瓦峰形成巨大的马蹄形拐弯。景区可乘船或徒步进入，沿途瀑布、桃林与雪山同框，是大拐弯与垂直植被带景观的集中展示区。',
        mustSee: true, visitHours: 3, ticketNote: '景区需购票并按规定线路游览，以公告为准',
      },
      {
        id: 'cts-p-basum', name: '巴松措', province: '西藏', city: '林芝', category: 'water',
        lng: 93.9679, lat: 30.0079,
        tagline: '林芝深处的国家 5A 湖泊，湖心孤岛寺庙。',
        intro: '位于工布江达县的高山堰塞湖，湖水清澈呈墨绿，湖心岛上有错宗工巴寺，是藏东南少有的「湖中寺」景观。周边森林环抱，四季皆景，春天湖边桃林与雪山相映。',
        visitHours: 2, ticketNote: '景区为 5A 管理，门票与游船以公告为准',
      },
      {
        id: 'cts-p-hailuogou', name: '海螺沟', province: '四川', city: '甘孜藏族自治州', category: 'mountain',
        lng: 102.0055, lat: 29.579,
        tagline: '贡嘎东坡的低海拔现代冰川，可近距离走到冰舌。',
        intro: '位于甘孜州泸定县磨西镇，是贡嘎山东坡的现代海洋性冰川，因海拔较低（冰舌下探至约 2900 米）而能近距离观赏巨大冰瀑布与冰川弧拱。沟内原始森林与温泉并存，是川藏线康定—泸定段的经典冰川景点。',
        visitHours: 3, ticketNote: '景区需购票并换乘观光车，以公告为准',
      },
      {
        id: 'cts-p-bangda', name: '邦达草原', province: '西藏', city: '昌都', category: 'grassland',
        lng: 97.2925, lat: 30.2085,
        tagline: '昌都高原上的辽阔草甸，318 与 214 交汇的牧区。',
        intro: '位于八宿县邦达镇一带的高原草甸，海拔约 4200 米，是 318 国道与 214 国道交汇附近的典型牧区。地势平阔、夏季水草丰美，周边有邦达机场与连绵的山丘，是川藏线上感受高原牧场风光的一站。',
        visitHours: 0.5, ticketNote: '草原为开放牧区，停留与通行以当地管理为准',
      },
    ],
  },
];

/** 找到从 fromIndex 起、首个包含 marker 的行里的 `[`，并返回其匹配 `]` 的行号 */
function findArrayClose(lines, fromIndex, marker) {
  let start = -1;
  for (let i = fromIndex; i < lines.length; i++) {
    if (lines[i].includes(marker)) { start = i; break; }
  }
  if (start < 0) throw new Error(`找不到 ${marker}`);
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) return i; }
    }
  }
  throw new Error(`未找到 ${marker} 的匹配 ]`);
}

function formatPoi(p) {
  // JSON.stringify 2 空格 → 整体加 8 空格前缀（对象括号到 8、字段到 10）
  return JSON.stringify(p, null, 2).split('\n').map((l) => '        ' + l).join('\n');
}

function processAddition(a) {
  let s = readFileSync(a.file, 'utf8');
  const lines = s.split('\n');
  let rs = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`"id": "${a.routeId}"`)) { rs = i; break; }
  }
  if (rs < 0) throw new Error(`未找到路线 ${a.routeId} in ${a.file}`);

  // 1) 可选：给 cities[] 补城市
  if (a.citiesAdd && a.citiesAdd.length) {
    const cClose = findArrayClose(lines, rs, '"cities": [');
    const cityText = lines.slice(cClose - 1, cClose).join('\n'); // 不含 ] 的内容行
    const already = a.citiesAdd.every((c) => cityText.includes(`"${c}"`));
    if (!already) {
      // 在 cities 数组闭合 ] 前插入
      const addStr = a.citiesAdd.map((c) => `        "${c}"`).join(',\n');
      const lastCityLine = cClose - 1;
      lines[lastCityLine] = lines[lastCityLine].replace(/\s+$/, '');
      if (!lines[lastCityLine].endsWith(',')) lines[lastCityLine] += ',';
      lines.splice(cClose, 0, ...addStr.split('\n'));
      console.log(`  [cities] ${a.routeId} 追加 ${JSON.stringify(a.citiesAdd)}`);
    }
  }

  // 重新读取（若上面 splice 改变了行号，cities 的插入不影响 pois 的相对查找，但需重算）
  // 2) 给 pois[] 插入新景点
  const pClose = findArrayClose(lines, rs, '"pois": [');
  // 给原最后 POI 的 closing brace 补逗号
  const lastPoiClose = pClose - 1;
  lines[lastPoiClose] = lines[lastPoiClose].replace(/\s+$/, '');
  if (!lines[lastPoiClose].endsWith(',')) lines[lastPoiClose] += ',';
  const poiBlocks = a.pois.map(formatPoi);
  const insertLines = poiBlocks.join(',\n').split('\n');
  lines.splice(pClose, 0, ...insertLines);

  writeFileSync(a.file, lines.join('\n'));
  console.log(`  ✓ ${a.routeId} (${a.file}) 新增 ${a.pois.length} 个 POI`);
}

let total = 0;
for (const a of ADDITIONS) {
  console.log(`\n处理 ${a.routeId}`);
  processAddition(a);
  total += a.pois.length;
}
console.log(`\n全部完成：新增 ${total} 个真实景点。`);
