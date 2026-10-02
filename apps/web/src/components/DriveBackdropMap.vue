<script setup lang="ts">
/**
 * 自驾页背景层：极淡的中国地图 + **全国公路网光带** + 公路侧景点星点 + 指针高光。
 *
 * 规格对齐首页（铁路）背景 `ChinaBackdropMap.vue`：
 *   - 同一套投影参数（CHINA_MERCATOR_BOUNDS）、同一 viewBox、同一铺满策略；
 *   - 轮廓来自 `assets/china-outline.svg`（?raw 内联），运行时零网络请求、无密钥依赖；
 *   - 整层 `pointer-events: none`，绝不抢前景事件；
 *   - 触屏 / prefers-reduced-motion 下只渲染静态底图，不注册指针交互。
 *
 * 与铁路版的差异（公路网专属观感）：
 *   - 公路网按「外发光宽带 + 高亮细芯」两遍描线，叠加处更亮（lighter 合成），
 *     形成真实的"路网光带"而不是一团亮斑；
 *   - 公路侧景点星点用琥珀色（公路色系），与铁路版的冷蓝星点区分；
 *   - 指针不仅点亮附近景点，还会让**穿过光圈的公路段**变亮，形成"探照灯扫过路网"的效果。
 *
 * 体积纪律：路网折线（约 150KB）单独成块懒加载，主 bundle 只含轮廓参数与星点。
 * 路网到达后淡入，视觉上是"路网逐渐点亮"，不阻塞首屏。
 */
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import outlineRaw from '../assets/china-outline.svg?raw';
import { CHINA_OUTLINE_VIEWBOX } from '../data/chinaBackdrop';
import {
  CHINA_ROAD_HEAT,
  ROAD_NETWORK_CHUNK,
  unpackLine,
  type BackdropRoad,
} from '../data/driveBackdrop';
import { ROAD_COLORS } from '../data/roadColors';

const VIEW_W = CHINA_OUTLINE_VIEWBOX.width;
const VIEW_H = CHINA_OUTLINE_VIEWBOX.height;

/** 只取生成产物里 `<g>` 内部的路径，外层 `<svg>` 由本组件掌控 */
const outlinePaths = (() => {
  const m = /<g[^>]*>([\s\S]*?)<\/g>/.exec(outlineRaw);
  return m ? m[1].trim() : '';
})();

const rootEl = useTemplateRef<HTMLElement>('rootEl');
const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl');

const pointer = ref<{ nx: number; ny: number } | null>(null);
const interactive = ref(false);
/** 路网懒加载块是否就绪（就绪前只画轮廓 + 星点） */
const netReady = ref(false);

let baseLayer: HTMLCanvasElement | null = null;

/** 解包后的路网：折线点 + 包围盒（指针命中判定用，避免每帧全量遍历） */
interface Chain {
  pts: number[][];
  color: [number, number, number];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
let chains: Chain[] = [];

/** 星点空间分桶：加速"指针附近有哪些景点"的查询 */
const buckets = new Map<string, number[]>();
const BUCKET = 60; // viewBox 单位

function bucketKey(x: number, y: number): string {
  return `${Math.floor(x / BUCKET)},${Math.floor(y / BUCKET)}`;
}

function buildBuckets(): void {
  buckets.clear();
  CHINA_ROAD_HEAT.forEach(([x, y], i) => {
    const key = bucketKey(x, y);
    const list = buckets.get(key);
    if (list) list.push(i);
    else buckets.set(key, [i]);
  });
}

/** '#rrggbb' → [r,g,b] */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function prepareChains(roads: readonly BackdropRoad[]): void {
  chains = [];
  for (const road of roads) {
    const color = hexToRgb(ROAD_COLORS[road.cls as keyof typeof ROAD_COLORS] ?? ROAD_COLORS.national);
    for (const flat of road.lines) {
      const pts = unpackLine(flat);
      if (pts.length < 2) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of pts) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      chains.push({ pts, color, minX, minY, maxX, maxY });
    }
  }
}

/** 描一条链：外发光宽带（低透明）+ 高亮细芯，两遍叠加出光带质感 */
function strokeChain(
  ctx: CanvasRenderingContext2D,
  c: Chain,
  scale: number,
  core: number,
  halo: number,
): void {
  ctx.beginPath();
  ctx.moveTo(c.pts[0]![0]! * scale, c.pts[0]![1]! * scale);
  for (let i = 1; i < c.pts.length; i += 1) {
    ctx.lineTo(c.pts[i]![0]! * scale, c.pts[i]![1]! * scale);
  }
  const [r, g, b] = c.color;
  if (halo > 0) {
    ctx.lineWidth = 5.5 * scale;
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${halo.toFixed(3)})`;
    ctx.stroke();
  }
  ctx.lineWidth = Math.max(0.6, 0.85 * scale);
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${core.toFixed(3)})`;
  ctx.stroke();
}

