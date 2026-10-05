/**
 * v0.6.5 公路详情页「分段高亮可见性」验收探针（headless Edge + CDP）。
 *
 * 用途：QA 复验 / 开发自检。**判据规范以本文件头注释为准**，不要另写一套。
 *
 * 用法：node scripts/verify-road-highlight.mjs
 * 覆盖：地名分段 / 精选景点 / 分段点击高亮 / 景点点击聚焦 / 覆盖率 / 类型角标 / 控制台报错
 * 断点：1440×900 与 390×844
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 【验收判据 — 不可退回旧标准】
 *
 * 「高亮 / 聚焦生效」**必须**用 `getBoundingClientRect()` 的**屏幕像素尺寸**证明。
 *
 *   ✔ 合格：选中段折线的屏幕包围盒 **短边 ≥ 24px**
 *   ✘ 不合格：短边 < 24px —— 等同于看不见
 *
 * 以下都**不是**合格证据（第三轮已实证其失效）：
 *   · SVG `d` 属性长度非零      → 上一轮据此判「点击修好了」，实测屏幕只有 1×7px
 *   · `.is-active` 类名存在      → 只证明 CSS 挂上了，不证明线画得出来
 *   · DOM 节点数 > 0            → 同上
 *   · 探针硬编码只点第 2 段      → 掩盖了「末段无点 → d=''」的 bug
 *
 * 因此本探针：
 *   1. 遍历**每一段**（不再只点第 2 段），逐段量屏幕包围盒；
 *   2. 报出最小值与不合格段号列表，无高亮段数必须为 0；
 *   3. 景点聚焦用 viewBox 数值 + 定位环屏幕尺寸双重证明。
 *
 * ── 探针自身的等待时间也是判据的一部分 ──
 * 逐段点击后必须等 Vue 完成响应式更新 + 浏览器重排 + 样式重算再去量矩形。
 * 等待**不足**会读到上一段或未渲染的状态，产生假阴性（本项目踩过两次：
 *   · 用 320ms 测出「第 1 段无高亮」—— 误报，第 1 段实际一直有高亮；
 *   · 用 240ms 虽然没出错，但偏紧，换台慢机器就可能翻车）。
 * 因此 `SEG_SETTLE_MS = 600` 是**判据的一部分**，不要为了跑快而调小 ——
 * 要快就减少测量项，不要缩短等待。
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** 高亮合格判据：屏幕包围盒短边下限（px） */
const HIGHLIGHT_MIN_PX = 24;
/** 逐段点击后的稳定等待（ms）。判据的一部分，见头注释「探针自身的等待时间也是判据的一部分」。 */
const SEG_SETTLE_MS = 600;

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const { spawn } = await import('node:child_process');
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, '..', 'tmp', 'ui');
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {{w:number,h:number,mobile:boolean}} vp */
async function withPage(vp, fn) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-v065-'));
  const port = 8700 + Math.floor(Math.random() * 200);
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, `--window-size=${vp.w},${vp.h}`,
    `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  let ws;
  try {
    let wsUrl = null;
    for (let i = 0; i < 60 && !wsUrl; i += 1) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/list`);
        const l = await r.json();
        const p = l.find((t) => t.type === 'page');
        if (p?.webSocketDebuggerUrl) wsUrl = p.webSocketDebuggerUrl;
      } catch { /* retry */ }
      if (!wsUrl) await sleep(300);
    }
    if (!wsUrl) throw new Error('CDP 连接失败');
    ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pend = new Map();
    const consoleErrors = [];
    const pageErrors = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
        consoleErrors.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        pageErrors.push(d.exception?.description ?? d.text);
      }
    };
    const send = (method, params = {}) => {
      const i = ++id;
      return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    };
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description ?? 'eval error' };
      return r.result?.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile,
    });

    return await fn({ evalJs, send, consoleErrors, pageErrors });
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    child.kill();
  }
}

