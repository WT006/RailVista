<script setup lang="ts">
/**
 * 公路沿程景点卡片（自驾视角）。
 *
 * 与铁路 SpotApproachCard 的信息密度对齐，但把「看」换成「到」——
 * 自驾能停下来、能绕路，卡片必须回答三件事：
 *   1. 它在行进方向的**哪一侧**（RoadSideBadge，方向实时算，不落库）
 *   2. **怎么到**：顺路就停 / 绕几公里 / 值得专程跑一趟（detourClass）
 *   3. **到了怎么办**：开放时间 / 票务提示 / 到达方式
 *
 * 内容红线：票价不写金额（ticketNote 由数据层保证），里程标注估算口径。
 * 没有可信来源的字段一律不显示，不用占位符编造。
 */
import { computed } from 'vue';
import type { AlongSpot } from '@railvista/shared';
import { driveTierColor } from '../../data/roadColors';
import { spotCategoryLabel } from '../../data/roadSpotLabels';
import RoadSideBadge from './RoadSideBadge.vue';

const props = withDefaults(
  defineProps<{
    spot: AlongSpot;
    expanded?: boolean;
    /** 距路线距离的小数位（列表 1 位，详情 2 位） */
    compactDistance?: boolean;
  }>(),
  { expanded: false, compactDistance: false },
);

defineEmits<{ (e: 'toggle', spot: AlongSpot): void }>();

const TIER_LABEL: Record<string, string> = { A: '讲解级', B: '沿途可看', C: '小确幸' };

/** 顺路 / 绕行 / 专程：自驾最关心的三档，直接给结论而不是只给距离 */
const DETOUR_CLASS_META: Record<string, { label: string; hint: string }> = {
  pass: { label: '顺路即停', hint: '路线经过或就在路边' },
  detour: { label: '短绕可达', hint: '绕几公里，20 分钟内能打个来回' },
  spur: { label: '专程绕行', hint: '超出常规沿程范围，需单独安排' },
};

const s = computed(() => props.spot);
const cls = computed(() => DETOUR_CLASS_META[s.value.detourClass ?? 'detour'] ?? DETOUR_CLASS_META.detour!);

const distText = computed(() =>
  (props.compactDistance ? s.value.distKm.toFixed(1) : s.value.distKm.toFixed(2)) + ' km',
);

/** 绕行耗时：按 30km/h 的绕行速度估，向上取整到 4 分钟，最少 4 分钟 */
const detourText = computed(() => {
  // 专程绕行档优先：这时说「远景可见 · 不引导绕行」会和下面的专程理由自相矛盾
  if (s.value.detourClass === 'spur') {
    return s.value.roadDistKm != null && s.value.roadDistKm > 12
      ? `需专程绕行 · 距最近干线 ${s.value.roadDistKm} km`
      : '超出常规沿程范围 · 值得专程绕行';
  }
  if (s.value.visibility === 'distant') return '远景可见 · 不引导绕行';
  if (s.value.detourKm <= 0) return '就在路边，可停车即看';
  const min = Math.max(4, Math.round((s.value.detourKm / 30) * 60 / 4) * 4);
  return `绕行 ${s.value.detourKm} 公里 · 约 ${min} 分钟`;
});

/** 建议停留：路书的「游玩小时数」换算成分钟，≥90 分钟改用小时表述（180 分钟不如「约 3 小时」） */
const stayText = computed(() => {
  const m = s.value.stayMin;
  if (!m || m <= 0) return '';
  return m >= 90 ? `约 ${Math.round(m / 60)} 小时` : `约 ${m} 分钟`;
});

const tierColor = computed(() => driveTierColor(s.value.tier));

const categoryLabel = computed(() => spotCategoryLabel(s.value.category));

/** 展示标签：数据层已合并分类/资质/keytag，这里只做去重截断 */
const tags = computed(() => (s.value.tags ?? []).filter(Boolean).slice(0, 4));
const honors = computed(() => (s.value.honors ?? []).filter(Boolean).slice(0, 3));

const ratingText = computed(() => {
  const r = s.value.rating;
  return typeof r === 'number' && r > 0 ? r.toFixed(1) : '';
});

const ratingTitle = computed(() => {
  const src = s.value.ratingSource;
  return src === 'amap' ? '高德地图用户评分（5 分制）' : '第三方平台评分（5 分制）';
});

