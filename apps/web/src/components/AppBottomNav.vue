<script setup lang="ts">
/**
 * 底部主导航（悬浮胶囊式页签，窗口宽度 <840）。
 *
 * 挪移：本组件底栏 → 840–1199 侧边 Tab → ≥1200 顶栏；选项同源。
 * 规范要点（HarmonyOS《底部页签》+ barFloatingStyle）：悬浮胶囊、毛玻璃、选中弹跳、按压点光源。
 */
import { onBeforeUnmount, ref } from 'vue';
import { useRoute } from 'vue-router';
import { APP_NAV_ITEMS } from '../data/appNav';
import { navIcon } from '../data/navIcons';
import { Search } from 'lucide-vue-next';
import { useGlobalSearch } from '../composables/useGlobalSearch';

const route = useRoute();
const gs = useGlobalSearch();

/** 弹跳动效：同一时刻只弹一个页签；先清后置以保证连点可重放 */
const poppingId = ref('');
let popTimer: ReturnType<typeof setTimeout> | undefined;

function pop(id: string) {
  poppingId.value = '';
  requestAnimationFrame(() => {
    poppingId.value = id;
  });
  if (popTimer) clearTimeout(popTimer);
  popTimer = setTimeout(() => {
    poppingId.value = '';
  }, 360);
}

function onNavClick(item: (typeof APP_NAV_ITEMS)[number]) {
  pop(item.id);
  // 点击当前页签：界面回滚至页面顶部；尊重系统「减少动态效果」
  if (item.match(route.path)) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }
}

/**
 * 按压点光源（沉浸光感）：事件委托到 <nav>，pointerdown 时把触点坐标写入
 * 被按页签的 --px / --py 并点亮 .is-press；pointerup / 移出即熄灭。
 * 键盘激活不产生坐标，光晕回退到元素中心（CSS 默认值）。
 */
let pressedEl: HTMLElement | null = null;

function itemFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>('.bottomnav__item');
  return el && el.parentElement?.classList.contains('bottomnav') ? el : null;
}

function onPointerDown(event: PointerEvent) {
  const el = itemFromTarget(event.target);
  if (!el) return;
  pressedEl = el;
  const rect = el.getBoundingClientRect();
  el.style.setProperty('--px', `${(event.clientX - rect.left).toFixed(1)}px`);
  el.style.setProperty('--py', `${(event.clientY - rect.top).toFixed(1)}px`);
  el.classList.add('is-press');
}

function clearPress() {
  if (pressedEl) {
    pressedEl.classList.remove('is-press');
    pressedEl = null;
  }
}

onBeforeUnmount(() => {
  if (popTimer) clearTimeout(popTimer);
  clearPress();
});
</script>

<template>
  <nav
    class="bottomnav"
    aria-label="主导航"
    @pointerdown="onPointerDown"
    @pointerup="clearPress"
    @pointercancel="clearPress"
  >
    <button
      type="button"
      class="bottomnav__item bottomnav__item--search"
      aria-label="全局搜索"
      @click="gs.open()"
      @pointerleave="clearPress"
    >
      <span class="bottomnav__icon">
        <Search :size="24" :stroke-width="1.8" />
      </span>
      <span class="bottomnav__label">搜索</span>
    </button>
    <template v-for="item in APP_NAV_ITEMS" :key="item.id">
      <RouterLink
        v-if="item.to"
        :to="item.to"
        class="bottomnav__item"
        :class="{
          'is-active': item.match(route.path),
          'bottomnav__item--center': item.center,
        }"
        @click="onNavClick(item)"
        @pointerleave="clearPress"
      >
        <span class="bottomnav__icon" :class="{ 'is-pop': poppingId === item.id }">
          <component :is="navIcon(item.id)" :size="24" :stroke-width="1.8" />
        </span>
        <span class="bottomnav__label">{{ item.label }}</span>
      </RouterLink>
      <span
        v-else
        class="bottomnav__item bottomnav__item--placeholder"
        :class="{ 'bottomnav__item--center': item.center }"
        aria-disabled="true"
        title="功能开发中"
      >
        <span class="bottomnav__icon">
          <component :is="navIcon(item.id)" :size="24" :stroke-width="1.8" />
        </span>
        <span class="bottomnav__label">{{ item.label }}</span>
      </span>
    </template>
  </nav>
</template>

<style scoped>
.bottomnav {
  display: none;
}

