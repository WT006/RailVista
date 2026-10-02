import { onBeforeUnmount, onMounted, type Ref } from 'vue';

/**
 * SVG 路线绘制动画：stroke-dasharray + stroke-dashoffset 过渡。
 * getTotalLength() 返回 0 或抛错时跳过（不阻塞）。
 */
export function useRoadDraw(pathRef: Ref<SVGPathElement | null>, duration = 520): void {
  let raf = 0;

  onMounted(() => {
    const path = pathRef.value;
    if (!path) return;

    try {
      const length = path.getTotalLength();
      if (length <= 0) return;

      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);

      raf = requestAnimationFrame(() => {
        path.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        path.style.strokeDashoffset = '0';
      });
    } catch {
      // getTotalLength 不支持或抛错，跳过动画
    }
  });

  onBeforeUnmount(() => {
    if (raf) cancelAnimationFrame(raf);
  });
}