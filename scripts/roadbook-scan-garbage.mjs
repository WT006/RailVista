#!/usr/bin/env node
/**
 * 路书库文案「杂字」扫描器（阶段 2 起为每批次必跑的自检动作）
 *
 * 背景：生成式写入会在中文字段里混入不属于该语言的词，例如俄语 фрагмент、英文 fireworks / but、
 * 西班牙语残片 Sepemás 等。这类故障有三个特点：
 *   1. JSON 依然合法，解析不报错；
 *   2. 闸门 scripts/build-roadbook-index.mjs 的 scanGarbage 拦不住 —— 它只管占位符、
 *      块级标签、日文假名、西里尔字母 + 6 个固定生造词，纯拉丁散文(Fireworks/but/hill)一条不过问；
 *   3. 只会安静留在给读者看的文案里。
 * 所以「闸门 ERROR 0」不等于「文案干净」，两者必须分开查。
 *
 * 用法：
 *   node scripts/roadbook-scan-garbage.mjs                 # 扫 data/presets/roadbooks/ 全部
 *   node scripts/roadbook-scan-garbage.mjs <file.json>     # 只扫指定文件
 *   node scripts/roadbook-scan-garbage.mjs --since=2026-10-09  # 只扫 updatedAt 为指定日期的路线
 *
 * 退出码：0 = 干净；1 = 发现疑似杂字（CI / 闸门里可直接使用）
 *
 * 三条使用经验（来自 2026-10-10 批次）：
 *   A. 白名单按【字段名】收，不要按【文件】收。把 modes/category 这类枚举值放进去才不会有噪音。
 *   B. 建议在写盘前扫临时/staging 文件，避免 sources[].title 里的路线 id 之类混进来抬升判断成本。
 *   C. 顶层 note 里的「共 N 条」追加后会静默变成错误陈述 —— 本脚本一并核这个计数。
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DIR = path.join(ROOT, 'data/presets/roadbooks')

/** 字段名白名单：这些字段的值天然是拉丁字符（枚举、id、专名、标题里的文件路径） */
const ALLOW_KEYS = new Set([
  'id', 'poiIds', 'primaryMode', 'shape', 'tier', 'layer', 'status',
  'mode', 'modes', 'category', 'role', 'title', 'publisher', 'usedFor',
  'startNode', 'endNode', 'fromNode', 'toNode',  // 节点名是中文，但为容错放行
])

/** 允许出现在中文字段里的词（单位符号等） */
const ALLOW_WORDS = new Set(['km', 'm', 'km2'])

/** 疑似杂字：西里尔、日文假名、希腊字母、拉丁词 */
const BAD = /[\u0400-\u04FF]+|[\u3040-\u30FF]+|[\u0370-\u03FF]+|[A-Za-z]+/g

const findings = []
const countMismatch = []

/**
 * 判据（来自实战校准）：
 *   只在「中文主导」的字符串里报警。
 *   id / 文件路径 / 纯枚举值这些天然少中文或零中文，全量扫会产生上百条噪音
 *   （实测一次误报 132 处，绝大多数是 "data/roads/index/national.json" 这类路径）。
 *   实测把门槛设在中文占比 ≥ 0.25 后，噪音归零且真故障一条不漏。
 */
const CJK = /[\u4E00-\u9FFF]/g
const CJK_RATIO_MIN = 0.25

/** schema 字段名 / 道路编号等技术词，出现在中文说明句子里是合理的 */
const TECH_WORDS = new Set([
  'km', 'm', 'km2',
  'refPending', 'detourKm', 'totalKm', 'visitHours', 'mustSee', 'roadRefs', 'poiIds',
  'updatedAt', 'mileageNote', 'carFree', 'anchorCity', 'primaryMode', 'bestSeason',
  'difficultyNote', 'elevM', 'daysNote', 'ticketNote', 'editorRank',
])

