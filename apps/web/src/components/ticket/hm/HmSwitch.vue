<script setup lang="ts">
/**
 * 鸿蒙风格开关（参考 ArkUI Toggle/Switch）v2（2026-10-09 鸿蒙化收敛）：
 * 胶囊滑块，带可选标题与说明。
 *
 * v2 变更：全量设计令牌；选中态由品牌色驱动（原金色交互层回退系统令牌）；
 * 语义化（role="switch" + aria-checked + 键盘 Enter/Space）；动效走 --ease-spring
 * 与 --dur-fast，并带 reduced-motion 降级。
 */
import { computed } from 'vue';

const props = defineProps<{
  modelValue: boolean;
  label?: string;
  desc?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();

const on = computed(() => props.modelValue);
function toggle() {
  if (!props.disabled) emit('update:modelValue', !on.value);
}
</script>

<template>
  <div
    class="hm-switch"
    :class="{ 'is-disabled': disabled }"
    role="switch"
    :aria-checked="on"
    :aria-disabled="disabled || undefined"
    :tabindex="disabled ? -1 : 0"
    @click="toggle"
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
  >
    <div class="hm-switch__text">
      <span v-if="label" class="hm-switch__label">{{ label }}</span>
      <span v-if="desc" class="hm-switch__desc">{{ desc }}</span>
    </div>
    <span class="hm-switch__track" :class="{ 'is-on': on }">
      <span class="hm-switch__thumb" />
    </span>
  </div>
</template>

<style scoped>
.hm-switch { display: flex; align-items: center; gap: 12px; cursor: pointer; }
.hm-switch.is-disabled { opacity: 0.5; cursor: default; }
.hm-switch__text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.hm-switch__label { font-size: var(--fs-meta); color: var(--text-1); }
.hm-switch__desc { font-size: var(--fs-micro); color: var(--text-3); }
.hm-switch__track {
  position: relative;
  width: 44px; height: 26px;
  border-radius: var(--radius-full);
  background: var(--line-strong);
  transition: background var(--dur-fast) var(--ease-standard);
  flex-shrink: 0;
}
.hm-switch__track.is-on { background: var(--accent); }
.hm-switch__thumb {
  position: absolute; top: 3px; left: 3px;
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--text-1);
  box-shadow: var(--elev-1);
  transition: transform var(--dur-fast) var(--ease-spring);
}
.hm-switch__track.is-on .hm-switch__thumb { transform: translateX(18px); }

@media (prefers-reduced-motion: reduce) {
  .hm-switch__track,
  .hm-switch__thumb {
    transition: none;
  }
}
</style>