/**
 * 注入页面的逐段测量函数。
 *
 * 分类口径（主理人裁决）：
 *   · 无高亮   —— d 为空 / rect 短边 0 / 节点不存在。**真缺陷**，必须为 0。
 *   · 不达标   —— 有高亮但短边 < HIGHLIGHT_MIN_PX。
 *   · 极短线   —— 该线路总长 < TINY_ROUTE_KM（主链实绘不足 1km）。
 *                按裁决**不硬凑 24px**（把 63 米的路放大到 24px 需 ~32000× 缩放比，
 *                地图失真到无意义）。这类独立统计，**与「无高亮」不是同一缺陷**，
 *                UI 侧已给替代反馈（分段行标里程 + 提示条「全线仅 X km」）。
 *   · 不达标中的极短线单列，避免把「产品观感取舍」误报成「点击失效」。
 *   · 溢出容器 —— **第七轮新增**（见下）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 【第四条断言：高亮 bbox 不得溢出 svg 容器】—— 由来：G3300 事件
 *
 * 前七轮的三条断言（无高亮 / 不达标 / 极短单列）都只检查「高亮自己有多大」，
 * **没有检查「高亮是否被画在可视区里」**。于是漏掉了这类缺陷：
 *   G3300（0.19km，超短路）点开后 SCALE_MAX=8000 把视区收到 0.1 viewBox 单位，
 *   而 `viewBoxAttr` 当时用 `toFixed(1)` 输出 —— 0.1 单位的视区配上 ±0.05 的
 *   舍入，**舍入误差等于视区的 50%**，视区上沿被推到折线顶边之外，
 *   折线顶部被裁掉。实测：折线 rect top=296.98 < svg rect top=319.59，
 *   **溢出 22.61px**，屏幕上表现为「线被切掉一截」。
 *
 * 这类缺陷在长线路上永远不会出现（几百单位的视区，0.1 舍入占比 <0.1%），
 * 只在「放大路径」上暴露，因此前三条款判据对它完全失明 ——
 * 当时是靠 QA 人工看截图发现的。**为了让将来所有走放大路径的线路都被自动覆盖，
 * 这里补第四条断言：折线的 getBoundingClientRect() 必须完全落在
 * `.drive-trip-map__svg` 的 rect 内（容差 CLIP_TOLERANCE_PX）。**
 *
 * 判据与前三条独立：即便高亮短边达标（如 G3300 的 133×174px），
 * 只要溢出容器，一样判失败。
 */
const TINY_ROUTE_KM = 1;

/** 高亮 bbox 允许超出 svg 容器的容差（px）—— 覆盖 subpixel 抗锯齿与 transform 舍入 */
const CLIP_TOLERANCE_PX = 1;


