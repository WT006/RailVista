/**
 * 中国最美铁路 · 排行榜数据（纯展示，禁止改动 data/presets/**）。
 *
 * 数据来源与口径：
 *  - wtc2019   世界旅游轨道大会·文化30人论坛专家票选（2019，行业论坛票选）
 *  - xinhua2020 新华网《2020：坐着高铁看中国》专题（2020，央媒专题）
 *  - peoplerail 人民铁道报 / 中国铁路官媒定性合集（非统一评选）
 *  - editors    综合公开报道整理的编辑口碑榜（非官方评选）
 *  - slowtrain  国铁集团公益性慢火车（官方定性名录，非排名评选；名次为编辑按公开
 *               报道分量整理，口径见该专题 lead 与 reports）。总量数字必须带年份与出处，
 *               不能把 2020 年口径写成现状。
 *
 * corridorId 与 data/presets/corridors/*.json 逐一核对；
 * `null` 表示仓库暂无对应走廊几何（金丽温、中国台湾纵贯线、北京 S2 线、嘉阳小火车、滇越铁路），
 * UI 上弱化展示、不跳转详情页。
 *
 * 关于「按搜索量排名」：纯前端拿不到真实全网搜索量，**禁止伪造热度数据**。
 * 本期实现为「我的关注」本机点击计数 + Ranking.rankingType 扩展位，
 * 后续接真实统计时只需替换 readFocusCounts 的数据源。
 */

export type RankItem = {
  rank: number;
  name: string;
  /** 对应 data/presets/corridors/<id>.json；null = 暂无线路地图 */
  corridorId: string | null;
  from: string;
  to: string;
  tagline: string;
  lengthKm?: number;
  openedYear?: number;
  note?: string;
  /** 车次（如 5633/5634）：公益慢火车以车次为身份，展示在条目首行 */
  trainNo?: string;
  /** 票价口径（如「全程 21.5 元 / 最低 2 元」），须与来源一致 */
  fare?: string;
};

export type RankingSource = {
  name: string;
  year: number;
  url: string;
  /** 来源性质：票选 / 央媒专题 / 官方媒体定性 / 编辑整理 */
  nature: string;
};

/** 专题相关报道：官方媒体 / 央媒的可核验链接，UI 以「相关报道」列表展示 */
export type RankingReport = {
  title: string;
  outlet: string;
  /** 发表年月（如 2023-02） */
  date?: string;
  url: string;
  summary?: string;
};

/** 专题关键数据条：只放来源可核验的数字，label 里交代口径 */
export type RankingStat = {
  value: string;
  label: string;
};

/** 排名口径扩展位：后续接入真实统计（搜索量、收藏量…）时区分口径 */
export type RankingType = 'vote' | 'media' | 'official' | 'editorial' | 'custom';

export type Ranking = {
  id: string;
  title: string;
  subtitle: string;
  source: RankingSource;
  rankingType: RankingType;
  items: RankItem[];
  /** 专题导语（编辑撰写；事实须与 source / reports 口径一致） */
  lead?: string;
  /** 关键数据条，缺省不展示 */
  stats?: RankingStat[];
  /** 相关报道外链，缺省不展示 */
  reports?: RankingReport[];
};

