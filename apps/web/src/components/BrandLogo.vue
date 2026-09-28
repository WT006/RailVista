<script setup lang="ts">
/**
 * 万里路书 / RailVista · 双语品牌标识。
 *
 * 左侧：HeyWorld 品牌 logo + RailVista 字标；
 * 中间细分隔线；右侧：官方「万里路书」路书 logo。
 *
 * 全部为白色，透明底，可置于深色界面；按 height 等比缩放。
 */
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import '@fontsource/outfit/800.css'
import wanliLogo from '../assets/wanli-logo.png'
import heyworldLogo from '../assets/heyworld-logo.png'

withDefaults(
  defineProps<{
    /** 整体基准高度(px) */
    height?: number
  }>(),
  { height: 42 },
)
</script>

<template>
  <span class="brand-lockup">
    <!-- 英文：HeyWorld 品牌 logo + RailVista -->
    <span class="brand-en">
      <img
        class="brand-en__mark"
        :src="heyworldLogo"
        :style="{ height: `${height}px` }"
        alt="HeyWorld"
      />
      <span class="brand-en__word" :style="{ fontSize: `${height * 0.6}px` }">RailVista</span>
    </span>

    <!-- 分隔线 -->
    <span class="brand-divider" :style="{ height: `${height * 0.62}px` }" />

    <!-- 中文：万里路书 -->
    <img
      class="brand-cn"
      :src="wanliLogo"
      :style="{ height: `${height * 0.92}px` }"
      alt="万里路书"
    />
  </span>
</template>

<style scoped>
.brand-lockup {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  color: #f4f6f5;
  line-height: 1;
  user-select: none;
}

.brand-en {
  display: inline-flex;
  align-items: center;
  gap: 9px;
}

.brand-en__mark {
  display: block;
  flex: none;
  width: auto;
  max-width: 100%;
  object-fit: contain;
}

.brand-en__word {
  font-family: 'Outfit', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  font-weight: 700;
  letter-spacing: -0.01em;
  white-space: nowrap;
  color: #f4f6f5;
}

.brand-divider {
  width: 1px;
  flex: none;
  background: rgba(255, 255, 255, 0.22);
}

.brand-cn {
  display: block;
  width: auto;
  max-width: 100%;
}

/* 窄屏纵向堆叠，分隔线转横向 */
@media (max-width: 430px) {
  .brand-lockup {
    flex-direction: column;
    align-items: flex-start;
    gap: 11px;
  }

  .brand-divider {
    width: 132px;
    height: 1px !important;
  }
}
</style>
