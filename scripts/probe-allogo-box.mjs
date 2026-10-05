const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { spawn } = await import('node:child_process');

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-al-'));
const port = 9500 + Math.floor(Math.random() * 300);
const child = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, '--window-size=1440,900', 'about:blank'],
  { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page?.webSocketDebuggerUrl) { ws = page.webSocketDebuggerUrl; break; }
  } catch {}
  await sleep(300);
}
const WebSocket = globalThis.WebSocket;
const sock = new WebSocket(ws);
let seq = 0;
const pend = new Map();
sock.onmessage = (e) => {
  const d = JSON.parse(e.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
};
const send = (method, params) => new Promise((res) => { const id = ++seq; pend.set(id, res); sock.send(JSON.stringify({ id, method, params })); });
await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
await send('Page.enable', {});
await send('Page.navigate', { url: 'http://localhost:5173/ticket' });
await sleep(2500);

const expr = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const btn = [...document.querySelectorAll('.seg__btn')].find(b => b.textContent.includes('飞行'));
  if (btn) { btn.click(); await sleep(800); }
  const img = document.querySelector('.tk__allogo');
  if (!img) return JSON.stringify({ missing: true });
  const r = img.getBoundingClientRect();
  const cs = getComputedStyle(img);
  return JSON.stringify({
    rect: { w: Math.round(r.width), h: Math.round(r.height) },
    natural: { w: img.naturalWidth, h: img.naturalHeight },
    src: img.currentSrc.split('/').pop(),
    boxSizing: cs.boxSizing,
    height: cs.height, width: cs.width, minWidth: cs.minWidth, padding: cs.padding,
    alrowH: Math.round(document.querySelector('.tk__alrow').getBoundingClientRect().height),
    alrowKids: [...document.querySelector('.tk__alrow').children].map((c) => ({
      cls: String(c.className).slice(0, 30),
      w: Math.round(c.getBoundingClientRect().width),
      h: Math.round(c.getBoundingClientRect().height),
    })),
    imgComputed: { display: cs.display, flexShrink: cs.flexShrink },
  });
})()`;
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(r.result?.result?.value);
ws.close(); child.kill();
try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}