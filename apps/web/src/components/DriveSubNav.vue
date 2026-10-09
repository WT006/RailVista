<script setup lang="ts">
/**
 * 万里路书次级导航（PRD §2.2）：承载主/从分界，不是顶栏。
 *
 *   [ 找路线 ]  [ 榜单 ]
 *      主         从属
 *
 * 从属项视觉权重低于主项（榜单为描边胶囊，主项为实底）。
 */
import { useRoute } from 'vue-router';

const route = useRoute();

function isActive(path: string): boolean {
  if (path === '/drive') return route.path === '/drive';
  return route.path.startsWith(path);
}
</script>

<template>
  <nav class="drive-subnav" aria-label="自驾模块导航">
    <router-link class="drive-subnav__main" to="/drive" :class="{ 'is-active': isActive('/drive') }">
      找路线
    </router-link>
    <router-link
      class="drive-subnav__sub"
      to="/drive/rankings"
      :class="{ 'is-active': isActive('/drive/rankings') }"
    >
      榜单
    </router-link>
  </nav>
</template>
