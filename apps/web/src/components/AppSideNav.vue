<script setup lang="ts">
/**
 * 侧边 Tab（≥840px）。
 *
 * 规范来源：《响应式应用架构》——「当窗口宽度达到对应的断点值，底部 Tab 可以结合
 * 挪移布局的方法，把 Tab 组件挪移到左侧。在大尺寸设备上提高交互易用性。」
 * 侧边 Tab 的导航选项继承底部 Tab（同 APP_NAV_ITEMS、同图标映射、同选中态规则）。
 *
 * 布局：固定于页面左侧、顶栏之下；宽度 = --sidenav-w（tokens.css 在 ≥840 赋值，
 * 各页面/浮层用该令牌让出空间）。嵌入显示（贴边、玻璃材质），不做悬浮。
 */
import { useRoute } from 'vue-router';
import { APP_NAV_ITEMS } from '../data/appNav';
import { navIcon } from '../data/navIcons';

const route = useRoute();
</script>

<template>
  <nav class="sidenav" aria-label="主导航">
    <RouterLink
      v-for="item in APP_NAV_ITEMS"
      :key="item.id"
      :to="item.to!"
      class="sidenav__item"
      :class="{ 'is-active': item.match(route.path) }"
    >
      <span class="sidenav__icon">
        <component :is="navIcon(item.id)" :size="24" :stroke-width="1.8" />
      </span>
      <span class="sidenav__label">{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.sidenav {
  display: none;
}

@media (min-width: 840px) {
  .sidenav {
    position: fixed;
    left: 0;
    top: var(--appbar-offset);
    bottom: 0;
    z-index: 55; /* 低于顶栏（60）与地图浮层（100+）；高于页面内容 */
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: var(--sidenav-w);
    padding: var(--space-3) var(--space-2);
    border-right: 1px solid var(--line-hairline);
    background: color-mix(in srgb, var(--surface-0) 66%, transparent);
    backdrop-filter: blur(var(--glass-blur-chrome)) saturate(var(--glass-saturate));
    -webkit-backdrop-filter: blur(var(--glass-blur-chrome)) saturate(var(--glass-saturate));
  }

  .sidenav__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: var(--space-2) 4px;
    border-radius: var(--radius-md);
    color: var(--text-3);
    font-size: var(--fs-micro);
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
    transition:
      color var(--dur-fast) var(--ease-standard),
      background var(--dur-fast) var(--ease-standard);
  }

  .sidenav__icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
  }

  .sidenav__label {
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sidenav__item.is-active {
    color: var(--accent);
    background: var(--accent-soft);
  }

  @media (hover: hover) and (pointer: fine) {
    .sidenav__item:not(.is-active):hover {
      color: var(--text-1);
      background: var(--interactive-hover);
    }
  }

  .sidenav__item:active {
    background: var(--interactive-pressed);
  }

  @media (prefers-reduced-motion: reduce) {
    .sidenav__item {
      transition: none;
    }
  }
}
</style>