export const RANKINGS: Ranking[] = [
  {
    id: 'wtc2019',
    title: '十大最受欢迎铁路旅游线路',
    subtitle: '世界旅游轨道大会·文化30人论坛 专家票选',
    source: {
      name: '世界旅游轨道大会·文化30人论坛（文汇报报道）',
      year: 2019,
      url: 'http://m.toutiao.com/group/6681564842567926284/',
      nature: '行业论坛票选',
    },
    rankingType: 'vote',
    items: [
      {
        rank: 1,
        name: '西成高铁',
        corridorId: 'xicheng',
        from: '西安',
        to: '成都',
        tagline: '首条穿越秦岭的高铁，把巴蜀山水与两座美食之城串成一线',
        lengthKm: 658,
        openedYear: 2017,
      },
      {
        rank: 2,
        name: '青藏铁路',
        corridorId: 'qingzang',
        from: '西宁',
        to: '拉萨',
        tagline: '世界海拔最高、冻土里程最长的「天路」，翻越唐古拉山口',
        lengthKm: 1956,
        openedYear: 2006,
      },
      {
        rank: 3,
        name: '京广高铁',
        corridorId: 'jingguang',
        from: '北京',
        to: '广州',
        tagline: '2294公里纵贯南北，八小时车窗看遍四季',
        lengthKm: 2294,
        openedYear: 2012,
      },
      {
        rank: 4,
        name: '兰新铁路',
        corridorId: 'lanxinxian',
        from: '兰州',
        to: '乌鲁木齐',
        tagline: '从河西走廊绿洲到大漠戈壁的极致跨越',
        lengthKm: 1903,
        note: '普速兰新线',
      },
      {
        rank: 5,
        name: '金丽温高铁',
        corridorId: null,
        from: '金华',
        to: '温州',
        tagline: '穿梭江南秘境：古堰画乡、云和梯田与横店影都',
        note: '暂无线路地图',
      },
      {
        rank: 6,
        name: '杭黄高铁',
        corridorId: 'hanghuang',
        from: '杭州',
        to: '黄山',
        tagline: '从西湖到黄山，串起7个5A景区的「颜值担当」',
        lengthKm: 265,
        openedYear: 2018,
      },
      {
        rank: 7,
        name: '粤海铁路',
        corridorId: 'zhanhai',
        from: '湛江',
        to: '海口',
        tagline: '中国唯一跨海铁路，火车「漂」过琼州海峡',
        note: '走廊为湛海线陆段，轮渡段无轨道数据',
      },
      {
        rank: 8,
        name: '大丽铁路',
        corridorId: 'kunli',
        from: '大理',
        to: '丽江',
        tagline: '近观苍山洱海，远眺玉龙雪山，两小时开进彩云之南',
        lengthKm: 164,
        note: '走廊为昆明—丽江整线（滇藏铁路大丽段），详情页用 ?from=大理&to=丽江 切片展示',
      },
      {
        rank: 9,
        name: '沪昆高铁',
        corridorId: 'hukun',
        from: '上海',
        to: '昆明',
        tagline: '跨省最多的高铁动脉，从江南水乡一路开进云贵高原',
        lengthKm: 2252,
        openedYear: 2016,
      },
      {
        rank: 10,
        name: '中国台湾纵贯线',
        corridorId: null,
        from: '基隆',
        to: '高雄',
        tagline: '百年台铁古早味，穿行宝岛西部走廊',
        note: '暂无线路地图（数据不含中国台湾）',
      },
    ],
  },
  {
    id: 'xinhua2020',
    title: '坐着高铁看中国',
    subtitle: '新华网 2020 国庆主题报道精选',
    source: {
      name: '新华网《2020：坐着高铁看中国》',
      year: 2020,
      url: 'http://www.xinhuanet.com/politics/2020-09/26/c_1126544580.htm',
      nature: '央媒专题',
    },
    rankingType: 'media',
    items: [
      {
        rank: 1,
        name: '京广高铁',
        corridorId: 'jingguang',
        from: '北京',
        to: '广州',
        tagline: '世界运营里程最长高铁，「中国黄金大动脉」',
        lengthKm: 2294,
      },
      {
        rank: 2,
        name: '京沪高铁',
        corridorId: 'jinghu',
        from: '北京',
        to: '上海',
        tagline: '一次建成里程最长、标准最高，纵贯七省市',
        lengthKm: 1318,
        openedYear: 2011,
      },
      {
        rank: 3,
        name: '哈大高铁',
        corridorId: 'haida',
        from: '哈尔滨',
        to: '大连',
        tagline: '世界首条高寒高铁，纵贯东北三省',
        lengthKm: 921,
        openedYear: 2012,
      },
      {
        rank: 4,
        name: '合福高铁',
        corridorId: 'hefu',
        from: '合肥',
        to: '福州',
        tagline: '「最美高铁」：黄山、婺源、三清山、武夷山一线串珠',
        lengthKm: 850,
        openedYear: 2015,
      },
      {
        rank: 5,
        name: '杭黄高铁',
        corridorId: 'hanghuang',
        from: '杭州',
        to: '黄山',
        tagline: '90分钟串起57处国家级风景的黄金旅游线',
        lengthKm: 265,
      },
      {
        rank: 6,
        name: '青藏铁路',
        corridorId: 'qingzang',
        from: '西宁',
        to: '拉萨',
        tagline: '神奇的「天路」，世界海拔最高的高原铁路',
        lengthKm: 1956,
      },
      {
        rank: 7,
        name: '贵广高铁',
        corridorId: 'guiguang',
        from: '贵阳',
        to: '广州',
        tagline: '桥隧比83%，高铁飞越十万大山直通大湾区',
        lengthKm: 857,
        openedYear: 2014,
      },
      {
        rank: 8,
        name: '成昆铁路',
        corridorId: 'chengkun',
        from: '成都',
        to: '昆明',
        tagline: '联合国认定的「20世纪人类征服自然三大奇迹」之一',
        lengthKm: 1085,
        openedYear: 1970,
      },
      {
        rank: 9,
        name: '京张高铁',
        corridorId: 'jingzhang',
        from: '北京',
        to: '张家口',
        tagline: '从百年京张到世界首条智能高铁的「争气路」',
        lengthKm: 174,
        openedYear: 2019,
      },
    ],
  },
  {
    id: 'peoplerail',
    title: '国铁官媒 · 最美高铁线',
    subtitle: '人民铁道 / 中国铁路 官方定性合集',
    source: {
      name: '人民铁道报 / 中国铁路（国铁集团官媒）',
      year: 2025,
      url: 'http://wap.china-railway.com.cn/xwzx/rdzt/zkgtkzg/qtmtbd/202010/t20201021_109920.html',
      nature: '官方媒体定性（非统一评选）',
    },
    rankingType: 'official',
    items: [
      {
        rank: 1,
        name: '合福高铁',
        corridorId: 'hefu',
        from: '合肥',
        to: '福州',
        tagline: '官宣「中国最美高铁」：全国4处双世遗此线占2席',
        lengthKm: 850,
      },
      {
        rank: 2,
        name: '杭黄高铁',
        corridorId: 'hanghuang',
        from: '杭州',
        to: '黄山',
        tagline: '官宣「黄金旅游线」：一洞一景、一站一景',
        lengthKm: 265,
      },
      {
        rank: 3,
        name: '张吉怀高铁',
        corridorId: 'zhangjihuai',
        from: '张家界',
        to: '怀化',
        tagline: '官方认证「湘西最美高铁」，90%桥隧比凌空飞渡',
        lengthKm: 246,
        openedYear: 2019,
      },
      {
        rank: 4,
        name: '沪昆高铁',
        corridorId: 'hukun',
        from: '上海',
        to: '昆明',
        tagline: '官媒「花海线」：从江南水乡穿越云贵高原',
        lengthKm: 2252,
      },
      {
        rank: 5,
        name: '京广高铁',
        corridorId: 'jingguang',
        from: '北京',
        to: '广州',
        tagline: '油菜花海与紫荆花潮同框的南北大动脉',
        lengthKm: 2294,
      },
    ],
  },
  {
    id: 'editors',
    title: '编辑精选 · 景观铁路',
    subtitle: '综合新华社 / 央视 / 澎湃等公开报道整理',
    source: {
      name: '综合公开报道整理',
      year: 2026,
      url: 'https://m.thepaper.cn/wifiKey_detail.jsp?contid=16042048',
      nature: '编辑整理（非官方评选）',
    },
    rankingType: 'editorial',
    items: [
      {
        rank: 1,
        name: '拉林铁路',
        corridorId: 'lalin',
        from: '拉萨',
        to: '林芝',
        tagline: '复兴号首进西藏，16次跨越雅鲁藏布江',
        lengthKm: 435,
        openedYear: 2021,
      },
      {
        rank: 2,
        name: '兰新高铁',
        corridorId: 'lanxin',
        from: '兰州',
        to: '乌鲁木齐',
        tagline: '风车海、盐湖与祁连雪峰的西北风光长廊',
        lengthKm: 1776,
        openedYear: 2014,
      },
      {
        rank: 3,
        name: '敦格铁路',
        corridorId: 'dunge',
        from: '敦煌',
        to: '格尔木',
        tagline: '穿沙越漠的「沙漠天路」，戈壁雅丹与沙山湖光',
        openedYear: 2019,
      },
      {
        rank: 4,
        name: '和若铁路',
        corridorId: 'heruo',
        from: '和田',
        to: '若羌',
        tagline: '世界环沙漠铁路环线的最后一块拼图',
        lengthKm: 825,
        openedYear: 2022,
      },
      {
        rank: 5,
        name: '拉日铁路',
        corridorId: 'lari',
        from: '拉萨',
        to: '日喀则',
        tagline: '向珠峰方向的雪域延伸，「离天空最近的铁路」',
        lengthKm: 253,
        openedYear: 2014,
      },
      {
        rank: 6,
        name: '湘黔铁路',
        corridorId: 'xiangqian',
        from: '株洲',
        to: '贵阳',
        tagline: '武陵群峰深谷中俯览镇远古城',
        lengthKm: 905,
        note: '普速干线（今沪昆线西段）',
      },
      {
        rank: 7,
        name: '敦白高铁',
        corridorId: 'dunbai',
        from: '敦化',
        to: '长白山',
        tagline: '穿越林海直抵长白山的「森林高铁」',
        openedYear: 2021,
      },
      {
        rank: 8,
        name: '北京S2线',
        corridorId: null,
        from: '黄土店',
        to: '延庆',
        tagline: '居庸关花海里的「开往春天的列车」',
        note: '暂无线路地图',
      },
      {
        rank: 9,
        name: '嘉阳小火车',
        corridorId: null,
        from: '乐山·芭沟',
        to: '石溪',
        tagline: '全球唯一仍在运营的客运窄轨蒸汽小火车，油菜花海中穿行',
        note: '暂无线路地图',
      },
      {
        rank: 10,
        name: '滇越铁路',
        corridorId: null,
        from: '昆明',
        to: '河口',
        tagline: '百年滇越米轨，穿行人字桥与滇南群山',
        note: '暂无线路地图',
      },
    ],
  },
  {
    id: 'slowtrain',
    title: '公益性慢火车',
    subtitle: '国铁 81 对口径 · 乡村振兴里的「慢」承诺',
    source: {
      name: '中国国家铁路集团《81对公益性"慢火车"跑出幸福加速度》',
      year: 2020,
      url: 'http://www.china-railway.com.cn/gsjs/shzr/202008/t20200805_107400.html',
      nature: '官方专题报道（名录与口径来自国铁集团，名次为编辑整理）',
    },
    rankingType: 'official',
    lead:
      '高铁把 8 小时压成 3 小时，中国铁路却保留着 81 对平均时速不足百公里的公益性「慢火车」：' +
      '在出行不便的革命老区、少数民族地区、边远山区与欠发达地区，票价低、站站停、速度慢，' +
      '执行 1995 年批准的普速运价，每公里不到 6 分钱，短途 1—2 元，几十年未调价。' +
      '国铁集团 2020 年口径是 21 个省区市、530 个车站；中国新闻网以 2024 年数据更新为 22 个省份、691 个站点，' +
      '累计发送脱贫地区旅客 9.9 亿人次（截至 2024 年 10 月）。《「十四五」现代综合交通运输体系发展规划》' +
      '（国发〔2021〕27号）写明「持续开好公益性‘慢火车’，优化开行方案，改善站车条件」；' +
      '2026 年 7 月国新办发布会上，国家铁路局再次明确在西南、东北等偏远山区持续保持开行。' +
      '它们不以盈利为目的，是山区群众赶集、上学、就医、卖货的生命线，' +
      '也是乡村振兴与区域协调发展中不被速度甩下的民生底线。' +
      '本专题名次由编辑按公开报道的覆盖广度与服务分量整理，非官方评选；' +
      '车次、里程与票价以下方「相关报道」为准，各官媒口径不一时取较新来源。',
    stats: [
      { value: '81 对', label: '公益性慢火车（国铁 2020 口径）' },
      { value: '22 省份', label: '开行覆盖（中新网 2024）' },
      { value: '691 个', label: '停靠站点（2024 数据）' },
      { value: '9.9 亿', label: '脱贫地区旅客累计人次' },
      { value: '不到 6 分', label: '每公里，1995 年运价' },
      { value: '1—2 元', label: '短途区间，数十年未调' },
    ],
    items: [
      {
        rank: 1,
        name: '大凉山 · 成昆铁路',
        corridorId: 'chengkun',
        from: '普雄',
        to: '攀枝花',
        trainNo: '5633/5634',
        fare: '最低 2 元 · 全程 26.5 元',
        tagline: '300 多公里 25 个站点逢站必停，羊群与书包同车，彝族群众的「流动村庄」跑了 50 余年',
      },
      {
        rank: 2,
        name: '秦岭 · 宝成铁路',
        corridorId: 'baocheng',
        from: '宝鸡',
        to: '广元',
        trainNo: '6063/6064',
        fare: '最低 4 元',
        tagline: '1958 年起翻越秦岭、每站必停，「通学车厢」与「惠农车厢」把学生和山货一起送出蜀道',
      },
      {
        rank: 3,
        name: '湘西 · 焦柳铁路',
        corridorId: 'jiaoliu',
        from: '怀化',
        to: '澧县',
        trainNo: '7266',
        fare: '最低 4 元',
        tagline: '381 公里「慢慢摇」摇了 30 年，5 号「农超车厢」免费帮农户直播带货，冰糖橙数万斤出山',
      },
      {
        rank: 4,
        name: '黔东南 · 湘黔铁路',
        corridorId: 'xiangqian',
        from: '贵阳',
        to: '玉屏',
        trainNo: '5639/5640',
        fare: '最低 2 元',
        tagline: '串起凯里、镇远与百余个村寨的「移动集市」，列车长胡贵川在车上干了 29 年，外销山货近 3 万斤',
      },
      {
        rank: 5,
        name: '武陵山 · 渝怀铁路',
        corridorId: 'yuhuai',
        from: '怀化',
        to: '梅江',
        trainNo: '7272/7271',
        fare: '最低 2 元',
        tagline: '178 公里跨湘黔渝三省市的「卖菜专列」，麻阳冰糖橙挑上肩就上车，日均两百多位果农菜农进城',
      },
      {
        rank: 6,
        name: '塔克拉玛干 · 南疆铁路',
        corridorId: 'nanjiang',
        from: '乌鲁木齐',
        to: '和田',
        trainNo: '7556/7557',
        fare: '区间最低 4 元',
        tagline: '1996 公里跑 33 个多小时，2012 年起「和田玉龙号」把巴扎搬上车厢，助农销售超百万元',
      },
      {
        rank: 7,
        name: '长白山 · 梅集铁路',
        corridorId: 'meiji',
        from: '通化',
        to: '集安',
        trainNo: '4347/4348',
        fare: '全程 16.5 元 · 最低 1 元',
        tagline: '115 公里山村「公交车」从 1939 年开到今天，初一十五的「列车大集」搬进车厢，驻村书记代言带货',
      },
      {
        rank: 8,
        name: '太行山 · 京原铁路',
        corridorId: 'jingyuan',
        from: '北京西',
        to: '大涧',
        trainNo: '6437/6438',
        fare: '全程 30.5 元 · 最低 4 元',
        tagline: '1972 年起站站停，252 公里穿 121 座隧道、跨 161 座桥，把京冀晋的山村连成一条线',
      },
      {
        rank: 9,
        name: '鲁中山区 · 辛泰铁路',
        corridorId: 'xintai',
        from: '淄博',
        to: '泰山',
        trainNo: '7053/7054',
        fare: '全程 11.5 元 · 最低 1 元',
        tagline: '开了五十余年的「庄户列车」，180 余公里走 4 个多小时，30 多年不涨价，赶集上学卖菜一站搞定',
      },
      {
        rank: 10,
        name: '大娄山 · 川黔铁路',
        corridorId: 'chuanqian',
        from: '重庆',
        to: '遵义西',
        trainNo: '5630/5629',
        fare: '全程 23.5 元',
        tagline: '1993 年起跑川黔线，桐梓站的清晨挤满挑背篓的菜农，山货两小时下山，票价按 1995 年标准至今未动',
      },
    ],
    reports: [
      {
        title: '两条钢轨 一种深情（高质量发展铁路万里行）',
        outlet: '人民铁道网（国铁官媒）',
        date: '2026-09-25',
        url: 'https://www.peoplerail.com/rail/show-2926-580214-1.html',
        summary: '大凉山 5633/5634 已运行 50 余年：全程 300 多公里、停靠 25 个站点、全程票价 26.5 元、最低 2 元。',
      },
      {
        title: '快时代，为何需要慢火车？',
        outlet: '中国新闻网',
        date: '2025-02-21',
        url: 'https://news.cri.cn/20250221/28814050-3881-3c72-c95a-1787e5511302.html',
        summary: '本专题数据口径：81 对平均时速不足百公里的公益性「慢火车」，覆盖 22 个省份、停靠 691 个站点（2024 年数据）。',
      },
      {
        title: '穿行山河的「慢」，是时代最深情的注脚',
        outlet: '经济日报',
        date: '2026-09-04',
        url: 'http://wap.ce.cn/cysc/jtys/tielu/202609/t20260904_3193864.shtml',
        summary: '「停靠 600 多个车站，覆盖 22 个省区市，最低票价仅 2 元」——发展不仅有速度，更有不让人掉队的温度。',
      },
      {
        title: '慢火车，承载着动人的中国温度',
        outlet: '新华社（光明网转载）',
        date: '2026-08-27',
        url: 'https://life.gmw.cn/2026-08/27/content_38968638.htm',
        summary: '影像长稿：大凉山 5633/5634、黔东南 5639/5640、武陵山 7272、南疆 7556/7557 的车厢日常。',
      },
      {
        title: '天山南北开来幸福「慢火车」',
        outlet: '人民铁道网（国铁官媒）',
        date: '2026-07-06',
        url: 'https://www.peoplerail.com/rail/show-2930-576788-1.html',
        summary: '乌鲁木齐—和田 7556/7557 次「和田玉龙号」：全程 1996 公里、单程 33 个多小时、区间最低票价 4 元。',
      },
      {
        title: '站站停的「慢」火车，串起山里村民的幸福',
        outlet: '环球时报',
        date: '2026-02-12',
        url: 'https://china.huanqiu.com/article/4QM61BA3wFL',
        summary: '京原线 6437/6438：252 公里 32 站、121 个隧道 161 座桥，全程 30.5 元、最低 4 元，跑了 50 多年。',
      },
      {
        title: '湖南最后的慢火车③｜7266 次「慢慢摇」',
        outlet: '红网',
        date: '2019-06-20',
        url: 'https://hn.rednet.cn/m/content/2019-06-20/5605801.html',
        summary: '焦柳线怀化—澧县的 7266 次：沿线乡镇村民的赶集车、学生车，也是「扶贫公益火车」。',
      },
      {
        title: '独立调查丨30多年不涨价，最低票价仅1元：这趟慢火车为什么还在开？',
        outlet: '大众网（大众日报）',
        date: '2026-10-04',
        url: 'https://www.dzwww.com/news/sddc/202610/t20261004_18177606.htm',
        summary: '以辛泰线 7053/7054 为切口算清「账面亏、账外赚」，并复核 81 对 / 21 个省区市 / 530 多站口径。',
      },
      {
        title: '新春走基层｜「慢火车」里的「年味」大集',
        outlet: '央广网',
        date: '2026-02-13',
        url: 'https://www.cnr.cn/sxpd/hmxc/20260213/t20260213_527525089.shtml',
        summary: '宝成线 6063/6064 穿行秦岭 68 载、每站必停；全程票价各报道不一，本榜只取「最低 4 元」。',
      },
      {
        title: '图片集｜4347次公益性慢火车为乡村振兴注入「新动力」',
        outlet: '人民网',
        date: '2024-07-11',
        url: 'http://world.people.com.cn/n1/2024/0711/c1002-40276033.html',
        summary: '「发现最美铁路·看百年梅集助力东北振兴」：通化—集安 115 公里，驻村书记代言、村民直播带货。',
      },
      {
        title: '国务院关于印发「十四五」现代综合交通运输体系发展规划的通知',
        outlet: '湖南省人民政府网（国发〔2021〕27号全文转发）',
        date: '2022-01-19',
        url: 'http://www.hunan.gov.cn/zqt/zcsd/202201/t20220119_22465624.html',
        summary: '政策原文：「持续开好公益性‘慢火车’，优化开行方案，改善站车条件。」',
      },
    ],
  },
];

