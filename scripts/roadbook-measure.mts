/**
 * 路书库里程实测：给「路段 distanceKm / 路线 totalKm / driveHours」一个可复算的实测口径。
 *
 * 用法（需 tsx loader，与 roads:od-check 同）:
 *   node --max-old-space-size=6144 apps/api/node_modules/tsx/dist/cli.mjs \
 *     scripts/roadbook-measure.mts tmp/measure-in.json tmp/measure-out.json [--engine=auto|baidu|local]
 *
 * 输入: [{ "id":"huangshan-3d", "legs":[{ "key":"hs-1", "from":"黄山市区", "to":"汤口镇",
 *          "a":[118.34,29.71], "b":[118.16,30.13] }] }]
 * 输出: 每条 leg 的 km / 分钟 / engine（direct=本地无解，需人工按公路里程表推算）
 *       + 直线上界比值，用于识别「绕行过多或坐标写错」。
 *
 * ── 引擎口径（2026-10-22 路书库扩量）────────────────────────────────────
 *   `--engine=auto`（默认）：**百度优先 → 本地拓扑 → OSRM → 高德**
 *     · 百度地图驾车规划（direction/v2，coord_type=wgs84 进出免转换），
 *       AK 只从环境变量 `BAIDU_MAP_KEY` 读，**不硬编码**。
 *     · 百度 AK 的 IP 白名单校验落在**边缘节点**上：同一把 AK 会因命中不同边缘
 *       而时通时不通（status 210「APP IP校验失败」/ 200「APP不存在」）。
 *       因此百度失败时**自动回退本地拓扑**，并在输出里把 `engine` 标成
 *       `baidu-fallback-local`，写稿时据此在 `mileageNote` 里如实交代口径。
 *   `--engine=baidu`：只走百度（不可用就报错，用于「必须用百度口径」的场合）
 *   `--engine=local`：只用本地国家公路网拓扑（离线可复算，扩量批次的默认底座）
 */
import fs from 'node:fs';
import { planDriveRoute } from '../apps/api/src/services/roadRouting.js';
import { loadRoadTopology, roadTopologyInfo } from '../apps/api/src/services/roadTopology.js';

const argv = process.argv.slice(2);
const inFile = argv.find((a) => !a.startsWith('--'));
const outArg = argv.filter((a) => !a.startsWith('--'))[1];
const engineArg = (argv.find((a) => a.startsWith('--engine=')) ?? '--engine=auto').split('=')[1];

if (!inFile) {
  console.log('用法: … scripts/roadbook-measure.mts <in.json> [out.json] [--engine=auto|baidu|local]');
  process.exit(1);
}

const hasBaiduKey = Boolean((process.env.BAIDU_MAP_KEY ?? '').trim());
/** 口径标记：写稿时要原样搬进 mileageNote，不能把推算写成实测。 */
let caliber = engineArg;

function straightKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  // ⚠️ a[0]/b[0] 是**经度**，a[1]/b[1] 才是纬度。2026-10-22 曾误写成 a[0]/b[0]，
  // 导致东西向跨度的 ratio 被严重压低（西安→咸阳真实直线 21.1km 被算成 8.3km，
  // 比值报 3.18 而真实只有 1.25），会让「实算 vs 推算」的 1.6 判据失效。
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const t0 = Date.now();
loadRoadTopology();
console.log('拓扑:', JSON.stringify(roadTopologyInfo()), `载入 ${Date.now() - t0}ms\n`);
console.log(
  `引擎: ${engineArg}  百度 AK: ${hasBaiduKey ? '已配置（环境变量 BAIDU_MAP_KEY）' : '未配置'}`,
);
if (engineArg === 'auto' && !hasBaiduKey) {
  console.log('  → 未配置百度 AK，本次直接走本地拓扑口径（里程记为本地 A* 实算）。');
}
console.log('');

/** 读 JSON：剥掉 BOM（PowerShell 的 Out-File -Encoding utf8 会写 BOM，直接 JSON.parse 会炸）。 */
function readJsonSafe(file: string): any {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

const books = readJsonSafe(inFile);
const out: any[] = [];

for (const book of books) {
  let sumKm = 0;
  let sumMin = 0;
  let direct = 0;
  let baiduUsed = 0;
  let baiduFallback = 0;
  const legsOut: any[] = [];

  for (const leg of book.legs) {
    // auto：百度优先；百度不可用则回退本地拓扑
    const order: Array<'baidu' | 'local'> =
      engineArg === 'baidu'
        ? ['baidu']
        : engineArg === 'local'
          ? ['local']
          : hasBaiduKey
            ? ['baidu', 'local']
            : ['local'];

    let r: any = null;
    let usedEngine = '';
    for (const eng of order) {
      const res = await planDriveRoute({
        from: `${leg.a[0]},${leg.a[1]}`,
        to: `${leg.b[0]},${leg.b[1]}`,
        engine: eng,
      });
      if (res?.lengthKm > 0) {
        r = res;
        usedEngine = res.engine ?? eng;
        if (eng === 'baidu') baiduUsed += 1;
        else if (order.includes('baidu')) baiduFallback += 1;
        break;
      }
    }

    const sl = straightKm(leg.a, leg.b);
    const ratio = sl > 0.5 && r ? r.lengthKm / sl : 0;
    const ok = !!r && r.engine !== 'direct';
    if (ok) {
      sumKm += r.lengthKm;
      sumMin += r.durationMin ?? 0;
    } else direct += 1;

    legsOut.push({
      key: leg.key,
      from: leg.from,
      to: leg.to,
      km: r ? Math.round(r.lengthKm * 10) / 10 : null,
      min: r?.durationMin ?? null,
      straightKm: Math.round(sl * 10) / 10,
      ratio: Math.round(ratio * 100) / 100,
      engine: r?.engine ?? 'direct',
      roads: (r?.roadKeys ?? []).slice(0, 6),
      note: leg.note,
    });

    console.log(
      `${ok ? '✓' : '✗'} ${book.id}/${leg.key}  ${leg.from}→${leg.to} = ${r ? r.lengthKm : '-'}km / ${r?.durationMin ?? '-'}min  ` +
        `直线${Math.round(sl)}km(×${ratio.toFixed(2)})  ${r?.engine ?? 'direct'}  ${(r?.roadKeys ?? []).slice(0, 4).join(',')}`,
    );
  }

  out.push({
    id: book.id,
    caliber,
    legs: legsOut,
    measuredKm: Math.round(sumKm),
    measuredMin: Math.round(sumMin),
    measuredHours: Math.round((sumMin / 60) * 10) / 10,
    directLegs: direct,
    baiduLegs: baiduUsed,
    baiduFallbackLegs: baiduFallback,
  });
  console.log(
    `→ ${book.id}: 实测合计 ${Math.round(sumKm)}km / ${(sumMin / 60).toFixed(1)}h 纯驾驶，无解段 ${direct}` +
      (baiduUsed ? `，百度 ${baiduUsed} 段` : '') +
      (baiduFallback ? `，百度不可用回退本地 ${baiduFallback} 段` : '') +
      '\n',
  );
}

fs.writeFileSync(outArg ?? 'tmp/roadbook-measure-out.json', JSON.stringify(out, null, 2));
console.log(`已写入 ${outArg ?? 'tmp/roadbook-measure-out.json'}`);
