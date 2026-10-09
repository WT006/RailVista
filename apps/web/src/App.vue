<script setup lang="ts">
import { computed } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import AppBackdrop from './components/AppBackdrop.vue';
import AppBottomNav from './components/AppBottomNav.vue';
import AppTopBar from './components/AppTopBar.vue';

const route = useRoute();
/**
 * 全屏地图页（meta.fullscreenMap）：自带浮层控件，不渲染主顶栏，
 * 避免品牌 Logo 与地图顶栏（返回/状态卡）重叠（HIG safe-area / fixed-element-offset）。
 */
const showTopBar = computed(() => !route.meta.fullscreenMap);
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
  <AppBottomNav />

  <RouterView v-slot="{ Component }">
    <Transition name="page" mode="out-in">
      <component :is="Component" />
    </Transition>
  </RouterView>
</template>

<style>
.page-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
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
</style>
