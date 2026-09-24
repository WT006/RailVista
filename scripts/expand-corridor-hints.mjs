// A2 走廊 stationsHint 扩充辅助：校验候选站在 stations-geo 有坐标且距折线 ≤12km
// 用法: node scripts/expand-corridor-hints.mjs            （检查模式，只打印）
//       node scripts/expand-corridor-hints.mjs --write    （通过校验的站合并进 hints）
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRailwayMetrics, projectToRailway } from '../packages/shared/dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corridorsDir = join(root, 'data/presets/corridors');
const geo = JSON.parse(readFileSync(join(root, 'data/stations-geo.json'), 'utf8'));

const WANT = process.argv.includes('--write');

/**
 * 候选 hints（按线补齐真实停靠/枢纽站，站序按线路走向）
 * 原则：只收「实际停靠/跨线枢纽」，不收「可能经过」的站（invariants）
 */
const CANDIDATES = {
  // 京广线（普速）：补株洲（京广↔沪昆枢纽）+ 沿线主要普速站
  jingguangxian: ['北京', '保定', '石家庄', '邢台', '邯郸', '安阳', '新乡', '郑州', '许昌', '漯河', '信阳', '汉口', '武昌', '岳阳', '长沙', '株洲', '衡阳', '郴州', '韶关东', '广州', '广州白云'],
  // 沪昆线（普速）：杭州南≠杭州西（K512 终到杭州南），补株洲东侧+杭州南
  hukunxian: ['上海', '嘉兴', '杭州南', '诸暨', '义乌', '金华', '衢州', '上饶', '鹰潭', '新余', '宜春', '萍乡', '株洲', '娄底', '怀化', '凯里', '贵阳', '安顺', '六盘水', '宣威', '曲靖', '昆明'],
  // 黎湛线：补河唇（河茂线起点，hemao∩lizhan 断链枢纽）
  lizhan: ['黎塘', '贵港', '玉林', '陆川', '河唇', '遂溪', '湛江'],
  // 兰新线（普速）：补河西走廊干线站
  lanxinxian: ['兰州', '河口南', '武威', '金昌', '张掖', '酒泉', '嘉峪关', '玉门', '柳园', '哈密', '鄯善', '吐鲁番', '乌鲁木齐'],
  // 京哈线（普速）：补沈阳北、四平（K553 类经停）
  jinghaxian: ['北京', '唐山北', '秦皇岛', '山海关', '锦州', '沈阳北', '四平', '长春', '哈尔滨'],
  // 海南东环：补美兰/文昌（C7871「没过美兰」）
  hainandong: ['海口', '海口东', '美兰', '文昌', '琼海', '博鳌', '万宁', '神州', '陵水', '亚龙湾', '三亚'],
  // 广珠城际：补珠海北（C7601 终点）及沿线城际站
  guangzhu: ['广州南', '顺德', '容桂', '南头', '小榄', '珠海北', '明珠', '珠海'],
};

for (const [id, candidates] of Object.entries(CANDIDATES)) {
  const file = join(corridorsDir, `${id}.json`);
  const c = JSON.parse(readFileSync(file, 'utf8'));
  const { path, lengthKm } = buildRailwayMetrics(c.railway);
  const existing = new Set((c.stationsHint || []).map((h) => h.replace(/站$/g, '').trim()));
  const pass = [];
  const report = [];
  for (const name of candidates) {
    const g = geo[name];
    if (!g || g.lng == null) {
      report.push(`  ✗ ${name}: stations-geo 无坐标`);
      continue;
    }
    const proj = projectToRailway(path, lengthKm, g.lng, g.lat);
    if (proj.distKm > 12) {
      report.push(`  ✗ ${name}: 距折线 ${proj.distKm.toFixed(1)}km >12`);
      continue;
    }
    const mark = existing.has(name) ? '·' : '+';
    pass.push(name);
    report.push(`  ${mark} ${name}: ${proj.distKm.toFixed(2)}km @ ${(proj.progress * 100).toFixed(0)}%`);
  }
  console.log(`[${id}] 候选 ${candidates.length}，通过 ${pass.length}`);
  for (const line of report) console.log(line);
  if (WANT && pass.length) {
    const merged = [];
    for (const h of pass) {
      if (!merged.some((x) => x.replace(/站$/g, '') === h.replace(/站$/g, ''))) merged.push(h);
    }
    c.stationsHint = merged;
    writeFileSync(file, JSON.stringify(c, null, 2) + '\n', 'utf8');
    console.log(`  → 已写入 ${merged.length} 个 hints`);
  }
  console.log('');
}