/** 一句话卖点 > 简介：列表里先给最有信息量的一句 */
const headline = computed(() => s.value.tagline || s.value.intro || '');

const hasDetail = computed(
  () =>
    !!(s.value.visitHours || s.value.ticketNote || s.value.accessNote || s.value.spurReason || s.value.address),
);
</script>

<template>
  <article
    class="road-spot"
    :class="{ 'is-expanded': expanded, 'is-spur': spot.detourClass === 'spur' }"
    :style="{ '--spot-color': tierColor }"
    @click="$emit('toggle', spot)"
  >
    <div class="road-spot__head">
      <span class="road-spot__km">K{{ Math.round(spot.progressKm) }}</span>
      <img
        v-if="spot.photoUrl"
        class="road-spot__photo"
        :src="spot.photoUrl"
        :alt="spot.name"
        loading="lazy"
        decoding="async"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <span class="road-spot__name">{{ spot.name }}</span>
      <span v-if="ratingText" class="road-spot__rating" :title="ratingTitle">
        <b>{{ ratingText }}</b><i>分</i>
      </span>
      <span class="road-spot__tier" :class="'is-' + spot.tier">{{ TIER_LABEL[spot.tier] ?? spot.tier }}</span>
    </div>

    <div class="road-spot__meta">
      <!--
        紧凑模式：列表行内空间有限，用短文案（左侧/右侧/路上/待定），
        完整判据（距路多少公里、是否外推）留在 title 里，悬停可看。
        非紧凑时那行「仅供参考」提示会把卡片挤成两行，实测过。
      -->
      <RoadSideBadge :side="spot.side" :dist-km="spot.distKm" :low="spot.sideConfidence === 'low'" compact />
      <span class="road-spot__cat">{{ categoryLabel }}</span>
      <span class="road-spot__dist">距路线 {{ distText }}</span>
      <span
        class="road-spot__class"
        :class="'is-' + (spot.detourClass ?? 'detour')"
        :title="cls.hint"
      >{{ cls.label }}</span>
    </div>

    <div class="road-spot__detour" :class="{ 'is-distant': spot.visibility === 'distant' }">
      {{ detourText }}
      <template v-if="stayText"> · 建议停留 {{ stayText }}</template>
    </div>

    <p v-if="headline && !expanded" class="road-spot__headline">{{ headline }}</p>

    <Transition name="road-spot-expand">
      <div v-if="expanded" class="road-spot__expand">
        <div class="road-spot__expand-inner">
          <p v-if="spot.tagline" class="road-spot__tagline">{{ spot.tagline }}</p>
          <p v-if="spot.intro" class="road-spot__intro">{{ spot.intro }}</p>

          <dl v-if="hasDetail" class="road-spot__facts">
            <div v-if="spot.visitHours" class="road-spot__fact">
              <dt>开放时间</dt>
              <dd>{{ spot.visitHours }}</dd>
            </div>
            <div v-if="spot.ticketNote" class="road-spot__fact">
              <dt>票务</dt>
              <dd>{{ spot.ticketNote }}</dd>
            </div>
            <div v-if="spot.accessNote" class="road-spot__fact">
              <dt>到达方式</dt>
              <dd>{{ spot.accessNote }}</dd>
            </div>
            <div v-if="spot.roadRefs?.length" class="road-spot__fact">
              <dt>最近干线</dt>
              <dd>
                {{ spot.roadRefs.join(' / ') }}
                <template v-if="spot.roadDistKm != null">（直线 {{ spot.roadDistKm }} km）</template>
              </dd>
            </div>
            <div v-if="spot.address" class="road-spot__fact">
              <dt>位置</dt>
              <dd>{{ spot.address }}</dd>
            </div>
          </dl>

          <p v-if="spot.spurReason" class="road-spot__spur">{{ spot.spurReason }}</p>

          <div v-if="honors.length || tags.length" class="road-spot__chips">
            <span v-for="h in honors" :key="'h-' + h" class="road-spot__chip is-honor">{{ h }}</span>
            <span v-for="t in tags" :key="'t-' + t" class="road-spot__chip">{{ t }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </article>
</template>

<style scoped>
.road-spot {
  --spot-color: var(--accent);
  position: relative;
  /*
   * min-width: 0 —— 必写。列表容器 .drive-flow-list 是 display:grid，
   * 网格项默认 min-width:auto，卡片会被内部不可压缩的内容顶到比容器宽
   * （实测容器 307px / 卡片 393px），父级 overflow-x:auto 直接把简介横着裁断。
   * 全局 base.css 也没设 box-sizing，这里显式声明避免 padding 叠加到宽度上。
   */
  min-width: 0;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-hairline);
  border-left: 3px solid var(--spot-color);
  background: var(--surface);
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard);
}

