import { onBeforeUnmount, watch, type Ref } from 'vue';

/**
 * SVG 路线绘制动画：stroke-dasharray + stroke-dashoffset 过渡。
 *
 * 注意（A1）：path 元素通常在异步数据到达后才渲染（骨架屏 → 内容的 v-if 分支），
 * onMounted 时 pathRef.value 仍为 null，动画因此从不播放。
 * 改为 watch(pathRef) + flush:'post'，元素一挂载就补画动画。
 * getTotalLength() 返回 0 或抛错时跳过（不阻塞，内容仍可见）。
 */
export function useRoadDraw(pathRef: Ref<SVGPathElement | null>, duration = 520): void {
  let raf = 0;

  function draw(path: SVGPathElement | null): void {
    if (!path) return;

    try {
      const length = path.getTotalLength();
      if (length <= 0) return;

      // 已是终态则不重播，避免数据刷新时反复闪动
      if (path.style.strokeDashoffset === '0') return;

      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);

      raf = requestAnimationFrame(() => {
        path.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        path.style.strokeDashoffset = '0';
      });
    } catch {
      // getTotalLength 不支持或抛错，跳过动画
    }
  }

  watch(pathRef, (el) => draw(el), { immediate: true, flush: 'post' });

  onBeforeUnmount(() => {
    if (raf) cancelAnimationFrame(raf);
  });
}