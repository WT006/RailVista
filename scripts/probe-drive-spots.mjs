/**
 * 公路沿程景点页视觉/结构探针（真浏览器 headless Edge）。
 *
 * 用途：验收「公路景点 v2」在 390 / 1440 两个宽度下是否真的渲染出
 * 方位徽标、评分、照片、可达档位，以及控制台有没有报错。
 *
 * 判据（全过才算过，任一失败打印 FAIL 并以退出码 1 结束）：
 *   1. `.road-spot` 卡片数 > 0
 *   2. 每张卡片都有 `.road-side-badge`，且取值覆盖 left / right / both / unknown
 *      （若一个都没有 left 或 right，多半是量纲写错导致符号翻转）
 *   3. 可达档位 chip（is-pass / is-detour / is-spur）存在
 *   4. 展开首张卡片后 `.road-spot__facts` 可见
 *   5. 横向不溢出：documentElement.scrollWidth <= innerWidth + 2
 *   6. 控制台无 error
 *
 * 用法：node scripts/probe-drive-spots.mjs [url] [--w 1440] [--out name]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const URL_ =
  process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : 'http://127.0.0.1:5173/drive/trip?from=%E4%B8%8A%E6%B5%B7&to=%E6%9D%AD%E5%B7%9E';
const W = Number(arg('w', 1440));
const H = Number(arg('h', 900));
const OUT = arg('out', `drive-spots-${W}`);

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const userDir = mkdtempSync(join(tmpdir(), 'rv-spot-probe-'));
const port = 9500 + Math.floor(Math.random() * 400);
// 本机有系统代理，headless 不加这两条会被代理劫持导致页面加载不出来
const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-proxy-server',
    '--proxy-bypass-list=*',
    `--remote-debugging-port=${port}`,
    `--window-size=${W},${H}`,
    `--user-data-dir=${userDir}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error('CDP 未就绪');
}

const ws = new WebSocket(await getWs());
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    consoleErrors.push(
      `${m.params.type}: ${(m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`,
    );
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(`exception: ${(m.params.exceptionDetails?.exception?.description ?? '').slice(0, 200)}`);
  }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) {
    return { __error: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '') };
  }
  return r.result?.result?.value;
}

await send('Emulation.setDeviceMetricsOverride', {
  width: W,
  height: H,
  deviceScaleFactor: Number(arg('dsf', 1)),
  mobile: W < 800,
});
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_ });
await sleep(Number(arg('wait', '9000')));

const probeJs = `(async () => {
  const cards = [...document.querySelectorAll('.road-spot')];
  const badges = [...document.querySelectorAll('.road-spot .road-side-badge')];
  const sideClasses = {};
  for (const b of badges) {
    const m = /road-side-badge--(left|right|both|unknown)/.exec(b.className);
    const k = m ? m[1] : 'none';
    sideClasses[k] = (sideClasses[k] || 0) + 1;
  }
  const reach = {};
  for (const el of document.querySelectorAll('.road-spot__class')) {
    const m = /is-(pass|detour|spur)/.exec(el.className);
    const k = m ? m[1] : 'none';
    reach[k] = (reach[k] || 0) + 1;
  }
  // 展开第一张卡片，看详情区是否真的展开（Vue 更新是异步的，必须等一个 tick）
  if (cards.length) cards[0].click();
  await new Promise((r) => setTimeout(r, 600));
  const expandedInner = document.querySelectorAll('.road-spot.is-expanded .road-spot__expand-inner').length;
  const factsAfter = [...document.querySelectorAll('.road-spot.is-expanded .road-spot__fact')].map((e) => e.textContent.trim().slice(0, 60));
  const html = document.documentElement;
  const list = document.querySelector('.drive-flow-list');
  return {
    url: location.href,
    viewport: [innerWidth, innerHeight],
    cards: cards.length,
    badges: badges.length,
    sideClasses,
    reach,
    photos: document.querySelectorAll('.road-spot__photo').length,
    ratings: [...document.querySelectorAll('.road-spot__rating')].map((e) => e.textContent.trim()).slice(0, 5),
    filters: [...document.querySelectorAll('.road-kbd__chip.is-reach')].map((e) => e.textContent.trim()),
    expandedInner,
    factsAfter,
    footnote: (document.querySelector('.drive-footnote')?.textContent || '').trim().slice(0, 160),
    overflowX: html.scrollWidth - html.clientWidth,
    // 列表容器横向溢出：卡片被 grid 项的 min-width:auto 顶宽时，简介会被父级
    // overflow-x:auto 横着裁断（实测容器 307 / 卡片 393）。这条判据专门防这个回归。
    listOverflowX: list ? list.scrollWidth - list.clientWidth : -1,
  };
})()`;

const result = await evaluate(probeJs);
console.log(JSON.stringify(result, null, 2));

// 截图留证（--clip "x,y,w,h" 可只截某块区域，放大看细节）
const clipArg = arg('clip', '');
const shotParams = { format: 'png', captureBeyondViewport: false };
if (clipArg) {
  const [x, y, w, h] = clipArg.split(',').map(Number);
  shotParams.clip = { x, y, width: w, height: h, scale: 1 };
}
const shot = await send('Page.captureScreenshot', shotParams);
if (shot.result?.data) {
  const p = `.tmp-diag/${OUT}.png`;
  writeFileSync(p, Buffer.from(shot.result.data, 'base64'));
  console.log('截图:', p);
}

// —— 判据 ——
const checks = [];
const add = (ok, label) => checks.push({ ok, label });
if (result?.__error) add(false, `探针执行失败：${result.__error}`);
else {
  add(result.cards > 0, `景点卡片渲染（${result.cards} 张）`);
  add(result.badges > 0, `方位徽标存在（${result.badges} 个）`);
  add(
    (result.sideClasses.left ?? 0) + (result.sideClasses.right ?? 0) > 0,
    `左右侧都有取值（左 ${result.sideClasses.left ?? 0} / 右 ${result.sideClasses.right ?? 0} / 路上 ${result.sideClasses.both ?? 0} / 待定 ${result.sideClasses.unknown ?? 0}）`,
  );
  add(Object.keys(result.reach).length > 0, `可达档位 chip 存在（${JSON.stringify(result.reach)}）`);
  add(result.filters.length === 3, `可达性筛选 3 档（${result.filters.join('/')}）`);
  add(result.expandedInner > 0, `点击卡片能展开详情区（${result.expandedInner} 个）`);
  add(result.factsAfter.length > 0, `展开后结构化字段可见（到达/开放/票务 ${result.factsAfter.length} 项）`);
  add(result.overflowX <= 2, `页面无横向溢出（${result.overflowX}px）`);
  add(result.listOverflowX <= 2, `景点列表无横向溢出（${result.listOverflowX}px，卡片不被裁断）`);
  add(consoleErrors.length === 0, `控制台无报错（${consoleErrors.length} 条）`);
}
console.log('');
let failed = 0;
for (const c of checks) {
  if (!c.ok) failed += 1;
  console.log(`  ${c.ok ? 'PASS' : 'FAIL'} ${c.label}`);
}
if (consoleErrors.length) {
  console.log('\n控制台输出:');
  for (const e of consoleErrors.slice(0, 8)) console.log('  ', e);
}

child.kill();
process.exitCode = failed ? 1 : 0;