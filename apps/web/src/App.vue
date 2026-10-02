<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppBackdrop from './components/AppBackdrop.vue';
</script>

<template>
  <!--
    背景层提到 App 根：跨路由唯一实例。
    此前每个页面各挂一个（铁路页 ChinaBackdropMap / 自驾 6 页 DriveBackdropMap），
    路由切换时组件销毁重建，视觉上就是"背景跳一下"；同时两套实现已开始分叉。
    背景是 fixed 且 z-index 0，页面内容在其上（页面底色已改为透明，由 body 兜底）。
  -->
  <AppBackdrop />

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
