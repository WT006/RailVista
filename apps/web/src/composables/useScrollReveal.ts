import { onBeforeUnmount, onMounted } from 'vue';

interface ScrollRevealOptions {
  threshold?: number;
  staggerMs?: number;
  once?: boolean;
}

/**
 * 滚动揭示：IntersectionObserver 监听元素进入视口时添加 is-revealed 类。
 * 不支持 IntersectionObserver 时直接显示（不阻塞渲染）。
 */
export function useScrollReveal(selector: string, options: ScrollRevealOptions = {}): void {
  const { threshold = 0.1, staggerMs = 40, once = true } = options;

  let observer: IntersectionObserver | null = null;

  onMounted(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    const elements = document.querySelectorAll<HTMLElement>(selector);
    if (!elements.length) return;

    let index = 0;
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            el.style.transitionDelay = `${index * staggerMs}ms`;
            el.classList.add('is-revealed');
            index++;
            if (once && observer) observer.unobserve(el);
          }
        }
      },
      { threshold },
    );

    elements.forEach((el) => observer!.observe(el));
  });

  onBeforeUnmount(() => {
    if (observer) observer.disconnect();
  });
}