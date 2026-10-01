<script setup lang="ts">
/**
 * RailVista / 万里路书 · 品牌标识。
 *
 * 直接使用官方提供的品牌组合图（HeyWorld 标 | 分隔线 | 万里路书书法字），
 * 白色透明底，随主题自动适配深色界面。
 *
 * 基线对齐：图片以行内块形式渲染，底边落在文字基线上。
 */
import brandLockup from '../assets/heyworld-brand.png';

withDefaults(
  defineProps<{
    /** 渲染高度(px)，宽度按原图 1894x655 等比换算 */
    height?: number
  }>(),
  { height: 42 },
)

/** 原始素材宽高比，用于等比缩放 */
const ASPECT = 1894 / 655;
</script>

<template>
  <span class="brand-lockup" :style="{ height: `${height}px` }">
    <img
      class="brand-lockup__img"
      :src="brandLockup"
      :style="{ height: `${height}px`, width: `${Math.round(height * ASPECT)}px` }"
      alt="HeyWorld · RailVista 万里路书"
      draggable="false"
    />
  </span>
</template>

<style scoped>
.brand-lockup {
  display: inline-flex;
  align-items: center;
  line-height: 1;
  user-select: none;
  /* 深色底上白色素材略微加投影，避免纯白在浅色背景上发虚 */
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
}

.brand-lockup__img {
  display: block;
  flex: none;
  object-fit: contain;
  /* 视觉微调：素材底部留白略多，上提 1px 更贴合视觉基线 */
  transform: translateY(-1px);
}
</style>
