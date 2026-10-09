<script setup lang="ts">
/**
 * 底部主导航（平铺式页签，<840px）。
 *
 * 规范要点（HarmonyOS《底部页签》）：
 *   - 图标 24vp + 文字标签（简洁、2-4 字），选中态品牌高亮、未选弱化；
 *   - 切换有「选中弹跳」反馈（BounceSymbolEffect 等效），点击当前页签回滚至页面顶部；
 *   - 模糊背板上缘保留 1px 分割线；背板之上 16vp 渐变蒙层，颜色与页面背景一致；
 *   - 高度取悬浮式 56vp 档（--bottomnav-h），安全区由 env(safe-area-inset-bottom) 追加；
 *   - ≥840px 时本组件隐藏，由 AppSideNav 侧边 Tab 接管（《响应式应用架构》挪移布局）。
 */
import { onBeforeUnmount, ref } from 'vue';
import { useRoute } from 'vue-router';
import { APP_NAV_ITEMS } from '../data/appNav';
import { navIcon } from '../data/navIcons';

const route = useRoute();

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

onBeforeUnmount(() => {
  if (popTimer) clearTimeout(popTimer);
});
</script>

<template>
  <nav class="bottomnav" aria-label="主导航">
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
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 250;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    align-items: center;
    min-height: calc(var(--bottomnav-h) + env(safe-area-inset-bottom, 0px));
    padding: 2px var(--space-1) calc(2px + env(safe-area-inset-bottom, 0px));
    /* 模糊背板：上缘 1px 分割线 + 与页面背景同色系的渐变（平铺式页签规范） */
    border-top: 1px solid color-mix(in srgb, var(--line-default) 65%, transparent);
    background: linear-gradient(
      to top,
      color-mix(in srgb, var(--surface-0) 96%, transparent) 0%,
      color-mix(in srgb, var(--surface-0) 90%, transparent) 72%,
      color-mix(in srgb, var(--surface-0) 84%, transparent) 100%
    );
    backdrop-filter: blur(var(--glass-blur-chrome)) saturate(var(--glass-saturate));
    -webkit-backdrop-filter: blur(var(--glass-blur-chrome)) saturate(var(--glass-saturate));
  }

  /* 渐变蒙层：高于内容最顶边 16vp，颜色向页面背景衰减（底部页签规范） */
  .bottomnav::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: var(--bottomnav-scrim-h);
    background: linear-gradient(
      to top,
      color-mix(in srgb, var(--surface-0) 92%, transparent),
      transparent
    );
    pointer-events: none;
  }

  .bottomnav__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-height: 48px;
    padding: var(--space-1) 2px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-3);
    font: inherit;
    font-size: var(--fs-micro);
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
    transition: color var(--dur-fast) var(--ease-standard);
  }

  .bottomnav__icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
  }

  .bottomnav__label {
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

  /* 未选中弱化（降低透明度），悬停/按压用通用交互态色 */
  @media (hover: hover) and (pointer: fine) {
    .bottomnav__item:not(.is-active):hover {
      color: var(--text-2);
    }
  }

  .bottomnav__item:active {
    background: var(--interactive-pressed);
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

  @media (prefers-reduced-motion: reduce) {
    .bottomnav__item {
      transition: none;
    }
  }
}
</style>
