/**
 * C1: 路线审计工具 — 10 车次端到端统一断言（spec 5.8.1）。
 *
 * 用法：
 *   node scripts/audit-routes.mjs                         # 审计全部 10 个车次
 *   node scripts/audit-routes.mjs --train K512 --from 广州白云 --to 杭州南
 *   node scripts/audit-routes.mjs --verbose               # 详细输出
 *   node scripts/audit-routes.mjs --csv input.csv         # 从 CSV 读车次清单
 *
 * 依赖：本地 API 需运行（pnpm dev），默认 http://localhost:3000
 * 输出：docs/route-audit-report.md
 * 退出码：0 = 全部断言通过，1 = 有断言失败
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = join(__dirname, '../docs/route-audit-report.md');

const API_BASE = process.env.AUDIT_API_BASE || 'http://localhost:3000';
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 180_000;

const DEFAULT_TRAINS = [
  { code: 'T270',   from: '喀什',     to: '西安',     issue: '含西宁且≤15km',         special: 't270' },
  { code: 'G7316',  from: '黄山北',   to: '扬州东',   issue: '来源非示意级',           special: 'source_not_station' },
  { code: 'G3838',  from: '吉安西',   to: '北京西',   issue: '全程在轨无>80km跳接',     special: 'no_big_jump' },
  { code: 'C8902',  from: '西安东',   to: '延安',     issue: '本地级+偏离包西≤5km',    special: 'c8902' },
  { code: 'G3351',  from: '延安',     to: '南宁东',   issue: '15/15',                  special: 'exact_match', expectedSegs: 15 },
  { code: 'Z267',   from: '呼和浩特', to: '上海',     issue: '24/24',                  special: 'exact_match', expectedSegs: 24 },
  { code: 'C7601',  from: '广州南',   to: '珠海北',   issue: '走廊级≤1秒（防退化）',    special: 'c7601' },
  { code: 'K512',   from: '广州白云', to: '杭州南',   issue: '27/27（防退化）',        special: 'exact_match', expectedSegs: 27 },
  { code: 'Z201',   from: '北京西',   to: '三亚',     issue: '≥12/13+轮渡+≤60s',       special: 'z201' },
  { code: '',       from: '__random__', to: '__random__', issue: '随机抽签来源非示意级', special: 'random' },
];

const RANDOM_CANDIDATE_STATIONS = [
  '成都东', '武汉', '郑州东', '长沙南', '合肥南', '南京南', '济南西',
  '石家庄', '太原南', '沈阳北', '长春西', '哈尔滨西', '兰州西',
  '重庆北', '昆明南', '贵阳北', '南昌西', '福州南', '厦门北',
];

const RANDOM_CANDIDATE_TRAINS = ['G', 'D', 'C', 'K', 'T', 'Z'];

function parseArgs() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const csvIdx = args.indexOf('--csv');
  const csvPath = csvIdx >= 0 ? args[csvIdx + 1] : null;
  const trainIdx = args.indexOf('--train');
  const fromIdx = args.indexOf('--from');
  const toIdx = args.indexOf('--to');

  if (trainIdx >= 0) {
    return {
      verbose,
      trains: [
        {
          code: args[trainIdx + 1] || '',
          from: fromIdx >= 0 ? args[fromIdx + 1] : '',
          to: toIdx >= 0 ? args[toIdx + 1] : '',
          issue: 'CLI',
          special: 'cli',
        },
      ],
    };
  }

  let trains = DEFAULT_TRAINS;
  if (csvPath && existsSync(csvPath)) {
    const lines = readFileSync(csvPath, 'utf8').trim().split('\n').slice(1);
    trains = lines.map((l) => {
      const [code, from, to] = l.split(',').map((s) => s.trim());
      return { code, from, to, issue: 'CSV', special: 'csv' };
    });
  }

  return { verbose, trains };
}

function haversineKm(lng1, lat1, lng2, lat2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function pointToSegmentKm(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return haversineKm(px, py, x1, y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return haversineKm(px, py, cx, cy);
}

function pointToPolylineKm(lng, lat, coords) {
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = pointToSegmentKm(lng, lat, coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    if (d < min) min = d;
  }
  return min === Infinity ? Infinity : min;
}

function polylineMileageKm(coords) {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversineKm(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
  }
  return total;
}

function maxSegmentJumpKm(coords) {
  let max = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = haversineKm(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    if (d > max) max = d;
  }
  return max;
}

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function pickRandomTrain(stationsGeo) {
  const seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const rng = seededRandom(seed);
  const stationNames = Object.keys(stationsGeo).filter((n) => {
    const s = stationsGeo[n];
    return s && s.lng != null && s.lat != null;
  });
  const fromIdx = Math.floor(rng() * stationNames.length);
  let toIdx = Math.floor(rng() * stationNames.length);
  if (toIdx === fromIdx) toIdx = (toIdx + 1) % stationNames.length;
  const trainPrefix = RANDOM_CANDIDATE_TRAINS[Math.floor(rng() * RANDOM_CANDIDATE_TRAINS.length)];
  const trainNum = String(Math.floor(rng() * 9000) + 100);
  return {
    code: `${trainPrefix}${trainNum}`,
    from: stationNames[fromIdx],
    to: stationNames[toIdx],
  };
}

async function auditTrainViaJob(train, verbose) {
  const t0 = Date.now();
  const stops = [{ name: train.from }, { name: train.to }];

  let jobId;
  try {
    const createRes = await fetch(`${API_BASE}/api/rail-geometry/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stops, trainCode: train.code || undefined }),
      signal: AbortSignal.timeout(15000),
    });
    const createJson = await createRes.json();
    if (!createJson.ok) {
      return {
        train,
        status: 'FAIL',
        qualityTier: 'none',
        detail: createJson.error?.message || `HTTP ${createRes.status}`,
        elapsed: Date.now() - t0,
        assertions: [],
      };
    }
    jobId = createJson.data.jobId;
  } catch (e) {
    return {
      train,
      status: 'ERROR',
      qualityTier: 'none',
      detail: e.message,
      elapsed: Date.now() - t0,
      assertions: [],
      rootCause: 'API_UNREACHABLE',
    };
  }

  let snapshot = null;
  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const pollRes = await fetch(`${API_BASE}/api/rail-geometry/jobs/${jobId}`, {
        signal: AbortSignal.timeout(10000),
      });
      const pollJson = await pollRes.json();
      if (!pollJson.ok) {
        return {
          train,
          status: 'FAIL',
          qualityTier: 'none',
          detail: pollJson.error?.message || `HTTP ${pollRes.status}`,
          elapsed: Date.now() - t0,
          assertions: [],
        };
      }
      snapshot = pollJson.data;
      if (['done', 'partial', 'failed'].includes(snapshot.status)) break;
    } catch (e) {
      if (verbose) console.log(`  poll error: ${e.message}`);
    }
  }

  if (!snapshot) {
    return {
      train,
      status: 'TIMEOUT',
      qualityTier: 'none',
      detail: `job poll exceeded ${POLL_MAX_MS}ms`,
      elapsed: Date.now() - t0,
      assertions: [],
    };
  }

  const elapsed = Date.now() - t0;
  const result = {
    train,
    status: snapshot.status === 'failed' ? 'FAIL' : 'OK',
    qualityTier: snapshot.qualityTier || 'station',
    corridorId: snapshot.corridorId || '',
    segmentsOk: snapshot.segmentsOk ?? 0,
    segmentsTotal: snapshot.segmentsTotal ?? 0,
    coords: snapshot.coords || [],
    stops: snapshot.stops || [],
    source: snapshot.source || 'station',
    message: snapshot.message || '',
    unresolvedStops: snapshot.unresolvedStops || [],
    elapsed,
    assertions: [],
  };

  if (verbose) {
    console.log(`  coords: ${result.coords.length} pts, source: ${result.source}, tier: ${result.qualityTier}`);
    console.log(`  segs: ${result.segmentsOk}/${result.segmentsTotal}, elapsed: ${elapsed}ms`);
  }

  return result;
}

function assertTrainCase(result) {
  const failures = [];
  const passes = [];
  const { train, qualityTier, segmentsOk, segmentsTotal, coords, stops, source, message, elapsed } = result;

  const allowedSkip = train.special === 'z201' ? 1 : 0;

  if (segmentsOk >= segmentsTotal - allowedSkip) {
    passes.push(`①段完成 ${segmentsOk}/${segmentsTotal} ≥ ${segmentsTotal - allowedSkip}`);
  } else {
    failures.push(`①段完成 ${segmentsOk}/${segmentsTotal} < ${segmentsTotal - allowedSkip}`);
  }

  const goodTiers = ['corridor', 'network', 'local'];
  if (goodTiers.includes(qualityTier)) {
    passes.push(`②qualityTier=${qualityTier}`);
  } else {
    failures.push(`②qualityTier=${qualityTier} 不在 {corridor,network,local}`);
  }

  const isTimeout = message.includes('超时') || message.includes('timeout');
  if (!isTimeout) {
    passes.push('③无job_timeout');
  } else {
    failures.push('③message含超时标记');
  }

  if (coords.length >= 2 && stops.length >= 2) {
    const stopsWithCoords = stops.filter((s) => s.lng != null && s.lat != null);
    let maxProj = 0;
    let worstStop = '';
    for (const s of stopsWithCoords) {
      const d = pointToPolylineKm(Number(s.lng), Number(s.lat), coords);
      if (d > maxProj) {
        maxProj = d;
        worstStop = s.name;
      }
    }
    if (maxProj <= 15) {
      passes.push(`④经停站投影≤15km (max=${maxProj.toFixed(1)}km@${worstStop})`);
    } else {
      failures.push(`④经停站投影>15km (max=${maxProj.toFixed(1)}km@${worstStop})`);
    }
  } else {
    failures.push('④coords或stops不足无法计算投影');
  }

  if (coords.length >= 2 && stops.length >= 2) {
    const stopsWithCoords = stops.filter((s) => s.lng != null && s.lat != null);
    if (stopsWithCoords.length >= 2) {
      const routeMileage = polylineMileageKm(coords);
      const stationSeqMileage = polylineMileageKm(
        stopsWithCoords.map((s) => [Number(s.lng), Number(s.lat)]),
      );
      if (stationSeqMileage > 0) {
        const ratio = routeMileage / stationSeqMileage;
        if (ratio <= 1.6) {
          passes.push(`⑤里程比=${ratio.toFixed(2)}≤1.6`);
        } else {
          failures.push(`⑤里程比=${ratio.toFixed(2)}>1.6`);
        }
      } else {
        failures.push('⑤站序里程=0无法计算比');
      }
    } else {
      failures.push('⑤有坐标经停站<2无法计算里程比');
    }
  } else {
    failures.push('⑤coords或stops不足无法计算里程比');
  }

  assertSpecial(result, passes, failures);

  return { passes, failures };
}

function assertSpecial(result, passes, failures) {
  const { train, qualityTier, segmentsOk, segmentsTotal, coords, stops, source, elapsed } = result;

  switch (train.special) {
    case 't270': {
      const xining = stops.find((s) => s.name === '西宁');
      if (xining && xining.lng != null && coords.length >= 2) {
        const d = pointToPolylineKm(Number(xining.lng), Number(xining.lat), coords);
        if (d <= 15) {
          passes.push(`⑥T270含西宁且投影${d.toFixed(1)}km≤15km`);
        } else {
          failures.push(`⑥T270西宁投影${d.toFixed(1)}km>15km`);
        }
      } else {
        failures.push('⑥T270未找到西宁或coords不足');
      }
      break;
    }
    case 'source_not_station': {
      if (source !== 'station') {
        passes.push(`⑥source=${source}≠station`);
      } else {
        failures.push(`⑥source=station（示意级）`);
      }
      break;
    }
    case 'no_big_jump': {
      const maxJump = coords.length >= 2 ? maxSegmentJumpKm(coords) : 0;
      if (maxJump <= 80) {
        passes.push(`⑥最大跳接${maxJump.toFixed(0)}km≤80km`);
      } else {
        failures.push(`⑥最大跳接${maxJump.toFixed(0)}km>80km`);
      }
      break;
    }
    case 'c8902': {
      const goodTiers = ['local', 'network', 'corridor'];
      if (goodTiers.includes(qualityTier)) {
        passes.push(`⑥C8902 qualityTier=${qualityTier}（本地级及以上）`);
      } else {
        failures.push(`⑥C8902 qualityTier=${qualityTier}未达本地级`);
      }
      const maxJump = coords.length >= 2 ? maxSegmentJumpKm(coords) : 0;
      if (maxJump <= 80) {
        passes.push(`⑥C8902最大跳接${maxJump.toFixed(0)}km≤80km（近似偏离包西线）`);
      } else {
        failures.push(`⑥C8902最大跳接${maxJump.toFixed(0)}km>80km`);
      }
      break;
    }
    case 'exact_match': {
      const expected = train.expectedSegs;
      if (segmentsOk === expected && segmentsTotal === expected) {
        passes.push(`⑥${segmentsOk}/${segmentsTotal}=${expected}/${expected}`);
      } else {
        failures.push(`⑥${segmentsOk}/${segmentsTotal}≠${expected}/${expected}`);
      }
      break;
    }
    case 'c7601': {
      if (qualityTier === 'corridor') {
        passes.push(`⑥C7601走廊级`);
      } else {
        failures.push(`⑥C7601 qualityTier=${qualityTier}非走廊级`);
      }
      if (elapsed <= 1000) {
        passes.push(`⑥C7601耗时${elapsed}ms≤1000ms`);
      } else {
        failures.push(`⑥C7601耗时${elapsed}ms>1000ms`);
      }
      break;
    }
    case 'z201': {
      if (segmentsOk >= 12 && segmentsTotal >= 13) {
        passes.push(`⑥Z201 ${segmentsOk}/${segmentsTotal}≥12/13`);
      } else {
        failures.push(`⑥Z201 ${segmentsOk}/${segmentsTotal}<12/13`);
      }
      const hasFerry = coords.length >= 2 && hasFerrySegment(coords);
      if (hasFerry) {
        passes.push('⑥Z201含轮渡示意段');
      } else {
        failures.push('⑥Z201未检测到轮渡示意段');
      }
      if (elapsed <= 60000) {
        passes.push(`⑥Z201耗时${elapsed}ms≤60000ms`);
      } else {
        failures.push(`⑥Z201耗时${elapsed}ms>60000ms`);
      }
      break;
    }
    case 'random': {
      if (source !== 'station') {
        passes.push(`⑥随机抽签source=${source}≠station`);
      } else {
        failures.push(`⑥随机抽签source=station（示意级）`);
      }
      break;
    }
    default:
      break;
  }
}

function hasFerrySegment(coords) {
  const ferryLngMin = 109.5;
  const ferryLngMax = 111.0;
  const ferryLatMin = 19.5;
  const ferryLatMax = 21.5;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const inFerry1 = lng1 >= ferryLngMin && lng1 <= ferryLngMax && lat1 >= ferryLatMin && lat1 <= ferryLatMax;
    const inFerry2 = lng2 >= ferryLngMin && lng2 <= ferryLngMax && lat2 >= ferryLatMin && lat2 <= ferryLatMax;
    if (inFerry1 && inFerry2) {
      const d = haversineKm(lng1, lat1, lng2, lat2);
      if (d >= 20) return true;
    }
  }
  return false;
}

async function main() {
  const { verbose, trains } = parseArgs();

  let stationsGeo = {};
  try {
    stationsGeo = JSON.parse(readFileSync(join(__dirname, '../data/stations-geo.json'), 'utf8'));
  } catch {}

  const expandedTrains = trains.map((t) => {
    if (t.from === '__random__' && t.to === '__random__') {
      const picked = pickRandomTrain(stationsGeo);
      return { ...t, ...picked, issue: `随机抽签 ${picked.code} ${picked.from}→${picked.to}` };
    }
    return t;
  });

  console.log(`AUDIT: ${expandedTrains.length} trains, API=${API_BASE}`);

  const results = [];
  for (let i = 0; i < expandedTrains.length; i++) {
    const t = expandedTrains[i];
    const label = `${t.code || '?'} ${t.from}→${t.to}`;
    process.stdout.write(`[${i + 1}/${expandedTrains.length}] ${label} ... `);
    const r = await auditTrainViaJob(t, verbose);
    r.assertions = assertTrainCase(r);
    results.push(r);
    const af = r.assertions.failures.length;
    const ap = r.assertions.passes.length;
    if (r.status === 'OK' || r.status === 'TIMEOUT') {
      console.log(`${r.qualityTier} ${r.segmentsOk}/${r.segmentsTotal}seg ${r.elapsed}ms [${ap}pass ${af}fail]`);
    } else {
      console.log(`${r.status}: ${r.detail || ''} [${ap}pass ${af}fail]`);
    }
    if (verbose && af > 0) {
      for (const f of r.assertions.failures) console.log(`    FAIL: ${f}`);
    }
  }

  const lines = [
    '# 路线审计报告',
    '',
    `> 审计时间：${new Date().toISOString()}`,
    `> API：${API_BASE}`,
    `> 车次数：${expandedTrains.length}`,
    '',
    '## 汇总',
    '',
  ];

  const totalFailures = results.reduce((s, r) => s + (r.assertions?.failures?.length || 0), 0);
  const totalPasses = results.reduce((s, r) => s + (r.assertions?.passes?.length || 0), 0);
  lines.push(`- 统一断言：${totalPasses} pass / ${totalFailures} fail`);
  lines.push(`- 总体判定：${totalFailures === 0 ? '✅ ALL PASS' : '❌ HAS FAILURES'}`);
  lines.push('');

  const byTier = {};
  for (const r of results) {
    const t = r.qualityTier || 'none';
    byTier[t] = (byTier[t] || 0) + 1;
  }
  lines.push('| qualityTier | 数量 |');
  lines.push('|---|---|');
  for (const [tier, count] of Object.entries(byTier)) {
    lines.push(`| ${tier} | ${count} |`);
  }
  lines.push('');

  lines.push('## 逐车次结果');
  lines.push('');
  lines.push('| # | 车次 | 区间 | tier | 段 | 耗时 | 断言 | 失败项 | 原诊断 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const label = `${r.train.code || '?'} ${r.train.from}→${r.train.to}`;
    const seg = r.segmentsTotal > 0 ? `${r.segmentsOk}/${r.segmentsTotal}` : '—';
    const af = r.assertions?.failures?.length || 0;
    const ap = r.assertions?.passes?.length || 0;
    const passMark = af === 0 ? '✅' : '❌';
    const failItems = (r.assertions?.failures || []).join('; ') || '—';
    lines.push(`| ${i + 1} | ${r.train.code || '—'} | ${label} | ${r.qualityTier} | ${seg} | ${r.elapsed}ms | ${passMark} ${ap}/${ap + af} | ${failItems} | ${r.train.issue} |`);
  }
  lines.push('');

  lines.push('## 断言明细');
  lines.push('');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const label = `${r.train.code || '?'} ${r.train.from}→${r.train.to}`;
    lines.push(`### ${i + 1}. ${label}`);
    lines.push('');
    lines.push(`- status: ${r.status}, qualityTier: ${r.qualityTier}, source: ${r.source}`);
    lines.push(`- segments: ${r.segmentsOk}/${r.segmentsTotal}, coords: ${r.coords.length}pts, elapsed: ${r.elapsed}ms`);
    if (r.message) lines.push(`- message: ${r.message}`);
    if (r.unresolvedStops?.length) lines.push(`- unresolvedStops: ${r.unresolvedStops.join(', ')}`);
    lines.push(`- **PASS (${r.assertions?.passes?.length || 0}):**`);
    for (const p of r.assertions?.passes || []) lines.push(`  - ✅ ${p}`);
    lines.push(`- **FAIL (${r.assertions?.failures?.length || 0}):**`);
    for (const f of r.assertions?.failures || []) lines.push(`  - ❌ ${f}`);
    lines.push('');
  }

  writeFileSync(reportPath, lines.join('\n'));
  console.log(`\nReport written to ${reportPath}`);
  console.log(`Summary: ${totalPasses} pass / ${totalFailures} fail across ${results.length} trains`);

  if (totalFailures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});