/**
 * 万里路书 · 全国公路旅游网 —— 权威名录抓取（PRD §3 Step 1）。
 *
 * 来源：《国家公路网规划》（2022 年 7 月，国务院批复，国家发改委印发）
 *       https://www.gov.cn/zhengce/zhengceku/2022-07/12/5700633/files/1ca992f13a81434b89e222eb000acada.pdf
 * 附件 1 = 国家高速公路网路线方案表（7 射 + 11 纵 + 18 横 + 6 地区环 + 12 都市圈环
 *           + 30 城市绕城 + 31 并行 + 163 联络 = 278 条）
 * 附件 2 = 普通国道网路线方案表（12 射 + 47 纵 + 60 横 + 182 联络 = 301 条）
 *
 * 用法：node scripts/fetch-plan-2022.mjs
 * 产物：data/roads/authoritative/plan-2022-national.json
 *       data/roads/authoritative/plan-2022-expressway.json
 * 依赖：node ≥ 20（内置 fetch）；PDF 解析用 pdf-parse（若未安装到 tmp/pdf-tools 则自动跳过解析步骤）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const AUTH_DIR = join(ROOT, 'data/roads/authoritative');
const PDF_CACHE = join(ROOT, 'tmp/national-road-plan-2022.pdf');
const PLAN_URL =
  'https://www.gov.cn/zhengce/zhengceku/2022-07/12/5700633/files/1ca992f13a81434b89e222eb000acada.pdf';

// ── 下载（缓存命中不重复请求） ───────────────────────────────────────────────
async function ensurePdf() {
  if (existsSync(PDF_CACHE)) {
    console.log('PDF 缓存命中：tmp/national-road-plan-2022.pdf');
    return;
  }
  console.log('下载《国家公路网规划》(2022)…');
  const res = await fetch(PLAN_URL, {
    headers: { 'User-Agent': 'RailVista/0.4.0 (plan-fetcher)' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  mkdirSync(dirname(PDF_CACHE), { recursive: true });
  writeFileSync(PDF_CACHE, Buffer.from(await res.arrayBuffer()));
  console.log(`已下载 ${(existsSync(PDF_CACHE) ? readFileSync(PDF_CACHE).length : 0) / 1024 / 1024} MB → ${PDF_CACHE}`);
}

// ── PDF → 文本 ───────────────────────────────────────────────────────────────
async function pdfText() {
  let pdfParse;
  try {
    pdfParse = (await import('../tmp/pdf-tools/node_modules/pdf-parse/lib/pdf-parse.js')).default;
  } catch {
    throw new Error('缺少 pdf-parse：先运行 npm.cmd install pdf-parse --prefix tmp/pdf-tools');
  }
  const parsed = await pdfParse(readFileSync(PDF_CACHE));
  return parsed.text;
}

// ── 表格行解析 ───────────────────────────────────────────────────────────────
/**
 * 起讫点与控制点在 PDF 提取文本中连在一起（如「北京－哈尔滨北京、宝坻、…」），
 * 控制点必以起点名开头并用「、」分隔，据此拆分：
 *   origin = 首个「－」之前；OD = 起点 + 「－」+ 到「origin、」出现处为止。
 * 环线（无「－」）的名称以「环线」结尾，控制点紧跟其后。
 */
function splitOdControls(s) {
  // 归一化：半角连字符 → 全角破折号（个别行用「额尔古纳-室韦」）
  const text = s.replace(/\s+/g, '').replace(/-/g, '－');
  const dash = text.indexOf('－');
  if (dash < 0) {
    // 环线/连接线：如「北京环线霸州、高碑店、…」「嵊泗连接线嵊泗、岱山、舟山」
    for (const marker of ['环线', '连接线']) {
      const at = text.indexOf(marker);
      if (at > 0) {
        const end = at + marker.length;
        return {
          od: text.slice(0, end),
          controls: text.slice(end).split(/[、，]/).filter(Boolean),
        };
      }
    }
    return { od: text, controls: [] };
  }
  const origin = text.slice(0, dash);
  // 控制点以起点开头，形态可能为「上海、…」或「上海（闵行）、…」——取最早出现者
  const candidates = [`${origin}、`, `${origin}（`, `${origin}(`]
    .map((mk) => text.indexOf(mk, dash + 1))
    .filter((at) => at > 0);
  const at = candidates.length ? Math.min(...candidates) : -1;
  if (at > 0) {
    return {
      od: text.slice(0, at),
      controls: text.slice(at).split(/[、，]/).filter(Boolean),
    };
  }
  // 兜底：首个「、」前若以 origin 结尾则剥离
  const firstSep = text.indexOf('、');
  if (firstSep > 0) {
    let od = text.slice(0, firstSep);
    if (od.length > origin.length && od.endsWith(origin)) od = od.slice(0, -origin.length);
    return { od, controls: text.slice(firstSep).split(/[、，]/).filter(Boolean) };
  }
  return { od: text, controls: [] };
}

