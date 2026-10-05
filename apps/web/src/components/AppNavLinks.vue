<script setup lang="ts">
/**
 * 主导航链接组（注入 AppTopBar 的 nav slot，仅桌面端可见）。
 * 沿用 Cinematic Ink：当前项文字提亮 + 下方 2px 光感滑块（::after）。
 */
import { useRoute } from 'vue-router';
import { APP_NAV_ITEMS } from '../data/appNav';

const route = useRoute();
const desktopLinks = APP_NAV_ITEMS.filter((item) => item.to && !item.placeholder);
</script>

<template>
  <RouterLink
    v-for="l in desktopLinks"
    :key="l.id"
    :to="l.to!"
    class="navlink"
    :class="{ 'is-active': l.match(route.path) }"
  >
    {{ l.label }}
  </RouterLink>
</template>

<style scoped>
.navlink {
  position: relative;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  color: var(--text-2);
  font-size: var(--fs-meta);
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease-standard);
}

.navlink:hover {
  color: var(--text-1);
}

.navlink.is-active {
  color: var(--text-1);
}

/* 当前项：下方 2px 光感滑块 */
.navlink.is-active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -2px;
  transform: translateX(-50%);
  width: 18px;
  height: 2px;
  border-radius: var(--radius-full);
  background: var(--accent);
  box-shadow: 0 0 8px -1px var(--accent);
}
</style>
