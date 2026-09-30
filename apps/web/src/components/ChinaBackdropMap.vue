<script setup lang="ts">
/**
 * 首页背景层：极淡的中国地图 + 全国铁路景点热力光点。
 *
 * 资源与合规：
 *   - 轮廓来自 `assets/china-outline.svg`，用 `?raw` **内联进 JS 包**，
 *     运行时零网络请求、不依赖任何在线地图服务或密钥；
 *   - 生成过程见 `scripts/build-china-backdrop.mjs`（构建期一次性，数据源：高德行政区划边界）；
 *   - 点位复用 `data/presets/scenic-spots.json`（全国铁路沿线景点）预计算的热力数据。
 *
 * 交互（参考 DeepSeek 官网背景：光影流转 + 局部高亮）：
 *   - 指针移动 → 一层径向高光跟随（CSS 变量驱动，不触发重排）；
 *   - 靠近景点的光点被点亮、其余相对压暗，形成"地图呼吸"的纵深感。
 *
 * 可读性保障：
 *   - 整体不透明度由 --backdrop-map-opacity 控制（默认 8%）；
 *   - 整层 pointer-events: none，绝不抢前景事件；
 *   - 叠加边缘渐变遮罩降噪，避免与前景文字争夺注意力。
 *
 * 降级：触屏设备（无 hover）与 prefers-reduced-motion 下只渲染静态底图，不注册指针交互。
 */
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import outlineRaw from '../assets/china-outline.svg?raw';
import { CHINA_OUTLINE_VIEWBOX, CHINA_SCENIC_HEAT } from '../data/chinaBackdrop';

const VIEW_W = CHINA_OUTLINE_VIEWBOX.width;
const VIEW_H = CHINA_OUTLINE_VIEWBOX.height;

/**
 * 只取生成产物里 `<g>` 内部的路径，外层 `<svg>` 由本组件掌控，
 * 以便统一控制 viewBox、填充色与透明度。
 */
const outlinePaths = (() => {
  const m = /<g[^>]*>([\s\S]*?)<\/g>/.exec(outlineRaw);
  return m ? m[1].trim() : '';
})();

const rootEl = useTemplateRef<HTMLElement>('rootEl');
const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl');

/** 指针相对舞台的归一化坐标（0–1），null 表示指针不在页面上 */
const pointer = ref<{ nx: number; ny: number } | null>(null);
/** 指针是否可用（触屏 / 减少动效时关闭交互） */
const interactive = ref(false);

/** 预渲染的静态热力层（尺寸变化时重建） */
let baseLayer: HTMLCanvasElement | null = null;
/** 空间分桶：加速"指针附近有哪些景点"的查询，避免每帧遍历 432 点 */
const buckets = new Map<string, number[]>();
const BUCKET = 60; // viewBox 单位

function bucketKey(x: number, y: number): string {
  return `${Math.floor(x / BUCKET)},${Math.floor(y / BUCKET)}`;
}

function buildBuckets(): void {
  buckets.clear();
  CHINA_SCENIC_HEAT.forEach(([x, y], i) => {
    const key = bucketKey(x, y);
    const list = buckets.get(key);
    if (list) list.push(i);
    else buckets.set(key, [i]);
  });
}

/** viewBox 坐标 → canvas 像素比例 */
function scaleOf(canvas: HTMLCanvasElement): number {
  return canvas.width / VIEW_W;
}

