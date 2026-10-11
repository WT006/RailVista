<script setup lang="ts">
/**
 * 自驾模块导航：榜单贴在标题旁；离开首页后「找路线」改为「返回」。
 *
 * 用法：
 *   <DriveSubNav><h1>标题</h1></DriveSubNav>  →  [返回?]  标题  [榜单?]
 *   <DriveSubNav />                             →  无标题时只出按钮条
 */
import { computed, useSlots } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const slots = useSlots();

const isHome = computed(() => route.path === '/drive');
const onRankings = computed(() => route.path.startsWith('/drive/rankings'));
/** 后续页（行程 / 榜单 / 路书等）显示返回，取代原「找路线」 */
const showBack = computed(() => !isHome.value);
/** 榜单页自身不再重复放入口 */
const showBoard = computed(() => !onRankings.value);
const hasTitle = computed(() => Boolean(slots.default));
</script>

<template>
  <nav
    class="drive-subnav"
    :class="{ 'is-with-title': hasTitle, 'is-bar-only': !hasTitle }"
    aria-label="自驾模块导航"
  >
    <router-link v-if="showBack" class="drive-subnav__main" to="/drive">返回</router-link>
    <div v-if="hasTitle" class="drive-subnav__title">
      <slot />
    </div>
    <router-link
      v-if="showBoard"
      class="drive-subnav__sub"
      to="/drive/rankings"
      :class="{ 'is-active': onRankings }"
    >
      榜单
    </router-link>
  </nav>
</template>
