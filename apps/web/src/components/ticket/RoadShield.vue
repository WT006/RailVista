<script setup lang="ts">
/**
 * 公路编号标志（路牌）渲染器 —— 按 GB 5768 制式绘制。
 *
 * 输入仅一个编号字符串（G6 / G3011 / G109 / S203 / X008 / 此生必驾318 …），
 * 制式（等级 / 底色 / 边框 / 顶条 / 字色）由 shared classifyRoadSign 自动识别，
 * 组件内不写死任何颜色或等级判断。
 *
 * 两种外形：
 *   带顶条（国家高速 / 省级高速 / 此生必驾）→ 纵向盾形，顶部色带 + 下方编号；
 *   无顶条（国道 / 省道 / 县道 / 乡道 / 村道）→ 横向圆角矩形 + 双边框 + 居中编号。
 */
import { computed } from 'vue';
import { classifyRoadSign, hasBand, type RoadSignSpec } from '@railvista/shared';

const props = defineProps<{ code: string }>();

const spec = computed<RoadSignSpec>(() => classifyRoadSign(props.code));
const banded = computed(() => hasBand(spec.value.kind));

/** 编号字号随长度自适应，避免 G3011 / S203 这类长编号溢出盾面或顶到内边框 */
const numSize = computed(() => {
  const len = (spec.value.letter + spec.value.digits).length;
  if (!banded.value) return len > 4 ? 15 : len === 4 ? 18 : 22;
  return len > 4 ? 11 : len > 3 ? 13 : 16;
});
</script>

<template>
  <!-- 纵向盾形：高速 / 此生必驾 -->
  <svg v-if="banded" class="rs rs--tall" viewBox="0 0 44 50" role="img" :aria-label="`${spec.label} ${spec.ref}`">
    <rect x="1.5" y="1.5" width="41" height="47" rx="6" :fill="spec.palette.bg" :stroke="spec.palette.border" stroke-width="2" />
    <path d="M3.5 7 a4 4 0 0 1 4-4 h29 a4 4 0 0 1 4 4 v6 h-37 z" :fill="spec.palette.band" />
    <text x="22" y="11.4" font-size="6.4" font-weight="700" letter-spacing="1" :fill="spec.palette.bandFg" text-anchor="middle" font-family="'PingFang SC','Microsoft YaHei',sans-serif">{{ spec.bandText }}</text>
    <text x="22" y="36" :font-size="numSize" font-weight="800" :fill="spec.palette.fg" text-anchor="middle" font-family="'Helvetica Neue',Arial,sans-serif">{{ spec.letter }}{{ spec.digits }}</text>
    <text v-if="spec.kind === 'scenic'" x="22" y="45" font-size="5" letter-spacing=".5" :fill="spec.palette.border" text-anchor="middle" font-family="'PingFang SC','Microsoft YaHei',sans-serif">{{ spec.scenicName ?? '主题路线' }}</text>
  </svg>

  <!-- 横向矩形：国道 / 省道 / 县道 / 乡道 / 村道 -->
  <svg v-else class="rs rs--wide" viewBox="0 0 64 40" role="img" :aria-label="`${spec.label} ${spec.ref}`">
    <rect x="1.5" y="1.5" width="61" height="37" rx="7" :fill="spec.palette.bg" :stroke="spec.palette.border" stroke-width="3" />
    <rect x="5" y="5" width="54" height="30" rx="4.5" fill="none" :stroke="spec.palette.border" stroke-width="1.4" />
    <text x="32" y="27.5" :font-size="numSize" font-weight="800" letter-spacing="1" :fill="spec.palette.fg" text-anchor="middle" font-family="'Helvetica Neue',Arial,sans-serif">{{ spec.letter }}{{ spec.digits }}</text>
  </svg>
</template>

<style scoped>
.rs { display: block; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .28)); }
.rs--tall { width: 38px; height: 43px; }
.rs--wide { width: 60px; height: 37px; }
</style>