const MEASURE_ALL_SEGMENTS = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const TINY = ${TINY_ROUTE_KM};
  // 线路总长：取「收录里程」文案里的 km 值，解析不出则按 999 视为非极短
  const coverEl = document.querySelector('.drive-seg__cover');
  const m = coverEl && coverEl.textContent.match(/分段覆盖 0—([\\d.]+)\\s*km/);
  let totalKm = m ? parseFloat(m[1]) : NaN;
  // 第八轮（P2）**totalKm 取值修正**：原实现只认 .drive-seg__cover 的
  // 「分段覆盖 0—X km」，而极短线路该文案是「0—0 km」（分段覆盖到 0km 处），
  // 解析出 0 → isTiny 判定的 totalKm > 0 失败 → **极短线路被漏出「极短线」单列**，
  // 输出「极短线段号: []」这个**假空**。假空比不输出更危险：它会让人以为
  // 该分类没有实例，从而跳过对极短线的核查。
  //
  // 修正：优先从**分段行**的「全线 X km」取实测主链里程（极短线路时
  // .drive-seg__range 显示 segmentRangeNote = 「全线 0.2 km」，与 UI 的
  // tinyRouteKmText 同源即 chainMaxKm），解析不到再回退 cover 文案；
  // 两者都拿不到时记为 NaN 而**不是 0**，让 isTiny 判定显式失败而非静默通过。
  // （不能用 .drive-trip-map__scope：那是点击后才出现的提示条，测量循环开始时尚不存在。）
  const segsRange0 = document.querySelector('.drive-seg__range');
  const rangeM = segsRange0 && segsRange0.textContent.match(/全线\\s*([\\d.]+)\\s*km/);
  if (rangeM) totalKm = parseFloat(rangeM[1]);
  else if (coverEl) {
    // 极短路：cover 的覆盖里程为 0，改用「占已收录里程 X%」反推不可靠，
    // 直接把 0 视为「无法判定」，交给下面的 NaN 分支
    if (!(totalKm > 0)) totalKm = NaN;
  }
  const isTiny = Number.isFinite(totalKm) && totalKm > 0 && totalKm < TINY;
  const segs = [...document.querySelectorAll('.drive-seg')];
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const on = document.querySelector('.drive-seg.is-on');
    if (on) { on.click(); await sleep(${SEG_SETTLE_MS}); }
    segs[i].click();
    await sleep(${SEG_SETTLE_MS});
    const p = document.querySelector('.drive-trip-map__route.is-active');
    const t = segs[i].querySelector('.drive-seg__title');
    const rec = { i: i + 1, title: t ? t.textContent.replace(/\\s+/g,' ').trim() : '', exists: !!p, dLen: 0, w: 0, h: 0, short: 0, ok: false, isTiny, overflow: 0, clipped: false, vb: '' };
    if (p) {
      rec.dLen = (p.getAttribute('d') || '').length;
      rec.vb = (document.querySelector('.drive-trip-map__svg')?.getAttribute('viewBox') ?? '');
      const b = p.getBoundingClientRect();
      rec.w = Math.round(b.width * 10) / 10;
      rec.h = Math.round(b.height * 10) / 10;
      rec.short = Math.round(Math.min(b.width, b.height) * 10) / 10;
      rec.ok = rec.short >= ${HIGHLIGHT_MIN_PX};
      // 第四条断言：折线 bbox 必须完全落在 svg 容器 rect 内（容差 CLIP_TOLERANCE_PX）。
      // 与「短边多大」无关 —— 一条 133×174px 的线若被裁掉一截，照样是缺陷。
      const svg = document.querySelector('.drive-trip-map__svg');
      if (svg) {
        const s = svg.getBoundingClientRect();
        const over = Math.max(s.left - b.left, s.top - b.top, b.right - s.right, b.bottom - s.bottom);
        rec.overflow = Math.round(over * 100) / 100;
        rec.clipped = over > ${CLIP_TOLERANCE_PX};
      }
    }
    // d 为空 或 rect 短边为 0，一律算「无高亮」——不能只靠 exists 判存在性。
    if (rec.dLen === 0 || rec.short === 0) { rec.exists = false; rec.ok = false; rec.reason = rec.dLen === 0 ? 'd 为空' : 'rect 短边 0'; }
    out.push(rec);
  }
  const still = document.querySelector('.drive-seg.is-on');
  if (still) { still.click(); await sleep(200); }
  return JSON.stringify({ totalKm, isTiny, segs: out });
})()`;

/** @param {{evalJs:Function, send:Function, consoleErrors:string[], pageErrors:string[]}} ctx */
async function probeRoad(ctx, roadKey, label) {
  const { evalJs, send, consoleErrors, pageErrors } = ctx;
  await send('Page.navigate', { url: `http://localhost:5173/drive/road/${roadKey}` });
  await sleep(5200);

  const out = {};
  out.分段数 = await evalJs("document.querySelectorAll('.drive-seg').length");
  out.前5段段名 = await evalJs(
    "JSON.stringify([...document.querySelectorAll('.drive-seg')].slice(0,5).map(b=>{const t=b.querySelector('.drive-seg__title');const r=b.querySelector('.drive-seg__range');return (t?t.textContent.replace(/\\s+/g,' ').trim():'?')+' | '+(r?r.textContent.replace(/\\s+/g,' ').trim():'?');}))",
  );
  out.分段是地名 = await evalJs(
    "(()=>{const ts=[...document.querySelectorAll('.drive-seg__title')].map(e=>e.textContent.trim());return ts.length? (ts.filter(t=>!/^第\\s*\\d+\\s*段/.test(t)).length+'/'+ts.length+' 为地名'):'n/a';})()",
  );
  out.分段说明 = await evalJs("document.querySelector('.drive-chapters .drive-seg__hint')?.textContent?.replace(/\\s+/g,' ').trim() ?? '（无）'");
  out.覆盖率文案 = await evalJs("document.querySelector('.drive-seg__cover')?.textContent?.replace(/\\s+/g,' ').trim() ?? '（无）'");
  out.角标分布 = await evalJs(
    "JSON.stringify((()=>{const c={};for(const e of document.querySelectorAll('.drive-anchor-src')){const k=e.textContent.trim();c[k]=(c[k]||0)+1;}return c;})())",
  );
  out.精选里有纯英文名 = await evalJs(
    "JSON.stringify([...document.querySelectorAll('.drive-featured__name')].map(e=>e.textContent.replace(/未译名/, '').trim()).filter(n=>!/[一-鿿]/.test(n)))",
  );
  out.普通列表外文名弱化行数 = await evalJs("document.querySelectorAll('.drive-road-spot.is-latin').length");
  out.选中前_地图viewBox = await evalJs("document.querySelector('.drive-trip-map__svg')?.getAttribute('viewBox') ?? ''");

  out.尺寸 = await evalJs(
    "(()=>{const g=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)};};return JSON.stringify({map:g('.drive-trip-map'),side:g('.drive-road-side'),chapters:g('.drive-chapters'),featured:g('.drive-featured'),viewport:{w:innerWidth,h:innerHeight},scrollW:document.documentElement.scrollWidth});})()",
  );

  // ── 逐段量高亮（判据：短边 ≥ 24px；极短线单独归类）──
  const raw = await evalJs(MEASURE_ALL_SEGMENTS);
  let payload = { totalKm: 0, isTiny: false, segs: [] };
  if (typeof raw === 'string') { try { payload = JSON.parse(raw); } catch { /* ignore */ } }
  const segs = Array.isArray(payload) ? payload : payload.segs;
  const isTiny = !!payload.isTiny;
  const missing = segs.filter((s) => !s.exists);
  const under = segs.filter((s) => s.exists && !s.ok);
  // 极短线：从「不达标」里单列，不与真缺陷混算
  const tinyUnder = under.filter((s) => s.isTiny);
  const realUnder = under.filter((s) => !s.isTiny);
  const shorts = segs.filter((s) => s.exists).map((s) => s.short);
  // 注意：不要写成 Math.min(...shorts, 0) —— 那个字面量 0 会被当成候选值，
  // 无论真实数据如何都会输出「最短 0px」，与「无高亮 0 段」自相矛盾（第三轮踩过）。
  const kmLabel = Number.isFinite(payload.totalKm) ? `${payload.totalKm} km` : 'NaN（未能从页面判定，见下方说明）';
  out.线路总长 = `${kmLabel}${isTiny ? '（极短线路 <1km，按裁决不硬凑 24px）' : ''}`;
  out.逐段高亮 = segs.length
    ? `共 ${segs.length} 段：无高亮 ${missing.length} 段，不达标 ${realUnder.length} 段` +
      (tinyUnder.length ? `，极短线不达标 ${tinyUnder.length} 段` : '') +
      (shorts.length ? `，最短 ${Math.min(...shorts)}px，最长 ${Math.max(...shorts)}px` : '（无任何有效高亮）')
    : '（未取到数据）';
  out.不合格段号 = JSON.stringify([
    ...missing.map((s) => `${s.i}(${s.reason || '无高亮'})`),
    ...realUnder.map((s) => `${s.i}(${s.short}px)`),
  ]);
  // 第四条断言：溢出容器的段（独立于像素判据 —— 短边达标也可能被裁）
  const clipped = segs.filter((s) => s.exists && s.clipped);
  out.溢出容器段 = clipped.length
    ? `${clipped.length} 段 —— ${clipped.map((s) => `${s.i}(溢出${s.overflow}px)`).join(', ')}`
    : '0 段 ✔';
  out.最大溢出量 = segs.filter((s) => s.exists).reduce((m, s) => Math.max(m, s.overflow), 0) + 'px';
  out.极短线段号 = tinyUnder.length ? JSON.stringify(tinyUnder.map((s) => `${s.i}(${s.short}px)`)) : '[]';
  const wanted = roadKey === 'G318' ? [1, 6, 11, 22] : [1, 5, 11];
  out.点名段像素 = JSON.stringify(segs.filter((s) => wanted.includes(s.i)).map((s) => ({
    段: s.i, 名: s.title.slice(0, 20), 宽: s.w, 高: s.h, 短边: s.short, 合格: s.ok,
    viewBox: s.vb ?? '', 溢出: s.overflow,
  })));

  // ── P1-1：点景点 → 点分段 → 再取消分段 → 必须回到全局 viewBox ──
  //
  // 注意判据演进：P0-2 要求「选中分段时收拢 viewBox 到该段」，因此
  // 「点分段后 viewBox == 全局」在设计上就不成立（那是段视图，不是残留的景点视图）。
  // P1-1 要查的真 bug 是「**上一轮的点景点视角残留**」，所以判据是：
  //   点景点 → 点分段（应变段视图）→ 取消分段（应变全局 viewBox，且与点击前逐值相等）
  const globalVB = out.选中前_地图viewBox;
  await evalJs("(()=>{const b=document.querySelector('.drive-featured__card'); if(b) b.click(); return 1;})()");
  await sleep(700);
  const afterSpot = await evalJs("document.querySelector('.drive-trip-map__svg')?.getAttribute('viewBox') ?? ''");
  await evalJs("(()=>{const b=document.querySelectorAll('.drive-seg')[1]; if(b) b.click(); return 1;})()");
  await sleep(700);
  const afterSeg = await evalJs("document.querySelector('.drive-trip-map__svg')?.getAttribute('viewBox') ?? ''");
  // 取消分段（再点一次同一段）
  await evalJs("(()=>{const b=document.querySelector('.drive-seg.is-on'); if(b) b.click(); return 1;})()");
  await sleep(700);
  const afterDeselect = await evalJs("document.querySelector('.drive-trip-map__svg')?.getAttribute('viewBox') ?? ''");
  out.P1_1_点景点后viewBox = afterSpot;
  out.P1_1_再点分段后viewBox = afterSeg;
  out.P1_1_取消分段后viewBox = afterDeselect;
  out.P1_1_无景点视角残留 = afterSeg !== afterSpot
    ? `是（点分段后已切为段视图 ${afterSeg}，不再是景点视图 ${afterSpot}）`
    : `否！点分段后仍是景点视角 ${afterSpot}`;
  out.P1_1_取消后回全局 = afterDeselect === globalVB
    ? `是（与全局逐值相等：${globalVB}）`
    : `否！期望 ${globalVB} 实得 ${afterDeselect}`;
  await sleep(300);

  // ── 景点聚焦：viewBox + 定位环屏幕尺寸 ──
  await evalJs("(()=>{const b=document.querySelector('.drive-featured__card'); if(b) b.click(); return 1;})()");
  await sleep(900);
  out.点击精选1_定位环 = await evalJs(
    "(()=>{const g=document.querySelector('.drive-trip-map__focus');if(!g)return 'no-focus-group';const ring=document.querySelector('.drive-trip-map__focus-ring');const pulse=document.querySelector('.drive-trip-map__focus-pulse');const cs=pulse?getComputedStyle(pulse):null;const b=ring.getBoundingClientRect();return JSON.stringify({ring:!!ring,pulse:!!pulse,pulseAnim:cs?cs.animationName:'none',ringScreenPx:Math.round(b.width)});})()",
  );
  out.点击精选1_viewBox = await evalJs("document.querySelector('.drive-trip-map__svg')?.getAttribute('viewBox') ?? ''");
  out.点击精选1_定位环可见 = await evalJs(
    "(()=>{const r=document.querySelector('.drive-trip-map__focus-ring');if(!r)return 'no-ring';const b=r.getBoundingClientRect();const svg=document.querySelector('.drive-trip-map__svg').getBoundingClientRect();return JSON.stringify({w:Math.round(b.width),inView:b.width>4&&b.right>svg.left&&b.left<svg.right&&b.bottom>svg.top&&b.top<svg.bottom});})()",
  );
  await evalJs("(()=>{const b=document.querySelector('.drive-featured__card.is-on'); if(b) b.click(); return 1;})()");
  await sleep(600);
  out.再点一次_定位环消失 = await evalJs("!document.querySelector('.drive-trip-map__focus')");
  out.再点一次_viewBox复原 = await evalJs("document.querySelector('.drive-trip-map__svg')?.getAttribute('viewBox') ?? ''");

  out.控制台错误 = consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 8), null, 1) : '0 条';
  out.未捕获异常 = pageErrors.length ? JSON.stringify(pageErrors.slice(0, 5), null, 1) : '0 条';

  // 截图：停在「选中一个分段」状态，最能体现高亮可见性
  await evalJs("(()=>{const b=document.querySelectorAll('.drive-seg')[5] || document.querySelector('.drive-seg'); if(b) b.click(); return 1;})()");
  await sleep(900);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, `v065-road-${roadKey}-${label}.png`), Buffer.from(shot.result.data, 'base64'));
  console.log(`  截图: tmp/ui/v065-road-${roadKey}-${label}.png`);

  return out;
}