@media (max-width: 839px) {
  .bottomnav {
    position: fixed;
    /* 悬浮胶囊：左右各留 12vp，底边留 8vp + 系统 Home 指示条安全区（barFloatingStyle） */
    left: var(--nav-float-inset);
    right: var(--nav-float-inset);
    bottom: calc(var(--nav-float-gap) + env(safe-area-inset-bottom, 0px));
    z-index: 250;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    align-items: center;
    /* 胶囊本体固定 56vp 高（--bottomnav-h 64 为内容避让总高，含 8vp 悬浮留白） */
    height: calc(var(--bottomnav-h) - var(--nav-float-gap));
    padding: 2px var(--space-1);
    box-sizing: border-box;
    border-radius: 22px;
    /* 沉浸式系统材质：半透明渐变（材质层在描边/阴影之下，FAQ：不得用不透明底盖住） */
    border: 1px solid color-mix(in srgb, var(--line-default) 80%, transparent);
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--surface-0) 72%, transparent) 0%,
      color-mix(in srgb, var(--surface-0) 88%, transparent) 42%,
      color-mix(in srgb, var(--surface-0) 94%, transparent) 100%
    );
    backdrop-filter: blur(var(--glass-blur-chrome)) saturate(var(--glass-saturate));
    -webkit-backdrop-filter: blur(var(--glass-blur-chrome)) saturate(var(--glass-saturate));
    /* 投影托底 + 顶部内高光（边缘流光：沿胶囊上缘勾勒的 1px 亮线） */
    box-shadow:
      0 10px 30px -8px rgba(0, 0, 0, 0.55),
      inset 0 1px 0 rgba(255, 255, 255, 0.1),
      inset 0 -1px 0 rgba(0, 0, 0, 0.25);
  }

  /* 渐变蒙层：胶囊上缘向上 16vp、全宽（向视口两侧补回胶囊内缩量），颜色向页面背景衰减 */
  .bottomnav::before {
    content: '';
    position: absolute;
    left: calc(-1 * var(--nav-float-inset));
    right: calc(-1 * var(--nav-float-inset));
    bottom: calc(100% - 2px);
    height: var(--bottomnav-scrim-h);
    background: linear-gradient(
      to top,
      color-mix(in srgb, var(--surface-0) 82%, transparent),
      transparent
    );
    pointer-events: none;
  }

  .bottomnav__item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-height: 48px;
    padding: var(--space-1) 2px;
    border: none;
    border-radius: 14px;
    background: transparent;
    color: var(--text-3);
    font: inherit;
    font-size: var(--fs-micro);
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    text-decoration: none;
    overflow: hidden;
    -webkit-tap-highlight-color: transparent;
    transition:
      color var(--dur-fast) var(--ease-standard),
      transform var(--dur-micro) var(--ease-spring);
  }

  /* 按压点光源（沉浸光感·按压点光源等效实现）：触点径向光晕，按压期间点亮 */
  .bottomnav__item::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0;
    background: radial-gradient(
      var(--press-glow-radius) circle at var(--px, 50%) var(--py, 50%),
      rgba(255, 255, 255, var(--press-glow-alpha)),
      color-mix(in srgb, var(--accent) 22%, transparent) 38%,
      transparent 68%
    );
    transition: opacity var(--dur-fast) var(--ease-standard);
  }

  .bottomnav__item.is-press::after {
    opacity: 1;
  }

  /* 弹性按压：内容轻微收缩，松开按 spring 回弹（减少动态效果时由全局兜底关闭） */
  @media (prefers-reduced-motion: no-preference) {
    .bottomnav__item.is-press {
      transform: scale(0.94);
    }
  }

  .bottomnav__item.is-press::after {
    transition: none;
  }

  .bottomnav__icon {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
  }

  .bottomnav__label {
    position: relative;
    z-index: 1;
    display: block;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 选中态：品牌高亮色（规范：明亮的品牌色反馈 + 图标弹跳） */
  .bottomnav__item.is-active {
    color: var(--accent);
  }

  /* 未选中弱化（降低透明度），悬停用通用交互态色（仅精确指针设备） */
  @media (hover: hover) and (pointer: fine) {
    .bottomnav__item:not(.is-active):hover {
      color: var(--text-2);
    }
    .bottomnav__item:not(.is-active):hover::after {
      opacity: 1;
      background: radial-gradient(
        var(--press-glow-radius) circle at var(--px, 50%) var(--py, 50%),
        rgba(255, 255, 255, calc(var(--press-glow-alpha) * 0.6)),
        transparent 66%
      );
    }
  }

  /* 中置主入口（运营页签形态：图标居中、强调底） */
  .bottomnav__item--center .bottomnav__icon {
    width: 40px;
    height: 32px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
  }

  .bottomnav__item--center.is-active .bottomnav__icon {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--surface-0);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--accent) 38%, transparent);
  }

  /* 选中弹跳（BounceSymbolEffect-EffectDirection.DOWN 的等价实现，快速响应档内） */
  @media (prefers-reduced-motion: no-preference) {
    .bottomnav__icon.is-pop {
      animation: nav-pop var(--dur-base) var(--ease-spring);
    }
  }

  @keyframes nav-pop {
    0% {
      transform: translateY(0) scale(1);
    }
    45% {
      transform: translateY(-3px) scale(1.08);
    }
    100% {
      transform: translateY(0) scale(1);
    }
  }

  .bottomnav__item--placeholder {
    opacity: 0.42;
    cursor: default;
    pointer-events: none;
  }

  .bottomnav__item--search {
    cursor: pointer;
  }

  @media (prefers-reduced-motion: reduce) {
    .bottomnav__item {
      transition: color var(--dur-fast) var(--ease-standard);
    }
  }
}
</style>
