<script setup lang="ts">
/**
 * 侧边 Tab（840px–1199px，《响应式应用架构》挪移布局）。
 *
 * 导航选项继承底部 Tab；≥1200 网页档改由顶栏承载。
 * 布局：固定左侧、顶栏之下；宽度 = --sidenav-w。
 */
import { useRoute } from 'vue-router';
import { APP_NAV_ITEMS } from '../data/appNav';
import { navIcon } from '../data/navIcons';
import { Search } from 'lucide-vue-next';
import { useGlobalSearch } from '../composables/useGlobalSearch';

const route = useRoute();
const gs = useGlobalSearch();
</script>

<template>
  <nav class="sidenav" aria-label="主导航">
    <button type="button" class="sidenav__item sidenav__item--search" aria-label="全局搜索" @click="gs.open()">
      <span class="sidenav__icon">
        <Search :size="24" :stroke-width="1.8" />
      </span>
      <span class="sidenav__label">搜索</span>
    </button>
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

@media (min-width: 840px) and (max-width: 1199px) {
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

  .sidenav__item--search {
    width: 100%;
    border: 0;
    background: transparent;
    font: inherit;
    cursor: pointer;
  }

  @media (prefers-reduced-motion: reduce) {
    .sidenav__item {
      transition: none;
    }
  }
}
</style>