.road-spot:hover {
  background: var(--surface-raised);
  transform: translateX(2px);
}

.road-spot.is-expanded {
  background: var(--surface-raised);
  border-color: var(--spot-color);
}

/* 专程绕行：用虚线左边条与顺路档区分，避免被当成普通沿途景点 */
.road-spot.is-spur {
  border-left-style: dashed;
}

.road-spot__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.road-spot__km {
  flex: none;
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-micro);
  font-weight: 700;
  color: var(--spot-color);
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--spot-color) 14%, transparent);
}

.road-spot__photo {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  background: var(--surface-sunken);
}

.road-spot__name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--fs-body);
  font-weight: 650;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.road-spot__rating {
  flex: none;
  display: inline-flex;
  align-items: baseline;
  gap: 1px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.road-spot__rating b {
  font-size: var(--fs-body);
  font-weight: 800;
}

.road-spot__rating i {
  font-size: 10px;
  font-style: normal;
  opacity: 0.75;
}

.road-spot__tier {
  flex: none;
  font-size: 10px;
  font-weight: 650;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  border: 1px solid var(--line-hairline);
  color: var(--text-3);
}

.road-spot__tier.is-A {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
}

.road-spot__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
  font-size: var(--fs-micro);
  color: var(--text-3);
}

.road-spot__dist {
  font-variant-numeric: tabular-nums;
}

.road-spot__class {
  padding: 1px 7px;
  border-radius: var(--radius-full);
  font-weight: 650;
  border: 1px solid var(--line-hairline);
}

.road-spot__class.is-pass {
  color: var(--info);
  background: var(--success-soft);
  border-color: color-mix(in srgb, var(--info) 40%, transparent);
}

.road-spot__class.is-detour {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}

.road-spot__class.is-spur {
  color: var(--text-3);
  border-style: dashed;
}

.road-spot__detour {
  margin-top: 5px;
  font-size: var(--fs-micro);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.road-spot__detour.is-distant {
  color: var(--text-3);
}

.road-spot__headline {
  margin: 5px 0 0;
  font-size: var(--fs-micro);
  color: var(--text-3);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.road-spot__expand {
  overflow: hidden;
}

.road-spot__expand-inner {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--line-hairline);
}

.road-spot__tagline {
  margin: 0 0 4px;
  font-size: var(--fs-micro);
  font-weight: 650;
  color: var(--text-1);
  line-height: 1.55;
}

.road-spot__intro {
  margin: 0;
  font-size: var(--fs-micro);
  color: var(--text-2);
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.road-spot__facts {
  margin: 8px 0 0;
  display: grid;
  gap: 4px;
}

/* grid/flex 子项默认 min-width:auto，长的不可断串（路网编号、坐标数字）
   会把整行顶宽；显式归零让文本按容器换行 */
.road-spot__fact {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  font-size: var(--fs-micro);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.road-spot__fact dt {
  color: var(--text-3);
}

.road-spot__fact dd {
  margin: 0;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.road-spot__spur {
  margin: 8px 0 0;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--text-2);
  font-size: var(--fs-micro);
  line-height: 1.55;
}

.road-spot__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}

.road-spot__chip {
  padding: 1px 7px;
  border-radius: var(--radius-full);
  font-size: 10px;
  color: var(--text-3);
  background: var(--surface-sunken);
  border: 1px solid var(--line-hairline);
}

.road-spot__chip.is-honor {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  background: var(--accent-soft);
}

.road-spot-expand-enter-active,
.road-spot-expand-leave-active {
  transition:
    height var(--dur-base) var(--ease-standard),
    opacity var(--dur-base) var(--ease-standard);
}

@media (prefers-reduced-motion: reduce) {
  .road-spot-expand-enter-active,
  .road-spot-expand-leave-active {
    transition: none;
  }
}

.road-spot-expand-enter-from,
.road-spot-expand-leave-to {
  opacity: 0;
}
</style>
