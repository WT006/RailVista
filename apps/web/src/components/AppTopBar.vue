<script setup lang="ts">
/**
 * 顶部导航栏（App Bar）。
 *
 * 职责：品牌 + 版本；≥1200 网页档额外承载主导航（与底栏/侧栏同源 APP_NAV_ITEMS）。
 * 挪移：&lt;840 底栏 / 840–1199 侧边 Tab / ≥1200 本组件顶栏。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { appVersionInfo, APP_VERSION } from '@railvista/shared';
import { APP_NAV_ITEMS } from '../data/appNav';
import { navIcon } from '../data/navIcons';
import BrandLogo from './BrandLogo.vue';

const route = useRoute();

/** 版本号与变更摘要（悬浮显示，与 CHANGELOG.md 首条同源） */
const versionInfo = appVersionInfo();

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
      </div>

      <!-- 网页档主导航：仅 ≥1200 显示；平板走侧栏、手机走底栏 -->
      <nav class="appbar__nav" aria-label="主导航">
        <RouterLink
          v-for="item in APP_NAV_ITEMS"
          :key="item.id"
          :to="item.to || '/'"
          class="appbar__nav-item"
          :class="{ 'is-active': item.match(route.path) }"
        >
          <span class="appbar__nav-icon" aria-hidden="true">
            <component :is="navIcon(item.id)" :size="18" :stroke-width="1.9" />
          </span>
          <span class="appbar__nav-label">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="appbar__right">
        <slot name="actions" />
        <span
          class="appbar__version"
          :title="`${versionInfo.summary}（${versionInfo.date}）`"
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
  /* 总高含安全区；内层仍按 --appbar-h 排布，Logo 不会顶到状态栏 */
  height: var(--appbar-offset);
  padding-top: var(--safe-top);
  /* 平板档让出侧边 Tab：品牌/版本与页面内容列严格对齐（--sidenav-w 断点赋值） */
  padding-left: var(--sidenav-w);
  box-sizing: border-box;
  /* 与主页面融为一体：去掉底部硬描边，背景几乎透明，仅保留极淡的玻璃模糊，
   * 让顶栏像"悬浮在页面之上"而非一块独立的条。滚过内容后才微微加深，给出层级暗示。
   * P5：背景随滚动状态的加深/变浅走平滑过渡（沉浸光感规范：从透明到模糊平滑过渡），
   * 而不是瞬间替换 —— 此前无 transition，is-scrolled 翻转时会出现突兀的模糊闪变。 */
  transition: background var(--dur-slow) var(--ease-standard);
  border-bottom: none;
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--surface-0) 72%, transparent) 0%,
    color-mix(in srgb, var(--surface-0) 50%, transparent) var(--safe-top),
    color-mix(in srgb, var(--surface-0) 24%, transparent) calc(var(--safe-top) + 72%),
    transparent
  );
  backdrop-filter: blur(var(--glass-blur-chrome)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur-chrome)) saturate(var(--glass-saturate));
}

/* 滚动后：轻轻托底，让 Logo 始终可辨，但仍不出现硬边框 */
.appbar.is-scrolled {
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--surface-0) 82%, transparent) 0%,
    color-mix(in srgb, var(--surface-0) 66%, transparent) var(--safe-top),
    color-mix(in srgb, var(--surface-0) 38%, transparent) calc(var(--safe-top) + 72%),
    transparent
  );
}

.appbar__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  height: var(--appbar-h);
}

.appbar__left {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  flex-shrink: 0;
}

@media (max-width: 599px) {
  .appbar__left {
    gap: var(--space-2);
  }
}

/* 默认隐藏；网页档（≥1200）在顶栏展示主导航 */
.appbar__nav {
  display: none;
  align-items: center;
  justify-content: center;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}

.appbar__nav-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  color: var(--text-3);
  font-size: var(--fs-cap);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition:
    color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard);
}

.appbar__nav-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.appbar__nav-item.is-active {
  color: var(--accent-hover);
  background: var(--accent-soft);
}

@media (hover: hover) and (pointer: fine) {
  .appbar__nav-item:not(.is-active):hover {
    color: var(--text-1);
    background: var(--interactive-hover);
  }
}

@media (min-width: 1200px) {
  .appbar__nav {
    display: flex;
  }
}

.appbar__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

/* 版本徽标弱化为纯文字小字，不再带边框盒，减少导航条的"框"感 */
.appbar__version {
  color: var(--text-3);
  font-size: var(--fs-micro);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
  opacity: 0.75;
}

@media (max-width: 420px) {
  .appbar__version {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .appbar {
    transition: none;
  }
}
</style>
