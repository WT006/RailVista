<script setup lang="ts">
/**
 * 移动端底部主导航（<600px）。
 * 布局：铁路线 · 自驾线 · 全国地图（居中）· 纪念票 · 待开放
 * 桌面端隐藏，顶栏 AppNavLinks 保持不变。
 */
import { useRoute } from 'vue-router';
import { APP_NAV_ITEMS } from '../data/appNav';

const route = useRoute();
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
      >
        <span class="bottomnav__label">{{ item.label }}</span>
      </RouterLink>
      <span
        v-else
        class="bottomnav__item bottomnav__item--placeholder"
        :class="{ 'bottomnav__item--center': item.center }"
        aria-disabled="true"
        title="功能开发中"
      >
        <span class="bottomnav__label">{{ item.label }}</span>
      </span>
    </template>
  </nav>
</template>

<style scoped>
.bottomnav {
  display: none;
}

@media (max-width: 599px) {
  .bottomnav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 250;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    align-items: center;
    gap: 0;
    min-height: calc(var(--bottomnav-h) + env(safe-area-inset-bottom, 0px));
    padding:
      10px var(--space-1) calc(10px + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid color-mix(in srgb, var(--line-default) 65%, transparent);
    background: linear-gradient(
      to top,
      rgba(11, 14, 20, 0.94) 0%,
      rgba(11, 14, 20, 0.88) 72%,
      rgba(11, 14, 20, 0.82) 100%
    );
    backdrop-filter: blur(14px) saturate(var(--glass-saturate));
    -webkit-backdrop-filter: blur(14px) saturate(var(--glass-saturate));
  }

  .bottomnav__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 48px;
    padding: var(--space-1) var(--space-1);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-3);
    font: inherit;
    font-size: var(--fs-meta);
    font-weight: 600;
    line-height: 1.25;
    text-align: center;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
    transition: color var(--dur-fast) var(--ease-standard);
  }

  .bottomnav__label {
    display: block;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bottomnav__item.is-active {
    color: var(--text-1);
  }

  .bottomnav__item.is-active .bottomnav__label {
    position: relative;
  }

  .bottomnav__item.is-active .bottomnav__label::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -4px;
    transform: translateX(-50%);
    width: 14px;
    height: 2px;
    border-radius: var(--radius-full);
    background: var(--accent);
    box-shadow: 0 0 6px -1px var(--accent);
  }

  /* 居中主入口：略抬高 + 胶囊底 */
  .bottomnav__item--center {
    transform: translateY(-4px);
    min-height: 52px;
    color: var(--text-2);
  }

  .bottomnav__item--center .bottomnav__label {
    padding: 8px var(--space-3);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
    font-size: var(--fs-body);
    font-weight: 700;
  }

  .bottomnav__item--center.is-active {
    color: var(--text-1);
  }

  .bottomnav__item--center.is-active .bottomnav__label {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--surface-0);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--accent) 38%, transparent);
  }

  .bottomnav__item--center.is-active .bottomnav__label::after {
    display: none;
  }

  .bottomnav__item--placeholder {
    opacity: 0.42;
    cursor: default;
    pointer-events: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bottomnav__item {
    transition: none;
  }
}
</style>
