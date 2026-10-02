<script setup lang="ts">
/**
 * 主导航链接组（注入 AppTopBar 的 nav slot）。
 * 沿用 Cinematic Ink：当前项文字提亮 + 下方 2px 光感滑块（::after）。
 */
import { useRoute } from 'vue-router';

const route = useRoute();

const links = [
  { to: '/', label: '行程', match: (p: string) => p === '/' || p === '/trip' || p.startsWith('/route/') },
  { to: '/drive', label: '自驾', match: (p: string) => p.startsWith('/drive') },
  { to: '/atlas', label: '全国地图', match: (p: string) => p.startsWith('/atlas') },
  { to: '/ticket', label: '纪念票', match: (p: string) => p.startsWith('/ticket') },
];
</script>

<template>
  <RouterLink
    v-for="l in links"
    :key="l.to"
    :to="l.to"
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
