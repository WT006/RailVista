/**
 * 公路 OD 寻路验证（本地拓扑 A*）。
 *
 * 背景：2026-10-11 之前 data/roads/china-road-topo.bin 是 10-01 构建的，
 * 只装了 34 条国道，主连通分量 bbox 仅青藏东部 —— 跨省 OD 的 A* 全部无解、
 * 100% 降级成两点直线。国道/省道几何补完后拓扑重建为 148.9 万节点 / 370.3 万边，
 * 主分量覆盖 98.2% 节点，本脚本用来把这个结论钉住、防止再退化。
 *
 * 用法（roadTopology / roadRouting 是 TS，需要 tsx loader）：
 *   node --max-old-space-size=6144 apps/api/node_modules/tsx/dist/cli.mjs scripts/verify-road-routing.ts
 *   … scripts/verify-road-routing.ts --strict     # 出现 direct 或超时 → exit 1
 */
import { planDriveRoute } from '../apps/api/src/services/roadRouting.js';
import { loadRoadTopology, roadTopologyInfo } from '../apps/api/src/services/roadTopology.js';
import { matchSpotsAlong } from '../apps/api/src/services/roadsideSpots.js';
import { decimatePointsWithIndex } from '../apps/api/src/services/roadNetwork.js';

const STRICT = process.argv.includes('--strict');
const SLOW_MS = 1500;

/** 起终点一律用「城市 / 区县」名——这正是产品承诺的输入口径 */
const OD_CASES: Array<[string, string]> = [
  ['上海', '拉萨'],
  ['北京', '广州'],
  ['成都', '喀什'],
  ['杭州', '西安'],
  ['广州', '哈尔滨'],
  ['嘉定区', '拉萨'],
  ['敦煌市', '西宁'],
  ['长沙', '三亚'],
  ['昆明', '漠河'],
  ['武汉', '乌鲁木齐'],
  ['西安', '林芝'],
  ['南京', '重庆'],
];

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const t0 = Date.now();
loadRoadTopology();
console.log('拓扑:', roadTopologyInfo(), `载入 ${Date.now() - t0}ms\n`);

let direct = 0;
let slow = 0;
const rows: string[] = [];

for (const [from, to] of OD_CASES) {
  const s = Date.now();
  const route = await planDriveRoute({ from, to, engine: 'local' });
  const ms = Date.now() - s;
  const first = route.coords[0] as [number, number];
  const last = route.coords[route.coords.length - 1] as [number, number];
  const crowKm = haversineKm(first, last);
  // 路网绕行系数：直线 < 路网里程 < 直线×2.2（超过说明绕了离谱的远路）
  const detour = crowKm > 0 ? route.lengthKm / crowKm : 0;
  const dec = decimatePointsWithIndex(route.coords as [number, number][], 600);
  const spots = matchSpotsAlong(dec.points);
  const cumOk = route.cumKm?.length === route.coords.length;
  const flags: string[] = [];
  if (route.engine === 'direct') {
    direct += 1;
    flags.push('DIRECT');
  }
  if (ms > SLOW_MS) {
    slow += 1;
    flags.push('SLOW');
  }
  if (detour > 2.2) flags.push('DETOUR');
  if (!cumOk) flags.push('CUMKM');
  rows.push(
    `${(from + ' → ' + to).padEnd(16)} ${String(route.engine).padEnd(13)} ` +
      `${String(Math.round(route.lengthKm)).padStart(5)} km  ` +
      `直线 ${String(Math.round(crowKm)).padStart(5)} km  ×${detour.toFixed(2)}  ` +
      `${String(route.coords.length).padStart(5)} 点  ` +
      `章节 ${String(route.chapters?.length ?? 0).padStart(3)}  ` +
      `景点 ${String(spots.length).padStart(3)}  ` +
      `${route.durationMin ? '约' + Math.round(route.durationMin / 60) + 'h' : '—'}  ` +
      `${String(ms).padStart(5)}ms  ${flags.join(',')}`,
  );
}

console.log(rows.join('\n'));
console.log(
  `\n合计 ${OD_CASES.length} 组：降级 direct ${direct} 组，超 ${SLOW_MS}ms ${slow} 组`,
);

if (STRICT && (direct > 0 || slow > 0)) {
  console.error('\n严格模式：存在 direct 降级或超时，视为失败');
  process.exit(1);
}
