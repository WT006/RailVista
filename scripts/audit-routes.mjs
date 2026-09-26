/**
 * 路线审计工具（v3 修复 P1-5 / P2-8）——全经停端到端站级断言。
 *
 * 与旧版的区别（修复方案 §4-P1-5）：
 *  - 旧版 POST job 只传起终 2 站，且不查 12306，无法发现「经停漏画/站离线」；
 *  - 新版先 GET /api/trains + /api/trains/stops 取 12306 全经停，再用全经停建 job；
 *  - 逐站硬断言：站数一致、unresolvedStops=[]、每站投影 ≤10km(K/T/Z)/6km(G/D/C)、
 *    投影进度无显著折返、相邻点跳变 ≤60/40km（接缝放宽 120/80）、segmentsOk===Total、
 *    status=done、里程/站序弦长比 ∈ [1.0,1.7]/[1.0,1.5]。
 *
 * 用法：
 *   node scripts/audit-routes.mjs                          # 审计默认 6 案例（日期=明天）
 *   node scripts/audit-routes.mjs --date 2026-10-01
 *   node scripts/audit-routes.mjs --train K771 --from 呼和浩特 --to 福州
 *   node scripts/audit-routes.mjs --train K771 --from 呼和浩特 --to 福州 --two-station  # 诊断对照
 *   node scripts/audit-routes.mjs --random 5               # P2-8：随机抽 5 个真实 OD
 *   node scripts/audit-routes.mjs --csv trains.csv         # CSV: code,from,to（首行表头）
 *   node scripts/audit-routes.mjs --json out.json --csv-out out.csv --verbose
 *
 * 依赖：本地 API 运行中（默认 http://127.0.0.1:3000，可用 AUDIT_API_BASE 覆盖）。
 * 输出：docs/route-audit-report.md（默认）+ 可选 JSON/CSV 明细。
 * 退出码：0 = 全部断言通过；1 = 有断言失败/超时/错误。
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultReportPath = join(__dirname, '../docs/route-audit-report.md');
const defaultStationsGeoPath = join(__dirname, '../data/stations-geo.json');

const DEFAULT_API_BASE = process.env.AUDIT_API_BASE || 'http://127.0.0.1:3000';
const POLL_INTERVAL_MS = 3000;
/** K771 类长线拓扑冷算可达 300s+，审计超时放宽到 360s */
const DEFAULT_POLL_MAX_MS = 360_000;

/** 修复方案 §5 默认 6 案例（watch 为历史缺陷重点观察站） */
const DEFAULT_CASES = [
  { code: 'K512', from: '广州白云', to: '杭州南', watch: ['衡阳'] },
  { code: 'K149', from: '上海松江', to: '南宁', watch: [] },
  { code: 'C650', from: '鄂尔多斯', to: '呼和浩特', watch: ['东胜东'] },
  { code: 'K1117', from: '包头', to: '北京丰台', watch: ['鄂尔多斯'] },
  { code: 'K771', from: '呼和浩特', to: '福州', watch: ['西安', '渭南'] },
  { code: 'G7274', from: '芜湖', to: '上海', watch: ['镇江', '无锡', '苏州'] },
];

function cnTomorrowDate() {
  // 12306 需要未来日期；按北京时间取明天
  const now = new Date(Date.now() + 8 * 3600_000 + 24 * 3600_000);
  return now.toISOString().slice(0, 10);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
  };
  const flag = (name) => args.includes(name);
  const date = opt('--date', cnTomorrowDate());
  const base = opt('--base', DEFAULT_API_BASE);
  const pollMaxMs = Number(opt('--timeout', String(DEFAULT_POLL_MAX_MS)));
  const mdPath = opt('--md', defaultReportPath);
  const jsonPath = opt('--json', null);
  const csvPath = opt('--csv-out', null);
  const csvInput = opt('--csv', null);
  const randomN = Number(opt('--random', 0)) || 0;
  const verbose = flag('--verbose');
  const twoStation = flag('--two-station');

  let cases = DEFAULT_CASES.map((c) => ({ ...c }));
  const trainCode = opt('--train', null);
  if (trainCode) {
    cases = [
      {
        code: trainCode,
        from: opt('--from', ''),
        to: opt('--to', ''),
        watch: [],
        twoStation,
      },
    ];
  } else if (csvInput && existsSync(csvInput)) {
    cases = readFileSync(csvInput, 'utf8')
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => {
        const [code, from, to] = l.split(',').map((s) => s.trim());
        return { code, from, to, watch: [] };
      })
      .filter((c) => c.code && c.from && c.to);
  }

  return {
    date,
    base,
    pollMaxMs,
    mdPath,
    jsonPath,
    csvPath,
    randomN,
    verbose,
    cases,
  };
}

