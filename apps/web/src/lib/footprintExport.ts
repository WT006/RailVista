/**
 * 足迹地图导出：纪念图片（PNG）与点亮动画视频（WebM）
 *
 * 两条路径共用地图组件暴露的 buildFrameSvg()：把「某一帧的点亮状态 + 机位」
 * 序列化成一段独立 SVG，再栅格化进 Canvas。这样导出所见即所得，不必维护第二套
 * 「导出专用配色」——色值只有一份（见 data/footprintPalette.ts）。
 *
 * 视频为什么逐帧重画而不是直接录屏：
 *  地图的立体感来自容器的 CSS perspective，那是「容器级」变换，
 *  canvas.captureStream 只能录到 canvas 自己画的内容，录不到 DOM。
 *  所以这里把机位烘焙成 SVG 内部变换，逐帧合成到 canvas 上再编码。
 *
 * 视频为什么按「省」而不是按「帧」换图：
 *  每换一次点亮状态就要重新栅格化一次 600KB 的 SVG（约 40–80ms），
 *  逐帧重画必然掉帧。相机推进改用 canvas 缩放实现（位图复用），
 *  只有点亮集合真的变了才重画地图，一帧一次 drawImage 就够了。
 */
import {
  FOOTPRINT_CITIES,
  FOOTPRINT_PROVINCES,
  FOOTPRINT_VIEWBOX,
} from '../data/chinaFootprintGeom';
import { EXPORT_BG, EXPORT_GOLD_TEXT } from '../data/footprintPalette';
import type { FootprintFrameState } from '../components/ticket/FootprintMap3D.vue';

/** 地图组件暴露的最小能力，避免这里依赖组件实例类型 */
export interface FootprintFrameRenderer {
  buildFrameSvg(
    state: FootprintFrameState,
    out: { w: number; h: number },
    fit?: { w: number; h: number },
  ): string;
}

const DEG = Math.PI / 180;
const FONT_STACK =
  "'HarmonyOS Sans SC','PingFang SC','Microsoft YaHei','Noto Sans SC',system-ui,sans-serif";

/** 城市名 → 所属省份 adcode */
const PROVINCE_ADCODE_OF_CITY = new Map<number, number>();
{
  const provOfName = new Map(FOOTPRINT_PROVINCES.map((p) => [p.name, p.adcode]));
  for (const c of FOOTPRINT_CITIES) {
    const adcode = provOfName.get(c.province);
    if (adcode !== undefined) PROVINCE_ADCODE_OF_CITY.set(c.adcode, adcode);
  }
}
/** 每省城市总数，用于把「点亮了几座」换算成覆层比例 */
const CITY_TOTAL_BY_PROVINCE = new Map<string, number>();
for (const c of FOOTPRINT_CITIES) {
  CITY_TOTAL_BY_PROVINCE.set(c.province, (CITY_TOTAL_BY_PROVINCE.get(c.province) ?? 0) + 1);
}
const CITY_BY_NAME = new Map(FOOTPRINT_CITIES.map((c) => [c.name, c]));

/**
 * 机位下地图的视觉包围盒（viewBox 用户单位）。
 *
 * buildFrameSvg 把 rotateX 烘焙成 scale(1, cos rx)，所以取景框不能直接拿
 * viewBox 的 1000×871 —— 旋转后再纵向压缩，包围盒会变样，按原尺寸取景会把
 * 东北和海南切掉。
 */
function warpedFit(rx: number, rz: number, margin = 1.06) {
  const w = FOOTPRINT_VIEWBOX.w;
  const h = FOOTPRINT_VIEWBOX.h;
  const a = Math.abs(Math.cos(rz * DEG));
  const b = Math.abs(Math.sin(rz * DEG));
  const rw = w * a + h * b;
  const rh = (w * b + h * a) * Math.max(0.18, Math.cos(rx * DEG));
  return { w: rw * margin, h: rh * margin };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('地图栅格化失败'));
    img.src = src;
  });
}

