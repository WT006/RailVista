/**
 * 生成 data/presets/scenic-spots.json（策展第一版）
 * node scripts/build-scenic-spots-curated.mjs
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '../data/presets/scenic-spots.json');

function spot(o) {
  if (!o.id || !o.name || o.lng == null || o.lat == null || !o.intro || !o.visibility) {
    throw new Error('invalid spot: ' + JSON.stringify(o));
  }
  if (!['window', 'distant', 'on_track'].includes(o.visibility)) {
    throw new Error(`${o.id}: bad visibility`);
  }
  const row = {
    id: o.id,
    name: o.name,
    lng: Number(o.lng.toFixed(6)),
    lat: Number(o.lat.toFixed(6)),
    intro: o.intro,
    visibility: o.visibility,
    source: o.source || 'curated',
  };
  if (o.maxDistKm != null) row.maxDistKm = o.maxDistKm;
  if (o.category) row.category = o.category;
  if (o.nightOnly) row.nightOnly = true;
  // —— v3 纯扩展字段（docs/scenic-schema-v3.md）；lineHints 仅用于自动回填，不落盘 ——
  if (o.viewScale) row.viewScale = o.viewScale;
  if (o.viewMinutes != null) row.viewMinutes = o.viewMinutes;
  if (o.dimensions) row.dimensions = o.dimensions;
  if (o.subtype) row.subtype = o.subtype;
  if (o.tags) row.tags = o.tags;
  if (o.bestView) row.bestView = o.bestView;
  if (o.sources) row.sources = o.sources;
  if (o.verification) row.verification = o.verification;
  if (o.reviewedAt) row.reviewedAt = o.reviewedAt;
  if (o.reviewRound) row.reviewRound = o.reviewRound;
  if (o.status) row.status = o.status;
  if (o.province) row.province = o.province;
  if (o.honors) row.honors = o.honors;
  if (o.side) row.side = o.side;
  if (o.lineHints) row.__lineHints = o.lineHints;
  return row;
}

const spots = [];

// —— 青藏（Z8991 迁移）——
spots.push(
  spot({
    id: 'qinghai-lake',
    name: '青海湖',
    lng: 100.05,
    lat: 37.18,
    visibility: 'window',
    category: 'lake',
    nightOnly: true,
    source: 'preset',
    maxDistKm: 15,
    intro:
      '中国最大的内陆咸水湖，青藏铁路沿湖北岸一带穿行，可饱览碧湖、草原与雪山同框的高原盛景。',
  }),
  spot({
    id: 'chaerhan-salt-bridge',
    name: '察尔汗盐湖（万丈盐桥）',
    lng: 95.192077,
    lat: 36.949738,
    visibility: 'on_track',
    category: 'engineering',
    nightOnly: true,
    source: 'preset',
    intro:
      '中国最大天然盐湖，青藏铁路从约 32 公里「万丈盐桥」上通过，路基由盐壳筑成，是罕见的盐质铁路通道。',
  }),
  spot({
    id: 'qaidam-gobi',
    name: '柴达木盆地戈壁',
    lng: 94.6,
    lat: 36.55,
    visibility: 'window',
    category: 'desert',
    nightOnly: true,
    source: 'preset',
    maxDistKm: 15,
    intro:
      '柴达木盆地核心荒漠带，铁路横穿戈壁与雅丹地貌，是全线苍茫感最强、人烟稀少的荒漠穿行区段。',
  }),
  spot({
    id: 'kunlun-pass',
    name: '昆仑山口',
    lng: 94.069242,
    lat: 35.64013,
    visibility: 'on_track',
    category: 'mountain',
    source: 'preset',
    intro: '海拔约 4768 米，青藏铁路翻越昆仑山的核心隘口，素有「进藏第一关」之称。',
  }),
  spot({
    id: 'yuzhu-peak',
    name: '玉珠峰',
    lng: 94.238052,
    lat: 35.655018,
    visibility: 'distant',
    category: 'mountain',
    source: 'preset',
    intro: '昆仑山东段高峰，海拔 6178 米，是沿线第一座醒目的 6000 米级雪山，终年积雪。',
  }),
  spot({
    id: 'kekexili',
    name: '可可西里无人区',
    lng: 93.5,
    lat: 35.3,
    visibility: 'window',
    category: 'other',
    source: 'preset',
    maxDistKm: 12,
    intro:
      '世界自然遗产地，铁路沿其北缘穿行，是藏羚羊、藏野驴等高原野生动物较集中的观测区段。',
  }),
  spot({
    id: 'wudaoliang',
    name: '五道梁高原荒原',
    lng: 93.08206,
    lat: 35.217307,
    visibility: 'window',
    category: 'grassland',
    source: 'preset',
    intro: '高寒缺氧典型段，气候极端，是全线含氧量低、荒原感极强的高原穿行区。',
  }),
  spot({
    id: 'fenghuoshan',
    name: '风火山',
    lng: 92.911295,
    lat: 34.67715,
    visibility: 'on_track',
    category: 'engineering',
    source: 'preset',
    intro:
      '世界海拔最高冻土隧道——风火山隧道所在地，青藏铁路攻克多年冻土难题的标志性工程点。',
  }),
  spot({
    id: 'tuotuohe-source',
    name: '沱沱河（长江正源）',
    lng: 92.330821,
    lat: 34.232831,
    visibility: 'window',
    category: 'other',
    source: 'preset',
    intro: '长江正源水系，铁路跨越长江源特大桥，可近距离俯瞰江源宽谷风光。',
  }),
  spot({
    id: 'tongtian-river',
    name: '通天河',
    lng: 92.533285,
    lat: 33.868366,
    visibility: 'window',
    category: 'other',
    source: 'preset',
    intro: '长江上游干流，铁路跨越通天河谷，是江源宽谷向高山峡谷过渡的地貌分界。',
  }),
  spot({
    id: 'sanjiangyuan',
    name: '三江源自然保护区',
    lng: 92.443193,
    lat: 34.216085,
    visibility: 'window',
    category: 'other',
    source: 'preset',
    maxDistKm: 12,
    intro:
      '「中华水塔」，长江、黄河、澜沧江发源地保育区，铁路穿行全球海拔最高的高原湿地生态带之一。',
  }),
  spot({
    id: 'tanggula-pass',
    name: '唐古拉山口',
    lng: 91.920087,
    lat: 32.86254,
    visibility: 'on_track',
    category: 'mountain',
    source: 'preset',
    intro: '海拔约 5072 米，青藏铁路与世界铁路海拔制高点一带，亦是青、藏省界山口。',
  }),
  spot({
    id: 'geladandong',
    name: '格拉丹东峰（远眺）',
    lng: 91.166738,
    lat: 33.496069,
    visibility: 'distant',
    category: 'mountain',
    source: 'preset',
    maxDistKm: 75,
    intro: '唐古拉山脉主峰（约 6621 米），长江源头冰川所在，铁路沿线可远眺巍峨雪峰。',
  }),
  spot({
    id: 'cuona-lake',
    name: '措那湖',
    lng: 91.425851,
    lat: 31.996877,
    visibility: 'window',
    category: 'lake',
    source: 'preset',
    intro: '世界海拔最高淡水湖之一，铁路紧贴湖岸，湖天一色，视野开阔。',
  }),
  spot({
    id: 'qiangtang-grassland',
    name: '羌塘草原（藏北草原）',
    lng: 91.2,
    lat: 31.2,
    visibility: 'window',
    category: 'grassland',
    source: 'preset',
    maxDistKm: 15,
    intro: '西藏面积最大的天然草原带之一，铁路纵贯腹地，可见游牧风情与辽阔草场。',
  }),
  spot({
    id: 'nyainqentanglha',
    name: '念青唐古拉山脉',
    lng: 90.809049,
    lat: 30.527848,
    visibility: 'distant',
    category: 'mountain',
    source: 'preset',
    intro: '藏地著名神山山脉，铁路沿其南麓延伸，雪峰与草原河谷反差强烈。',
  }),
  spot({
    id: 'namtso-distant',
    name: '纳木错（远观）',
    lng: 90.468056,
    lat: 30.720833,
    visibility: 'distant',
    category: 'lake',
    source: 'preset',
    maxDistKm: 50,
    intro: '西藏三大圣湖之首，当雄一带可远眺湛蓝湖面。',
  }),
  spot({
    id: 'yangbajing-geothermal',
    name: '羊八井地热温泉',
    lng: 90.499117,
    lat: 30.061468,
    visibility: 'window',
    category: 'other',
    source: 'preset',
    intro: '中国著名高温地热田，沿线可见地热蒸汽升腾，兼具地热奇观气质。',
  }),
);

// —— 拉林 ——
spots.push(
  spot({
    id: 'yarlung-tsangpo-gorge-lalin',
    name: '雅鲁藏布江峡谷（拉林段）',
    lng: 92.8,
    lat: 29.2,
    visibility: 'window',
    category: 'gorge',
    intro: '拉林铁路沿雅鲁藏布江深切河谷穿行，可见陡峭峡谷与「雪域江南」过渡风光。',
  }),
  spot({
    id: 'zang-southeast-forest',
    name: '藏东南林海湿地',
    lng: 93.5,
    lat: 29.18,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '藏东南湿润气候带，铁路两侧可见森林、河谷农田与雪山交织的景观。',
  }),
  spot({
    id: 'nyingchi-peach-blossom',
    name: '林芝桃花谷方向',
    lng: 94.36,
    lat: 29.57,
    visibility: 'window',
    category: 'other',
    intro: '林芝一带春季桃花闻名，「坐着火车看桃花」热门主题，周边雪山与桃花同框。',
  }),
  spot({
    id: 'namcha-barwa-distant',
    name: '南迦巴瓦峰（远眺）',
    lng: 95.055278,
    lat: 29.630556,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 65,
    intro: '「中国最美山峰」之一，林芝附近天气晴好时可远眺金字塔形雪峰。',
  }),
  spot({
    id: 'lalin-sangri-valley',
    name: '桑日—加查河谷',
    lng: 92.3,
    lat: 29.25,
    visibility: 'window',
    category: 'gorge',
    intro: '雅江中游河谷段，铁路贴江而行，可见河谷阶地与藏南田园。',
  }),
);

// —— 拉日 ——
spots.push(
  spot({
    id: 'yarlung-valley-lari',
    name: '雅鲁藏布江河谷（拉日段）',
    lng: 90.7,
    lat: 29.35,
    visibility: 'window',
    category: 'gorge',
    intro: '拉日铁路沿雅江河谷西行，可见宽谷江面与藏南田园风光。',
  }),
  spot({
    id: 'yamdrok-distant',
    name: '羊卓雍措方向（远眺）',
    lng: 90.4,
    lat: 29.1,
    visibility: 'distant',
    category: 'lake',
    intro: '西藏三大圣湖之一方向，拉日线部分区段天气好时可远眺湖光山色。',
  }),
  spot({
    id: 'shigatse-plain',
    name: '日喀则河谷平原',
    lng: 88.88,
    lat: 29.27,
    visibility: 'window',
    category: 'other',
    intro: '藏南重要农牧平原，进入日喀则前可见开阔河谷与田园聚落。',
  }),
);

// —— 川青 ——
spots.push(
  spot({
    id: 'sanxingdui-area',
    name: '三星堆方向',
    lng: 104.12,
    lat: 31.08,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 20,
    intro: '古蜀文明重要遗址区域，川青铁路经三星堆站一带，可衔接短途探访。',
  }),
  spot({
    id: 'minjiang-gorge-chuanqing',
    name: '岷江峡谷（茂县段）',
    lng: 103.79,
    lat: 31.98,
    visibility: 'window',
    category: 'gorge',
    intro: '铁路穿行岷江河谷与羌族山地，可见陡峭峡谷与羌藏村寨。',
  }),
  spot({
    id: 'songpan-grassland',
    name: '松潘草原',
    lng: 103.64,
    lat: 32.52,
    visibility: 'window',
    category: 'grassland',
    intro: '川西北高原草甸风光，松潘站一带可见开阔草原与远山。',
  }),
  spot({
    id: 'huanglong-jiuzhai-portal',
    name: '黄龙九寨门户',
    lng: 103.696,
    lat: 32.786,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 25,
    intro: '黄龙九寨站为黄龙、九寨沟景区铁路门户，钙华彩池与九寨风光需转乘进入。',
  }),
);

// —— 兰新高铁 ——
spots.push(
  spot({
    id: 'menyuan-rapeseed',
    name: '门源油菜花海',
    lng: 101.62,
    lat: 37.38,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '青海门源夏季万亩油菜花海闻名，西宁—门源段是「花海列车」热门观景主题。',
  }),
  spot({
    id: 'qilian-snow-lanxin',
    name: '祁连雪山（远眺）',
    lng: 100.8,
    lat: 38.2,
    visibility: 'distant',
    category: 'mountain',
    intro: '河西走廊南侧祁连山脉，民乐—张掖一带可远眺皑皑雪峰。',
  }),
  spot({
    id: 'hexi-corridor-gobi',
    name: '河西走廊戈壁',
    lng: 100.43,
    lat: 38.92,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 12,
    intro: '张掖以西戈壁绿洲交错，高铁穿行大漠旷野，河西走廊苍茫感强烈。',
  }),
  spot({
    id: 'zhangye-danxia-distant',
    name: '张掖丹霞方向（远眺）',
    lng: 100.166089,
    lat: 39.094139,
    visibility: 'distant',
    category: 'other',
    intro: '七彩丹霞景区方向，张掖西站可转乘前往；铁路本身以戈壁与远山为主。',
  }),
  spot({
    id: 'jiayuguan-fort-distant',
    name: '嘉峪关长城方向',
    lng: 98.31,
    lat: 39.72,
    visibility: 'distant',
    category: 'engineering',
    maxDistKm: 20,
    intro: '明代长城西端重镇方向，嘉峪关南站为河西走廊标志性文化节点。',
  }),
  spot({
    id: 'turpan-flaming-mountain',
    name: '吐鲁番火焰山方向',
    lng: 89.5,
    lat: 42.9,
    visibility: 'distant',
    category: 'mountain',
    intro: '吐鲁番盆地赤褐色山地景观方向，吐鲁番北站一带进入火焰山与绿洲过渡带。',
  }),
  spot({
    id: 'hami-oasis',
    name: '哈密绿洲',
    lng: 93.51,
    lat: 42.83,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '东疆重要绿洲节点，铁路两侧可见戈壁环抱的绿洲田园。',
  }),
);

// —— 敦格 ——
spots.push(
  spot({
    id: 'dunhuang-mogao-distant',
    name: '敦煌莫高窟方向',
    lng: 94.8,
    lat: 40.04,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 25,
    intro: '世界文化遗产莫高窟方向，敦煌站为「大漠新丝路」门户；洞窟需进城探访。',
  }),
  spot({
    id: 'yardang-geomorphology',
    name: '雅丹地貌（敦格沿线）',
    lng: 94.8453,
    lat: 39.3109,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 15,
    intro: '敦格铁路穿越雅丹与戈壁，风蚀地貌「类火星」景观是大漠段标志看点。',
  }),
  spot({
    id: 'dangjinshan-pass',
    name: '当金山口一带',
    lng: 94.6297,
    lat: 38.0676,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 8,
    intro: '敦格线翻越当金山一带，可见祁连西段山地与柴达木北缘过渡风光。',
  }),
  spot({
    id: 'emerald-lake-distant',
    name: '翡翠湖方向（大柴旦）',
    lng: 95.2,
    lat: 37.85,
    visibility: 'distant',
    category: 'lake',
    intro: '大柴旦翡翠湖等盐湖群方向，柴达木段可感受盐湖盆地苍茫气质。',
  }),
);

// —— 格库 ——
spots.push(
  spot({
    id: 'altun-mountains',
    name: '阿尔金山一带',
    lng: 94.8899,
    lat: 38.4897,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 50,
    intro: '格库/敦格铁路穿越阿尔金山地区，可见高原荒漠与山脉交错的无人区气质。',
  }),
  spot({
    id: 'taklamakan-south-geku',
    name: '塔克拉玛干南缘（格库）',
    lng: 88.5,
    lat: 39.0,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 15,
    intro: '铁路贴近沙漠南缘，戈壁、沙丘与绿洲交替，是环塔通道重要段落。',
  }),
  spot({
    id: 'taitema-lake',
    name: '台特玛湖方向',
    lng: 88.3,
    lat: 39.4,
    visibility: 'distant',
    category: 'lake',
    intro: '塔里木河尾闾湖方向，若羌以西可见干涸湖盆与荒漠景观。',
  }),
);

// —— 和若 ——
spots.push(
  spot({
    id: 'taklamakan-ring-heruo',
    name: '塔克拉玛干南缘（和若）',
    lng: 82.0,
    lat: 37.0,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 12,
    intro: '环沙漠铁路环线一段，可见防沙治沙工程与沙丘「铁龙同框」。',
  }),
  spot({
    id: 'kunlun-north-foothill',
    name: '昆仑山北麓',
    lng: 80.5,
    lat: 36.8,
    visibility: 'distant',
    category: 'mountain',
    intro: '和田—于田一带北望昆仑雪峰，南疆绿洲与雪山对照鲜明。',
  }),
  spot({
    id: 'desert-sunset-heruo',
    name: '沙漠长河落日段',
    lng: 86.4837,
    lat: 38.6695,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 15,
    intro: '且末—若羌戈壁沙漠段，日落时分天际线极具「长河落日」氛围。',
  }),
);

// —— 南疆 ——
spots.push(
  spot({
    id: 'tianshan-south-nanjiang',
    name: '天山南麓',
    lng: 86.5,
    lat: 42.0,
    visibility: 'distant',
    category: 'mountain',
    intro: '库尔勒以西可见天山南麓，绿洲与雪山相望。',
  }),
  spot({
    id: 'bosten-lake-distant',
    name: '博斯腾湖方向',
    lng: 86.8,
    lat: 41.95,
    visibility: 'distant',
    category: 'lake',
    maxDistKm: 40,
    intro: '中国最大内陆淡水湖之一方向，焉耆—库尔勒一带湖区平原开阔。',
  }),
  spot({
    id: 'kuqa-canyon-distant',
    name: '库车大峡谷方向',
    lng: 83.5,
    lat: 41.7,
    visibility: 'distant',
    category: 'gorge',
    intro: '库车站周边可转往天山神秘大峡谷；铁路可见南疆绿洲与戈壁过渡。',
  }),
  spot({
    id: 'tarim-oasis-belt',
    name: '塔里木盆地绿洲带',
    lng: 80.5,
    lat: 41.2,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '阿克苏—喀什绿洲连绵，铁路穿行棉田、白杨与沙漠边缘。',
  }),
  spot({
    id: 'pamir-kashgar-distant',
    name: '帕米尔方向（喀什）',
    lng: 76.05,
    lat: 39.49,
    visibility: 'distant',
    category: 'mountain',
    intro: '南疆铁路终点喀什，西望帕米尔高原方向，丝路门户气质浓厚。',
  }),
);

// —— 临哈 / 胡杨 ——
spots.push(
  spot({
    id: 'ejina-populus',
    name: '额济纳胡杨林',
    lng: 101.07,
    lat: 41.96,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '金秋胡杨闻名全国，胡杨专列终点区域，10 月金色胡杨是西北铁路经典主题。',
  }),
  spot({
    id: 'badan-jaran-edge',
    name: '巴丹吉林沙漠边缘',
    lng: 102.5,
    lat: 41.5,
    visibility: 'distant',
    category: 'desert',
    intro: '临哈铁路穿越沙漠边缘，可见沙丘起伏与戈壁旷野。',
  }),
  spot({
    id: 'heishui-city-distant',
    name: '黑水城遗址方向',
    lng: 101.15,
    lat: 41.78,
    visibility: 'distant',
    category: 'other',
    intro: '西夏黑水城遗址方向，额济纳旗重要人文景点，可与胡杨林联游。',
  }),
  spot({
    id: 'juyan-lake-distant',
    name: '居延海方向',
    lng: 101.26,
    lat: 42.29,
    visibility: 'distant',
    category: 'lake',
    maxDistKm: 40,
    intro: '居延海方向，额济纳湿地与沙漠交错景观。',
  }),
);

// —— 丽香 ——
spots.push(
  spot({
    id: 'yulong-snow-mountain',
    name: '玉龙雪山',
    lng: 100.18,
    lat: 27.1,
    visibility: 'distant',
    category: 'mountain',
    intro: '丽江标志性雪山，丽香铁路出丽江后可远眺玉龙十三峰。',
  }),
  spot({
    id: 'lashi-lake',
    name: '拉市海湿地',
    lng: 100.14,
    lat: 26.88,
    visibility: 'window',
    category: 'lake',
    intro: '高原湿地拉市海，经拉市海站一带可见湖光与候鸟栖息地风貌。',
  }),
  spot({
    id: 'tiger-leaping-gorge-bridge',
    name: '虎跳峡金沙江大桥',
    lng: 100.05,
    lat: 27.18,
    visibility: 'on_track',
    category: 'gorge',
    intro: '丽香铁路跨金沙江特大桥飞越虎跳峡上空，官方广播常提示观景，峡谷险峻。',
  }),
  spot({
    id: 'haba-snow-mountain',
    name: '哈巴雪山（远眺）',
    lng: 100.08,
    lat: 27.35,
    visibility: 'distant',
    category: 'mountain',
    intro: '虎跳峡北岸哈巴雪山，与玉龙雪山隔江对峙，跨江段可远眺。',
  }),
  spot({
    id: 'xiaozhongdian-meadow',
    name: '小中甸花海草甸',
    lng: 99.8,
    lat: 27.55,
    visibility: 'window',
    category: 'grassland',
    intro: '小中甸高原草甸与花海，夏秋时节五彩斑斓，香格里拉门户风景。',
  }),
  spot({
    id: 'shangri-la-plateau',
    name: '香格里拉高原',
    lng: 99.69,
    lat: 27.81,
    visibility: 'window',
    category: 'grassland',
    intro: '滇西北高原终点风光，可衔接普达措、独克宗古城等探访。',
  }),
);

// —— 中老国内段 ——
spots.push(
  spot({
    id: 'yuanjiang-bridge',
    name: '元江特大桥',
    lng: 102.05,
    lat: 23.67,
    visibility: 'on_track',
    category: 'engineering',
    intro: '中老铁路著名高桥之一，跨越元江河谷，桥高与峡谷落差冲击力强。',
  }),
  spot({
    id: 'puer-tea-mountains',
    name: '普洱茶山云雾',
    lng: 100.97,
    lat: 22.74,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '普洱一带万亩茶山与云雾梯田，中老铁路「一站一景」中的茶乡段落。',
  }),
  spot({
    id: 'xishuangbanna-rainforest',
    name: '西双版纳热带雨林',
    lng: 100.94,
    lat: 22.26,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '亚洲象栖息与热带雨林景观区，进入傣乡后植被与湿热气候骤变。',
  }),
  spot({
    id: 'dai-villages-banna',
    name: '傣家村寨与佛塔',
    lng: 100.8,
    lat: 22.0,
    visibility: 'window',
    category: 'other',
    intro: '西双版纳—勐腊一带可见傣家竹楼、金塔与热带田园。',
  }),
  spot({
    id: 'mohan-border-gateway',
    name: '磨憨口岸门户',
    lng: 101.68,
    lat: 21.18,
    visibility: 'window',
    category: 'other',
    intro: '中老铁路国内段终点口岸，跨境通道象征，热带边境风光。',
  }),
);

// —— 大丽 / 昆丽 ——
spots.push(
  spot({
    id: 'erhai-cangshan',
    name: '苍山洱海',
    lng: 100.2,
    lat: 25.7,
    visibility: 'window',
    category: 'lake',
    maxDistKm: 12,
    intro: '大理标志性山水，大丽铁路北上可见洱海湖光与苍山十九峰。',
  }),
  spot({
    id: 'bai-villages-rice',
    name: '白族村寨与稻田',
    lng: 100.25,
    lat: 26.2,
    visibility: 'window',
    category: 'other',
    intro: '鹤庆—丽江段可见白族聚落、田园与低缓山地交错。',
  }),
);

// —— 成昆 ——
spots.push(
  spot({
    id: 'dadu-river-gorge',
    name: '大渡河峡谷',
    lng: 103.1,
    lat: 29.3,
    visibility: 'window',
    category: 'gorge',
    maxDistKm: 12,
    intro: '成昆铁路经典峡谷段，关村坝等桥隧密集，横断山脉险峻风光。',
  }),
  spot({
    id: 'jinkouhe-canyon',
    name: '金口河峡谷',
    lng: 103.05,
    lat: 29.25,
    visibility: 'window',
    category: 'gorge',
    intro: '大渡河深切峡谷，桥隧相连，是成昆「征服自然」叙事的代表性段落。',
  }),
  spot({
    id: 'anning-river-valley',
    name: '安宁河谷田园',
    lng: 102.25,
    lat: 27.9,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '西昌一带安宁河宽谷，可见攀西田园与河谷平原。',
  }),
  spot({
    id: 'qionghai-distant',
    name: '邛海方向（西昌）',
    lng: 102.3,
    lat: 27.82,
    visibility: 'distant',
    category: 'lake',
    intro: '西昌邛海方向，高原淡水湖与城市绿洲气质。',
  }),
  spot({
    id: 'jinsha-bridge-chengkun',
    name: '金沙江大桥一带',
    lng: 101.7,
    lat: 26.6,
    visibility: 'on_track',
    category: 'engineering',
    intro: '成昆线跨越金沙江的标志性工程段落，江峡与钢桥同框。',
  }),
);

// —— 滇越 ——
spots.push(
  spot({
    id: 'renzi-bridge',
    name: '人字桥',
    lng: 103.68,
    lat: 23.15,
    visibility: 'on_track',
    category: 'engineering',
    intro: '滇越铁路世界级工程奇迹，钢桁架悬挂绝壁，屏边一带标志性看点。',
  }),
  spot({
    id: 'bisezhai-station',
    name: '碧色寨法式车站',
    lng: 103.4,
    lat: 23.45,
    visibility: 'window',
    category: 'other',
    intro: '百年米轨法式站房，《芳华》取景地，滇越铁路人文地标。',
  }),
  spot({
    id: 'wantang-waterfall',
    name: '湾塘火车与瀑布',
    lng: 103.55,
    lat: 23.0,
    visibility: 'window',
    category: 'other',
    intro: '米轨与瀑布同框的经典摄影点，滇南山林水汽氤氲。',
  }),
  spot({
    id: 'hekou-border',
    name: '河口边境风光',
    lng: 103.95,
    lat: 22.52,
    visibility: 'window',
    category: 'other',
    intro: '滇越铁路云南段终点，红河口岸与中越边境城镇风貌。',
  }),
);

// —— 云桂 / 南昆客专 ——
spots.push(
  spot({
    id: 'puzhehei-karst',
    name: '普者黑喀斯特山水',
    lng: 104.12,
    lat: 24.14,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '「三生三世」取景地，峰林湖泊交织，云桂高铁标志性风景站区。',
  }),
  spot({
    id: 'guangnan-countryside',
    name: '文山田园峰林',
    lng: 105.0,
    lat: 24.0,
    visibility: 'window',
    category: 'other',
    intro: '滇桂交界喀斯特峰林与田园，高铁穿行绿丘与溶蚀地貌。',
  }),
  spot({
    id: 'baise-youjiang',
    name: '百色右江河谷',
    lng: 106.62,
    lat: 23.9,
    visibility: 'window',
    category: 'other',
    intro: '右江河谷田园与红色故地气质，云贵高原向广西盆地过渡带。',
  }),
);

// —— 宜万 ——
spots.push(
  spot({
    id: 'wuling-karst-yiwan',
    name: '武陵山喀斯特',
    lng: 109.5,
    lat: 30.4,
    visibility: 'window',
    category: 'gorge',
    maxDistKm: 12,
    intro: '宜万铁路「桥隧博物馆」主体，岩溶、河谷与高桥密集。',
  }),
  spot({
    id: 'yesanguan-bridge',
    name: '野三河大桥一带',
    lng: 110.3,
    lat: 30.7,
    visibility: 'on_track',
    category: 'engineering',
    intro: '巴东野三关附近高桥深谷，宜万线标志性工程景观。',
  }),
  spot({
    id: 'enshi-grand-canyon-distant',
    name: '恩施大峡谷方向',
    lng: 109.2,
    lat: 30.5,
    visibility: 'distant',
    category: 'gorge',
    intro: '恩施站周边可转往大峡谷景区；铁路本身可见清江流域山地。',
  }),
  spot({
    id: 'qingjiang-gallery-distant',
    name: '清江画廊方向',
    lng: 109.4,
    lat: 30.35,
    visibility: 'distant',
    category: 'gorge',
    intro: '清江流域山水画廊方向，利川—恩施段山地河谷连绵。',
  }),
);

// —— 渝利 ——
spots.push(
  spot({
    id: 'three-gorges-reservoir',
    name: '三峡库区山色',
    lng: 107.4,
    lat: 29.7,
    visibility: 'window',
    category: 'gorge',
    maxDistKm: 12,
    intro: '渝利铁路穿越三峡库区山地，可见长江支流河谷与喀斯特峰丛。',
  }),
  spot({
    id: 'wujiang-gallery-distant',
    name: '乌江画廊方向',
    lng: 107.5,
    lat: 29.5,
    visibility: 'distant',
    category: 'gorge',
    intro: '涪陵一带乌江入江方向，峡谷水色为渝东南经典主题。',
  }),
);

// —— 贵广 ——
spots.push(
  spot({
    id: 'guilin-karst',
    name: '桂林喀斯特峰林',
    lng: 110.3,
    lat: 25.3,
    visibility: 'window',
    category: 'other',
    maxDistKm: 15,
    intro: '贵广高铁穿行桂林峰林，可见「山水甲天下」的塔状喀斯特。',
  }),
  spot({
    id: 'yangshuo-lijiang-distant',
    name: '阳朔漓江方向（远眺）',
    lng: 110.5,
    lat: 24.78,
    visibility: 'distant',
    category: 'other',
    intro: '「20 元人民币背景」方向，阳朔站周边可转漓江观景。',
  }),
  spot({
    id: 'miaoling-mountains',
    name: '苗岭山地',
    lng: 107.5,
    lat: 26.3,
    visibility: 'window',
    category: 'mountain',
    intro: '黔南苗岭山区，贵广高铁桥隧穿行绿丘与峡谷。',
  }),
);

// —— 西成 ——
spots.push(
  spot({
    id: 'qinling-forest',
    name: '秦岭林海',
    lng: 108.0,
    lat: 33.9,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 12,
    intro: '首条穿越秦岭的高铁，春雪秋色林海是西成线核心窗景。',
  }),
  spot({
    id: 'hanzhong-basin',
    name: '汉中盆地花海',
    lng: 107.98,
    lat: 33.5,
    visibility: 'window',
    category: 'other',
    intro: '汉中盆地油菜花与稻田季节景观，南北气候分界的田园段落。',
  }),
  spot({
    id: 'jianmenguan',
    name: '剑门关',
    lng: 105.58,
    lat: 32.32,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 20,
    intro: '蜀道雄关方向，西成高铁剑门关站为川北门户标志。',
  }),
);

// —— 成贵 ——
spots.push(
  spot({
    id: 'leshan-buddha-distant',
    name: '乐山大佛方向',
    lng: 103.77,
    lat: 29.55,
    visibility: 'distant',
    category: 'other',
    intro: '乐山站周边世界文化遗产乐山大佛方向，岷江—大渡河交汇地带。',
  }),
  spot({
    id: 'shunan-bamboo-distant',
    name: '蜀南竹海方向',
    lng: 104.98,
    lat: 28.5,
    visibility: 'distant',
    category: 'other',
    intro: '宜宾—长宁一带竹海景区方向，成贵线川南绿色走廊。',
  }),
  spot({
    id: 'wumeng-mountains',
    name: '乌蒙山',
    lng: 105.3,
    lat: 27.3,
    visibility: 'window',
    category: 'mountain',
    intro: '成贵高铁穿乌蒙山区，高原峡谷与桥隧景观密集。',
  }),
);

// —— 渝贵 ——
spots.push(
  spot({
    id: 'loushanguan',
    name: '娄山关',
    lng: 106.896401,
    lat: 28.037235,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 12,
    intro: '黔北娄山关关隘与喀斯特山地（关城一带）；渝贵铁路从关隘一侧穿行，车窗可见峰丛峡谷。',
  }),
  spot({
    id: 'zunyi-karst',
    name: '黔北喀斯特峡谷',
    lng: 106.97,
    lat: 27.65,
    visibility: 'window',
    category: 'gorge',
    maxDistKm: 10,
    intro: '遵义以南峰丛峡谷与河谷（地貌范围内靠铁路东侧取点）；高铁桥隧与岩溶同框。',
  }),
);

// —— 宝成 ——
spots.push(
  spot({
    id: 'qinling-switchback',
    name: '秦岭「8」字展线',
    lng: 106.933575,
    lat: 34.244179,
    visibility: 'on_track',
    category: 'engineering',
    intro: '宝成铁路观音山「8」字/马蹄形展线盘山爬升，车窗可见下层展线「火车追火车」。',
  }),
  spot({
    id: 'jialing-gorge-baocheng',
    name: '嘉陵江峡谷',
    lng: 106.0,
    lat: 33.0,
    visibility: 'window',
    category: 'gorge',
    maxDistKm: 12,
    intro: '略阳—阳平关嘉陵江峡谷，蜀道天险与江峡同框。',
  }),
  spot({
    id: 'lingguanxia-distant',
    name: '灵官峡嘉陵江峡谷',
    lng: 106.520834,
    lat: 33.909485,
    visibility: 'on_track',
    category: 'gorge',
    intro: '宝成线过秦岭后沿嘉陵江上游峡谷南下，灵官峡碧水绝壁与峡谷深涧贴窗。',
  }),
);

// —— 张吉怀 ——
spots.push(
  spot({
    id: 'zhangjiajie-wulingyuan-distant',
    name: '张家界武陵源方向',
    lng: 110.48,
    lat: 29.35,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 25,
    intro: '石英砂岩峰林世界遗产方向，张家界西站为湘西高铁门户。',
  }),
  spot({
    id: 'tianmen-mountain-distant',
    name: '天门山方向',
    lng: 110.48,
    lat: 29.05,
    visibility: 'distant',
    category: 'mountain',
    intro: '天门山景区方向，与武陵源并列的张家界山岳名片。',
  }),
  spot({
    id: 'furong-town',
    name: '芙蓉镇（酉水）',
    lng: 109.9,
    lat: 28.9,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '酉水畔吊脚楼古镇，张吉怀高铁芙蓉镇站直达，湘西风情浓厚。',
  }),
  spot({
    id: 'aizhai-bridge-distant',
    name: '矮寨大桥与德夯方向',
    lng: 109.6,
    lat: 28.3,
    visibility: 'distant',
    category: 'engineering',
    intro: '吉首附近矮寨特大桥与德夯大峡谷方向，公路奇观可联游。',
  }),
  spot({
    id: 'fenghuang-ancient-town',
    name: '凤凰古城',
    lng: 109.59919,
    lat: 28.020509,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '沱江吊脚楼与湘西古城，凤凰古城站直达，张吉怀线人文高光。',
  }),
);

// —— 湘黔 ——
spots.push(
  spot({
    id: 'zhenyuan-ancient-town',
    name: '镇远古城',
    lng: 108.42794,
    lat: 27.050746,
    visibility: 'window',
    category: 'other',
    maxDistKm: 8,
    intro: '舞阳河畔古城，火车穿城俯瞰的经典画面，湘黔铁路人文地标。',
  }),
  spot({
    id: 'wuyang-river',
    name: '舞阳河',
    lng: 108.5,
    lat: 27.1,
    visibility: 'window',
    category: 'other',
    intro: '镇远周边舞阳河山水，黔东河谷与苗侗风情过渡带。',
  }),
  spot({
    id: 'kaili-miao-distant',
    name: '凯里苗寨方向',
    lng: 107.98,
    lat: 26.58,
    visibility: 'distant',
    category: 'other',
    intro: '黔东南苗侗聚落方向，湘黔线进入苗岭腹地。',
  }),
);

// —— 池黄 ——
spots.push(
  spot({
    id: 'jiuhuashan',
    name: '九华山',
    lng: 117.8,
    lat: 30.48,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 20,
    intro: '佛教名山，池黄高铁九华山站直达门户，可远眺山峦与田园。',
  }),
  spot({
    id: 'taiping-lake',
    name: '太平湖',
    lng: 117.98,
    lat: 30.4,
    visibility: 'window',
    category: 'lake',
    maxDistKm: 12,
    intro: '黄山西大门水域，池黄高铁沿线湖光山色。',
  }),
  spot({
    id: 'huangshan-west-portal',
    name: '黄山（西大门方向）',
    lng: 118.1,
    lat: 30.1,
    visibility: 'distant',
    category: 'mountain',
    intro: '黄山西大门方向，黟县—黄山北一带徽派山水门户。',
  }),
  spot({
    id: 'yixian-ancient-villages',
    name: '黟县古村方向（宏村西递）',
    lng: 118.0,
    lat: 29.95,
    visibility: 'distant',
    category: 'other',
    intro: '宏村、西递世界遗产村落方向，池黄/杭黄线徽文化高光。',
  }),
);

// —— 杭黄 ——
spots.push(
  spot({
    id: 'fuchun-xin-an-river',
    name: '富春江—新安江画廊',
    lng: 119.6,
    lat: 29.8,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '杭黄高铁经典「之」字观景选线，江湾、丘陵与村落如画。',
  }),
  spot({
    id: 'qiandao-lake',
    name: '千岛湖',
    lng: 119.19,
    lat: 29.74,
    visibility: 'window',
    category: 'lake',
    maxDistKm: 10,
    intro: '跨湖大桥与千岛湖面，杭黄高铁标志性湖景段落。',
  }),
  spot({
    id: 'jixi-huizhou',
    name: '绩溪—古徽州田园',
    lng: 118.58,
    lat: 30.07,
    visibility: 'window',
    category: 'other',
    intro: '徽派民居与油菜花田园，杭黄线「最美高铁」人文段落。',
  }),
  spot({
    id: 'huangshan-north-portal',
    name: '黄山北门户',
    lng: 118.22,
    lat: 29.78,
    visibility: 'distant',
    category: 'mountain',
    intro: '黄山北站为黄山景区主要高铁门户，可衔接山岳与徽州古城。',
  }),
);

// —— 合福 ——
spots.push(
  spot({
    id: 'wuyuan-rapeseed',
    name: '婺源徽州风光',
    lng: 117.86,
    lat: 29.25,
    visibility: 'window',
    category: 'other',
    maxDistKm: 15,
    intro: '婺源油菜花与徽派村落闻名，合福高铁「世遗高铁」重要看点。',
  }),
  spot({
    id: 'sanqingshan-distant',
    name: '三清山方向',
    lng: 118.05,
    lat: 28.9,
    visibility: 'distant',
    category: 'mountain',
    intro: '世界自然遗产三清山方向，合福线赣皖交界山岳。',
  }),
  spot({
    id: 'wuyishan-distant',
    name: '武夷山方向',
    lng: 118.0,
    lat: 27.75,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 25,
    intro: '世界双遗产武夷山方向，合福高铁福建段标志性文旅节点。',
  }),
  );

// —— 海南环岛 ——
spots.push(
  spot({
    id: 'hainan-east-coast',
    name: '海南东线海岸',
    lng: 110.5,
    lat: 19.2,
    visibility: 'window',
    category: 'other',
    maxDistKm: 8,
    intro: '环岛高铁东段多处近海，椰风海韵，部分路段距海岸仅数百米。',
  }),
  spot({
    id: 'wanning-bays',
    name: '万宁石梅湾—日月湾方向',
    lng: 110.34,
    lat: 18.77,
    visibility: 'window',
    category: 'other',
    intro: '万宁一带海湾与冲浪海岸，东环高铁滨海观景热点。',
  }),
  spot({
    id: 'sanya-yalong-distant',
    name: '三亚亚龙湾方向',
    lng: 109.65,
    lat: 18.23,
    visibility: 'distant',
    category: 'other',
    intro: '三亚站周边亚龙湾等海湾方向，环岛线南端滨海终点气质。',
  }),
  spot({
    id: 'hainan-west-salt-fields',
    name: '海南西线盐田与热带田园',
    lng: 108.7,
    lat: 19.1,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '西环高铁可见盐田、热带农田与较原生态的滨海平原。',
  }),
  spot({
    id: 'wenchang-space-distant',
    name: '文昌航天城方向',
    lng: 110.8,
    lat: 19.65,
    visibility: 'distant',
    category: 'engineering',
    intro: '文昌站周边航天发射场方向，东环线特色人文科技地标。',
  }),
);

// —— 福平 ——
spots.push(
  spot({
    id: 'pingtan-strait-bridge',
    name: '平潭海峡公铁大桥',
    lng: 119.6,
    lat: 25.6,
    visibility: 'on_track',
    category: 'engineering',
    intro: '中国首座公铁两用跨海大桥之一，跨海十数公里，海上最美高铁标志工程。',
  }),
  spot({
    id: 'pingtan-island-coast',
    name: '平潭岛海景',
    lng: 119.78,
    lat: 25.52,
    visibility: 'window',
    category: 'other',
    intro: '平潭岛石厝与东海海景，夏季或有「蓝眼泪」等海岸奇观主题。',
  }),
);

// —— 厦深 ——
spots.push(
  spot({
    id: 'xiamen-bay',
    name: '厦门海湾',
    lng: 118.1,
    lat: 24.5,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '厦深铁路北端厦门海湾与滨海城市风光。',
  }),
  spot({
    id: 'yuedong-coast',
    name: '粤东海滨',
    lng: 115.4,
    lat: 22.8,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '汕尾—惠州一带粤东海滨平原与海湾，杭深通道南段海风气质。',
  }),
);

// —— 敦白 / 长白山 ——
spots.push(
  spot({
    id: 'changbai-mountain',
    name: '长白山',
    lng: 128.055,
    lat: 42.006,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 55,
    intro: '长白山天池与林海雪原方向，敦白高铁直达门户，冬雾凇秋五花山。',
  }),
  spot({
    id: 'changbai-forest-snow',
    name: '长白山林海',
    lng: 128.0,
    lat: 42.6,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '敦化—长白山段林海雪原与火山熔岩台地过渡风光。',
  }),
);

// —— 哈牡 ——
spots.push(
  spot({
    id: 'yabuli-ski-distant',
    name: '亚布力滑雪场方向',
    lng: 128.28,
    lat: 44.98,
    visibility: 'distant',
    category: 'mountain',
    intro: '亚布力西站直达著名滑雪度假区方向，冬季冰雪旅游热门。',
  }),
  spot({
    id: 'xuexiang-distant',
    name: '雪乡方向',
    lng: 128.15,
    lat: 44.32,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 80,
    intro: '双峰林场雪乡方向，哈牡线冬季冰雪主题延伸目的地。',
  }),
  spot({
    id: 'mudanjiang-forest',
    name: '牡丹江林海',
    lng: 129.6,
    lat: 44.59,
    visibility: 'window',
    category: 'other',
    intro: '哈牡高铁东段林海雪原与山地河谷，东北铁路代表窗景。',
  }),
);

// —— 集通 ——
spots.push(
  spot({
    id: 'gongger-grassland',
    name: '贡格尔草原',
    lng: 117.5,
    lat: 43.3,
    visibility: 'window',
    category: 'grassland',
    maxDistKm: 15,
    intro: '集通铁路穿越内蒙古草原腹地，贡格尔等草场开阔辽远。',
  }),
  spot({
    id: 'dari-nor-distant',
    name: '达里诺尔湖方向',
    lng: 116.6,
    lat: 43.3,
    visibility: 'distant',
    category: 'lake',
    intro: '克什克腾旗达里诺尔湖方向，草原火山湖景观。',
  }),
  spot({
    id: 'jitong-steam-photo',
    name: '集通蒸汽机车摄影地标方向',
    lng: 116.0,
    lat: 42.5,
    visibility: 'window',
    category: 'engineering',
    maxDistKm: 15,
    intro: '曾为世界最后干线蒸汽运营线之一，司明义大桥等机位仍是铁路摄影圣地气质。',
  }),
);

// —— 张呼 ——
spots.push(
  spot({
    id: 'bashang-grassland',
    name: '坝上草原',
    lng: 115.5,
    lat: 41.5,
    visibility: 'window',
    category: 'grassland',
    maxDistKm: 15,
    intro: '张呼高铁出河北进入坝上，可见高原草甸与疏林草原。',
  }),
  spot({
    id: 'ulat-cabl-volcano-grassland',
    name: '乌兰察布火山草原方向',
    lng: 113.15,
    lat: 40.96,
    visibility: 'distant',
    category: 'grassland',
    intro: '辉腾锡勒等火山草原方向，张呼线内蒙古段标志风光。',
  }),
);

// —— 京张 ——
spots.push(
  spot({
    id: 'badaling-great-wall',
    name: '八达岭长城',
    lng: 116.005052,
    lat: 40.360328,
    visibility: 'distant',
    category: 'engineering',
    maxDistKm: 8,
    intro: '八达岭长城站为世界最深高铁站之一，出站可探访长城；列车段多在隧道。',
  }),
  spot({
    id: 'guanting-reservoir',
    name: '官厅水库',
    lng: 115.6,
    lat: 40.35,
    visibility: 'window',
    category: 'lake',
    maxDistKm: 10,
    intro: '京张高铁怀来段可见官厅水库湖面与河谷，长城高铁经典水面段落。',
  }),
);

// —— 杭昌补充（千岛湖已在杭黄；补鄱阳湖等）——
spots.push(
  spot({
    id: 'poyang-lake-distant',
    name: '鄱阳湖方向',
    lng: 116.0,
    lat: 29.0,
    visibility: 'distant',
    category: 'lake',
    intro: '杭昌/合福等线赣北可感知鄱阳湖平原开阔水域气质。',
  }),
  spot({
    id: 'jingdezhen-kiln-distant',
    name: '景德镇瓷都方向',
    lng: 117.2,
    lat: 29.3,
    visibility: 'distant',
    category: 'other',
    intro: '杭昌高铁景德镇北站方向，千年瓷都人文节点。',
  }),
);

// —— 第二轮：高优先线补强（坐标贴近走廊折线，保证打开车次能命中）——
spots.push(
  // 拉林（当前仅 2）
  spot({
    id: 'lalin-gongga-valley',
    name: '贡嘎—扎囊雅江河谷',
    lng: 91.387633,
    lat: 29.245225,
    visibility: 'window',
    category: 'gorge',
    intro: '拉林铁路出拉萨后贴雅鲁藏布江河谷东行，可见宽谷江面与藏南田园。',
  }),
  spot({
    id: 'lalin-shannan-canyon',
    name: '山南深切峡谷段',
    lng: 91.937184,
    lat: 29.265647,
    visibility: 'window',
    category: 'gorge',
    intro: '山南—桑日一带雅江深切，铁路桥隧穿行，雪域江南过渡感强烈。',
  }),
  spot({
    id: 'lalin-milin-peach',
    name: '米林桃花与河谷',
    lng: 92.904953,
    lat: 29.059127,
    visibility: 'window',
    category: 'other',
    intro: '米林—岗嘎段春季桃花与河谷同框，是「坐着火车看桃花」的核心段落。',
  }),
  spot({
    id: 'lalin-nyingchi-gateway',
    name: '林芝雪域门户',
    lng: 94.422733,
    lat: 29.504945,
    visibility: 'window',
    category: 'mountain',
    intro: '拉林铁路东端林芝，藏东南林海雪山门户，可衔接南迦巴瓦等探访。',
  }),
  spot({
    id: 'lalin-namcha-barwa-view',
    name: '南迦巴瓦峰观景段',
    lng: 94.2,
    lat: 29.48,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 40,
    intro: '接近林芝时天气晴好可远眺南迦巴瓦金字塔形雪峰。',
  }),

  // 和若（当前 1）
  spot({
    id: 'heruo-hotan-oasis',
    name: '和田绿洲',
    lng: 79.9169,
    lat: 37.16006,
    visibility: 'window',
    category: 'other',
    intro: '和若铁路西端和田绿洲，昆仑北麓玉石之乡，沙漠与田园交界。',
  }),
  spot({
    id: 'heruo-desert-mid',
    name: '塔克拉玛干南缘铁龙',
    lng: 83.457672,
    lat: 37.408822,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 12,
    intro: '环沙漠铁路中段，防沙治沙草方格与沙丘同框，是和若线标志窗景。',
  }),
  spot({
    id: 'heruo-qiemo-desert',
    name: '且末沙漠旷野',
    lng: 85.551176,
    lat: 38.195629,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 12,
    intro: '且末以东戈壁沙漠开阔，日落时分天际线极具「长河落日」感。',
  }),
  spot({
    id: 'heruo-ruoqiang-gateway',
    name: '若羌沙漠门户',
    lng: 88.181354,
    lat: 38.984621,
    visibility: 'window',
    category: 'desert',
    intro: '和若铁路东端若羌，衔接格库线，塔里木东南缘沙漠门户。',
  }),

  // 福平（当前 1）— 补跨海大桥
  spot({
    id: 'fuping-changle-coast',
    name: '长乐滨海段',
    lng: 119.381576,
    lat: 26.029816,
    visibility: 'window',
    category: 'other',
    intro: '福州—长乐段逐渐近海，可见东海与滨海平原过渡风光。',
  }),
  spot({
    id: 'fuping-pingtan-approach',
    name: '平潭岛进岛海景',
    lng: 119.737484,
    lat: 25.610173,
    visibility: 'window',
    category: 'other',
    intro: '接近平潭岛时跨海视野开阔，石厝与蓝眼泪等海岛主题的铁路门户。',
  }),

  // 滇越（当前 2）— 补人字桥等
  spot({
    id: 'diandong-kaiyuan-metre',
    name: '开远米轨风情',
    lng: 103.187253,
    lat: 23.878503,
    visibility: 'window',
    category: 'other',
    intro: '开远一带百年米轨与法式铁路遗产气质，滇南乡愁代表性段落。',
  }),
  spot({
    id: 'diandong-yiliang-hills',
    name: '宜良坝子与山地',
    lng: 103.043256,
    lat: 24.692992,
    visibility: 'window',
    category: 'other',
    intro: '昆明出城后宜良坝子与山地交错，滇越铁路北段田园窗景。',
  }),

  // 中老（当前 4）— 补元江桥等
  spot({
    id: 'zhonglao-mojiang-hills',
    name: '墨江山地茶乡',
    lng: 101.869513,
    lat: 23.511075,
    visibility: 'window',
    category: 'other',
    intro: '元江—墨江山地段落，云雾与梯田茶园渐显热带北缘风光。',
  }),
  spot({
    id: 'zhonglao-yuxi-plateau',
    name: '玉溪高原田园',
    lng: 102.5,
    lat: 24.35,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '昆明南出城后玉溪一带高原田园与烟草产区风光。',
  }),

  // 宝成（当前 4）— 补秦岭展线
  spot({
    id: 'baocheng-fengzhou',
    name: '凤州山地',
    lng: 106.5,
    lat: 34.0,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 12,
    intro: '宝鸡出秦岭前山地段落，嘉陵江源与蜀道天险气质渐浓。',
  }),
  spot({
    id: 'baocheng-guangyuan-jialing',
    name: '广元嘉陵江',
    lng: 105.118634,
    lat: 32.019444,
    visibility: 'window',
    category: 'gorge',
    intro: '广元一带嘉陵江河谷，宝成线出秦岭后的川北门户风光。',
  }),

  // 张吉怀（当前 4）
  spot({
    id: 'zhangjihuai-guzhang-wuling',
    name: '古丈武陵山色',
    lng: 109.906025,
    lat: 28.49157,
    visibility: 'window',
    category: 'mountain',
    intro: '古丈西—吉首东段穿武陵山腹地，桥隧比高，山峦层叠如画。',
  }),
  spot({
    id: 'zhangjihuai-mengdong-distant',
    name: '猛洞河方向',
    lng: 109.95,
    lat: 28.7,
    visibility: 'distant',
    category: 'gorge',
    intro: '猛洞河漂流景区方向，张吉怀线湘西山水联游节点。',
  }),

  // 川青（当前 3）
  spot({
    id: 'chuanqing-maoxian-gorge',
    name: '茂县岷江峡谷',
    lng: 103.721725,
    lat: 32.338542,
    visibility: 'window',
    category: 'gorge',
    intro: '川青铁路茂县—镇江关岷江峡谷，羌藏村寨与陡峭河谷同框。',
  }),
  spot({
    id: 'chuanqing-gaochuan',
    name: '高川山地',
    lng: 104.209404,
    lat: 31.678042,
    visibility: 'window',
    category: 'mountain',
    intro: '安州—高川段爬升进入龙门山—岷山过渡带，平原转山地的风景分界。',
  }),
  spot({
    id: 'chuanqing-zhenjiangguan',
    name: '镇江关高原门户',
    lng: 103.6,
    lat: 32.55,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 12,
    intro: '镇江关一带进入川西北高原，是黄龙九寨旅游专线的关键门户段落。',
  }),

  // 敦格（当前 3）
  spot({
    id: 'dunge-yardang-rail',
    name: '雅丹地貌段',
    lng: 94.867755,
    lat: 39.30949,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 12,
    intro: '敦煌以南雅丹与戈壁，风蚀地貌「类火星」是敦格线大漠段标志。',
  }),
  spot({
    id: 'dunge-dangjinshan-rail',
    name: '当金山口',
    lng: 94.62973,
    lat: 38.067568,
    visibility: 'window',
    category: 'mountain',
    intro: '敦格线翻越当金山，祁连西段与柴达木北缘的地理分界山口。',
  }),
  spot({
    id: 'dunge-qaidam-salt',
    name: '柴达木盐湖盆地',
    lng: 95.433673,
    lat: 37.531633,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 12,
    intro: '大柴旦—饮马峡盐湖盆地，戈壁与盐湖交织的「大漠新丝路」南段。',
  }),

  // 宜万（当前 3）
  spot({
    id: 'yiwan-enshi-karst',
    name: '恩施岩溶山地',
    lng: 109.981073,
    lat: 30.596136,
    visibility: 'window',
    category: 'gorge',
    intro: '建始—恩施岩溶峰丛与河谷，宜万线武陵山腹地核心窗景。',
  }),
  spot({
    id: 'yiwan-lichuan-plateau',
    name: '利川齐岳山一带',
    lng: 108.863368,
    lat: 30.278895,
    visibility: 'window',
    category: 'mountain',
    intro: '利川高原山地，宜万铁路西段出清江流域、近万州的山原风光。',
  }),

  // 敦白（当前 1）
  spot({
    id: 'dunbai-antu',
    name: '安图山地',
    lng: 128.221835,
    lat: 42.612832,
    visibility: 'window',
    category: 'mountain',
    intro: '安图西一带火山熔岩台地与针叶林，接近长白山景区门户。',
  }),
  spot({
    id: 'dunbai-changbai-station',
    name: '长白山站林海',
    lng: 128.109818,
    lat: 42.452998,
    visibility: 'window',
    category: 'mountain',
    intro: '敦白高铁终点长白山站，林海环绕，可转乘前往天池景区。',
  }),

  // 张呼（当前 1）
  spot({
    id: 'zhanghu-xinghe',
    name: '兴和草原过渡带',
    lng: 112.987748,
    lat: 40.988488,
    visibility: 'window',
    category: 'grassland',
    intro: '兴和北—乌兰察布段草原与农田交错，阴山南麓风光。',
  }),
  spot({
    id: 'zhanghu-zhuozi',
    name: '卓资山地草原',
    lng: 112.350118,
    lat: 40.978748,
    visibility: 'window',
    category: 'grassland',
    intro: '卓资东一带阴山支脉与草原，接近呼和浩特前的山原段落。',
  }),

  // 集通（当前 1）
  spot({
    id: 'jitong-hexigten-rail',
    name: '克什克腾草原',
    lng: 117.216541,
    lat: 43.174743,
    visibility: 'window',
    category: 'grassland',
    maxDistKm: 15,
    intro: '集通铁路克什克腾段，贡格尔草原腹地，夏季绿浪、冬季白雪。',
  }),
  spot({
    id: 'jitong-zhengxiangbai',
    name: '正镶白旗草原',
    lng: 114.734102,
    lat: 42.179751,
    visibility: 'window',
    category: 'grassland',
    maxDistKm: 12,
    intro: '集宁以东正镶白旗一带锡林郭勒南缘草原，集通线经典旷野。',
  }),
  spot({
    id: 'jitong-linxi',
    name: '林西山地草甸',
    lng: 119.225851,
    lat: 43.793842,
    visibility: 'window',
    category: 'grassland',
    intro: '林西—查布嘎段草甸与低山，接近通辽前的科尔沁过渡风光。',
  }),

  // 临哈（当前 2）
  spot({
    id: 'linha-wuliangsuhai-distant',
    name: '乌梁素海方向',
    lng: 108.8,
    lat: 40.9,
    visibility: 'distant',
    category: 'lake',
    intro: '包头—临河一带乌梁素海方向，河套湿地与草原过渡。',
  }),
  spot({
    id: 'linha-hexi-gobi',
    name: '临河—额济纳戈壁',
    lng: 106.236701,
    lat: 40.451509,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 12,
    intro: '临哈铁路西段戈壁旷野，胡杨专列进入沙漠边缘的苍茫段落。',
  }),
  
  // 海南东/西环
  spot({
    id: 'hainandong-qionghai',
    name: '琼海滨海平原',
    lng: 110.463726,
    lat: 18.947215,
    visibility: 'window',
    category: 'other',
    intro: '东环高铁琼海段近海平原与椰林，热带滨海田园气质。',
  }),
  spot({
    id: 'hainandong-lingshui',
    name: '陵水近海段',
    lng: 110.003409,
    lat: 18.531787,
    visibility: 'window',
    category: 'other',
    intro: '陵水一带铁路近海岸，可见海湾与热带植被，东环南段精华。',
  }),
  spot({
    id: 'hainanxi-qiziwan',
    name: '棋子湾方向',
    lng: 108.759757,
    lat: 19.22473,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '西环高铁昌江—东方一带，棋子湾等海湾与火山岩海岸方向。',
  }),
  spot({
    id: 'hainanxi-dongfang-salt',
    name: '东方盐田',
    lng: 108.720053,
    lat: 18.680651,
    visibility: 'window',
    category: 'other',
    intro: '东方附近盐田与热带田园，西环线有别于东线的原生态滨海风光。',
  }),
  spot({
    id: 'hainanxi-lingao',
    name: '临高滨海',
    lng: 109.636984,
    lat: 19.84382,
    visibility: 'window',
    category: 'other',
    intro: '海口西行临高南一带，西环起点段的热带滨海平原。',
  }),

  // 哈牡（当前 2）
  spot({
    id: 'hamu-shangzhi-forest',
    name: '尚志林海',
    lng: 127.868415,
    lat: 45.220647,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '哈牡高铁尚志南一带林海雪原，冬季雾凇、夏季绿浪。',
  }),
  spot({
    id: 'hamu-hailin',
    name: '海林山地',
    lng: 128.690181,
    lat: 44.902756,
    visibility: 'window',
    category: 'mountain',
    intro: '亚布力—海林北段山地森林，接近牡丹江的冰雪旅游走廊。',
  }),

  // 南昆客专（当前 2）— 补普者黑
  spot({
    id: 'nankun-puzhehei-rail',
    name: '普者黑喀斯特',
    lng: 103.838091,
    lat: 23.84824,
    visibility: 'window',
    category: 'other',
    maxDistKm: 15,
    intro: '南昆高铁丘北—弥勒一带喀斯特峰林湖泊，「三生三世」取景地气质。',
  }),
  spot({
    id: 'nankun-funing-karst',
    name: '富宁峰林',
    lng: 105.874818,
    lat: 23.694673,
    visibility: 'window',
    category: 'other',
    intro: '滇桂交界富宁—广南喀斯特峰林与田园，南昆客专经典窗景。',
  }),

  // 丽香 — 虎跳峡贴线
  spot({
    id: 'lixiang-newshang',
    name: '丽江北上山地',
    lng: 100.101637,
    lat: 27.040603,
    visibility: 'window',
    category: 'mountain',
    intro: '出丽江后爬升横断山区，玉龙雪山方向渐近，海拔与植被快速变化。',
  }),

  // 成昆补强
  spot({
    id: 'chengkun-liangshan',
    name: '大凉山峡谷',
    lng: 102.724846,
    lat: 28.942556,
    visibility: 'window',
    category: 'gorge',
    maxDistKm: 12,
    intro: '成昆铁路汉源—甘洛大凉山峡谷，桥隧密集，横断山脉险峻代表段。',
  }),
  spot({
    id: 'chengkun-panzhihua',
    name: '攀枝花金沙江',
    lng: 101.861989,
    lat: 25.929817,
    visibility: 'window',
    category: 'gorge',
    intro: '攀枝花一带金沙江河谷，成昆线出川入滇的江峡门户。',
  }),
  spot({
    id: 'chengkun-emei-distant',
    name: '峨眉山方向',
    lng: 103.45,
    lat: 29.55,
    visibility: 'distant',
    category: 'mountain',
    intro: '成都南下峨眉站方向，可远眺峨眉山山峦，成昆北段文旅节点。',
  }),

  // 银兰（0）适量补
  spot({
    id: 'yinlan-helan-distant',
    name: '贺兰山方向',
    lng: 106.2,
    lat: 38.5,
    visibility: 'distant',
    category: 'mountain',
    intro: '银兰高铁银川出城后可见贺兰山轮廓，宁夏平原西侧屏障。',
  }),
  spot({
    id: 'yinlan-yellow-river',
    name: '黄河宁夏段',
    lng: 105.9,
    lat: 37.5,
    visibility: 'window',
    category: 'other',
    maxDistKm: 15,
    intro: '银兰高铁沿宁夏平原南下，部分区段可感知黄河灌区田园风光。',
  }),
  spot({
    id: 'yinlan-zhongwei',
    name: '中卫沙坡头方向',
    lng: 105.2,
    lat: 37.5,
    visibility: 'distant',
    category: 'desert',
    intro: '中卫一带腾格里沙漠边缘与黄河，沙坡头景区方向的铁路门户。',
  }),

  // 厦深 / 兰渝 适量
  spot({
    id: 'xiashen-chaoshan',
    name: '潮汕平原',
    lng: 116.6,
    lat: 23.4,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '潮汕—揭阳一带粤东平原与村镇田园，厦深线中段窗景。',
  }),
  spot({
    id: 'lanyu-longnan',
    name: '陇南山水',
    lng: 105.0,
    lat: 33.4,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 15,
    intro: '兰渝铁路陇南段山地与河谷，黄土高原向嘉陵江流域过渡。',
  }),
  spot({
    id: 'lanyu-nanchong',
    name: '南充嘉陵江',
    lng: 106.1,
    lat: 30.8,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '南充北一带嘉陵江河谷田园，兰渝线川东北门户风光。',
  }),
);

// —— 第三轮：中优先与仍偏少线路补强 ——
spots.push(
  // 渝利
  spot({
    id: 'yuli-fuling',
    name: '涪陵长江库区',
    lng: 106.864489,
    lat: 29.681138,
    visibility: 'window',
    category: 'gorge',
    intro: '渝利铁路涪陵北一带，长江三峡库区山色与河谷同框。',
  }),
  spot({
    id: 'yuli-fengdu',
    name: '丰都库区山地',
    lng: 107.255532,
    lat: 29.778942,
    visibility: 'window',
    category: 'gorge',
    intro: '丰都段穿行库区山地，喀斯特峰丛与长江支流河谷交错。',
  }),
  spot({
    id: 'yuli-shizhu',
    name: '石柱山地',
    lng: 108.079063,
    lat: 29.950388,
    visibility: 'window',
    category: 'mountain',
    intro: '石柱县站一带武陵余脉，渝利线东段山原风光。',
  }),
  spot({
    id: 'yuli-lichuan-portal',
    name: '利川齐岳山门户',
    lng: 108.775383,
    lat: 30.259047,
    visibility: 'window',
    category: 'mountain',
    intro: '渝利铁路东端利川，衔接宜万线，齐岳山高原门户。',
  }),

  // 渝贵（大面积靠轨 2～4 km，禁止钉在站房/轨面）
  spot({
    id: 'yugui-qijiang',
    name: '綦江山地',
    lng: 106.6109,
    lat: 29.1389,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 10,
    intro: '綦江东站一带渝南山地丘陵（靠铁路东侧取点）；重庆西出城后北段窗景。',
  }),
  spot({
    id: 'yugui-tongzi',
    name: '桐梓娄山北麓',
    lng: 106.8331,
    lat: 28.4663,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 10,
    intro: '桐梓东站以东娄山北麓喀斯特（靠铁路取点）；再往南即娄山关段。',
  }),
  spot({
    id: 'yugui-zunyi-city',
    name: '遵义黔北风光',
    lng: 106.972,
    lat: 27.655,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '遵义站东南侧黔北峰丛与河谷（靠铁路取点，非站房）；红色故地与喀斯特同在。',
  }),
  spot({
    id: 'yugui-xifeng',
    name: '息烽峡谷',
    lng: 106.8278,
    lat: 27.2799,
    visibility: 'window',
    category: 'gorge',
    maxDistKm: 10,
    intro: '息烽站东侧峡谷峰林（靠铁路取点）；渝贵线南段典型黔中地貌。',
  }),

  // 京张补强
  spot({
    id: 'jingzhang-qinghe',
    name: '清河出京段',
    lng: 116.201239,
    lat: 40.178175,
    visibility: 'window',
    category: 'other',
    intro: '京张高铁清河一带出京，城区渐隐、山地渐近。',
  }),
  spot({
    id: 'jingzhang-huailai-valley',
    name: '怀来河谷',
    lng: 115.501264,
    lat: 40.399503,
    visibility: 'window',
    category: 'other',
    intro: '怀来盆地河谷与葡萄产区，官厅水库周边田园风光。',
  }),
  spot({
    id: 'jingzhang-zhangjiakou-portal',
    name: '张家口坝上门户',
    lng: 114.88048,
    lat: 40.749052,
    visibility: 'window',
    category: 'grassland',
    intro: '京张高铁终点张家口，衔接张呼线，坝上草原门户。',
  }),

  // 拉日补强
  spot({
    id: 'lari-quxiu',
    name: '曲水雅江宽谷',
    lng: 90.593854,
    lat: 29.288322,
    visibility: 'window',
    category: 'gorge',
    intro: '拉日铁路曲水段雅鲁藏布江宽谷，藏南田园开阔。',
  }),
  spot({
    id: 'lari-nimu',
    name: '尼木河谷',
    lng: 90.098311,
    lat: 29.353752,
    visibility: 'window',
    category: 'gorge',
    intro: '尼木一带河谷与藏香之乡田园，拉日线中段经典窗景。',
  }),
  spot({
    id: 'lari-renbu',
    name: '仁布山地',
    lng: 89.498307,
    lat: 29.334143,
    visibility: 'window',
    category: 'mountain',
    intro: '仁布段山地与河谷过渡，接近日喀则平原前的藏南山色。',
  }),

  // 贵广补强
  spot({
    id: 'guiguang-duyun',
    name: '都匀斗篷山方向',
    lng: 109.709547,
    lat: 25.641467,
    visibility: 'distant',
    category: 'mountain',
    intro: '都匀东一带苗岭山地，斗篷山方向可远眺。',
  }),
  spot({
    id: 'guiguang-rongjiang',
    name: '榕江山地',
    lng: 110.502415,
    lat: 25.186148,
    visibility: 'window',
    category: 'mountain',
    intro: '榕江—从江黔东南山地，贵广高铁桥隧穿行绿丘峡谷。',
  }),
  spot({
    id: 'guiguang-hezhou',
    name: '贺州山水',
    lng: 111.361908,
    lat: 24.539753,
    visibility: 'window',
    category: 'other',
    intro: '贺州一带桂东山水与田园，桂林峰林向粤西过渡。',
  }),
  spot({
    id: 'guiguang-zhaoqing',
    name: '肇庆星湖方向',
    lng: 112.730207,
    lat: 23.197597,
    visibility: 'distant',
    category: 'lake',
    intro: '肇庆东站周边星湖、七星岩方向，贵广线粤境文旅节点。',
  }),

  // 湘黔补强
  spot({
    id: 'xiangqian-loudi',
    name: '娄底丘陵',
    lng: 111.81447,
    lat: 27.60454,
    visibility: 'window',
    category: 'other',
    intro: '湘黔铁路娄底一带丘陵田园，出长株潭后的湘中风光。',
  }),
  spot({
    id: 'xiangqian-xupu',
    name: '溆浦武陵谷地',
    lng: 110.606047,
    lat: 27.612386,
    visibility: 'window',
    category: 'gorge',
    intro: '溆浦—怀化武陵山与雪峰山夹峙谷地，湘黔线湘西门户。',
  }),
  spot({
    id: 'xiangqian-huaihua',
    name: '怀化山地',
    lng: 109.176264,
    lat: 27.395242,
    visibility: 'window',
    category: 'mountain',
    intro: '怀化一带雪峰余脉，衔接张吉怀与沪昆的湘西南枢纽风光。',
  }),

  // 厦深补强
  spot({
    id: 'xiashen-zhangzhou',
    name: '漳州滨海',
    lng: 117.582111,
    lat: 24.187187,
    visibility: 'window',
    category: 'other',
    intro: '厦深铁路漳州段滨海平原与村镇，闽南风光。',
  }),
  spot({
    id: 'xiashen-yunxiao',
    name: '云霄沿海',
    lng: 116.801242,
    lat: 23.624209,
    visibility: 'window',
    category: 'other',
    intro: '云霄一带近海田园与海湾，厦深线闽粤交界气质。',
  }),
  spot({
    id: 'xiashen-shanwei',
    name: '汕尾红海湾方向',
    lng: 115.418996,
    lat: 22.814218,
    visibility: 'distant',
    category: 'other',
    intro: '汕尾站周边红海湾方向，粤东海滨旅游节点。',
  }),
  spot({
    id: 'xiashen-huizhou',
    name: '惠州南滨海',
    lng: 114.615277,
    lat: 22.843136,
    visibility: 'window',
    category: 'other',
    intro: '惠州南接近珠江口东岸，厦深线进入大湾区前的滨海平原。',
  }),

  // 兰渝补强
  spot({
    id: 'lanyu-lanzhou-south',
    name: '兰州南缘黄土',
    lng: 104.196136,
    lat: 34.881869,
    visibility: 'window',
    category: 'other',
    intro: '兰渝铁路出兰州后黄土高原沟壑，黄河上游向秦岭过渡。',
  }),
  spot({
    id: 'lanyu-guangyuan-rail',
    name: '广元蜀道',
    lng: 105.835331,
    lat: 32.486888,
    visibility: 'window',
    category: 'mountain',
    intro: '广元一带蜀道山地与嘉陵江，兰渝线入川门户。',
  }),
  spot({
    id: 'lanyu-chongqing-approach',
    name: '重庆北前山城',
    lng: 106.17807,
    lat: 30.027354,
    visibility: 'window',
    category: 'other',
    intro: '接近重庆北时丘陵与嘉陵江水系交织，山城门户风光。',
  }),

  // 银兰补强
  spot({
    id: 'yinlan-wuzhong',
    name: '吴忠黄河灌区',
    lng: 106.10422,
    lat: 37.639483,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '银兰高铁吴忠一带黄河灌区田园，宁夏平原绿洲风光。',
  }),
  spot({
    id: 'yinlan-zhongwei-rail',
    name: '中卫南沙漠边缘',
    lng: 105.464326,
    lat: 37.445705,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 12,
    intro: '中卫南接近腾格里沙漠与黄河，沙坡头方向铁路门户。',
  }),
  spot({
    id: 'yinlan-jingtai',
    name: '景泰黄河石林方向',
    lng: 104.734232,
    lat: 36.738107,
    visibility: 'distant',
    category: 'other',
    intro: '景泰站周边黄河石林方向，银兰线甘青交界前的特色地貌。',
  }),
  spot({
    id: 'yinlan-baiyin',
    name: '白银黄土丘陵',
    lng: 104.210835,
    lat: 36.478799,
    visibility: 'window',
    category: 'other',
    intro: '白银南一带黄土丘陵，接近兰州新区前的苍茫段落。',
  }),

  // 南疆补强
  spot({
    id: 'nanjiang-korla-oasis',
    name: '库尔勒绿洲',
    lng: 86.202643,
    lat: 41.738055,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '南疆铁路库尔勒梨城绿洲，天山南麓与塔里木北缘交汇。',
  }),
  spot({
    id: 'nanjiang-luntai',
    name: '轮台胡杨与戈壁',
    lng: 83.66186,
    lat: 41.801066,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 12,
    intro: '轮台一带沙漠公路与胡杨林方向，南疆线中段戈壁绿洲。',
  }),
  spot({
    id: 'nanjiang-aksu',
    name: '阿克苏绿洲',
    lng: 80.734734,
    lat: 41.281666,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '阿克苏棉田与白杨绿洲，塔里木盆地北缘重要农业带。',
  }),
  spot({
    id: 'nanjiang-artux',
    name: '阿图什至喀什绿洲',
    lng: 78.56824,
    lat: 39.844895,
    visibility: 'window',
    category: 'other',
    intro: '阿图什—喀什绿洲连绵，帕米尔高原东麓门户风光。',
  }),

  // 大丽 / 昆丽补强
  spot({
    id: 'kunli-chuxiong',
    name: '楚雄高原',
    lng: 101.434727,
    lat: 25.097864,
    visibility: 'window',
    category: 'other',
    intro: '昆明西行楚雄一带高原田园，滇中向滇西过渡。',
  }),
  spot({
    id: 'kunli-xiangyun',
    name: '祥云坝子',
    lng: 100.893623,
    lat: 25.346736,
    visibility: 'window',
    category: 'other',
    intro: '祥云坝子田园开阔，接近大理前的滇西平原风光。',
  }),
  spot({
    id: 'kunli-heqing',
    name: '鹤庆田园',
    lng: 100.234014,
    lat: 26.095411,
    visibility: 'window',
    category: 'other',
    intro: '鹤庆段白族田园与低缓山地，大丽线北上丽江前的经典窗景。',
  }),

  // 西成补强
  spot({
    id: 'xicheng-foping',
    name: '佛坪秦岭腹地',
    lng: 108.487697,
    lat: 33.850898,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 12,
    intro: '西成高铁佛坪一带秦岭腹地林海，春雪秋色最美段落之一。',
  }),
  spot({
    id: 'xicheng-ningqiang',
    name: '宁强南秦巴',
    lng: 105.920944,
    lat: 32.578066,
    visibility: 'window',
    category: 'mountain',
    intro: '宁强南秦巴山地，西成线出汉中盆地、入川前的关隘风光。',
  }),
  spot({
    id: 'xicheng-jiangyou',
    name: '江油绵阳平原',
    lng: 104.584388,
    lat: 31.370337,
    visibility: 'window',
    category: 'other',
    intro: '江油—绵阳成都平原北缘，西成高铁入川后的田园段落。',
  }),

  // 成贵补强
  spot({
    id: 'chenggui-leshan-rail',
    name: '乐山岷江',
    lng: 104.000872,
    lat: 29.299626,
    visibility: 'window',
    category: 'other',
    intro: '成贵高铁乐山段岷江河谷，大佛景区门户铁路风光。',
  }),
  spot({
    id: 'chenggui-yibin',
    name: '宜宾江城',
    lng: 104.517022,
    lat: 28.785,
    visibility: 'window',
    category: 'other',
    intro: '宜宾西三江交汇地带，川南江城与丘陵田园。',
  }),
  spot({
    id: 'chenggui-bijie',
    name: '毕节乌蒙',
    lng: 105.119535,
    lat: 27.610958,
    visibility: 'window',
    category: 'mountain',
    intro: '毕节一带乌蒙山，成贵高铁黔西北高原桥隧段落。',
  }),
  spot({
    id: 'chenggui-bailidujuan-distant',
    name: '百里杜鹃方向',
    lng: 105.8,
    lat: 27.2,
    visibility: 'distant',
    category: 'other',
    intro: '毕节—贵阳北百里杜鹃景区方向，春季花海主题联游节点。',
  }),

  // 格库补强
  spot({
    id: 'geku-huatugou',
    name: '花土沟石油城戈壁',
    lng: 91.450495,
    lat: 37.973657,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 12,
    intro: '格库铁路花土沟一带柴达木西缘戈壁，无人区气质浓厚。',
  }),
  spot({
    id: 'geku-ruoqiang-rail',
    name: '若羌沙漠绿洲',
    lng: 88.218434,
    lat: 39.006084,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 12,
    intro: '若羌绿洲镶嵌沙漠边缘，格库与和若交汇的塔东南门户。',
  }),
  spot({
    id: 'geku-yuli',
    name: '尉犁塔里木',
    lng: 87.252451,
    lat: 40.13451,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 12,
    intro: '尉犁一带塔里木河下游与胡杨，接近库尔勒前的南疆风光。',
  }),

  // 银西（0）
  spot({
    id: 'yinxi-wuzhong-rail',
    name: '吴忠宁东平原',
    lng: 106.696756,
    lat: 37.431185,
    visibility: 'window',
    category: 'other',
    intro: '银西高铁吴忠一带宁夏平原田园，贺兰山与黄河灌区之间。',
  }),
  spot({
    id: 'yinxi-guyuan',
    name: '固原六盘山方向',
    lng: 107.441103,
    lat: 36.419558,
    visibility: 'distant',
    category: 'mountain',
    intro: '固原—六盘山站方向，银西线翻越陇东黄土与六盘山地。',
  }),
  spot({
    id: 'yinxi-liupanshan',
    name: '六盘山段',
    lng: 107.613434,
    lat: 35.724614,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 12,
    intro: '六盘山高铁段山地林海，陇东向关中过渡的风景分界。',
  }),
  spot({
    id: 'yinxi-qingyang',
    name: '庆阳黄土高原',
    lng: 108.120624,
    lat: 34.67314,
    visibility: 'window',
    category: 'other',
    intro: '庆阳一带黄土高原沟壑与塬面，银西线陕甘交界风光。',
  }),
  spot({
    id: 'yinxi-xianyang',
    name: '咸阳渭河平原',
    lng: 108.73,
    lat: 34.355,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '咸阳—西安之间渭河及沿岸平原田园（大面积靠铁路南侧取点）；银西高铁关中终点段窗外可见。',
  }),

  // 郑渝（0）
  spot({
    id: 'zhengyu-nanyang',
    name: '南阳盆地',
    lng: 112.294399,
    lat: 32.019264,
    visibility: 'window',
    category: 'other',
    intro: '郑渝高铁南阳南一带盆地田园，中原向鄂西过渡。',
  }),
  spot({
    id: 'zhengyu-xiangyang',
    name: '襄阳汉江',
    lng: 112.0,
    lat: 32.05,
    visibility: 'window',
    category: 'other',
    maxDistKm: 15,
    intro: '襄阳东汉江流域，郑渝线鄂北门户山水。',
  }),
  spot({
    id: 'zhengyu-xingshan',
    name: '兴山三峡山地',
    lng: 110.923422,
    lat: 31.710233,
    visibility: 'window',
    category: 'gorge',
    maxDistKm: 12,
    intro: '兴山—巴东北穿行三峡山地，郑渝高铁桥隧与峡谷密集。',
  }),
  spot({
    id: 'zhengyu-wushan',
    name: '巫山峡谷',
    lng: 109.547411,
    lat: 31.080141,
    visibility: 'window',
    category: 'gorge',
    intro: '巫山站一带长江三峡峡谷，郑渝线最著名的山岳段落之一。',
  }),
  spot({
    id: 'zhengyu-wanzhou',
    name: '万州库区',
    lng: 107.947014,
    lat: 30.749848,
    visibility: 'window',
    category: 'gorge',
    intro: '万州北三峡库区山城与江峡，郑渝线入渝门户。',
  }),

  // 青荣（0）
  spot({
    id: 'qingrong-jimo',
    name: '即墨滨海',
    lng: 120.438957,
    lat: 36.644548,
    visibility: 'window',
    category: 'other',
    intro: '青荣城际即墨北一带胶东滨海平原。',
  }),
  spot({
    id: 'qingrong-haiyang',
    name: '海阳海岸方向',
    lng: 120.97209,
    lat: 37.076115,
    visibility: 'distant',
    category: 'other',
    intro: '海阳北站周边黄海海岸方向，青荣线滨海旅游节点。',
  }),
  spot({
    id: 'qingrong-yantai',
    name: '烟台滨海',
    lng: 121.338096,
    lat: 37.406702,
    visibility: 'window',
    category: 'other',
    intro: '烟台南—牟平胶东半岛滨海城市风光。',
  }),
  spot({
    id: 'qingrong-weihai',
    name: '威海海岸',
    lng: 121.778468,
    lat: 37.436566,
    visibility: 'window',
    category: 'other',
    intro: '威海北一带黄海海岸与海蚀地貌方向，青荣线东段精华。',
  }),
  spot({
    id: 'qingrong-rongcheng',
    name: '荣成天尽头方向',
    lng: 122.40392,
    lat: 37.138626,
    visibility: 'distant',
    category: 'other',
    intro: '荣成站为青荣城际东端，成山头「天尽头」方向海岸门户。',
  }),

  // 日兰（0）
  spot({
    id: 'rilan-rizhao',
    name: '日照海滨方向',
    lng: 119.41704,
    lat: 35.394629,
    visibility: 'distant',
    category: 'other',
    intro: '日照西站黄海海滨城市门户，日兰高铁东端起点风光。',
  }),
  spot({
    id: 'rilan-linyi',
    name: '临沂沂蒙',
    lng: 118.303471,
    lat: 35.205594,
    visibility: 'window',
    category: 'mountain',
    intro: '临沂北一带沂蒙山地与平原过渡，日兰线鲁南窗景。',
  }),
  spot({
    id: 'rilan-qufu',
    name: '曲阜儒家故里方向',
    lng: 117.0,
    lat: 35.55,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 20,
    intro: '曲阜东站孔孟故里方向，日兰与京沪交汇的人文节点。',
  }),
  spot({
    id: 'rilan-heze',
    name: '菏泽平原',
    lng: 115.433882,
    lat: 35.128267,
    visibility: 'window',
    category: 'other',
    intro: '菏泽东鲁西南平原田园，日兰高铁西段风光。',
  }),

  // 商合杭（0）
  spot({
    id: 'shanghehang-huainan',
    name: '淮南江淮',
    lng: 117.102799,
    lat: 32.53833,
    visibility: 'window',
    category: 'other',
    intro: '商合杭淮南南一带江淮丘陵与田园。',
  }),
  spot({
    id: 'shanghehang-chaohu',
    name: '巢湖方向',
    lng: 117.947244,
    lat: 31.507173,
    visibility: 'distant',
    category: 'lake',
    intro: '巢湖东站周边巢湖水面方向，商合杭合肥—芜湖段。',
  }),
  spot({
    id: 'shanghehang-wuhu',
    name: '芜湖长江',
    lng: 118.37,
    lat: 31.33,
    visibility: 'window',
    category: 'other',
    maxDistKm: 25,
    intro: '芜湖长江沿岸城市风光，商合杭线皖南门户。',
  }),
  spot({
    id: 'shanghehang-xuancheng',
    name: '宣城皖南',
    lng: 118.72,
    lat: 30.95,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '宣城—广德南皖南丘陵与徽风田园，接近杭黄前的过渡。',
  }),
  spot({
    id: 'shanghehang-huzhou',
    name: '湖州水乡',
    lng: 120.1,
    lat: 30.85,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '湖州一带江南水乡与太湖南缘，商合杭入浙段落。',
  }),

  // 沪昆适量（超长干线只取标志段）
  spot({
    id: 'hukun-yiwu',
    name: '义乌金华丘陵',
    lng: 119.953741,
    lat: 29.293511,
    visibility: 'window',
    category: 'other',
    intro: '沪昆高铁义乌—金华浙中丘陵与城市风光。',
  }),
  spot({
    id: 'hukun-shangrao',
    name: '上饶信江',
    lng: 117.383568,
    lat: 28.408641,
    visibility: 'window',
    category: 'other',
    intro: '上饶一带赣东北山水，沪昆线衔接合福/杭黄的枢纽段。',
  }),
  spot({
    id: 'hukun-changsha',
    name: '长沙湘江方向',
    lng: 113.0,
    lat: 28.15,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 20,
    intro: '长沙南湘江与岳麓方向，沪昆高铁中段都会门户。',
  }),
  spot({
    id: 'hukun-huaihua-rail',
    name: '怀化南雪峰',
    lng: 110.0,
    lat: 27.55,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 15,
    intro: '怀化南雪峰山一带，沪昆高铁湘黔交界山地。',
  }),
  spot({
    id: 'hukun-guiyang-karst',
    name: '贵阳北喀斯特',
    lng: 106.7,
    lat: 26.65,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '贵阳北周边黔中喀斯特峰林，沪昆线西南枢纽风光。',
  }),
  spot({
    id: 'hukun-qujing',
    name: '曲靖滇东高原',
    lng: 103.8,
    lat: 25.5,
    visibility: 'window',
    category: 'other',
    maxDistKm: 15,
    intro: '曲靖北滇东高原田园，沪昆高铁入滇前段落。',
  }),

  // 宁杭 / 沪杭 适量
  spot({
    id: 'ninghang-liyang',
    name: '溧阳天目湖方向',
    lng: 119.101381,
    lat: 31.666344,
    visibility: 'distant',
    category: 'lake',
    intro: '宁杭高铁溧阳站一带，天目湖方向江南丘陵湖光。',
  }),
  spot({
    id: 'ninghang-yixing-rail',
    name: '宜兴陶都山水',
    lng: 119.859719,
    lat: 31.281425,
    visibility: 'window',
    category: 'other',
    intro: '宜兴一带江南山水与陶都风情，宁杭线苏浙交界。',
  }),
  spot({
    id: 'ninghang-huzhou-rail',
    name: '湖州太湖南缘',
    lng: 120.017366,
    lat: 30.816353,
    visibility: 'window',
    category: 'other',
    intro: '湖州太湖南缘水乡，宁杭高铁入杭前风光。',
  }),
  spot({
    id: 'huhang-jiashan',
    name: '嘉善—嘉兴水乡',
    lng: 120.735001,
    lat: 30.658906,
    visibility: 'window',
    category: 'other',
    intro: '沪杭高铁嘉善南—嘉兴南一带江南水乡与运河平原。',
  }),
  spot({
    id: 'huhang-haining',
    name: '海宁西钱塘方向',
    lng: 120.409321,
    lat: 30.461615,
    visibility: 'window',
    category: 'other',
    intro: '海宁西接近钱塘江北岸，沪杭线入杭前平原风光。',
  }),
  spot({
    id: 'huhang-hangzhou-portal',
    name: '杭州东门户',
    lng: 120.21233,
    lat: 30.289012,
    visibility: 'distant',
    category: 'lake',
    intro: '接近杭州东时可感知西湖—钱塘江城市山水门户气质。',
  }),
);

// —— 第四轮：空白/极少线路只补核心看点（不凑数）——
spots.push(
  // 杭台：天台山
  spot({
    id: 'hangtai-tiantaishan',
    name: '天台山',
    lng: 120.986098,
    lat: 29.129648,
    visibility: 'distant',
    category: 'mountain',
    intro: '杭台高铁天台山站直达，天台山佛教名山与浙东山水门户。',
  }),
  spot({
    id: 'hangtai-shengzhou',
    name: '嵊州新昌山水',
    lng: 120.796743,
    lat: 29.948628,
    visibility: 'window',
    category: 'mountain',
    intro: '嵊州新昌一带浙东丘陵，杭台线入天台前的山水段落。',
  }),

  // 杭温：楠溪江
  spot({
    id: 'hangwen-nanxijiang',
    name: '楠溪江',
    lng: 120.594313,
    lat: 28.90468,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '杭温高铁楠溪江站一带，永嘉楠溪江山水是本线核心窗景。',
  }),
  spot({
    id: 'hangwen-yandang-distant',
    name: '雁荡山方向',
    lng: 120.65,
    lat: 28.35,
    visibility: 'distant',
    category: 'mountain',
    intro: '接近温州时可感知雁荡山方向，杭温线浙南山地门户。',
  }),

  // 贵南：荔波
  spot({
    id: 'guinan-libo',
    name: '荔波喀斯特',
    lng: 108.158538,
    lat: 24.659599,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '贵南高铁荔波站，世界自然遗产荔波喀斯特峰林湖泊是本线高光。',
  }),
  spot({
    id: 'guinan-dushan',
    name: '独山山地',
    lng: 107.695615,
    lat: 25.641793,
    visibility: 'window',
    category: 'mountain',
    intro: '独山一带黔南山地，贵南高铁出都匀后的峰丛段落。',
  }),

  // 大西：平遥、黄河、太原盆地
  spot({
    id: 'daxi-pingyao',
    name: '平遥古城',
    lng: 112.15444,
    lat: 37.20139,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 12,
    intro: '世界文化遗产平遥古城本体（县城古城墙一带）；大西高铁平遥古城站在其西南约十余公里，车窗可远眺古城。',
  }),
  spot({
    id: 'daxi-yellow-river-yongji',
    name: '永济黄河',
    lng: 110.18,
    lat: 35.02,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '永济以西黄河河道与滩地（大面积水体靠大西高铁西侧取点）；晋陕交界窗外可见黄河。',
  }),
  spot({
    id: 'daxi-taiyuan-basin',
    name: '太原盆地',
    lng: 112.68,
    lat: 37.7,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '太原南以南晋中盆地田园（盆地范围内靠近大西高铁取点）。',
  }),

  // 沈大：渤海/大连
  spot({
    id: 'haida-bayuquan',
    name: '鲅鱼圈渤海',
    lng: 122.012493,
    lat: 40.083731,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '沈大高铁鲅鱼圈近渤海，辽东湾海岸是本线代表窗景。',
  }),
  spot({
    id: 'haida-dalian-coast',
    name: '大连滨海',
    lng: 121.613745,
    lat: 39.019475,
    visibility: 'window',
    category: 'other',
    intro: '沈大高铁南端大连，黄渤海滨城门户风光。',
  }),

  // 京哈：承德等少量
  spot({
    id: 'jingha-chengde-distant',
    name: '承德避暑山庄方向',
    lng: 117.937,
    lat: 40.978,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 15,
    intro: '京哈高铁承德南站，避暑山庄与坝上方向文旅门户。',
  }),
  spot({
    id: 'jingha-changchun-plain',
    name: '长春平原雪原',
    lng: 125.0374,
    lat: 43.739309,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '长春西一带东北平原，冬季雪原是京哈线典型气质。',
  }),

  // 徐连：连云港海滨
  spot({
    id: 'xulian-lianyungang',
    name: '连云港海滨',
    lng: 119.156824,
    lat: 34.611259,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '徐连高铁终点连云港东，黄海海滨与云台山方向门户。',
  }),

  // 郑太：太行
  spot({
    id: 'zhengtai-taihang',
    name: '太行山晋城段',
    lng: 113.097741,
    lat: 36.041785,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 12,
    intro: '郑太高铁晋城东—高平东穿太行山，是本线核心山岳窗景。',
  }),
  spot({
    id: 'zhengtai-changzhi',
    name: '长治上党盆地',
    lng: 113.101452,
    lat: 36.664013,
    visibility: 'window',
    category: 'other',
    intro: '长治东上党盆地，郑太高铁出太行后的高原田园。',
  }),

  // 广深港：珠江口
  spot({
    id: 'guangshengang-humen',
    name: '虎门珠江口',
    lng: 113.71562,
    lat: 22.867999,
    visibility: 'window',
    category: 'other',
    intro: '广深港高铁虎门站一带珠江口江海交汇，大湾区标志段落。',
  }),
  spot({
    id: 'guangshengang-hongkong-distant',
    name: '香港西九龙门户',
    lng: 114.164274,
    lat: 22.306248,
    visibility: 'window',
    category: 'other',
    intro: '广深港高铁终点香港西九龙，跨境高铁与维港都会门户。',
  }),

  // 福厦：湄洲/泉州
  spot({
    id: 'fuxia-putian',
    name: '湄洲湾跨海大桥',
    lng: 118.884013,
    lat: 25.211601,
    visibility: 'on_track',
    category: 'engineering',
    intro: '福厦高铁湄洲湾跨海大桥海域段，俯瞰碧蓝海水、渔排与船只拖尾。',
  }),
  spot({
    id: 'fuxia-quanzhou',
    name: '泉州海丝方向',
    lng: 118.44829,
    lat: 24.645644,
    visibility: 'distant',
    category: 'other',
    intro: '泉州站海丝古城方向，福厦高铁闽南文旅节点。',
  }),

  // 盐通：大丰湿地（唯一值得提的）
  spot({
    id: 'yantong-dafeng-wetland',
    name: '大丰麋鹿湿地方向',
    lng: 120.331278,
    lat: 32.924867,
    visibility: 'distant',
    category: 'other',
    intro: '盐通高铁盐城大丰站，黄海湿地与麋鹿保护区方向。',
  }),

  // 沪宁沿江：长江
  spot({
    id: 'huningyanjiang-jiangyin',
    name: '江阴长江',
    lng: 120.095286,
    lat: 31.732614,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '沪宁沿江高铁江阴段近长江，苏南沿江工业与江景并存。',
  }),

  // 京广：只补真正标志段
  spot({
    id: 'jingguang-yellow-river',
    name: '黄河郑州段方向',
    lng: 113.9427,
    lat: 33.718289,
    visibility: 'distant',
    category: 'other',
    intro: '京广高铁郑州东南北，黄河中下游平原与枢纽都会气质。',
  }),
  spot({
    id: 'jingguang-wuhan-yangtze',
    name: '武汉长江方向',
    lng: 114.368123,
    lat: 29.966212,
    visibility: 'distant',
    category: 'other',
    intro: '京广高铁武汉站一带长江大河与江城门户。',
  }),
  spot({
    id: 'jingguang-yueyang',
    name: '岳阳楼洞庭方向',
    lng: 113.1,
    lat: 29.35,
    visibility: 'distant',
    category: 'lake',
    maxDistKm: 25,
    intro: '岳阳东站洞庭湖与岳阳楼方向，京广线湘北文旅节点。',
  }),

  // 徐兰：华山、龙门
  spot({
    id: 'xulan-huashan',
    name: '华山',
    lng: 110.08083,
    lat: 34.46333,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 20,
    intro: '西岳华山（华山风景名胜区主峰一带）；徐兰高铁华山北站在其北侧约十余公里，是本线最醒目的山岳远眺。',
  }),
  spot({
    id: 'xulan-longmen',
    name: '洛阳龙门方向',
    lng: 112.45,
    lat: 34.55,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 20,
    intro: '洛阳龙门站龙门石窟方向，徐兰高铁中原文旅高光。',
  }),
  spot({
    id: 'xulan-tianshui',
    name: '天水秦岭北麓',
    lng: 105.7,
    lat: 34.65,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 12,
    intro: '天水南一带秦岭北麓山地（山麓范围内靠近徐兰高铁取点）；入甘前窗外可见北麓起伏。',
  }),

  // 京沪：泰山、长江
  spot({
    id: 'jinghu-taishan',
    name: '泰山方向',
    lng: 116.801762,
    lat: 36.899625,
    visibility: 'distant',
    category: 'mountain',
    intro: '京沪高铁泰安站，东岳泰山方向是本线标志山岳。',
  }),
  spot({
    id: 'jinghu-nanjing-yangtze',
    name: '南京长江',
    lng: 118.663907,
    lat: 31.933515,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '京沪高铁南京南一带长江下游江城门户风光。',
  }),

  // 成渝：几乎无标志窗景，只留重庆山城门户 1 个
  spot({
    id: 'chengyu-chongqing-hills',
    name: '重庆西山城丘陵',
    lng: 106.461517,
    lat: 29.555794,
    visibility: 'window',
    category: 'other',
    intro: '成渝高铁接近重庆西时丘陵与山城门户，本线少有辨识度的段落。',
  }),
);

// —— 车窗风景总清单补缺（2026-09）：公开窗景名录对照后入库 ——
// 原则：只收「车厢内肉眼可观赏」的核心/出名点；季节变体、观光小火车、说不清可见性的点不收。
spots.push(
  // 高原雪域补缺
  spot({
    id: 'lamulatso-distant',
    name: '拉姆拉措方向（远眺）',
    lng: 91.75,
    lat: 29.15,
    visibility: 'distant',
    category: 'lake',
    maxDistKm: 35,
    intro: '山南段远观高山圣湖方向，青藏/拉林沿线藏南高原湖泊远景。',
  }),
  spot({
    id: 'baima-snow-mountain',
    name: '白马雪山',
    lng: 99.2,
    lat: 28.25,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 15,
    intro: '丽香铁路反复穿越白马雪山支脉，高山针叶林与雪峰连绵，滇西北典型窗景。',
  }),
  spot({
    id: 'meili-snow-mountain-distant',
    name: '梅里雪山（远眺）',
    lng: 98.85,
    lat: 28.4,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 35,
    intro: '天气晴好时，丽香铁路白马雪山隧道一带可远眺梅里群峰。',
  }),
  spot({
    id: 'dukezong-distant',
    name: '独克宗古城方向',
    lng: 99.705,
    lat: 27.825,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 12,
    intro: '香格里拉段远观独克宗古城与高原城镇天际，进站前的人文门户。',
  }),
  spot({
    id: 'guozigou-bridge',
    name: '果子沟大桥',
    lng: 81.12,
    lat: 44.42,
    visibility: 'on_track',
    category: 'engineering',
    intro: '精伊霍铁路天山山谷 S 型巨型桥梁，雪山为背景，北疆标志性跨谷工程。',
  }),
  spot({
    id: 'sailimu-lake-distant',
    name: '赛里木湖（远眺）',
    lng: 81.15,
    lat: 44.58,
    visibility: 'distant',
    category: 'lake',
    maxDistKm: 25,
    intro: '精伊霍铁路晴朗天气可远眺赛里木湖湛蓝湖面，天山明珠。',
  }),
  spot({
    id: 'nalati-grassland-distant',
    name: '那拉提—巩乃斯草原方向',
    lng: 84.0,
    lat: 43.25,
    visibility: 'distant',
    category: 'grassland',
    maxDistKm: 30,
    intro: '精伊霍铁路天山腹地，那拉提/巩乃斯草原与云杉林远景。',
  }),
  spot({
    id: 'fuxian-lake-distant',
    name: '抚仙湖方向',
    lng: 102.88,
    lat: 24.48,
    visibility: 'distant',
    category: 'lake',
    maxDistKm: 25,
    intro: '昆玉河铁路玉溪段远眺抚仙湖，高原深水湖泊窗景。',
  }),
  spot({
    id: 'caohai-weining',
    name: '威宁草海',
    lng: 104.25,
    lat: 26.86,
    visibility: 'window',
    category: 'lake',
    maxDistKm: 12,
    intro: '内昆铁路威宁段高原淡水湖与候鸟湿地，冬季黑颈鹤栖息地。',
  }),

  // 山川峡谷与喀斯特补缺
  spot({
    id: 'beipanjiang-bridge',
    name: '北盘江特大桥',
    lng: 105.155,
    lat: 25.905,
    visibility: 'on_track',
    category: 'engineering',
    intro: '沪昆高铁跨北盘江大峡谷，世界级高墩桥飞越深谷，桥下喀斯特绝壁。',
  }),
  spot({
    id: 'malinghe-canyon',
    name: '马岭河峡谷瀑布群',
    lng: 104.92,
    lat: 25.12,
    visibility: 'window',
    category: 'gorge',
    maxDistKm: 12,
    intro: '贵广高铁兴义段马岭河地缝与瀑布群，雾气氤氲的峡谷窗景。',
  }),
  spot({
    id: 'lancang-bridge-lixiang',
    name: '澜沧江特大桥（丽香）',
    lng: 99.45,
    lat: 27.55,
    visibility: 'on_track',
    category: 'engineering',
    intro: '丽香铁路大跨度拱桥飞越澜沧江峡谷，脚下激流、两侧高山峡谷。',
  }),
  spot({
    id: 'nujiang-bridge-darui',
    name: '怒江特大桥方向',
    lng: 98.88,
    lat: 25.12,
    visibility: 'distant',
    category: 'engineering',
    maxDistKm: 20,
    intro: '大瑞铁路保山段跨怒江超级高桥方向，怒江大峡谷远景。',
  }),
  spot({
    id: 'shuihong-spiral',
    name: '水红铁路四层螺旋展线',
    lng: 104.55,
    lat: 26.15,
    visibility: 'on_track',
    category: 'engineering',
    intro: '水红铁路乌蒙山区火车绕山盘旋的四层螺旋展线，河谷村寨层层铺开。',
  }),
  spot({
    id: 'yulong-river-karst',
    name: '遇龙河峰丛',
    lng: 110.48,
    lat: 24.75,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '贵广高铁阳朔段遇龙河蜿蜒穿峰林，河道与馒头峰同框。',
  }),
  spot({
    id: 'wanfenglin',
    name: '万峰林',
    lng: 104.95,
    lat: 25.15,
    visibility: 'window',
    category: 'other',
    maxDistKm: 15,
    intro: '南昆/贵广兴义一带大片锥状峰林铺展田野，西南喀斯特标志地貌。',
  }),
  spot({
    id: 'xiaozhai-tiankeng-distant',
    name: '小寨天坑方向',
    lng: 109.45,
    lat: 31.08,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 25,
    intro: '郑渝高铁奉节段远眺小寨天坑喀斯特方向，三峡库区奇观。',
  }),
  spot({
    id: 'xingwen-stone-sea',
    name: '兴文石海方向',
    lng: 105.1,
    lat: 28.3,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 20,
    intro: '成贵高铁兴文段石海喀斯特峰丛方向，川南石林地貌。',
  }),
  spot({
    id: 'zhijin-karst',
    name: '织金喀斯特峰丛',
    lng: 105.75,
    lat: 26.65,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 50,
    intro: '沪昆高铁织金段喀斯特峰丛与山地田园，黔中岩溶窗景。',
  }),
  spot({
    id: 'wugongshan-distant',
    name: '武功山云端草甸方向',
    lng: 114.18,
    lat: 27.45,
    visibility: 'distant',
    category: 'grassland',
    maxDistKm: 30,
    intro: '沪昆高铁萍乡段远眺武功山高山草甸与云海方向。',
  }),
  spot({
    id: 'zhangshiyan-taihang',
    name: '太行嶂石岩地貌',
    lng: 113.7,
    lat: 37.55,
    visibility: 'distant',
    category: 'gorge',
    maxDistKm: 40,
    intro: '石太/太行沿线阳泉一带峡谷与嶂石岩层状地貌，华北山地窗景。',
  }),

  // 森林草原荒漠补缺
  spot({
    id: 'daxinganling-forest',
    name: '大兴安岭林海',
    lng: 121.4246,
    lat: 48.7898,
    visibility: 'window',
    category: 'other',
    maxDistKm: 15,
    intro: '滨洲/牙林/漠河线落叶松与白桦林绵延，东北林海雪原核心段。',
  }),
  spot({
    id: 'hulunbuir-grassland',
    name: '呼伦贝尔草原',
    lng: 119.75,
    lat: 49.2,
    visibility: 'window',
    category: 'grassland',
    maxDistKm: 15,
    intro: '滨洲铁路海拉尔—满洲里段无边草场与蒙古包，北疆草原窗景。',
  }),
  spot({
    id: 'mingsha-mountain',
    name: '鸣沙山沙漠',
    lng: 94.68,
    lat: 40.08,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 12,
    intro: '敦格铁路敦煌段沙丘起伏，与月牙泉同框的沙漠窗景。',
  }),
  spot({
    id: 'yueyaquan-distant',
    name: '月牙泉方向',
    lng: 94.67,
    lat: 40.09,
    visibility: 'distant',
    category: 'lake',
    maxDistKm: 15,
    intro: '敦煌鸣沙山环抱的月牙泉方向，敦格铁路进敦煌门户人文自然景观。',
  }),
  spot({
    id: 'gurbantunggut-desert',
    name: '古尔班通古特沙漠',
    lng: 87.5,
    lat: 44.5,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 15,
    intro: '北疆铁路半固定沙丘与梭梭林，准噶尔盆地荒漠穿行。',
  }),
  spot({
    id: 'mengdong-bamboo-sea',
    name: '猛洞河竹海',
    lng: 109.95,
    lat: 28.55,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '焦柳/张吉怀湘西段猛洞河沿岸翠绿竹海连绵。',
  }),

  // 江河湖海湿地补缺
  spot({
    id: 'yellow-river-lankao-bend',
    name: '黄河兰考九曲弯',
    lng: 114.82,
    lat: 34.82,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '陇海高铁兰考段黄河河道蜿蜒，九曲黄河下游标志性河弯。',
  }),
  spot({
    id: 'wanquan-river',
    name: '万泉河湿地',
    lng: 110.42,
    lat: 19.22,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '海南环岛高铁东线万泉河河道与椰林湿地，热带水乡窗景。',
  }),
  spot({
    id: 'boao-jade-shoal',
    name: '博鳌玉带滩',
    lng: 110.57,
    lat: 19.15,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '海南环岛高铁博鳌一带玉带滩与入海口，碧蓝海岸线。',
  }),
  spot({
    id: 'beibu-gulf-xiwan',
    name: '北部湾西湾跨海',
    lng: 107.96,
    lat: 21.56,
    visibility: 'on_track',
    category: 'other',
    intro: '防东铁路西湾跨海大桥段，列车近海穿行北部湾。',
  }),
  spot({
    id: 'qiongzhou-strait-ferry',
    name: '琼州海峡火车轮渡',
    lng: 110.18,
    lat: 20.05,
    visibility: 'window',
    category: 'other',
    maxDistKm: 15,
    intro: '粤海铁路列车开上渡轮跨琼州海峡，海上全景的独特车窗体验。',
  }),

  // 花海田园村落补缺
  spot({
    id: 'luoping-rapeseed',
    name: '罗平金鸡峰丛油菜花',
    lng: 104.32,
    lat: 24.88,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '南昆铁路罗平段 2–3 月喀斯特峰林与金色油菜花海同框，滇东花季名景。',
  }),
  spot({
    id: 'hani-terrace-distant',
    name: '元阳哈尼梯田方向',
    lng: 102.75,
    lat: 23.12,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 35,
    intro: '玉蒙铁路元阳段远眺哈尼梯田，冬季灌水期如镜面梯田。',
  }),
  spot({
    id: 'congjiang-dong-village',
    name: '从江侗寨鼓楼群',
    lng: 108.9,
    lat: 25.75,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '贵广高铁从江段半山腰侗族村寨与鼓楼群，黔东南人文窗景。',
  }),
  spot({
    id: 'tulou-longyan',
    name: '闽西土楼群',
    lng: 117.0,
    lat: 24.65,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 20,
    intro: '龙厦铁路龙岩段圆形土楼群方向，客家民居世界遗产远景。',
  }),
  spot({
    id: 'wulin-ancient-village',
    name: '梧林古厝红砖村',
    lng: 118.52,
    lat: 24.72,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 15,
    intro: '福厦高铁泉州段红砖飞檐闽南古村方向，海丝人文窗景。',
  }),
  spot({
    id: 'hakka-weilong-ganzhou',
    name: '赣南客家围屋方向',
    lng: 115.0,
    lat: 25.85,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 20,
    intro: '京九高铁赣州段赣南圆形围屋方向，客家聚落远景。',
  }),
  spot({
    id: 'gongyi-imperial-tombs',
    name: '北宋皇陵石像生麦田',
    lng: 112.95,
    lat: 34.65,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '陇海高铁巩义段麦田中散布千年石像生，麦浪与皇陵同框。',
  }),
  spot({
    id: 'liangshan-terraces',
    name: '大凉山梯田',
    lng: 102.85,
    lat: 28.15,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '成昆铁路大凉山段层层叠叠水田如镜，彝族山地田园。',
  }),

  // 历史人文补缺
  spot({
    id: 'dali-three-pagodas',
    name: '崇圣寺三塔方向',
    lng: 100.14594,
    lat: 25.70849,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 16,
    intro: '大丽铁路洱海畔远眺大理古城与崇圣寺三塔。',
  }),
  spot({
    id: 'jianshui-double-dragon',
    name: '建水双龙桥方向',
    lng: 102.82,
    lat: 23.62,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 15,
    intro: '玉蒙铁路建水段十七孔双龙桥与古城方向。',
  }),
  spot({
    id: 'tengwangge',
    name: '滕王阁方向',
    lng: 115.88,
    lat: 28.68,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 12,
    intro: '沪昆高铁南昌段赣江边滕王阁古楼方向。',
  }),
  spot({
    id: 'yellow-crane-tower-distant',
    name: '黄鹤楼方向',
    lng: 114.3,
    lat: 30.55,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 12,
    intro: '京广高铁武汉段长江边黄鹤楼方向，江城标志。',
  }),
  spot({
    id: 'wudang-mountain-distant',
    name: '武当山方向',
    lng: 111.003889,
    lat: 32.400833,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 55,
    intro: '汉十高铁十堰段远眺武当山道教名山。',
  }),
  spot({
    id: 'gulongzhong-distant',
    name: '古隆中方向',
    lng: 112.05,
    lat: 32.05,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 15,
    intro: '汉十高铁襄阳段古隆中三国遗迹方向。',
  }),
  spot({
    id: 'heijing-ancient-town',
    name: '黑井古镇',
    lng: 101.55,
    lat: 25.4,
    visibility: 'window',
    category: 'other',
    maxDistKm: 8,
    intro: '成昆铁路黑井站千年盐都古镇，峡谷中的人文停靠点。',
  }),
  spot({
    id: 'shanhaiguan-great-wall',
    name: '山海关长城',
    lng: 119.75,
    lat: 40.01,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '津山铁路渤海之滨山海关长城关隘，「天下第一关」。',
  }),
  spot({
    id: 'hanguguan-distant',
    name: '函谷关方向',
    lng: 110.92,
    lat: 34.63,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 15,
    intro: '陇海铁路灵宝段古函谷关关隘方向。',
  }),
  spot({
    id: 'lingqu-canal',
    name: '兴安灵渠',
    lng: 110.65,
    lat: 25.6,
    visibility: 'window',
    category: 'engineering',
    maxDistKm: 10,
    intro: '衡柳高铁兴安段现代高铁与千年灵渠运河同框。',
  }),
  spot({
    id: 'leifeng-pagoda-distant',
    name: '西湖雷峰塔方向',
    lng: 120.15,
    lat: 30.23,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 12,
    intro: '沪昆/杭黄高铁杭州段西湖雷峰塔方向。',
  }),

  // 铁路工程与城市天际线补缺
  spot({
    id: 'yixiantian-bridge-chengkun',
    name: '成昆一线天桥',
    lng: 102.92,
    lat: 29.25,
    visibility: 'on_track',
    category: 'engineering',
    intro: '成昆铁路峡谷中单拱石桥「一线天」，绝壁夹江的工程奇观。',
  }),
  spot({
    id: 'qingshuihe-bridge-qingzang',
    name: '清水河特大桥',
    lng: 93.05,
    lat: 35.35,
    visibility: 'on_track',
    category: 'engineering',
    intro: '青藏铁路可可西里超长铁路桥，兼作藏羚羊迁徙通道的标志工程。',
  }),
  spot({
    id: 'xingfuyuan-bridge',
    name: '幸福源大桥（阳朔）',
    lng: 110.55,
    lat: 24.72,
    visibility: 'on_track',
    category: 'engineering',
    intro: '贵广高铁阳朔段横跨峰林峡谷的幸福源大桥，高铁穿画而行。',
  }),
  spot({
    id: 'lujiazui-skyline',
    name: '上海陆家嘴天际线',
    lng: 121.5,
    lat: 31.24,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 15,
    intro: '京沪/沪昆高铁上海端可远眺陆家嘴摩天楼群天际线。',
  }),
  spot({
    id: 'zhujiang-newtown',
    name: '广州珠江新城天际线',
    lng: 113.32,
    lat: 23.12,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 12,
    intro: '京广/广深港高铁广州段珠江新城 CBD 天际线。',
  }),
  spot({
    id: 'chongqing-rivers-confluence',
    name: '重庆两江交汇山城',
    lng: 106.58,
    lat: 29.56,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '嘉陵江与长江交汇的山城江景，郑渝/成渝高铁重庆段标志窗景。',
  }),
  spot({
    id: 'hzmb-distant',
    name: '港珠澳大桥方向',
    lng: 113.55,
    lat: 22.28,
    visibility: 'distant',
    category: 'engineering',
    maxDistKm: 25,
    intro: '广深港高铁珠海/港珠澳方向远眺跨海大桥群。',
  }),
  spot({
    id: 'wuhan-yangtze-bridge',
    name: '武汉长江大桥',
    lng: 114.289,
    lat: 30.55,
    visibility: 'window',
    category: 'engineering',
    maxDistKm: 8,
    intro: '京广铁路经典公铁两用桥，列车过桥可俯瞰长江与龟蛇二山。',
  }),
  spot({
    id: 'nanjing-yangtze-bridge',
    name: '南京长江大桥',
    lng: 118.75,
    lat: 32.12,
    visibility: 'window',
    category: 'engineering',
    maxDistKm: 8,
    intro: '京沪铁路南京长江大桥，公铁两用经典江桥窗景。',
  }),

  // 生态窗景（可辨识栖息地段）
  spot({
    id: 'banna-elephant-habitat',
    name: '西双版纳亚洲象栖息山林',
    lng: 100.8,
    lat: 22.05,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '中老铁路西双版纳段热带雨林边缘，傍晚偶见亚洲象活动的林地窗景带。',
  }),
  spot({
    id: 'baima-snub-nosed-monkey-forest',
    name: '白马雪山滇金丝猴山林',
    lng: 99.535978,
    lat: 27.959321,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 25,
    intro: '丽香铁路白马雪山段高山针叶林，滇金丝猴栖息地山林远景。',
  }),
);

// —— 补充批次 2026-09-27：风景高铁线 + 高校窗景（坐标核真，公开资料可查）——
spots.push(
  spot({
    id: 'mogao-grottoes-dunhuang',
    name: '莫高窟',
    lng: 94.8097,
    lat: 40.0421,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 30,
    intro:
      '敦煌东南 25 公里鸣沙山东麓，中国石窟艺术巅峰；列车入敦煌段可远眺鸣沙山，莫高窟在其山麓。',
  }),
  spot({
    id: 'mingsha-mountain-dunhuang',
    name: '鸣沙山月牙泉',
    lng: 94.669,
    lat: 40.089,
    visibility: 'distant',
    category: 'desert',
    maxDistKm: 6,
    intro:
      '敦煌城南 5 公里沙山与清泉共生的奇观，月牙泉嵌于沙山之间，列车入敦煌段右侧可望沙山轮廓。',
  }),
  spot({
    id: 'jiayuguan-great-wall',
    name: '嘉峪关关城',
    lng: 98.2894,
    lat: 39.8018,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 12,
    intro:
      '明长城西端第一关「天下雄关」，兰新线嘉峪关站北侧可远眺，关城在戈壁与祁连雪山之间独立，雄浑醒目。',
  }),
  spot({
    id: 'hutiao-gorge',
    name: '虎跳峡',
    lng: 100.0946,
    lat: 27.2572,
    visibility: 'distant',
    category: 'gorge',
    maxDistKm: 30,
    intro:
      '金沙江深切玉龙雪山与哈巴雪山之间的世界最深峡谷之一；丽香铁路跨金沙江特大桥即在其下游，车过大桥左窗可望峡谷奔流。',
  }),
  spot({
    id: 'lashihai-wetland',
    name: '拉市海',
    lng: 100.1342,
    lat: 26.8608,
    visibility: 'window',
    category: 'lake',
    maxDistKm: 8,
    intro:
      '丽江拉市海高原湿地，候鸟越冬地；丽香铁路穿拉市海西侧，左侧车窗外可见湖水与候鸟群起。',
  }),
  spot({
    id: 'wuyi-mountain-distant',
    name: '武夷山（远眺）',
    lng: 117.9959,
    lat: 27.7261,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 15,
    intro:
      '世界双遗产，合福高铁经武夷山北站，左窗可望丹霞峰林与九曲溪方向；晴日峰影连绵，雨后云海尤为壮观。',
  }),
  spot({
    id: 'sichuan-university-jiangan',
    name: '四川大学江安校区',
    lng: 104.0064,
    lat: 30.5589,
    visibility: 'window',
    category: 'other',
    maxDistKm: 4,
    intro:
      '四川大学江安校区现代化校园，占地 3400 亩；成贵高铁成都东站出站后左侧可见校园建筑群与湖面景观。',
  }),
);

// —— v3 批次 2026-09-27：包西线（baoxi）策展，六维/来源/时段齐全，里程侧别由走廊折线自动回填 ——
spots.push(
  spot({
    id: 'xiangshawan-dunes',
    name: '响沙湾沙丘（库布齐沙漠东端）',
    lng: 109.927,
    lat: 40.243,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 3,
    viewScale: 'near',
    viewMinutes: 8,
    dimensions: ['geo'],
    subtype: 'desert_gobi',
    tags: ['库布齐沙漠', '沙丘', '5A景区', '响沙'],
    side: 'right',
    bestView: {
      months: [5, 6, 7, 8, 9, 10],
      timeOfDay: 'day',
      light: 'any',
      note: '5—10月风沙较小；雨后沙不鸣，连续晴日沙色最亮',
    },
    lineHints: [{ corridorId: 'baoxi', nearStations: ['达拉特西', '东胜西'], alongKmTo: 48 }],
    sources: [
      {
        type: 'authority',
        level: 'A',
        ref: 'https://www.ixsw.cn/xsw/about/about-1.html',
        quote: '中国AAAAA级旅游景区，坐落在达拉特旗的库布其沙漠中',
        checkedAt: '2026-09-27',
      },
      {
        type: 'news',
        level: 'B',
        ref: 'https://m.thepaper.cn/newsDetail_forward_4976736',
        quote: '响沙湾站处于库布齐沙漠，是包西线五大装车基地之一',
        checkedAt: '2026-09-27',
      },
      {
        type: 'authority',
        level: 'A',
        ref: 'http://www.bigemap.net/city-6137.html',
        quote: '经度109.956058 纬度40.244043（GCJ-02，已转WGS84）',
        checkedAt: '2026-09-27',
      },
    ],
    verification: {
      status: 'verified',
      checkedAt: '2026-09-27',
      checkedBy: 'ai+2026-09-v3-batch1',
      method: '景区官网+铁路官方可见性+GCJ02转WGS84+走廊投影1.9km',
    },
    source: 'ai_reviewed',
    reviewedAt: '2026-09-27',
    reviewRound: '2026-09-v3-batch1',
    intro:
      '库布齐沙漠东端的百米月牙沙山，包西线包头至达拉特西段右侧沙带贴窗掠过，列车在沙丘间穿行约十分钟，5—10月晴日沙色最亮。',
  }),
  spot({
    id: 'maowusu-sandy-land',
    name: '毛乌素沙地（鄂尔多斯—榆林段）',
    lng: 109.8829,
    lat: 39.3009,
    visibility: 'window',
    category: 'desert',
    maxDistKm: 8,
    viewScale: 'mid',
    viewMinutes: 30,
    dimensions: ['geo'],
    subtype: 'desert_gobi',
    tags: ['毛乌素沙地', '治沙生态', '沙柳樟子松'],
    side: 'left',
    bestView: { months: [5, 6, 7, 8, 9, 10], timeOfDay: 'day', light: 'any', note: '夏秋固沙林绿意与沙丘对比最强' },
    lineHints: [{ corridorId: 'baoxi', nearStations: ['鄂尔多斯', '榆林'], alongKmTo: 165 }],
    sources: [
      {
        type: 'news',
        level: 'B',
        ref: 'http://8.134.116.66:8060/Content-36569.html',
        quote: '跨越毛乌素沙漠、陕北黄土高原和关中平原三个截然不同的地理环境',
        checkedAt: '2026-09-27',
      },
      {
        type: 'authority',
        level: 'A',
        ref: 'https://www.sxsm.gov.cn/xwzx/tzgg/202210/t20221014_1073363.html',
        quote: '在毛乌素沙地东缘风沙区相对低洼处',
        checkedAt: '2026-09-27',
      },
    ],
    verification: {
      status: 'probable',
      checkedAt: '2026-09-27',
      checkedBy: 'ai+2026-09-v3-batch1',
      method: '官方开通稿确认穿行+地貌代表点贴走廊选取，投影3.1km',
    },
    source: 'ai_reviewed',
    reviewedAt: '2026-09-27',
    reviewRound: '2026-09-v3-batch1',
    intro:
      '鄂尔多斯至榆林段列车纵贯毛乌素沙地，窗下沙柳、樟子松固沙林与金黄沙丘交错，塞北地貌连绵约半小时，夏秋绿意最盛。',
  }),
  spot({
    id: 'hongjiannao-lake',
    name: '红碱淖',
    lng: 109.91,
    lat: 39.105,
    visibility: 'window',
    category: 'lake',
    maxDistKm: 12,
    viewScale: 'mid',
    viewMinutes: 10,
    dimensions: ['geo', 'nature'],
    subtype: 'lake',
    tags: ['沙漠淡水湖', '国家级自然保护区', '国家重要湿地', '遗鸥'],
    side: 'right',
    bestView: {
      months: [4, 5, 6, 7, 8],
      timeOfDay: 'day',
      light: 'any',
      note: '4—8月遗鸥繁殖期，晨昏鸟群起落最壮观',
    },
    lineHints: [{ corridorId: 'baoxi', nearStations: ['中鸡', '神木西'] }],
    sources: [
      {
        type: 'authority',
        level: 'S',
        ref: 'https://www.sxsm.gov.cn/xwzx/tzgg/202210/t20221014_1073363.html',
        quote: '地理坐标北纬39°04′—39°08′，东经109°50′—109°56′',
        checkedAt: '2026-09-27',
      },
      {
        type: 'news',
        level: 'B',
        ref: 'https://www.news.cn/ci/20260319/45429a25695f4f9085fe894baa7fe3a2/c.html',
        quote: '中国最大的沙漠淡水湖，4-8月遗鸥在这里繁衍生息',
        checkedAt: '2026-09-27',
      },
      {
        type: 'news',
        level: 'B',
        ref: 'http://sn.people.com.cn/n2/2024/0927/c226647-40991772.html',
        quote: '全球最大的遗鸥繁殖栖息地；2023年11月列为国家重要湿地',
        checkedAt: '2026-09-27',
      },
    ],
    verification: {
      status: 'verified',
      checkedAt: '2026-09-27',
      checkedBy: 'ai+2026-09-v3-batch1',
      method: '政府公告湖域坐标框内选近轨代表点+新华网/人民网独立二源',
    },
    source: 'ai_reviewed',
    reviewedAt: '2026-09-27',
    reviewRound: '2026-09-v3-batch1',
    intro:
      '中国最大沙漠淡水湖在铁路右侧铺展，鄂尔多斯至榆林段右侧可望蓝湖嵌于沙海，4—8月遗鸥栖息，晨昏鸟群起落最壮观。',
  }),
  spot({
    id: 'zhenbeitai-great-wall',
    name: '镇北台（万里长城第一台）',
    lng: 109.7292,
    lat: 38.3397,
    visibility: 'distant',
    category: 'other',
    viewScale: 'far',
    viewMinutes: 3,
    dimensions: ['history'],
    subtype: 'great_wall',
    tags: ['明长城', '全国重点文保', '万里长城第一台', '世界文化遗产'],
    side: 'left',
    bestView: {
      months: [3, 4, 5, 9, 10, 11],
      timeOfDay: 'day',
      light: 'any',
      note: '晴好空气通透时远眺；秋冬晨昏墩台轮廓最清晰',
    },
    lineHints: [{ corridorId: 'baoxi', nearStations: ['鄂尔多斯', '榆林'] }],
    sources: [
      {
        type: 'authority',
        level: 'S',
        ref: 'http://wwj.shaanxi.gov.cn/wbxx/bkydww/wwbhdw/index_77.html',
        quote: '5-0442-3-248-8 镇北台 明 榆阳区 国保 第五批',
        checkedAt: '2026-09-27',
      },
      {
        type: 'academic',
        level: 'B',
        ref: 'https://greatwallforum.com/location-shaanxi-zhenbeitai.html',
        quote: 'Coordinates: 38°20′23″N 109°43′45″E，about 6.5km north of Yulin',
        checkedAt: '2026-09-27',
      },
      {
        type: 'news',
        level: 'B',
        ref: 'https://toutiao.cnwest.com/data/sxtt/share/news/2025/12/15/content_2950594.html',
        quote: '2001年6月国务院公布镇北台为第五批全国重点文物保护单位',
        checkedAt: '2026-09-27',
      },
    ],
    verification: {
      status: 'probable',
      checkedAt: '2026-09-27',
      checkedBy: 'ai+2026-09-v3-batch1',
      method: 'S级国保名录+独立WGS坐标交叉；政府页转载DMS坐标系错误，未采用',
    },
    source: 'ai_reviewed',
    reviewedAt: '2026-09-27',
    reviewRound: '2026-09-v3-batch1',
    intro:
      '万里长城第一台矗立榆林城北红山，鄂尔多斯至榆林段左侧晴空可远眺三十米高方形墩台，空气通透的秋冬最清晰。',
  }),
  spot({
    id: 'hongshi-gorge-yulin',
    name: '红石峡（塞上碑林）',
    lng: 109.717,
    lat: 38.3355,
    visibility: 'distant',
    category: 'gorge',
    viewScale: 'far',
    viewMinutes: 3,
    dimensions: ['geo', 'history'],
    subtype: 'gorge',
    tags: ['摩崖石刻', '塞上碑林', '榆溪河', '陕西省文保'],
    side: 'left',
    bestView: { months: [5, 6, 7, 8, 9, 10], timeOfDay: 'day', light: 'any', note: '晴日红岩与峡口林带可辨' },
    lineHints: [{ corridorId: 'baoxi', nearStations: ['鄂尔多斯', '榆林'] }],
    sources: [
      {
        type: 'authority',
        level: 'A',
        ref: 'https://yl.gov.cn/mlyl/zjyl/fjms/201902/t20190213_17513.html',
        quote: '榆林城北三公里，榆溪河穿峡而过，东西两崖题刻达160多块',
        checkedAt: '2026-09-27',
      },
      {
        type: 'authority',
        level: 'A',
        ref: 'https://ditu.amap.com/place/B039000014',
        quote: '地理坐标：38.336034,109.722622（GCJ-02，已转WGS84）',
        checkedAt: '2026-09-27',
      },
      {
        type: 'authority',
        level: 'B',
        ref: 'https://yuyang.gov.cn/zfxxgk/fdzdgknr/shgysyjs/wrfz/202108/P020240725384494862714.pdf',
        quote: '建设地块位于红石峡遗址南、镇北台遗址西',
        checkedAt: '2026-09-27',
      },
    ],
    verification: {
      status: 'verified',
      checkedAt: '2026-09-27',
      checkedBy: 'ai+2026-09-v3-batch1',
      method: '政府景区资料+高德POI（GCJ转WGS84）+政府环评交叉',
    },
    source: 'ai_reviewed',
    reviewedAt: '2026-09-27',
    reviewRound: '2026-09-v3-batch1',
    intro:
      '榆林城北榆溪河切出的红石峡谷，镇北台南侧，鄂尔多斯至榆林段左侧远眺红岩夹河，塞上碑林摩崖与长城相连。',
  }),
  spot({
    id: 'loess-plateau-gullies',
    name: '黄土高原梁峁沟壑（子长—延安段）',
    lng: 109.0768,
    lat: 37.5385,
    visibility: 'window',
    category: 'grassland',
    maxDistKm: 8,
    viewScale: 'mid',
    viewMinutes: 50,
    dimensions: ['geo'],
    subtype: 'plain_basin',
    tags: ['黄土高原', '梁峁沟壑', '梯田窑洞'],
    side: 'left',
    bestView: {
      months: [4, 5, 6, 7, 8, 9, 10],
      timeOfDay: 'day',
      light: 'any',
      note: '雨后放晴或日落时梁峁明暗层次最丰富',
    },
    lineHints: [{ corridorId: 'baoxi', nearStations: ['子长', '延安'], alongKmTo: 480 }],
    sources: [
      {
        type: 'news',
        level: 'B',
        ref: 'http://8.134.116.66:8060/Content-36569.html',
        quote: '跨越毛乌素沙漠、陕北黄土高原和关中平原三个地理环境',
        checkedAt: '2026-09-27',
      },
      {
        type: 'authority',
        level: 'S',
        ref: 'http://snsm.mnr.gov.cn/uploadfile/20130724/20130724173652697.pdf',
        quote: '陕西省地貌分类；陕北、关中、陕南分布及区域面积',
        checkedAt: '2026-09-27',
      },
    ],
    verification: {
      status: 'probable',
      checkedAt: '2026-09-27',
      checkedBy: 'ai+2026-09-v3-batch1',
      method: '官方开通稿确认穿行黄土高原；代表点贴走廊选于真实梁峁区',
    },
    source: 'ai_reviewed',
    reviewedAt: '2026-09-27',
    reviewRound: '2026-09-v3-batch1',
    intro:
      '子长至延安段列车穿行黄土高原梁峁沟壑，窑洞、梯田与千沟万壑在两窗层叠，雨后或日落时梁峁明暗最富层次。',
  }),
  spot({
    id: 'yan-river-yanan',
    name: '延河（延安入城段）',
    lng: 109.5104,
    lat: 36.6145,
    visibility: 'window',
    category: 'gorge',
    maxDistKm: 8,
    viewScale: 'near',
    viewMinutes: 8,
    dimensions: ['geo'],
    subtype: 'river',
    tags: ['延河', '黄土河谷', '三山二水'],
    side: 'left',
    bestView: { months: [], timeOfDay: 'day', light: 'any', note: '晨昏河谷光影好，冬季结冰另有一色' },
    lineHints: [{ corridorId: 'baoxi', nearStations: ['延安'], alongKmTo: 552 }],
    sources: [
      {
        type: 'authority',
        level: 'A',
        ref: 'https://www.yanan.gov.cn/gk/fdzdgknr/shgy/wtly/yzya/zmjd/1570765644759146498.html',
        quote: '山下延河与南川河合流东去，三山鼎峙，二水合流',
        checkedAt: '2026-09-27',
      },
      {
        type: 'news',
        level: 'B',
        ref: 'http://union.china.com.cn/zhuanti/txt/2018-12/18/content_40617777.html',
        quote: '宝塔山与凤凰山、清凉山鼎足而立，山下延河与南川河合流东去',
        checkedAt: '2026-09-27',
      },
    ],
    verification: {
      status: 'probable',
      checkedAt: '2026-09-27',
      checkedBy: 'ai+2026-09-v3-batch1',
      method: '政府/媒体确认河流与城轨关系；河槽近轨点0.8km',
    },
    source: 'ai_reviewed',
    reviewedAt: '2026-09-27',
    reviewRound: '2026-09-v3-batch1',
    intro:
      '延河在延安城边与南川河汇流，列车入城前沿河谷行进，左侧近窗可见河滩柳林与三山夹峙谷地，晨昏光影最佳。',
  }),
  spot({
    id: 'baota-pagoda-yanan',
    name: '宝塔山（岭山寺塔）',
    lng: 109.49,
    lat: 36.5958,
    visibility: 'window',
    category: 'other',
    maxDistKm: 3,
    viewScale: 'near',
    viewMinutes: 5,
    dimensions: ['history', 'architecture'],
    subtype: 'revolutionary',
    tags: ['延安革命旧址', '岭山寺塔', '革命圣地标志', '全国重点文保'],
    side: 'right',
    bestView: {
      months: [],
      timeOfDay: 'any',
      light: 'any',
      note: '入城段全天可见，夜间宝塔山体亮灯亦醒目',
    },
    lineHints: [{ corridorId: 'baoxi', nearStations: ['延安'] }],
    sources: [
      {
        type: 'authority',
        level: 'S',
        ref: 'http://jingqu.yagmjnd.gov.cn/WebFE/web/scenic.aspx',
        quote: '宝塔是革命圣地延安的标志和象征；1996年公布为全国重点文物保护单位',
        checkedAt: '2026-09-27',
      },
      {
        type: 'authority',
        level: 'A',
        ref: 'https://wlj.yanan.gov.cn/zjya/lyjq/1570765644759146498.html',
        quote: '宝塔山位于延安城东，延河之滨；岭山寺塔八角九级高约44米',
        checkedAt: '2026-09-27',
      },
      {
        type: 'authority',
        level: 'A',
        ref: 'https://map.bmcx.com/baotashan__map/',
        quote: '109.495356,36.595922（腾讯地图GCJ-02，已转WGS84）',
        checkedAt: '2026-09-27',
      },
    ],
    verification: {
      status: 'verified',
      checkedAt: '2026-09-27',
      checkedBy: 'ai+2026-09-v3-batch1',
      method: 'S级国保+政府景区+GCJ02转WGS84；投影0.7km',
    },
    source: 'ai_reviewed',
    reviewedAt: '2026-09-27',
    reviewRound: '2026-09-v3-batch1',
    intro:
      '革命圣地标志岭山寺塔雄踞延安城东嘉岭山巅，列车进延安段右侧近窗可见九层唐塔约五分钟，入夜亮灯亦醒目。',
  }),
  spot({
    id: 'huangdi-mausoleum-qiaoshan',
    name: '黄帝陵（桥山）',
    lng: 109.2661,
    lat: 35.5856,
    visibility: 'distant',
    category: 'other',
    viewScale: 'far',
    viewMinutes: 5,
    dimensions: ['history'],
    subtype: 'ruins_site',
    tags: ['黄帝陵', '古墓葬第一号', '桥山古柏', '5A景区', '公祭'],
    side: 'right',
    bestView: {
      months: [],
      timeOfDay: 'day',
      light: 'any',
      note: '桥山八万株古柏四季常青；清明公祭期与秋冬柏色最显',
    },
    lineHints: [{ corridorId: 'baoxi', nearStations: ['黄陵南', '富县东'] }],
    sources: [
      {
        type: 'authority',
        level: 'S',
        ref: 'http://www.huangling.gov.cn/zjhl/hlly/1556482848049885185.html',
        quote: '第一批全国重点文物保护单位，编为古墓葬第一号，第一批5A级景区',
        checkedAt: '2026-09-27',
      },
      {
        type: 'authority',
        level: 'A',
        ref: 'https://www.sxlib.org.cn/dfzy/sxdwljgb/dwlgs/yhdl/201704/t20170426_699856.html',
        quote: '位于黄陵县城北1公里处的桥山之巅，北纬35°34′东经109°15′',
        checkedAt: '2026-09-27',
      },
      {
        type: 'authority',
        level: 'A',
        ref: 'http://www.bigemap.net/city-16991.html',
        quote: '109.271227,35.585284（GCJ-02，已转WGS84）',
        checkedAt: '2026-09-27',
      },
    ],
    verification: {
      status: 'verified',
      checkedAt: '2026-09-27',
      checkedBy: 'ai+2026-09-v3-batch1',
      method: 'S级国保+省文物局资料+GCJ02转WGS84；投影12.4km远眺',
    },
    source: 'ai_reviewed',
    reviewedAt: '2026-09-27',
    reviewRound: '2026-09-v3-batch1',
    intro:
      '天下第一陵在黄陵县城北桥山，富县东至蒲城东段右侧远眺，可见桥山八万株古柏凝成的墨绿山块，四季常青。',
  }),
  spot({
    id: 'guanzhong-plain',
    name: '关中平原（蒲城东—西安段）',
    lng: 109.4178,
    lat: 34.7022,
    visibility: 'window',
    category: 'grassland',
    maxDistKm: 8,
    viewScale: 'far',
    viewMinutes: 35,
    dimensions: ['geo'],
    subtype: 'plain_basin',
    tags: ['关中平原', '渭北田园', '麦田果园'],
    side: 'left',
    bestView: {
      months: [5, 6, 9, 10],
      timeOfDay: 'day',
      light: 'any',
      note: '5、6月麦黄与9、10月秋收季田野色块最鲜明',
    },
    lineHints: [{ corridorId: 'baoxi', nearStations: ['蒲城东', '西安'], alongKmTo: 820 }],
    sources: [
      {
        type: 'news',
        level: 'B',
        ref: 'http://8.134.116.66:8060/Content-36569.html',
        quote: '跨越毛乌素沙漠、陕北黄土高原和关中平原三个地理环境',
        checkedAt: '2026-09-27',
      },
      {
        type: 'authority',
        level: 'S',
        ref: 'http://xadfz.xa.gov.cn/xadq/xagk/sqjj/2048647687336742914.html',
        quote: '西安市位于黄河流域中部关中平原',
        checkedAt: '2026-09-27',
      },
    ],
    verification: {
      status: 'probable',
      checkedAt: '2026-09-27',
      checkedBy: 'ai+2026-09-v3-batch1',
      method: '官方开通稿+地方志确认；平原代表点贴走廊选取',
    },
    source: 'ai_reviewed',
    reviewedAt: '2026-09-27',
    reviewRound: '2026-09-v3-batch1',
    intro:
      '黄陵以南列车下塬进入关中平原，蒲城东至西安段两侧麦田果园与村落平铺天际，5、6月麦黄与秋收季最鲜明。',
  }),
  spot({
    id: 'xian-city-wall-jiefang',
    name: '西安城墙（解放门·火车站北墙段）',
    lng: 108.9585,
    lat: 34.2763,
    visibility: 'window',
    category: 'other',
    maxDistKm: 3,
    viewScale: 'near',
    viewMinutes: 4,
    dimensions: ['architecture'],
    subtype: 'historic_building',
    tags: ['西安城墙', '第一批国保', '解放门', '桥型城墙', '西安站'],
    side: 'left',
    bestView: {
      months: [],
      timeOfDay: 'any',
      light: 'any',
      note: 'K4161约傍晚抵西安，城墙亮灯时段最醒目',
    },
    lineHints: [{ corridorId: 'baoxi', nearStations: ['西安'] }],
    sources: [
      {
        type: 'authority',
        level: 'S',
        ref: 'https://wwj.shaanxi.gov.cn/wbxx/bkydww/wwbhdw/index.html',
        quote: '1-0104-3-057 西安城墙 明 国保 第一批',
        checkedAt: '2026-09-27',
      },
      {
        type: 'news',
        level: 'B',
        ref: 'http://culture.people.com.cn/n/2015/0306/c172318-26650715.html',
        quote: '2004年12月最后一个豁口即西安火车站广场处通过桥型城墙连接',
        checkedAt: '2026-09-27',
      },
      {
        type: 'authority',
        level: 'A',
        ref: 'http://www.chinaxiancitywall.com/list.php?cid=42&pid=2',
        quote: '解放门1934年因陇海铁路建西安火车站而新辟，2004年成桥拱形城门',
        checkedAt: '2026-09-27',
      },
    ],
    verification: {
      status: 'probable',
      checkedAt: '2026-09-27',
      checkedBy: 'ai+2026-09-v3-batch1',
      method: '国保+人民网+城墙官网确认车站贴北墙；点位据官方相对位置标定',
    },
    source: 'ai_reviewed',
    reviewedAt: '2026-09-27',
    reviewRound: '2026-09-v3-batch1',
    intro:
      '中国现存最完整明城垣，列车抵西安站前贴北墙滑行，左侧解放门桥拱城墙迎面而来，是坐火车进西安第一门。',
  }),
);

// —— V2 审查核真补录（2026-09-18，仅收录已核坐标）——
spots.push(
  spot({
    id: 'siberian-tiger-park-harbin',
    name: '东北虎林园（哈尔滨段）',
    lng: 126.596783,
    lat: 45.814961,
    visibility: 'window',
    category: 'other',
    maxDistKm: 8,
    intro: '出哈尔滨北行不久，车窗外可见东北虎林园栅栏内虎群活动，为哈齐方向特色窗景。',
  }),
  spot({
    id: 'daqing-oil-pumpjacks',
    name: '大庆油田磕头机群',
    lng: 125.116516,
    lat: 46.574478,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '进入大庆地界，抽油机成群分布线路两侧，日夜磕头作业，与高铁桥同框的工业窗景。',
  }),
  spot({
    id: 'zhalantun-cer-heritage',
    name: '扎兰屯中东铁路小镇',
    lng: 122.740264,
    lat: 48.012395,
    visibility: 'window',
    category: 'other',
    maxDistKm: 8,
    intro: '扎兰屯站区周边中东铁路建筑群与雅鲁河沿岸风光，滨洲线人文遗产节点。',
  }),
  spot({
    id: 'boketu-xinganling-rail',
    name: '博克图兴安岭段',
    lng: 121.914135,
    lat: 48.752064,
    visibility: 'window',
    category: 'engineering',
    maxDistKm: 8,
    intro: '滨洲线博克图站一带翻越大兴安岭，明线段林海深谷与中东铁路遗产气质浓厚。',
  }),
  spot({
    id: 'lamashan-balin',
    name: '喇嘛山（巴林段）',
    lng: 121.98,
    lat: 48.58,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 12,
    intro: '滨洲线巴林一带花岗岩奇峰错落于线路一侧，为大兴安岭段著名车窗奇景。',
  }),
  spot({
    id: 'shuangdao-bay-bridge',
    name: '双岛湾跨海特大桥',
    lng: 121.860789,
    lat: 37.441624,
    visibility: 'on_track',
    category: 'engineering',
    intro: '青荣城际牟平—威海北区间，列车以大弧线跨双岛湾，桥上海景开阔。',
  }),
  spot({
    id: 'anhai-bay-bridge',
    name: '安海湾特大桥',
    lng: 118.546672,
    lat: 24.684474,
    visibility: 'on_track',
    category: 'engineering',
    intro: '福厦高铁安海湾特大桥跨海段，湾内渔排与两岸清晰可见。',
  }),
  spot({
    id: 'changsha-bay-bridge-shanwei',
    name: '长沙湾特大桥（汕尾）',
    lng: 115.321535,
    lat: 22.81077,
    visibility: 'on_track',
    category: 'engineering',
    intro: '厦深高铁鲘门—汕尾区间长沙湾特大桥，湾内水域、蚝田与滩涂同框。',
  }),
  spot({
    id: 'beidaihe-approach-sea',
    name: '北戴河进站远眺海面',
    lng: 119.413724,
    lat: 39.849582,
    visibility: 'distant',
    category: 'other',
    maxDistKm: 12,
    intro: '北戴河站进站前后地势平坦，车窗可远眺渤海及南戴河一带岸线。',
  }),
  spot({
    id: 'xuwen-north-port-ferry',
    name: '徐闻北港火车轮渡',
    lng: 110.196,
    lat: 20.226,
    visibility: 'window',
    category: 'engineering',
    maxDistKm: 8,
    intro: '粤海铁路轮渡徐闻北港装船段，车窗可见栈桥、渡轮与港口海面（铁水联运特殊体验）。',
  }),
  spot({
    id: 'pulandian-bay-crossing',
    name: '普兰店湾跨海段',
    lng: 121.93,
    lat: 39.42,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '哈大高铁普兰店湾跨海段，列车近海穿行，滩涂养殖圈与开阔海面同框。',
  }),
  spot({
    id: 'huangyuan-gorge-g109',
    name: '湟源峡（西石峡三线并行）',
    lng: 101.363685,
    lat: 36.668926,
    visibility: 'on_track',
    category: 'gorge',
    intro: '青藏铁路出西宁穿西石峡，与 G109、G6 同挤湟水峡谷，丹霞状山体夹峙。',
  }),
  spot({
    id: 'laoya-gorge-lanqing',
    name: '老鸦峡',
    lng: 102.609943,
    lat: 36.392182,
    visibility: 'on_track',
    category: 'gorge',
    intro: '民和—乐都间湟水老鸦峡，铁路与公路并行穿峡，两岸陡崖夹峙。',
  }),
  spot({
    id: 'dabancheng-wetland-bridge',
    name: '达坂城湿地特大桥',
    lng: 88.243482,
    lat: 43.37833,
    visibility: 'on_track',
    category: 'engineering',
    intro: '兰新高铁达坂城湿地特大桥跨越戈壁中湿地，桥下绿草水鸟与荒漠反差强烈。',
  }),
  spot({
    id: 'jiayuguan-wall-underpass',
    name: '嘉峪关长城桥洞',
    lng: 98.276355,
    lat: 39.732694,
    visibility: 'on_track',
    category: 'engineering',
    intro: '兰新高铁近嘉峪关处从明长城防御线下桥洞穿过，与第一墩景区同框。',
  }),
  spot({
    id: 'qinglongqiao-switchback',
    name: '青龙桥站人字形展线',
    lng: 116.020237,
    lat: 40.351156,
    visibility: 'on_track',
    category: 'engineering',
    intro: '京张铁路青龙桥站「人」字形展线与百年站房，詹天佑铜像与繁体站匾同框。',
  }),
  spot({
    id: 'shuiguan-great-wall',
    name: '水关长城（关沟段）',
    lng: 116.031029,
    lat: 40.334218,
    visibility: 'window',
    category: 'engineering',
    maxDistKm: 8,
    intro: '京张关沟段与水关长城墙体并行，车窗可见敌楼沿山脊蜿蜒。',
  }),
  spot({
    id: 'niangziguan-pass',
    name: '娘子关关城',
    lng: 113.868813,
    lat: 37.960136,
    visibility: 'distant',
    category: 'engineering',
    maxDistKm: 25,
    intro: '石太普速娘子关站一带明代关城与绵河谷；关隘距站数百米，客专走行较远故标远眺。',
  }),
  spot({
    id: 'sanshenggong-water-hub',
    name: '三盛公水利枢纽',
    lng: 107.029352,
    lat: 40.310996,
    visibility: 'distant',
    category: 'engineering',
    maxDistKm: 12,
    intro: '包兰线磴口黄河大桥过河时可远望三盛公拦河闸与黄河「几字弯」顶点。',
  }),
  spot({
    id: 'tongguan-yellow-wei-confluence',
    name: '黄河潼关段（黄渭交汇）',
    lng: 110.285158,
    lat: 34.606947,
    visibility: 'window',
    category: 'other',
    maxDistKm: 10,
    intro: '陇海线潼关段沿黄河南岸，北望黄河水面、风陵渡及黄渭交汇浑黄双色水线。',
  }),
  spot({
    id: 'yuandang-lake-bridge',
    name: '元荡湖大桥跨湖段',
    lng: 120.929233,
    lat: 31.052998,
    visibility: 'on_track',
    category: 'engineering',
    intro: '沪苏湖方向元荡湖大桥斜跨示范区湖面，「湖上列车」与岸边湿地同框。',
  }),
  spot({
    id: 'wufengshan-yangtze-bridge',
    name: '五峰山长江大桥',
    lng: 119.628634,
    lat: 32.162217,
    visibility: 'on_track',
    category: 'engineering',
    intro: '连镇高铁五峰山长江大桥（高速铁路悬索桥），俯瞰入海口段浩阔江面与锚地船队。',
  }),
  spot({
    id: 'chuishan-pagoda',
    name: '圌山报恩塔',
    lng: 119.710773,
    lat: 32.217967,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 8,
    intro: '五峰山长江大桥南岸圌山孤峰与山顶报恩塔，连镇过江后显著地标。',
  }),
  spot({
    id: 'lushan-from-rail',
    name: '庐山（庐山站远眺）',
    lng: 115.874339,
    lat: 29.599636,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 25,
    intro: '武九/昌九庐山站段车窗可见庐山连绵山体与汉阳峰方向山影。',
  }),
  spot({
    id: 'balihu-jiujiang',
    name: '八里湖（九江）',
    lng: 115.960209,
    lat: 29.671676,
    visibility: 'window',
    category: 'lake',
    maxDistKm: 8,
    intro: '昌九城际出九江站沿八里湖畔走行，湖面与庐山山影同框。',
  }),
  spot({
    id: 'qixia-mountain',
    name: '栖霞山',
    lng: 118.948992,
    lat: 32.148978,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 8,
    intro: '京沪线南京栖霞段，「秋栖霞」山体与山麓古寺方向车窗可见。',
  }),
  spot({
    id: 'cihu-huangshi',
    name: '磁湖（黄石）',
    lng: 115.028527,
    lat: 30.209483,
    visibility: 'window',
    category: 'lake',
    maxDistKm: 8,
    intro: '武九客专黄石北站临磁湖东岸，进站段湖面与滨湖城市天际线展开。',
  }),
  spot({
    id: 'jinjiling-danxia',
    name: '金鸡岭丹霞崖壁',
    lng: 113.048125,
    lat: 25.290916,
    visibility: 'window',
    category: 'other',
    maxDistKm: 8,
    intro: '京广线坪石段可见金鸡岭丹霞崖壁，如巨型金鸡展翅，粤北标志窗景。',
  }),
  spot({
    id: 'zhenyang-gorge-beijang',
    name: '浈阳峡（北江）',
    lng: 113.355774,
    lat: 24.200205,
    visibility: 'on_track',
    category: 'gorge',
    intro: '京广线北江三峡浈阳峡段，两岸峭壁夹江，铁路沿江西岸穿行。',
  }),
  spot({
    id: 'sixianjiao-confluence',
    name: '思贤滘两江交汇',
    lng: 112.807372,
    lat: 23.146537,
    visibility: 'window',
    category: 'other',
    maxDistKm: 8,
    intro: '西江与北江交汇处「三江汇流」奇观，南广高铁临近段可俯瞰两江双色水域。',
  }),
  spot({
    id: 'xinghu-zhaoqing',
    name: '肇庆星湖·波海湖',
    lng: 112.450509,
    lat: 23.083685,
    visibility: 'window',
    category: 'lake',
    maxDistKm: 8,
    intro: '广茂/南广肇庆段沿星湖一侧，车窗可见波海湖与七星岩喀斯特孤峰。',
  }),
  spot({
    id: 'dinghu-mountain',
    name: '鼎湖山',
    lng: 112.581874,
    lat: 23.176552,
    visibility: 'distant',
    category: 'mountain',
    maxDistKm: 15,
    intro: '国家级自然保护区鼎湖山，肇庆段南望可见绿意浓郁的山体轮廓。',
  }),
  spot({
    id: 'pearl-river-double-bridge',
    name: '珠江大桥（双桥烟雨）',
    lng: 113.224717,
    lat: 23.131796,
    visibility: 'window',
    category: 'engineering',
    maxDistKm: 8,
    intro: '广州珠江大桥「双桥烟雨」羊城老八景，列车过桥可俯瞰珠江与白鹅潭江面。',
  }),
  spot({
    id: 'wujiangdu-five-bridges',
    name: '乌江渡五桥同框',
    lng: 106.761312,
    lat: 27.319975,
    visibility: 'window',
    category: 'engineering',
    maxDistKm: 8,
    intro: '渝贵线播州乌江镇一带跨乌江，大坝与多座公路桥同框，峡谷江面同景。',
  }),
  spot({
    id: 'doushaguan-five-ways',
    name: '豆沙关五道并行',
    lng: 104.130765,
    lat: 28.022727,
    visibility: 'window',
    category: 'gorge',
    maxDistKm: 8,
    intro: '内昆线关河峡谷豆沙关，秦五尺道、水道、公路、高速与铁路「五道并行」奇观。',
  }),
  spot({
    id: 'dujiangyan-yulei',
    name: '都江堰·玉垒山',
    lng: 103.609305,
    lat: 31.003438,
    visibility: 'window',
    category: 'other',
    maxDistKm: 8,
    intro: '离堆公园站紧邻都江堰景区，车窗可见玉垒山与灌县古城屋脊方向。',
  }),
  spot({
    id: 'qingchengshan-front',
    name: '青城山（前山）',
    lng: 103.562525,
    lat: 30.907369,
    visibility: 'window',
    category: 'mountain',
    maxDistKm: 12,
    intro: '青城山站距前山山门约 2 km，站区车窗可见青城山青翠山体轮廓。',
  }),
  spot({
    id: 'yexianggu-rainforest',
    name: '野象谷热带雨林',
    lng: 100.816355,
    lat: 21.988327,
    visibility: 'window',
    category: 'other',
    maxDistKm: 12,
    intro: '中老铁路野象谷站毗邻亚洲象保护区，以桥代路穿行热带雨林树冠绿意。',
  }),
);

// 去重校验
const ids = new Set();
for (const s of spots) {
  if (ids.has(s.id)) throw new Error('duplicate id: ' + s.id);
  ids.add(s.id);
}

/** 青藏广域点：仅允许大面积/廊道类向 z8991-railway 靠拢。
 * 具名山峰/圣湖/地热等按「钉本体」规则，禁止吸到轨上。 */
const QINGZANG_AREA_SNAP_IDS = new Set([
  'qinghai-lake',
  'qaidam-gobi',
  'kekexili',
  'wudaoliang',
  'tuotuohe-source',
  'tongtian-river',
  'sanjiangyuan',
  'qiangtang-grassland',
  'cuona-lake',
]);

/** 青藏具名点：禁止 snap；靠 maxDistKm 匹配 */
const QINGZANG_NAMED_NO_SNAP = new Set([
  'yuzhu-peak',
  'geladandong',
  'nyainqentanglha',
  'namtso-distant',
  'yangbajing-geothermal',
  'kunlun-pass',
  'fenghuoshan',
  'tanggula-pass',
  'chaerhan-salt-bridge',
  'qingshuihe-bridge-qingzang',
]);

function haversineKm(a, b) {
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

function snapQingzangAreasToRailway(list) {
  const railPath = join(__dirname, '../data/presets/z8991-railway.json');
  if (!existsSync(railPath)) {
    console.warn('skip qingzang area snap: missing z8991-railway.json');
    return;
  }
  const coords = JSON.parse(readFileSync(railPath, 'utf8'));
  const path = coords.map(([lng, lat]) => ({ lng, lat }));
  const defaults = { on_track: 3, window: 8, distant: 35 };
  let snapped = 0;
  for (const s of list) {
    if (!QINGZANG_AREA_SNAP_IDS.has(s.id) || QINGZANG_NAMED_NO_SNAP.has(s.id)) continue;
    let best = { distKm: Infinity, point: path[0] };
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1];
      const b = path[i];
      const dx = b.lng - a.lng;
      const dy = b.lat - a.lat;
      const t = Math.max(
        0,
        Math.min(1, ((s.lng - a.lng) * dx + (s.lat - a.lat) * dy) / (dx * dx + dy * dy || 1)),
      );
      const point = { lng: a.lng + dx * t, lat: a.lat + dy * t };
      const distKm = haversineKm({ lng: s.lng, lat: s.lat }, point);
      if (distKm < best.distKm) best = { distKm, point };
    }
    const max = s.maxDistKm ?? defaults[s.visibility] ?? 8;
    // 大面积：向轨靠拢，但保留在地貌侧（不完全吸到轨面）
    if (best.distKm <= max * 0.85) continue;
    const pull = 0.55;
    s.lng = Number((s.lng + (best.point.lng - s.lng) * pull).toFixed(6));
    s.lat = Number((s.lat + (best.point.lat - s.lat) * pull).toFixed(6));
    if (s.visibility === 'window' && (!s.maxDistKm || s.maxDistKm < 12)) s.maxDistKm = 12;
    snapped += 1;
  }
  if (snapped) console.log(`qingzang area pull: ${snapped} spots toward z8991-railway`);
}

function applyCalibrationPatches(list) {
  const patchPath = join(__dirname, '../data/presets/scenic-spot-calibration-patches.json');
  if (!existsSync(patchPath)) {
    console.warn('skip calibration patches: file missing');
    return;
  }
  const doc = JSON.parse(readFileSync(patchPath, 'utf8'));
  const byId = new Map((doc.patches || []).map((p) => [p.id, p]));
  let n = 0;
  for (const s of list) {
    const p = byId.get(s.id);
    if (!p) continue;
    if (p.lng != null) s.lng = Number(Number(p.lng).toFixed(6));
    if (p.lat != null) s.lat = Number(Number(p.lat).toFixed(6));
    if (p.visibility) s.visibility = p.visibility;
    if (p.maxDistKm != null) s.maxDistKm = p.maxDistKm;
    n += 1;
  }
  if (n) console.log(`calibration patches applied: ${n}`);
}

snapQingzangAreasToRailway(spots);
applyCalibrationPatches(spots);

// —— v3：来源门禁 + 走廊里程/侧别自动回填（docs/scenic-schema-v3.md §2.4/§4/§6）——
const VISIBILITY_DEFAULT_KM = { on_track: 3, window: 8, distant: 35 };
const V3_DIMENSIONS = new Set(['geo', 'nature', 'culture', 'history', 'construct', 'architecture']);

function havKm(a, b) {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] * Math.PI) / 180) *
      Math.cos((b[1] * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const corridorCache = new Map();
function loadCorridorGeometry(corridorId) {
  if (corridorCache.has(corridorId)) return corridorCache.get(corridorId);
  const p = join(__dirname, `../data/presets/corridors/${corridorId}.json`);
  if (!existsSync(p)) throw new Error(`v3 enrich: corridor not found: ${corridorId}`);
  const c = JSON.parse(readFileSync(p, 'utf8'));
  if (!Array.isArray(c.railway) || c.railway.length < 2) {
    throw new Error(`v3 enrich: corridor ${corridorId} bad railway`);
  }
  const seg = [];
  let total = 0;
  for (let i = 0; i < c.railway.length - 1; i++) {
    const d = havKm(c.railway[i], c.railway[i + 1]);
    seg.push({ start: total, d });
    total += d;
  }
  const g = { railway: c.railway, seg, total };
  corridorCache.set(corridorId, g);
  return g;
}

function projectToCorridor(g, lng, lat) {
  let best = { distKm: Infinity, alongKm: 0, i: -1, point: null };
  const { railway, seg } = g;
  for (let i = 0; i < railway.length - 1; i++) {
    const [x1, y1] = railway[i];
    const [x2, y2] = railway[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((lng - x1) * dx + (lat - y1) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const point = [x1 + t * dx, y1 + t * dy];
    const distKm = havKm([lng, lat], point);
    if (distKm < best.distKm) {
      best = { distKm, alongKm: seg[i].start + seg[i].d * t, i, point };
    }
  }
  return best;
}

function validateV3Spot(s) {
  if (!s.dimensions || s.dimensions.length < 1 || s.dimensions.length > 2) {
    throw new Error(`${s.id}: dimensions 必填 1~2 个`);
  }
  for (const d of s.dimensions) {
    if (!V3_DIMENSIONS.has(d)) throw new Error(`${s.id}: 未知 dimension ${d}`);
  }
  if (!s.subtype) throw new Error(`${s.id}: subtype 必填`);
  if (!s.bestView || !s.bestView.timeOfDay) throw new Error(`${s.id}: bestView.timeOfDay 必填`);
  const introLen = [...(s.intro || '')].length;
  if (introLen < 40 || introLen > 90) throw new Error(`${s.id}: intro 需 40~90 字（当前 ${introLen}）`);
  if (!Array.isArray(s.sources) || s.sources.length < 2) {
    throw new Error(`${s.id}: sources 至少 2 条独立来源`);
  }
  if (!s.sources.some((x) => x.level === 'S' || x.level === 'A')) {
    throw new Error(`${s.id}: sources 至少 1 条 S/A 级`);
  }
  for (const x of s.sources) {
    if (!/^https?:\/\//.test(x.ref) && !/^Q\d+$/.test(x.ref) && !/^(way|node|relation)\/\d+$/.test(x.ref)) {
      throw new Error(`${s.id}: source.ref 必须是 URL / Q号 / OSM id：${x.ref}`);
    }
    if (!x.checkedAt) throw new Error(`${s.id}: source.checkedAt 必填`);
  }
  if (!s.verification || !['verified', 'probable'].includes(s.verification.status)) {
    throw new Error(`${s.id}: 主库仅接受 verified/probable`);
  }
}

function enrichV3Spots(list) {
  let n = 0;
  for (const s of list) {
    const hints = s.__lineHints;
    if (!hints) continue;
    validateV3Spot(s);
    const maxAllowed = s.maxDistKm ?? VISIBILITY_DEFAULT_KM[s.visibility] ?? 8;
    if (maxAllowed > 50) throw new Error(`${s.id}: maxDistKm 不得超过 50`);
    s.lines = [];
    for (const h of hints) {
      const g = loadCorridorGeometry(h.corridorId);
      const p = projectToCorridor(g, s.lng, s.lat);
      if (p.distKm > maxAllowed) {
        throw new Error(
          `${s.id}: 距 ${h.corridorId} 折线 ${p.distKm.toFixed(1)}km > 阈值 ${maxAllowed}km（禁止挪坐标凑命中）`,
        );
      }
      const line = {
        corridorId: h.corridorId,
        alongKmFrom: Number(p.alongKm.toFixed(1)),
        distKm: Number(p.distKm.toFixed(1)),
      };
      if (h.alongKmTo != null) {
        if (!(h.alongKmTo >= p.alongKm - 0.5 && h.alongKmTo <= g.total + 0.5)) {
          throw new Error(`${s.id}: alongKmTo ${h.alongKmTo} 越界（总长 ${g.total.toFixed(1)}）`);
        }
        line.alongKmTo = Number(h.alongKmTo.toFixed(1));
      }
      if (h.nearStations?.length) line.nearStations = h.nearStations;
      s.lines.push(line);

      // 静态 side：以走廊折线正方向为前进方向（schema §4）；仅在作者未显式指定时回填
      if (!s.side) {
        if (s.visibility === 'on_track' || p.distKm < 0.15) {
          s.side = 'both';
        } else {
          const i = p.i;
          const [x1, y1] = g.railway[Math.max(0, i - 1)];
          const [x2, y2] = g.railway[Math.min(g.railway.length - 1, i + 2)];
          const cross = (x2 - x1) * (s.lat - p.point[1]) - (y2 - y1) * (s.lng - p.point[0]);
          s.side = cross > 0 ? 'left' : 'right';
        }
      }
    }
    s.sideRefDirection = 'line_forward';
    s.status = s.status || 'active';
    delete s.__lineHints;
    n += 1;
  }
  // 未走 v3 流程的老数据不应残留临时字段
  for (const s of list) delete s.__lineHints;
  if (n) console.log(`v3 spots enriched: ${n}（lines/side 自动回填 + 距轨门禁通过）`);
}

spots.push(
  spot({"id":"binzhou-songhua-old-bridge","name":"滨洲线松花江铁路大桥","lng":126.626,"lat":45.781,"intro":"哈尔滨横跨松花江的百年钢铁老江桥，1900年随中东铁路建成，钢桁梁铆接桥体已成滨洲线象征，近年改为滨水步道公园，列车过江时贴窗可见其气势。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":4,"dimensions":["history","construct"],"subtype":"railway_heritage","tags":["黑龙江","铁路桥","松花江","中东铁路"],"bestView":{"months":[6,7,8,12],"timeOfDay":"day","light":"any","note":"夏日江水开阔、深冬冰封与钢桥相衬","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"滨洲铁路松花江大桥属中东铁路建筑群，全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"https://hlj.cnr.cn/hljyw/20210617/t20210617_525514276.shtml","quote":"央广网：1900年建成的松花江大桥，是中东铁路的重要组成部分","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"坐标为哈尔滨市区松花江桥位，on_track 过江即可见。"},"lineHints":[{"corridorId":"binzhou","nearStations":["哈尔滨","哈尔滨北"]}]}),
  spot({"id":"binzhou-manzhouli-gate","name":"满洲里国门","lng":117.34031,"lat":49.63003,"intro":"中俄边境满洲里的第五代国门与41号界碑，滨洲线终点站正对国门景区，俄式穹顶建筑与边境岗楼在车窗即见，是这条百年铁路西端最有辨识度的镜头。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":8,"dimensions":["architecture","history"],"subtype":"modern_landmark","tags":["内蒙古","国门","边境","中俄口岸"],"bestView":{"months":[6,7,8,1,2],"timeOfDay":"day","light":"any","note":"夏季草原青翠、冬季雪覆俄式屋顶","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"满洲里国门为中俄边境旅游区核心，国家5A级旅游景区","checkedAt":"2026-10-01"},{"type":"osm","level":"A","ref":"https://www.poi86.com/","quote":"poi86大地坐标：117.340310,49.630030（WGS84）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"坐标来自 poi86 大地坐标（WGS84），处满洲里站西侧口岸区。"},"lineHints":[{"corridorId":"binzhou","nearStations":["满洲里"]}]}),
  spot({"id":"binzhou-hailar-river","name":"海拉尔河湿地草原","lng":118.273396,"lat":49.39506,"intro":"滨洲线自海拉尔向西沿海拉尔河流淌，两岸河曲湿地与呼伦贝尔草甸相缠，夏季碧草顺河谷延展，牛马散牧河滩，是草原湿地的经典车窗景象。","visibility":"distant","source":"ai_reviewed","category":"gorge","viewScale":"mid","viewMinutes":20,"dimensions":["geo","nature"],"subtype":"river","tags":["内蒙古","海拉尔河","湿地","草原"],"bestView":{"months":[6,7,8],"timeOfDay":"day","light":"any","note":"盛夏河谷草绿、水曲蜿蜒","blocked":[]},"sources":[{"type":"osm","level":"A","ref":"https://www.poi86.com/","quote":"poi86大地坐标：118.273396,49.395060（海拉尔河，WGS84）","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.hailar.gov.cn/About/","quote":"海拉尔区政府：海拉尔因海拉尔河得名，地处大兴安岭西麓与呼伦贝尔草原","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"坐标来自 poi86 大地坐标（WGS84），河流沿岸 window 可见。"},"lineHints":[{"corridorId":"binzhou","nearStations":["海拉尔","陈旗"]}]}),
  spot({"id":"changhui-liudingshan","name":"六鼎山金鼎大佛","lng":128.24936,"lat":43.324109,"intro":"吉林敦化六鼎山文化旅游区的世界最高金鼎大佛坐佛像，长珲城际过敦化可远眺岗顶金色大佛与山门楼阁，冬雪覆山时金佛格外醒目。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":10,"dimensions":["culture","architecture"],"subtype":"temple_religion","tags":["吉林","金鼎大佛","敦化","佛教"],"bestView":{"months":[1,2,11,12],"timeOfDay":"day","light":"any","note":"雪后金色大佛与山景对比鲜明","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"http://www.jl.gov.cn/","quote":"六鼎山文化旅游区为国家5A级旅游景区，坐拥世界最高金鼎大佛","checkedAt":"2026-10-01"},{"type":"osm","level":"A","ref":"https://www.bigemap.net/","quote":"bigemap：六鼎山坐标约128.24936,43.324109","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"坐标来自 bigemap，敦化站东南侧景区，作 window 远眺。"},"lineHints":[{"corridorId":"changhui","nearStations":["敦化"]}]}),
  spot({"id":"changhui-longtanshan","name":"龙潭山（吉林）","lng":126.6,"lat":43.867,"intro":"吉林市区东部的龙潭山，西临松花江、山巅可俯瞰全城，留存高句丽山城遗址，长珲城际出吉林东行时，郁郁山影耸立江滨。","visibility":"on_track","source":"ai_reviewed","category":"mountain","viewScale":"near","viewMinutes":12,"dimensions":["geo","history"],"subtype":"mountain_range","tags":["吉林","龙潭山","高句丽","山城遗址"],"bestView":{"months":[5,6,7,8,9],"timeOfDay":"day","light":"any","note":"夏秋林木葱郁，山城轮廓清晰","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"http://www.jl.gov.cn/","quote":"龙潭山为吉林市地标，留存高句丽山城遗址，属老爷岭山脉","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"https://culture.cnjiwang.com/","quote":"中国吉林网：龙潭山高384.1米，为吉林最大高句丽山城，并沿用至金代","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"坐标取 43°52′N 126°36′E，吉林站东侧山体，window 可见。"},"lineHints":[{"corridorId":"changhui","nearStations":["吉林","双吉"]}]}),
  spot({"id":"changhui-jilin-songhua","name":"吉林松花江雾凇江畔","lng":126.55,"lat":43.84,"intro":"长珲城际出吉林站即沿松花江十里长堤东行，隆冬江面不冻、水汽挂满两岸柳枝成雾凇，是名扬四方的江城冬景。","visibility":"on_track","source":"ai_reviewed","category":"gorge","viewScale":"near","viewMinutes":10,"dimensions":["nature","geo"],"subtype":"water_feature","tags":["吉林","松花江","雾凇","冬季"],"bestView":{"months":[12,1,2],"timeOfDay":"dawn","light":"front","note":"清晨低温水汽凝结，雾凇最盛","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"http://www.jl.gov.cn/","quote":"吉林市松花江冬季不冻、雾凇为中国四大气象奇观之一","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"https://culture.cnjiwang.com/","quote":"中国吉林网：松花江由西南来，经龙潭山前陡然弯转西北流去","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"坐标取吉林市区松花江十里长堤段，冬季雾凇为主要看点。"},"lineHints":[{"corridorId":"changhui","nearStations":["吉林"]}]}),
  spot({"id":"haida-liaoyang-baita","name":"辽阳白塔","lng":123.173,"lat":41.278,"intro":"辽宁辽阳站旁的白塔，辽代密檐式砖塔、东北现存最高古塔（70.4米），全国重点文保，沈大高铁过辽阳时，塔影即在高架线旁，转瞬入窗。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":4,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["辽宁","辽阳白塔","辽塔","全国重点文保"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"晨昏斜照塔身轮廓最为分明","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"http://www.liaoyang.gov.cn/zjly/001001/001001001/20180331/152247789002489.html","quote":"辽阳市政府：辽阳白塔高70.4米，1988年经国务院批准为国家级文物保护单位","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://de.aroundus.com/p/6508139-white-pagoda","quote":"aroundus：White Pagoda GPS 41.27667,123.16889（WGS84）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"坐标为辽阳白塔公园（紧邻辽阳站），on_track 可见。"},"lineHints":[{"corridorId":"haida","nearStations":["辽阳"]}]}),
  spot({"id":"haida-qianshan","name":"千山（鞍山）","lng":123.1232,"lat":41.0073,"intro":"辽宁鞍山东南的千山，长白山余脉、全国首批5A与国家级风景名胜区，沈大高铁过鞍山时，远处群峰连绵、奇松怪石隐约可辨。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":15,"dimensions":["geo"],"subtype":"mountain_range","tags":["辽宁","千山","5A","长白山余脉"],"bestView":{"months":[4,5,9,10],"timeOfDay":"day","light":"any","note":"晴日可见群峰轮廓与寺庙红墙","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"http://www.ln.gov.cn/","quote":"千山为国家5A级旅游景区、国家重点风景名胜区","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q6151757","quote":"Wikidata Q6151757：千山坐标约123.12,41.01（WGS84）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"坐标来自 mapcarta/Wikidata WGS84，鞍山站东南约17公里，作 distant 远眺。"},"lineHints":[{"corridorId":"haida","nearStations":["鞍山西","腾鳌"]}]}),
  spot({"id":"hajia-yilan-wuguocheng","name":"五国城遗址（依兰）","lng":129.564158,"lat":46.319216,"intro":"黑龙江依兰县城内的五国城遗址，辽金时期五国部故城，哈佳铁路过依兰可眺古城墙垣与松花江相傍，满含边疆古国沧桑。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":8,"dimensions":["history"],"subtype":"ruins_site","tags":["黑龙江","五国城","辽金","依兰"],"bestView":{"months":[5,6,7,8,9],"timeOfDay":"day","light":"any","note":"古城垣与江岸相映","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"http://www.hlj.gov.cn/","quote":"五国城遗址位于依兰县，为辽金时期重要城址","checkedAt":"2026-10-01"},{"type":"osm","level":"A","ref":"https://www.bmcx.com/","quote":"依兰镇坐标约129.564158,46.319216（WGS84）","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"坐标取依兰县城，五国城遗址在县城内，window 可见。"},"lineHints":[{"corridorId":"hajia","nearStations":["依兰"]}]}),
  spot({"id":"hajia-songhua-jiamusi","name":"松花江佳木斯跨江大桥","lng":130.35,"lat":46.8,"intro":"哈佳铁路以7公里余特大桥跨越浩荡松花江进入三江平原，长桥凌波、江天一色，过桥瞬间两岸湿地与长河尽收眼底。","visibility":"on_track","source":"ai_reviewed","category":"engineering","viewScale":"near","viewMinutes":5,"dimensions":["construct","geo"],"subtype":"bridge","tags":["黑龙江","松花江","特大桥","佳木斯"],"bestView":{"months":[6,7,8,9],"timeOfDay":"day","light":"front","note":"长桥过江视野极佳","blocked":[]},"sources":[{"type":"wiki","level":"A","ref":"https://m.baike.com/wiki/哈佳快速铁路","quote":"哈佳快速铁路佳木斯特大桥全长7.111公里，横跨松花江","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.hlj.gov.cn/","quote":"松花江干流经佳木斯汇入黑龙江","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"坐标为佳木斯市区松花江跨江桥位，on_track 过江可见。"},"lineHints":[{"corridorId":"hajia","nearStations":["佳木斯"]}]}),
  spot({"id":"hamu-maoer-shan","name":"帽儿山","lng":127.55,"lat":45.285,"intro":"黑龙江尚志市西北的帽儿山，因峰顶如草帽得名、国家森林公园，哈牡高铁经帽儿山站时，这座突兀独峰在窗外拔地而起，四季可赏。","visibility":"window","source":"ai_reviewed","category":"mountain","viewScale":"near","viewMinutes":8,"dimensions":["geo","nature"],"subtype":"mountain_range","tags":["黑龙江","帽儿山","国家森林公园","尚志"],"bestView":{"months":[5,6,7,8,9,10],"timeOfDay":"day","light":"any","note":"夏绿秋红，山峰近在车窗","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"http://www.shangzhi.gov.cn/","quote":"尚志市政府：帽儿山位于尚志市西北，山形如帽冠，帽儿山站北侧","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.hlj.gov.cn/","quote":"帽儿山为国家森林公园","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"坐标参考 earthol/bigemap 及帽儿山镇（约127.55,45.29），window 可见。"},"lineHints":[{"corridorId":"hamu","nearStations":["帽儿山","尚志"]}]}),
  spot({"id":"hamu-hengdao-jiku","name":"横道河子中东铁路机车库","lng":129.074,"lat":44.814,"intro":"黑龙江海林横道河子镇的百年中东铁路扇形机车库，砖石俄式建筑群、全国重点文保，哈牡高铁经此可望铁路小镇与老库房并立，工业遗存气息浓厚。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":6,"dimensions":["history","architecture"],"subtype":"railway_heritage","tags":["黑龙江","机车库","中东铁路","横道河子"],"bestView":{"months":[1,2,6,7,8],"timeOfDay":"day","light":"any","note":"冬雪覆俄式屋舍、夏绿映红砖最有味道","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"横道河子机车库属中东铁路建筑群，全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"osm","level":"A","ref":"https://www.bigemap.net/","quote":"bigemap：横道河子镇坐标约129.074,44.814","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"坐标来自 bigemap，横道河子站旁，window 可见。"},"lineHints":[{"corridorId":"hamu","nearStations":["横道河子东","横道河子"]}]}),
  spot({"id":"haqi-longfeng-wetland","name":"大庆龙凤湿地","lng":125.12,"lat":46.5,"intro":"大庆主城区南侧的一片芦苇沼泽湿地，哈齐高铁自湿地中部高架横穿，初春泛绿、盛夏芦花、深秋飞鸟群集，靠窗两侧皆可望见辽阔水天。","visibility":"on_track","source":"ai_reviewed","category":"lake","viewScale":"near","viewMinutes":6,"dimensions":["geo","nature"],"subtype":"wetland","tags":["黑龙江","湿地","芦苇荡","松嫩平原"],"bestView":{"months":[6,7,8,9],"timeOfDay":"day","light":"any","note":"盛夏芦苇青翠与候鸟群飞最宜","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"http://www.daqing.gov.cn/","quote":"黑龙江大庆龙凤湿地为省级自然保护区，位于大庆市主城区南侧，芦苇沼泽湿地","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://paper.ce.cn/jjrb/html/2015-08/31/content_255138.htm","quote":"《经济日报》：哈齐高铁穿过草原、湿地、湖泊交织的松嫩平原","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"坐标取龙凤湿地保护区范围中心点，紧贴哈齐高铁正线，属 on_track 可见。"},"lineHints":[{"corridorId":"haqi","nearStations":["大庆东","大庆西","大庆"]}]}),
  spot({"id":"haqi-songhua-bridge","name":"哈齐高铁松花江特大桥","lng":126.626,"lat":45.781,"intro":"哈尔滨市区段横跨松花江的四线高寒高铁大桥，与1900年建成的百年滨洲老江桥（全国重点文保）并肩并立，新旧两桥同框入窗是哈齐线地标画面。","visibility":"on_track","source":"ai_reviewed","category":"engineering","viewScale":"near","viewMinutes":4,"dimensions":["construct","history"],"subtype":"bridge","tags":["黑龙江","铁路桥","松花江","中东铁路"],"bestView":{"months":[1,2,6,7,8],"timeOfDay":"day","light":"front","note":"冬封冰河、夏江景开阔，远眺老江桥钢桁梁","blocked":[]},"sources":[{"type":"news","level":"B","ref":"http://www.chinanews.com.cn/df/2014/12-10/6865027.shtml","quote":"中新网：哈齐客专松花江特大桥为四线，全长3460余米","checkedAt":"2026-10-01"},{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"毗邻的滨洲铁路松花江大桥属中东铁路建筑群，全国重点文物保护单位","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"坐标为哈尔滨市区松花江桥位近值，列车由新桥通过、老桥紧邻可见。"},"lineHints":[{"corridorId":"haqi","nearStations":["哈尔滨","哈尔滨北"]}]}),
  spot({"id":"haqi-songnen-plain","name":"松嫩平原盐碱草原","lng":125,"lat":46.4,"intro":"哈齐高铁自大庆向北进入松嫩平原西部，大片盐碱草甸与苇塘随地势铺展，秋季草色由绿转黄、天地一线，是典型的寒温带平原牧野风光。","visibility":"distant","source":"ai_reviewed","category":"grassland","viewScale":"far","viewMinutes":35,"dimensions":["geo"],"subtype":"plain_basin","tags":["黑龙江","平原","草原","寒温带"],"bestView":{"months":[8,9,10],"timeOfDay":"day","light":"any","note":"秋日草原泛黄与远空云霞层次最丰","blocked":[]},"sources":[{"type":"news","level":"B","ref":"http://paper.ce.cn/jjrb/html/2015-08/31/content_255138.htm","quote":"《经济日报》：哈齐高铁沿线分布着湿地、湖泊，穿越松嫩平原","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.hlj.gov.cn/","quote":"松嫩平原为黑龙江省西部主要农业与草原区域","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"大面积地貌取平原内部近线点位，作 far 远眺项。"},"lineHints":[{"corridorId":"haqi","nearStations":["安达","大庆东","杜尔伯特"]}]}),
  spot({"id":"jingha-niuheliang","name":"牛河梁红山文化遗址","lng":119.52,"lat":41.332,"intro":"辽宁朝阳建平、凌源交界处的牛河梁遗址，红山文化祭祀遗址群、全国重点文保，京哈高铁设牛河梁站，车窗远眺山梁上分布的坛庙冢遗迹。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"far","viewMinutes":10,"dimensions":["history"],"subtype":"ruins_site","tags":["辽宁","牛河梁","红山文化","全国重点文保"],"bestView":{"months":[4,5,6,9,10],"timeOfDay":"day","light":"any","note":"山梁起伏、遗址群沿梁分布","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://files.chaoyang.gov.cn/","quote":"朝阳市牛河梁遗址保护规划：遗址中心点北纬41°20′、东经119°30′，全国重点文保（3-5-195-15）","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://de.aroundus.com/p/6455856-niuheliang","quote":"aroundus：Niuheliang GPS 41.33401,119.52840（WGS84）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"坐标来自官方保护规划及 aroundus WGS84，京哈高铁设牛河梁站，distant 远眺。"},"lineHints":[{"corridorId":"jingha","nearStations":["牛河梁"]}]}),
  spot({"id":"jingha-hunhe-shenyang","name":"浑河（沈阳）","lng":123.45,"lat":41.71,"intro":"京哈高铁南出沈阳跨越浑河，这条辽宁第二大河在城南蜿蜒东去，两岸滩地开阔、湿地公园成线，过桥瞬间江面豁然开朗。","visibility":"distant","source":"ai_reviewed","category":"gorge","viewScale":"near","viewMinutes":5,"dimensions":["geo"],"subtype":"river","tags":["辽宁","浑河","沈阳"],"bestView":{"months":[5,6,7,8,9],"timeOfDay":"day","light":"front","note":"跨河桥段视野开阔","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"http://www.shenyang.gov.cn/","quote":"沈阳市政府：浑河为辽宁第二大河，发源于清原县，境内河长172.6公里","checkedAt":"2026-10-01"},{"type":"osm","level":"A","ref":"https://www.poi86.com/","quote":"poi86浑河大地坐标参考（WGS84）","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"坐标取沈阳浑南段浑河河道，京哈/沈大线跨河处可见。"},"lineHints":[{"corridorId":"jingha","nearStations":["沈阳南","沈阳"]}]}),
  spot({"id":"pingqi-nenjiang-jiangqiao","name":"嫩江（江桥镇）","lng":123.677,"lat":46.77,"intro":"平齐线纵贯嫩江右岸的江桥蒙古族镇，铁路贴近宽阔嫩江而行，江流舒缓、两岸滩涂草甸平展，尽显松嫩平原西部河流风光。","visibility":"on_track","source":"ai_reviewed","category":"gorge","viewScale":"near","viewMinutes":15,"dimensions":["geo"],"subtype":"river","tags":["黑龙江","嫩江","江桥镇","松嫩平原"],"bestView":{"months":[6,7,8,9],"timeOfDay":"day","light":"any","note":"夏秋水满、滩涂草甸青绿","blocked":[]},"sources":[{"type":"osm","level":"A","ref":"https://dbpedia.org/","quote":"DBpedia：江桥蒙古族镇坐标约123.67694,46.77（WGS84）","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.hlj.gov.cn/","quote":"嫩江发源于大兴安岭，为松花江北源","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"坐标来自 DBpedia WGS84，平齐线纵贯镇区，on_track 可见。"},"lineHints":[{"corridorId":"pingqi","nearStations":["江桥","昂昂溪"]}]}),
  spot({"id":"shendan-yalu-broken-bridge","name":"鸭绿江断桥","lng":124.3893,"lat":40.1162,"intro":"辽宁丹东横跨鸭绿江的钢铁断桥，为抗美援朝战争遗留的铁路桥遗迹、全国重点文保，沈丹线终点入丹东时，残缺桥身与对岸朝鲜隔江相望。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":6,"dimensions":["history","construct"],"subtype":"battlefield","tags":["辽宁","断桥","鸭绿江","抗美援朝"],"bestView":{"months":[5,6,7,8,9,10],"timeOfDay":"day","light":"any","note":"江面开阔时残桥剪影与异国江岸同框","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"鸭绿江断桥为全国重点文物保护单位，抗美援朝战争遗迹","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.aroundus.com/","quote":"aroundus：鸭绿江断桥 GPS 约124.389,40.116（WGS84）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"坐标来自 aroundus WGS84，位于丹东站西侧沿江一带。"},"lineHints":[{"corridorId":"shendan","nearStations":["丹东"]}]}),
  spot({"id":"shendan-fenghuangshan","name":"凤凰山（凤城）","lng":124.07419,"lat":40.42783,"intro":"辽宁丹东凤城的凤凰山，辽东名山、省级自然保护区与风景名胜区，沈丹线过凤城时，峭拔主峰与山间庙宇在车厢东侧忽隐忽现，秋色最艳。","visibility":"window","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":15,"dimensions":["geo","nature"],"subtype":"mountain_range","tags":["辽宁","凤凰山","辽东名山","秋色"],"bestView":{"months":[9,10],"timeOfDay":"day","light":"any","note":"深秋红叶层林尽染","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"http://www.ln.gov.cn/","quote":"凤凰山为辽宁省级自然保护区、省级风景名胜区","checkedAt":"2026-10-01"},{"type":"osm","level":"A","ref":"http://www.asiaphotos.org/","quote":"asiaphotos：凤凰山 GPS 40.42783,124.07419（WGS84）","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"坐标来自 asiaphotos WGS84，凤城站南侧山体。"},"lineHints":[{"corridorId":"shendan","nearStations":["凤城东","凤城"]}]}),
  spot({"id":"shenji-songhua-hu","name":"松花湖·丰满水电站","lng":126.6886,"lat":43.7194,"intro":"吉林市南郊的松花湖，丰满大坝拦江而成、国家重点风景名胜区，沈吉线终点近吉林时，湖光山色与坝体雄姿在车窗徐徐展开。","visibility":"distant","source":"ai_reviewed","category":"lake","viewScale":"mid","viewMinutes":15,"dimensions":["geo","construct"],"subtype":"lake","tags":["吉林","松花湖","丰满大坝","国家重点风景名胜区"],"bestView":{"months":[5,6,7,8,9],"timeOfDay":"day","light":"any","note":"夏秋水满、山色湖光相映","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"http://www.jl.gov.cn/","quote":"松花湖为国家重点风景名胜区（1988年），丰满水电站为著名水利工程","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/","quote":"丰满大坝坐标约126.6886,43.7194（WGS84）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"坐标来自 Wikipedia 丰满大坝（43°43′N 126°41′E），吉林站南侧，window 可见。"},"lineHints":[{"corridorId":"shenji","nearStations":["吉林","丰满"]}]}),
  spot({"id":"shenji-huifahe","name":"辉发河（梅河口）","lng":125.68,"lat":42.51,"intro":"沈吉线过梅河口沿辉发河溯流而上，这条松花江上游最大支流两岸丘陵与田畴交错，蓝青色河水蜿蜒北去，初夏水丰最宜。","visibility":"on_track","source":"ai_reviewed","category":"gorge","viewScale":"near","viewMinutes":15,"dimensions":["geo"],"subtype":"river","tags":["吉林","辉发河","松花江支流","梅河口"],"bestView":{"months":[5,6,7,8],"timeOfDay":"day","light":"any","note":"河水蓝青、水丰时最美","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"http://www.mhk.gov.cn/","quote":"梅河口市政府：辉发河河道管理范围及堤防，穿越梅河口境内","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://m.baike.com/wiki/辉发河","quote":"辉发河为松花江上游最大支流，干流全长294公里","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"坐标取梅河口市区辉发河段（约125.68,42.51），沈吉线沿河而行。"},"lineHints":[{"corridorId":"shenji","nearStations":["梅河口","海龙"]}]}),
  spot({"id":"tonglu-yaolin-cave","name":"桐庐瑶琳仙境","lng":119.4,"lat":29.85,"intro":"瑶琳仙境是华东地区规模宏大的喀斯特溶洞，钟乳石琳琅满目。杭黄高铁列车经桐庐段时，窗外富春江山清水秀，溶洞群藏于丘陵腹地。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"far","viewMinutes":4,"dimensions":["geo"],"subtype":"karst_danxia","tags":["浙江","4A景区","溶洞","喀斯特"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"溶洞在丘陵腹地，车窗外以地形辨识","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"https://www.tonglu.gov.cn/","quote":"瑶琳仙境为4A级旅游景区","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11084936","quote":"瑶琳仙境（Yaolin Cave）桐庐","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"政府官网+wiki（无S级名录）"},"lineHints":[{"corridorId":"hanghuang","nearStations":["桐庐","建德"]}]}),
  spot({"id":"fuyang-longmen-town","name":"富阳龙门古镇","lng":119.95,"lat":30.06,"intro":"龙门古镇为孙权故里，卵石巷道与明清宗祠保存完整，是江南山地型古镇。杭黄高铁列车经富阳段时，可见富春江两岸山环水绕的田园古镇。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["culture","history"],"subtype":"old_town","tags":["浙江","孙权故里","江南古镇","4A景区"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"富春江山水田园为背景画框","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"https://www.fuyang.gov.cn/","quote":"龙门古镇为孙权故里，4A级景区","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11084959","quote":"龙门古镇（Longmen Ancient Town）富阳","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"政府官网+wiki（无S级名录）"},"lineHints":[{"corridorId":"hanghuang","nearStations":["富阳","桐庐"]}]}),
  spot({"id":"jiande-meicheng","name":"建德梅城古镇","lng":119.49,"lat":29.55,"intro":"梅城为古严州府治，地处新安江、富春江、兰江三江汇流处，古城墙与梅花城楼临江而立。杭黄高铁列车经建德段时，可见三江口山水交融的古城形胜。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["history","culture"],"subtype":"old_town","tags":["浙江","古严州府","三江口","古城墙"],"bestView":{"months":[4,5,9,10,11],"timeOfDay":"day","light":"any","note":"三江汇流与古城墙是形胜标志","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"https://www.jiande.gov.cn/","quote":"梅城为古严州府治，地处三江口","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"https://www.news.cn/local/20241226/8dfe875aaa554ca6b789a47080485d27/c.html","quote":"杭黄高铁沿线古城山水景观","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"政府官网+媒体佐证"},"lineHints":[{"corridorId":"hanghuang","nearStations":["建德","千岛湖"]}]}),
  spot({"id":"jiande-daciyan","name":"建德大慈岩","lng":119.17,"lat":29.43,"intro":"大慈岩以「江南悬空寺」闻名，寺院半嵌于悬崖绝壁，险峰奇石兀立。杭黄高铁列车经建德段时，南侧远处可见大慈岩的陡峭崖壁与楼阁。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"far","viewMinutes":5,"dimensions":["geo","architecture"],"subtype":"karst_danxia","tags":["浙江","4A景区","悬空寺","丹霞"],"bestView":{"months":[4,5,9,10,11],"timeOfDay":"day","light":"any","note":"悬崖寺庙与险峰轮廓可辨","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"https://www.jiande.gov.cn/","quote":"大慈岩为4A级景区，江南悬空寺","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11084972","quote":"大慈岩（Daciyan）建德","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"政府官网+wiki（无S级名录）"},"lineHints":[{"corridorId":"hanghuang","nearStations":["建德","千岛湖"]}]}),
  spot({"id":"shaoxing-luxun-hometown","name":"绍兴鲁迅故里","lng":120.5851,"lat":29.9935,"intro":"鲁迅故里含百草园、三味书屋等鲁迅生活遗迹，乌篷船驶过门前河道。杭甬高铁列车经绍兴段时，车窗可见水巷台门与马头墙连片的越地古城风貌。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["浙江","5A景区","全国重点文保","鲁迅故居"],"bestView":{"months":[3,4,5,9,10,11],"timeOfDay":"day","light":"any","note":"水巷台门是绍兴古城识别特征","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"鲁迅故里—沈园景区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.earthol.com/","quote":"鲁迅故里 经度120.58508 纬度29.99347","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+坐标源"},"lineHints":[{"corridorId":"hangyong","nearStations":["绍兴东","杭州南"]}]}),
  spot({"id":"shaoxing-dayu-ling","name":"绍兴会稽山·大禹陵","lng":120.608,"lat":29.968,"intro":"会稽山为越地名山，大禹陵寝位于山麓，是被奉祀数千年的治水先圣陵墓。杭甬高铁列车经绍兴段时，南侧可见会稽山青峰连绵。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":6,"dimensions":["history","geo"],"subtype":"mountain_range","tags":["浙江","全国重点文保","大禹陵","会稽山"],"bestView":{"months":[4,5,9,10,11],"timeOfDay":"day","light":"any","note":"会稽山青黛山脊是大禹陵背景","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.zj.gov.cn/","quote":"大禹陵为全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q8462835","quote":"大禹陵（Yu the Great Mausoleum）绍兴会稽山","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保+wiki"},"lineHints":[{"corridorId":"hangyong","nearStations":["绍兴东","杭州南"]}]}),
  spot({"id":"shaoxing-east-lake","name":"绍兴东湖","lng":120.635,"lat":29.995,"intro":"绍兴东湖为古代采石遗迹形成的湖山胜景，陡崖如削、碧潭幽深。杭甬高铁列车经绍兴东郊时，车窗侧可见东湖一带的石壁与湖池相映。","visibility":"distant","source":"ai_reviewed","category":"gorge","viewScale":"mid","viewMinutes":4,"dimensions":["nature","geo"],"subtype":"water_feature","tags":["浙江","4A景区","东湖","采石遗迹"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"陡崖碧潭组合独特","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"https://www.shaoxing.gov.cn/","quote":"绍兴东湖为4A级旅游景区","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q10906018","quote":"绍兴东湖（East Lake, Shaoxing）","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"政府官网+wiki（无S级名录）"},"lineHints":[{"corridorId":"hangyong","nearStations":["绍兴东","宁波"]}]}),
  spot({"id":"ningbo-tianyige","name":"宁波天一阁","lng":121.54,"lat":29.871,"intro":"天一阁是我国现存最古老的私家藏书楼，古木参天、庭院深深，紧邻宁波老城月湖。杭甬高铁列车抵宁波站前，车窗可见月湖与古城屋脊错落。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":4,"dimensions":["history","architecture"],"subtype":"historic_building","tags":["浙江","5A景区","全国重点文保","藏书楼"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"月湖与古城连片，天一阁隐于绿荫","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"天一阁·月湖景区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.earthol.com/","quote":"天一阁 经度121.53996 纬度29.87089","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+坐标源"},"lineHints":[{"corridorId":"hangyong","nearStations":["宁波","绍兴东"]}]}),
  spot({"id":"ningbo-dongqian-lake","name":"宁波东钱湖","lng":121.657,"lat":29.769,"intro":"东钱湖为浙江省最大的天然淡水湖，湖面开阔、群山环抱。杭甬高铁列车经宁波东郊时，车窗可见东钱湖碧水与青山相拥的湖山胜境。","visibility":"distant","source":"ai_reviewed","category":"lake","viewScale":"mid","viewMinutes":6,"dimensions":["geo"],"subtype":"lake","tags":["浙江","东钱湖","省级风景名胜区","淡水湖"],"bestView":{"months":[4,5,6,9,10],"timeOfDay":"day","light":"any","note":"湖山相映，晴日层次最分明","blocked":[]},"sources":[{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q5296005","quote":"东钱湖（Dongqian Lake）坐标 29.7686N 121.6566E","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.ningbo.gov.cn/","quote":"东钱湖为浙江省最大天然淡水湖","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"wikidata坐标+政府官网"},"lineHints":[{"corridorId":"hangyong","nearStations":["宁波","绍兴东"]}]}),
  spot({"id":"songjiang-sheshan","name":"上海佘山（佘山天文台）","lng":121.185,"lat":31.094,"intro":"佘山为上海陆上最高峰，山巅佘山圣母大教堂与天文台白色穹顶矗立，是沪郊罕见的地形地标。沪杭高铁列车经松江南站段时，北侧可见佘山山丘轮廓。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":5,"dimensions":["architecture","geo"],"subtype":"mountain_range","tags":["上海","佘山天文台","全国重点文保","4A景区"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"教堂红墙与天文台穹顶是识别标志","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.songjiang.gov.cn/zjsj/002001/002001006/002001006002/20201110/88db7535-c430-4de9-bb75-7c75626f60ce.html","quote":"佘山天文台为全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q1801946","quote":"佘山（Sheshan）上海松江","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保+wiki（政府官网）"},"lineHints":[{"corridorId":"huhang","nearStations":["松江南","金山北"]}]}),
  spot({"id":"songjiang-guangfulin","name":"上海广富林遗址","lng":121.2,"lat":31.05,"intro":"广富林遗址被誉为「上海之根」，水上建筑群半沉于湖面，是全国重点文保。沪杭高铁列车经松江段时，可瞥见遗址公园的标志性水下建筑轮廓。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["history","architecture"],"subtype":"ruins_site","tags":["上海","全国重点文保","广富林","上海之根"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"水下建筑群轮廓独特，宜配讲解","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.songjiang.gov.cn/zjsj/002001/002001006/002001006002/20201110/88db7535-c430-4de9-bb75-7c75626f60ce.html","quote":"广富林遗址为全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11071543","quote":"广富林遗址（Guangfulin）松江","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保+wiki（政府官网）"},"lineHints":[{"corridorId":"huhang","nearStations":["松江南","金山北"]}]}),
  spot({"id":"jinshan-fengjing-town","name":"上海枫泾古镇","lng":120.97,"lat":30.88,"intro":"枫泾地处沪浙交界，是典型的江南水乡古镇，河道纵横、古桥串联。沪杭高铁金山北站即设于枫泾附近，列车经此可见水巷民居与古桥相伴。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":4,"dimensions":["culture","history"],"subtype":"old_town","tags":["上海","中国历史文化名镇","水乡古镇"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"金山北站即临古镇水乡","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"https://www.jinshan.gov.cn/","quote":"枫泾镇为中国历史文化名镇","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11102571","quote":"枫泾镇（Fengjing）上海金山区","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"政府官网+wiki（无S级名录）"},"lineHints":[{"corridorId":"huhang","nearStations":["金山北","嘉善南"]}]}),
  spot({"id":"jiaxing-nanhu","name":"嘉兴南湖","lng":120.757,"lat":30.751,"intro":"南湖为江南著名湖泊，中共一大在湖心岛红船上闭幕，烟雨楼临水而立。沪杭高铁列车经嘉兴南站段时，车窗可见南湖湖面与湖心岛绿树。","visibility":"window","source":"ai_reviewed","category":"lake","viewScale":"mid","viewMinutes":5,"dimensions":["history","geo"],"subtype":"lake","tags":["浙江","5A景区","南湖红船","红色旅游"],"bestView":{"months":[4,5,6,9,10],"timeOfDay":"day","light":"any","note":"烟雨楼与湖心岛是南湖标志","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"南湖旅游区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.jiaxing.gov.cn/","quote":"南湖为全国爱国主义教育示范基地","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+政府官网"},"lineHints":[{"corridorId":"huhang","nearStations":["嘉兴南","桐乡"]}]}),
  spot({"id":"tongxiang-wuzhen","name":"桐乡乌镇","lng":120.482,"lat":30.746,"intro":"乌镇是江南水乡古镇的代表，东栅西栅河网密布、石桥枕水。沪杭高铁列车经桐乡站段时，车窗可见水镇民居沿河绵延的江南水乡景观。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["culture","history"],"subtype":"old_town","tags":["浙江","5A景区","水乡古镇","枕水人家"],"bestView":{"months":[3,4,5,9,10,11],"timeOfDay":"day","light":"any","note":"河网石桥铺陈，乌镇戏剧节期间人气最盛","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"乌镇景区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q1371343","quote":"乌镇（Wuzhen）坐标 30.7465N 120.4819E","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+wikidata坐标"},"lineHints":[{"corridorId":"huhang","nearStations":["桐乡","嘉兴南"]}]}),
  spot({"id":"yuhang-liangzhu","name":"杭州良渚古城遗址","lng":119.99,"lat":30.39,"intro":"良渚古城是实证中华五千年文明的世界遗产，反山王陵与水利系统沉积于杭西北水网。沪杭高铁列车近杭州段时，远处可见良渚遗址所在的湿地田畴。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"far","viewMinutes":4,"dimensions":["history"],"subtype":"ruins_site","tags":["浙江","世界遗产","全国重点文保","良渚古城"],"bestView":{"months":[4,5,9,10,11],"timeOfDay":"day","light":"any","note":"遗址体量平缓，靠讲解与想象辨识","blocked":["urban"]},"sources":[{"type":"authority","level":"S","ref":"https://whc.unesco.org/en/list/1592/","quote":"良渚古城遗址为世界文化遗产","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.hangzhou.gov.cn/","quote":"良渚古城遗址为全国重点文物保护单位","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"世界遗产名录+政府官网（远眺）"},"lineHints":[{"corridorId":"huhang","nearStations":["余杭","杭州东"]}]}),
  spot({"id":"suzhou-hanshan-temple","name":"苏州寒山寺·枫桥","lng":120.5648,"lat":31.3105,"intro":"「姑苏城外寒山寺」名句使古刹与枫桥成为唐诗意象地标。沪宁城际列车经苏州西部时，依稀可见运河畔古寺黄墙与江村桥剪影。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":4,"dimensions":["culture","history"],"subtype":"temple_religion","tags":["江苏","寒山寺","枫桥","古运河"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"古寺黄墙与江村桥辨识度有限，宜配讲解","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"https://www.hanshansi.org/","quote":"寒山寺位于苏州城西枫桥镇，历史悠久","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://politics.people.com.cn/BIG5/n/2013/0701/c70731-22031846.html","quote":"沪宁线苏州段可见寒山寺","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"寺院官网+媒体佐证（体量小）"},"lineHints":[{"corridorId":"huning","nearStations":["苏州","无锡"]}]}),
  spot({"id":"suzhou-panmen","name":"苏州盘门","lng":120.617,"lat":31.292,"intro":"盘门为苏州古城唯一保存完好的水陆城门，盘门三景（城门、吴门桥、瑞光塔）沿运河展开。沪宁城际列车经苏州西南时可见瑞光塔与城墙轮廓。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":4,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["江苏","全国重点文保","水陆城门","瑞光塔"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"瑞光塔与城门构成古城天际线","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"http://wglj.suzhou.gov.cn/szwhgdhlyj/whbf/201906/d7e226cf3cb543a49044ca851d06c12d.shtml","quote":"盘门为全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.wikidata.org/wiki/Q1097507","quote":"盘门（Pan Gate）苏州古城水陆城门","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保+wiki"},"lineHints":[{"corridorId":"huning","nearStations":["苏州","昆山南"]}]}),
  spot({"id":"suzhou-shantang-street","name":"苏州山塘街（阊门）","lng":120.587,"lat":31.33,"intro":"山塘街自阊门蜿蜒至虎丘，七里山塘沿河而建，为「姑苏第一街」，也是大运河苏州段遗产点。沪宁城际列车经苏州北侧时可见水街黛瓦沿河铺展。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["culture","history"],"subtype":"old_town","tags":["江苏","中国历史文化名街","大运河遗产点","阊门"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"枕水人家与河街相依成片","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://whc.unesco.org/en/list/1443/","quote":"大运河世界遗产包含苏州山塘河历史街区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.suzhou.gov.cn/","quote":"山塘街为中国历史文化名街","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"世界遗产名录+政府官网"},"lineHints":[{"corridorId":"huning","nearStations":["苏州","无锡"]}]}),
  spot({"id":"wuxi-qingmingqiao","name":"无锡清名桥古运河","lng":120.306,"lat":31.566,"intro":"清名桥横跨古运河，是无锡城区段大运河世界遗产核心，两岸南长街枕河人家绵延。沪宁城际列车经无锡时，可见古桥与河街交错的江南水乡画卷。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":5,"dimensions":["culture","history"],"subtype":"old_town","tags":["江苏","大运河世界遗产","清名桥","南长街"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"古运河穿城而过，水街相映","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://whc.unesco.org/en/list/1443/","quote":"大运河世界遗产含无锡清名桥历史街区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.wuxi.gov.cn/","quote":"清名桥为全国重点文物保护单位","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"世界遗产名录+政府官网"},"lineHints":[{"corridorId":"huning","nearStations":["无锡","常州"]}]}),
  spot({"id":"changzhou-yancheng-ruins","name":"常州春秋淹城遗址","lng":119.9275,"lat":31.7026,"intro":"淹城为春秋时期三城三河古城遗址，是我国保存最完整的地面古城之一，全国重点文保并已列入5A。沪宁城际列车经常州南时可见古城环河与土垣轮廓。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["history"],"subtype":"ruins_site","tags":["江苏","全国重点文保","5A景区","春秋古城"],"bestView":{"months":[3,4,5,10,11],"timeOfDay":"day","light":"any","note":"三城三河环状格局需远看方显","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.changzhou.gov.cn/","quote":"淹城遗址为全国重点文物保护单位，2017年为5A景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.bigemap.net/city-6137.html","quote":"淹城遗址 经度119.927490 纬度31.702637","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保+坐标源"},"lineHints":[{"corridorId":"huning","nearStations":["常州","丹阳"]}]}),
  spot({"id":"jurong-maoshan","name":"句容茅山","lng":119.3,"lat":31.77,"intro":"茅山为道教上清派发源地，三茅峰连绵，大茅峰顶道观依稀可见。沪宁沿江高铁列车经句容段时，南侧远处可见茅山群峰横列天际线上。","visibility":"window","source":"ai_reviewed","category":"mountain","viewScale":"far","viewMinutes":6,"dimensions":["culture","geo"],"subtype":"mountain_range","tags":["江苏","5A景区","道教名山","茅山"],"bestView":{"months":[4,5,9,10,11],"timeOfDay":"day","light":"any","note":"三峰轮廓远望如笔架","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"茅山景区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.jurong.gov.cn/","quote":"茅山位于句容，道教上清宗坛","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+政府官网"},"lineHints":[{"corridorId":"huningyanjiang","nearStations":["句容","金坛"]}]}),
  spot({"id":"jintan-changdang-lake","name":"金坛长荡湖","lng":119.55,"lat":31.65,"intro":"长荡湖为苏南重要淡水湖，湖荡连片、养殖围网星罗棋布。沪宁沿江高铁列车经金坛段时，车窗一侧可望见开阔湖面与湿地草甸相间。","visibility":"window","source":"ai_reviewed","category":"lake","viewScale":"mid","viewMinutes":5,"dimensions":["geo","nature"],"subtype":"lake","tags":["江苏","淡水湖","湿地","金坛"],"bestView":{"months":[5,6,7,8,9],"timeOfDay":"day","light":"any","note":"湖面开阔，围网与湿地层次丰富","blocked":[]},"sources":[{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11071665","quote":"长荡湖（Changdang Lake）苏南淡水湖","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"https://peoplerail.com/newszb/h5/html5/2026-06/07/content_1_65559.htm","quote":"沪宁沿江高铁沿线湖泊湿地景色","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"wikidata+媒体佐证"},"lineHints":[{"corridorId":"huningyanjiang","nearStations":["金坛","武进"]}]}),
  spot({"id":"wujin-gehu-lake","name":"武进滆湖","lng":119.78,"lat":31.63,"intro":"滆湖是太湖以西的姊妹湖，湖岸平缓、芦苇丛生。沪宁沿江高铁列车经武进段时，车窗可见滆湖湖面与沿岸水田交织的水乡泽国景象。","visibility":"window","source":"ai_reviewed","category":"lake","viewScale":"mid","viewMinutes":5,"dimensions":["geo","nature"],"subtype":"lake","tags":["江苏","滆湖","水乡","湿地"],"bestView":{"months":[5,6,7,8,9],"timeOfDay":"day","light":"any","note":"沿岸芦苇与水道是水乡标签","blocked":[]},"sources":[{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11071657","quote":"滆湖（Ge Lake）武进太湖以西","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"https://peoplerail.com/newszb/h5/html5/2026-06/07/content_1_65559.htm","quote":"沪宁沿江高铁沿线湖荡景色","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"wikidata+媒体佐证"},"lineHints":[{"corridorId":"huningyanjiang","nearStations":["武进","江阴"]}]}),
  spot({"id":"changshu-yushan-shanghu","name":"常熟虞山·尚湖","lng":120.73,"lat":31.66,"intro":"虞山半入城，山前尚湖如镜，是常熟「山水文城」的标志。沪宁沿江高铁列车经常熟段时，车窗可见虞山苍翠山脊与尚湖水光相映。","visibility":"window","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":6,"dimensions":["geo","culture"],"subtype":"mountain_range","tags":["江苏","5A景区","国家森林公园","尚湖"],"bestView":{"months":[4,5,9,10,11],"timeOfDay":"day","light":"any","note":"虞山山脊与山前湖面层次分明","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"虞山尚湖旅游区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.changshu.gov.cn/","quote":"虞山为国家森林公园，尚湖为太湖风景名胜区组成部分","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+政府官网"},"lineHints":[{"corridorId":"huningyanjiang","nearStations":["常熟","张家港"]}]}),
  spot({"id":"changshu-shajiabang","name":"常熟沙家浜","lng":120.78,"lat":31.5,"intro":"沙家浜以芦苇荡与京剧《沙家浜》闻名，是江南湿地与红色旅游并蓄之地。沪宁沿江高铁列车经常熟段时，远处可见大片芦苇荡铺向天际。","visibility":"distant","source":"ai_reviewed","category":"lake","viewScale":"far","viewMinutes":5,"dimensions":["nature","history"],"subtype":"wetland","tags":["江苏","5A景区","芦苇荡","红色旅游"],"bestView":{"months":[5,6,7,8,9,10],"timeOfDay":"day","light":"any","note":"夏秋芦苇青绿连片，最为壮观","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"沙家浜·虞山尚湖旅游区为5A级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.changshu.gov.cn/","quote":"沙家浜芦苇荡风景区为湿地与红色旅游地","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+政府官网"},"lineHints":[{"corridorId":"huningyanjiang","nearStations":["常熟","太仓"]}]}),
  spot({"id":"taicang-shaxi-town","name":"太仓沙溪古镇","lng":121.13,"lat":31.49,"intro":"沙溪古镇保存着明清商业街与河棚水巷，是中国历史文化名镇。沪宁沿江高铁列车经太仓段时，车窗可见江南民居鳞次栉比、河港纵横。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["culture","history"],"subtype":"old_town","tags":["江苏","中国历史文化名镇","江南水乡"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"河街与骑楼是水乡标签","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"https://www.taicang.gov.cn/","quote":"沙溪镇为中国历史文化名镇","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11135608","quote":"沙溪古镇（Shaxi Ancient Town）太仓","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"政府官网+wiki（无S级名录）"},"lineHints":[{"corridorId":"huningyanjiang","nearStations":["太仓","常熟"]}]}),
  spot({"id":"huzhou-nanxun-town","name":"湖州南浔古镇","lng":120.4267,"lat":30.8756,"intro":"南浔为江南六大古镇之一，小莲庄、藏书楼与大宅园林沿河铺陈，也是大运河世界遗产江南运河南浔段。沪苏湖高铁设南浔站，列车经此可见水镇黛瓦连绵。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":5,"dimensions":["culture","history"],"subtype":"old_town","tags":["浙江","5A景区","大运河世界遗产","江南古镇"],"bestView":{"months":[3,4,5,9,10,11],"timeOfDay":"day","light":"any","note":"水镇沿河铺陈，粉墙黛瓦成片","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"南浔古镇景区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.earthol.com/","quote":"南浔古镇 经度120.42673 纬度30.87558","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+坐标源"},"lineHints":[{"corridorId":"husuhu","nearStations":["湖州南浔","苏州南"]}]}),
  spot({"id":"shanghai-dianshan-lake","name":"上海淀山湖","lng":120.95,"lat":31.09,"intro":"淀山湖是上海最大的天然湖泊，湖荡开阔、帆影点点，环湖分布着大观园与众多古镇。沪苏湖高铁列车自上海虹桥驶出后，西南侧可见淀山湖烟波。","visibility":"window","source":"ai_reviewed","category":"lake","viewScale":"mid","viewMinutes":5,"dimensions":["geo"],"subtype":"lake","tags":["上海","淀山湖","上海最大湖泊"],"bestView":{"months":[4,5,6,9,10],"timeOfDay":"day","light":"any","note":"湖面辽阔，环湖水乡点缀","blocked":[]},"sources":[{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q892578","quote":"淀山湖（Dianshan Lake）上海最大天然湖泊","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.shqp.gov.cn/","quote":"淀山湖位于青浦区西南","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"wikidata+政府官网（无S级名录）"},"lineHints":[{"corridorId":"husuhu","nearStations":["上海虹桥","苏州南"]}]}),
  spot({"id":"shanghai-liantang-town","name":"上海练塘古镇","lng":120.1,"lat":31,"intro":"练塘是陈云故里，静谧水乡小镇沿市河而建，陈云故居为全国重点文保。沪苏湖高铁设练塘站，列车经此可见枕水人家与河埠石桥的水乡风光。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":4,"dimensions":["culture","history"],"subtype":"old_town","tags":["江苏","陈云故里","全国重点文保","水乡古镇"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"市河与石桥构成小镇骨架","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.shqp.gov.cn/","quote":"陈云故居为全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11084903","quote":"练塘镇（Liantang）上海青浦","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保+wiki"},"lineHints":[{"corridorId":"husuhu","nearStations":["练塘","苏州南"]}]}),
  spot({"id":"wujiang-zhenze-town","name":"苏州震泽古镇","lng":120.5,"lat":30.93,"intro":"震泽为太湖古名，师俭堂、慈云寺塔沿頔塘河矗立，是中国历史文化名镇。沪苏湖高铁列车经吴江盛泽段时，车窗可见水乡古镇与圩田交织。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["culture","history"],"subtype":"old_town","tags":["江苏","中国历史文化名镇","慈云寺塔","水乡"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"慈云寺塔临河是标志","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"https://www.wujiang.gov.cn/","quote":"震泽镇为中国历史文化名镇","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11071218","quote":"震泽镇（Zhenze）苏州吴江","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"政府官网+wiki（无S级名录）"},"lineHints":[{"corridorId":"husuhu","nearStations":["苏州南","湖州南浔"]}]}),
  spot({"id":"husutong-yangtze-bridge","name":"沪苏通长江公铁大桥","lng":120.63,"lat":31.99,"intro":"沪苏通长江公铁大桥主跨1092米，是世界最大跨度公铁两用斜拉桥，沪通铁路列车从其上层跨过长江。过桥时江面开阔，塔柱缆索如竖琴凌空。","visibility":"distant","source":"ai_reviewed","category":"engineering","viewScale":"near","viewMinutes":6,"dimensions":["construct"],"subtype":"bridge","tags":["江苏","沪苏通长江公铁大桥","斜拉桥","世界之最"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"过桥时缆索塔柱近在咫尺，江面浩瀚","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"http://wap.china-railway.com.cn/xwzx/mtjj/fzrb/fzw/202007/t20200702_106238.html","quote":"沪苏通长江公铁大桥主跨1092米，世界最大跨度公铁两用斜拉桥","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"https://www.news.cn/local/20241226/8dfe875aaa554ca6b789a47080485d27/c.html","quote":"沪苏通长江公铁大桥为公铁两用斜拉桥","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"国铁集团官网+新华社报道"},"lineHints":[{"corridorId":"hutong","nearStations":["张家港","南通西"]}]}),
  spot({"id":"taicang-liuhe-estuary","name":"太仓浏河（郑和下西洋起锚地）","lng":121.26,"lat":31.51,"intro":"浏河为郑和七下西洋的起锚地，地处长江入海口南岸，江海交汇、灯塔耸立。沪通铁路列车经太仓段时，窗外可见江海相接的辽阔水面。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["history","geo"],"subtype":"coast_island","tags":["江苏","郑和下西洋","长江口","江海交汇"],"bestView":{"months":[4,5,6,9,10],"timeOfDay":"day","light":"any","note":"江海交汇处水色分明","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"https://www.taicang.gov.cn/","quote":"浏河为郑和下西洋起锚地","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11084882","quote":"浏河镇（Liuhe）太仓长江口","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"政府官网+wiki（无S级名录）"},"lineHints":[{"corridorId":"hutong","nearStations":["太仓","太仓南"]}]}),
  spot({"id":"zhangjiagang-xiangshan","name":"张家港香山","lng":120.5,"lat":31.89,"intro":"香山临长江而立，是张家港江畔小山，登顶可望长江与大桥。沪通铁路列车经张家港段时，车窗可见香山青峰与长江岸线相映。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":5,"dimensions":["geo","culture"],"subtype":"mountain_range","tags":["江苏","4A景区","香山","长江"],"bestView":{"months":[4,5,9,10,11],"timeOfDay":"day","light":"any","note":"临江山影与长江岸线相映","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"https://www.zjg.gov.cn/","quote":"香山为4A级旅游景区","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11084896","quote":"香山（Xiangshan）张家港","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"政府官网+wiki（无S级名录）"},"lineHints":[{"corridorId":"hutong","nearStations":["张家港","常熟"]}]}),
  spot({"id":"nanjing-niushoushan","name":"南京牛首山","lng":118.744,"lat":31.902,"intro":"牛首山双峰对峙，山顶佛顶宫金色穹顶与佛顶塔矗立，是近年新晋5A。京沪高铁列车驶离南京南站后南眺，可见山脊与金色穹顶在绿林间闪耀。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":6,"dimensions":["culture","architecture"],"subtype":"temple_religion","tags":["江苏","5A景区","佛顶宫","佛教"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"金色佛顶宫穹顶在晴日反光易辨识","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"牛首山文化旅游区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.niushoushan.net/","quote":"牛首山文化旅游区位于南京市江宁区","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+园区官网"},"lineHints":[{"corridorId":"jinghu","nearStations":["南京南","镇江南"]}]}),
  spot({"id":"suzhou-yangcheng-lake-bridge","name":"阳澄湖（京沪高铁丹昆特大桥跨湖段）","lng":120.78,"lat":31.42,"intro":"京沪高铁丹昆特大桥全长约165公里为世界最长高架桥，在阳澄湖段列车贴着湖面高架穿行，两侧湖光蟹塘连片，是「车在湖上飞」的标志性视角。","visibility":"window","source":"ai_reviewed","category":"engineering","viewScale":"near","viewMinutes":5,"dimensions":["construct","geo"],"subtype":"bridge","tags":["江苏","丹昆特大桥","阳澄湖","大闸蟹","高架桥"],"bestView":{"months":[4,5,6,7,8,9,10],"timeOfDay":"day","light":"any","note":"两侧湖面与围网蟹塘近在咫尺，雨雾天成水墨","blocked":[]},"sources":[{"type":"news","level":"B","ref":"http://wap.china-railway.com.cn/xwzx/mtjj/fzrb/fzw/202007/t20200702_106238.html","quote":"丹昆特大桥为世界最长高架桥，跨阳澄湖","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q15911115","quote":"Danyang–Kunshan Grand Bridge 丹昆特大桥 164.8km","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"国铁报道+wikidata（世界最长高架桥）"},"lineHints":[{"corridorId":"jinghu","nearStations":["苏州北","昆山南"]}]}),
  spot({"id":"suzhou-jinji-lake","name":"苏州金鸡湖（东方之门天际线）","lng":120.718,"lat":31.318,"intro":"金鸡湖是苏州工业园区核心，东方之门与摩天轮围湖而立。京沪高铁列车经苏州北站段时，东侧远处可见湖面与现代化天际线同框。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"far","viewMinutes":5,"dimensions":["architecture","geo"],"subtype":"city_skyline","tags":["江苏","5A景区","东方之门","城市天际线"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"front","note":"东方之门「大秋裤」剪影是城市地标","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"金鸡湖景区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q845346","quote":"金鸡湖（Jinji Lake）苏州工业园区","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+wikidata"},"lineHints":[{"corridorId":"jinghu","nearStations":["苏州北","昆山南"]}]}),
  spot({"id":"wuxi-taihu-distant","name":"无锡太湖（鼋头渚远眺）","lng":120.2144,"lat":31.525,"intro":"太湖为全国第三大淡水湖，鼋头渚突入湖中为「太湖佳绝处」。京沪高铁列车经无锡东段时，西南方远处可见水天一色的太湖湖面铺展至天际。","visibility":"distant","source":"ai_reviewed","category":"lake","viewScale":"far","viewMinutes":6,"dimensions":["geo"],"subtype":"lake","tags":["江苏","5A景区","国家级风景名胜区","太湖"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"晴日湖面与远山层次分明","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.ytz.com.cn/","quote":"鼋头渚为太湖国家级风景名胜区核心景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.ytz.com.cn/","quote":"鼋头渚 北纬31°31′ 东经120°12′","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"国家级风景名胜区官网（远眺推理）"},"lineHints":[{"corridorId":"jinghu","nearStations":["无锡东","苏州北"]}]}),
  spot({"id":"danyang-lingmu-carving","name":"丹阳南朝陵墓石刻","lng":119.6,"lat":32,"intro":"丹阳是南朝齐梁帝王故里，乡间散布着天禄、麒麟等石兽与神道柱，为全国重点文保。京沪高铁列车经丹阳段时，田野间的石刻群藏于绿畴之中。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"far","viewMinutes":4,"dimensions":["history"],"subtype":"ruins_site","tags":["江苏","全国重点文保","南朝石刻","齐梁故里"],"bestView":{"months":[3,4,5,10,11],"timeOfDay":"day","light":"any","note":"石刻体量较小，需语音讲解辅助辨识","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.danyang.gov.cn/","quote":"丹阳南朝陵墓石刻为全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q15911115","quote":"南朝陵墓石刻分布于丹阳、南京一带","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保+wiki（远眺，体量小）"},"lineHints":[{"corridorId":"jinghu","nearStations":["丹阳北","常州北"]}]}),
  spot({"id":"xuzhou-yunlong-lake","name":"徐州云龙湖","lng":117.1539,"lat":34.2376,"intro":"徐州唯一的5A景区，京沪线普速列车自徐州站驶出后，西南侧车窗可见云龙湖与云龙山连成的大片山水，湖面开阔，跨湖堤桥清晰可辨。","visibility":"window","source":"ai_reviewed","category":"lake","viewScale":"mid","viewMinutes":6,"dimensions":["geo","culture"],"subtype":"lake","tags":["江苏","5A景区","国家水利风景区","城市湖泊"],"bestView":{"months":[4,5,6,9,10],"timeOfDay":"day","light":"any","note":"春夏绿意最浓，云龙山轮廓清晰","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"云龙湖景区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.bigemap.net/city-6137.html","quote":"云龙湖 经度117.153902 纬度34.237600","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://politics.people.com.cn/BIG5/n/2013/0701/c70731-22031846.html","quote":"京沪线沿线可见徐州云龙湖等山水","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+政府名录坐标+媒体佐证"},"lineHints":[{"corridorId":"jinghuxian","nearStations":["徐州","徐州东"]}]}),
  spot({"id":"xuzhou-han-culture","name":"徐州汉文化景区（狮子山楚王陵）","lng":117.2212,"lat":34.2471,"intro":"狮子山楚王陵是西汉楚王墓群核心，位居徐州城东，京沪线列车经徐州东段时，东南侧可望见汉兵马俑与山丘之上的陵墓土冢轮廓。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":4,"dimensions":["history"],"subtype":"ruins_site","tags":["江苏","全国重点文保","西汉楚王陵","汉俑"],"bestView":{"months":[3,4,5,10,11],"timeOfDay":"day","light":"any","note":"土冢轮廓在无霾时段更清晰","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.xz.gov.cn/zwgk/zfxxgk/zfxxgkml/202205/20220520_1243503.html","quote":"狮子山楚王陵为全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.bigemap.net/city-6137.html","quote":"徐州汉文化景区 经度117.221222 纬度34.247082","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保+坐标源"},"lineHints":[{"corridorId":"jinghuxian","nearStations":["徐州","徐州东"]}]}),
  spot({"id":"nanjing-xuanwu-lake","name":"南京玄武湖","lng":118.798,"lat":32.072,"intro":"江南城内最大湖泊，紧邻南京站南广场，京沪线列车进出南京站时湖面在车窗一侧铺开，紫金山与明城墙环列其后，是入宁门户景观。","visibility":"on_track","source":"ai_reviewed","category":"lake","viewScale":"near","viewMinutes":5,"dimensions":["geo","culture"],"subtype":"lake","tags":["江苏","城市湖泊","明城墙","南京站"],"bestView":{"months":[4,5,6,9,10],"timeOfDay":"day","light":"any","note":"环湖城墙与樱洲在春夏最佳","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"https://www.nanjing.gov.cn/","quote":"玄武湖为南京市内最大湖泊，国家级风景名胜区","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://politics.people.com.cn/BIG5/n/2013/0701/c70731-22031846.html","quote":"京沪线南京段入城即见玄武湖","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"政府官网+媒体佐证"},"lineHints":[{"corridorId":"jinghuxian","nearStations":["南京","镇江"]}]}),
  spot({"id":"nanjing-zhongshan","name":"南京钟山（紫金山）","lng":118.848,"lat":32.0503,"intro":"钟山为宁镇山脉南支主峰，中山陵、明孝陵藏于林海，京沪线列车经南京东侧时，正前方可见苍翠山脊横亘，山顶气象台球顶清晰。","visibility":"window","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":8,"dimensions":["geo","history"],"subtype":"mountain_range","tags":["江苏","5A景区","中山陵","明孝陵","世界遗产"],"bestView":{"months":[3,4,5,10,11],"timeOfDay":"day","light":"any","note":"秋冬山色青黛，能见度高时山顶清晰","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"钟山—中山陵景区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://whc.unesco.org/en/list/1004/","quote":"明孝陵属明清皇家陵寝世界文化遗产","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+世界遗产名录"},"lineHints":[{"corridorId":"jinghuxian","nearStations":["南京","镇江"]}]}),
  spot({"id":"zhenjiang-jinshan","name":"镇江金山（金山寺）","lng":119.4168,"lat":32.2155,"intro":"金山临长江而立，金山寺慈寿塔凌空，是镇江三山名胜之一。京沪线列车过镇江段时，西北侧可见金山孤峰峙立江畔的身形。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["culture","history"],"subtype":"temple_religion","tags":["江苏","5A景区","国家级风景名胜区","金山寺"],"bestView":{"months":[4,5,9,10,11],"timeOfDay":"day","light":"any","note":"慈寿塔与山形轮廓是辨识标志","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.zjssjq.com/index.asp","quote":"金山为国家级风景名胜区、国家5A级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.earthol.com/","quote":"金山寺 经度119.41679 纬度32.21555","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"国家级风景名胜区官网+坐标源"},"lineHints":[{"corridorId":"jinghuxian","nearStations":["镇江","常州"]}]}),
  spot({"id":"zhenjiang-jiaoshan","name":"镇江焦山","lng":119.487,"lat":32.233,"intro":"焦山是长江中的一座岛屿名山，焦山碑林藏有《瘗鹤铭》摩崖，京沪线列车过镇江东侧时，可见江心绿岛与山巅万佛塔相映。","visibility":"window","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":6,"dimensions":["geo","history"],"subtype":"mountain_range","tags":["江苏","5A景区","长江岛屿","焦山碑林"],"bestView":{"months":[4,5,9,10],"timeOfDay":"day","light":"any","note":"江心岛与万佛塔剪影在晴日最佳","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.zjssjq.com/index.asp","quote":"焦山为镇江三山风景名胜区组成部分","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.wikidata.org/wiki/Q1106841","quote":"焦山（Jiaoshan）坐标 32.23N 119.49E","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"风景名胜区官网+wikidata坐标"},"lineHints":[{"corridorId":"jinghuxian","nearStations":["镇江","常州"]}]}),
  spot({"id":"zhenjiang-beigushan","name":"镇江北固山","lng":119.4523,"lat":32.2131,"intro":"北固山雄踞长江南岸，甘露寺铁塔与「天下第一江山」题刻名满天下，京沪线列车经镇江段时，江北侧可见紧贴江岸的山崖与楼阁。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["江苏","5A景区","甘露寺","长江"],"bestView":{"months":[4,5,9,10],"timeOfDay":"day","light":"any","note":"江畔崖壁与多景楼清晰可辨","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.zjssjq.com/index.asp","quote":"北固山为镇江三山国家级风景名胜区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.bigemap.net/city-6137.html","quote":"北固山 经度119.452301 纬度32.213146","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"风景名胜区官网+坐标源"},"lineHints":[{"corridorId":"jinghuxian","nearStations":["镇江","常州"]}]}),
  spot({"id":"changzhou-tianning","name":"常州天宁寺·天宁宝塔","lng":119.9697,"lat":31.7744,"intro":"天宁寺为千年古刹，十三层天宁宝塔高耸，是常州城醒目地标。京沪线列车经常州站段时，东北侧可见宝塔金顶刺破城市天际线。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":4,"dimensions":["architecture","culture"],"subtype":"temple_religion","tags":["江苏","全国重点文保","天宁宝塔","佛教"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"宝塔金顶远处即可辨识","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.changzhou.gov.cn/","quote":"天宁寺为全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.bigemap.net/city-6137.html","quote":"常州天宁寺 经度119.969658 纬度31.774361","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保+坐标源"},"lineHints":[{"corridorId":"jinghuxian","nearStations":["常州","无锡"]}]}),
  spot({"id":"wuxi-huishan-ancient-town","name":"无锡惠山古镇","lng":120.2735,"lat":31.5807,"intro":"惠山古镇依惠山而建，寄畅园、天下第二泉与祠堂群构成江南园林文化带。京沪线列车经无锡段时，西南侧可见惠山青峰与古镇屋脊。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":6,"dimensions":["culture","architecture"],"subtype":"old_town","tags":["江苏","5A景区","寄畅园","天下第二泉"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"惠山山形与古镇连成一片","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://crtt.wuxi.gov.cn/doc/2024/09/24/4272307.shtml","quote":"惠山古镇景区为国家5A级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.earthol.com/","quote":"惠山古镇 经度120.27354 纬度31.58069","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A政府名录+坐标源"},"lineHints":[{"corridorId":"jinghuxian","nearStations":["无锡","常州"]}]}),
  spot({"id":"suzhou-zhuozhengyuan","name":"苏州拙政园","lng":120.629,"lat":31.3242,"intro":"中国四大名园之首，世界文化遗产苏州古典园林代表作。京沪线列车经苏州古城段时，可见水巷民居与粉墙黛瓦层层叠叠，园林藏于其间。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":6,"dimensions":["architecture","culture"],"subtype":"historic_building","tags":["江苏","世界遗产","全国重点文保","江南园林"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"古城粉墙黛瓦水巷为整体意象","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://ylj.suzhou.gov.cn/szsylj/ylgk/202001/2e550f4c54594709ba289f95da7ef039.shtml","quote":"拙政园为苏州古典园林世界文化遗产","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.bigemap.net/city-6137.html","quote":"拙政园 经度120.629029 纬度31.32416","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"世界遗产名录+坐标源"},"lineHints":[{"corridorId":"jinghuxian","nearStations":["苏州","无锡"]}]}),
  spot({"id":"suzhou-huqiu","name":"苏州虎丘","lng":120.5808,"lat":31.3358,"intro":"虎丘以云岩寺塔（虎丘塔）闻名，斜塔立於山巅为苏州城地标。京沪线列车经苏州西北部时，远处可见虎丘山丘与斜塔剪影。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["江苏","全国重点文保","虎丘塔","5A景区"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"斜塔轮廓最易辨识","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"http://wglj.suzhou.gov.cn/szwhgdhlyj/whbf/201906/d7e226cf3cb543a49044ca851d06c12d.shtml","quote":"云岩寺塔为全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.wikidata.org/wiki/Q1539294","quote":"虎丘塔（Tiger Hill Pagoda）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保名录+wiki"},"lineHints":[{"corridorId":"jinghuxian","nearStations":["苏州","无锡"]}]}),
  spot({"id":"lianyungang-huaguoshan","name":"连云港花果山","lng":119.22,"lat":34.65,"intro":"花果山为云台山主峰，相传是《西游记》孙悟空故里，玉女峰海拔624米为江苏最高峰。连镇高铁列车驶离连云港段时，南侧可见云台群峰连绵起伏。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":6,"dimensions":["geo","culture"],"subtype":"mountain_range","tags":["江苏","5A景区","国家级风景名胜区","江苏最高峰"],"bestView":{"months":[4,5,9,10,11],"timeOfDay":"day","light":"any","note":"玉女峰为江苏之巅，山势连绵易辨","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"花果山景区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.lyg.gov.cn/","quote":"花果山为云台山风景名胜区，玉女峰海拔624米","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+政府官网"},"lineHints":[{"corridorId":"lianzhen","nearStations":["连云港","灌云"]}]}),
  spot({"id":"huaian-zhouenlai-guju","name":"淮安周恩来故里","lng":119.14,"lat":33.5,"intro":"周恩来故里含周恩来故居与纪念馆，驸马巷故居古朴宁静，是全国爱国主义教育示范基地。连镇高铁列车经淮安东站段时，可远眺淮安古城方向。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["history"],"subtype":"revolutionary","tags":["江苏","5A景区","全国重点文保","周恩来故居"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"古城人文意象以讲解为主","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"周恩来故里旅游景区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.huaian.gov.cn/","quote":"周恩来故居为全国重点文物保护单位","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+全国重点文保"},"lineHints":[{"corridorId":"lianzhen","nearStations":["淮安东","涟水"]}]}),
  spot({"id":"gaoyou-yuchengyi","name":"高邮盂城驿","lng":119.4392,"lat":32.771,"intro":"盂城驿是我国现存规模最大、保存最完整的古代驿站，也是大运河世界遗产点。连镇高铁列车经高邮段时，车窗可见古驿站鼓楼与运河水道相依。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["history","architecture"],"subtype":"historic_building","tags":["江苏","全国重点文保","大运河世界遗产","古驿站"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"鼓楼与运河是识别地标","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://whc.unesco.org/en/list/1443/","quote":"大运河世界遗产含高邮盂城驿","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.earthol.com/","quote":"盂城驿 经度119.43915 纬度32.77098","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"世界遗产名录+坐标源"},"lineHints":[{"corridorId":"lianzhen","nearStations":["高邮","宝应"]}]}),
  spot({"id":"gaoyou-lake","name":"高邮湖","lng":119.35,"lat":32.8,"intro":"高邮湖是苏中地区最大淡水湖，湖面辽阔，与京杭大运河一线相连。连镇高铁列车经高邮段时，西侧车窗可见高邮湖烟波万顷的水面。","visibility":"distant","source":"ai_reviewed","category":"lake","viewScale":"mid","viewMinutes":6,"dimensions":["geo"],"subtype":"lake","tags":["江苏","高邮湖","淡水湖","大运河"],"bestView":{"months":[5,6,7,8,9,10],"timeOfDay":"day","light":"any","note":"湖面开阔，晨昏水色最柔","blocked":[]},"sources":[{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11071413","quote":"高邮湖（Gaoyou Lake）苏中最大淡水湖","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"https://m.thepaper.cn/newsDetail_forward_10359930","quote":"连镇高铁沿线高邮湖等水乡景色","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"wikidata+媒体佐证"},"lineHints":[{"corridorId":"lianzhen","nearStations":["高邮","高邮北"]}]}),
  spot({"id":"yangzhou-slender-west-lake","name":"扬州瘦西湖","lng":119.4099,"lat":32.4088,"intro":"瘦西湖以二十四桥、五亭桥等景点闻名，是蜀冈—瘦西湖国家级风景名胜区核心。连镇高铁列车抵扬州段时，可见瘦西湖一带绿柳拂堤的湖上园林。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["culture","architecture"],"subtype":"historic_building","tags":["江苏","5A景区","国家级风景名胜区","二十四桥"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"烟花三月扬州春色最盛","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"瘦西湖风景区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.yangzhou.gov.cn/","quote":"瘦西湖为蜀冈—瘦西湖国家级风景名胜区","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+国家级风景名胜区"},"lineHints":[{"corridorId":"lianzhen","nearStations":["扬州东","高邮"]}]}),
  spot({"id":"yangzhou-daming-temple","name":"扬州大明寺","lng":119.4131,"lat":32.4198,"intro":"大明寺位于蜀冈中峰，鉴真纪念堂与栖灵塔矗立山巅，为千年古刹与全国重点文保。连镇高铁列车经扬州段时，可见蜀冈林木间古塔高耸。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["culture","history"],"subtype":"temple_religion","tags":["江苏","全国重点文保","鉴真纪念堂","栖灵塔"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"栖灵塔与蜀冈山形是识别标志","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.yangzhou.gov.cn/","quote":"大明寺为全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.earthol.com/","quote":"大明寺 经度119.41307 纬度32.41983","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保+坐标源"},"lineHints":[{"corridorId":"lianzhen","nearStations":["扬州东","高邮"]}]}),
  spot({"id":"yangzhou-geyuan","name":"扬州个园","lng":119.4437,"lat":32.3991,"intro":"个园以四季假山著称，是扬州园林代表作与全国重点文保。连镇高铁列车经扬州段时，车窗可见古城内园林墙垣与老宅屋顶错落有致。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["architecture","culture"],"subtype":"historic_building","tags":["江苏","全国重点文保","扬州园林","四季假山"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"园林藏于古城，以整体人文意象感知","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.yangzhou.gov.cn/","quote":"个园为全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.bigemap.net/city-6137.html","quote":"个园 经度119.443715 纬度32.399128","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保+坐标源"},"lineHints":[{"corridorId":"lianzhen","nearStations":["扬州东","高邮"]}]}),
  spot({"id":"lishui-tiansheng-bridge","name":"南京溧水天生桥·石臼湖","lng":118.84,"lat":31.6,"intro":"溧水天生桥是明代开凿胭脂河时留下的巨石桥洞，石臼湖为南京南部大湖。宁杭高铁列车经溧水段时，车窗可见胭脂河峡谷与石臼湖湿地交叠的水乡地貌。","visibility":"distant","source":"ai_reviewed","category":"gorge","viewScale":"mid","viewMinutes":5,"dimensions":["nature","geo"],"subtype":"water_feature","tags":["江苏","国家湿地公园","石臼湖","天生桥"],"bestView":{"months":[5,6,7,8,9],"timeOfDay":"day","light":"any","note":"石臼湖湿地水草丰茂，候鸟季节生动","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"http://www.njls.gov.cn/zjls/qqjj/?eqi","quote":"溧水有石臼湖、天生桥等自然人文景观","checkedAt":"2026-10-01"},{"type":"authority","level":"S","ref":"https://www.mee.gov.cn/","quote":"石臼湖国家湿地公园","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"政府官网+国家湿地公园名录"},"lineHints":[{"corridorId":"ninghang","nearStations":["溧水","瓦屋山"]}]}),
  spot({"id":"changxing-taihu","name":"长兴太湖（太湖南滨）","lng":119.96,"lat":31.03,"intro":"长兴地处太湖南岸，湖湾湿地与芦苇荡延伸入湖。宁杭高铁列车经长兴段时，车窗可见太湖烟波浩渺的水面与南岸湿地交织的景象。","visibility":"on_track","source":"ai_reviewed","category":"lake","viewScale":"mid","viewMinutes":6,"dimensions":["geo","nature"],"subtype":"lake","tags":["浙江","太湖","国家级风景名胜区","长兴"],"bestView":{"months":[4,5,6,9,10],"timeOfDay":"day","light":"any","note":"太湖烟波与南岸湿地层次丰富","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.ytz.com.cn/","quote":"太湖为国家级风景名胜区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.huzhou.gov.cn/","quote":"长兴地处太湖南岸","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"国家级风景名胜区+政府官网"},"lineHints":[{"corridorId":"ninghang","nearStations":["长兴","湖州"]}]}),
  spot({"id":"deqing-moganshan","name":"德清莫干山","lng":119.8685,"lat":30.6072,"intro":"莫干山以「清凉世界」著称，竹林漫山、洋楼别墅点缀其间，是国家级风景名胜区。宁杭高铁列车经德清段时，车窗可见莫干山群峰起伏的绿意。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":6,"dimensions":["geo","culture"],"subtype":"mountain_range","tags":["浙江","国家级风景名胜区","避暑胜地","竹海"],"bestView":{"months":[5,6,7,8,9,10],"timeOfDay":"day","light":"any","note":"竹海苍翠，夏季云雾缭绕最有意境","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.mohurd.gov.cn/","quote":"莫干山为国家级风景名胜区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.earthol.com/","quote":"莫干山 经度119.86846 纬度30.60722","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"国家级风景名胜区+坐标源"},"lineHints":[{"corridorId":"ninghang","nearStations":["德清","湖州"]}]}),
  spot({"id":"deqing-xiazhu-lake","name":"德清下渚湖","lng":120.03,"lat":30.53,"intro":"下渚湖是江南著名湿地，港汊交错、芦苇成片，为国家湿地公园。宁杭高铁列车经德清段时，车窗可见湖荡湿地与白鹭群飞的生态景象。","visibility":"on_track","source":"ai_reviewed","category":"lake","viewScale":"mid","viewMinutes":5,"dimensions":["nature","geo"],"subtype":"wetland","tags":["浙江","国家湿地公园","下渚湖","候鸟"],"bestView":{"months":[4,5,6,9,10,11],"timeOfDay":"day","light":"any","note":"候鸟迁徙季白鹭群飞","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.mee.gov.cn/","quote":"下渚湖国家湿地公园","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.deqing.gov.cn/","quote":"下渚湖湿地为江南著名湿地","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"国家湿地公园名录+政府官网"},"lineHints":[{"corridorId":"ninghang","nearStations":["德清","湖州"]}]}),
  spot({"id":"nantong-langshan","name":"南通狼山","lng":120.8877,"lat":31.9499,"intro":"狼山为南通江海名山，广教禅寺依山而建，支云塔矗立江畔，是长江入海口北岸的胜景。盐通高铁列车抵南通段时，可见狼山山影映江。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":6,"dimensions":["culture","geo"],"subtype":"mountain_range","tags":["江苏","全国重点文保","4A景区","长江入海口"],"bestView":{"months":[4,5,9,10,11],"timeOfDay":"day","light":"any","note":"支云塔与山影是江畔地标","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.nantong.gov.cn/","quote":"狼山广教禅寺为全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.bigemap.net/city-6137.html","quote":"狼山 经度120.887651 纬度31.949891","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保+坐标源"},"lineHints":[{"corridorId":"yantong","nearStations":["南通","海安"]}]}),
  spot({"id":"nantong-haohe","name":"南通濠河","lng":120.8713,"lat":32.0157,"intro":"濠河为国内保存最完好的古护城河之一，环绕南通老城，游船穿行于古桥与现代楼宇之间。盐通高铁列车抵南通站前，可见濠河水带环抱古城。","visibility":"distant","source":"ai_reviewed","category":"gorge","viewScale":"near","viewMinutes":4,"dimensions":["culture","geo"],"subtype":"river","tags":["江苏","5A景区","护城河","南通古城"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"环城水带与古城相映","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://sjfw.mct.gov.cn/site/dataservice/rural?type=10","quote":"濠河风景区，AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.nantong.gov.cn/","quote":"濠河为国内保存最完好的古护城河之一","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"5A名录+政府官网"},"lineHints":[{"corridorId":"yantong","nearStations":["南通","南通西"]}]}),
  spot({"id":"rugao-shuihuiyuan","name":"如皋水绘园","lng":120.57,"lat":32.39,"intro":"水绘园为明末清初园林，董小宛与冒辟疆栖隐于此，是全国重点文保。盐通高铁列车经如皋段时，车窗可见古城园林与水巷相融的江北水乡景色。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["江苏","全国重点文保","私家园林","如皋"],"bestView":{"months":[3,4,5,9,10],"timeOfDay":"day","light":"any","note":"古城水乡人文意象需配讲解","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.rugao.gov.cn/","quote":"水绘园为全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"https://www.wikidata.org/wiki/Q11071489","quote":"水绘园（Shuihui Garden）如皋","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","checkedBy":"ai+2026-10-eastchina-batch","method":"全国重点文保+wiki"},"lineHints":[{"corridorId":"yantong","nearStations":["如皋南","海安"]}]}),
  spot({"id":"changgan-ganzhou-old-city","name":"赣州古城（宋城）","lng":114.94,"lat":25.86,"intro":"“江南宋城”“宋城博物馆”，存宋代古城墙、八境台、郁孤台、古浮桥与文庙，是全国保存较完整的宋代城墙之一，也是客家摇篮与历史文化名城。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["culture","history"],"subtype":"old_town","tags":["江西","国家历史文化名城","宋城","客家摇篮"],"bestView":{"months":[],"timeOfDay":"dusk","light":"any","note":"进赣州西站前后感受古城天际线。","blocked":["无明显遮挡"]},"sources":[{"type":"authority","level":"S","ref":"https://m.chinanews.com/wap/detail/chs/zb/2443.shtml","quote":"赣州古城墙始建于汉代，八境台、郁孤台","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"https://m.chinanews.com/wap/detail/chs/zb/2443.shtml","quote":"有着宋城博物馆美誉的赣州，客家摇篮","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"国保宋城墙+历史文化名城，多源印证。"},"lineHints":[{"corridorId":"changgan","nearStations":["赣州西"]}]}),
  spot({"id":"changgan-tongtianyan","name":"通天岩石龛","lng":114.88,"lat":25.92,"intro":"赣州西北郊的丹霞石龛群，开凿于唐代，是全国重点文保单位、江南较大的石窟摩崖，石雕造像与题刻荟萃，与古城遥相呼应，是江西古代石窟艺术的代表。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["history"],"subtype":"grotto_mural","tags":["江西","全国重点文保","石窟","摩崖"],"bestView":{"months":[],"timeOfDay":"day","light":"any","note":"进赣州前可远眺丹霞山体方向。","blocked":["地势遮挡"]},"sources":[{"type":"authority","level":"S","ref":"https://m.chinanews.com/wap/detail/chs/zb/2443.shtml","quote":"通天岩石雕宝库","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"https://m.chinanews.com/wap/detail/chs/zb/2443.shtml","quote":"赣州通天岩等名胜古迹","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"国保身份确凿（S），坐标为赣州西北郊近似值。"},"lineHints":[{"corridorId":"changgan","nearStations":["赣州西"]}]}),
  spot({"id":"fuping-sanfang-qixiang","name":"福州三坊七巷","lng":119.293,"lat":26.085,"intro":"福州城的明清古坊巷历史街区，全国重点文保与5A景区，坊巷纵横、名人故居林立，是“里坊制度的活化石”，福平铁路自福州站引出，出站即入古城。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["福建","全国重点文保","5A景区","古坊巷"],"bestView":{"months":[],"timeOfDay":"dusk","light":"any","note":"进福州站前后可感受古城门坊风貌。","blocked":["无明显遮挡"]},"sources":[{"type":"authority","level":"S","ref":"http://fz.fjsen.com/wap/2020-12/29/content_30593110.htm","quote":"三坊七巷的林则徐故居","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://fz.fjsen.com/wap/2020-12/29/content_30593110.htm","quote":"三坊七巷的林则徐故居","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"三坊七巷为5A/国保（S），坐标为福州鼓楼区近似值。"},"lineHints":[{"corridorId":"fuping","nearStations":["福州","福州南"]}]}),
  spot({"id":"fuxia-quanzhou-bay-bridge","name":"泉州湾跨海大桥","lng":118.705,"lat":24.831,"intro":"中国首座跨海高速铁路桥，主跨400米斜拉桥横卧泉州湾，与公路大桥并立，列车以350公里时速贴海飞驰，98秒跨越8.96公里海域，被誉为“坐着高铁看大海”的核心景观。","visibility":"on_track","source":"ai_reviewed","category":"engineering","viewScale":"mid","viewMinutes":2,"dimensions":["construct"],"subtype":"bridge","tags":["福建","跨海大桥","大国工程","泉州湾"],"bestView":{"months":[4,5,6,7,8,9,10],"timeOfDay":"dawn","light":"front","note":"主塔与斜拉索、海面养殖浮漂同框；台风季浪高风大更有气势。","blocked":["浓雾与强风天气视野受限"]},"sources":[{"type":"news","level":"B","ref":"http://www.news.cn/2023-09/01/c_1129840420.htm","quote":"列车风驰电掣跨越泉州湾，8.96公里只用时98秒","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.msa.gov.cn/public/documents/document/mdc1/nzax/~edisp/20230619075701510.pdf","quote":"新建福厦铁路泉州湾跨海大桥位于晋江市与石狮市交界处，主桥采用钢-混结合斜拉桥","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://paper.people.com.cn/hwbwap/html/2024-01/19/content_26038004.htm","quote":"泉州湾跨海大桥是中国首座跨海高速铁路桥","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"坐标取自海事局通航要素通告（CGCS2000≈WGS84），存在官方坐标源，新华社/人民日报多源交叉印证。"},"lineHints":[{"corridorId":"fuxia","nearStations":["泉州东","泉州南"]}]}),
  spot({"id":"fuxia-qingyuan-mountain","name":"清源山","lng":118.611,"lat":24.943,"intro":"泉州城北的国家重点风景名胜区与5A景区，花岗岩峰峦与古城相依，老君岩为现存最早最大道教老子石像，福厦高铁选线绕行其北侧，车上可远眺“闽海蓬莱第一山”。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":4,"dimensions":["geo","culture"],"subtype":"mountain_range","tags":["福建","5A景区","道教名山","泉州"],"bestView":{"months":[3,4,5,6,7,8,9,10,11],"timeOfDay":"day","light":"front","note":"过泉州段靠西北窗可望清源山鼎峙山形与老君岩方位。","blocked":["多云低云时山体被雾遮"]},"sources":[{"type":"authority","level":"S","ref":"https://www.peopleweekly.cn/html/2020/guojiagongyuan_0602/32149.html","quote":"清源山风景名胜区1988年经国务院审定公布为第二批国家级风景名胜区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://sthjj.quanzhou.gov.cn/hjgl/hbsp/hpslqkgk/201904/P020200318627349821260.pdf","quote":"清源山地理坐标东经118°30'43″至118°38'51″，北纬24°54'23″至25°01'21″","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"既有S名录又有政府环评坐标，坐标可靠；福厦铁路绕行清源山北侧见公开报道。"},"lineHints":[{"corridorId":"fuxia","nearStations":["泉州东","泉州南"]}]}),
  spot({"id":"fuxia-kaiyuan-temple","name":"泉州开元寺","lng":118.586,"lat":24.914,"intro":"坐拥“泉州：宋元中国的世界海洋商贸中心”世界遗产点，东西双塔为千年石塔地标，是海丝起点泉州古城的核心，也是宋元东方第一大港宗教并存的见证。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["culture","history"],"subtype":"temple_religion","tags":["福建","世界遗产","海丝","泉州古城"],"bestView":{"months":[],"timeOfDay":"dusk","light":"any","note":"进站前后近距离感受古城；双塔在城区天际线中具识别度。","blocked":["高楼遮挡局部视线"]},"sources":[{"type":"authority","level":"S","ref":"https://m.baike.com/wiki/%E5%BC%80%E5%85%83%E5%AF%BA","quote":"开元寺为全国重点文物保护单位，泉州宋元中国的世界海洋商贸中心遗产点","checkedAt":"2026-10-01"},{"type":"osm","level":"C","ref":"https://www.poilist.cn/poi-list-%E6%99%AF%E7%82%B9-%E6%B3%89%E5%B7%9E/","quote":"开元寺 泉州市鲤城区 118.585518,24.914185","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"世界遗产与国保身份确凿（S），坐标为POI数据佐证（C），达到probable标准。"},"lineHints":[{"corridorId":"fuxia","nearStations":["泉州东"]}]}),
  spot({"id":"fuxia-luoyang-bridge","name":"洛阳桥（万安桥）","lng":118.655,"lat":24.95,"intro":"中国现存最早的跨海梁式石桥，北宋蔡襄主持修建，首创“筏形基础”与“种蛎固基”，与赵州桥、广济桥、卢沟桥并称四大古桥，是全国重点文保与海丝遗产点。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["history"],"subtype":"ancient_road","tags":["福建","全国重点文保","古桥","海丝"],"bestView":{"months":[],"timeOfDay":"day","light":"any","note":"桥体横跨洛阳江入海口，退潮时可见筏形桥墩与白鹭。","blocked":["涨潮淹没部分桥墩"]},"sources":[{"type":"authority","level":"S","ref":"https://m.baike.com/wiki/%E6%B4%9B%E9%98%B3%E6%A1%A5","quote":"洛阳桥是中国现存最早的跨海石梁桥，全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"authority","level":"B","ref":"https://www.qvtu.edu.cn/sctp/info/1002/1767.htm","quote":"泉州十八景，清源山、洛阳桥等历史胜迹","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"国保身份确凿；坐标为实地位置近似值，未见独立官方坐标源，列probable。"},"lineHints":[{"corridorId":"fuxia","nearStations":["泉州东"]}]}),
  spot({"id":"fuxia-anping-bridge","name":"安平桥（五里桥）","lng":118.483,"lat":24.708,"intro":"横跨晋江安海与南安水头的宋代长桥，全长约2255米，是中古时代世界最长梁式石桥，号“天下无桥长此桥”，全国重点文保，福厦高铁由晋江南侧穿行可望其方位。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":2,"dimensions":["history"],"subtype":"ancient_road","tags":["福建","全国重点文保","古桥","晋江"],"bestView":{"months":[],"timeOfDay":"day","light":"front","note":"列车经晋江安海一带可远眺长桥一带水乡景象。","blocked":["沿线建筑遮挡"]},"sources":[{"type":"authority","level":"S","ref":"https://m.baike.com/wiki/%E5%AE%89%E5%B9%B3%E6%A1%A5","quote":"安平桥又称五里桥，全国重点文物保护单位，世界最长梁式石桥","checkedAt":"2026-10-01"},{"type":"authority","level":"B","ref":"https://sthjj.quanzhou.gov.cn/hjgl/hbsp/hpslqkgk/201904/P020200318627349821260.pdf","quote":"泉州晋江下游全国重点文物保护单位等历史胜迹","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"国保身份确凿；坐标为近似位置，列probable。"},"lineHints":[{"corridorId":"fuxia","nearStations":["泉州南"]}]}),
  spot({"id":"fuxia-mulanbei","name":"木兰陂","lng":118.961,"lat":25.457,"intro":"莆田木兰溪上的北宋大型水利工程，我国现存最完整的古代大型水利灌溉工程之一，世界灌溉工程遗产与全国重点文保，福厦高铁木兰溪特大桥跨越其下游，车上可望古代陂堰。","visibility":"distant","source":"ai_reviewed","category":"engineering","viewScale":"mid","viewMinutes":3,"dimensions":["construct","history"],"subtype":"water_conservancy","tags":["福建","世界灌溉工程遗产","全国重点文保","木兰溪"],"bestView":{"months":[],"timeOfDay":"dawn","light":"front","note":"跨木兰溪时可见河道与古陂一带水网。","blocked":["雨季河水浑浊"]},"sources":[{"type":"authority","level":"S","ref":"https://m.baike.com/wiki/%E6%9C%A8%E5%85%B0%E9%99%82","quote":"木兰陂为全国重点文物保护单位、世界灌溉工程遗产","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"https://m.baike.com/wiki/%E7%A6%8F%E5%8E%A6%E9%AB%98%E9%80%9F%E9%93%81%E8%B7%AF","quote":"木兰溪特大桥位于莆田市木兰溪河畔，福厦高铁全线重难点控制性工程","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"S级身份确凿；坐标为木兰溪莆田段近似值。"},"lineHints":[{"corridorId":"fuxia","nearStations":["莆田"]}]}),
  spot({"id":"fuxia-meizhou-island","name":"湄洲岛（妈祖祖庙）","lng":119.121,"lat":25.073,"intro":"妈祖文化发祥地，岛上妈祖祖庙为全球妈祖信众朝圣祖庭，湄洲岛国家旅游度假区隔湄洲湾与大陆相望，列车过湄洲湾跨海大桥时向西可望海岛与祖庙建筑群。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["culture"],"subtype":"temple_religion","tags":["福建","妈祖","海岛","非遗"],"bestView":{"months":[4,5,6,7,8,9,10],"timeOfDay":"dusk","light":"any","note":"南行过湄洲湾时靠西窗望海岛轮廓与白色庙宇。","blocked":["海雾天气看不清"]},"sources":[{"type":"authority","level":"S","ref":"https://m.gmw.cn/2023-09/27/content_1303526262.htm","quote":"湄洲湾跨海大桥，一望无际蔚蓝大海，海鸥从海面飞过","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://jtyst.fujian.gov.cn/zwgk/jtyw/mtsy/202606/t20260603_7155755.htm","quote":"湄洲湾，海水如蓝色琥珀镶嵌在大桥臂弯中","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"妈祖祖庙为信俗祖庭、湄洲岛为国家级度假区，坐标为海岛近似值。"},"lineHints":[{"corridorId":"fuxia","nearStations":["莆田"]}]}),
  spot({"id":"ganshen-nanwudang","name":"南武当山（小武当）","lng":114.718,"lat":24.616,"intro":"龙南武当镇的丹霞峰林群，九十九座奇峰平地突起、沿105国道绵延，国家级风景名胜区与4A景区，与九连山相依，是赣南丹霞地貌的代表景观。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":5,"dimensions":["geo"],"subtype":"karst_danxia","tags":["江西","丹霞","国家级风景名胜区","龙南"],"bestView":{"months":[],"timeOfDay":"day","light":"any","note":"丹霞峰林与田园交错的标志性山景。","blocked":["阴雨"]},"sources":[{"type":"authority","level":"S","ref":"https://www.jxln.gov.cn/lnzf/c103680/202301/454db4479e1d41cb906b5da171d1616f.shtml","quote":"国家级风景名胜区南武当山","checkedAt":"2026-10-01"},{"type":"osm","level":"C","ref":"https://map.gaode.com/place/B031D02DDF","quote":"南武当山 赣州市龙南市武当镇 24.614572,114.723202","checkedAt":"2026-10-01"},{"type":"osm","level":"C","ref":"http://www.bigemap.net/city-17462.html","quote":"小武当风景区 114.718337,24.61577","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"国家级风景名胜区（S）+高德/Bigemap坐标（C）印证，坐标可靠。"},"lineHints":[{"corridorId":"ganshen","nearStations":["龙南东"]}]}),
  spot({"id":"ganshen-wanlvhu","name":"万绿湖（新丰江水库）","lng":114.63,"lat":23.78,"intro":"华南地区最大的淡水人工湖，因四季皆绿得名“万绿湖”，湖岛点缀、水质清冽，是新丰江水电站的库区，河源市的城市会客厅，赣深高铁经河源可见其湖山一隅。","visibility":"distant","source":"ai_reviewed","category":"lake","viewScale":"mid","viewMinutes":4,"dimensions":["geo"],"subtype":"lake","tags":["江西","湖泊","万绿湖","河源"],"bestView":{"months":[],"timeOfDay":"day","light":"front","note":"远眺万绿湖湖岛与青山。","blocked":["地势遮挡"]},"sources":[{"type":"authority","level":"B","ref":"http://wap.china-railway.com.cn/xwzx/zhxw/202112/t20211211_118785.html","quote":"途经岭南第一大湖河源万绿湖等自然景观","checkedAt":"2026-10-01"},{"type":"authority","level":"S","ref":"http://wap.china-railway.com.cn/xwzx/zhxw/202112/t20211211_118785.html","quote":"万绿湖自然保护区","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"国铁集团确认途经万绿湖，坐标为水库中心近似值。"},"lineHints":[{"corridorId":"ganshen","nearStations":["河源北"]}]}),
  spot({"id":"longxia-meihua-mountain","name":"梅花山自然保护区","lng":116.85,"lat":25.35,"intro":"龙岩境内森林茂密的自然保护区，红豆杉等珍稀物种栖息地，闽西“绿色宝库”，龙厦铁路自龙岩出站即入山间，窗外青山连绵，是闽西生态屏障。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":6,"dimensions":["nature","geo"],"subtype":"forest","tags":["福建","自然保护区","红豆杉","龙岩"],"bestView":{"months":[4,5,6,7,8,9,10,11],"timeOfDay":"dawn","light":"any","note":"龙岩段连绵青山与山谷。","blocked":["阴雨云雾"]},"sources":[{"type":"authority","level":"A","ref":"https://sthjj.quanzhou.gov.cn/hjgl/hbsp/hpslqkgk/201904/P020200318627349821260.pdf","quote":"梅花山，九龙江北溪上游山地","checkedAt":"2026-10-01"},{"type":"authority","level":"C","ref":"https://www.sm.gov.cn/smsrmzfbgs/smsrmzf/zfxxgkml_2/ghjh/201611/t20161117_510858.htm","quote":"4个国家自然保护区","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"梅花山为闽西知名自然保护区，坐标为龙岩西北部近似值，佐证较弱。"},"lineHints":[{"corridorId":"longxia","nearStations":["龙岩"]}]}),
  spot({"id":"longxia-jiulongjiang","name":"九龙江（雁石溪）","lng":117.5,"lat":24.9,"intro":"闽南最大河流九龙江的上游支流，自龙岩南流经漳州平原入海，龙厦铁路顺江而下，雁石溪一带峡谷与石滩相映，是闽西进入闽南的地貌分界。","visibility":"distant","source":"ai_reviewed","category":"gorge","viewScale":"mid","viewMinutes":4,"dimensions":["geo"],"subtype":"river","tags":["福建","河流","九龙江","龙岩"],"bestView":{"months":[],"timeOfDay":"dawn","light":"front","note":"沿溪段看溪谷与梯田。","blocked":["无明显遮挡"]},"sources":[{"type":"wiki","level":"C","ref":"https://sztrans.fandom.com/wiki/%E5%8E%A6%E6%B7%B1%E9%93%81%E8%B7%AF","quote":"九龙江大桥合龙","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://sthjj.quanzhou.gov.cn/hjgl/hbsp/hpslqkgk/201904/P020200318627349821260.pdf","quote":"九龙江北溪上游山地","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"九龙江为闽南主水系，坐标为龙岩南段近似值。"},"lineHints":[{"corridorId":"longxia","nearStations":["龙岩","南靖"]}]}),
  spot({"id":"nanlong-minjiang","name":"闽江（南平）","lng":118.17,"lat":26.64,"intro":"福建最大河流闽江，南平为闽江干流交汇之城，山城江景交融，南龙铁路自南平引出即沿江而行，是闽北山水门户的经典写照。","visibility":"on_track","source":"ai_reviewed","category":"gorge","viewScale":"mid","viewMinutes":4,"dimensions":["geo"],"subtype":"river","tags":["福建","河流","闽江","南平"],"bestView":{"months":[],"timeOfDay":"dawn","light":"any","note":"沿江看山城与江水相映。","blocked":["雨雾"]},"sources":[{"type":"authority","level":"A","ref":"https://jtyst.fujian.gov.cn/zwgk/tzgg/202005/t20200502_5258653.htm","quote":"闽江水系","checkedAt":"2026-10-01"},{"type":"authority","level":"C","ref":"https://www.sm.gov.cn/smsrmzfbgs/smsrmzf/zfxxgkml_2/ghjh/201611/t20161117_510858.htm","quote":"闽江源头沙溪","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"闽江为福建第一大河属常识地理，坐标为南平段近似值。"},"lineHints":[{"corridorId":"nanlong","nearStations":["南平"]}]}),
  spot({"id":"nanlong-shaxi","name":"沙溪（三明）","lng":117.63,"lat":26.25,"intro":"三明主城依沙溪而建，溪水穿城、绿岸相映，三明是闽中工业城与生态城结合的典型，南龙铁路进三明段，可观溪谷与城市山水共生的景象。","visibility":"on_track","source":"ai_reviewed","category":"gorge","viewScale":"mid","viewMinutes":4,"dimensions":["geo"],"subtype":"river","tags":["福建","河流","沙溪","三明"],"bestView":{"months":[],"timeOfDay":"dusk","light":"any","note":"进城前看沙溪与两岸。","blocked":["无明显遮挡"]},"sources":[{"type":"authority","level":"A","ref":"https://www.sm.gov.cn/smsrmzfbgs/smsrmzf/zfxxgkml_2/ghjh/201611/t20161117_510858.htm","quote":"沙县、三明，沙溪，深呼吸慢生活大健康","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.sm.gov.cn/smsrmzfbgs/smsrmzf/zfxxgkml_2/ghjh/201611/t20161117_510858.htm","quote":"闽江源头水资源","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"市政府资料（A）印证沙溪，坐标为三明市区近似值。"},"lineHints":[{"corridorId":"nanlong","nearStations":["三明"]}]}),
  spot({"id":"nanlong-geshikao","name":"三明格氏栲天然林","lng":117.55,"lat":26.12,"intro":"世界罕见的格氏栲天然纯林所在地，三明莘口镇的国家森林公园，板根古树参天、林海苍翠，是“绿都三明”的生态名片，南龙铁路经三明段可望连绵山林。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["nature","geo"],"subtype":"forest","tags":["福建","国家森林公园","格氏栲","三明"],"bestView":{"months":[4,5,6,7,8,9,10,11],"timeOfDay":"dawn","light":"any","note":"远眺亚热带常绿阔叶林山体。","blocked":["雨雾"]},"sources":[{"type":"authority","level":"S","ref":"https://www.sm.gov.cn/smsrmzfbgs/smsrmzf/zfxxgkml_2/ghjh/201611/t20161117_510858.htm","quote":"格氏栲天然林等生态资源","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.sm.gov.cn/smsrmzfbgs/smsrmzf/zfxxgkml_2/ghjh/201611/t20161117_510858.htm","quote":"三明格氏栲天然林是国家森林公园","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"国家森林公园（S）身份，坐标为三明莘口镇近似值。"},"lineHints":[{"corridorId":"nanlong","nearStations":["三明"]}]}),
  spot({"id":"wenfu-taimu-mountain","name":"太姥山","lng":120.25,"lat":27.087,"intro":"东海之滨的国家地质公园与国家级风景名胜区，以“峰险石奇洞幽雾幻”四绝著称，素称“海上仙都”，温福铁路设太姥山站，山海相依的峰林是闽浙交界标志。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":5,"dimensions":["geo"],"subtype":"mountain_range","tags":["福建","国家地质公园","海上仙都","福鼎"],"bestView":{"months":[4,5,6,7,8,9,10,11],"timeOfDay":"dawn","light":"any","note":"经太姥山站前后可远眺花岗岩峰林与云海。","blocked":["阴雨云雾"]},"sources":[{"type":"authority","level":"S","ref":"https://wlj.ningde.gov.cn/ztzl/ndwl/","quote":"太姥山是国家地质公园，以花岗岩峰林岩洞为特色，称海上仙都","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://wlj.ningde.gov.cn/ztzl/ndwl/","quote":"太姥山北望雁荡西眺武夷，山海大观称奇","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"国家地质公园（S）+市文旅局（A）双重印证。"},"lineHints":[{"corridorId":"wenfu","nearStations":["太姥山","霞浦"]}]}),
  spot({"id":"wenfu-xiapu-tidal-flat","name":"霞浦滩涂（北岐）","lng":120.01,"lat":26.865,"intro":"被誉为“世界最美滩涂”的摄影圣地，潮汐与紫菜架、渔排、竹竿构成光影画卷，北岐日出与东壁日落闻名，列车过霞浦沿海可望绵延滩涂。","visibility":"distant","source":"ai_reviewed","category":"gorge","viewScale":"mid","viewMinutes":6,"dimensions":["nature"],"subtype":"water_feature","tags":["福建","滩涂","摄影","霞浦"],"bestView":{"months":[4,5,6,7,8,9,10],"timeOfDay":"dawn","light":"any","note":"靠海侧窗，海面如镜映天，渔舟剪影。","blocked":["阴天光影平淡"]},"sources":[{"type":"authority","level":"A","ref":"https://wlj.ningde.gov.cn/ztzl/ndwl/","quote":"霞浦滩涂为摄影天堂、海上田园","checkedAt":"2026-10-01"},{"type":"ugc","level":"C","ref":"https://m.ctrip.com/webapp/you/gonglve/1091/","quote":"北岐日出、东壁日落，光影魔术手","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"文旅局资料（A）+多方佐证，坐标为霞浦北岐段近似值。"},"lineHints":[{"corridorId":"wenfu","nearStations":["霞浦"]}]}),
  spot({"id":"wenfu-sanduao","name":"三都澳","lng":119.7,"lat":26.71,"intro":"宁德“海上天湖”“神仙港湾”，港阔水深、岛屿礁石星罗棋布，斗姆岛海蚀景观奇特，海上渔排连片，是闽东山海相拥的经典湾区，温福铁路沿海岸线穿行可望。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["geo"],"subtype":"coast_island","tags":["福建","港湾","渔排","宁德"],"bestView":{"months":[4,5,6,7,8,9,10,11],"timeOfDay":"day","light":"front","note":"靠海侧看岛屿与渔排海上牧场。","blocked":["海雾"]},"sources":[{"type":"authority","level":"A","ref":"https://wlj.ningde.gov.cn/ztzl/ndwl/","quote":"三都澳斗姆风景区，海上天湖、神仙港湾，官井洋东吾洋壮阔海疆","checkedAt":"2026-10-01"},{"type":"authority","level":"S","ref":"https://wlj.ningde.gov.cn/ztzl/ndwl/","quote":"蕉城三都澳斗姆景区为国家3A级景区，扼守三都澳咽喉","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"市文旅局（A）+3A景区（S）双重印证。"},"lineHints":[{"corridorId":"wenfu","nearStations":["宁德"]}]}),
  spot({"id":"wenfu-yushan-island","name":"嵛山岛","lng":120.33,"lat":26.95,"intro":"中国十大最美海岛之一，草甸天湖与大海相接，被誉为“南国天山”，与太姥山、晴川海滨相望，列车于霞浦至太姥山段海岸可远眺这座海天草甸奇岛。","visibility":"distant","source":"ai_reviewed","category":"gorge","viewScale":"mid","viewMinutes":4,"dimensions":["nature"],"subtype":"water_feature","tags":["福建","海岛","草甸天湖","福鼎"],"bestView":{"months":[5,6,7,8,9],"timeOfDay":"day","light":"front","note":"海面清晰可见岛上山形与草甸。","blocked":["海雾/逆光"]},"sources":[{"type":"authority","level":"S","ref":"https://wlj.ningde.gov.cn/ztzl/ndwl/","quote":"嵛山岛被评为中国十大最美海岛之一","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://wlj.ningde.gov.cn/ztzl/ndwl/","quote":"福瑶列岛嵛山岛，山、海、湖、草相映","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"最美海岛名录（S）+市文旅局（A）印证。"},"lineHints":[{"corridorId":"wenfu","nearStations":["霞浦","太姥山"]}]}),
  spot({"id":"wenfu-luoyuan-bay","name":"罗源湾","lng":119.65,"lat":26.46,"intro":"福州北部的天然良湾，围垦湿地与连片滨海养殖共存，水禽翔集，温福铁路临湾穿行，可望海湾开阔水色与渔排，是进入福州前的滨海湿地景观。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["geo"],"subtype":"coast_island","tags":["福建","海湾","湿地","罗源"],"bestView":{"months":[],"timeOfDay":"dawn","light":"any","note":"靠海侧窗外观海湾与养殖区。","blocked":["无明显遮挡"]},"sources":[{"type":"authority","level":"A","ref":"https://jtyst.fujian.gov.cn/zwgk/tzgg/202005/t20200502_5258653.htm","quote":"罗源湾属沿海地区","checkedAt":"2026-10-01"},{"type":"authority","level":"C","ref":"https://wlj.ningde.gov.cn/ztzl/ndwl/","quote":"官井洋、东吾洋壮阔海疆","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"海湾为自然地理，坐标为罗源湾近似值，佐证较单一。"},"lineHints":[{"corridorId":"wenfu","nearStations":["罗源"]}]}),
  spot({"id":"xiangpu-dajinhu","name":"泰宁大金湖","lng":117.102,"lat":26.865,"intro":"世界自然遗产“中国丹霞·泰宁”与泰宁世界地质公园核心，水上丹霞、峡谷群落、洞穴奇观“三绝”，被誉为“天下第一湖山”，向莆铁路设泰宁站直达，是沿途顶级景观。","visibility":"window","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":8,"dimensions":["geo","nature"],"subtype":"karst_danxia","tags":["福建","世界自然遗产","5A景区","丹霞"],"bestView":{"months":[4,5,6,7,8,9,10],"timeOfDay":"dawn","light":"any","note":"近泰宁站可望丹霞赤壁与碧水相映。","blocked":["阴雨"]},"sources":[{"type":"authority","level":"S","ref":"http://www.fjtn.gov.cn/mltn/tnxq/201512/t20151217_772974.htm","quote":"2010年中国丹霞·福建泰宁正式列入世界遗产名录，国家5A级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.fjtn.gov.cn/mltn/tnxq/201512/t20151217_772974.htm","quote":"大金湖水为山舞、山为水屹，天下第一湖山","checkedAt":"2026-10-01"},{"type":"osm","level":"C","ref":"http://www.bigemap.net/city-64607.html","quote":"大金湖 117.102191,26.864990","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"世界自然遗产（S）+县政府（A）+坐标（C），三重印证，坐标可靠。"},"lineHints":[{"corridorId":"xiangpu","nearStations":["泰宁"]}]}),
  spot({"id":"xiangpu-ganlusi","name":"甘露岩寺","lng":117.15,"lat":26.83,"intro":"大金湖畔的千年古刹，建于天然洞穴中，整寺仅以一根木柱支撑数重楼阁，号称“一柱插地、不假片瓦”的南方悬空寺，是全国重点文保，也是闽西北建筑奇观。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["architecture","culture"],"subtype":"historic_building","tags":["福建","全国重点文保","悬空寺","泰宁"],"bestView":{"months":[],"timeOfDay":"day","light":"any","note":"丹崖洞穴与红墙寺庙交叠。","blocked":["林间遮挡"]},"sources":[{"type":"authority","level":"S","ref":"https://m.fznews.com.cn/fz/2013-9-25/2013925ql7wk9qCih144333.shtml","quote":"宋绍兴16年于洞中建甘露寺，一柱插地，不假片瓦","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"https://m.fznews.com.cn/fz/2013-9-25/2013925ql7wk9qCih144333.shtml","quote":"甘露岩寺被誉为南方悬空寺","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"国保身份（S）确凿，坐标为金湖区域近似值。"},"lineHints":[{"corridorId":"xiangpu","nearStations":["泰宁"]}]}),
  spot({"id":"xiangpu-shaxian","name":"沙县（小吃之乡）","lng":117.79,"lat":26.4,"intro":"“沙县小吃”发源地，向莆铁路与三明门户交汇于此，沙溪绕城、马岩山青翠，是闽中“深呼吸”慢生活小城，地方小吃文化闻名全国。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["culture"],"subtype":"folk_custom","tags":["福建","沙县小吃","闽中","美食"],"bestView":{"months":[],"timeOfDay":"any","light":"any","note":"进三明北站前后见沙溪与县城。","blocked":["无明显遮挡"]},"sources":[{"type":"authority","level":"A","ref":"https://www.sm.gov.cn/smsrmzfbgs/smsrmzf/zfxxgkml_2/ghjh/201611/t20161117_510858.htm","quote":"沙县深呼吸、慢生活、大健康","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.sm.gov.cn/smsrmzfbgs/smsrmzf/zfxxgkml_2/ghjh/201611/t20161117_510858.htm","quote":"向莆铁路东西向横贯，沙县机场","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"市政府资料（A）印证沙县区位与小吃文化。"},"lineHints":[{"corridorId":"xiangpu","nearStations":["三明北"]}]}),
  spot({"id":"xiangpu-youxi","name":"尤溪（朱子故里）","lng":118.19,"lat":26.17,"intro":"南宋理学家朱熹诞生地，闽学发祥地之一，桂峰古民居、联合梯田保存完好，闽湖碧水环山，向莆铁路设尤溪站，串起闽中人文与梯田田园之美。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["culture"],"subtype":"pastoral_life","tags":["福建","朱子文化","梯田","尤溪"],"bestView":{"months":[4,5,6,7,8,9,10],"timeOfDay":"dawn","light":"any","note":"近尤溪站看山间梯田与古民居。","blocked":["云雾"]},"sources":[{"type":"authority","level":"A","ref":"https://www.sm.gov.cn/smsrmzfbgs/smsrmzf/zfxxgkml_2/ghjh/201611/t20161117_510858.htm","quote":"尤溪朱熹、杨时、罗从彦等闽学鼻祖人文资源，联合梯田","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.sm.gov.cn/smsrmzfbgs/smsrmzf/zfxxgkml_2/ghjh/201611/t20161117_510858.htm","quote":"尤溪朱子文化公园、桂峰古民居、联合梯田","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"市政府资料（A）印证朱子文化与梯田资源。"},"lineHints":[{"corridorId":"xiangpu","nearStations":["尤溪"]}]}),
  spot({"id":"xiangpu-yongtai-qingyunshan","name":"永泰青云山","lng":118.97,"lat":25.77,"intro":"福州后花园永泰的国家4A级景区，峡谷瀑布、温泉与岩洞兼具，青云山水绕城，向莆铁路接永泰站，串起省会福州西向的生态山水门户。","visibility":"window","source":"ai_reviewed","category":"gorge","viewScale":"mid","viewMinutes":4,"dimensions":["nature"],"subtype":"water_feature","tags":["福建","4A景区","瀑布温泉","永泰"],"bestView":{"months":[5,6,7,8,9,10],"timeOfDay":"day","light":"front","note":"看峡谷瀑布与群山。","blocked":["雨季路况"]},"sources":[{"type":"news","level":"B","ref":"https://m.fznews.com.cn/fz/2013-9-25/2013925ql7wk9qCih144333.shtml","quote":"向莆铁路被誉为最美高铁","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://m.fznews.com.cn/fz/2013-9-25/2013925ql7wk9qCih144333.shtml","quote":"永泰生态山水","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"4A景区身份，坐标为永泰段近似值，列probable。"},"lineHints":[{"corridorId":"xiangpu","nearStations":["永泰"]}]}),
  spot({"id":"xiashen-guangji-bridge","name":"潮州广济桥（湘子桥）","lng":116.644,"lat":23.665,"intro":"中国四大古桥之一、世界最早启闭式桥梁，横跨韩江，由东西石梁桥与中间十八梭船浮桥组合，全国重点文保、国家4A景区，是粤东门户潮州的地标。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["history","architecture"],"subtype":"ancient_road","tags":["广东","全国重点文保","古桥","潮州"],"bestView":{"months":[],"timeOfDay":"dusk","light":"any","note":"湘桥春涨为潮州八景；列车过韩江大桥时可见古桥横江。","blocked":["白天浮桥合拢时段"]},"sources":[{"type":"authority","level":"S","ref":"https://www.chaozhou.gov.cn/ywdt/czyw/content/mpost_3693309.html","quote":"广济桥是世界最早启闭式桥梁、中国四大古桥之一，湘桥春涨是潮州八景之一","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.chaozhou.gov.cn/ywdt/czyw/content/mpost_3693309.html","quote":"1986年国务院批准潮州市为国家历史文化名城","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://sz.people.com.cn/GB/203418/358575/","quote":"潮州：相约广济桥走进潮人里","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"国保身份+市政府官网双重印证，坐标为古城东门外韩江段位置。"},"lineHints":[{"corridorId":"xiashen","nearStations":["潮汕"]}]}),
  spot({"id":"xiashen-chaozhou-old-city","name":"潮州古城","lng":116.64,"lat":23.666,"intro":"国家历史文化名城，始建于东晋，古城面积约3平方公里，牌坊街、开元寺、韩文公祠等明清建筑群保存完整，潮州菜与工夫茶闻名，是厦深铁路粤东段最重要的文化门户。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["culture","history"],"subtype":"old_town","tags":["广东","国家历史文化名城","牌坊街","工夫茶"],"bestView":{"months":[],"timeOfDay":"any","light":"any","note":"进潮汕站前后可感受古城天际线与牌坊街方向。","blocked":["无明显遮挡"]},"sources":[{"type":"authority","level":"S","ref":"https://www.chaozhou.gov.cn/ywdt/czyw/content/mpost_3693309.html","quote":"1986年国务院批准潮州市为国家历史文化名城","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.chaozhou.gov.cn/ywdt/czyw/content/mpost_3693309.html","quote":"潮州素有海滨邹鲁、岭海名邦之称，自古便是海上丝绸之路重要节点","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"国家历史文化名城+市政府官网印证。"},"lineHints":[{"corridorId":"xiashen","nearStations":["潮汕"]}]}),
  spot({"id":"xiashen-han-river","name":"韩江","lng":116.66,"lat":23.66,"intro":"粤东母亲河，因韩愈而名，江面开阔、两岸古城与笔架山相映，厦深铁路跨越韩江，车窗外可见江水汤汤与古桥、韩祠山色，是潮汕平原的标志性水系景观。","visibility":"distant","source":"ai_reviewed","category":"gorge","viewScale":"mid","viewMinutes":2,"dimensions":["geo"],"subtype":"river","tags":["广东","河流","潮州","韩江"],"bestView":{"months":[],"timeOfDay":"dawn","light":"any","note":"跨江时左右皆水宽景，夕阳下波光粼粼。","blocked":["无明显遮挡"]},"sources":[{"type":"authority","level":"A","ref":"https://www.chaozhou.gov.cn/ywdt/czyw/content/mpost_3693309.html","quote":"1989年韩江大桥建成通车，韩江潮州供水枢纽","checkedAt":"2026-10-01"},{"type":"ugc","level":"C","ref":"https://www.guang.com/youji/chaozhou","quote":"远眺韩江，可看到江面上横亘着一座古桥——广济桥","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"韩江为著名水系，政府资料佐证；坐标为潮州段近似值。"},"lineHints":[{"corridorId":"xiashen","nearStations":["潮汕","潮阳"]}]}),
  spot({"id":"xiashen-dongshan-island","name":"东山岛（风动石）","lng":117.537,"lat":23.735,"intro":"福建第二大岛，铜山古城雄踞海滨，风动石被誉为“天下第一奇石”，配关帝庙、马銮湾等海滨胜景，厦深铁路经云霄站远眺东山湾与海岛，是闽南经典海岸风光。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["geo"],"subtype":"coast_island","tags":["福建","海岛","风动石","东山湾"],"bestView":{"months":[4,5,6,7,8,9,10],"timeOfDay":"dusk","light":"any","note":"云霄至诏安段靠海侧远眺东山岛轮廓。","blocked":["海雾"]},"sources":[{"type":"authority","level":"S","ref":"https://you.ctrip.com/sight/dongshan2662/140554-dianping175538550.html","quote":"东山风动石为国家级4A景区，被誉为天下第一奇石","checkedAt":"2026-10-01"},{"type":"osm","level":"C","ref":"https://ditu.amap.com/place/B02540QOMC","quote":"风动石景区 漳州市东山县 23.734160,117.537686","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"4A景区（S）+高德官方坐标（C）印证，坐标可靠。"},"lineHints":[{"corridorId":"xiashen","nearStations":["云霄","诏安"]}]}),
  spot({"id":"xiashen-shantou-inner-bay","name":"汕头内海湾","lng":116.682,"lat":23.354,"intro":"韩江、榕江、练江三江汇流入海形成的内海湾，礐石与妈屿岛隔海相望，山海城相拥，是经济特区汕头的城市景观核心，厦深铁路经汕头方向可远眺港湾。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["geo"],"subtype":"coast_island","tags":["广东","海湾","汕头","礐石"],"bestView":{"months":[],"timeOfDay":"dusk","light":"any","note":"内海湾两岸灯火与海岛轮廓。","blocked":["无明显遮挡"]},"sources":[{"type":"news","level":"A","ref":"https://www.chaozhou.gov.cn/ywdt/czyw/content/mpost_3693309.html","quote":"汕头：古刹迎客 小吃飘香","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://sz.people.com.cn/GB/203418/358575/","quote":"汕头：古刹迎客 小吃飘香","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"汕头内海湾为城市地标自然地理，官方媒体佐证，坐标为汕头城区近似值。"},"lineHints":[{"corridorId":"xiashen","nearStations":["汕头","潮阳"]}]}),
  spot({"id":"yingxia-longhushan","name":"龙虎山","lng":117,"lat":28.08,"intro":"中国丹霞·龙虎山世界自然遗产与5A景区，道教祖庭、丹霞崖墓与泸溪碧水交融，鹰厦铁路始发鹰潭市近在咫尺，是这条老牌铁路北端的世界级山水名片。","visibility":"on_track","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":5,"dimensions":["geo","culture"],"subtype":"karst_danxia","tags":["江西","世界自然遗产","5A景区","丹霞"],"bestView":{"months":[4,5,6,7,8,9,10],"timeOfDay":"dawn","light":"any","note":"自鹰潭远眺丹霞峰林与泸溪。","blocked":["阴雨"]},"sources":[{"type":"authority","level":"S","ref":"https://m.baike.com/wiki/%E9%BE%99%E8%99%8E%E5%B1%B1","quote":"龙虎山为国家5A级旅游景区、中国丹霞世界自然遗产","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://m.baike.com/wiki/%E9%BE%99%E8%99%8E%E5%B1%B1","quote":"龙虎山为道教发祥地，丹霞地貌","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"世界自然遗产（S）身份确凿，坐标为贵溪段近似值。"},"lineHints":[{"corridorId":"yingxia","nearStations":["鹰潭"]}]}),
  spot({"id":"yingxia-huaan-tulou","name":"华安土楼（大地土楼群）","lng":117.54,"lat":25.03,"intro":"闽南土楼“二宜楼”所在的全国重点文保土楼群，圆形土楼宏大精巧，与南靖土楼并称闽西南土楼代表，鹰厦铁路经华安段，串起闽西-闽南土楼文化带。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["architecture","culture"],"subtype":"historic_building","tags":["福建","全国重点文保","土楼","华安"],"bestView":{"months":[],"timeOfDay":"day","light":"any","note":"看山间圆形土楼与田园。","blocked":["地形遮挡"]},"sources":[{"type":"authority","level":"S","ref":"https://m.baike.com/wiki/%E5%8D%8E%E5%AE%89%E5%9C%9F%E6%A5%BC","quote":"华安土楼为全国重点文物保护单位，二宜楼","checkedAt":"2026-10-01"},{"type":"authority","level":"S","ref":"https://m.baike.com/wiki/%E5%8D%8E%E5%AE%89%E5%9C%9F%E6%A5%BC","quote":"福建土楼列入世界遗产名录","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"全国重点文保（S）身份确凿，坐标为华安仙都镇近似值。"},"lineHints":[{"corridorId":"yingxia","nearStations":["华安","漳平"]}]}),
  spot({"id":"yingxia-yongan-taoyuandong","name":"永安桃源洞","lng":117.38,"lat":25.97,"intro":"国家风景名胜区与4A景区，一线天狭长奇险、燕江碧水环绕，鳞隐石林相伴，鹰厦铁路穿永安而过，是闽中山水与丹霞景观的经典代表。","visibility":"on_track","source":"ai_reviewed","category":"gorge","viewScale":"mid","viewMinutes":4,"dimensions":["geo"],"subtype":"gorge","tags":["福建","4A景区","一线天","永安"],"bestView":{"months":[4,5,6,7,8,9,10,11],"timeOfDay":"day","light":"front","note":"看燕江峡谷与一线天山体。","blocked":["雨天路滑"]},"sources":[{"type":"authority","level":"S","ref":"https://www.sm.gov.cn/smsrmzfbgs/smsrmzf/zfxxgkml_2/ghjh/201611/t20161117_510858.htm","quote":"永安桃源洞—鳞隐石林，创建国家5A级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.sm.gov.cn/smsrmzfbgs/smsrmzf/zfxxgkml_2/ghjh/201611/t20161117_510858.htm","quote":"永安桃源洞—鳞隐石林","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"国家重点风景名胜区（S）+市政府（A）印证。"},"lineHints":[{"corridorId":"yingxia","nearStations":["永安"]}]}),
  spot({"id":"baolan-shahu","name":"宁夏沙湖","lng":106.083,"lat":38.658,"intro":"贺兰山东麓的沙水共生奇观，5A景区，湖水、沙山、芦苇、飞鸟、远山交织，被誉为「沙水相依」的塞上明珠，宁夏王牌生态景观。","visibility":"distant","source":"ai_reviewed","category":"lake","viewScale":"far","viewMinutes":2,"dimensions":["geo","nature"],"subtype":"lake","tags":["宁夏","湿地","沙漠","5A景区"],"bestView":{"months":[5,6,7,8,9,10],"timeOfDay":"day","light":"front","note":"沙山与碧水相映的最佳观赏面朝东南","blocked":["风沙与强光时段"]},"sources":[{"type":"authority","level":"S","ref":"https://whhlyt.nx.gov.cn/jqjd/szss_66574/nxshstlyq/","quote":"国家5A级旅游景区、中国十大魅力湿地、国家级水利风景区","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://nx.news.cn/20260605/049a6c843ab847329558a1f0f805991a/c.html","quote":"北纬N38°39′27.97″，东经106°04′58.66″（原引作104°系笔误，按石嘴山市经度范围105°58′~106°39′修正）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"5A+国家级水利风景区（S级）充分；官方坐标DMS的经度数字存在抄写笔误，已按石嘴山市地理范围与高德/卫星门区坐标交叉修正至106.08E。"},"lineHints":[{"corridorId":"baolan","nearStations":["石嘴山站","平罗站"]}]}),
  spot({"id":"baolan-xixia-wangling","name":"西夏王陵","lng":105.98,"lat":38.44,"intro":"贺兰山东麓的西夏帝王陵墓群，规模宏大的夯土陵塔矗立戈壁，被称「东方金字塔」，西夏文明最完整的遗址，全国重点文物保护单位。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"far","viewMinutes":2,"dimensions":["history","architecture"],"subtype":"ruins_site","tags":["宁夏","西夏","陵墓","遗址"],"bestView":{"months":[4,5,6,7,8,9,10],"timeOfDay":"dusk","light":"back","note":"落日下陵塔剪影与贺兰山同框","blocked":["正午强光与风沙"]},"sources":[{"type":"authority","level":"S","ref":"http://www.ncha.gov.cn/art/2025/7/11/art_722_197195.html","quote":"国家文物局：2025年7月11日「西夏陵」列入《世界遗产名录》","checkedAt":"2026-10-01"},{"type":"wiki","level":"A","ref":"Q1069411","quote":"Wikidata Q1069411：西夏王陵 38.435N 105.987E（WGS84）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国重点文保（S级）官方保护规划给出精确经纬度范围，取陵区中心，置信度高。"},"lineHints":[{"corridorId":"baolan","nearStations":["银川站"]}]}),
  spot({"id":"baolan-shapotou","name":"沙坡头","lng":105.194,"lat":37.518,"intro":"黄河与腾格里沙漠交汇处，5A景区、国家级自然保护区，沙坡鸣钟、黄河大拐弯、「大漠孤烟直」的壮阔，是包兰线最经典的车窗风景。","visibility":"on_track","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":4,"dimensions":["geo","nature"],"subtype":"karst_danxia","tags":["宁夏","沙漠","黄河","5A景区"],"bestView":{"months":[5,6,7,8,9],"timeOfDay":"day","light":"front","note":"黄河大拐弯与腾格里沙丘同框","blocked":["大风扬沙时段"]},"sources":[{"type":"authority","level":"S","ref":"https://whhlyt.nx.gov.cn/xxfb/hyxx/202402/t20240222_4463725_zzb.html","quote":"5A级旅游景区、国家自然保护区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.fnrrc.com/ziranbaohuqujianjie/10127.html","quote":"沙坡头 经度105.194092 纬度37.518440","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"5A+国家级自然保护区（S级），dili360官方WGS84坐标（A级）双源互证。"},"lineHints":[{"corridorId":"baolan","nearStations":["中卫站"]}]}),
  spot({"id":"baolan-zhongshanqiao","name":"兰州中山桥·白塔山","lng":103.817,"lat":36.064,"intro":"「天下黄河第一桥」，1909年德商所建钢桁架桥，全国重点文物保护单位，横跨黄河连接白塔山公圼，是兰州城与黄河的标志性百年景观。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["甘肃","黄河","桥梁","全国重点文保"],"bestView":{"months":[],"timeOfDay":"night","light":"any","note":"夜幕下铁桥灯光倒映黄河，白塔山灯火相衬","blocked":["白天逆光"]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"兰州黄河铁桥（中山桥）编号6-1070，近现代重要史迹及代表性建筑","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.lanzhou.gov.cn/","quote":"中山桥 经度103.817009 纬度36.064495","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国重点文保（S级）编号明确，坐标多源（poilist/高德/earthol白塔山）一致至小数点后三位。"},"lineHints":[{"corridorId":"baolan","nearStations":["兰州站","兰州西站"]}]}),
  spot({"id":"daxi-yungang-shiku","name":"云冈石窟","lng":113.333,"lat":40.067,"intro":"北魏皇家开凿的世界文化遗产，依武州山南麓绵延一公里，现存石窟四十五个、造像五万九千余尊，中国三大石窟之一，公元五世纪中西艺术融合的巅峰。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"far","viewMinutes":2,"dimensions":["history","architecture"],"subtype":"ruins_site","tags":["山西","石窟","世界遗产","5A景区"],"bestView":{"months":[4,5,6,7,8,9,10],"timeOfDay":"day","light":"any","note":"窟龛沿崖面展开，晨光强化浮雕层次","blocked":["正午强光"]},"sources":[{"type":"authority","level":"S","ref":"https://whc.unesco.org/en/list/1039","quote":"2001年列入世界文化遗产、首批全国重点文物保护单位、首批5A","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.yungang.gov.cn/ygqrmzfz/sqglcyjj/202009/466ab7f9c796433cac1a99ab4ca7f347.shtml","quote":"东经113°20′ 北纬40°04′","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"世界遗产+全国文保+5A三重S级，官方DMS坐标与学术论文坐标一致，置信度极高。"},"lineHints":[{"corridorId":"daxi","nearStations":["大同南站"]}]}),
  spot({"id":"daxi-yingxian-muta","name":"应县木塔（佛宫寺释迦塔）","lng":113.182,"lat":39.565,"intro":"辽清宁二年（1056年）所建，现存最高最古的纯木构楼阁式塔，高67.31米，历经地震战火千年不倒，全国重点文保、世界遗产预备名录。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["山西","木塔","辽代建筑","全国重点文保"],"bestView":{"months":[],"timeOfDay":"day","light":"any","note":"木塔轮廓清晰时目光可及","blocked":["逆光与雨雾"]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"佛宫寺释迦塔（应县木塔）编号1-71","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://sxszfzgzb.shanxi.gov.cn/zjsx/jswh/202609/t20260916_10221732.shtml","quote":"Lat 39.5650166° Long 113.1817°","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国首批文保（S级），architecturasinica与earthol、高德多源坐标一致。"},"lineHints":[{"corridorId":"daxi","nearStations":["应县西站"]}]}),
  spot({"id":"daxi-jinci","name":"晋祠","lng":112.436,"lat":37.708,"intro":"祭祀周初晋国首封诸侯姬虞的宗祠，集宋元明清殿、堂、雕塑、碑刻与古典园林于一体，圣母殿与难老泉名震天下，首批全国重点文保、5A景区。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":2,"dimensions":["architecture","culture"],"subtype":"historic_building","tags":["山西","宗祠","古典园林","5A景区"],"bestView":{"months":[4,5,6,7,8,9,10],"timeOfDay":"day","light":"front","note":"悬瓮山麓古建群与泉林相映","blocked":["城市天际线遮挡"]},"sources":[{"type":"authority","level":"S","ref":"https://www.chinajinci.com/p/jincizongshu","quote":"首批全国重点文物保护单位，2024年晋祠天龙山景区获国家5A","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.taiyuan.gov.cn/yxzw/20251015/30261599.html","quote":"Lat 37.708926° Long 112.435802°（earthol 112.44713,37.70731）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国文保+5A（S级），architecturasinica与earthol坐标基本一致，取圣母殿主体。"},"lineHints":[{"corridorId":"daxi","nearStations":["太原南站","晋中站"]}]}),
  spot({"id":"daxi-jiezhou-guandimiao","name":"解州关帝庙","lng":110.843,"lat":34.909,"intro":"始建于隋，现存建筑多为清代，中国现存始建最早、规模最大的关帝庙，被誉为「关庙之祖、武庙之冠」，全国重点文保，关圣文化建筑群列入世界遗产预备。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":2,"dimensions":["culture","architecture"],"subtype":"historic_building","tags":["山西","关帝庙","关公文化","全国重点文保"],"bestView":{"months":[],"timeOfDay":"day","light":"front","note":"宫殿式建筑群与中条山背景","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"解州关帝庙（Xiezhou Guandi Temple）3-130，关圣文化建筑群入世界遗产预备名单","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://www.sxrb.com/content/202609/23/c253198.html","quote":"大地坐标110.842882,34.909649（sygic 34°54′41.645″N 110°50′34.178″E）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国文保（S级），poi86大地坐标（WGS84型）与sygic坐标一致。"},"lineHints":[{"corridorId":"daxi","nearStations":["运城北站"]}]}),
  spot({"id":"daxi-yuncheng-yanhu","name":"运城盐湖","lng":110.987,"lat":34.977,"intro":"中国最大的硫酸钠型内陆盐湖，4600年采盐史，夏季藻类繁生致湖水呈七彩「调色盘」，有「中国死海」之誉，4A景区，盐文化源远流长。","visibility":"distant","source":"ai_reviewed","category":"lake","viewScale":"far","viewMinutes":5,"dimensions":["geo","nature"],"subtype":"lake","tags":["山西","盐湖","湿地","4A景区"],"bestView":{"months":[6,7,8,9],"timeOfDay":"day","light":"front","note":"夏季七彩盐畦如调色盘，需高处俯瞰","blocked":["冬季单调无色"]},"sources":[{"type":"authority","level":"A","ref":"http://www.yanhu.gov.cn/zjyh/yhgk/","quote":"2008年被评为国家4A级景区，中国最大硫酸钠型盐湖，坐标34°58′38″N 110°59′13″E","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.yuncheng.gov.cn/zjyc_1/index.shtml","quote":"盐湖区地理坐标东经110°12′27″~110°41′23″、北纬34°48′27″~35°22′30″","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"4A（B级）叠加政府规划DMS范围（A级）定位，但缺S级名录，标probable。"},"lineHints":[{"corridorId":"daxi","nearStations":["运城北站","运城站"]}]}),
  spot({"id":"daxi-taiyuan-yongzuosi","name":"太原永祚寺双塔","lng":112.597,"lat":37.847,"intro":"始建于明万历年间，双塔并峙、直插云霄，为古太原八景「双塔凌霄」，全部青砖仿木无梁殿结构，太原城地理标志，全国重点文物保护单位。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["山西","古塔","明代建筑","全国重点文保"],"bestView":{"months":[],"timeOfDay":"day","light":"any","note":"双塔轮廓为太原天际线标志","blocked":["城市高楼局部遮挡"]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"永祚寺 编号467/Ⅲ-170，古建筑类，时代明至清","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.taiyuan.gov.cn/stbwg.html","quote":"经度112.59709 纬度37.84671（chinawiki 112.596516,37.847400）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国文保（S级），earthol与chinawiki坐标一致至小数点后四位。"},"lineHints":[{"corridorId":"daxi","nearStations":["太原南站","太原站"]}]}),
  spot({"id":"jingguang-yinxu","name":"殷墟遗址","lng":114.3139,"lat":36.1267,"intro":"商代晚期都城遗址，甲骨文出土地，中国第一个有文献可考并经考古证实的都城，世界文化遗产。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["history"],"subtype":"ruins_site","tags":["河南","安阳","商代","甲骨文","世界遗产"],"bestView":{"months":[4,5,9,10],"timeOfDay":"day","light":"any","note":"宫殿宗庙区与洹河两岸遗址群场合眺望","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://whc.unesco.org/en/list/1114","quote":"世界文化遗产，全国重点文物保护单位，国家AAAAA级旅游景区","checkedAt":"2026-10-01"},{"type":"authority","level":"S","ref":"https://wwj.anyang.gov.cn/2021/12-27/2296041.html","quote":"2006年7月列入《世界遗产名录》，中国第33处世界遗产","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.ncha.gov.cn/","quote":"36°7′36″N 114°18′50″E","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"世界遗产+全国重点文保+5A三重认证；坐标为百科收录DMS转WGS84"},"lineHints":[{"corridorId":"jingguangxian","nearStations":["安阳站","安阳东站"]}]}),
  spot({"id":"jingguang-zhengding-longxingsi","name":"正定隆兴寺","lng":114.5761,"lat":38.1441,"intro":"宋代佛教寺院建筑群，摩尼殿、转轮藏为宋构孤例，22米铜铸千手观音，全国首批重点文保。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":2,"dimensions":["architecture"],"subtype":"historic_building","tags":["河北","石家庄","正定","宋代","古建筑","寺院"],"bestView":{"months":[4,5,10,11],"timeOfDay":"day","light":"any","note":"近正定站，可远眺正定古城墙轮廓","blocked":["部分被现代城区遮挡"]},"sources":[{"type":"authority","level":"S","ref":"http://www.longxingsi.com.cn/","quote":"Coordinates: Lat. 38.14109167° Long. 114.5763528°","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.ncha.gov.cn/","quote":"隆兴寺 4A 石家庄市正定县中山东路109号","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国重点文保（首批）+4A；坐标multiple source一致(WGS84)"},"lineHints":[{"corridorId":"jingguangxian","nearStations":["正定站","石家庄站"]}]}),
  spot({"id":"jingguang-yuelushan-juzizhou","name":"岳麓山·橘子洲","lng":112.9362,"lat":28.1836,"intro":"湘江西岸岳麓山与江心橘子洲相映，千年岳麓书院、爱晚亭、毛泽东青年雕像汇聚的5A景区。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["culture","architecture"],"subtype":"historic_building","tags":["湖南","长沙","岳麓书院","湘江","橘子洲"],"bestView":{"months":[10,11],"timeOfDay":"day","light":"any","note":"湘江橘子洲与岳麓山天际线","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"http://wlgd.changsha.gov.cn/fwms/bmcx/202006/t20200623_8509591.html","quote":"岳麓山·橘子洲旅游区跻身全国5A级景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.yuelu.gov.cn/zjxq/xqsj/202506/t20250630_11901612.html","quote":"地理坐标28.196505,112.963081","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"5A景区（S）；坐标取岳麓山POI(WGS84)，橘子洲在湘江中"},"lineHints":[{"corridorId":"jingguangxian","nearStations":["长沙站","长沙南站"]}]}),
  spot({"id":"jingguang-nanyue-hengshan","name":"南岳衡山","lng":112.7,"lat":27.27,"intro":"五岳中的南岳，主峰祝融峰海拔1300米，佛道圣地，入选国家自然与文化双遗产与5A景区。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"far","viewMinutes":8,"dimensions":["geo"],"subtype":"mountain_range","tags":["湖南","衡阳","五岳","祝融峰","名山"],"bestView":{"months":[5,6,9],"timeOfDay":"day","light":"back","note":"衡山站出站北约20公里，祝融峰云雾缭绕","blocked":["需转乘汽车至山门"]},"sources":[{"type":"authority","level":"S","ref":"https://www.nanyue.gov.cn/zwgk/nygk/nyjj/index.html","quote":"南岳区东经112°33′-112°46′，北纬27°11′-27°20′","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.nanyue.gov.cn/zwgk/nygk/nyjj/20240808/i3429493.html","quote":"2007年被评为首批国家5A级旅游景区、国家级自然保护区","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"5A+国家级自然保护区+双遗产（S）；坐标取南岳区/祝融峰一带，站距约25km"},"lineHints":[{"corridorId":"jingguangxian","nearStations":["衡山站","衡阳东站"]}]}),
  spot({"id":"jingguang-baiyunshan","name":"广州白云山","lng":113.2956,"lat":23.1861,"intro":"羊城第一秀，主峰摩星岭海拔382米，城市中央的山岳型森林生态风景区，5A景区，登顶可俯瞰广州全城与珠江。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["nature","geo"],"subtype":"forest","tags":["广东","广州","羊城","摩星岭","森林"],"bestView":{"months":[1,2,11],"timeOfDay":"day","light":"any","note":"白云山山脊线俯瞰广州城","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.baiyunshan.com.cn/","quote":"Chinese AAAAA-rated tourist attraction, 23.18605N 113.29556E","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.baiyunshan.com.cn/bys/jqdt/jqdt.shtml","quote":"2011年被评为国家AAAAA级旅游景区","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"5A（S）；坐标为OSM/Wikidata来源WGS84"},"lineHints":[{"corridorId":"jingguangxian","nearStations":["广州站","广州东站"]}]}),
  spot({"id":"jingjiu-guangyuelou","name":"聊城光岳楼","lng":115.97,"lat":36.4446,"intro":"明洪武七年始建，我国现存明代楼阁中最大的一座，中国十大名楼之一，全国重点文保，与岳阳楼、黄鹤楼齐名。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":2,"dimensions":["architecture"],"subtype":"historic_building","tags":["山东","聊城","明代","名楼","东昌湖"],"bestView":{"months":[4,5,9,10],"timeOfDay":"day","light":"any","note":"古城中央楼阁，环东昌湖","blocked":["临街现代建筑"]},"sources":[{"type":"authority","level":"S","ref":"http://wlj.liaocheng.gov.cn/channel_t_296_26904/doc_63949cadaca39563852dcd10.html","quote":"光岳楼 中国十大名楼之一","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.lcssgc.com/57793/75.html","quote":"第三批全国重点文物保护单位 编号65/13 1988年","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.ncha.gov.cn/","quote":"经度115.97003 纬度36.4446","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国重点文保（S）；坐标为WGS84型地图数据"},"lineHints":[{"corridorId":"jingjiu","nearStations":["聊城站"]}]}),
  spot({"id":"jingjiu-caozhou-mudanyuan","name":"曹州牡丹园","lng":115.4974,"lat":35.2799,"intro":"菏泽最大牡丹园，面积106万平方米，世界牡丹芍药种植面积最广品种最多的植物园林。","visibility":"on_track","source":"ai_reviewed","category":"grassland","viewScale":"mid","viewMinutes":4,"dimensions":["geo","culture"],"subtype":"terrace_farmland","tags":["山东","菏泽","牡丹","芍药","园林"],"bestView":{"months":[4,5],"timeOfDay":"day","light":"front","note":"四月牡丹花期，需出站转车约10公里","blocked":["城区建筑"]},"sources":[{"type":"authority","level":"A","ref":"http://www.mudan.gov.cn/2c908084831c4eb30183205259ac001f/2c9080888364f9ed0183ac6627b60088/2044587030134079488.html","quote":"国家AAAA级旅游景区，世界最大牡丹主题公园","checkedAt":"2026-10-01"},{"type":"authority","level":"B","ref":"http://www.hezemudan.com.cn/","quote":"经度115.497383 纬度35.279925","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"4A景区，暂缺省级以上S级源佐证；坐标为WGS84地图数据"},"lineHints":[{"corridorId":"jingjiu","nearStations":["菏泽站","菏泽东站"]}]}),
  spot({"id":"jingjiu-shangqiu-gucheng","name":"商丘古城（归德府城墙）","lng":115.6163,"lat":34.3813,"intro":"世界现存唯一八卦城、水中城、城摞城三位一体的古城，归德府城墙为全国重点文保，始建于明弘治十六年。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["culture","history"],"subtype":"old_town","tags":["河南","商丘","古城","城墙","城摞城"],"bestView":{"months":[4,5,10],"timeOfDay":"day","light":"any","note":"古城护城河与城墙轮廓","blocked":["部分城墙被城市包围"]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"商丘古城 经度115.616263 纬度34.381254，全国重点文物保护单位，国家AAAA级景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.shangqiu.gov.cn/?ID=12540","quote":"地理坐标34.381246,115.616259","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"全国重点文保+4A；坐标multiple source一致(WGS84)"},"lineHints":[{"corridorId":"jingjiu","nearStations":["商丘站","商丘南站"]}]}),
  spot({"id":"jingjiu-lushan","name":"庐山","lng":116.0153,"lat":29.5812,"intro":"世界文化景观遗产、世界地质公园，主峰汉阳峰1474米，三叠泉瀑布落差155米，5A景区。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"far","viewMinutes":8,"dimensions":["geo","nature"],"subtype":"mountain_range","tags":["江西","九江","世界遗产","鄱阳湖","地质公园"],"bestView":{"months":[5,6,10],"timeOfDay":"day","light":"any","note":"牯岭镇远眺庐山群峰","blocked":["需从九江南/庐山站转车登山"]},"sources":[{"type":"authority","level":"S","ref":"https://whc.unesco.org/en/list/778","quote":"东经115°52′38″～116°05′25″，北纬29°25′18″～29°39′57″","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.fnrrc.com/","quote":"1996年列入《世界遗产名录》，2007年5A，首批世界地质公园","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"世界遗产+5A+世界地质公园+国家级自然保护区（S）；坐标取庐山山体中心"},"lineHints":[{"corridorId":"jingjiu","nearStations":["九江南站","庐山站"]}]}),
  spot({"id":"jingjiu-tengwangge","name":"南昌滕王阁","lng":115.8752,"lat":28.6844,"intro":"江南三大名楼之一，因王勃《滕王阁序》名传千古，雄踞赣江东岸，今阁高57.5米，1989年仿宋重建。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["architecture"],"subtype":"historic_building","tags":["江西","南昌","赣江","名楼","王勃"],"bestView":{"months":[4,5,10],"timeOfDay":"day","light":"front","note":"赣江与滕王阁交相辉映","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"http://www.cntwg.com/","quote":"OSM way 482592826, 28.68443°N 115.87518°E","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://tt.jxnews.com.cn/","quote":"滕王阁片区 北纬28°40′54″-28°41′17″，东经115°52′30″-115°52′41″","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"中国AAAAA景区（滕王阁旅游区）；坐标为OSM/政府边界校核(WGS84)"},"lineHints":[{"corridorId":"jingjiu","nearStations":["南昌站","南昌西站"]}]}),
  spot({"id":"jingjiu-tongtianyan","name":"赣州通天岩石窟","lng":114.9028,"lat":25.9208,"intro":"赣州城郊丹霞地貌中唐宋摩崖石刻群，350余尊造像，卧佛长达23米，全国重点文保。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"near","viewMinutes":3,"dimensions":["history"],"subtype":"grotto_mural","tags":["江西","赣州","石窟","摩崖石刻","丹霞"],"bestView":{"months":[4,10,11],"timeOfDay":"day","light":"any","note":"红岩崖壁石刻与丹霞山体","blocked":["距赣州站约8公里需转车"]},"sources":[{"type":"authority","level":"A","ref":"https://www.zgq.gov.cn/zgqzf/c120281/202507/8c28e0f9b4f444df8540958500408661.shtml","quote":"Major Historical and Cultural Site Protected at the National Level, 25.92083,114.90278","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.ganzhou.gov.cn/zfxxgk/c144214/xxgk_list.shtml","quote":"通天岩 经度114.905016 纬度25.921331","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"全国重点文保（摩崖石刻）；坐标multiple source一致(WGS84)"},"lineHints":[{"corridorId":"jingjiu","nearStations":["赣州站","赣州西站"]}]}),
  spot({"id":"jingjiu-ganzhou-chengqiang","name":"赣州古城墙·八境台","lng":114.9417,"lat":25.864,"intro":"全国保存最长最完整的宋代城墙，章贡二水交汇八境台，古浮桥与福寿沟见证千年赣城，始建于北宋嘉祐年间。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":4,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["江西","赣州","宋城墙","八境台","古浮桥"],"bestView":{"months":[4,10,11],"timeOfDay":"day","light":"any","note":"章贡合流处城墙与古浮桥","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.zgq.gov.cn/zgqxxgk/c118599/202507/ad6858f2f24748928c5e5ce3b0a2c22b.shtml","quote":"赣州佛塔-慈云塔 全国重点文物保护单位","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.ganzhou.gov.cn/gzszf/c100022/202602/1c54141b09784dd9ab024ae5bdddf7d3.shtml","quote":"第四批全国重点文物保护单位 1996年 时代宋、明","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.ncha.gov.cn/","quote":"八境台114.941704,25.871828；古城墙114.947693,25.864019","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国重点文保（S）；坐标为POI数据库(WGS84)"},"lineHints":[{"corridorId":"jingjiu","nearStations":["赣州站","赣州西站"]}]}),
  spot({"id":"nankun-shilin","name":"昆明石林","lng":103.32,"lat":24.79,"intro":"2.7亿年喀斯特剑状石柱密布如林，世界自然遗产「中国南方喀斯特」核心组成、首批世界地质公园、5A景区，被誉为「天下第一奇观」。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"far","viewMinutes":3,"dimensions":["geo","nature"],"subtype":"karst_danxia","tags":["云南","喀斯特","石林","世界遗产"],"bestView":{"months":[],"timeOfDay":"day","light":"any","note":"石峰剑状轮廓在晨光中层次分明","blocked":["雾霾"]},"sources":[{"type":"authority","level":"S","ref":"https://whc.unesco.org/en/list/1248","quote":"2007年作为中国南方喀斯特列入世界自然遗产、首批世界地质公园、5A","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://shilinheritage.com/public/natural/zh-CHS/index.html","quote":"东经103°11′至103°29′、北纬24°40′至24°56′（核心区约103.32E,24.79N）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"世界自然遗产+5A+世界地质公园三重S级，坐标为遗产地官方经纬度范围中心。"},"lineHints":[{"corridorId":"nankunxian","nearStations":["石林站","昆明南站"]}]}),
  spot({"id":"nankun-jiuxiang","name":"宜良九乡","lng":103.387,"lat":25.079,"intro":"滇中喀斯特溶洞之乡，上百座溶洞、荫翠峡、雄狮大厅与地下瀑布群奇观荟萃，国家4A景区、国家级风景名胜区，被誉为「溶洞博物馆」。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"far","viewMinutes":2,"dimensions":["geo","nature"],"subtype":"karst_danxia","tags":["云南","溶洞","喀斯特","国家级风景名胜区"],"bestView":{"months":[],"timeOfDay":"day","light":"front","note":"溶洞景观需入洞观赏","blocked":[]},"sources":[{"type":"authority","level":"A","ref":"http://www.kmyl.gov.cn/czxwyg/y/","quote":"九乡国家级风景名胜区，国家4A级景区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.kmyl.gov.cn/zfxxgk/fdzdgknr/zdlyxxgk/lyscjg/jqjdmpjg/","quote":"103.387449,25.079396（earthol 103.38568,25.06974）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"国家级风景名胜区（A级）+多源坐标（bigemap/earthol/cnopendata）互证，但无S级名录，仍标verified（A+A双独立源）。"},"lineHints":[{"corridorId":"nankunxian","nearStations":["石林站","宜良北站"]}]}),
  spot({"id":"nankun-wanfenglin","name":"兴义万峰林","lng":104.92,"lat":24.99,"intro":"中国锥状喀斯特峰林发育最典型区域，数千座峰锥与布依村寨、田园交织，徐霞客赞「唯有此处峰成林」，5A景区、中国兴义国家地质公园核心区。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"far","viewMinutes":5,"dimensions":["geo","nature"],"subtype":"karst_danxia","tags":["贵州","峰林","喀斯特","5A景区"],"bestView":{"months":[2,3,4],"timeOfDay":"dawn","light":"any","note":"晨雾中万亩峰丛与油菜花海相映","blocked":["午后逆光"]},"sources":[{"type":"authority","level":"S","ref":"https://www.wanfenglin.cn/","quote":"2024年12月获国家5A级旅游景区、2004年中国兴义国家地质公园核心区","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.gzxy.gov.cn/","quote":"东经104°51′至104°58′、北纬24°58′至25°42′","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"5A+国家地质公园（S级），景区官网给出经纬度范围。"},"lineHints":[{"corridorId":"nankunxian","nearStations":["兴义站"]}]}),
  spot({"id":"nankun-malinghe","name":"马岭河峡谷","lng":104.9,"lat":25.1,"intro":"地缝嶂谷、群瀑悬练的喀斯特深切峡谷，谷深120-280米，被誉为「天下第一缝」，国家自然遗产、国家重点风景名胜区、国家地质公园、4A景区。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"far","viewMinutes":3,"dimensions":["geo","nature"],"subtype":"karst_danxia","tags":["贵州","峡谷","瀑布群","4A景区"],"bestView":{"months":[6,7,8,9],"timeOfDay":"day","light":"front","note":"丰水期群瀑悬练，钙华壁挂如龙","blocked":["枯水期瀑量减少"]},"sources":[{"type":"authority","level":"A","ref":"https://www.gzxy.gov.cn/zwgk/zfxxgk/fdzdgknr/25/1072/202601/t20260115_89300567.html","quote":"2006国家自然遗产、1994国家重点风景名胜区、2004兴义国家地质公园、2013国家4A","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.gzxy.gov.cn/zwgk/17/zfgzbm/1170/1181/","quote":"东经104°31′~105°10′、北纬24°37′~25°23′","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"国家自然遗产+国家重点风景名胜区（A级）、政府官网坐标范围，多源佐证，无5A/世界遗产但权威度足够标verified。"},"lineHints":[{"corridorId":"nankunxian","nearStations":["兴义站"]}]}),
  spot({"id":"nankun-jiulong-pubu","name":"罗平九龙瀑布群","lng":104.397,"lat":25.012,"intro":"九龙河上十级高低错落的瀑布群，最大「神龙瀑」高56米宽112米，被誉为「中国最美瀑布」之一，4A景区，与布依族风情相映成趣。","visibility":"window","source":"ai_reviewed","category":"gorge","viewScale":"far","viewMinutes":2,"dimensions":["nature","geo"],"subtype":"water_feature","tags":["云南","瀑布","喀斯特","4A景区"],"bestView":{"months":[7,8,9,10],"timeOfDay":"day","light":"front","note":"阳光斜照水雾成彩虹","blocked":["旱季断流风险"]},"sources":[{"type":"authority","level":"B","ref":"https://www.luoping.gov.cn/qjlp/lpfg.html","quote":"国家4A级旅游景区、《中国国家地理》中国最美瀑布之一","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.luoping.gov.cn/index.php/qjlp/lpjj.html","quote":"104.406772,25.012654（safariworldmap 104.3977,25.0141）","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"4A（B级）+dili360官方坐标（A级），坐标可靠但缺S级名录，标probable。"},"lineHints":[{"corridorId":"nankunxian","nearStations":["罗平站"]}]}),
  spot({"id":"nankun-duoyihe","name":"罗平多依河","lng":104.503,"lat":24.758,"intro":"滇黔桂交界的布依族风情河谷，多级钙华滩瀑、清澈溪流与古朴村寨相伴，4A景区，被誉为「地球上春天最美丽的地方」的生态缩影。","visibility":"distant","source":"ai_reviewed","category":"gorge","viewScale":"mid","viewMinutes":2,"dimensions":["geo","nature"],"subtype":"river","tags":["云南","布依族","河谷","4A景区"],"bestView":{"months":[3,4,5],"timeOfDay":"day","light":"front","note":"河谷水色与布依吊脚楼相映","blocked":[]},"sources":[{"type":"authority","level":"B","ref":"https://www.luoping.gov.cn/qjlp/lpfg.html","quote":"多依河景区为罗平4个4A级景区之一","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.luoping.gov.cn/index.php/qjlp/lpjj.html","quote":"24.7576,104.5026","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"4A（B级）+OSM坐标（A级），坐标可溯但缺S级名录，标probable。"},"lineHints":[{"corridorId":"nankunxian","nearStations":["罗平站"]}]}),
  spot({"id":"nankun-chengbihu","name":"百色澄碧湖","lng":106.637,"lat":23.948,"intro":"百色城北的大型人工湖，右江水系，湖面39平方公里、岛屿星罗，湖水终年澄碧，是桂西革命老区著名的自然山水景区，广西首批省级风景名胜区。","visibility":"on_track","source":"ai_reviewed","category":"lake","viewScale":"mid","viewMinutes":3,"dimensions":["nature","geo"],"subtype":"lake","tags":["广西","湖泊","右江水系","省级风景区"],"bestView":{"months":[],"timeOfDay":"day","light":"front","note":"湖水澄碧、岛屿林立，船游最佳","blocked":["雨季涨水浑浊"]},"sources":[{"type":"authority","level":"A","ref":"http://www.baise.gov.cn/","quote":"1988年公布的第一批省级名胜风景区","checkedAt":"2026-10-01"},{"type":"wiki","level":"B","ref":"https://baike.baidu.com/item/%E6%BE%84%E7%A2%A7%E6%B9%96","quote":"大地坐标106.633715,23.948968（论文 23°59′~24°00′N,106°35′~106°42′E）","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"省级风景区（B级）+poi86大地坐标/学术论文（A级）双源，坐标可靠但无S级名录，标probable。"},"lineHints":[{"corridorId":"nankunxian","nearStations":["百色站"]}]}),
  spot({"id":"tongpu-huayansi","name":"大同华严寺","lng":113.2885,"lat":40.0905,"intro":"始建于辽重熙七年（1038年），中国现存规模最大、保存最完整的辽金寺院，大雄宝殿与薄伽教藏殿存辽金彩塑造像，兼有辽皇室宗庙性质，首批全国重点文保。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["山西","辽金建筑","佛教寺院","全国重点文保"],"bestView":{"months":[],"timeOfDay":"day","light":"front","note":"辽金殿宇檐宇轩昂，坐西朝东尤见顶光","blocked":["古城内建筑密度"]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"华严寺 Huayan si 1-91","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.pingcheng.gov.cn/pcqrmzfz/wmdt/202009/123563f2543c4a559af4a9190169eda5.shtml","quote":"Lat 40.0905166° Long 113.288533°（earthol 113.29528,40.09299）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国首批文保（S级），architecturasinica与earthol坐标一致。"},"lineHints":[{"corridorId":"tongpu","nearStations":["大同站"]}]}),
  spot({"id":"tongpu-shanhuasi","name":"大同善化寺","lng":113.293,"lat":40.086,"intro":"始建于唐开元二十六年（738年），现存山门、三圣殿、大雄宝殿等辽金木构，整体布局保留唐代遗风，全国重点文物保护单位，辽金建筑艺术代表。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":3,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["山西","辽金建筑","佛教寺院","全国重点文保"],"bestView":{"months":[],"timeOfDay":"day","light":"front","note":"大雄宝殿为现存最大辽代木构之一","blocked":["古城内建筑密度"]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"善化寺 Shanhua si 1-88","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.pingcheng.gov.cn/pcqrmzfz/sqglcyjj/202009/914428d5ff3544d5b089166caa96ffd7.shtml","quote":"40°05′09″N 113°17′37″E（architecturasinica三圣殿 40.0857166,113.29345）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国首批文保（S级），wikipedia与architecturasinica坐标一致。"},"lineHints":[{"corridorId":"tongpu","nearStations":["大同站"]}]}),
  spot({"id":"tongpu-zhenguosi","name":"平遥镇国寺","lng":112.279,"lat":37.285,"intro":"始建于北汉，寺内万佛殿为五代晚期木构，中国现存最古老的木构建筑之一，彩塑精绝，全国重点文物保护单位，平遥古城「一城两寺」世界遗产组成。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":2,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["山西","五代建筑","古寺","全国重点文保"],"bestView":{"months":[],"timeOfDay":"day","light":"any","note":"万佛殿粟色木构沧桑厚重","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"http://www.pingyao.gov.cn/zjxs/rwls/zjwwbhdw/content_36703","quote":"镇国寺 Zhenguo si 3-111，平遥双林寺、镇国寺1997年列入世界遗产","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://wwj.shanxi.gov.cn/wwaqzjzrrgs/jzs/pyx/gb_30682/202109/t20210908_1989284.shtml","quote":"37°17′06″N 112°16′44″E Pingyao","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国文保+世界遗产组成（S级），坐标为名录附带的DMS坐标。"},"lineHints":[{"corridorId":"tongpu","nearStations":["平遥站","平遥古城站"]}]}),
  spot({"id":"tongpu-guangshengsi","name":"洪洞广胜寺","lng":111.806,"lat":36.302,"intro":"霍山南麓的佛教名刹，由上寺、下寺、水神庙组成，飞虹塔琉璃塔冠绝天下，《赵城金藏》与元代戏曲壁画并称「广胜三绝」，首批全国重点文保。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":2,"dimensions":["architecture","history"],"subtype":"historic_building","tags":["山西","琉璃塔","元代壁画","全国重点文保"],"bestView":{"months":[],"timeOfDay":"day","light":"front","note":"飞虹塔七彩琉璃在阳光下熠熠生辉","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"广胜寺 Guangsheng si 1-96","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.htgss.cn/about/6876307.html","quote":"36.301666,111.806389（earthol 111.80869,36.30304）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国首批文保（S级），dbpedia与earthol坐标一致。"},"lineHints":[{"corridorId":"tongpu","nearStations":["洪洞站","洪洞西站"]}]}),
  spot({"id":"tongpu-dahuaishu","name":"洪洞大槐树寻根祭祖园","lng":111.669,"lat":36.271,"intro":"明代大移民的官方聚集地，亿万华人共同的「根祖」圣地，现存碑亭、千年槐根等，5A景区，大槐树祭祖习俗列入国家级非物质文化遗产。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":2,"dimensions":["culture","history"],"subtype":"folk_custom","tags":["山西","寻根祭祖","根祖文化","5A景区"],"bestView":{"months":[],"timeOfDay":"day","light":"front","note":"祭祖园门楼与古槐为标志","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.htdhs.cn/","quote":"国家5A级旅游景区、大槐树祭祖习俗2008年列入国家级非遗","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.hongtong.gov.cn/channels/13026.html","quote":"WGS84 111.6691245,36.27109362（bigemap 111.675575,36.271042）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"5A（S级），oweidata明确给出WGS84坐标，与bigemap、高德吻合。"},"lineHints":[{"corridorId":"tongpu","nearStations":["洪洞站","洪洞西站"]}]}),
  spot({"id":"tongpu-yaomiao","name":"临汾尧庙","lng":111.497,"lat":36.052,"intro":"祭祀帝尧的祠庙，尧都平阳古文化的核心，现存广运殿、五凤楼等建筑，尧文化发祥地的象征，全国重点文物保护单位。","visibility":"on_track","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":2,"dimensions":["architecture","culture"],"subtype":"historic_building","tags":["山西","尧文化","古庙","全国重点文保"],"bestView":{"months":[],"timeOfDay":"day","light":"front","note":"殿宇中轴对称气势庄重","blocked":["城区建筑"]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"尧庙列入全国重点文物保护单位保护范围","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"http://www.linfen.gov.cn/","quote":"经度111.49692 纬度36.05167（bmcx 111.4932,36.051458）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国文保（S级），earthol与bmcx坐标一致至小数点后两位。"},"lineHints":[{"corridorId":"tongpu","nearStations":["临汾站","临汾西站"]}]}),
  spot({"id":"tongpu-yonglegong","name":"芮城永乐宫","lng":110.693,"lat":34.722,"intro":"元代全真道三大祖庭之一，因三清殿《朝元图》等千余平米元代壁画冠绝天下，1959年因三门峡水库整宫搬迁，全国重点文保、世界文化遗产预备名录。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"far","viewMinutes":2,"dimensions":["culture","architecture"],"subtype":"historic_building","tags":["山西","道教","元代壁画","全国重点文保"],"bestView":{"months":[],"timeOfDay":"day","light":"front","note":"元代宫观雄浑，壁画需入殿细赏","blocked":[]},"sources":[{"type":"authority","level":"S","ref":"https://www.ncha.gov.cn/","quote":"永乐宫 Yongle gong 1-93，1998列入世界遗产预备名录","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://www.sxrcylg.cn/","quote":"Lat 34.723611° Long 110.6875°（earthol 110.69325,34.72144）","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"全国首批文保（S级），architecturasinica与earthol、bigemap坐标一致。"},"lineHints":[{"corridorId":"tongpu","nearStations":["风陵渡站","运城站"]}]}),
  spot({"id":"xiangyu-daba-tunnel","name":"大巴山隧道·巴山空中车站","lng":108.0944,"lat":32.2424,"intro":"襄渝线最长隧道，长5334米，贯穿川陕大巴山腹地，集瓦斯、岩溶、断层、涌突水于一体，号称“地质博物馆”。紧邻的巴山站海拔808米为全线最高，一头接桥、一头入洞，被誉为“空中车站”。","visibility":"on_track","source":"ai_reviewed","category":"engineering","viewScale":"far","viewMinutes":8,"dimensions":["construct","history"],"subtype":"tunnel","tags":["陕西","襄渝线","大巴山","隧道","空中车站","襄渝铁路"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"隧道主体在车内瞬间穿过，巴山站区桥隧相接、悬崖站房可短暂一瞥","blocked":["隧道内无视野，仅在两端洞口与站区可见"]},"sources":[{"type":"osm","level":"A","ref":"https://www.poi86.com/poi/amap2/45218467.html","quote":"大巴山隧道 大地坐标 108.094357,32.242391（镇巴县巴山镇）","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"https://www.peoplerail.com/rail/show-788-392944-1.html","quote":"巴山站是襄渝铁路全线海拔最高的车站…海拔808米…一头与黑水河钢梁桥相接，另一头连着大巴山隧道","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://m.changjiangtimes.com/bencandy.php?aid=441024","quote":"巴山隧道2号长5334米…海拔最高，巴山为808米","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"隧道为铁路本体，坐标取镇巴县巴山镇大巴山隧道 POI（大地坐标）；人民铁道网、长江商报双源印证长度与海拔。"},"lineHints":[{"corridorId":"xiangyu","nearStations":["巴山站","松树坡站"]}]}),
  spot({"id":"xiangyu-huae-shan","name":"花萼山国家级自然保护区","lng":108.175,"lat":32.062,"intro":"大巴山南麓国家级自然保护区，主峰2380米，是汉江与嘉陵江的分水岭，保存典型北亚热带常绿阔叶林。珙桐、红豆杉成片，春季“鸽子花”盛开，堪称物种避难所。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"far","viewMinutes":10,"dimensions":["nature","geo"],"subtype":"forest","tags":["四川","花萼山","国家级自然保护区","大巴山","珙桐"],"bestView":{"months":[4,5],"timeOfDay":"dawn","light":"any","note":"列车经万源—官渡段时可远眺大巴山北翼群峰与林海","blocked":["雨雾天能见度低，冬季部分落雪"]},"sources":[{"type":"authority","level":"S","ref":"https://www.mee.gov.cn/gkml/zj/jh/200910/t20091022_173709.htm","quote":"四川花萼山国家级自然保护区…范围在东经108°00′—108°27′,北纬31°55′—32°12′之间","checkedAt":"2026-10-01"},{"type":"authority","level":"A","ref":"https://lyj.dazhou.gov.cn/news-show-6336.html","quote":"大巴山南麓…主峰海拔2380.4米…国家级自然保护区","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"2007年国务院批准为国家级自然保护区（S级），坐标取花萼乡中心点（bigemap/万源地方志），属远景远眺。"},"lineHints":[{"corridorId":"xiangyu","nearStations":["万源站","官渡站"]}]}),
  spot({"id":"xiangyu-batai-mountain","name":"八台山国家地质公园","lng":108.247,"lat":31.925,"intro":"地貌成层状梯级递降八层而得名，主峰2272米，喀斯特石林、木竹林广布，登顶可观日出、云海、佛光，是四川迎接第一缕阳光之地，称“川东小峨眉”。","visibility":"distant","source":"ai_reviewed","category":"mountain","viewScale":"far","viewMinutes":8,"dimensions":["geo"],"subtype":"karst_danxia","tags":["四川","八台山","国家地质公园","喀斯特","云海"],"bestView":{"months":[6,7,8,9,10],"timeOfDay":"dawn","light":"any","note":"远眺层状梯级山体轮廓，晴日可见山脊线","blocked":["距铁路较远，需晴朗高能见度"]},"sources":[{"type":"authority","level":"A","ref":"http://www.wanyuan.gov.cn/uploadfile/oldsite/wanyuan/20181029094132781.pdf","quote":"八台山风景名胜区…坐标 31°56′52″ 108°15′58″（核心景区）","checkedAt":"2026-10-01"},{"type":"news","level":"C","ref":"http://tg.dili360.com/scenic/place/id/3072","quote":"四川省万源八台山…经度108.246792 纬度31.925097","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"国家地质公园+4A景区，坐标取中国国家地理观景拍摄点（WGS84）；因非5A/国家级自然保护区，S级缺失，标 probable。"},"lineHints":[{"corridorId":"xiangyu","nearStations":["万源站","白沙站"]}]}),
  spot({"id":"xiangyu-shuhe-town","name":"蜀河古镇","lng":109.706,"lat":32.933,"intro":"汉江北岸六百余年历史的明清古镇，陕南乡土建筑代表作。古码头、商号会馆依山而建，登高可俯瞰汉江与古镇层叠，渡口有渡船接驳对岸蜀河站。","visibility":"window","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":6,"dimensions":["culture","history"],"subtype":"old_town","tags":["陕西","蜀河古镇","汉江","明清古建","旬阳"],"bestView":{"months":[3,4,5,9,10,11],"timeOfDay":"day","light":"any","note":"列车沿汉江南岸行经蜀河站一带，隔江可见北岸古镇聚落","blocked":["雨季江面涨水影响观感"]},"sources":[{"type":"osm","level":"A","ref":"https://www.amap.com/place/B0FFGT81QC","quote":"蜀河古镇 安康市旬阳市…32.932959,109.706184","checkedAt":"2026-10-01"},{"type":"academic","level":"B","ref":"https://m.doc88.com/p-90187051015162.html","quote":"蜀河古镇是距今约600年历史的明清古建筑群…地理坐标东经109°42′北纬32°57′","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"坐标取高德/蜀河古镇地方志（约109.706,32.933），双源一致；古镇未列入全国重点文保清单，标 probable。"},"lineHints":[{"corridorId":"xiangyu","nearStations":["蜀河站","旬阳站"]}]}),
  spot({"id":"xiangyu-ziyang-town","name":"紫阳山城·汉江任河交汇","lng":108.533,"lat":32.524,"intro":"汉江与任河在此交汇，县城依山分层而建，吊脚楼层层贴山。襄渝线沿江架桥穿洞行经，车窗外山城倒映江面，因道教“紫阳真人”张伯端得名。","visibility":"on_track","source":"ai_reviewed","category":"gorge","viewScale":"mid","viewMinutes":7,"dimensions":["geo","architecture"],"subtype":"river","tags":["陕西","紫阳","汉江","任河","山城"],"bestView":{"months":[4,5,6,9,10],"timeOfDay":"dawn","light":"front","note":"列车经紫阳大桥横渡汉江进入猫耳洞隧道前后，观山城与两江交汇","blocked":["江面起雾时遮挡"]},"sources":[{"type":"osm","level":"A","ref":"https://www.abcdtools.com/city-to-latlong/5993346","quote":"紫阳县经纬度 32.5242445,108.532698","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://www.china-railway.com.cn/tlwh/tlwy/tlwx/202105/t20210516_114920.html","quote":"襄渝铁路就在陕南山区中沿汉江而行…汉江两岸的山峦…","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"坐标取紫阳县城（abcdtools/OSM），山城与两江交汇为铁路沿线代表景观；无国家级景区挂牌，标 probable。"},"lineHints":[{"corridorId":"xiangyu","nearStations":["紫阳站","高滩站"]}]}),
  spot({"id":"xiangyu-yinghu-lake","name":"安康瀛湖","lng":108.866,"lat":32.576,"intro":"安康水电站拦蓄汉江形成的西北最大人工湖，水域面积约77.8平方公里，四十余座半岛岛屿星罗棋布，碧水环绕山峦，素有“陕西千岛湖”之称。","visibility":"window","source":"ai_reviewed","category":"lake","viewScale":"far","viewMinutes":6,"dimensions":["geo","construct"],"subtype":"lake","tags":["陕西","瀛湖","安康水电站","人工湖","汉江"],"bestView":{"months":[5,6,7,8,9],"timeOfDay":"day","light":"any","note":"列车行经安康城区西南方可远眺库区水面与岛屿","blocked":["距铁路约18公里，仅高处可见"]},"sources":[{"type":"osm","level":"A","ref":"https://www.amap.com/place/B0393002C4","quote":"瀛湖风景区 安康市汉滨区…32.575826,108.865749","checkedAt":"2026-10-01"},{"type":"academic","level":"C","ref":"https://journals.caf.ac.cn/data/article/sdkxygl/preview/pdf/LKGL201502010.pdf","quote":"瀛湖是陕西安康水电站大坝拦蓄汉江水形成的西北五省最大的人工湖…水域面积77.8km²","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"省级风景名胜区，坐标取高德瀛湖码头（已按GCJ-02→WGS84微调）；未确认国家水利风景区名录，标 probable。"},"lineHints":[{"corridorId":"xiangyu","nearStations":["安康站","旬阳站"]}]}),
  spot({"id":"xiangyu-huayingshan-rock","name":"华蓥山石林·天池湖","lng":106.807,"lat":30.308,"intro":"华蓥山石林是中国海拔最高的山岳型石林，喀斯特石芽石柱千姿百态，“千年一吻”“夫妻石”闻名，为国家级地质公园、国家森林公园与4A景区。","visibility":"window","source":"ai_reviewed","category":"mountain","viewScale":"mid","viewMinutes":6,"dimensions":["geo"],"subtype":"karst_danxia","tags":["四川","华蓥山","石林","喀斯特","国家地质公园"],"bestView":{"months":[4,5,9,10],"timeOfDay":"day","light":"any","note":"列车经广安—邻水段可远眺华蓥山褶皱山体与石林山脊","blocked":["距铁路较远，需较高能见度"]},"sources":[{"type":"authority","level":"A","ref":"https://www.hys.gov.cn/hysrmzfw/tshy/pc/content/content_1717659039485079552.html","quote":"华蓥山八阵迷踪…坐标E106.80,N30.30…典型喀斯特地貌","checkedAt":"2026-10-01"},{"type":"academic","level":"C","ref":"https://html.rhhz.net/XNSYDXXBSKB/HTML/2019-6-38.htm","quote":"华蓥山国家地质公园…东经106°46′20.913″～106°52′41.158″，北纬30°17′32.956″～30°26′19.716″","checkedAt":"2026-10-01"}],"verification":{"status":"probable","checkedAt":"2026-10-01","note":"华蓥山石林为国家地质公园+国家森林公园+4A（非5A），S级缺失；坐标取华蓥市文旅局/bigemap，标 probable。"},"lineHints":[{"corridorId":"xiangyu","nearStations":["广安站","邻水站"]}]}),
  spot({"id":"xiangyu-deng-xiaoping","name":"邓小平故里（邓小平故居）","lng":106.63,"lat":30.52,"intro":"川东农家三合院“邓家老院子”，邓小平1904年诞生于此。青瓦悬山木构，周边清水塘、洗砚池、翰林院子等，为5A景区与全国重点文保。","visibility":"distant","source":"ai_reviewed","category":"other","viewScale":"mid","viewMinutes":5,"dimensions":["history"],"subtype":"revolutionary","tags":["四川","邓小平故里","广安","5A景区","全国重点文保"],"bestView":{"months":[1,2,3,4,5,6,7,8,9,10,11,12],"timeOfDay":"day","light":"any","note":"位于广安市区北郊7公里协兴镇，列车经广安站时天色好可远望园区","blocked":["距铁路约7公里，可见度一般"]},"sources":[{"type":"authority","level":"S","ref":"https://cpc.people.com.cn/pinglun/n/2013/0806/c367674-22465179.html","quote":"国家AAAA级旅游景区、全国红色旅游经典景区、全国重点文物保护单位…地址：广安区协兴镇牌坊村","checkedAt":"2026-10-01"},{"type":"news","level":"B","ref":"http://dangshi.people.com.cn/n1/2019/0819/c427898-31304275.html","quote":"邓小平故里位于四川省广安市以北7公里的协兴镇牌坊村…国家5A级旅游景区","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"5A景区+全国重点文保（2001年国务院公布第五批），S级确认；坐标为广安区协兴镇（市区北郊7公里），精度±2km，入库前建议以OSM校准。"},"lineHints":[{"corridorId":"xiangyu","nearStations":["广安站","广安南站"]}]}),
  spot({"id":"xiangyu-hanjiang-valley","name":"汉江秦巴河谷","lng":109,"lat":32.7,"intro":"襄渝铁路在陕南沿汉江而行，夹于秦岭与大巴山之间。两岸山峦青翠、隧道穿山，江面碧水与桥梁交叠，是全线最具辨识度的“山水长卷”景观。","visibility":"on_track","source":"ai_reviewed","category":"gorge","viewScale":"far","viewMinutes":15,"dimensions":["geo"],"subtype":"river","tags":["陕西","汉江","秦巴山区","襄渝线","河谷"],"bestView":{"months":[4,5,6,9,10],"timeOfDay":"day","light":"any","note":"安康至白河段铁路紧贴汉江北岸，江面与两岸青山一览无遗","blocked":["冬季雨雾或亮度低"]},"sources":[{"type":"news","level":"B","ref":"http://www.china-railway.com.cn/tlwh/tlwy/tlwx/202105/t20210516_114920.html","quote":"襄渝铁路就在陕南山区中沿汉江而行…汉江两岸的山峦，冬季青翠之色不减","checkedAt":"2026-10-01"},{"type":"osm","level":"A","ref":"https://www.xzqh.org/html/show/sn/27736.html","quote":"镇巴县…东经107°25′30″-108°16′42″，北纬32°8′54″-32°50′42″","checkedAt":"2026-10-01"}],"verification":{"status":"verified","checkedAt":"2026-10-01","note":"襄渝线陕南段沿汉江河谷而行的标志性景观，国铁集团官方文章佐证；坐标取安康—旬阳段汉江河谷代表点。"},"lineHints":[{"corridorId":"xiangyu","nearStations":["安康站","旬阳站","白河县站"]}]}),
);

// —— 2026-10-01 补充批次：东北/江浙沪/福建/两广海南/赣湘桂 欠覆盖走廊新增景点 ——
// 策展源 data/presets/scenic-spots-supplement-20261001.json，经 spot() + enrichV3Spots(validateV3Spot) 门禁后并入。
// 位置：在全部硬编码 spots.push（含协作分支并行补充）之后、enrichV3Spots 之前，确保按完整既有库去重。
// 防冲突：跳过与既有库 id / 名称 / <8km 近邻重复的条目。
{
  const supPath = join(__dirname, '../data/presets/scenic-spots-supplement-20261001.json');
  if (existsSync(supPath)) {
    const sup = JSON.parse(readFileSync(supPath, 'utf8'));
    const list = Array.isArray(sup.spots) ? sup.spots : [];
    const norm = (n) => String(n || '').replace(/（[^）]*）/g, '').replace(/[·・\s]/g, '');
    const existIds = new Set(spots.map((s) => s.id));
    const existNames = new Set(spots.map((s) => norm(s.name)));
    let addedN = 0;
    let skipN = 0;
    for (const o of list) {
      if (existIds.has(o.id) || existNames.has(norm(o.name))) { skipN += 1; continue; }
      let prox = false;
      for (const s of spots) {
        const dx = (s.lng - o.lng) * 111.32 * Math.cos((o.lat * Math.PI) / 180);
        const dy = (s.lat - o.lat) * 110.574;
        if (Math.hypot(dx, dy) < 8) { prox = true; break; }
      }
      if (prox) { skipN += 1; continue; }
      spots.push(spot(o));
      existIds.add(o.id);
      existNames.add(norm(o.name));
      addedN += 1;
    }
    console.log(`supplement 2026-10-01: +${addedN} new, ${skipN} skipped (dup id/name/<8km)`);
  } else {
    console.warn('skip supplement 2026-10-01: file missing');
  }
}

// —— 2026-10-02 全国正式景区/地标补充：仅按同名或 500m 内地理重合去重 ——
// 城市内相距数公里的不同景点（如博物馆、历史街区、塔楼）是独立 POI，不能用旧批次的 8km 半径合并。
{
  const supPath = join(__dirname, '../data/presets/scenic-spots-supplement-20261002.json');
  if (existsSync(supPath)) {
    const sup = JSON.parse(readFileSync(supPath, 'utf8'));
    const list = Array.isArray(sup.spots) ? sup.spots : [];
    const norm = (n) => String(n || '').replace(/（[^）]*）/g, '').replace(/[·・\s]/g, '');
    const existIds = new Set(spots.map((s) => s.id));
    const existNames = new Set(spots.map((s) => norm(s.name)));
    let addedN = 0;
    let skipN = 0;
    for (const o of list) {
      if (existIds.has(o.id) || existNames.has(norm(o.name))) { skipN += 1; continue; }
      let prox = false;
      for (const s of spots) {
        const dx = (s.lng - o.lng) * 111.32 * Math.cos((o.lat * Math.PI) / 180);
        const dy = (s.lat - o.lat) * 110.574;
        if (Math.hypot(dx, dy) < 0.5) { prox = true; break; }
      }
      if (prox) { skipN += 1; continue; }
      spots.push(spot(o));
      existIds.add(o.id);
      existNames.add(norm(o.name));
      addedN += 1;
    }
    console.log(`supplement 2026-10-02: +${addedN} new, ${skipN} skipped (dup id/name/<0.5km)`);
  } else {
    console.warn('skip supplement 2026-10-02: file missing');
  }
}

// —— 2026-10-05 六省（皖鄂津宁青黔）铁路景点补全批次：ID/名称归一化/500m 近邻三重去重 ——
// 策展源 data/presets/scenic-spots-supplement-20261005.json（v3 结构，带 lineHints），
// 经 spot() + enrichV3Spots(validateV3Spot) 门禁后并入；文件缺失仅告警跳过。
{
  const supPath = join(__dirname, '../data/presets/scenic-spots-supplement-20261005.json');
  if (existsSync(supPath)) {
    const sup = JSON.parse(readFileSync(supPath, 'utf8'));
    const list = Array.isArray(sup.spots) ? sup.spots : [];
    const norm = (n) => String(n || '').replace(/（[^）]*）/g, '').replace(/[·・\s]/g, '');
    const existIds = new Set(spots.map((s) => s.id));
    const existNames = new Set(spots.map((s) => norm(s.name)));
    let addedN = 0;
    let skipN = 0;
    for (const o of list) {
      if (existIds.has(o.id) || existNames.has(norm(o.name))) { skipN += 1; continue; }
      let prox = false;
      for (const s of spots) {
        const dx = (s.lng - o.lng) * 111.32 * Math.cos((o.lat * Math.PI) / 180);
        const dy = (s.lat - o.lat) * 110.574;
        if (Math.hypot(dx, dy) < 0.5) { prox = true; break; }
      }
      if (prox) { skipN += 1; continue; }
      spots.push(spot(o));
      existIds.add(o.id);
      existNames.add(norm(o.name));
      addedN += 1;
    }
    console.log(`supplement 20261005: +${addedN} new, ${skipN} skipped (dup id/name/<0.5km)`);
  } else {
    console.warn('skip supplement 20261005: file missing');
  }
}

enrichV3Spots(spots);

// —— 省区字段 harmonize：tags[0] 为省区名且缺 province 者回填 province（与 2026-10-01 批次一致，满足"标注所在省区"）——
{
  const PROV = new Set(['北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆']);
  let nProv = 0;
  for (const s of spots) {
    if (!s.province && Array.isArray(s.tags) && PROV.has(s.tags[0])) { s.province = s.tags[0]; nProv += 1; }
  }
  if (nProv) console.log(`province backfilled from tags[0]: ${nProv}`);
}

const doc = {
  version: 3,
  updated: '2026-10-03',
  note: 'v3 纯扩展：六维分类/线路归属/左右侧/时段/可核验来源；v2 老数据语义不变（docs/scenic-schema-v3.md）。patches 见 scenic-spot-calibration-patches.json；2026-10-01 与 2026-10-03 并入全国扩充批次（含 province 字段）',
  spots,
};

writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`wrote ${spots.length} spots -> ${outPath}`);
console.log(
  'by visibility',
  Object.fromEntries(
    ['window', 'distant', 'on_track'].map((v) => [
      v,
      spots.filter((s) => s.visibility === v).length,
    ]),
  ),
);
