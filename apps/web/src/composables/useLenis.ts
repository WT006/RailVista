import { onMounted, onBeforeUnmount } from 'vue';
import Lenis from 'lenis';

export function useLenis() {
  let lenis: Lenis | null = null;
  let rafId = 0;

  onMounted(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    lenis = new Lenis({
      duration: 1.1,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.5,
    });

    const raf = (time: number) => {
      lenis?.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);
  });

  onBeforeUnmount(() => {
    if (rafId) cancelAnimationFrame(rafId);
    lenis?.destroy();
    lenis = null;
  });

  return lenis;
}