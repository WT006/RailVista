import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

type LngLat = [number, number];

/**
 * 让地图标记平滑跟随目标点（帧率无关指数平滑）。
 * @param target  目标坐标（响应式，由 tick() 计算的"真实位置"）
 * @param apply   把当前插值位置写回地图（如 marker.setPosition）
 * @param stiffness 每 60fps 的逼近比例（默认 0.12；越小越柔，越大越跟手）
 */
export function useSmoothMarker(
  target: Ref<LngLat | null>,
  apply: (p: LngLat) => void,
  stiffness = 0.12,
) {
  const current = ref<LngLat>(target.value ? [...target.value] as LngLat : [0, 0]);
  let raf = 0;
  let last = performance.now();
  const epsilon = 0.00002;

  const frame = (now: number) => {
    const t = target.value;
    if (!t) { raf = 0; return; }
    const dt = Math.min(now - last, 50);
    last = now;
    const k = 1 - Math.pow(1 - stiffness, dt / 16.667);
    const [tx, ty] = t;
    const [cx, cy] = current.value;
    const nx = cx + (tx - cx) * k;
    const ny = cy + (ty - cy) * k;
    current.value = [nx, ny];
    apply(current.value);

    if (Math.abs(tx - nx) > epsilon || Math.abs(ty - ny) > epsilon) {
      raf = requestAnimationFrame(frame);
    } else {
      current.value = [tx, ty];
      apply(current.value);
      raf = 0;
    }
  };

  const kick = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  watch(target, kick, { deep: false });
  onBeforeUnmount(() => raf && cancelAnimationFrame(raf));

  return { current, kick };
}