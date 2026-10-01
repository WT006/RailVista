/**
 * 自驾页面三断点实测探针：截图 + 关键断言。
 * 用法: node scripts/drive-probe.mjs <url> --w 390 --out name
 * 断言：无横向溢出、中文名单行（不折行）、关键卡片渲染。
 */
const url = process.argv[2] || 'http://localhost:5173/drive';
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const W = Number(arg('w', 390));
const H = Number(arg('h', 844));
const OUT = arg('out', 'drive');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const { spawn } = await import('node:child_process');
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-drive-'));
const port = 9444 + Math.floor(Math.random() * 300);
const child = spawn(
  EDGE,
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
   `--remote-debugging-port=${port}`, `--window-size=${W},${H}`, `--user-data-dir=${userDir}`, 'about:blank'],
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
    } catch { /* retry */ }
    await sleep(300);
  }
  throw new Error('CDP 未就绪');
}

const wsUrl = await getWs();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value;
}

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 800 });
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(4000);

const report = await evaluate(`(() => {
  const doc = document.documentElement;
  const overflowX = doc.scrollWidth > doc.clientWidth + 1;
  // 中文名单行检测：取所有 .drive-route-card__name / .drive-chapter__title / .drive-radar-card__name
  const singleLine = (el) => {
    if (!el) return { ok: true, h: 0 };
    const h = el.clientHeight;
    const lh = parseFloat(getComputedStyle(el).lineHeight || '20');
    return { ok: h <= lh * 1.5 + 1, h };
  };
  const names = [...document.querySelectorAll('.drive-route-card__name, .drive-chapter__title, .drive-radar-card__name, .drive-highlight__name, .drive-spot__name, .drive-board-card__title, .drive-board-item__name')]
    .map((el) => ({ text: el.textContent.trim().slice(0, 12), ...singleLine(el) }));
  const cards = document.querySelectorAll('.drive-route-card, .drive-chapter, .drive-highlight, .drive-radar-card, .drive-spot, .drive-board-card, .drive-board-item').length;
  return {
    url: location.href,
    viewport: [innerWidth, innerHeight],
    overflowX,
    scrollW: doc.scrollWidth, clientW: doc.clientWidth,
    cardCount: cards,
    roadKbd: document.querySelectorAll('.road-kbd__prefix, .road-kbd__digit').length,
    netmapRoads: document.querySelectorAll('.drive-netmap__road').length,
    navLinks: [...document.querySelectorAll('.appbar__nav a')].map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })),
    names: names.slice(0, 8),
    folded: names.filter((n) => !n.ok).map((n) => n.text),
    title: document.querySelector('h1')?.textContent?.trim().slice(0, 30) ?? null,
  };
})()`);

// 截图
const { fileURLToPath } = await import('node:url');
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../tmp/ui');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${OUT}-${W}.png`);
fs.writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));

console.log(JSON.stringify({ ...report, screenshot: outPath }, null, 2));
child.kill();
process.exit(0);
