<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import AppBackdrop from './components/AppBackdrop.vue';
import AppBottomNav from './components/AppBottomNav.vue';
import AppSideNav from './components/AppSideNav.vue';
import AppTopBar from './components/AppTopBar.vue';
import GlobalSearch from './components/GlobalSearch.vue';
import { useGlobalSearch } from './composables/useGlobalSearch';

const route = useRoute();
/**
 * 全屏地图页（meta.fullscreenMap）：自带浮层控件（返回/状态卡），
 * 不渲染主顶栏与页面切换（侧边 Tab / 底部页签），避免与地图控件抢空间。
 */
const isFullscreenMap = computed(() => Boolean(route.meta.fullscreenMap));
const showTopBar = computed(() => !isFullscreenMap.value);
const showAppNav = computed(() => !isFullscreenMap.value);

// 全局搜索：单例命令面板 + Ctrl/Cmd+K 快捷键
const gs = useGlobalSearch();
function onGlobalKey(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    gs.toggle();
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey));
</script>

<template>
  <!--
    背景层提到 App 根：跨路由唯一实例。
    此前每个页面各挂一个（铁路页 ChinaBackdropMap / 自驾 6 页 DriveBackdropMap），
    路由切换时组件销毁重建，视觉上就是"背景跳一下"；同时两套实现已开始分叉。
    背景是 fixed 且 z-index 0，页面内容在其上（页面底色已改为透明，由 body 兜底）。
  -->
  <AppBackdrop />

  <!--
    P5：顶栏同样提升到 App 级。此前它在各页面内部，路由转场的 transform
    （page-enter/leave 的 translateY）会让 sticky 顶栏跟随移动，且 backdrop-filter
    的采样区域随之变化，表现为切换时"奇怪的模糊闪变"。提升到 App 级后顶栏固定不动，
    模糊保持稳定；滚动加深背景的过渡也按沉浸光感规范做成平滑渐变。
  -->
  <AppTopBar v-if="showTopBar" />
  <!-- 主导航：&lt;840 底栏 / 840–1199 侧栏 / ≥1200 顶栏；全屏地图页隐藏 -->
  <AppSideNav v-if="showAppNav" />
  <AppBottomNav v-if="showAppNav" />

  <RouterView v-slot="{ Component }">
    <Transition name="page" mode="out-in">
      <component :is="Component" />
    </Transition>
  </RouterView>

  <!-- 全局搜索命令面板（Ctrl/Cmd+K 唤起，三档导航入口共用） -->
  <GlobalSearch />
</template>

<style>
.page-enter-active {
  transition: opacity var(--dur-base) var(--ease-standard), transform var(--dur-base) var(--ease-standard);
}
.page-leave-active {
  transition: opacity var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.page-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.page-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active {
    transition: none;
  }
}
</style>
