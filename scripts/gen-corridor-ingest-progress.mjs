/**
 * 生成「已入库 / 待入库」进度文档。
 *   node scripts/gen-corridor-ingest-progress.mjs
 *
 * 输入：
 *   - data/presets/corridors/*.json
 *   - docs/corridor-coverage-gap-todo.csv
 * 输出：
 *   - docs/corridor-ingest-progress.md
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrDir = join(root, 'data/presets/corridors');
const csvPath = join(root, 'docs/corridor-coverage-gap-todo.csv');
const outPath = join(root, 'docs/corridor-ingest-progress.md');

/** 文档线路名 → 走廊 id（补网后请维护） */
const NAME_TO_ID = {
  京津城际: 'jingjin',
  沪宁城际: 'huning',
  沪苏湖高铁: 'husuhu',
  济青高铁: 'jiqing',
  常益长高铁: 'changyichang',
  昌九城际: 'changjiu',
  盘营高铁: 'panying',
  津秦高铁: 'jinqin',
  石太客专: 'shitai',
  石济客专: 'shiji',
  合蚌高铁: 'hebang',
  南广铁路: 'nanguang',
  渝万城际: 'yuwan',
  甬台温铁路: 'yongtaiwen',
  连镇高铁: 'lianzhen',
  哈齐高铁: 'haqi',
  // P0 OSM/切片第三批
  安九高铁: 'anjiu',
  昌赣高铁: 'changgan',
  赣深高铁: 'ganshen',
  向莆铁路: 'xiangpu',
  赣龙铁路: 'ganlong',
  温福铁路: 'wenfu',
  京沈高铁: 'jingshen',
  太焦高铁: 'taijiao',
  郑焦城际: 'zhengjiao',
  茂湛铁路: 'maozhan',
  呼张高铁: 'zhanghu', // 与张呼同线
  汉宜铁路: 'hanyi',
  秦沈客专: 'qinshen',
  龙厦铁路: 'longxia',
  深茂铁路: 'shenmao',
  青连铁路: 'qinglian',
  大张高铁: 'dazhang',
  黔张常铁路: 'qianzhangchang',
  广西沿海铁路: 'guangxiyanhai',
  湘桂铁路扩能: 'xiangguikuoneng',
  青盐铁路: 'qingyan',
  牡绥铁路: 'musui',
  呼准鄂铁路: 'huzhune',
  包兰线: 'baolan',
  滨洲线: 'binzhou',
  京沪线: 'jinghuxian',
  京哈线: 'jinghaxian',
  京广线: 'jingguangxian',
  京九线: 'jingjiu',
  沪昆线: 'hukunxian',
  焦柳线: 'jiaoliu',
  沪通铁路: 'hutong',
  // 早期已有（与 gap 名对齐）
  京沪高铁: 'jinghu',
  京广高铁: 'jingguang',
  京哈高铁: 'jingha',
  沪昆高铁: 'hukun',
  兰新高铁: 'lanxin',
  徐兰高铁: 'xulan',
  哈大高铁: 'haida',
  厦深铁路: 'xiashen',
  厦深高铁: 'xiashen',
  青荣城际: 'qingrong',
  合福高铁: 'hefu',
  杭昌高铁: 'hangchang',
  杭台高铁: 'hangtai',
  杭温高铁: 'hangwen',
  杭黄高铁: 'hanghuang',
  沪杭高铁: 'huhang',
  宁杭高铁: 'ninghang',
  福厦高铁: 'fuxia',
  广深港高铁: 'guangshengang',
  沪宁沿江高铁: 'huningyanjiang',
  郑渝高铁: 'zhengyu',
  成渝高铁: 'chengyu',
  成渝线: 'chengyuxian',
  汉丹线: 'handan',
  宁蓉铁路: 'ningrong',
  成贵高铁: 'chenggui',
  渝贵铁路: 'yugui',
  贵广高铁: 'guiguang',
  贵南高铁: 'guinan',
  南昆高铁: 'nankun',
  大西高铁: 'daxi',
  西成高铁: 'xicheng',
  银西高铁: 'yinxi',
  银兰高铁: 'yinlan',
  郑太高铁: 'zhengtai',
  郑阜高铁: 'zhengfu',
  日兰高铁: 'rilan',
  商合杭高铁: 'shanghehang',
  徐连高铁: 'xulian',
  盐通高铁: 'yantong',
  张吉怀高铁: 'zhangjihuai',
  京张高铁: 'jingzhang',
  张呼高铁: 'zhanghu',
  哈牡高铁: 'hamu',
  海南东环高铁: 'hainandong',
  海南西环高铁: 'hainanxi',
  青藏铁路: 'qingzang',
  拉林铁路: 'lalin',
  拉日铁路: 'lari',
  敦白高铁: 'dunbai',
  敦格铁路: 'dunge',
  格库铁路: 'geku',
  池黄高铁: 'chihuang',
  福平铁路: 'fuping',
  川青铁路: 'chuanqing',
  宜万铁路: 'yiwan',
  渝利铁路: 'yuli',
  湘黔铁路: 'xiangqian',
  临哈铁路: 'linha',
  滇越铁路: 'diandong',
  丽香铁路: 'lixiang',
  昆丽: 'kunli',
  中老铁路: 'zhonglao',
  宝成铁路: 'baocheng',
  成昆铁路: 'chengkun',
  南疆铁路: 'nanjiang',
  集通铁路: 'jitong',
  和若铁路: 'heruo',
  兰渝铁路: 'lanyu',
  沈佳高铁敦白段: 'dunbai',
  // P1 城际批次
  成绵乐城际铁路: 'chengmianle',
  广珠城际铁路: 'guangzhu',
  汉十高铁: 'hanshi',
  宁安城际铁路: 'ningan',
  长珲城际: 'changhui',
  郑开城际: 'zhengkai',
  胶济客运专线: 'jiaojikezhuan',
  广深城际铁路: 'guangshenchengji',
  // P2/P3 本批
  广清城际铁路: 'guangqing',
  广肇城际铁路: 'guangzhao',
  京唐城际铁路: 'jingtang',
  京雄城际铁路: 'jingxiong',
  潍莱高铁: 'weilai',
  武冈城际: 'wugang',
  武咸城际: 'wuxian',
  武孝城际: 'wuxiao',
  郑机城际: 'zhengji',
  穗深城际铁路: 'suishen',
  广州东环城际铁路: 'guangzhoudonghuan',
  龙漳铁路: 'longzhang',
  成雅铁路: 'chengya',
  广惠城际铁路: 'guanghui',
  成灌铁路: 'chengguan',
  // P2/P3 已过 strict（原 DEFER 误判/已修）
  南龙铁路: 'nanlong',
  崇礼铁路: 'chongli',
  金建高铁: 'jinjian',
  津蓟城际铁路: 'jinji',
  琶莲城际铁路: 'palian',
  // 文档名 ↔ 已有走廊（勿重复抽）
  合杭城际: 'shanghehang',
  鲁南高铁: 'rilan',
  // 普速石太（客专另有 shitai）
  石太线: 'shitai_xian',
  // 本批过 strict
  漯宝线: 'luobao',
  牡佳高铁: 'mujia',
  武石城际: 'wushi',
  川南城际铁路: 'chuannan',
  枝柳线: 'zhililu',
  集二线: 'jier',
  武大线: 'wuda',
  额哈铁路: 'eha',
  哈秦段: 'haqin',
  盘兴高铁: 'panxing',
  // 成蒲含在成雅至朝阳湖
  成蒲铁路: 'chengya',
  // P0 高铁补洞（2026-09-19）
  潍烟高铁: 'weiyan',
  杭甬高铁: 'hangyong',
  合宁铁路: 'heining',
  合武铁路: 'hewu',
  // P0 普速 OSM/名过滤（2026-09-19）
  陇海线: 'longhai',
  兰新线: 'lanxinxian',
  兰青铁路: 'lanqing',
  宁启铁路: 'ningqi',
  同蒲线: 'tongpu',
  宁西线: 'ningxi',
  襄渝线: 'xiangyu',
  鹰厦线: 'yingxia',
  渝怀铁路: 'yuhuai',
  // P1 普速名过滤（2026-09-19）
  石德线: 'shide',
  蓝烟线: 'lanyan',
  京原线: 'jingyuan',
  侯西线: 'houxi',
  阳安线: 'yangan',
  西康线: 'xikang',
  广茂线: 'guangmao',
  阜淮线: 'fuhuai',
  武九线: 'wujiu',
  达成铁路: 'dacheng',
  胶济线: 'jiaojixian',
  铜九铁路: 'tongjiu',
  沈丹线: 'shendan',
  滨绥线: 'binsui',
  达万线: 'dawan',
  邯黄铁路: 'hanhuang',
  丰沙线: 'fengsha',
  兖石线: 'yanshi',
  胶新线: 'jiaoxin',
  拉滨线: 'labin',
  京通线: 'jingtong',
  南昆线: 'nankunxian',
  包西线: 'baoxi',
  川黔线: 'chuanqian',
  邯长线: 'hanchang',
  邯济线: 'hanji',
  辛泰线: 'xintai',
  新兖线: 'xinyan',
  麻武线: 'mawu',
  鸦宜线: 'yayi',
  水蚌线: 'shuibang',
  太焦线: 'taijiao_conv',
  河茂线: 'hemao',
  嘉镜线: 'jiajing',
  漳泉肖线: 'zhangquan',
  干武线: 'ganwu',
  宣杭线: 'xuanhang',
  宁芜线: 'ningwu',
  淮南线: 'huainan',
  黔桂铁路: 'qiangui',
  黎湛线: 'lizhan',
  长图线: 'changtu',
  遂渝铁路: 'suiyu',
  内昆线: 'neikun',
  贵昆线: 'guikun',
  皖赣线: 'wangang',
  新长线: 'xinchang',
  通让线: 'tongrang',
  牡图线: 'mutu',
  宝中线: 'baozhong',
  西平线: 'xiping',
  侯月线: 'houyue',
  奎北铁路: 'kuibei',
  北阿铁路: 'beia',
  敦煌线: 'dunhuang',
  衡柳铁路: 'hengliu',
  赣瑞龙铁路: 'ganruilong',
  武九客运专线: 'wujiukezhuan',
  来福线: 'laifu',
  柳南城际: 'liunan',
  梅集线: 'meiji',
  // 本批：Dijkstra head-exit reverse 修复后过 strict
  平齐线: 'pingqi',
  杭衢高铁: 'hangqu',
  // 包西扩能与普速包西同廊（hsr 扩能段本地仍空）
  包西铁路扩能: 'baoxi',
  广梅汕线: 'guangmeishan',
  哈佳铁路: 'hajia',
  北疆线: 'beijiang',
  太中银铁路: 'taizhongyin',
  // 原 DEFER 清零（2026-09-20）
  广湛高铁: 'guangzhan',
  京滨城际铁路: 'jingbin',
  佛莞城际铁路: 'fowan',
  广佛环线: 'guangfohuan',
  // 组合名：不另建超长合并线，映射到已入库分干线
  '陇海—兰新线': 'longhai',
  '同蒲—太焦—焦柳线': 'tongpu',
};

