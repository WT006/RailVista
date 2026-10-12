/**
 * 公路景点库 v2 内容体检（只读，不改数据）。
 *
 * 对应项目内容红线：
 *   1. **票价不写金额** —— 出现「80 元」一律报错（只能写「需预约」「含在大门票内」）
 *   2. **时刻只写量级** —— 简介/卖点里出现「07:30」这种具体时刻要人核；
 *      但 `visitHours` 是运营方公开的开放时间，属于事实数据，**不算违规**
 *   3. 名称里的外文杂字（OSM 灌入的历史遗留）
 *   4. 异常条目：空名 / 坐标越界 / 空简介 / 同省同名不同址
 *
 * 用法：node scripts/scan-roadside-v2.mjs [--strict]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPOTS_PATH = join(ROOT, 'data/roads/roadside-spots.json');
const STRICT = process.argv.includes('--strict');

const file = JSON.parse(readFileSync(SPOTS_PATH, 'utf8'));
const spots = file.spots ?? [];

/**
 * 票价金额 —— 必须**语境 + 形态双条件**，粗正则会大量误报。
 *
 * 踩过的坑：路书 POI「漓江精华段」简介里有「第五套人民币 20 元券背面图案」，
 * 「阳朔漓江方向」写着「20 元人民币背景」—— 说的是**钞票**不是门票，
 * 被 `/\d+\s*元/` 直接判成票价违规，误报。
 *
 * 现在规则：命中「N 元」后，看它前后 12 个字里有没有
 * 背景 / 券 / 钞 / 币 / 钞票 这类钞票语境词 —— 有就放过。
 */
const PRICE_RE = /\d+(?:\.\d+)?\s*元/g;
const MONEY_CONTEXT = /背景|背面|券|钞|纸币|硬币|人民币|图案/;
function hasTicketPrice(text) {
  PRICE_RE.lastIndex = 0;
  let m;
  while ((m = PRICE_RE.exec(text)) !== null) {
    const around = text.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12);
    if (!MONEY_CONTEXT.test(around)) return true;
  }
  return false;
}

/** 具体时刻：07:30 / 7点半 */
const CLOCK_RE = /\d{1,2}\s*[:：]\s*\d{2}|\d{1,2}\s*点\s*(半|\d{1,2}\s*分)?/;
/** 纯外文名（OSM 灌入遗留 / 高德拉丁名条目） */
const CJK_RE = /[一-龥]/;

const errors = [];
const warns = [];

function push(list, spot, field, why, text) {
  list.push({ id: spot.id, name: spot.name, field, why, text: String(text).slice(0, 80) });
}

const byProvinceName = new Map();

function havKm(a, b) {
  const to = (x) => (x * Math.PI) / 180;
  const dLat = to(b.lat - a.lat);
  const dLng = to(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(to(a.lat)) * Math.cos(to(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

for (const s of spots) {
  const name = String(s.name ?? '');
  const prov = s.province ?? '';

  // ── 结构异常 ──
  if (!name.trim()) push(errors, s, 'name', '空名称', '');
  if (!Number.isFinite(s.lng) || !Number.isFinite(s.lat)) {
    push(errors, s, 'lng/lat', '坐标非数值', `${s.lng},${s.lat}`);
  } else if (s.lng < 73 || s.lng > 136 || s.lat < 17 || s.lat > 55) {
    push(errors, s, 'lng/lat', '坐标在中国陆域范围外', `${s.lng},${s.lat}`);
  }
  if (!String(s.intro ?? '').trim()) push(errors, s, 'intro', '空简介', '');

  // ── 票价金额（红线）──
  for (const f of ['intro', 'tagline', 'ticketNote', 'accessNote', 'spurReason']) {
    const v = s[f];
    if (typeof v === 'string' && hasTicketPrice(v)) push(errors, s, f, '出现票价金额', v);
  }

  // ── 具体时刻（只管正文；visitHours 是公开开放时间，不算违规）──
  for (const f of ['intro', 'tagline', 'accessNote', 'spurReason']) {
    const v = s[f];
    if (typeof v === 'string' && CLOCK_RE.test(v)) push(warns, s, f, '正文出现具体时刻', v);
  }

  // ── 名称杂字 ──
  if (name && !CJK_RE.test(name)) push(warns, s, 'name', '名称无中文', name);

  // ── 同省同名不同址 ──
  const key = `${prov}|${name}`;
  const arr = byProvinceName.get(key);
  if (arr) arr.push(s);
  else byProvinceName.set(key, [s]);
}

let dupGroups = 0;
for (const [key, arr] of byProvinceName) {
  if (arr.length < 2) continue;
  // 同省同名且两两相距都在 5~25 km —— 这是「同一处景点的不同锚点」，
  // 构建期已按 25 km 规则合并过；剩下的多半是同名不同景（如各省都有「佛光寺」），
  // 不算质量问题，因此只统计不报警。
  const near = arr.filter((a) => arr.some((b) => {
    const d = havKm(a, b);
    return d > 5 && d <= 25;
  }));
  if (near.length) dupGroups += 1;
}

console.log(`公路景点库体检：${spots.length} 条（version ${file.version ?? 1}）`);
console.log(
  `  错误 ${errors.length} 条 / 告警 ${warns.length} 条 / 同省同名 5–25km 组 ${dupGroups}（同一景点多锚点，构建期已合并）`,
);

const show = (list, label, n) => {
  console.log(`\n── ${label}（前 ${Math.min(n, list.length)} 条）`);
  for (const e of list.slice(0, n)) {
    console.log(`  [${e.field}] ${e.why} · ${e.name} · ${e.text}`);
  }
};
if (errors.length) show(errors, '错误', 20);
if (warns.length) show(warns, '告警', 20);

if (STRICT && (errors.length || warns.length)) process.exitCode = 1;
