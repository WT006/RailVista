<script setup lang="ts">
/**
 * 票面主题选择（主流程，2026-10-19 从「高级微调 · 外观」提上来）。
 * 色板值仅用于还原主题本身的样子；控件边框 / 焦点 / 文字仍走语义令牌。
 */
import { computed } from 'vue';
import { useTicketStore } from '../../stores/ticketStore';
import { themesForKind, type TicketTheme } from '../../data/ticket';

const store = useTicketStore();
const themes = computed(() => themesForKind(store.config.kind));
const current = computed(() => store.config.background.theme);

/** 与 TicketFace 注入的 --tk-grad 同一组渐变，保证所见即所得 */
function previewStyle(t: TicketTheme) {
  return {
    background: `linear-gradient(165deg, ${t.grad[0]} 0%, ${t.grad[1]} 48%, ${t.grad[2]} 100%)`,
    '--sw-acc': t.accent,
  };
}

function pick(id: string) {
  if (id === current.value) return;
  store.patch({ background: { ...store.config.background, theme: id } });
}
</script>

<template>
  <div class="tt" role="radiogroup" aria-label="票面主题">
    <button
      v-for="t in themes"
      :key="t.id"
      type="button"
      role="radio"
      :aria-checked="t.id === current"
      class="tt__item"
      :class="{ 'is-on': t.id === current }"
      @click="pick(t.id)"
    >
      <span class="tt__swatch" :style="previewStyle(t)">
        <i class="tt__line" aria-hidden="true" />
        <i class="tt__chip" aria-hidden="true" />
      </span>
      <span class="tt__label">{{ t.label }}</span>
      <svg v-if="t.id === current" class="tt__check" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.tt { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: var(--space-1); }
.tt__item {
  position: relative;
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-default);
  background: var(--surface-2);
  font-family: inherit; text-align: left; cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.tt__item:focus-visible { outline: none; box-shadow: var(--focus-ring); }
@media (hover: hover) and (pointer: fine) {
  .tt__item:hover { border-color: var(--line-strong); }
}
.tt__item.is-on { border-color: var(--accent); }

.tt__swatch {
  position: relative;
  display: block; height: 56px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-default);
  overflow: hidden;
}
.tt__line {
  position: absolute; top: 46%; left: 14%; right: 14%;
  border-top: 2px dashed var(--sw-acc);
}
.tt__chip {
  position: absolute; top: 66%; left: 14%;
  width: 36%; height: 5px;
  border-radius: var(--radius-full);
  background: var(--sw-acc);
}

.tt__label { font-size: var(--fs-cap); line-height: 1.35; color: var(--text-2); }
.tt__item.is-on .tt__label { color: var(--accent); font-weight: 600; }
.tt__check {
  position: absolute; top: 10px; right: 10px;
  width: 16px; height: 16px; color: var(--accent);
}

@media (prefers-reduced-motion: reduce) {
  .tt__item { transition: none; }
}
</style>