/** 明确暂缓原因（文档名）——已清空 */
const DEFER = {};

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).slice(1);
  return lines.map((line) => {
    const cols = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') {
        q = !q;
        continue;
      }
      if (ch === ',' && !q) {
        cols.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    cols.push(cur);
    return {
      priority: cols[0],
      part: cols[1],
      name: cols[2],
      section: cols[3],
      source: cols[4],
    };
  });
}

function loadCorridors() {
  return readdirSync(corrDir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => {
      const c = JSON.parse(readFileSync(join(corrDir, f), 'utf8'));
      const id = c.id || f.replace(/\.json$/, '');
      const hint = Array.isArray(c.stationsHint) ? c.stationsHint : [];
      const od =
        hint.length >= 2 ? `${hint[0]}→${hint.at(-1)}` : hint[0] || '';
      return {
        id,
        name: c.name || id,
        source: String(c.source || '').slice(0, 48),
        od,
        pts: c.railway?.length || 0,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function matchId(docName, byId, byName) {
  if (NAME_TO_ID[docName] && byId[NAME_TO_ID[docName]]) {
    return NAME_TO_ID[docName];
  }
  // exact corridor display name
  if (byName[docName]) return byName[docName];
  // 显式暂缓优先于模糊匹配（避免 梅汕线 误标 广梅汕线）
  if (DEFER[docName]) return null;
  // fuzzy: corridor name contains doc name or reverse
  for (const [n, id] of Object.entries(byName)) {
    const base = n.replace(/高铁$|铁路$|客专$|城际$|线$/, '');
    if (!base || base.length < 2) continue;
    if (n.includes(docName) || docName.includes(base)) {
      // avoid 京沪线 matching 京沪高铁
      if (/线$/.test(docName) && /高铁|客专|城际/.test(n)) continue;
      if (/高铁|客专|城际/.test(docName) && /线$/.test(n) && !/铁路$/.test(n)) continue;
      // avoid 焦柳线 matching 同蒲—太焦—焦柳线（复合长名）
      if (docName.includes(base) && docName !== n && docName.length > n.length + 2) continue;
      // 短名被长名包含：要求走廊名几乎等于文档名（防 梅汕→广梅汕）
      if (docName.includes(base) && docName !== n && docName.length >= base.length + 2) continue;
      return id;
    }
  }
  return null;
}

const corridors = loadCorridors();
const byId = Object.fromEntries(corridors.map((c) => [c.id, c]));
const byName = Object.fromEntries(corridors.map((c) => [c.name, c.id]));

const gapRows = existsSync(csvPath) ? parseCsv(readFileSync(csvPath, 'utf8')) : [];

const gapStatus = gapRows.map((r) => {
  const id = matchId(r.name, byId, byName);
  let status = '待入库';
  let note = '';
  if (id) {
    status = '已入库';
    note = id;
  } else if (DEFER[r.name]) {
    status = '暂缓';
    note = DEFER[r.name];
  } else if (/禁止 hsr|OSM（多客货|OSM（禁止/.test(r.source)) {
    status = '暂缓';
    note = 'C：需 china-rail PBF / 普速 OSM';
  } else {
    status = '待入库';
    note = 'B/D：待 OSM 或 hsr';
  }
  return { ...r, id, status, note };
});

const today = new Date().toISOString().slice(0, 10);
const counts = {
  corridors: corridors.length,
  gap: gapRows.length,
  done: gapStatus.filter((x) => x.status === '已入库').length,
  pending: gapStatus.filter((x) => x.status === '待入库').length,
  defer: gapStatus.filter((x) => x.status === '暂缓').length,
};

const byPri = {};
for (const r of gapStatus) {
  byPri[r.priority] ??= { done: 0, pending: 0, defer: 0, rows: [] };
  byPri[r.priority][r.status === '已入库' ? 'done' : r.status === '暂缓' ? 'defer' : 'pending'] += 1;
  byPri[r.priority].rows.push(r);
}

function tableGap(rows) {
  const lines = [
    '| 状态 | 优先级 | 类型 | 线路 | 走廊 id | 备注 |',
    '|---|---|---|---|---|---|',
  ];
  const order = { 已入库: 0, 待入库: 1, 暂缓: 2 };
  const sorted = [...rows].sort(
    (a, b) =>
      (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
      a.name.localeCompare(b.name, 'zh'),
  );
  for (const r of sorted) {
    lines.push(
      `| ${r.status} | ${r.priority} | ${r.part} | ${r.name} | ${r.id ? `\`${r.id}\`` : '—'} | ${r.note || ''} |`,
    );
  }
  return lines.join('\n');
}

function tableCorridors(rows) {
  const lines = [
    '| id | 名称 | OD hints | 点数 | source |',
    '|---|---|---|---|---|',
  ];
  for (const c of rows) {
    lines.push(
      `| \`${c.id}\` | ${c.name} | ${c.od || '—'} | ${c.pts} | ${c.source || '—'} |`,
    );
  }
  return lines.join('\n');
}

const priSummary = ['P0', 'P1', 'P2', 'P3']
  .filter((p) => byPri[p])
  .map((p) => {
    const x = byPri[p];
    return `| ${p} | ${x.done} | ${x.pending} | ${x.defer} | ${x.done + x.pending + x.defer} |`;
  })
  .join('\n');

const md = `# 走廊入库进度（已入库 / 待入库）

> **维护入口：** 入库或暂缓后跑 \`node scripts/gen-corridor-ingest-progress.mjs\` 重生成本文。  
> 对照缺口全表：[\`corridor-coverage-gap.md\`](./corridor-coverage-gap.md) · 校准日志：[\`corridor-calibration-log.md\`](./corridor-calibration-log.md)  
> 更新日：${today}

## 总览

| 项 | 数量 |
|---|---|
| 磁盘已有走廊 JSON | **${counts.corridors}** |
| 文档待覆盖条目（gap CSV） | ${counts.gap} |
| 其中已映射入库 | **${counts.done}** |
| 仍待入库 | **${counts.pending}** |
| 暂缓 | **${counts.defer}** |

### 按优先级

| 优先级 | 已入库 | 待入库 | 暂缓 | 合计 |
|---|---|---|---|---|
${priSummary}

### 状态说明

| 状态 | 含义 |
|---|---|
| 已入库 | \`data/presets/corridors/{id}.json\` 存在，且已映射到文档线路名 |
| 待入库 | 文档有、库中尚无对应走廊，且未标暂缓 |
| 暂缓 | 源空/OSM 不稳/需 PBF 普速图等，暂不硬抽 |

---

## 文档缺口进度（P0–P3）

${tableGap(gapStatus)}

---

## 库内全部走廊（${counts.corridors}）

${tableCorridors(corridors)}

---

## 维护约定

1. 新线过 \`verify --strict\`（或仅旧债失败）并写入 \`corridors/\` 后，把文档名→id 补进 \`scripts/gen-corridor-ingest-progress.mjs\` 的 \`NAME_TO_ID\`（若自动匹配不到）。
2. 明确暂缓的写入 \`DEFER\`。
3. 重跑本脚本；必要时同步改 \`corridor-coverage-gap.md\` 进度摘要。
`;

writeFileSync(outPath, md);
console.log('wrote', outPath);
console.log(
  `corridors=${counts.corridors} gapDone=${counts.done} pending=${counts.pending} defer=${counts.defer}`,
);
