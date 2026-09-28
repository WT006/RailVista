<script setup lang="ts">
/**
 * 顶部导航栏（App Bar）。
 *
 * 职责：
 *   1. 承载品牌标识（BrandLogo）与版本徽标，为页面提供统一的"顶部基线"；
 *   2. sticky 吸顶：随文档流滚动，滚动时保持可见（依赖 document 作为滚动容器）；
 *   3. 高度按断点走 --appbar-h 令牌（48 / 56 / 64），横屏短视口自动压缩。
 *
 * 基线对齐说明：
 *   栏内所有文本共享一条基线 —— .appbar__inner 用 align-items: center 做竖向居中，
 *   左右两组各自 align-items: baseline。由于字标（约 18px）字号大于版本徽标（12px），
 *   其基线天然低约 2px，故对左组做一次光学校正（见 --appbar-baseline-nudge）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { appVersionInfo, APP_VERSION } from '@railvista/shared';
import BrandLogo from './BrandLogo.vue';

const info = appVersionInfo();

/** 滚动增强：滚过一小段距离后加深顶栏渐变，保证内容从栏下穿过时的可读性 */
const scrolled = ref(false);
let onScroll = () => {
  scrolled.value = (document.scrollingElement?.scrollTop ?? window.scrollY) > 8;
};
onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll));
</script>

<template>
  <header class="appbar" :class="{ 'is-scrolled': scrolled }">
    <div class="rv-shell appbar__inner">
      <div class="appbar__left">
        <!-- 品牌组合图已自带中英文字标，无需再叠副标题 -->
        <BrandLogo :height="28" />
      </div>

      <div class="appbar__right">
        <slot name="actions" />
        <span
          class="appbar__version"
          :title="`${info.summary}（${info.date}）`"
        >
          v{{ APP_VERSION }}
        </span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.appbar {
  position: sticky;
  top: 0;
  z-index: 60;
  height: var(--appbar-h);
  border-bottom: 1px solid var(--line-hairline);
  /* 渐变半透明导航（鸿蒙展示类规范）：
   * 顶部较实、向下逐渐通透，配合玻璃模糊构成"渐变玻璃"层次，
   * 让顶栏悬浮于背景地图之上却不清空下层内容。 */
  background: linear-gradient(
    to bottom,
    rgba(11, 14, 20, 0.82),
    rgba(11, 14, 20, 0.55) 70%,
    rgba(11, 14, 20, 0.34)
  );
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

/* 滚动后增强顶栏实体感：随滚动加深，便于内容从栏下穿过时保持可读 */
.appbar.is-scrolled {
  background: linear-gradient(
    to bottom,
    rgba(11, 14, 20, 0.92),
    rgba(11, 14, 20, 0.7) 70%,
    rgba(11, 14, 20, 0.5)
  );
}

.appbar__inner {
  --appbar-baseline-nudge: 2px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  height: 100%;
}

.appbar__left {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  min-width: 0;
  /* 光学基线校正：字标字号大于右侧徽标，基线天然偏低 */
  transform: translateY(calc(-1 * var(--appbar-baseline-nudge)));
}

.appbar__tagline {
  font-size: var(--fs-cap);
  line-height: 1;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.appbar__right {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  flex-shrink: 0;
}

.appbar__version {
  padding: 2px var(--space-2);
  border: 1px solid var(--line-default);
  border-radius: var(--radius-xs);
  color: var(--text-2);
  font-size: var(--fs-micro);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
  white-space: nowrap;
}

/* 窄屏：收起副标题与版本徽标，只留品牌标识 */
@media (max-width: 560px) {
  .appbar__tagline {
    display: none;
  }
}

@media (max-width: 420px) {
  .appbar__version {
    display: none;
  }
}
</style>
