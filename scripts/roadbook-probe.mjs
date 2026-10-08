/**
 * 路书库页面实测探针（headless Edge + CDP）。
 *
 * 用法: node scripts/roadbook-probe.mjs <url> --w 1280 --h 900 --out roadbook
 *
 * 断言重点（吸取过往教训，判据必须全）：
 *   ① 无横向溢出（overflowX）——否则右侧内容被切
 *   ② 关键区块真的渲染出元素数 > 0（卡死在「正在加载」会被抓到）
 *   ③ 5 个 Tab 逐个点击后内容确实变化
 *   ④ 传输体积（memory 教训：聚合接口 >1MB 会让主线程卡死）
 *   ⑤ 顶栏导航含「旅行路书」入口
 */
const url = process.argv[2] || 'http://127.0.0.1:5199/roadbook';
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const W = Number(arg('w', 1280));
const H = Number(arg('h', 900));
const OUT = arg('out', 'roadbook');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const { spawn } = await import('node:child_process');
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-roadbook-'));
const port = 9444 + Math.floor(Math.random() * 300);
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
    return { __error: r.result.exceptionDetails.text ?? 'eval error' };
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
await send('Network.enable');
await send('Page.navigate', { url });
await sleep(4500);

const baseReport = await evaluate(`(() => {
  const doc = document.documentElement;
  const n = (s) => document.querySelectorAll(s).length;
  const txt = (s) => document.querySelector(s)?.textContent?.trim().slice(0, 60) ?? null;
  const transfers = performance.getEntriesByType('resource')
    .filter((e) => e.name.includes('/api/'))
    .map((e) => ({ name: e.name.split('/api/')[1].slice(0, 40), kb: Math.round((e.transferSize || e.decodedBodySize || 0) / 102.4) / 10 }));
  return {
    url: location.href,
    viewport: [innerWidth, innerHeight],
    overflowX: doc.scrollWidth > doc.clientWidth + 1,
    scrollW: doc.scrollWidth,
    clientW: doc.clientWidth,
    navLinks: [...document.querySelectorAll('.appbar__nav a')].map((a) => a.textContent.trim()),
    transfers,
    title: txt('h1'),
    loading: txt('.rb-empty'),
    error: txt('.rb-empty--error') || txt('.rd-state--error'),
  };
})()`);

/** 列表页：省份 chips / 城市联动 / 玩法 chips / 路线卡片 + 联动实测 */
const listReport = await evaluate(`(async () => {
  const doc = document;
  const q = (s, root = doc) => [...root.querySelectorAll(s)];
  const blocks = q('.rb-filter-block');
  if (!q('.rb-card').length) return null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 按标题找区块（内容分层区块插到玩法之前了，写死下标会读错）
  const blockOf = (title, fallback) =>
    blocks.find((b) => b.querySelector('.rb-filter-head')?.textContent.includes(title)) ?? fallback;

  const out = {
    provinceChips: q('.rb-chip', blockOf('省份', blocks[0])).length,
    layerChips: q('.rb-chip', blockOf('内容分层', blocks[1])).map((b) =>
      b.textContent.trim().replace(/\\s+/g, ''),
    ),
    modeChips: q('.rb-chip', blockOf('玩法', blocks[1])).map((b) => b.textContent.trim().replace(/\\s+/g, '')),
    cards: q('.rb-card').length,
    firstCard: {
      name: doc.querySelector('.rb-card h2')?.textContent?.trim() ?? null,
      metrics: q('.rb-metric', doc.querySelector('.rb-card')).map((e) => e.textContent.trim().replace(/\\s+/g, ' ')),
      modes: q('.rb-tag--mode', doc.querySelector('.rb-card')).map((e) => e.textContent.trim()),
      roads: q('.rb-road', doc.querySelector('.rb-card')).map((e) => e.textContent.trim()),
    },
    resultHead: doc.querySelector('.rb-result-head')?.textContent?.trim().replace(/\\s+/g, ' ') ?? null,
  };

  // 交互 1：点「新疆」省份 chip → 应出现该省城市 chips，且列表收敛
  const pChip = q('.rb-chip', blocks[0]).find((b) => b.textContent.trim().startsWith('新疆'));
  if (pChip) {
    pChip.click();
    await sleep(1400);
    out.afterProvince = {
      chipLabel: pChip.textContent.trim().replace(/\\s+/g, ' '),
      cityChips: q('.rb-chip.sm').length,
      citySelectable: q('.rb-chip.sm:not(.todo)').length,
      cards: q('.rb-card').length,
      names: q('.rb-card h2').map((h) => h.textContent.trim()),
      head: doc.querySelector('.rb-result-head')?.textContent?.trim().replace(/\\s+/g, ' ') ?? null,
    };
  }

  // 交互 2：玩法筛选「徒步」→ 列表应进一步收敛（或给出空态文案）
  const mChip = q('.rb-chip', blocks[1]).find((b) => b.textContent.trim() === '徒步');
  if (mChip) {
    mChip.click();
    await sleep(1400);
    out.afterMode = {
      cards: q('.rb-card').length,
      names: q('.rb-card h2').map((h) => h.textContent.trim()),
      head: doc.querySelector('.rb-result-head')?.textContent?.trim().replace(/\\s+/g, ' ') ?? null,
      empty: doc.querySelector('.rb-empty')?.textContent?.trim().slice(0, 60) ?? null,
    };
  }

  // 交互 3：重置 → 回到全量
  const reset = doc.querySelector('.rb-reset');
  if (reset) {
    reset.click();
    await sleep(1400);
    out.afterReset = {
      cards: q('.rb-card').length,
      cityChips: q('.rb-chip.sm').length,
    };
  }
  return out;
})()`);

/** 详情页：逐个 Tab 点击并抓取渲染结果 */
const tabReport = await evaluate(`(async () => {
  if (!document.querySelector('.rd-tab')) return null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  out.crumb = document.querySelector('.rd-crumb')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null;
  out.name = document.querySelector('.rd-hero h1')?.textContent?.trim() ?? null;
  out.metrics = [...document.querySelectorAll('.rd-metric')].map((e) => e.textContent.trim().replace(/\\s+/g, ' '));
  out.modes = [...document.querySelectorAll('.rd-tag--mode')].map((e) => e.textContent.trim());
  out.tabs = [...document.querySelectorAll('.rd-tab')].map((b) => b.textContent.trim());
  const tabs = [...document.querySelectorAll('.rd-tab')];
  out.panels = {};
  for (let i = 0; i < tabs.length; i++) {
    tabs[i].click();
    await sleep(220);
    const label = tabs[i].textContent.trim();
    const s = document.querySelector('.rd-section:not([style*="display: none"])');
    out.panels[label] = {
      segCount: document.querySelectorAll('.rd-seg').length,
      dayCount: document.querySelectorAll('.rd-day').length,
      spotCount: document.querySelectorAll('.rd-spot').length,
      pracRow: document.querySelectorAll('.rd-prac-row').length,
      pendingRef: document.querySelectorAll('.rd-class--pending').length,
      chars: document.querySelector('.rd-section')?.textContent?.trim().length ?? 0,
    };
  }
  return out;
})()`);

// 截图
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../tmp/ui');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${OUT}-${W}.png`);
fs.writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));

console.log(
  JSON.stringify(
    { ...baseReport, list: listReport, detail: tabReport, screenshot: outPath },
    null,
    2,
  ),
);
child.kill();
process.exit(0);
