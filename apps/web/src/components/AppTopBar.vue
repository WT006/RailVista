<script setup lang="ts">
/**
 * 顶部导航栏（App Bar）。
 *
 * 职责：
 *   1. 承载品牌标识（BrandLogo），为页面提供统一的"顶部基线"；
 *   2. sticky 吸顶：随文档流滚动，滚动时保持可见（依赖 document 作为滚动容器）；
 *   3. 高度按断点走 --appbar-h 令牌（48 / 56 / 64），横屏短视口自动压缩。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import BrandLogo from './BrandLogo.vue';
import AppNavLinks from './AppNavLinks.vue';

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
        <BrandLogo :height="34" />
        <nav class="appbar__nav" aria-label="主导航">
          <!-- 默认全站导航（行程 / 自驾 / 全国地图），页面可用具名 slot 覆盖 -->
          <slot name="nav"><AppNavLinks /></slot>
        </nav>
      </div>

      <div class="appbar__right">
        <slot name="actions" />
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
  /* 与主页面融为一体：去掉底部硬描边，背景几乎透明，仅保留极淡的玻璃模糊，
   * 让顶栏像"悬浮在页面之上"而非一块独立的条。滚过内容后才微微加深，给出层级暗示。 */
  border-bottom: none;
  background: linear-gradient(
    to bottom,
    rgba(11, 14, 20, 0.5),
    rgba(11, 14, 20, 0.24) 72%,
    rgba(11, 14, 20, 0)
  );
  backdrop-filter: blur(10px) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(10px) saturate(var(--glass-saturate));
}

/* 滚动后：轻轻托底，让 Logo 始终可辨，但仍不出现硬边框 */
.appbar.is-scrolled {
  background: linear-gradient(
    to bottom,
    rgba(11, 14, 20, 0.66),
    rgba(11, 14, 20, 0.38) 72%,
    rgba(11, 14, 20, 0)
  );
}

.appbar__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  height: 100%;
}

.appbar__left {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
}

/* 主导航链接组（默认内容 AppNavLinks.vue，页面可用具名 slot 覆盖） */
.appbar__nav {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

/* 移动端：缩小品牌与导航的间距，导航仍保持可见（提供自驾入口） */
@media (max-width: 599px) {
  .appbar__left {
    gap: var(--space-2);
  }

  .appbar__nav {
    gap: 0;
  }
}

.appbar__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}
</style>