function odToFromTo(od) {
  const dash = od.indexOf('－');
  if (dash < 0) return { fromPlace: od, toPlace: od };
  return { fromPlace: od.slice(0, dash), toPlace: od.slice(dash + 1) };
}

/** 行序列 → 条目。国道表：`<序号><编号>` 连写；高速表：编号独立成行或 `<序号><编号><名称>`（绕城环线段）。 */
function parseTable(rawLines, { expressway }) {
  // 预处理：城市绕城环线段把多行并成一行（「1G0401长沙市绕城高速2G0601…」），先切开
  const lines = [];
  for (const raw of rawLines) {
    if (expressway && /\d{1,3}G\d{4}\D/.test(raw)) {
      const parts = raw.split(/(?=\d{1,3}G\d{4})/g).filter((p) => p.trim());
      lines.push(...parts);
    } else {
      lines.push(raw);
    }
  }

  const entries = [];
  let i = 0;
  const isPageFooter = (l) => {
    const s = l.replace(/\s/g, '').replace(/^—+|—+$/g, '');
    return (
      /^—\d+—$/.test(l.replace(/\s/g, '')) ||
      /^(序号|路线|编号|类别|路线起讫点主要控制点|序号类别)?$/.test(s) ||
      /^\d+$/.test(l.trim())
    );
  };

  while (i < lines.length) {
    const line = lines[i].trim();
    let m = null;
    let category = '';
    let inlineName = '';

    if (expressway) {
      // 形态 A：编号独立成行（其上一行是类别行）
      m = /^G(\d{1,4})([WEN]?)$/.exec(line);
      if (m && i > 0 && !/^\d+$/.test(lines[i - 1].trim())) {
        category = lines[i - 1].trim();
      }
      if (!m) {
        // 形态 B：城市绕城环线段「<序号><编号>」一行（名称可能在同行或下一行）
        const oneLine = /^(\d{1,3})(G\d{4})(.*)$/.exec(line);
        if (oneLine) {
          m = [null, oneLine[2].slice(1), ''];
          inlineName = oneLine[3].split(/—|序号/)[0].replace(/\s+/g, '').trim();
          category = '城市绕城环线';
          if (!inlineName) {
            // 名称独立成行：取下一非空行（形如「重庆市绕城高速」）
            for (let k = i + 1; k < Math.min(i + 4, lines.length); k += 1) {
              const t = lines[k].trim();
              if (!t || isPageFooter(t)) continue;
              if (/高速|环线/.test(t) && !/[、G\d]/.test(t)) {
                inlineName = t;
                i = k; // 让后续 body 收集从名称行之后开始
              }
              break;
            }
          }
        }
      }
    } else {
      // 序号+编号连写：12G318 / 1G101
      m = /^(\d{1,3})G(\d{1,3})([WEN]?)$/.exec(line);
    }

    if (!m) {
      i += 1;
      continue;
    }

    const ref = expressway ? `G${m[1]}${m[2] ?? ''}` : `G${m[2]}${m[3] ?? ''}`;
    // 收集后续行直到下一条目 / 页脚 / 分组标题
    const body = [];
    let j = i + 1;
    while (j < lines.length) {
      const t = lines[j].trim();
      if (!t) {
        j += 1;
        continue;
      }
      if (t.includes('附件')) break;
      if (expressway ? /^G\d{1,4}[WEN]?$/.test(t) : /^\d{1,3}G\d{1,3}[WEN]?$/.test(t)) break;
      if (expressway && /^(\d{1,3})G\d{4}/.test(t)) break;
      if (isPageFooter(t)) {
        j += 1;
        continue;
      }
      // 高速表的类别行（联络线/并行线/主线…）是「下一组」的开始，也可能是当前组的类别重复 → 停止收集
      if (expressway && /^(主线|联络线|并行线|地区环线|都市圈环线|城市绕城环线|环线)$/.test(t)) break;
      if (/^[一二三四五六七八九十]$/.test(t)) {
        j += 1;
        continue;
      }
      body.push(t);
      j += 1;
    }
    const { od, controls } = inlineName
      ? { od: inlineName, controls: [] }
      : splitOdControls(body.join(''));
    const { fromPlace, toPlace } = odToFromTo(od);
    if (fromPlace) {
      entries.push({ seq: entries.length + 1, category: category || undefined, ref, fromPlace, toPlace, controls });
    }
    i = j;
  }
  return entries;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
await ensurePdf();
const text = await pdfText();
const lines = text.split(/\r?\n/).map((l) => l.trim());

// 定位附件边界
const idxA1 = lines.findIndex((l) => l.includes('国家高速公路网路线方案表') && lines.lastIndexOf(l) > lines.indexOf(l));
// 用最后一次出现的「普通国道网路线方案表」作为附件2起点（第一次出现在目录）
const occurrences = lines.reduce((acc, l, k) => (l.includes('普通国道网路线方案表') ? [...acc, k] : acc), []);
const idxA2 = occurrences[occurrences.length - 1] ?? 0;
const idxA3 = lines.findIndex((l, k) => k > idxA2 && l.includes('国家高速公路网布局方案图'));
console.log(`附件1 起点 ~${idxA1}，附件2 起点 ${idxA2}，附件3（截断）${idxA3}`);

const expressway = parseTable(lines.slice(idxA1, idxA2), { expressway: true });
const national = parseTable(lines.slice(idxA2, idxA3 > 0 ? idxA3 : undefined), { expressway: false });

// 去重（同编号多行保留首个）并校验 §3.2
function dedupeAndValidate(rows, label) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.ref)) continue;
    seen.add(r.ref);
    out.push(r);
  }
  const bad = out.filter((r) => !/^G\d{1,4}[WEN]?$/.test(r.ref));
  if (bad.length) throw new Error(`${label} 存在非法编号：${bad.map((b) => b.ref).join(',')}`);
  return out;
}

