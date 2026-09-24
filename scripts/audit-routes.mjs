/**
 * C1: 路线审计工具 — 对车次清单逐一测试走廊/路网匹配，输出报告。
 *
 * 用法：
 *   node scripts/audit-routes.mjs                         # 审计全部 10 个车次
 *   node scripts/audit-routes.mjs --train K512 --from 广州白云 --to 杭州南
 *   node scripts/audit-routes.mjs --verbose               # 详细输出
 *   node scripts/audit-routes.mjs --csv input.csv         # 从 CSV 读车次清单
 *
 * 依赖：本地 API 需运行（pnpm dev），默认 http://localhost:3000
 * 输出：docs/route-audit-report.md
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = join(__dirname, '../docs/route-audit-report.md');

const API_BASE = process.env.AUDIT_API_BASE || 'http://localhost:3000';

const DEFAULT_TRAINS = [
  { code: 'K512', from: '广州白云', to: '杭州南', issue: 'R2+R3 京广缺株洲枢纽+杭州西≠杭州南' },
  { code: 'C7871', from: '海口东', to: '万宁', issue: 'R6 几何应过美兰' },
  { code: 'T237', from: '襄阳', to: '重庆西', issue: 'R4 xiangyu稀疏+末端未接站' },
  { code: 'G1692', from: '鹰潭北', to: '厦门北', issue: 'R1 弋阳/鹰潭北缺坐标' },
  { code: 'Z501', from: '北京西', to: '海口', issue: 'R4 zhanhai不存在+R2 hemao∩lizhan断' },
  { code: 'Z501', from: '北京西', to: '三亚', issue: '同#5 hainanxi断点相同' },
  { code: 'K553', from: '沈阳北', to: '佳木斯', issue: 'R1 经停缺坐标' },
  { code: '', from: '吐鲁番北', to: '喀什', issue: 'R3 吐鲁番北vs吐鲁番冲突+死锁' },
  { code: 'C7601', from: '广州南', to: '珠海北', issue: 'R3 珠海北vs珠海冲突+死锁' },
  { code: 'G2837', from: '成都东', to: '昆明', issue: 'R6 链路静态通疑似终到冲突' },
];

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
        },
      ],
    };
  }

  let trains = DEFAULT_TRAINS;
  if (csvPath && existsSync(csvPath)) {
    const lines = readFileSync(csvPath, 'utf8').trim().split('\n').slice(1);
    trains = lines.map((l) => {
      const [code, from, to] = l.split(',').map((s) => s.trim());
      return { code, from, to, issue: 'CSV' };
    });
  }

  return { verbose, trains };
}

async function auditTrain(train, verbose) {
  const stops = [
    { name: train.from },
    { name: train.to },
  ];

  const url = `${API_BASE}/rail-geometry`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stops, trainCode: train.code || undefined }),
      signal: AbortSignal.timeout(30000),
    });

    const json = await res.json();

    if (!json.ok) {
      return {
        train,
        status: 'FAIL',
        qualityTier: 'none',
        detail: json.error?.message || `HTTP ${res.status}`,
        rootCause: classifyError(json.error?.message || ''),
      };
    }

    const d = json.data;
    const qualityTier = determineQualityTier(d);
    const corridorId = d.corridorId || d.corridorName || '';
    const segmentsOk = d.segmentsOk ?? 0;
    const segmentsTotal = d.segmentsTotal ?? 0;
    const unresolved = d.unresolvedStops || [];

    const result = {
      train,
      status: 'OK',
      qualityTier,
      corridorId,
      segmentsOk,
      segmentsTotal,
      unresolvedStops: unresolved,
      coordsLen: d.coords?.length || 0,
      source: d.source || '',
      fromPreset: d.fromPreset || false,
    };

    if (verbose) {
      console.log(`  coords: ${result.coordsLen} pts, source: ${result.source}, preset: ${result.fromPreset}`);
      if (unresolved.length) console.log(`  unresolved: ${unresolved.join(', ')}`);
    }

    return result;
  } catch (e) {
    return {
      train,
      status: 'ERROR',
      qualityTier: 'none',
      detail: e.message,
      rootCause: 'API_UNREACHABLE',
    };
  }
}

function determineQualityTier(data) {
  if (data.corridorId && data.fromPreset) return 'corridor';
  if (data.fromPreset === false && data.segmentsOk > 0 && data.coords?.length > 10) return 'network';
  if (data.coords?.length > 10) return 'osm';
  return 'sketch';
}

function classifyError(msg) {
  if (msg.includes('可定位') || msg.includes('坐标')) return 'R1';
  if (msg.includes('走廊') || msg.includes('拼线')) return 'R2';
  if (msg.includes('冲突') || msg.includes('同城')) return 'R3';
  if (msg.includes('不存在') || msg.includes('缺口')) return 'R4';
  if (msg.includes('超时') || msg.includes('timeout')) return 'R5';
  return 'R6';
}

async function main() {
  const { verbose, trains } = parseArgs();
  console.log(`AUDIT: ${trains.length} trains, API=${API_BASE}`);

  const results = [];
  for (let i = 0; i < trains.length; i++) {
    const t = trains[i];
    const label = `${t.code || '?'} ${t.from}→${t.to}`;
    process.stdout.write(`[${i + 1}/${trains.length}] ${label} ... `);
    const r = await auditTrain(t, verbose);
    results.push(r);
    if (r.status === 'OK') {
      console.log(`${r.qualityTier} (${r.corridorId || '—'}) ${r.segmentsOk}/${r.segmentsTotal}seg`);
    } else {
      console.log(`${r.status}: ${r.detail || ''} [${r.rootCause || ''}]`);
    }
  }

  // Generate report
  const lines = [
    '# 路线审计报告',
    '',
    `> 审计时间：${new Date().toISOString()}`,
    `> API：${API_BASE}`,
    `> 车次数：${trains.length}`,
    '',
    '## 汇总',
    '',
  ];

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
  lines.push('| # | 车次 | 区间 | qualityTier | 走廊 | 段 | 丢站 | 根因 | 原诊断 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const label = `${r.train.code || '?'} ${r.train.from}→${r.train.to}`;
    const seg = r.segmentsOk != null ? `${r.segmentsOk}/${r.segmentsTotal}` : '—';
    const unresolved = (r.unresolvedStops || []).join(',') || '—';
    const cause = r.rootCause || (r.qualityTier === 'corridor' || r.qualityTier === 'network' ? '✓' : '?');
    lines.push(`| ${i + 1} | ${r.train.code || '—'} | ${label} | ${r.qualityTier} | ${r.corridorId || '—'} | ${seg} | ${unresolved} | ${cause} | ${r.train.issue} |`);
  }
  lines.push('');

  writeFileSync(reportPath, lines.join('\n'));
  console.log(`\nReport written to ${reportPath}`);

  const ok = results.filter((r) => r.qualityTier === 'corridor' || r.qualityTier === 'network').length;
  console.log(`Summary: ${ok}/${results.length} corridor/network quality`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});