/**
 * 路书库里程实测：用本地干线拓扑（国道+高速+省道主干）做 OD 最短路，
 * 给「路段 distanceKm / 路线 totalKm / driveHours」一个可复算的实测口径，
 * 而不是拍脑袋估算（PRD 红线 X2：禁止把估算写成实测）。
 *
 * 用法（需 tsx loader，与 roads:od-check 同）:
 *   node --max-old-space-size=6144 apps/api/node_modules/tsx/dist/cli.mjs \
 *     scripts/roadbook-measure.mts tmp/measure-in.json tmp/measure-out.json
 *
 * 输入: [{ "id":"huangshan-3d", "legs":[{ "key":"hs-1", "from":"黄山市区", "to":"汤口镇",
 *          "a":[118.34,29.71], "b":[118.16,30.13] }] }]
 * 输出: 每条 leg 的 km / 分钟 / engine（direct=本地无解，需人工按公路里程表推算）
 *       + 直线上界比值，用于识别「绕行过多或坐标写错」。
 */
import fs from 'node:fs';
import { planDriveRoute } from '../apps/api/src/services/roadRouting.js';
import { loadRoadTopology, roadTopologyInfo } from '../apps/api/src/services/roadTopology.js';

const inFile = process.argv[2];
const outFile = process.argv[3] || 'tmp/roadbook-measure-out.json';
if (!inFile) {
  console.log('用法: … scripts/roadbook-measure.mts <in.json> [out.json]');
  process.exit(1);
}

function straightKm(a: [number, number], b: [number, number]): number {
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
console.log('拓扑:', JSON.stringify(roadTopologyInfo()), `载入 ${Date.now() - t0}ms\n`);

const books = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const out: any[] = [];

for (const book of books) {
  let sumKm = 0;
  let sumMin = 0;
  let direct = 0;
  const legsOut: any[] = [];
  for (const leg of book.legs) {
    const r = await planDriveRoute({
      from: `${leg.a[0]},${leg.a[1]}`,
      to: `${leg.b[0]},${leg.b[1]}`,
      engine: 'local',
    });
    const sl = straightKm(leg.a, leg.b);
    const ratio = sl > 0.5 ? r.lengthKm / sl : 0;
    const ok = r.engine !== 'direct';
    if (ok) {
      sumKm += r.lengthKm;
      sumMin += r.durationMin ?? 0;
    } else direct += 1;
    legsOut.push({
      key: leg.key,
      from: leg.from,
      to: leg.to,
      km: r.lengthKm,
      min: r.durationMin ?? null,
      straightKm: Math.round(sl * 10) / 10,
      ratio: Math.round(ratio * 100) / 100,
      engine: r.engine,
      roads: (r.roadKeys ?? []).slice(0, 6),
      note: leg.note,
    });
    console.log(
      `${ok ? '✓' : '✗'} ${book.id}/${leg.key}  ${leg.from}→${leg.to} = ${r.lengthKm}km / ${r.durationMin ?? '-'}min  ` +
        `直线${Math.round(sl)}km(×${ratio.toFixed(2)})  ${r.engine}  ${(r.roadKeys ?? []).slice(0, 4).join(',')}`,
    );
  }
  out.push({
    id: book.id,
    legs: legsOut,
    measuredKm: Math.round(sumKm),
    measuredMin: Math.round(sumMin),
    measuredHours: Math.round((sumMin / 60) * 10) / 10,
    directLegs: direct,
  });
  console.log(
    `→ ${book.id}: 实测合计 ${Math.round(sumKm)}km / ${(sumMin / 60).toFixed(1)}h 纯驾驶，无解段 ${direct}\n`,
  );
}

fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`已写入 ${outFile}`);