/**
 * ⚠️ 这里**曾经**放过一个地理专名白名单（`Tony`），已于 2026-10-10 **删除**。
 *
 * 删除原因（QA 独立验证发现，记在这里防止有人再犯）：
 * 当时判断「Tony = 南迦巴瓦峰的登山界称呼」属实，但原文那句是
 * 「看峰Tony的规律」—— 中间夹一个拉丁词，**中文读起来根本不通**，
 * 真实专名不该以这种形态出现在中文句子里。正确的处理是改数据（写成「看峰景的规律」），
 * 而不是让扫描器对这句网开一面。
 *
 * **教训：白名单是止血，不是治病。** 白名单只该给「无法在数据层修掉的合法写法」用
 * （例如某些专名必须保留原文写法）。**凡是能通过改数据解决的，都改数据，不要改判据。**
 * 判据一开���口，真实缺陷也会从那个口子里漏出去。
 */

function walk (obj, filePath, routeId, pointer, key) {
  if (typeof obj === 'string') {
    if (key && ALLOW_KEYS.has(key)) return
    // 先剥离路径/文件名片段（如 data/roads/index/national.json），再检查剩余文本，
    // 否则一条含路径的长句会把 data/roads/index/national.json 每个词都报一遍。
    const obj2 = obj.replace(/[\w.\-/]*\.(json|mjs|cjs|ts|vue|png|jpg|csv|md|bin|xml)\b/gi, '')

    const cjk = (obj2.match(CJK) || []).length
    if (cjk / Math.max(obj2.length, 1) < CJK_RATIO_MIN) return  // 非中文主导 → 不是给读者看的文案

    const hits = obj2.match(BAD) || []
    for (const w of hits) {
      if (ALLOW_WORDS.has(w) || TECH_WORDS.has(w)) continue
      if (w.length <= 1) continue
      if (/^[A-Z]\d{1,4}$/.test(w)) continue      // 道路编号 G320 / X401 / S228
      if (/^[A-Z]{2,6}$/.test(w)) continue        // 专名缩写 BRT / GPS / SUV / UNESCO
      findings.push({ file: filePath, route: routeId, pointer, word: w, snippet: obj.slice(0, 90) })
    }
    return
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walk(v, filePath, routeId, `${pointer}[${i}]`, key))
    return
  }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) walk(obj[k], filePath, routeId, `${pointer}.${k}`, k)
  }
}

function checkFile (file) {
  const filePath = path.join(DIR, file)
  let json
  try {
    json = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (e) {
    findings.push({ file, route: '-', pointer: '(整个文件)', word: 'JSON 解析失败', snippet: e.message })
    return
  }
  const sinceIdx = process.argv.findIndex(a => a.startsWith('--since='))
  const since = sinceIdx >= 0 ? process.argv[sinceIdx].slice(8) : null

  for (const r of json.routes || []) {
    if (since && r.updatedAt !== since) continue
    walk(r, file, r.id, `routes[${r.id}]`, 'route')
  }

  // C 经验：校验顶层 note 里的路线条数是否与实际一致
  const note = json.note || ''
  const m = note.match(/(?:共|书)\s*(\d+)\s*条|(\d+)\s*条[：:，,]/)
  if (m) {
    const claimed = Number(m[1] || m[2])
    if (Number.isFinite(claimed) && claimed !== (json.routes || []).length) {
      countMismatch.push({ file, claimed, actual: (json.routes || []).length, snippet: note.slice(0, 60) })
    }
  }
}

const argFiles = process.argv.slice(2).filter(a => !a.startsWith('--'))
const targets = argFiles.length
  ? argFiles.map(f => path.basename(f))
  : fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'))

for (const f of targets) checkFile(f)

if (findings.length) {
  console.log(`发现疑似杂字 ${findings.length} 处：\n`)
  for (const it of findings) {
    console.log(`  ${it.file}  ${it.route}`)
    console.log(`    ${it.pointer}  命中「${it.word}」`)
    console.log(`    原文: ${it.snippet}\n`)
  }
}
if (countMismatch.length) {
  console.log(`顶层 note 路线条数与实际不符 ${countMismatch.length} 处：\n`)
  for (const it of countMismatch) {
    console.log(`  ${it.file}: note 写 ${it.claimed} 条, 实际 ${it.actual} 条  | ${it.snippet}\n`)
  }
}

const dirty = findings.length + countMismatch.length
console.log(dirty ? `✗ 文案扫描未通过（${dirty} 处待处理）` : `✓ 文案扫描通过：${targets.length} 个文件无杂字、note 计数一致`)
process.exit(dirty ? 1 : 0)
