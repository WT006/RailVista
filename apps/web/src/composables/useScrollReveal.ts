import { onBeforeUnmount, onMounted } from 'vue';

interface ScrollRevealOptions {
  threshold?: number;
  staggerMs?: number;
  once?: boolean;
}

/**
 * 滚动揭示：IntersectionObserver 监听元素进入视口时添加 is-revealed 类。
 *
 * 注意（A1）：目标元素常常在异步数据到达后才渲染（骨架屏 → 内容的 v-if 分支），
 * 因此不能在 onMounted 里一次性 querySelectorAll —— 那样会抓到空集合并提前退出，
 * 导致 IntersectionObserver 永不注册，而 CSS 初始态是 opacity:0，元素永久不可见。
 * 这里改为「MutationObserver 监听子树变化 + 惰性建立 IntersectionObserver」，
 * 保证任意时刻新出现的匹配元素都会被纳入观察。
 */
export function useScrollReveal(
  selector: string,
  options: ScrollRevealOptions = {},
): { rescan: () => void } {
  const { threshold = 0.1, staggerMs = 40, once = true } = options;

  let observer: IntersectionObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let revealedCount = 0;
  let observed = new WeakSet<Element>();

  function ensureObserver(): IntersectionObserver | null {
    if (observer || typeof IntersectionObserver === 'undefined') return observer;
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.style.transitionDelay = `${revealedCount * staggerMs}ms`;
          el.classList.add('is-revealed');
          revealedCount += 1;
          if (once) observer?.unobserve(el);
        }
      },
      { threshold },
    );
    return observer;
  }

  /** 扫描当前文档中尚未被观察的匹配元素。由 MutationObserver 与首次挂载共同触发。 */
  function scan(): void {
    if (typeof document === 'undefined') return;
    // 关键安全阀：CSS 初始态为 opacity:0，若观察器不可用则必须直接显示，
    // 否则内容永久不可见（这正是 A1 缺陷的成因）。
    const io = ensureObserver();
    if (!io) {
      revealAll();
      return;
    }
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      if (observed.has(el)) return;
      // 已经进入视口（或已在视口内滚动过）时立即揭示，避免错过后不再触发
      const rect = el.getBoundingClientRect();
      if (rect.top < (typeof window !== 'undefined' ? window.innerHeight : 0)) {
        el.style.transitionDelay = `${revealedCount * staggerMs}ms`;
        el.classList.add('is-revealed');
        revealedCount += 1;
        if (!once) io.observe(el);
        observed.add(el);
        return;
      }
      io.observe(el);
      observed.add(el);
    });
  }

  /** 无 IntersectionObserver 时的降级：直接全部显示，不阻塞渲染。 */
  function revealAll(): void {
    if (typeof document === 'undefined') return;
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      el.classList.add('is-revealed');
    });
  }

  onMounted(() => {
    scan();
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      mutationObserver = new MutationObserver(() => scan());
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
    mutationObserver?.disconnect();
    mutationObserver = null;
  });

  /** 供调用方在数据加载完成后主动触发一次重扫（幂等）。 */
  return { rescan: scan };
}