/** 把热力点画到给定 2D 上下文 */
function paintPoints(
  ctx: CanvasRenderingContext2D,
  scale: number,
  boost: (x: number, y: number, w: number) => number,
): void {
  ctx.globalCompositeOperation = 'lighter';
  for (const [x, y, w] of CHINA_SCENIC_HEAT) {
    const cx = x * scale;
    const cy = y * scale;
    const alpha = Math.min(1, w * boost(x, y, w));
    if (alpha <= 0.01) continue;
    const glowR = 7 * scale;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad.addColorStop(0, `rgba(199, 224, 255, ${(alpha * 0.85).toFixed(3)})`);
    grad.addColorStop(0.45, `rgba(77, 159, 255, ${(alpha * 0.34).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(77, 159, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** 构建静态底图（只画一次，指针移动时直接复用） */
function buildBaseLayer(width: number, height: number): void {
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  const ctx = layer.getContext('2d');
  if (!ctx) return;
  paintPoints(ctx, width / VIEW_W, () => 1);
  baseLayer = layer;
}

/** 把底图 + 指针高亮合成到可见 canvas */
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

  // 指针附近的景点点亮：用分桶把候选压到个位数
  const px = p.nx * VIEW_W;
  const py = p.ny * VIEW_H;
  const bx = Math.floor(px / BUCKET);
  const by = Math.floor(py / BUCKET);
  const HOT_RADIUS = 150; // viewBox 单位
  const hot = new Set<number>();
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const list = buckets.get(`${bx + dx},${by + dy}`);
      if (!list) continue;
      for (const i of list) {
        const pt = CHINA_SCENIC_HEAT[i];
        if (!pt) continue;
        if (Math.hypot(pt[0] - px, pt[1] - py) <= HOT_RADIUS) hot.add(i);
      }
    }
  }
  if (!hot.size) return;

  const scale = scaleOf(canvas);
  ctx.globalCompositeOperation = 'lighter';
  for (const i of hot) {
    const pt = CHINA_SCENIC_HEAT[i];
    if (!pt) continue;
    const cx = pt[0] * scale;
    const cy = pt[1] * scale;
    const glowR = 16 * scale;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad.addColorStop(0, 'rgba(232, 244, 255, 0.9)');
    grad.addColorStop(0.35, 'rgba(77, 159, 255, 0.42)');
    grad.addColorStop(1, 'rgba(77, 159, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** 依据元素尺寸与 DPR 调整 canvas 分辨率（避免高分屏发虚） */
function resizeCanvas(): void {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
  // 光影跟随：只写 CSS 变量，不触发布局
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

onMounted(() => {
  buildBuckets();
  resizeCanvas();

  if (typeof ResizeObserver !== 'undefined' && canvasEl.value) {
    resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(canvasEl.value);
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
});
</script>

<template>
  <div ref="rootEl" class="backdrop" :class="{ 'is-interactive': interactive }" aria-hidden="true">
    <div class="backdrop__stage">
      <svg
        class="backdrop__outline"
        :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        <g v-html="outlinePaths" />
      </svg>
      <canvas ref="canvasEl" class="backdrop__heat" />
    </div>
    <div class="backdrop__glow" />
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  /* 边缘径向渐隐：降噪，并让地图在四角柔和淡出（铺满后中心大、边缘留出呼吸感） */
  mask-image: radial-gradient(ellipse 100% 100% at 50% 50%, #000 55%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 100% 100% at 50% 50%, #000 55%, transparent 100%);
}

.backdrop__stage {
  position: absolute;
  /*
   * 定位策略（铺满）：无论竖屏横屏都让地图轮廓占满整个视口。
   * 地图按"覆盖式"缩放（object-fit 语义），宽高都 ≥ 视口，中心锚定在视口中部，
   * 四周溢出部分被 .backdrop 的 overflow:hidden 裁掉 —— 保证任何屏幕比例下
   * 都"铺满"而非只在某一侧露出一小块。前景是半透明玻璃卡片，地图从卡下透出，
   * 不会与正文抢注意力。
   */
  left: 50%;
  top: 50%;
  width: 120vmax;
  max-width: none;
  aspect-ratio: 1000 / 971;
  transform: translate(-50%, -50%);
}

/* 极窄竖屏（手机）：vmax 偏小，改用更宽的 vw 兜底，确保横向也铺满 */
@media (max-aspect-ratio: 3 / 4) {
  .backdrop__stage {
    width: 150vw;
  }
}

/* 短视口横屏：vmax 会取到很宽的 vw，高度反而可能不够，改按 vh 保证纵向铺满 */
@media (orientation: landscape) and (max-height: 560px) {
  .backdrop__stage {
    width: 150vh;
  }
}

/* 轮廓剪影：极淡但可辨识。注意有效不透明度 = 本层 opacity × path 的 fill-opacity，
   历史上三层叠乘（0.08 × 0.62 × 0.5 ≈ 2.5%）导致完全看不见，此处按"感知亮度"配平。 */
.backdrop__outline {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  color: var(--backdrop-map-color);
  opacity: var(--backdrop-map-opacity);
}

.backdrop__outline :deep(path) {
  fill: currentColor;
  fill-opacity: 0.8;
  stroke: currentColor;
  stroke-opacity: 0.5;
  /* 非缩放描边：SVG 被拉伸时描边不会变粗，避免窄屏出现粗边噪点 */
  stroke-width: 0.7;
  vector-effect: non-scaling-stroke;
}

/* 景点热力光点层：比轮廓略弱，形成"底图 + 星点"的层次而不是一团亮斑 */
.backdrop__heat {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: calc(var(--backdrop-map-opacity) * 0.75);
}

/* 指针径向高光：只改 CSS 变量，由合成层完成，不触发布局与重绘 */
.backdrop__glow {
  position: absolute;
  inset: 0;
  opacity: 0;
  background: radial-gradient(
    420px circle at var(--bx, 50%) var(--by, 50%),
    rgba(77, 159, 255, 0.16),
    rgba(77, 159, 255, 0.05) 42%,
    transparent 68%
  );
  transition: opacity var(--dur-slow) var(--ease-standard);
}

/* 仅在"可悬停设备 + 未开启减少动效"时展示指针高光（由 Vue 状态驱动，避免误开） */
.backdrop.is-interactive .backdrop__glow {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .backdrop__glow {
    display: none;
  }
}
</style>