/** 页面底部来源脚注（附录 C） */
export const RANKING_SOURCE_LINKS: Array<{ label: string; url: string }> = [
  { label: '世界旅游轨道大会票选（文汇报，2019-04）', url: 'http://m.toutiao.com/group/6681564842567926284/' },
  { label: '新华网《2020：坐着高铁看中国！》', url: 'http://www.xinhuanet.com/politics/2020-09/26/c_1126544580.htm' },
  { label: '新华网《坐着高铁看中国丨8分钟带你了解8条铁路线》', url: 'http://www.xinhuanet.com/politics/2020-09/30/c_1126564817.htm' },
  { label: '人民铁道报《合福杭黄 双线合璧绘就最美》（国铁集团官网）', url: 'http://wap.china-railway.com.cn/xwzx/rdzt/zkgtkzg/qtmtbd/202010/t20201021_109920.html' },
  { label: '人民铁道网《复兴号穿越花海！3条绝美高铁线》（2025-03）', url: 'https://www.peoplerail.com/rail/show-2688-79190-1.html' },
  { label: '人民铁道网「发现最美铁路」系列专题', url: 'https://www.peoplerail.com/rail/list-2001-1.html' },
  { label: '央视网《40条铁路贯穿你家乡的美景美食》（2019-10）', url: 'https://news.cctv.com/2019/10/29/ARTIkE2zDICEBg6CwHgtfDdj191029.shtml' },
  { label: '澎湃新闻《长白山进入高铁时代，国内还有这些最美列车》（2021）', url: 'https://m.thepaper.cn/wifiKey_detail.jsp?contid=16042048' },
  { label: '中国国家地理网《中国台湾环岛铁路》（专题）', url: 'http://www.dili360.com/cng/article/p6a87fa573107946.htm' },
];

