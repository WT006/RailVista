<script setup lang="ts">
/** 鸿蒙风格开关（参考 ArkUI Toggle/Switch）：胶囊滑块，带可选标题与说明。 */
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
  <div class="hm-switch" :class="{ 'is-disabled': disabled }" @click="toggle">
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
.hm-switch__label { font-size: 14px; color: rgba(255,255,255,0.85); }
.hm-switch__desc { font-size: 11.5px; color: rgba(255,255,255,0.4); }
.hm-switch__track {
  position: relative;
  width: 44px; height: 26px;
  border-radius: 13px;
  background: rgba(255,255,255,0.16);
  transition: background 0.2s;
  flex-shrink: 0;
}
.hm-switch__track.is-on { background: #b8903c; }
.hm-switch__thumb {
  position: absolute; top: 3px; left: 3px;
  width: 20px; height: 20px; border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  transition: transform 0.2s cubic-bezier(0.3, 1.2, 0.5, 1);
}
.hm-switch__track.is-on .hm-switch__thumb { transform: translateX(18px); }
</style>
