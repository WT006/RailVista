/**
 * 中国最美铁路 · 排行榜数据（纯展示，禁止改动 data/presets/**）。
 *
 * 数据来源与口径：
 *  - wtc2019   世界旅游轨道大会·文化30人论坛专家票选（2019，行业论坛票选）
 *  - xinhua2020 新华网《2020：坐着高铁看中国》专题（2020，央媒专题）
 *  - peoplerail 人民铁道报 / 中国铁路官媒定性合集（非统一评选）
 *  - editors    综合公开报道整理的编辑口碑榜（非官方评选）
 *
 * corridorId 与 data/presets/corridors/*.json 逐一核对；
 * `null` 表示仓库暂无对应走廊几何（金丽温、台湾纵贯线、北京 S2 线、嘉阳小火车、滇越铁路），
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
};

export type RankingSource = {
  name: string;
  year: number;
  url: string;
  /** 来源性质：票选 / 央媒专题 / 官方媒体定性 / 编辑整理 */
  nature: string;
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
        name: '台湾纵贯线',
        corridorId: null,
        from: '基隆',
        to: '高雄',
        tagline: '百年台铁古早味，穿行宝岛西部走廊',
        note: '暂无线路地图（数据不含台湾）',
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
  { label: '中国国家地理网《台湾环岛铁路》（专题）', url: 'http://www.dili360.com/cng/article/p6a87fa573107946.htm' },
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
