import { onBeforeUnmount, onMounted } from 'vue';

/**
 * 指针光影（DeepSeek 式悬停的底层实现）。
 *
 * 把指针在卡片内的相对位置写入该卡片的 CSS 变量，供 CSS 绘制：
 *   --mx / --my  光晕圆心（px，相对卡片左上角）
 *   --mx-line    顶部高光带的横向位置（%）
 *
 * 性能与降级设计：
 *   1. 事件委托：整页只挂一个 pointermove 监听，不做"每卡片一个监听"；
 *   2. rAF 合帧：同一帧内多次 pointermove 只写一次样式，避免布局抖动；
 *   3. 只在 (hover: hover) and (pointer: fine) 设备创建监听 —— 触屏不产生 hover 残留；
 *   4. prefers-reduced-motion 下完全不注册，尊重系统"减少动态效果"。
 *
 * 匹配规则：closest 取「最近匹配元素」—— 指针在一级卡片的二/三级条目
 * （.recent-card / .train-card / .rank-card / .rank-row / .rv-tile）上时，
 * 命中条目本身，实现条目级光晕；在条目之间的卡面空白处则命中卡片。
 */
const SPOTLIGHT_SELECTOR =
  '[data-spotlight], .rv-tile, .recent-card, .train-card, .rank-card, .rank-row, .atlas-entry';

export function usePointerSpotlight(): void {
  let rafId = 0;
  let latest: PointerEvent | null = null;
  let active: HTMLElement | null = null;

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

  function onPointerMove(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest<HTMLElement>(SPOTLIGHT_SELECTOR);
    if (el !== active) active = el;
    if (!active) return;
    latest = event;
    if (!rafId) rafId = requestAnimationFrame(apply);
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
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });
    window.addEventListener('blur', onPointerLeave);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('blur', onPointerLeave);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    active = null;
    latest = null;
  });
}
