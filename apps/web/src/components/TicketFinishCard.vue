<script setup lang="ts">
/**
 * 行程完成后的纪念票引导条：走完全程时把「留下这张票」这一步递给用户。
 * 只做展示与投递，票面怎么生成由所在页面决定（铁路 / 自驾字段不同）。
 *
 * 刻意做成单行横条：终到页常常同时有「下车玩法」卡占着顶部通告位，
 * 竖卡会把两张卡挤到重叠——一行标题 + 一个按钮既说得清，也让得出位置。
 * 终态事件不自动消失，只接受手动关闭；是否再提示由页面按行程 key 记住。
 */
const props = withDefaults(
  defineProps<{
    title: string;
    kicker?: string;
    primaryLabel?: string;
    compact?: boolean;
    /** map = 浮在地图底栏上方；page = 浮在底部页签上方（普通页面用） */
    placement?: 'map' | 'page';
  }>(),
  { kicker: '本段行程已完成', primaryLabel: '生成纪念票', compact: false, placement: 'map' },
);

defineEmits<{ primary: []; dismiss: [] }>();
</script>

<template>
  <Teleport to="body">
    <Transition name="finish-cta">
      <aside
        class="finish-cta"
        :class="[`finish-cta--${props.placement}`, { 'finish-cta--compact': props.compact }]"
        role="status"
        aria-live="polite"
        aria-label="行程完成，可生成纪念票"
      >
        <span class="finish-cta__mark" aria-hidden="true">✦</span>
        <span class="finish-cta__text">
          <span class="finish-cta__kicker">{{ props.kicker }}</span>
          <strong class="finish-cta__title">{{ props.title }}</strong>
        </span>
        <button type="button" class="btn primary finish-cta__btn" @click="$emit('primary')">
          {{ props.primaryLabel }}
        </button>
        <button
          type="button"
          class="finish-cta__close rv-hit"
          aria-label="关闭提示"
          @click="$emit('dismiss')"
        >
          ×
        </button>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.finish-cta {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  /* 高于地图浮层与过站通告（≤130），低于 toast（220）与弹层（≥900） */
  z-index: 140;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: min(560px, calc(100vw - 28px - var(--sidenav-w, 0px)));
  padding: 9px 10px 9px 14px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-1) 95%, transparent);
  border: 1px solid var(--line-default);
  /* 金色只作装饰描边：交互控件一律走系统令牌 */
  border-left: 3px solid var(--ticket-gold);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  box-shadow: var(--elev-float, var(--elev-3));
  color: var(--text-2);
}

.finish-cta--map {
  bottom: calc(var(--bottom-overlay, 168px) + var(--space-3));
}

.finish-cta--page {
  bottom: calc(var(--bottomnav-h, 0px) + var(--safe-bottom, 0px) + var(--space-4));
}

/* 地图页窄屏：右侧那一列（天象 / 卫星 / 定位 / 图例）不能被引导条盖住，改成靠左贴边 */
@media (max-width: 839px) {
  .finish-cta--map {
    left: var(--gutter);
    transform: none;
    width: min(340px, calc(100vw - var(--gutter) - 92px));
  }

  .finish-cta--map.finish-cta-enter-from,
  .finish-cta--map.finish-cta-leave-to {
    transform: translateY(8px);
  }
}

.finish-cta--compact {
  gap: var(--space-1);
  padding: 7px 8px 7px 12px;
}

.finish-cta__mark {
  flex: none;
  font-size: var(--fs-cap);
  line-height: 1;
  color: var(--ticket-gold-bright);
}

.finish-cta__text {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 1px;
}

.finish-cta__kicker {
  font-size: var(--fs-micro);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ticket-gold-bright);
}

.finish-cta__title {
  font-size: var(--fs-meta);
  font-weight: 700;
  line-height: var(--lh-tight);
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.finish-cta__btn {
  flex: none;
  min-height: var(--hit-min);
  padding: 0 var(--space-3);
  font-size: var(--fs-meta);
}

.finish-cta__close {
  flex: none;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-3);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.finish-cta__close:hover {
  color: var(--text-1);
  background: var(--fill-subtle);
}

/* 横屏矮视口：地图可视高度本就紧张，只留标题与按钮 */
@media (orientation: landscape) and (max-height: 560px) {
  .finish-cta {
    width: min(420px, calc(100vw - 24px));
    padding: 6px 8px;
  }

  .finish-cta__kicker {
    display: none;
  }
}

.finish-cta-enter-active,
.finish-cta-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard);
}

@media (prefers-reduced-motion: reduce) {
  .finish-cta-enter-active,
  .finish-cta-leave-active {
    transition: none;
  }
}

.finish-cta-enter-from,
.finish-cta-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
