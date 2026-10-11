#!/usr/bin/env node
/**
 * 内容红线扫描：票价金额与班次时刻（2026-10-10 起每批次必跑）
 *
 * ## 为什么需要单独一个脚本
 *
 * 内容红线的定义是「票价不写金额、时刻只写量级」，但这两条**不能用一条粗正则去查**。
 * 2026-10-10 首次尝试用 `/\d+ ?元|\d+:\d{2}/` 全库扫描，110 条报出 7 处，逐条核实后**全部是误报**：
 *
 *   - 6 处是「错峰时段建议」：`避开 12:00-13:00 与 18:00-19:30 的高峰`、`清晨 6:30-9:00 走北线`。
 *     这是**游览时机建议**，是正确的实用信息。红线禁的是「编造具体班次/开馆时间」，
 *     不是「建议几点去人少」—— 这两者语义完全相反，混为一谈会导致误删好内容。
 *   - 2 处是「人民币 20 元券」：`第五套人民币 20 元券背面图案的取景地`。
 *     这是景点身份的事实描述（某景点因出现在纸币上而闻名），不是票价。
 *
 * 粗正则的两种误伤方向：
 *   误报 → 好内容被当成违规，作者被迫删掉有用信息；
 *   漏报 → 真正写了「门票 50 元」的地方反而没被抓到。
 *
 * ## 本脚本的判据（语境 + 形态双条件）
 *
 * 只在**同时满足**以下两条时才判违规：
 *   ① 语境：该句含「票价/门票/收费/价格/花费/元/」等金额语境，或含「班次/发车/开馆/开门/末班/首班」等班次语境；
 *   ② 形态：句中出现具体金额 `\d+ 元`（排除「元券」）或具体时刻 `\d{1,2}:\d{2}`。
 *
 * 「时刻只写量级」的正向对照（这些应被放行，不要改）：
 *   ✅ 「每日数十班，风浪季会调整」   —— 有量级无具体时刻
 *   ✅ 「早市 7 点前最热闹」           —— 有量级无具体时刻
 *   ✅ 「避开 12:00-13:00 的高峰」     —— 游览建议，非班次
 *   ✅ 「以官方公告为准」               —— 不编造
 *
 * 用法：
 *   node scripts/roadbook-scan-content.mjs                # 扫全库
 *   node scripts/roadbook-scan-content.mjs <file.json>    # 只扫指定文件
 *
 * 退出码：0 = 红线未被突破；1 = 发现违规（CI / 闸门可直接使用）
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DIR = path.join(ROOT, 'data/presets/roadbooks')

/** 金额语境：出现这些词时，整句才进入金额判定 */
const MONEY_CONTEXT = /票价|门票|收费|价格|花费|元\/|\d+\s*元/
/** 具体金额形态。注意 `元券` 排除：那是指人民币面额，不是价格 */
const MONEY_VALUE = /\d+\s*元(?!券)/
/** 班次语境：只有这些词同时出现时，`\d{1,2}:\d{2}` 才被当成「班次时刻」违规 */
const SCHEDULE_CONTEXT = /班次|发车|开馆|开门|起飞|发船|末班|首班|停运/
const TIME_VALUE = /\d{1,2}:\d{2}/

const findings = []

/** 只扫给人读的文案字段；结构与枚举字段天然含拉丁词/数字，跳过 */
const SKIP_KEYS = new Set(['id', 'poiIds', 'primaryMode', 'shape', 'tier', 'layer', 'status', 'mode', 'modes', 'category', 'role', 'lng', 'lat', 'visitHours', 'detourKm', 'editorRank', 'difficulty', 'days', 'totalKm', 'distanceKm', 'driveHours'])

function walk (obj, file, routeId, pointer, key) {
  if (key && SKIP_KEYS.has(key)) return

  if (typeof obj === 'string') {
    if (MONEY_CONTEXT.test(obj) && MONEY_VALUE.test(obj)) {
      findings.push({ file, route: routeId, pointer, kind: '票价金额', snippet: snippetOf(obj) })
    }
    if (SCHEDULE_CONTEXT.test(obj) && TIME_VALUE.test(obj)) {
      findings.push({ file, route: routeId, pointer, kind: '班次时刻', snippet: snippetOf(obj) })
    }
    return
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walk(v, file, routeId, `${pointer}[${i}]`, key))
    return
  }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) walk(obj[k], file, routeId, `${pointer}.${k}`, k)
  }
}

/** 取命中位置前后各 18 字，便于人工核对 */
function snippetOf (s) {
  const m = s.match(MONEY_VALUE) || s.match(TIME_VALUE)
  if (!m) return s.slice(0, 70)
  const i = Math.max(0, (m.index ?? 0) - 18)
  return (i > 0 ? '…' : '') + s.slice(i, i + 70) + (i + 70 < s.length ? '…' : '')
}

function checkFile (file) {
  let json
  try {
    json = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'))
  } catch (e) {
    findings.push({ file, route: '-', pointer: '(整个文件)', kind: 'JSON 解析失败', snippet: e.message })
    return
  }
  for (const r of json.routes || []) {
    walk(r, file, r.id, `routes[${r.id}]`, 'route')
  }
}

const argFiles = process.argv.slice(2).filter(a => !a.startsWith('--'))
const targets = argFiles.length
  ? argFiles.map(f => path.basename(f))
  : fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'))

for (const f of targets) checkFile(f)

if (findings.length) {
  console.log(`发现红线突破 ${findings.length} 处：\n`)
  for (const it of findings) {
    console.log(`  ${it.file}  ${it.route}  [${it.kind}]`)
    console.log(`    ${it.pointer}`)
    console.log(`    原文: ${it.snippet}\n`)
  }
  console.log('✗ 内容红线未通过：请把具体金额改成量级描述，或删掉虚构的班次时刻。')
  process.exit(1)
}
console.log(`✓ 内容红线通过：${targets.length} 个文件无票价金额、无班次时刻（错峰时段建议与人民币面额表述已放行）`)