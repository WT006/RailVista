/**
 * 构建期一次性脚本：生成首页「背景中国地图」所需的全部离线静态资源。
 *
 * 产出（均随包发布，运行时零网络请求、零地图服务依赖）：
 *   1. apps/web/src/assets/china-outline.svg   中国轮廓剪影（矢量）
 *   2. apps/web/src/data/chinaBackdrop.ts      投影参数 + 全国铁路景点热力点
 *
 * 背景：首页需要一层"极淡的中国地图"作装饰背景，鼠标移入产生光影与景点高亮。
 * 为避免运行时依赖在线地图服务，在构建期把边界与点位预计算并冻结进工程。
 *
 * 合规：边界数据来自高德（合规定位服务商）。生成结果需人工校核台湾省、
 * 海南省（含南海诸岛）、藏南、钓鱼岛及赤尾屿画法符合国家标准后再提交。
 *
 * 用法：
 *   node scripts/build-china-backdrop.mjs [--tol 0.015] [--minSpan 0.008]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const OUT_SVG = arg('out', 'apps/web/src/assets/china-outline.svg');
const OUT_TS = arg('outTs', 'apps/web/src/data/chinaBackdrop.ts');
const ORIGIN = arg('origin', 'http://localhost:5173/');
const TOLERANCE = Number(arg('tol', '0.015'));
const MIN_RING_POINTS = Number(arg('minRing', '3'));
const MIN_SPAN = Number(arg('minSpan', '0.008'));
const SVG_WIDTH = 1000;

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readAmapKey() {
  const envPath = 'apps/web/.env';
  if (!fs.existsSync(envPath)) throw new Error(`缺少 ${envPath}`);
  const txt = fs.readFileSync(envPath, 'utf8');
  const key = /VITE_AMAP_KEY\s*=\s*(.+)/.exec(txt)?.[1]?.trim();
  const sec = /VITE_AMAP_SECURITY\s*=\s*(.+)/.exec(txt)?.[1]?.trim();
  if (!key) throw new Error('.env 中未找到 VITE_AMAP_KEY');
  return { key, sec };
}

// ── Douglas-Peucker 折线简化 ────────────────────────────────────────────────
function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const cx = a[0] + Math.max(0, Math.min(1, t)) * dx;
  const cy = a[1] + Math.max(0, Math.min(1, t)) * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}
function simplify(points, tol) {
  if (points.length <= 2) return points;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], points[0], points[points.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, idx + 1), tol);
  const right = simplify(points.slice(idx), tol);
  return left.slice(0, -1).concat(right);
}

/** Web Mercator：经度线性、纬度对数。与前端运行时使用同一套公式。 */
function mercator(lng, lat) {
  return [(lng * Math.PI) / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
}

/** 抓取国界（复用 dev server 已配置的 AMap key 与域名白名单） */
async function fetchBoundaries() {
  const { key, sec } = readAmapKey();
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-outline-'));
  const port = 9800 + Math.floor(Math.random() * 400);
  const child = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
      '--window-size=1280,800',
      `--user-data-dir=${userDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let wsUrl = null;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  if (!wsUrl) {
    child.kill();
    throw new Error('CDP 未就绪');
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++msgId;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    }
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: ORIGIN });
  await sleep(4000);

  const result = await evaluate(`(async () => {
    const KEY = ${JSON.stringify(key)};
    const SEC = ${JSON.stringify(sec || '')};
    await new Promise((resolve, reject) => {
      if (window.AMap) return resolve();
      if (SEC) window._AMapSecurityConfig = { securityJsCode: SEC };
      const s = document.createElement('script');
      s.src = 'https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(KEY) + '&plugin=AMap.DistrictSearch';
      s.onload = resolve;
      s.onerror = () => reject(new Error('AMap SDK 加载失败'));
      document.head.appendChild(s);
    });
    await new Promise((r) => setTimeout(r, 800));
    if (!window.AMap) throw new Error('AMap 未挂载');

    const search = new AMap.DistrictSearch({ level: 'country', subdistrict: 1, extensions: 'all', showbiz: false });
    const res = await new Promise((resolve, reject) => {
      search.search('中国', (status, result) => {
        if (status === 'complete') resolve(result);
        else reject(new Error('DistrictSearch 失败: ' + status + ' ' + (result && result.info)));
      });
    });

    // 关键：AMap 只在被查询的行政区上返回 boundaries。
    // 查询「中国」时根节点带完整国界（含台湾省、南海诸岛等全部岛屿环），
    // subdistrict=1 的省级子节点 boundaries 为空 —— 故直接用根节点国界做剪影。
    const root = res.districtList?.[0];
    if (!root?.boundaries?.length) throw new Error('根节点未返回 boundaries');
    const rings = root.boundaries.map((b) =>
      typeof b === 'string' ? b : (b || []).map((p) => p.lng + ',' + p.lat).join(';'),
    );
    return { name: root.name, rings };
  })()`);

  ws.close();
  child.kill();
  return result;
}

async function main() {
  const districts = await fetchBoundaries();
  console.log(`[backdrop] ${districts.name}：原始边界环 ${districts.rings.length} 个`);

  // ── 解析 + 降噪 + 简化 ────────────────────────────────────────────────────
  // 国界含大量细小岛礁环：装饰背景需要降噪，但南海诸岛等必须保留，
  // 因此只用「极小的经纬跨度」筛掉真正无意义的碎点，而不是按面积砍岛。
  const rings = [];
  let dropped = 0;
  for (const ringStr of districts.rings) {
    const pts = ringStr
      .split(';')
      .map((s) => s.split(',').map(Number))
      .filter((c) => c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (pts.length < MIN_RING_POINTS) {
      dropped++;
      continue;
    }
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of pts) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    if (Math.max(maxLng - minLng, maxLat - minLat) < MIN_SPAN) {
      dropped++;
      continue;
    }
    const simple = simplify(pts, TOLERANCE);
    if (simple.length < 4) {
      dropped++;
      continue;
    }
    rings.push(simple);
  }
  console.log(`[backdrop] 降噪丢弃 ${dropped} 个碎环，保留 ${rings.length} 个`);
  if (!rings.length) throw new Error('过滤后无可用环，请放宽 --minSpan / --minRing');

  // ── 投影 + 求包围盒 ──────────────────────────────────────────────────────
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const projected = rings.map((pts) =>
    pts.map(([lng, lat]) => {
      const [x, y] = mercator(lng, lat);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return [x, y];
    }),
  );
  if (!Number.isFinite(minX) || maxX === minX || maxY === minY) throw new Error('包围盒无效');

  const width = SVG_WIDTH;
  const height = Math.round((SVG_WIDTH * (maxY - minY)) / (maxX - minX));
  const sx = width / (maxX - minX);
  const sy = height / (maxY - minY);
  const toPx = ([x, y]) => [
    Math.round((x - minX) * sx * 10) / 10,
    Math.round((maxY - y) * sy * 10) / 10,
  ];

  const paths = projected
    .map((xy) => {
      const px = xy.map(toPx).filter((c, i, arr) => i === 0 || c[0] !== arr[i - 1][0] || c[1] !== arr[i - 1][1]);
      if (px.length < 3) return null;
      return px.map((c, i) => (i === 0 ? 'M' : 'L') + c[0] + ' ' + c[1]).join(' ') + ' Z';
    })
    .filter(Boolean);
  if (!paths.length) throw new Error('投影后无可用路径');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="中国轮廓">
  <!-- 由 scripts/build-china-backdrop.mjs 生成，请勿手改 -->
  <!-- 数据源：高德行政区划边界（合规定位服务商）；用途：首页装饰性背景 -->
  <!-- 环数 ${paths.length}；简化容差 ${TOLERANCE}°；生成于 ${new Date().toISOString()} -->
  <g fill="currentColor" fill-rule="nonzero">
    ${paths.map((d) => `<path d="${d}" />`).join('\n    ')}
  </g>
</svg>
`;
  fs.mkdirSync(path.dirname(OUT_SVG), { recursive: true });
  fs.writeFileSync(OUT_SVG, svg, 'utf8');
  console.log(`[backdrop] 轮廓 → ${OUT_SVG}（${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB，viewBox ${width}x${height}）`);

  // ── 全国铁路景点热力点 ────────────────────────────────────────────────────
  const spotsFile = 'data/presets/scenic-spots.json';
  const spots = JSON.parse(fs.readFileSync(spotsFile, 'utf8')).spots || [];
  // 按类型给出相对权重，让"热力"体现景点密度与可看性，而不是均匀白点
  const WEIGHT = {
    mountain: 1,
    gorge: 0.95,
    lake: 0.9,
    desert: 0.85,
    grassland: 0.8,
    engineering: 0.75,
    other: 0.6,
  };
  const heat = [];
  for (const s of spots) {
    if (typeof s.lng !== 'number' || typeof s.lat !== 'number') continue;
    // 与轮廓同一套投影，保证点位与地图严格对齐
    const [px, py] = toPx(mercator(s.lng, s.lat));
    heat.push([px, py, WEIGHT[s.category] ?? WEIGHT.other]);
  }
  console.log(`[backdrop] 热力点 ${heat.length} 个（共 ${spots.length} 条景点）`);

  // 墨卡托包围盒一并导出：前端如需按经纬度实时换算，用同一组常量即可
  const ts = `/**
 * 首页「背景中国地图」的离线静态数据。
 *
 * ⚠️ 由 \`scripts/build-china-backdrop.mjs\` 自动生成，请勿手改。
 * 数据源：高德行政区划边界 + \`data/presets/scenic-spots.json\`（全国铁路沿线景点）。
 * 生成时间：${new Date().toISOString()}
 *
 * 设计意图：把投影参数与景点热力点预计算好并冻结进工程，
 * 使首页背景地图在运行时**不发起任何网络请求**、不依赖在线地图服务。
 */

/** 与 \`assets/china-outline.svg\` 的 viewBox 严格一致 */
export const CHINA_OUTLINE_VIEWBOX = { width: ${width}, height: ${height} } as const;

/** Web Mercator 包围盒（用于把任意经纬度换算到 viewBox 坐标） */
export const CHINA_MERCATOR_BOUNDS = {
  minX: ${minX.toFixed(10)},
  maxX: ${maxX.toFixed(10)},
  minY: ${minY.toFixed(10)},
  maxY: ${maxY.toFixed(10)},
  width: ${width},
  height: ${height},
} as const;

/** [x, y, weight]：viewBox 坐标下的景点热力点，weight 为观赏权重(0–1) */
export type ChinaHeatPoint = readonly [x: number, y: number, w: number];

export const CHINA_SCENIC_HEAT: readonly ChinaHeatPoint[] = [
${heat.map((h) => `  [${h[0]}, ${h[1]}, ${h[2]}],`).join('\n')}
];

/**
 * 把经纬度换算为 viewBox 坐标（与生成脚本同一套公式，供运行时扩展使用）。
 */
export function lngLatToViewBox(lng: number, lat: number): [number, number] {
  const b = CHINA_MERCATOR_BOUNDS;
  const x = (lng * Math.PI) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [(x - b.minX) * (b.width / (b.maxX - b.minX)), (b.maxY - y) * (b.height / (b.maxY - b.minY))];
}
`;
  fs.mkdirSync(path.dirname(OUT_TS), { recursive: true });
  fs.writeFileSync(OUT_TS, ts, 'utf8');
  console.log(`[backdrop] 数据 → ${OUT_TS}（${(Buffer.byteLength(ts) / 1024).toFixed(1)} KB）`);
  console.log('[backdrop] 请人工校核：台湾省、海南省（含南海诸岛）、藏南、钓鱼岛及赤尾屿画法。');
}

main().catch((e) => {
  console.error('[backdrop] 失败：', e.message);
  process.exit(1);
});
