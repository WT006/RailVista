<script setup lang="ts">
/**
 * 「此生必驾」盾牌（黑底金黄描边/文字），还原 G318 沿线网红路牌视觉。
 * 支持传入路线编号、里程、起讫点；编号为经典自驾公路时自动补全长里程与端点。
 */
import { computed } from 'vue';

interface MustDriveMeta { from: string; to: string; km: number }

const MUST_DRIVE: Record<string, MustDriveMeta> = {
  '318': { from: '上海', to: '聂拉木', km: 5476 },
  '219': { from: '喀纳斯', to: '东兴', km: 10065 },
  '317': { from: '成都', to: '那曲', km: 2034 },
  '315': { from: '西宁', to: '喀什', km: 3063 },
  '109': { from: '北京', to: '拉萨', km: 3922 },
  '217': { from: '阿勒泰', to: '塔什库尔干', km: 2436 },
  '227': { from: '张掖', to: '孟连', km: 3745 },
  '214': { from: '西宁', to: '澜沧', km: 3256 },
  '216': { from: '红山嘴', to: '吉隆', km: 3200 },
  '228': { from: '丹东', to: '东兴', km: 6380 },
  '331': { from: '丹东', to: '阿勒泰', km: 9300 },
};

const props = withDefaults(
  defineProps<{
    /** 路线编号，如 G318 / 318 */
    code?: string;
    lengthKm?: number;
    from?: string;
    to?: string;
  }>(),
  { code: 'G318' },
);

const number = computed(() => props.code.replace(/[A-Za-z]/g, '') || '318');
const meta = computed<MustDriveMeta>(() => {
  const known = MUST_DRIVE[number.value];
  return {
    from: props.from ?? known?.from ?? '',
    to: props.to ?? known?.to ?? '',
    km: props.lengthKm ?? known?.km ?? 0,
  };
});

const endText = computed(() =>
  [meta.value.from, meta.value.to].filter(Boolean).join(' · '),
);
</script>

<template>
  <svg class="must-drive" viewBox="0 0 120 150" role="img" aria-label="此生必驾">
    <defs>
      <linearGradient id="mdBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#201c10" />
        <stop offset="1" stop-color="#0e0c07" />
      </linearGradient>
    </defs>

    <!-- 盾牌 -->
    <path
      d="M15 6 H105 Q114 6 114 15 V103 L60 142 L6 103 V15 Q6 6 15 6 Z"
      fill="url(#mdBody)"
      stroke="#f7c325"
      stroke-width="3.2"
      stroke-linejoin="round"
    />

    <!-- 大编号 -->
    <text x="48" y="42" text-anchor="middle" class="md-num">{{ number }}</text>
    <!-- 竖排 ROUTE -->
    <text x="92" y="18" class="md-route">
      <tspan x="92" dy="0">R</tspan><tspan x="92" dy="8.2">O</tspan><tspan x="92" dy="8.2">U</tspan>
      <tspan x="92" dy="8.2">T</tspan><tspan x="92" dy="8.2">E</tspan>
    </text>

    <line x1="18" y1="52" x2="102" y2="52" stroke="#f7c325" stroke-width="1.4" opacity="0.85" />
    <text x="60" y="61" text-anchor="middle" class="md-en">MUST GO IN YOUR LIFE</text>

    <!-- 此生必驾 2×2 -->
    <text x="38" y="88" text-anchor="middle" class="md-han">此</text>
    <text x="82" y="88" text-anchor="middle" class="md-han">生</text>
    <text x="38" y="114" text-anchor="middle" class="md-han">必</text>
    <text x="82" y="114" text-anchor="middle" class="md-han">驾</text>

    <text v-if="endText" x="60" y="128" text-anchor="middle" class="md-meta">{{ endText }}</text>
    <text v-if="meta.km" x="60" y="137" text-anchor="middle" class="md-km">{{ meta.km.toLocaleString() }} KM</text>
  </svg>
</template>

<style scoped>
.must-drive { display: block; width: 100%; height: 100%; overflow: visible; }
.md-num { font-family: 'Arial Black', 'Arial', sans-serif; font-weight: 900; font-size: 34px; fill: #f7c325; letter-spacing: -1px; }
.md-route { font-family: Arial, sans-serif; font-weight: 800; font-size: 8.5px; fill: #f7c325; }
.md-en { font-family: Arial, sans-serif; font-weight: 700; font-size: 6.6px; fill: #f7c325; letter-spacing: 0.4px; }
.md-han { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; font-weight: 900; font-size: 23px; fill: #f7c325; }
.md-meta { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 7px; fill: rgba(247,195,37,0.85); }
.md-km { font-family: Arial, sans-serif; font-weight: 800; font-size: 8px; fill: #f7c325; letter-spacing: 0.6px; }
</style>