async function rasterize(
  map: FootprintFrameRenderer,
  state: FootprintFrameState,
  out: { w: number; h: number },
  fit: { w: number; h: number },
): Promise<HTMLImageElement> {
  const xml = map.buildFrameSvg(state, out, fit);
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`);
}

/** 画布底：夜色 + 一束顶光，让板块从亮处浮出、向四周沉下去 */
function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = EXPORT_BG;
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w * 0.5, h * 0.34, 0, w * 0.5, h * 0.34, w * 0.78);
  g.addColorStop(0, 'rgba(38, 54, 76, 0.55)');
  g.addColorStop(0.5, 'rgba(20, 29, 42, 0.34)');
  g.addColorStop(1, 'rgba(8, 11, 18, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

interface StampOptions {
  /** 主标题字号 */
  titleSize: number;
  /** 正文字号 */
  bodySize: number;
  /** 文字块左上角 */
  x: number;
  y: number;
  cities: number;
  provinces: number;
  totalCities: number;
  totalProvinces: number;
  date: string;
  /** 入场进度 0..1，用于淡入 */
  alpha: number;
  align?: 'left' | 'center';
}

/**
 * 标题 / 数据 / 落款。
 * 数字用 tabular-nums 思路：等宽数字位，跳动时不会左右抖。
 */
function paintStamp(ctx: CanvasRenderingContext2D, o: StampOptions) {
  const align = o.align ?? 'left';
  ctx.save();
  ctx.globalAlpha *= o.alpha;
  ctx.textAlign = align === 'center' ? 'center' : 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = 'rgba(163, 174, 189, 0.72)';
  ctx.font = `500 ${Math.round(o.bodySize * 0.62)}px ${FONT_STACK}`;
  ctx.letterSpacing = `${(o.bodySize * 0.62 * 0.32).toFixed(1)}px`;
  ctx.fillText('RAILVISTA · 万里路书', o.x, o.y);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = '#f2f5f9';
  ctx.font = `700 ${o.titleSize}px ${FONT_STACK}`;
  ctx.fillText('我的中国足迹', o.x, o.y + o.titleSize * 1.02);

  const ruleY = o.y + o.titleSize * 1.5;
  ctx.strokeStyle = 'rgba(212, 168, 83, 0.55)';
  ctx.lineWidth = Math.max(1, o.bodySize * 0.05);
  ctx.beginPath();
  ctx.moveTo(o.x, ruleY);
  ctx.lineTo(o.x + o.bodySize * 5.2, ruleY);
  ctx.stroke();

  ctx.fillStyle = EXPORT_GOLD_TEXT;
  ctx.font = `600 ${o.bodySize}px ${FONT_STACK}`;
  ctx.fillText(
    `已点亮 ${o.cities} 座城市 · 走过 ${o.provinces} 个省级行政区`,
    o.x,
    ruleY + o.bodySize * 1.5,
  );

  ctx.fillStyle = 'rgba(109, 120, 137, 0.9)';
  ctx.font = `400 ${Math.round(o.bodySize * 0.68)}px ${FONT_STACK}`;
  ctx.fillText(
    `${o.date} · 覆盖全国 ${Math.round((o.provinces / o.totalProvinces) * 100)}% 省级行政区`,
    o.x,
    ruleY + o.bodySize * 2.6,
  );
  ctx.restore();
}

// ── 纪念图片 ──────────────────────────────────────────────────────────────
export interface PngOptions {
  map: FootprintFrameRenderer;
  litCities: string[];
  litProvinces: string[];
  mode: 'city' | 'province';
  view: { rx: number; rz: number; zoom: number };
}

/** 3:4 竖版纪念图，比例对齐小红书 / 朋友圈的分享习惯 */
const PNG_W = 1080;
const PNG_H = 1440;

/** 每省最终覆层比例 */
export function finalRatios(
  litCities: string[],
  litProvinces: string[],
  mode: 'city' | 'province',
): Record<number, number> {
  const ratios: Record<number, number> = {};
  if (mode === 'province') {
    for (const p of FOOTPRINT_PROVINCES) {
      if (litProvinces.includes(p.name)) ratios[p.adcode] = 1;
    }
    return ratios;
  }
  const lit = new Set(litCities);
  for (const p of FOOTPRINT_PROVINCES) {
    const total = CITY_TOTAL_BY_PROVINCE.get(p.name) ?? 0;
    if (!total) continue;
    let n = 0;
    for (const name of lit) {
      if (CITY_BY_NAME.get(name)?.province === p.name) n++;
    }
    if (n) ratios[p.adcode] = Math.min(1, n / total);
  }
  return ratios;
}

function touchedCount(litCities: string[]): number {
  const set = new Set<string>();
  for (const name of litCities) {
    const c = CITY_BY_NAME.get(name);
    if (c) set.add(c.province);
  }
  return set.size;
}

export async function exportFootprintPng(opts: PngOptions): Promise<void> {
  const { map, litCities, litProvinces, mode, view } = opts;
  const ratios = finalRatios(litCities, litProvinces, mode);
  const cities = litCities
    .map((n) => CITY_BY_NAME.get(n))
    .filter((c): c is (typeof FOOTPRINT_CITIES)[number] => !!c)
    .map((c) => c.adcode);

  const mapH = Math.round(PNG_H * 0.6);
  const img = await rasterize(
    map,
    { ratios, cities, camera: view },
    { w: PNG_W, h: mapH },
    warpedFit(view.rx, view.rz, 1.1),
  );

  const canvas = document.createElement('canvas');
  canvas.width = PNG_W;
  canvas.height = PNG_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持图片导出');

  paintBackdrop(ctx, PNG_W, PNG_H);
  ctx.drawImage(img, 0, Math.round(mapH * 0.04));

  const provinces = mode === 'province' ? litProvinces.length : touchedCount(litCities);
  paintStamp(ctx, {
    x: Math.round(PNG_W * 0.09),
    y: Math.round(PNG_H * 0.66),
    titleSize: 74,
    bodySize: 30,
    cities: litCities.length,
    provinces,
    totalCities: FOOTPRINT_CITIES.length,
    totalProvinces: FOOTPRINT_PROVINCES.length,
    date: new Date().toLocaleDateString('zh-CN'),
    alpha: 1,
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (!blob) throw new Error('图片生成失败');
  download(blob, `我的中国足迹_${localDate()}.png`);
}

/** 本地日期（YYYY-MM-DD）。别用 toISOString：UTC 会把晚上 8 点后的记录写成前一天 */
function localDate() {
  const d = new Date();
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── 点亮动画视频 ──────────────────────────────────────────────────────────
export type VideoAspect = '16:9' | '9:16';

const VIDEO_SIZES: Record<VideoAspect, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
};
const FPS = 30;
/** 片头（秒）：夜色里浮出空白大地 + 标题 */
const T_INTRO = 1.2;
/** 片尾（秒）：数据定格、落款 */
const T_OUTRO = 2.0;
/** 一次点亮从 0 到最终值的补间时长（秒） */
const T_BLOOM = 0.55;

/** 一幕：一个省份从暗到金，同省的城市一起出现 */
export interface FootprintAct {
  adcode: number;
  name: string;
  /** 该省最终覆层比例 */
  ratio: number;
  /** 本幕出现的城市 adcode */
  cities: number[];
}

/**
 * 把点亮记录排成「演出脚本」。
 *
 * 按省分幕、由西向东铺开：一是画面像「一路走过去」而不是随机闪点，
 * 二是把需要重画地图的次数从城市数压到省数——每幕有 0.2s 预算，
 * 足够栅格化一次 600KB 的 SVG。现场回放与视频导出共用这份脚本，
 * 保证「预览看到的就是导出的样子」。
 */
export function buildActs(
  cityOrder: string[],
  litProvinces: string[],
  mode: 'city' | 'province',
): FootprintAct[] {
  const finalMap = finalRatios(cityOrder, litProvinces, mode);
  if (mode === 'province') {
    return FOOTPRINT_PROVINCES.filter((p) => litProvinces.includes(p.name)).map((p) => ({
      adcode: p.adcode,
      name: p.name,
      ratio: 1,
      cities: [],
    }));
  }
  const byProv = new Map<number, { cities: number[]; total: number; name: string }>();
  for (const name of cityOrder) {
    const c = CITY_BY_NAME.get(name);
    if (!c) continue;
    const adcode = PROVINCE_ADCODE_OF_CITY.get(c.adcode);
    if (adcode === undefined) continue;
    const g = byProv.get(adcode);
    if (g) g.cities.push(c.adcode);
    else
      byProv.set(adcode, {
        cities: [c.adcode],
        total: CITY_TOTAL_BY_PROVINCE.get(c.province) ?? 1,
        name: c.province,
      });
  }
  const acts = Array.from(byProv.entries()).map(
    ([adcode, g]): FootprintAct => ({
      adcode,
      name: g.name,
      ratio: finalMap[adcode] ?? g.cities.length / g.total,
      cities: g.cities,
    }),
  );
  const cxOf = new Map(FOOTPRINT_PROVINCES.map((p) => [p.adcode, p.cx]));
  return acts.sort((a, b) => (cxOf.get(a.adcode) ?? 0) - (cxOf.get(b.adcode) ?? 0));
}

export interface VideoOptions {
  map: FootprintFrameRenderer;
  /** 按点亮先后排列的城市名 */
  cityOrder: string[];
  litProvinces: string[];
  mode: 'city' | 'province';
  /** 默认机位；视频全程只在此基础上做推拉，不改俯仰 */
  view: { rx: number; rz: number; zoom: number };
  aspect: VideoAspect;
  onProgress?: (p: number, label: string) => void;
  signal?: { aborted: boolean };
}

export interface VideoResult {
  url: string;
  ext: string;
  durationMs: number;
}

/** MediaRecorder 编码能力协商：优先 vp9，退回 vp8 / 默认 webm / mp4 */
function pickMime(): { mime: string; ext: string } {
  const list: Array<[string, string]> = [
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm;codecs=vp8', 'webm'],
    ['video/webm', 'webm'],
    ['video/mp4', 'mp4'],
  ];
  for (const [mime, ext] of list) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return { mime, ext };
    }
  }
  throw new Error('当前浏览器不支持视频录制，请改用「保存图片」');
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** 第 i 幕在 t 秒时的点亮进度 0..1 */
function stepProgress(t: number, i: number, intro: number, step: number): number {
  return clamp01((t - (intro + i * step)) / T_BLOOM);
}

/**
 * 生成点亮动画视频。
 *
 * 分两段跑，这是刻意的设计而不是优化：
 *  MediaRecorder 给帧打的时间戳就是「真实墙上时间」，没有自定义入口。
 *  如果边渲染边录，一次地图栅格化要 1 秒多，8 秒的片子会被拉成 30 秒的慢动作
 *  （实测就是这样翻车过一次）。所以先把每一幕的地图位图**预渲染**成 JPEG，
 *  再开录制、按 30fps 的节拍只做 drawImage —— 出片时长就等于设计时长。
 *  代价是用户要等预渲染，所以进度条分两段显示。
 */
export async function exportFootprintVideo(opts: VideoOptions): Promise<VideoResult> {
  const { map, cityOrder, litProvinces, mode, view, aspect, onProgress } = opts;
  const { w: W, h: H } = VIDEO_SIZES[aspect];

  // 演出脚本：见 buildActs
  const acts = buildActs(cityOrder, litProvinces, mode);
  if (!acts.length) throw new Error('还没有点亮任何城市或省份');

  const n = acts.length;
  // 幕间隔按幕数自适应：只走过两三个省时不至于 1 秒就放完
  const step = Math.min(0.5, Math.max(0.14, 5.4 / n));
  const lightEnd = T_INTRO + (n - 1) * step + T_BLOOM;
  const total = lightEnd + T_OUTRO;
  const frameCount = Math.round(total * FPS);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('当前浏览器不支持视频合成');

  const fit = warpedFit(view.rx, view.rz, aspect === '9:16' ? 1.02 : 1.12);
  const raster = { w: W, h: Math.round(H * (aspect === '9:16' ? 0.62 : 0.92)) };

  // ── 第一段：逐幕预渲染地图位图 ────────────────────────────────────────
  const frames: string[] = [];
  const scratch = document.createElement('canvas');
  scratch.width = raster.w;
  scratch.height = raster.h;
  const sctx = scratch.getContext('2d');
  if (!sctx) throw new Error('当前浏览器不支持视频合成');
  for (let k = 0; k <= n; k++) {
    if (opts.signal?.aborted) throw new Error('已取消');
    const ratios: Record<number, number> = {};
    const cities: number[] = [];
    for (let i = 0; i < k; i++) {
      ratios[acts[i]!.adcode] = acts[i]!.ratio;
      cities.push(...acts[i]!.cities);
    }
    const img = await rasterize(map, { ratios, cities, camera: view }, raster, fit);
    sctx.clearRect(0, 0, raster.w, raster.h);
    sctx.drawImage(img, 0, 0);
    // JPEG 而不是 PNG：位图留 28 张 PNG 太占内存，暗色渐变压成 JPEG 也看不出块
    frames.push(scratch.toDataURL('image/jpeg', 0.94));
    onProgress?.((k / (n + 1)) * 0.72, '正在预渲染画面');
  }

  // ── 第二段：实时合成并录制 ────────────────────────────────────────────
  const { mime, ext } = pickMime();
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  if (!track?.requestFrame) throw new Error('当前浏览器不支持逐帧录制');
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });

  // 只留当前幕与下一幕的解码结果，其余交给浏览器回收
  const decoded = new Map<number, HTMLImageElement>();
  async function frameOf(k: number) {
    let el = decoded.get(k);
    if (!el) {
      el = await loadImage(frames[k] ?? frames[0]!);
      decoded.set(k, el);
    }
    return el;
  }

  const dateStr = new Date().toLocaleDateString('zh-CN');
  const t0 = performance.now();
  rec.start();
  for (let f = 0; f < frameCount; f++) {
    if (opts.signal?.aborted) break;
    const t = f / FPS;
    const act = Math.max(0, Math.min(n, Math.floor((t - T_INTRO) / step) + 1));
    const mapImg = await frameOf(act);
    void frameOf(act + 1).catch(() => undefined);
    for (const key of decoded.keys()) if (key < act - 1) decoded.delete(key);

    // 片头淡入 + 缓慢推镜；片尾轻微回拉
    const fadeIn = clamp01(t / (T_INTRO * 0.8));
    const zoom =
      1.02 +
      0.1 * easeOut(clamp01(t / total)) -
      (t > lightEnd ? 0.04 * easeInOut(clamp01((t - lightEnd) / T_OUTRO)) : 0);
    const drift = Math.sin(clamp01(t / total) * Math.PI) * H * 0.006;

    paintBackdrop(ctx, W, H);
    const dw = raster.w * zoom;
    const dh = raster.h * zoom;
    ctx.globalAlpha = fadeIn;
    ctx.drawImage(
      mapImg,
      (W - dw) / 2,
      (aspect === '9:16' ? H * 0.06 : (H - dh) / 2) - drift + (H - dh) * 0.5 * (zoom - 1.02),
      dw,
      dh,
    );
    ctx.globalAlpha = 1;

    const shown = citiesShown(act, t, acts, mode, cityOrder.length, step);
    paintStamp(ctx, {
      align: aspect === '9:16' ? 'center' : 'left',
      x: aspect === '9:16' ? W / 2 : Math.round(W * 0.06),
      y: Math.round(aspect === '9:16' ? H * 0.72 : H * 0.82),
      titleSize: aspect === '9:16' ? 76 : 84,
      bodySize: aspect === '9:16' ? 34 : 36,
      cities: shown.cities,
      provinces: shown.provinces,
      totalCities: FOOTPRINT_CITIES.length,
      totalProvinces: FOOTPRINT_PROVINCES.length,
      date: dateStr,
      alpha: clamp01((t - T_INTRO * 0.45) / 0.8),
    });

    track.requestFrame();
    if (f % 6 === 0) {
      onProgress?.(0.72 + (f / frameCount) * 0.28, '正在合成画面');
    }
    // 严格按 30fps 的墙上时间放行；解码偶尔超时会让个别帧变长，但整体不失真
    const ahead = t0 + ((f + 1) / FPS) * 1000 - performance.now();
    if (ahead > 0) await new Promise((r) => setTimeout(r, ahead));
  }
  // 收尾：最后一片单独多录 300ms。stop() 紧跟着最后一帧 requestFrame 时，
  // 编码器还没把末帧吐进容器，直接停会在片尾留一段黑（实测黑掉约 0.5s）。
  for (let i = 0; i < 9; i++) {
    track.requestFrame();
    await new Promise((r) => setTimeout(r, 33));
  }
  const elapsed = performance.now() - t0;
  rec.stop();
  const blob = await done;
  track.stop();
  frames.length = 0;
  decoded.clear();

  onProgress?.(1, '正在封装文件');
  return { url: URL.createObjectURL(blob), ext, durationMs: elapsed };
}

/** 当前帧应该显示的城市 / 省份计数 */
function citiesShown(
  act: number,
  t: number,
  acts: FootprintAct[],
  mode: 'city' | 'province',
  totalCities: number,
  step: number,
) {
  const done = Math.min(act, acts.length);
  if (mode === 'province') return { cities: 0, provinces: done };
  let cities = 0;
  for (let i = 0; i < done; i++) cities += acts[i]!.cities.length;
  // 本幕内按 bloom 进度小数推进，数字滚动而不是跳档
  const cur = acts[done - 1];
  if (cur) cities -= Math.round(cur.cities.length * (1 - stepProgress(t, done - 1, T_INTRO, step)));
  return {
    cities: Math.max(0, Math.min(totalCities, cities)),
    provinces: done,
  };
}

/** 触发浏览器下载 */
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // 交给浏览器完成下载后再回收
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