// ───────────────────────── 几何工具 ─────────────────────────

function haversineKm(lng1, lat1, lng2, lat2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function pointToSegmentKm(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return { dist: haversineKm(px, py, x1, y1), t: 0 };
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return { dist: haversineKm(px, py, cx, cy), t };
}

/** 投影到折线：最近距离、所在段下标、沿线里程（km） */
function projectToPolyline(lng, lat, coords, segLengths) {
  let best = { dist: Infinity, idx: -1, km: 0, t: 0 };
  let acc = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const r = pointToSegmentKm(
      lng,
      lat,
      coords[i][0],
      coords[i][1],
      coords[i + 1][0],
      coords[i + 1][1],
    );
    if (r.dist < best.dist) best = { dist: r.dist, idx: i, km: acc + r.t * segLengths[i], t: r.t };
    acc += segLengths[i];
  }
  return best;
}

function polylineMileageKm(coords) {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversineKm(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
  }
  return total;
}

function isHsrCode(code) {
  return /^[GDC]/i.test(String(code || '').trim());
}

// ───────────────────────── 12306 全经停 ─────────────────────────

async function jget(url, init = {}, timeoutMs = 60_000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  return res.json().catch(() => ({}));
}

async function fetchFullStops(base, c, date) {
  const list = await jget(
    `${base}/api/trains?from=${encodeURIComponent(c.from)}&to=${encodeURIComponent(c.to)}&date=${date}`,
  );
  const trains = list.data?.trains || list.data || [];
  const hit = trains.find((x) => x.trainCode === c.code);
  if (!hit) {
    return { error: `12306 未查到车次 ${c.code}（${c.from}→${c.to} ${date}，候选 ${trains.length} 班）` };
  }
  const sd = await jget(
    `${base}/api/trains/stops?trainNo=${encodeURIComponent(hit.trainNo)}&trainCode=${encodeURIComponent(c.code)}&from=${encodeURIComponent(c.from)}&to=${encodeURIComponent(c.to)}&date=${date}`,
  );
  const raw = sd.data?.stops || sd.data || [];
  const names = raw.map((s) => s.stationName || s.name).filter(Boolean);
  if (names.length < 2) return { error: '12306 经停站不足 2 个' };
  return { names };
}

// ───────────────────────── job 提交与轮询 ─────────────────────────