/** 画星点（公路侧景点） */
function paintSpots(
  ctx: CanvasRenderingContext2D,
  scale: number,
  boost: (x: number, y: number, w: number) => number,
): void {
  ctx.globalCompositeOperation = 'lighter';
  for (const [x, y, w] of CHINA_ROAD_HEAT) {
    const alpha = Math.min(1, w * boost(x, y, w));
    if (alpha <= 0.01) continue;
    const cx = x * scale;
    const cy = y * scale;
    const glowR = 6 * scale;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    // 琥珀色星点（公路色系），与铁路版冷蓝星点形成区分
    grad.addColorStop(0, `rgba(255, 236, 205, ${(alpha * 0.9).toFixed(3)})`);
    grad.addColorStop(0.45, `rgba(255, 184, 77, ${(alpha * 0.36).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255, 184, 77, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function buildBaseLayer(width: number, height: number): void {
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  const ctx = layer.getContext('2d');
  if (!ctx) return;
  const scale = width / VIEW_W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 路网：叠加合成让交叉口自然变亮
  ctx.globalCompositeOperation = 'lighter';
  for (const c of chains) strokeChain(ctx, c, scale, 0.5, 0.13);
  ctx.globalCompositeOperation = 'source-over';
  paintSpots(ctx, scale, () => 1);
  baseLayer = layer;
}

function render(): void {
  const canvas = canvasEl.value;
  if (!canvas || canvas.width === 0) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!baseLayer || baseLayer.width !== canvas.width || baseLayer.height !== canvas.height) {
    buildBaseLayer(canvas.width, canvas.height);
  }
  if (baseLayer) ctx.drawImage(baseLayer, 0, 0);

  const p = pointer.value;
  if (!interactive.value || !p) return;

  const scale = canvas.width / VIEW_W;
  const px = p.nx * VIEW_W;
  const py = p.ny * VIEW_H;
  const HOT_RADIUS = 150; // viewBox 单位

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // ① 穿过光圈的公路段加亮（先用包围盒粗筛，避免全量遍历）
  ctx.globalCompositeOperation = 'lighter';
  for (const c of chains) {
    if (c.minX > px + HOT_RADIUS || c.maxX < px - HOT_RADIUS) continue;
    if (c.minY > py + HOT_RADIUS || c.maxY < py - HOT_RADIUS) continue;
    strokeChain(ctx, c, scale, 0.5, 0.16);
  }
  ctx.globalCompositeOperation = 'source-over';

  // ② 光圈内的景点点亮（分桶把候选压到个位数）
  const bx = Math.floor(px / BUCKET);
  const by = Math.floor(py / BUCKET);
  const hot: number[] = [];
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      const list = buckets.get(`${bx + dx},${by + dy}`);
      if (!list) continue;
      for (const i of list) {
        const pt = CHINA_ROAD_HEAT[i];
        if (!pt) continue;
        if (Math.hypot(pt[0] - px, pt[1] - py) <= HOT_RADIUS) hot.push(i);
      }
    }
  }
  if (!hot.length) return;

  ctx.globalCompositeOperation = 'lighter';
  for (const i of hot) {
    const pt = CHINA_ROAD_HEAT[i];
    if (!pt) continue;
    const cx = pt[0] * scale;
    const cy = pt[1] * scale;
    const glowR = 15 * scale;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad.addColorStop(0, 'rgba(255, 244, 224, 0.92)');
    grad.addColorStop(0.35, `rgba(255, 184, 77, ${(0.4 * (pt[2] || 0.6)).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255, 184, 77, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function resizeCanvas(): void {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  // 背景是柔光层，不需要满 DPR；压到 1.5 兼顾清晰度与显存
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  baseLayer = null;
  render();
}

let rafId = 0;
let pendingEvent: PointerEvent | null = null;

function flushPointer(): void {
  rafId = 0;
  const ev = pendingEvent;
  const root = rootEl.value;
  if (!ev || !root) return;
  const rect = root.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const nx = (ev.clientX - rect.left) / rect.width;
  const ny = (ev.clientY - rect.top) / rect.height;
  pointer.value = { nx, ny };
  root.style.setProperty('--bx', `${(nx * 100).toFixed(2)}%`);
  root.style.setProperty('--by', `${(ny * 100).toFixed(2)}%`);
  render();
}

function onPointerMove(event: PointerEvent): void {
  pendingEvent = event;
  if (!rafId) rafId = requestAnimationFrame(flushPointer);
}

function clearPointer(): void {
  pointer.value = null;
  const root = rootEl.value;
  root?.style.removeProperty('--bx');
  root?.style.removeProperty('--by');
  render();
}

let resizeObserver: ResizeObserver | null = null;

onMounted(async () => {
  buildBuckets();
  resizeCanvas();

  if (typeof ResizeObserver !== 'undefined' && canvasEl.value) {
    resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(canvasEl.value);
  }

  // 路网懒加载：不进主 bundle，到达后淡入
  try {
    const mod = await ROAD_NETWORK_CHUNK();
    prepareChains(mod.CHINA_ROAD_NETWORK);
    netReady.value = true;
    baseLayer = null;
    render();
  } catch {
    /* 路网加载失败不影响背景其余部分（轮廓 + 星点仍在） */
  }

  const canHover =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!canHover || reducedMotion) {
    interactive.value = false;
    return;
  }

  interactive.value = true;
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerleave', clearPointer, { passive: true });
  window.addEventListener('blur', clearPointer);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerleave', clearPointer);
  window.removeEventListener('blur', clearPointer);
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  baseLayer = null;
  chains = [];
});
</script>

<template>
  <div
    ref="rootEl"
    class="drive-backdrop"
    :class="{ 'is-interactive': interactive, 'is-net-ready': netReady }"
    aria-hidden="true"
  >
    <div class="drive-backdrop__stage">
      <svg
        class="drive-backdrop__outline"
        :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        <g v-html="outlinePaths" />
      </svg>
      <canvas ref="canvasEl" class="drive-backdrop__canvas" />
    </div>
    <div class="drive-backdrop__glow" />
  </div>
</template>

<style scoped>
.drive-backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  /* 边缘径向渐隐：四角柔和淡出，避免与前景正文争夺注意力 */
  mask-image: radial-gradient(ellipse 100% 100% at 50% 50%, #000 55%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 100% 100% at 50% 50%, #000 55%, transparent 100%);
}

.drive-backdrop__stage {
  position: absolute;
  /* 与首页铁路背景同一铺满策略：无论竖屏横屏都占满视口，溢出部分被裁掉 */
  left: 50%;
  top: 50%;
  width: 120vmax;
  max-width: none;
  aspect-ratio: 1000 / 971;
  transform: translate(-50%, -50%);
}

@media (max-aspect-ratio: 3 / 4) {
  .drive-backdrop__stage {
    width: 150vw;
  }
}

@media (orientation: landscape) and (max-height: 560px) {
  .drive-backdrop__stage {
    width: 150vh;
  }
}

/* 轮廓剪影：极淡但可辨识（有效不透明度 = 本层 opacity × path fill-opacity） */
.drive-backdrop__outline {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  color: var(--backdrop-map-color);
  opacity: calc(var(--backdrop-map-opacity) * 0.9);
}

.drive-backdrop__outline :deep(path) {
  fill: currentColor;
  fill-opacity: 0.8;
  stroke: currentColor;
  stroke-opacity: 0.5;
  stroke-width: 0.7;
  vector-effect: non-scaling-stroke;
}

/* 公路网光带 + 景点星点：路网到达后淡入，视觉上是"路网逐渐点亮" */
.drive-backdrop__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: calc(var(--backdrop-map-opacity) * 0.5);
  transition: opacity var(--dur-slower) var(--ease-emphasized);
}

.drive-backdrop.is-net-ready .drive-backdrop__canvas {
  opacity: calc(var(--backdrop-map-opacity) * 0.95);
}

/* 指针径向高光：只改 CSS 变量，由合成层完成，不触发布局与重绘 */
.drive-backdrop__glow {
  position: absolute;
  inset: 0;
  opacity: 0;
  background: radial-gradient(
    460px circle at var(--bx, 50%) var(--by, 50%),
    rgba(255, 184, 77, 0.14),
    rgba(77, 159, 255, 0.06) 42%,
    transparent 68%
  );
  transition: opacity var(--dur-slow) var(--ease-standard);
}

.drive-backdrop.is-interactive .drive-backdrop__glow {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .drive-backdrop__glow {
    display: none;
  }
  .drive-backdrop__canvas {
    transition: none;
  }
}
</style>