const nationalRows = dedupeAndValidate(national, '国道表');
const expresswayRows = dedupeAndValidate(expressway, '高速表');

// 高速主线 <100（G1~G98）/ 其余 4 位；国道 3 位 ≥101。交叉校验：
const misplaced = expresswayRows.filter((r) => /^G\d{1,3}$/.test(r.ref) && Number(r.ref.slice(1)) >= 100);
const misplaced2 = nationalRows.filter((r) => Number(r.ref.slice(1)) < 100);
if (misplaced.length) console.warn(`⚠ 高速表中 3 位 ≥100 的编号：${misplaced.map((r) => r.ref).join(',')}`);
if (misplaced2.length) console.warn(`⚠ 国道表中 <100 的编号：${misplaced2.map((r) => r.ref).join(',')}`);

mkdirSync(AUTH_DIR, { recursive: true });
writeFileSync(
  join(AUTH_DIR, 'plan-2022-national.json'),
  JSON.stringify(
    {
      version: 1,
      updated: new Date().toISOString().slice(0, 10),
      source: '《国家公路网规划》(2022) 附件2 普通国道网路线方案表',
      url: PLAN_URL,
      roads: nationalRows,
    },
    null,
    1,
  ),
  'utf8',
);
writeFileSync(
  join(AUTH_DIR, 'plan-2022-expressway.json'),
  JSON.stringify(
    {
      version: 1,
      updated: new Date().toISOString().slice(0, 10),
      source: '《国家公路网规划》(2022) 附件1 国家高速公路网路线方案表',
      url: PLAN_URL,
      roads: expresswayRows,
    },
    null,
    1,
  ),
  'utf8',
);

console.log(`\n普通国道：${nationalRows.length} 条（目标 301）`);
console.log(`国家高速：${expresswayRows.length} 条（目标 278）`);
console.log('国道放射线:', nationalRows.slice(0, 12).map((r) => `${r.ref} ${r.fromPlace}—${r.toPlace}`).join('；'));
console.log('国道末 5 条:', nationalRows.slice(-5).map((r) => `${r.ref} ${r.fromPlace}—${r.toPlace}`).join('；'));
console.log('高速末 5 条:', expresswayRows.slice(-5).map((r) => `${r.ref} ${r.fromPlace}—${r.toPlace}`).join('；'));
if (nationalRows.length !== 301 || expresswayRows.length !== 278) {
  console.warn('\n⚠ 与规划口径（301/278）不一致——检查附件边界与解析规则');
}
