import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';

/**
 * SVG 路线绘制动画：stroke-dasharray + stroke-dashoffset 过渡。
 *
 * 注意（A1）：path 元素通常在异步数据到达后才渲染（骨架屏 → 内容的 v-if 分支），
 * onMounted 时 pathRef.value 仍为 null，动画因此从不播放。
 * 改为 watch(pathRef) + flush:'post'，元素一挂载就补画动画。
 *
 * 注意（断线坑）：同一 path 节点上 `d` 会随异步数据变长。若仍用旧 totalLength
 * 当 dasharray，新几何多出来的段永远画不出来，小地图看起来「一段段断开」。
 * 必须在 `d` / 实测长度变化时强制按新长度重绘。
 */
export function useRoadDraw(
  pathRef: Ref<SVGPathElement | null>,
  duration = 520,
  /** 折线 d 字符串；变化时强制按新 getTotalLength 重绘 */
  pathD?: Ref<string>,
): void {
  let raf = 0;
  let clearTimer = 0;
  let lastLen = -1;

  function clearDash(path: SVGPathElement): void {
    path.style.transition = 'none';
    path.style.strokeDasharray = 'none';
    path.style.strokeDashoffset = '0';
  }

  function draw(path: SVGPathElement | null, force = false): void {
    if (!path) return;

    try {
      const length = path.getTotalLength();
      if (length <= 0) return;

      // 已是终态且长度未变 → 跳过，避免无意义闪动
      if (
        !force &&
        path.style.strokeDasharray === 'none' &&
        Math.abs(lastLen - length) < 0.5
      ) {
        return;
      }

      lastLen = length;
      if (raf) cancelAnimationFrame(raf);
      if (clearTimer) window.clearTimeout(clearTimer);

      path.style.transition = 'none';
      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);

      raf = requestAnimationFrame(() => {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduce) {
          path.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        }
        path.style.strokeDashoffset = '0';
        // 动画结束后清掉 dash，几何变长也不会再被旧长度裁成半截线
        if (reduce) {
          clearDash(path);
        } else {
          clearTimer = window.setTimeout(() => clearDash(path), duration + 40);
        }
      });
    } catch {
      clearDash(path);
    }
  }

  watch(pathRef, (el) => draw(el, true), { immediate: true, flush: 'post' });

  if (pathD) {
    watch(pathD, async () => {
      await nextTick();
      draw(pathRef.value, true);
    });
  }

  onBeforeUnmount(() => {
    if (raf) cancelAnimationFrame(raf);
    if (clearTimer) window.clearTimeout(clearTimer);
  });
}
