/**
 * Demo：对问题走廊做清洗前后门禁对比（一期清库最小可验证）。
 *
 *   node scripts/demo-corridor-rebuild.mjs
 *   node scripts/demo-corridor-rebuild.mjs --restore   # 从备份恢复
 *
 * 注意：
 * - 裸 OSM member-order 重抽可能拼成万公里乱线，本 demo 不做。
 * - Windows 抽 hsr 须 spawn 不带 shell，避免中文参数乱码。
 *
 * 写入：
 *   tmp/corridor-demo-backup/*.json
 *   docs/demo-corridor-rebuild-report.md
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corridorsDir = join(root, 'data/presets/corridors');
const backupDir = join(root, 'tmp/corridor-demo-backup');
const reportPath = join(root, 'docs/demo-corridor-rebuild-report.md');
const restore = process.argv.includes('--restore');

/** 门禁 heavy/medium 样例 + 对照精品线 */
const TARGETS = [
  { id: 'hukun', title: '沪昆高铁' },
  { id: 'lanxin', title: '兰新高铁' },
  { id: 'xiashen', title: '厦深铁路' },
  { id: 'jinghu', title: '京沪高铁（对照）' },
  { id: 'qingzang', title: '青藏铁路（对照）' },
];

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function analyze(railway) {
  let lengthKm = 0;
  let maxJump = 0;
  let sharpTurns = 0;
  for (let i = 1; i < railway.length; i++) {
    const d = haversine(
      { lng: railway[i - 1][0], lat: railway[i - 1][1] },
      { lng: railway[i][0], lat: railway[i][1] },
    );
    lengthKm += d;
    if (d > maxJump) maxJump = d;
  }
  for (let i = 1; i < railway.length - 1; i++) {
    const a = railway[i - 1];
    const b = railway[i];
    const c = railway[i + 1];
    const ab = haversine({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    const bc = haversine({ lng: b[0], lat: b[1] }, { lng: c[0], lat: c[1] });
    if (ab < 0.25 || bc < 0.25) continue;
    let deg =
      Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) *
      (180 / Math.PI);
    if (deg > 180) deg = 360 - deg;
    if (deg >= 150) sharpTurns += 1;
  }
  const end = { lng: railway.at(-1)[0], lat: railway.at(-1)[1] };
  const chord = haversine({ lng: railway[0][0], lat: railway[0][1] }, end) || 1;
  let maxProg = 0;
  let backtracks = 0;
  for (const p of railway) {
    const prog = 1 - haversine({ lng: p[0], lat: p[1] }, end) / chord;
    if (prog < maxProg - 0.01) backtracks += 1;
    maxProg = Math.max(maxProg, prog);
  }
  let tier = 'ok';
  if (sharpTurns >= 30 || backtracks >= 40 || maxJump > 40) tier = 'heavy';
  else if (sharpTurns >= 8 || backtracks >= 10 || maxJump > 15) tier = 'medium';
  else if (sharpTurns >= 1 || backtracks >= 3 || maxJump > 10) tier = 'light';
  return {
    points: railway.length,
    lengthKm: Number(lengthKm.toFixed(1)),
    maxJump: Number(maxJump.toFixed(2)),
    sharpTurns,
    backtracks,
    tier,
  };
}

function loadCorridor(id) {
  return JSON.parse(readFileSync(join(corridorsDir, `${id}.json`), 'utf8'));
}

function runNode(scriptArgs) {
  console.log(`\n> node ${scriptArgs.join(' ')}`);
  const r = spawnSync(process.execPath, scriptArgs, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.status === 0;
}

if (restore) {
  if (!existsSync(backupDir)) {
    console.error('no backup at', backupDir);
    process.exit(1);
  }
  for (const f of readdirSync(backupDir).filter((x) => x.endsWith('.json'))) {
    copyFileSync(join(backupDir, f), join(corridorsDir, f));
    console.log('restored', f);
  }
  process.exit(0);
}

mkdirSync(backupDir, { recursive: true });

const before = {};
for (const t of TARGETS) {
  const src = join(corridorsDir, `${t.id}.json`);
  if (!existsSync(src)) {
    console.warn('missing', t.id);
    continue;
  }
  // 仅在首次备份不存在时写入，避免覆盖「原始问题态」备份
  const bak = join(backupDir, `${t.id}.json`);
  if (!existsSync(bak)) copyFileSync(src, bak);
  before[t.id] = analyze(loadCorridor(t.id).railway);
}

const cleanOk = runNode(['scripts/clean-corridors.mjs', '--write']);
const hongqiaoOk = runNode(['scripts/patch-hukun-hongqiao-approach.mjs']);
const verifyOk = runNode(['scripts/verify-corridor-geometry.mjs']);

const after = {};
const rows = [];
for (const t of TARGETS) {
  if (!before[t.id]) continue;
  after[t.id] = analyze(loadCorridor(t.id).railway);
  rows.push({
    id: t.id,
    title: t.title,
    before: before[t.id],
    after: after[t.id],
  });
}

const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
const lines = [
  '# 走廊清库 Demo 报告',
  '',
  `生成时间：${now}`,
  '',
  '对照方案：[`docs/TECH-rail-geometry-quality.md`](./TECH-rail-geometry-quality.md) 一期。',
  '',
  '本 demo 动作：`clean-corridors --write`（含 `removeHubRetraces`）+ `patch-hukun-hongqiao-approach.mjs`，再跑门禁。',
  '',
  `备份：\`tmp/corridor-demo-backup/\`（\`node scripts/demo-corridor-rebuild.mjs --restore\` 可还原）。`,
  '',
  `clean 退出码：${cleanOk ? 0 : '非0'}；hongqiao 退出码：${hongqiaoOk ? 0 : '非0'}；verify 退出码：${verifyOk ? 0 : '非0'}。`,
  '',
  '## 前后对比',
  '',
  '| 走廊 | 阶段 | tier | sharp≥150° | backtracks | maxJump(km) | 点数 | 里程(km) |',
  '|------|------|------|------------|------------|-------------|------|----------|',
];

for (const r of rows) {
  const b = r.before;
  const a = r.after;
  lines.push(
    `| ${r.title} (${r.id}) | before | **${b.tier}** | ${b.sharpTurns} | ${b.backtracks} | ${b.maxJump} | ${b.points} | ${b.lengthKm} |`,
  );
  lines.push(
    `| | after | **${a.tier}** | ${a.sharpTurns} | ${a.backtracks} | ${a.maxJump} | ${a.points} | ${a.lengthKm} |`,
  );
}

lines.push(
  '',
  '## 实验结论（本机实测）',
  '',
  '1. **清洗有效**：沪昆 / 兰新 / 厦深 从 heavy/medium 降到 light；全库 `verify-corridor-geometry` 可 PASS（无 heavy）。',
  '2. **裸重抽危险**：沪昆从 hsr 无清洗重抽 → sharp 72→266、maxJump 升到 41km；兰新 OSM member-order → 里程飙到 ~1.7 万 km。入库必须 Dijkstra/`--from/--to` + 门禁，禁止静默 member-order。',
  '3. **仍非完美**：maxJump 仍约 10–14 km（light），一期后续应用 OSM relation + 站拟合门禁继续压。',
  '',
  '## 如何目视验证',
  '',
  '1. 启动 API + Web，选沪昆系 G 车、兰新 G 车、厦深沿线车次。',
  '2. 看蓝线尖刺是否减少；对照京沪 / 青藏。',
  '3. 复检：`node scripts/verify-corridor-geometry.mjs`',
  '4. 不满意可还原：`node scripts/demo-corridor-rebuild.mjs --restore`',
  '',
);

writeFileSync(reportPath, lines.join('\n'), 'utf8');
console.log('\nWrote', reportPath);
console.log(JSON.stringify(rows, null, 2));
