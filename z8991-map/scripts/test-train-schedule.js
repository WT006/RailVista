/**
 * 验证在线地图「时刻表估算」逻辑：发车前 progress=0，发车后 progress>0 且随时间递增。
 * 运行: node scripts/test-train-schedule.js
 */

const STATIONS = [
  { name: '西宁', type: 'depart', at: '2026-08-11T22:00:00+08:00' },
  { name: '格尔木', type: 'stop', arrive: '2026-08-12T04:03:00+08:00', depart: '2026-08-12T04:28:00+08:00' },
  { name: '不冻泉', type: 'stop', arrive: '2026-08-12T06:51:00+08:00', depart: '2026-08-12T07:03:00+08:00' },
  { name: '沱沱河', type: 'stop', arrive: '2026-08-12T09:46:00+08:00', depart: '2026-08-12T09:48:00+08:00' },
  { name: '雁石坪', type: 'stop', arrive: '2026-08-12T10:59:00+08:00', depart: '2026-08-12T11:03:00+08:00' },
  { name: '安多', type: 'stop', arrive: '2026-08-12T13:16:00+08:00', depart: '2026-08-12T13:20:00+08:00' },
  { name: '那曲', type: 'stop', arrive: '2026-08-12T14:38:00+08:00', depart: '2026-08-12T14:44:00+08:00' },
  { name: '拉萨', type: 'arrive', at: '2026-08-12T18:28:00+08:00' },
];

const DEPARTURE = new Date('2026-08-11T22:00:00+08:00');
const ARRIVAL = new Date('2026-08-12T18:28:00+08:00');

/** 与 js/app.js scheduleProgress 保持一致 */
function scheduleProgress(now) {
  const timeline = [];
  STATIONS.forEach((s) => {
    if (s.at) timeline.push({ at: new Date(s.at), name: s.name });
    if (s.arrive) timeline.push({ at: new Date(s.arrive), name: s.name + '（到）' });
    if (s.depart) timeline.push({ at: new Date(s.depart), name: s.name + '（开）' });
  });
  timeline.sort((a, b) => a.at - b.at);

  if (now <= DEPARTURE) return 0;
  if (now >= ARRIVAL) return 1;

  for (let i = 0; i < timeline.length - 1; i += 1) {
    const cur = timeline[i];
    const next = timeline[i + 1];
    if (now >= cur.at && now <= next.at) {
      const span = next.at - cur.at || 1;
      const localT = (now - cur.at) / span;
      const idxA = STATIONS.findIndex((s) => cur.name.startsWith(s.name));
      const idxB = STATIONS.findIndex((s) => next.name.startsWith(s.name));
      const a = idxA >= 0 ? idxA / (STATIONS.length - 1) : i / (timeline.length - 1);
      const b = idxB >= 0 ? idxB / (STATIONS.length - 1) : (i + 1) / (timeline.length - 1);
      return a + (b - a) * localT;
    }
  }
  return (now - DEPARTURE) / (ARRIVAL - DEPARTURE);
}

function assert(name, condition) {
  if (!condition) {
    console.error(`  ✗ ${name}`);
    return false;
  }
  console.log(`  ✓ ${name}`);
  return true;
}

function pct(p) {
  return `${(p * 100).toFixed(2)}%`;
}

console.log('Z8991 列车时刻表进度测试\n');
console.log(`发车: ${DEPARTURE.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
console.log(`到达: ${ARRIVAL.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`);

const cases = [
  { label: '发车前 1 小时', time: '2026-08-11T21:00:00+08:00', expectZero: true },
  { label: '发车前 1 秒', time: '2026-08-11T21:59:59+08:00', expectZero: true },
  { label: '发车时刻', time: '2026-08-11T22:00:00+08:00', expectZero: true },
  { label: '发车后 1 秒', time: '2026-08-11T22:00:01+08:00', expectMoving: true },
  { label: '发车后 30 分钟', time: '2026-08-11T22:30:00+08:00', expectMoving: true },
  { label: '中途（格尔木附近）', time: '2026-08-12T04:15:00+08:00', expectMoving: true },
  { label: '到达时刻', time: '2026-08-12T18:28:00+08:00', expectFull: true },
];

let ok = true;
let prevProgress = null;

cases.forEach(({ label, time, expectZero, expectMoving, expectFull }) => {
  const now = new Date(time);
  const p = scheduleProgress(now);
  console.log(`[${label}] ${time} → progress ${pct(p)}`);

  if (expectZero) {
    ok = assert('进度应为 0（尚未发车）', p === 0) && ok;
  }
  if (expectMoving) {
    ok = assert('进度应 > 0（已开始移动）', p > 0) && ok;
    ok = assert('进度应 < 100%', p < 1) && ok;
  }
  if (expectFull) {
    ok = assert('进度应为 100%（已到达）', p === 1) && ok;
  }

  if (prevProgress != null && expectMoving) {
    ok = assert('相对上一时刻进度递增', p >= prevProgress) && ok;
  }
  prevProgress = p;
  console.log('');
});

const before = scheduleProgress(new Date('2026-08-11T21:59:58+08:00'));
const after1 = scheduleProgress(new Date('2026-08-11T22:00:03+08:00'));
const after2 = scheduleProgress(new Date('2026-08-11T22:00:08+08:00'));

console.log('模拟页面每 5 秒 tick（无 GPS）：');
console.log(`  21:59:58 → ${pct(before)}`);
console.log(`  22:00:03 → ${pct(after1)}`);
console.log(`  22:00:08 → ${pct(after2)}`);
ok = assert('22:00:03 比发车前 progress 增大', after1 > before) && ok;
ok = assert('22:00:08 比 22:00:03 略增', after2 > after1) && ok;

console.log('\n' + (ok ? '全部通过 — 到点后会按时刻表开始移动。' : '存在失败项，请检查 scheduleProgress 逻辑。'));
process.exit(ok ? 0 : 1);