export type RankingHit = { ranking: Ranking; item: RankItem };

/** 反查某条走廊出现在哪些榜单（详情页「所属榜单」徽章用） */
export function findRankingsByCorridor(corridorId: string): RankingHit[] {
  if (!corridorId) return [];
  const hits: RankingHit[] = [];
  for (const ranking of RANKINGS) {
    const item = ranking.items.find((i) => i.corridorId === corridorId);
    if (item) hits.push({ ranking, item });
  }
  return hits;
}

/** 榜单 + 线路名的稳定 key（「我的关注」计数用） */
export function focusKeyOf(rankingId: string, itemName: string): string {
  return `${rankingId}::${itemName}`;
}

export type FocusCounts = Record<string, number>;

const FOCUS_STORAGE_KEY = 'railvista:rankings:focus';

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 读取本机点击计数（不伪造全网热度，只反映「我关注过什么」） */
export function readFocusCounts(): FocusCounts {
  const ls = safeLocalStorage();
  if (!ls) return {};
  try {
    const raw = ls.getItem(FOCUS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as FocusCounts;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 条目点击时 +1；返回最新计数 */
export function bumpFocus(rankingId: string, itemName: string): FocusCounts {
  const ls = safeLocalStorage();
  const counts = readFocusCounts();
  const key = focusKeyOf(rankingId, itemName);
  counts[key] = (counts[key] || 0) + 1;
  if (ls) {
    try {
      ls.setItem(FOCUS_STORAGE_KEY, JSON.stringify(counts));
    } catch {
      /* 配额不足时静默降级：计数只是锦上添花 */
    }
  }
  return counts;
}

export function clearFocusCounts(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.removeItem(FOCUS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