/**
 * 受测线路。
 *
 * 第七轮起加入 **G3300**：第四条断言（高亮 bbox 不得溢出 svg 容器）就是为它而加，
 * 若不纳入常规跑测，这条断言等于白写。G3300 是 0.19km 的超短路，
 * 走 SCALE_MAX=8000 的放大路径 —— 这正是前三条断言的盲区。
 */
const ROADS = (process.env.QA_ROADS || 'G217,G318,G3300').split(',');

console.log(`高亮判据：屏幕包围盒短边 ≥ ${HIGHLIGHT_MIN_PX}px（d 长度 / 类名 / DOM 数量均不作为证据）\n`);
console.log('════ 断点 1440×900 ════');
for (const k of ROADS) {
  console.log(`\n──── /drive/road/${k} @1440×900 ────`);
  const res = await withPage({ w: 1440, h: 900, mobile: false }, (ctx) => probeRoad(ctx, k, '1440'));
  for (const [k2, val] of Object.entries(res)) {
    console.log(`  ${k2}: ${typeof val === 'string' ? val : JSON.stringify(val)}`);
  }
}

console.log('\n\n════ 断点 390×844 ════');
for (const k of ROADS) {
  console.log(`\n──── /drive/road/${k} @390×844 ────`);
  const res = await withPage({ w: 390, h: 844, mobile: true }, (ctx) => probeRoad(ctx, k, '390'));
  for (const [k2, val] of Object.entries(res)) {
    console.log(`  ${k2}: ${typeof val === 'string' ? val : JSON.stringify(val)}`);
  }
}

process.exit(0);