async function auditCase(base, c, date, pollMaxMs, verbose) {
  const t0 = Date.now();
  const label = `${c.code} ${c.from}→${c.to}`;

  let expectedNames = [c.from, c.to];
  let stopSource = 'two-station';
  if (!c.twoStation) {
    const full = await fetchFullStops(base, c, date);
    if (full.error) {
      return { case: c, label, date, status: 'SKIP', detail: full.error, elapsed: Date.now() - t0, assertions: { passes: [], failures: [full.error] }, perStop: [] };
    }
    expectedNames = full.names;
    stopSource = '12306';
  }
  const stops = expectedNames.map((name) => ({ name }));

  let jobId;
  let createData = null;
  try {
    const res = await jget(
      `${base}/api/rail-geometry/jobs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stops, trainCode: c.code || undefined }),
      },
      120_000,
    );
    if (!res.ok) {
      return { case: c, label, date, status: 'FAIL', detail: res.error?.message || 'job 创建失败', elapsed: Date.now() - t0, assertions: { passes: [], failures: [`job 创建失败：${res.error?.message || ''}`] }, perStop: [] };
    }
    createData = res.data;
    jobId = createData.jobId;
  } catch (e) {
    return { case: c, label, date, status: 'ERROR', detail: e.message, elapsed: Date.now() - t0, assertions: { passes: [], failures: [`API 不可达：${e.message}`] }, perStop: [], rootCause: 'API_UNREACHABLE' };
  }

  let snapshot = null;
  const deadline = Date.now() + pollMaxMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const pj = await jget(`${base}/api/rail-geometry/jobs/${jobId}`, {}, 15_000);
      snapshot = pj.data;
      if (snapshot && ['done', 'partial', 'failed'].includes(snapshot.status)) break;
    } catch (e) {
      if (verbose) console.log(`  poll error: ${e.message}`);
    }
  }

  if (!snapshot) {
    return { case: c, label, date, status: 'TIMEOUT', detail: `轮询超过 ${pollMaxMs}ms`, elapsed: Date.now() - t0, assertions: { passes: [], failures: [`job 轮询超时 ${pollMaxMs}ms`] }, perStop: [] };
  }

  const coords = (snapshot.coords || []).map((p) => (Array.isArray(p) ? p : [p.lng, p.lat]));
  const retStops = snapshot.stops || [];
  const result = {
    case: c,
    label,
    date,
    stopSource,
    expectedCount: expectedNames.length,
    expectedNames,
    status: snapshot.status,
    qualityTier: snapshot.qualityTier || 'station',
    source: snapshot.source || 'station',
    message: snapshot.message || '',
    segmentsOk: snapshot.segmentsOk ?? 0,
    segmentsTotal: snapshot.segmentsTotal ?? 0,
    unresolvedStops: snapshot.unresolvedStops || createData?.unresolvedStops || [],
    coords,
    retStops,
    elapsed: Date.now() - t0,
  };
  result.assertions = runAssertions(result);
  result.perStop = result.assertions.perStop;
  return result;
}

// ───────────────────────── 站级断言（与服务端 validateStopsOnCoords 对齐） ─────────────────────────

function runAssertions(r) {
  const passes = [];
  const failures = [];
  const perStop = [];
  const hsr = isHsrCode(r.case.code);
  const viaKm = hsr ? 6 : 10;
  const intraKm = hsr ? 40 : 60;
  const seamKm = hsr ? 80 : 120;
  const maxRatio = hsr ? 1.5 : 1.7;

  // ① 状态/段完成
  if (r.status === 'done') passes.push(`①status=done`);
  else failures.push(`①status=${r.status}（要求 done）`);
  if (r.segmentsTotal > 0 && r.segmentsOk === r.segmentsTotal) {
    passes.push(`①segments ${r.segmentsOk}/${r.segmentsTotal}`);
  } else {
    failures.push(`①segments ${r.segmentsOk}/${r.segmentsTotal} 未全成功`);
  }

  // ② 站数一致 + 无 unresolved
  const retNames = r.retStops.map((s) => s.name).filter(Boolean);
  if (r.stopSource === '12306') {
    if (retNames.length === r.expectedCount) {
      passes.push(`②站数一致 ${retNames.length}/${r.expectedCount}`);
    } else {
      const missing = r.expectedNames.filter((n) => !retNames.includes(n));
      failures.push(`②站数 ${retNames.length}/${r.expectedCount}，缺失：${missing.join('、') || '?'}`);
    }
  }
  if (!r.unresolvedStops.length) {
    passes.push('②unresolvedStops=[]');
  } else {
    failures.push(`②unresolvedStops 非空：${r.unresolvedStops.join('、')}`);
  }

  if (r.coords.length < 2 || r.retStops.length < 2) {
    failures.push('③coords/stops 不足，无法做几何断言');
    return { passes, failures, perStop, maxProj: null, maxJump: null, ratio: null };
  }

  const segLengths = [];
  for (let i = 0; i < r.coords.length - 1; i++) {
    segLengths.push(
      haversineKm(r.coords[i][0], r.coords[i][1], r.coords[i + 1][0], r.coords[i + 1][1]),
    );
  }

  // ③ 逐站投影 + ④ 进度单调（无显著折返，阈值同服务端：max(3km, 站间弦长 10%)）
  let maxProj = 0;
  let worstStop = '';
  let prevKm = null;
  let prevStop = null;
  let backtrackFail = null;
  let stationKm = 0;
  for (const s of r.retStops) {
    const row = {
      name: s.name,
      lng: s.lng ?? null,
      lat: s.lat ?? null,
      distKm: null,
      projIdx: null,
      projKm: null,
      verdict: 'no-coord',
    };
    if (s.lng == null || s.lat == null || !Number.isFinite(Number(s.lng)) || !Number.isFinite(Number(s.lat))) {
      perStop.push(row);
      continue;
    }
    const p = projectToPolyline(Number(s.lng), Number(s.lat), r.coords, segLengths);
    row.distKm = Number(p.dist.toFixed(2));
    row.projIdx = p.idx;
    row.projKm = Number(p.km.toFixed(2));
    if (p.dist > viaKm) row.verdict = 'off-path';
    else row.verdict = 'ok';
    if (p.dist > maxProj) {
      maxProj = p.dist;
      worstStop = s.name;
    }
    if (prevKm != null && prevStop) {
      const chord = haversineKm(
        Number(prevStop.lng),
        Number(prevStop.lat),
        Number(s.lng),
        Number(s.lat),
      );
      stationKm += chord;
      const regress = prevKm - p.km;
      if (regress > Math.max(3, chord * 0.1) && !backtrackFail) {
        backtrackFail = `${prevStop.name}→${s.name} 回退 ${regress.toFixed(1)}km`;
      }
    }
    prevKm = p.km;
    prevStop = s;
    perStop.push(row);
  }
  if (maxProj <= viaKm) {
    passes.push(`③逐站投影≤${viaKm}km（max=${maxProj.toFixed(1)}km${worstStop ? `@${worstStop}` : ''}）`);
  } else {
    failures.push(`③存在经停投影>${viaKm}km（max=${maxProj.toFixed(1)}km@${worstStop}）`);
  }
  if (!backtrackFail) {
    passes.push('④投影进度单调无折返');
  } else {
    failures.push(`④投影折返：${backtrackFail}`);
  }

  // ⑤ 相邻点跳变：>接缝阈值必 fail；段内阈值~接缝阈值之间计 warning（可能是合法换乘接缝）
  let maxJump = 0;
  let maxJumpAt = -1;
  let intraExceed = 0;
  for (let i = 0; i < segLengths.length; i++) {
    if (segLengths[i] > maxJump) {
      maxJump = segLengths[i];
      maxJumpAt = i;
    }
    if (segLengths[i] > intraKm) intraExceed += 1;
  }
  if (maxJump <= seamKm) {
    passes.push(`⑤最大跳变${maxJump.toFixed(1)}km≤${seamKm}km（接缝阈；段内阈 ${intraKm}km，超段内 ${intraExceed} 处）`);
  } else {
    failures.push(`⑤最大跳变${maxJump.toFixed(1)}km@idx${maxJumpAt} > 接缝阈 ${seamKm}km`);
  }

  // ⑥ 里程/站序弦长比（站间弦长累计 ≥50km 才判定，与服务端一致）
  const routeKm = polylineMileageKm(r.coords);
  const ratio = stationKm > 0 ? routeKm / stationKm : null;
  if (stationKm < 50) {
    passes.push(`⑥里程比免判（站序弦长 ${stationKm.toFixed(0)}km<50）`);
  } else if (ratio >= 1.0 && ratio <= maxRatio) {
    passes.push(`⑥里程比=${ratio.toFixed(2)} ∈ [1.0,${maxRatio}]`);
  } else {
    failures.push(`⑥里程比=${ratio?.toFixed(2)} 超出 [1.0,${maxRatio}]（折线 ${routeKm.toFixed(0)}km/弦长 ${stationKm.toFixed(0)}km）`);
  }

  return { passes, failures, perStop, maxProj, maxJump, ratio };
}

// ───────────────────────── 随机抽样（P2-8） ─────────────────────────

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

async function pickRandomCases(base, date, n, stationsGeo) {
  const names = Object.keys(stationsGeo).filter(
    (k) => stationsGeo[k]?.lng != null && stationsGeo[k]?.lat != null,
  );
  const rng = seededRandom(Number(`${date.replace(/-/g, '')}${n}`));
  const out = [];
  let guard = 0;
  while (out.length < n && guard < n * 10) {
    guard += 1;
    const from = names[Math.floor(rng() * names.length)];
    const to = names[Math.floor(rng() * names.length)];
    if (!from || !to || from === to) continue;
    try {
      const list = await jget(
        `${base}/api/trains?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${date}`,
      );
      const trains = list.data?.trains || [];
      if (!trains.length) continue;
      const hit = trains[Math.floor(rng() * trains.length)];
      out.push({ code: hit.trainCode, from, to, watch: [], random: true });
    } catch {
      /* 忽略单个随机请求失败 */
    }
  }
  return out;
}

// ───────────────────────── 报告输出 ─────────────────────────

function writeMarkdown(path, date, base, results) {
  const lines = [
    '# 路线审计报告（全经停站级断言）',
    '',
    `> 时间：${new Date().toISOString()}`,
    `> API：${base}`,
    `> 日期：${date}`,
    `> 车次：${results.length}`,
    '',
    '## 汇总',
    '',
  ];
  const totalFailures = results.reduce((s, r) => s + (r.assertions?.failures?.length || 0), 0);
  const totalPasses = results.reduce((s, r) => s + (r.assertions?.passes?.length || 0), 0);
  lines.push(`- 断言：${totalPasses} pass / ${totalFailures} fail`);
  lines.push(`- 判定：${totalFailures === 0 ? '✅ ALL PASS' : '❌ HAS FAILURES'}`);
  lines.push('');
  lines.push('| # | 车次 | 区间 | 经停数 | 状态 | tier | 段 | 耗时s | 失败项 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  results.forEach((r, i) => {
    const fails = (r.assertions?.failures || []).join('；') || '—';
    lines.push(
      `| ${i + 1} | ${r.case.code || '—'} | ${r.label} | ${r.expectedCount ?? '—'} | ${r.status} | ${r.qualityTier || '—'} | ${r.segmentsOk ?? '—'}/${r.segmentsTotal ?? '—'} | ${(r.elapsed / 1000).toFixed(0)} | ${fails} |`,
    );
  });
  lines.push('');
  lines.push('## 离线站明细（投影 > 阈值 或 无坐标）');
  lines.push('');
  for (const r of results) {
    const bad = (r.perStop || []).filter((x) => x.verdict !== 'ok');
    if (!bad.length) continue;
    lines.push(`### ${r.label}`);
    for (const x of bad) {
      lines.push(
        `- ${x.name}: ${x.verdict === 'no-coord' ? '无坐标' : `投影 ${x.distKm}km @idx${x.projIdx}`}`,
      );
    }
    lines.push('');
  }
  lines.push('## 断言明细');
  lines.push('');
  for (const r of results) {
    lines.push(`### ${r.label}（${r.status}, ${r.elapsed}ms）`);
    if (r.message) lines.push(`- message: ${r.message}`);
    if (r.unresolvedStops?.length) lines.push(`- unresolvedStops: ${r.unresolvedStops.join('、')}`);
    for (const p of r.assertions?.passes || []) lines.push(`- ✅ ${p}`);
    for (const f of r.assertions?.failures || []) lines.push(`- ❌ ${f}`);
    lines.push('');
  }
  writeFileSync(path, lines.join('\n'), 'utf8');
}

function writeCsv(path, results) {
  const rows = ['train,date,from,to,stopIdx,stopName,lng,lat,distKm,projIdx,projKm,verdict,status,tier,segOk,segTotal,elapsedMs'];
  for (const r of results) {
    (r.perStop || []).forEach((x, i) => {
      rows.push(
        [
          r.case.code || '',
          r.date || '',
          r.case.from || '',
          r.case.to || '',
          i,
          x.name,
          x.lng ?? '',
          x.lat ?? '',
          x.distKm ?? '',
          x.projIdx ?? '',
          x.projKm ?? '',
          x.verdict,
          r.status,
          r.qualityTier || '',
          r.segmentsOk ?? '',
          r.segmentsTotal ?? '',
          r.elapsed,
        ]
          .map((v) => String(v).replace(/"/g, '""'))
          .map((v) => `"${v}"`)
          .join(','),
      );
    });
  }
  writeFileSync(path, rows.join('\n'), 'utf8');
}

async function main() {
  const cfg = parseArgs();

  let stationsGeo = {};
  try {
    stationsGeo = JSON.parse(readFileSync(defaultStationsGeoPath, 'utf8'));
  } catch {}

  let cases = cfg.cases;
  if (cfg.randomN > 0) {
    process.stdout.write(`随机抽样 ${cfg.randomN} 个真实 OD（${cfg.date}）...\n`);
    cases = await pickRandomCases(cfg.base, cfg.date, cfg.randomN, stationsGeo);
    process.stdout.write(`抽中：${cases.map((c) => `${c.code} ${c.from}→${c.to}`).join('；')}\n`);
  }

  console.log(`AUDIT: ${cases.length} trains, API=${cfg.base}, date=${cfg.date}`);
  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.code} ${c.from}→${c.to} ... `);
    const r = await auditCase(cfg.base, c, cfg.date, cfg.pollMaxMs, cfg.verbose);
    results.push(r);
    const af = r.assertions?.failures?.length || 0;
    const ap = r.assertions?.passes?.length || 0;
    console.log(
      `${r.status} ${r.qualityTier || ''} ${r.segmentsOk ?? '?'}/${r.segmentsTotal ?? '?'}seg ${(r.elapsed / 1000).toFixed(0)}s [${ap}pass ${af}fail]${af ? ` :: ${(r.assertions.failures[0] || '').slice(0, 120)}` : ''}`,
    );
    if (cfg.verbose) {
      for (const x of r.perStop || []) {
        if (x.verdict !== 'ok') {
          console.log(
            `    ${x.verdict === 'no-coord' ? '无坐标' : '离线'}: ${x.name}${x.distKm != null ? ` ${x.distKm}km` : ''}`,
          );
        }
      }
      for (const f of r.assertions?.failures || []) console.log(`    FAIL: ${f}`);
    }
  }

  writeMarkdown(cfg.mdPath, cfg.date, cfg.base, results);
  console.log(`Markdown: ${cfg.mdPath}`);
  if (cfg.csvPath) {
    writeCsv(cfg.csvPath, results);
    console.log(`CSV: ${cfg.csvPath}`);
  }
  if (cfg.jsonPath) {
    const slim = results.map((r) => ({
      train: r.case,
      date: r.date,
      stopSource: r.stopSource,
      expectedCount: r.expectedCount,
      status: r.status,
      qualityTier: r.qualityTier,
      source: r.source,
      message: r.message,
      segmentsOk: r.segmentsOk,
      segmentsTotal: r.segmentsTotal,
      unresolvedStops: r.unresolvedStops,
      elapsedMs: r.elapsed,
      assertions: r.assertions && {
        passes: r.assertions.passes,
        failures: r.assertions.failures,
        maxProjKm: r.assertions.maxProj,
        maxJumpKm: r.assertions.maxJump,
        ratio: r.assertions.ratio,
      },
      perStop: r.perStop,
    }));
    writeFileSync(cfg.jsonPath, JSON.stringify(slim, null, 2), 'utf8');
    console.log(`JSON: ${cfg.jsonPath}`);
  }

  const totalFailures = results.reduce((s, r) => s + (r.assertions?.failures?.length || 0), 0);
  process.exit(totalFailures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
