import { onBeforeUnmount, onMounted } from 'vue';

/**
 * 指针光影（鸿蒙沉浸光感的 Web 等效：悬停光晕 + 按压点光源）。
 *
 * 把指针在卡片内的相对位置写入该卡片的 CSS 变量，供 CSS 绘制：
 *   --mx / --my  光晕圆心（px，相对卡片左上角）
 *   --mx-line    顶部高光带的横向位置（%）
 *
 * 两类反馈：
 *   1. 悬停光晕（pointermove）：仅 (hover:hover) and (pointer:fine) 设备注册，
 *      桌面端 DeepSeek 式跟随光效；触屏不产生 hover 残留；
 *   2. 按压点光源（pointerdown/up）：所有指针设备（含触屏）均注册，
 *      按压时在触点点亮 .is-press-active 光晕并由 CSS 做弹性缩放，
 *      对应 HarmonyOS「按压点光源」。键盘激活不触发（无触点坐标）。
 *
 * 性能与降级设计：
 *   1. 事件委托：整页只挂少量监听，不做"每卡片一个监听"；
 *   2. rAF 合帧：同一帧内多次 pointermove 只写一次样式，避免布局抖动；
 *   3. prefers-reduced-motion 下完全不注册，尊重系统"减少动态效果"。
 *
 * 匹配规则：closest 取「最近匹配元素」—— 指针在一级卡片的二/三级条目
 * （.recent-card / .train-card / .rank-card / .rank-row / .rv-tile）上时，
 * 命中条目本身，实现条目级光晕；在条目之间的卡面空白处则命中卡片。
 */
const SPOTLIGHT_SELECTOR =
  '[data-spotlight], .rv-tile, .recent-card, .train-card, .rank-card, .rank-row, .atlas-entry';

const PRESS_CLASS = 'is-press-active';

export function usePointerSpotlight(): void {
  let rafId = 0;
  let latest: PointerEvent | null = null;
  let active: HTMLElement | null = null;
  let pressed: HTMLElement | null = null;
  let finePointer = false;

  /** 把当前指针位置写进当前卡片的 CSS 变量 */
  function apply(): void {
    rafId = 0;
    if (!latest || !active) return;
    const rect = active.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = latest.clientX - rect.left;
    const y = latest.clientY - rect.top;
    active.style.setProperty('--mx', `${x.toFixed(1)}px`);
    active.style.setProperty('--my', `${y.toFixed(1)}px`);
    active.style.setProperty('--mx-line', `${((x / rect.width) * 100).toFixed(1)}%`);
  }

  function resolveTarget(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>(SPOTLIGHT_SELECTOR);
  }

  function onPointerMove(event: PointerEvent): void {
    const el = resolveTarget(event.target);
    if (el !== active) active = el;
    if (!active) return;
    latest = event;
    if (!rafId) rafId = requestAnimationFrame(apply);
  }

  /** 按压点光源：触点坐标写入 + 点亮按压态 */
  function onPointerDown(event: PointerEvent): void {
    const el = resolveTarget(event.target);
    if (!el) return;
    pressed = el;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    el.style.setProperty('--mx', `${(event.clientX - rect.left).toFixed(1)}px`);
    el.style.setProperty('--my', `${(event.clientY - rect.top).toFixed(1)}px`);
    el.style.setProperty('--mx-line', `${(((event.clientX - rect.left) / rect.width) * 100).toFixed(1)}%`);
    el.classList.add(PRESS_CLASS);
  }

  function clearPress(): void {
    if (pressed) {
      pressed.classList.remove(PRESS_CLASS);
      pressed = null;
    }
  }

  function onPointerLeave(): void {
    if (active) {
      // 清掉圆心，让光晕回到默认位置，避免下次进入时闪一下
      active.style.removeProperty('--mx');
      active.style.removeProperty('--my');
      active.style.removeProperty('--mx-line');
    }
    active = null;
    latest = null;
  }

  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (finePointer) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerleave', onPointerLeave, { passive: true });
      window.addEventListener('blur', onPointerLeave);
    }
    // 按压点光源不挑指针类型：触屏 / 鼠标 / 触控板均生效
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', clearPress, { passive: true });
    window.addEventListener('pointercancel', clearPress, { passive: true });
  });

  onBeforeUnmount(() => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('blur', onPointerLeave);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', clearPress);
    window.removeEventListener('pointercancel', clearPress);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    active = null;
    pressed = null;
    latest = null;
  });
}
