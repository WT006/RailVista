/**
 * 纪念票票面排版实测探针
 *
 * 用途：验收「票面是否被内容挤扁」。这类问题 vue-tsc 查不出来 —— 类型对了不代表版面对了，
 * 只能量真实渲染盒子。判据写在 assert 里。
 *
 * 基准来自原型 万里路书-纪念票模板原型.html：
 *   .ticket      width 400px / min-height 640px  → 宽高比0.625
 *   .t-flight    width 430px / min-height 620px  → 宽高比 0.694
 *   移动端(max-width:460px) 才 width:100%
 *
 * 用法: node scripts/ticket-layout-probe.mjs [--w 1440] [--h 900] [--shot name]
 */
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const W = Number(arg('w', 1440));
const H = Number(arg('h', 900));
const SHOT = arg('shot', '');

const URL_ = 'http://localhost:5173/ticket';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const { spawn } = await import('node:child_process');
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-tk-'));
const port = 9500 + Math.floor(Math.random() * 300);
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

const ws = new WebSocket(await getWs());
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let msgId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
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

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: W,
  height: H,
  deviceScaleFactor: 1,
  mobile: W < 500,
});
await send('Page.navigate', { url: URL_ });
// 充分等待：Vite 首屏 + 字体 + 票面渲染（探针等待时间本身也是判据的一部分）
await sleep(4500);

const KINDS = ['铁路纪念票', '自驾纪念票', '飞行纪念票'];
const report = { viewport: `${W}x${H}`, faceFound: false, kinds: [] };

for (const label of KINDS) {
  const expr = `
    (async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const btn = [...document.querySelectorAll('.seg__btn')].find(b => b.textContent.includes(${JSON.stringify(
        label.slice(0, 2),
      )}));
      if (btn) { btn.click(); await sleep(700); }
      const face = document.querySelector('.tk');
      if (!face) return JSON.stringify({ missing: true, buttons: [...document.querySelectorAll('.seg__btn')].map(b=>b.textContent.trim()) });
      const r = face.getBoundingClientRect();
      const inner = face.querySelector('.tk__inner');
      const kids = inner ? [...inner.children].map(c => ({
        cls: String(c.className).slice(0, 34),
        h: Math.round(c.getBoundingClientRect().height),
      })) : [];
      return JSON.stringify({
        w: Math.round(r.width),
        h: Math.round(r.height),
        ratio: +(r.width / r.height).toFixed(3),
        overflowY: face.scrollHeight - face.clientHeight,
        // 横向溢出：只测纵向会漏掉「右侧内容被切掉」这类问题
        // （实测移动端曾出现 BOARDING PAS/CZ3467/LXA 右半缺失但 overflowY=0）
        overflowX: face.scrollWidth - face.clientWidth,
        innerOverflow: inner ? inner.scrollHeight - inner.clientHeight : 0,
        innerOverflowX: inner ? inner.scrollWidth - inner.clientWidth : 0,
        // 最宽子元素是否超出票面右边界
        widestOver: inner
          ? Math.round(
              Math.max(
                0,
                ...[...inner.children].map(
                  (c) => c.getBoundingClientRect().right - r.right,
                ),
              ),
            )
          : 0,
        contentH: inner ? inner.scrollHeight : 0,
        childCount: kids.length,
        children: kids,
      });
    })()
  `;
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  const v = r.result?.result?.value;
  report.kinds.push({ label, ...(v ? JSON.parse(v) : { error: true }) });
  if (label === KINDS[0]) report.faceFound = !!v && !JSON.parse(v).missing;
}

if (SHOT) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (s.result?.data) {
    fs.mkdirSync('tmp', { recursive: true });
    const p = `tmp/${SHOT}.png`;
    fs.writeFileSync(p, Buffer.from(s.result.data, 'base64'));
    console.log('截图:', p);
  }
}

console.log(JSON.stringify(report, null, 2));
ws.close();
child.kill();
try {
  fs.rmSync(userDir, { recursive: true, force: true });
} catch {
  /* 清理失败不阻塞 */
}
