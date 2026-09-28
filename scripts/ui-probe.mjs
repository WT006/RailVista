/**
 * 轻量 CDP 探针：用本机 Edge headless 打开真实页面，测量滚动容器链与断点布局。
 * 用法: node scripts/ui-probe.mjs <url> [--w 1440] [--h 900] [--out name]
 */
const url = process.argv[2] || 'http://localhost:5173/';
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const W = Number(arg('w', 1440));
const H = Number(arg('h', 900));
const OUT = arg('out', 'probe');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const { spawn } = await import('node:child_process');
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-probe-'));
const port = 9333 + Math.floor(Math.random() * 300);
const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--window-size=${W},${H}`,
    `--user-data-dir=${userDir}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 60; i++) {
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

const wsUrl = await getWs();
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
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result?.exceptionDetails) {
    return { __error: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '') };
  }
  return r.result?.result?.value;
}

await send('Emulation.setDeviceMetricsOverride', {
  width: W,
  height: H,
  deviceScaleFactor: 1,
  mobile: W < 800,
});
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(Number(arg('wait', '3500')));

const probeJs = `(() => {
  const cs = (el) => el ? getComputedStyle(el) : null;
  const box = (el) => {
    if (!el) return null;
    const s = cs(el);
    return {
      tag: el.tagName + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : ''),
      clientH: el.clientHeight, scrollH: el.scrollHeight, clientW: el.clientWidth, scrollW: el.scrollWidth,
      overflowY: s.overflowY, overflowX: s.overflowX, height: s.height, minHeight: s.minHeight, position: s.position,
      canScroll: el.scrollHeight > el.clientHeight + 1,
    };
  };
  const html = document.documentElement, body = document.body, app = document.getElementById('app');
  const page = document.querySelector('.select-page');
  const sections = [...document.querySelectorAll('.select-hero, .select-form, .current-trip, .recent-list, .rankings, .train-list, .od-panel, .footnote, .select-top')].map(el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { sel: el.className.split(/\\s+/)[0], left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height),
      maxW: s.maxWidth, radius: s.borderRadius, padding: s.padding, gap: s.gap, marginBottom: s.marginBottom,
      titleSize: (() => { const h = el.querySelector('h1,h2,h3,.rankings__title'); return h ? getComputedStyle(h).fontSize : null; })() };
  });
  return {
    url: location.href,
    viewport: [innerWidth, innerHeight],
    scrollingElement: document.scrollingElement === html ? 'html' : (document.scrollingElement === body ? 'body' : String(document.scrollingElement && document.scrollingElement.tagName)),
    html: box(html), body: box(body), app: box(app), selectPage: box(page),
    docScrollTop: html.scrollTop, bodyScrollTop: body.scrollTop, pageScrollTop: page ? page.scrollTop : null,
    hasLenisClass: html.classList.contains('lenis') || html.classList.contains('lenis-smooth'),
    htmlClass: html.className, bodyClass: body.className,
    lenisVersion: !!(window.__lenisDebug),
    sections,
  };
})()`;

const layout = await evaluate(probeJs);

// —— 可选：注入候选修复 CSS，验证滚轮是否恢复 ——
let fixLayout = null;
if (process.argv.includes('--fix')) {
  await evaluate(`(() => {
    const s = document.createElement('style');
    s.id = 'rv-fix-probe';
    s.textContent = \`
      html, body, #app { height: auto !important; }
      html { overflow-y: auto !important; }
      body:has(.select-page) { overflow: visible !important; }
      .select-page { overflow: visible !important; min-height: 100vh !important; }
    \`;
    document.head.appendChild(s);
    return true;
  })()`);
  await sleep(400);
  fixLayout = await evaluate(`(() => {
    const html = document.documentElement, body = document.body;
    return {
      htmlScrollH: html.scrollHeight, htmlClientH: html.clientHeight,
      htmlOverflowY: getComputedStyle(html).overflowY,
      bodyScrollH: body.scrollHeight, bodyClientH: body.clientHeight,
      bodyOverflowY: getComputedStyle(body).overflowY,
    };
  })()`);
}

// —— 滚动测试 ——
// 注意：JS 合成的 WheelEvent 不会触发浏览器原生滚动，必须用 CDP 真实输入事件才能判定。
const readTop = `(() => {
  const html = document.documentElement, body = document.body;
  const page = document.querySelector('.select-page');
  return { html: html.scrollTop, body: body.scrollTop, page: page ? page.scrollTop : null };
})()`;

const before = await evaluate(readTop);

// 1) 键盘 PageDown —— 必须放在最前面：任何点击都会把焦点留在输入框/可聚焦卡片上，
//    之后的按键会被该元素消费，导致假阴性。
for (let i = 0; i < 2; i++) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34, nativeVirtualKeyCode: 34 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34, nativeVirtualKeyCode: 34 });
  await sleep(220);
}
await sleep(600);
const afterKey = await evaluate(readTop);

// 回到顶部，再做滚轮测试
await evaluate('document.scrollingElement.scrollTop = 0; void 0');
await sleep(300);
const beforeWheel = await evaluate(readTop);

// 2) 真实滚轮（CDP Input.dispatchMouseEvent）
for (let i = 0; i < 5; i++) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: Math.round(W / 2),
    y: Math.round(H / 2),
    deltaX: 0,
    deltaY: 300,
    pointerType: 'mouse',
  });
  await sleep(120);
}
await sleep(600);
const afterWheel = await evaluate(readTop);

const delta = (a, b) => ({ html: a.html - b.html, body: a.body - b.body, page: a.page - b.page });
const wheel = {
  before,
  afterKey,
  beforeWheel,
  afterWheel,
  deltaKey: delta(afterKey, before),
  deltaWheel: delta(afterWheel, beforeWheel),
};

fs.writeFileSync(
  `probe-${OUT}-${W}x${H}.json`,
  JSON.stringify({ viewport: [W, H], layout, fixLayout, wheel }, null, 2),
  'utf-8',
);

// 可选：注入临时 CSS（用于放大背景层等"诊断性观察"，不影响仓库代码）
const extraCss = arg('css', '');
if (extraCss) {
  await evaluate(`(() => {
    const s = document.createElement('style');
    s.id = 'rv-probe-css';
    s.textContent = ${JSON.stringify(extraCss)};
    document.head.appendChild(s);
    return true;
  })()`);
  await sleep(400);
}

// 截图前回到顶部：否则 position:sticky 的顶栏与主栏会在整页截图里停在"吸附位"上，
// 得到与实际观感不符的画面。同时只截视口区域，所见即用户首屏。
const scrollTo = Number(arg('scroll', '0'));
await evaluate(`document.scrollingElement.scrollTop = ${scrollTo}; void 0`);
await sleep(500);
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
if (shot.result?.data) {
  fs.writeFileSync(`probe-${OUT}-${W}x${H}.png`, Buffer.from(shot.result.data, 'base64'));
}

console.log(JSON.stringify({ viewport: [W, H], fixLayout, wheel }, null, 2));

ws.close();
try { child.kill(); } catch { /* */ }
process.exit(0);
