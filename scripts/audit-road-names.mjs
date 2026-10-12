/**
 * 万里路书 · 省道/县乡道名字审查（scripts/audit-road-names.mjs）
 *
 * 目的：全量扫描 data/roads/index/provincial.json 的 name 字段，按错乱模式分类统计：
 *   C1 垃圾名：含地图页脚/抓取噪声特征（经度：/审图号/地图纠错/高清版/NavInfo…）
 *   C2 同义反复：name 数字与 ref 相同且含"省道/Provincial/Hwy"等词，或纯编号名（展示冗余）
 *   C3 多语言混杂：name 含维吾尔文/藏文等非中文区段
 *   C4 高速段名：name 含"高速/支线/联络线/绕城"（省级高速挂 S 编号，合理性人工判断）
 *   C5 纯编号名：name 本身就是编号变体
 *   C6 空名：无 name
 * 输出：data/roads/reports/road-names-{date}.json
 *
 * 用法：
 *   node scripts/audit-road-names.mjs            # 审计并输出报告
 *   node scripts/audit-road-names.mjs --samples 20
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const IDX = join(ROOT, 'data/roads/index/provincial.json');
const OUT_DIR = join(ROOT, 'data/roads/reports');

const args = process.argv.slice(2);
const sampleN = args.includes('--samples') ? Number(args[args.indexOf('--samples') + 1]) || 10 : 10;
const date = new Date().toISOString().slice(0, 10);

const idx = JSON.parse(readFileSync(IDX, 'utf8'));
const roads = idx.roads ?? idx;
if (!Array.isArray(roads)) {
  console.error('index/provincial.json 结构异常：无 roads 数组');
  process.exit(1);
}

const GARBAGE_RE = /经度：|纬度：|审图号|地图纠错|高清版|NavInfo|自然资源部|切换至传统版/;
const SYNONYM_WORDS_RE = /省道|Provincial|Hwy|Highway/i;
const MULTI_LANG_RE = /[\u0600-\u06FF\u0F00-\u0FFF\u1000-\u109F]/;
const HWY_RE = /高速|支线|联络线|绕城|连接线/;
const digitsOf = (s) => (String(s).match(/\d+/g) ?? []).join('').replace(/^0+/, '');
const isBareRefLike = (name, ref) => {
  const a = String(name).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const b = String(ref).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!a) return false;
  if (a === b) return true;
  return /^[A-Z]\d+$/.test(a) && digitsOf(a) === digitsOf(b);
};

const buckets = { C1_garbage: [], C2_synonym: [], C3_multilang: [], C4_hwyname: [], C5_bareRef: [], C6_noName: [] };
let okNamed = 0;

for (const r of roads) {
  const name = r.name ?? '';
  const ref = r.ref ?? '';
  if (!name) {
    buckets.C6_noName.push(r.key);
    continue;
  }
  if (GARBAGE_RE.test(name)) {
    buckets.C1_garbage.push({ key: r.key, name });
  } else if (
    (digitsOf(name) && digitsOf(name) === digitsOf(ref) && SYNONYM_WORDS_RE.test(name)) ||
    isBareRefLike(name, ref)
  ) {
    buckets.C2_synonym.push({ key: r.key, name });
  } else if (MULTI_LANG_RE.test(name)) {
    buckets.C3_multilang.push({ key: r.key, name });
  } else if (HWY_RE.test(name)) {
    buckets.C4_hwyname.push({ key: r.key, name });
  } else {
    okNamed += 1;
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  date,
  total: roads.length,
  okNamed,
  counts: {
    C1_garbage: buckets.C1_garbage.length,
    C2_synonym: buckets.C2_synonym.length,
    C3_multilang: buckets.C3_multilang.length,
    C4_hwyname: buckets.C4_hwyname.length,
    C6_noName: buckets.C6_noName.length,
  },
  samples: Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [k, v.slice(0, sampleN)]),
  ),
};

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, `road-names-${date}.json`);
writeFileSync(out, JSON.stringify(summary, null, 1) + '\n');

console.log('== 名字审查（provincial）==');
console.log(`总条数 ${summary.total} · 正常名 ${okNamed}`);
for (const [k, v] of Object.entries(summary.counts)) console.log(`  ${k}: ${v}`);
console.log(`→ ${out}`);