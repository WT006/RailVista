<script setup lang="ts">
/**
 * 下车站玩法通告：列车抵达本次行程要下车的车站时，推荐该站所在地在路书库里的玩法。
 * 顶部通告位与临近景点、过站美食共用（景点 > 玩法 > 美食，让位规则见 TripMap）。
 * 终到是「到此为止」的终态，所以默认常驻，不自动收起，只接受手动关闭。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { TRAVEL_SHAPE_LABEL, type TravelRouteSummary } from '@railvista/shared';
import type { PlaceGuides } from '../lib/placeGuides';

const props = withDefaults(
  defineProps<{
    /** 站名，作为「一站一弹」的去重键 */
    station: string;
    /** 当地玩法查询结果；null 表示还没查到或该地确实没有 */
    guide: PlaceGuides | null;
    kicker?: string;
    compact?: boolean;
    /** true = 不自动收起（下车站用），用户关掉后本站不再弹 */
    persistent?: boolean;
    /** true = 屏幕上还有别的东西要位置（如完成引导条）：只留 2 条、简介收 1 行 */
    dense?: boolean;
    /** 非空则在卡底渲染这个主操作（下车了：玩什么 + 留票根，一张卡说完） */
    actionLabel?: string;
  }>(),
  { kicker: '当地玩法', compact: false, persistent: false, dense: false, actionLabel: '' },
);

const emit = defineEmits<{ action: [] }>();

const open = ref(false);
const silenced = ref<string | null>(null);
let hideTimer: ReturnType<typeof setTimeout> | undefined;

const AUTO_HIDE_MS = 12_000;
/** 常规 3 条；窄屏 2 条；终态（卡里还要放「生成纪念票」）1 条 —— 剩下的一律交给「查看全部」 */
const MAX_ROUTES_WIDE = 3;
const MAX_ROUTES_COMPACT = 2;
const MAX_ROUTES_DENSE = 1;

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
}

function dismiss() {
  silenced.value = props.station;
  open.value = false;
  clearHideTimer();
}

watch(
  () => props.station,
  (name, prev) => {
    clearHideTimer();
    if (!name || !props.guide?.routes.length) {
      open.value = false;
      return;
    }
    if (prev && name !== prev) silenced.value = null;
    if (name === silenced.value) {
      open.value = false;
      return;
    }
    open.value = true;
    if (props.persistent) return;
    hideTimer = setTimeout(() => {
      silenced.value = name;
      open.value = false;
    }, AUTO_HIDE_MS);
  },
  { immediate: true },
);

onBeforeUnmount(clearHideTimer);

const routes = computed(() => {
  const cap = props.dense ? MAX_ROUTES_DENSE : props.compact ? MAX_ROUTES_COMPACT : MAX_ROUTES_WIDE;
  return props.guide?.routes.slice(0, cap) ?? [];
});
const city = computed(() => props.guide?.place.city ?? '');

/** 站名与市名同源时不重复播报（拉萨站 · 拉萨 这种） */
const title = computed(() => {
  const name = props.station.replace(/站$/, '');
  const place = city.value;
  if (!place || name.includes(place) || place.includes(name)) return props.station;
  return `${props.station} · ${place}`;
});

/** 命中层级决定说法：市名精确命中才叫「当地」，同省兜底不能冒充当地攻略 */
const scopeNote = computed(() => {
  const g = props.guide;
  if (!g) return '';
  if (g.level === 'city') return `${g.place.city} · 路书库`;
  if (g.level === 'keyword') return `涉及${g.place.city}的线路`;
  return `${g.place.province} · 路书库精选`;
});

function metaText(r: PlaceGuides['routes'][number]): string {
  const parts = [
    TRAVEL_SHAPE_LABEL[r.shape] ?? '',
    r.totalKm ? `${Math.round(r.totalKm)} km` : '',
    r.days ? `${r.days} 天` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

const show = computed(
  () => open.value && Boolean(props.station) && routes.value.length > 0,
);

/** TripMap 据此决定这一格是否已被占用（与景点/美食卡同一套让位协议） */
defineExpose({ visible: show });
</script>

<template>
  <Teleport to="body">
    <Transition name="guide-toast">
      <aside
        v-if="show"
        class="guide-toast"
        :class="{ 'guide-toast--compact': compact, 'guide-toast--dense': dense }"
        role="region"
        aria-live="polite"
        :aria-label="`${station} 当地旅行攻略推荐`"
      >
        <header class="guide-toast__head">
          <span class="guide-toast__kicker">{{ kicker }}</span>
          <span class="guide-toast__scope">{{ scopeNote }}</span>
          <button type="button" class="guide-toast__close rv-hit" aria-label="关闭攻略推荐" @click="dismiss">
            ×
          </button>
        </header>
        <h3 class="guide-toast__title">{{ title }}</h3>
        <ul class="guide-toast__list">
          <li v-for="r in routes" :key="r.id" class="guide-toast__item">
            <RouterLink class="guide-toast__link" :to="`/roadbook/${r.id}`">
              <span class="guide-toast__name">{{ r.name }}</span>
              <span class="guide-toast__meta">{{ metaText(r) }}</span>
              <span class="guide-toast__summary">{{ r.summary }}</span>
              <span class="guide-toast__go">看攻略</span>
            </RouterLink>
          </li>
        </ul>
        <!-- 卡片只放得下 2~3 条，剩下的交给列表页（用 q 而不是 city：市名口径两边不一致） -->
        <footer class="guide-toast__foot">
          <RouterLink class="guide-toast__more" :to="{ path: '/roadbook', query: { q: city } }">
            查看全部「{{ city }}」玩法
          </RouterLink>
          <!-- 下车时「玩什么」和「留票根」是同一件事：合在本卡里，短屏就不必两张卡抢位置 -->
          <button
            v-if="actionLabel"
            type="button"
            class="btn primary guide-toast__action"
            @click="emit('action')"
          >
            {{ actionLabel }}
          </button>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.guide-toast {
  position: fixed;
  top: calc(var(--top-overlay, 88px) + 10px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 128;
  width: min(420px, calc(100vw - 28px - var(--sidenav-w, 0px)));
  padding: 12px 14px 13px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--surface-1) 94%, transparent);
  border: 1px solid var(--line-default);
  border-top: 2px solid var(--accent);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  box-shadow: var(--elev-3);
  color: var(--text-2);
  /* 顶部通告位与底栏（含完成引导条）之间的实测空档，短屏时卡内滚动而不是压到底栏 */
  max-height: calc(100vh - var(--top-overlay, 88px) - var(--bottom-overlay, 168px) - 96px);
  overflow-y: auto;
}

.guide-toast--compact {
  padding: 10px 12px 11px;
  width: min(340px, calc(100vw - 20px));
}

/* 窄屏 / 完成条同屏时：简介收成一行，整卡高度不超过通告位与底栏之间的空档 */
.guide-toast--compact .guide-toast__summary,
.guide-toast--dense .guide-toast__summary {
  -webkit-line-clamp: 1;
  line-clamp: 1;
}

.guide-toast__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.guide-toast__kicker {
  flex: none;
  font-size: var(--fs-micro);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--accent-hover);
}

.guide-toast__scope {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--fs-micro);
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.guide-toast__close {
  flex: none;
  width: 28px;
  height: 28px;
  margin: -4px -4px -4px auto;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-3);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.guide-toast__close:hover {
  color: var(--text-1);
  background: var(--fill-subtle);
}

.guide-toast__title {
  margin: 0 0 8px;
  font-size: var(--fs-h2);
  font-weight: 700;
  line-height: var(--lh-tight);
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.guide-toast__list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.guide-toast__item {
  min-width: 0;
}

.guide-toast__link {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 4px 8px;
  min-height: var(--hit-min);
  padding: 7px 9px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--surface-2) 70%, transparent);
  border: 1px solid var(--line-hairline);
  text-decoration: none;
  transition:
    background var(--dur-micro) var(--ease-standard),
    border-color var(--dur-micro) var(--ease-standard);
}

.guide-toast__link:hover {
  background: color-mix(in srgb, var(--surface-3) 80%, transparent);
  border-color: var(--line-accent);
}

.guide-toast__link:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.guide-toast__name {
  grid-column: 1;
  min-width: 0;
  font-size: var(--fs-meta);
  font-weight: 650;
  line-height: 1.35;
  color: var(--text-1);
}

.guide-toast__meta {
  grid-column: 2;
  grid-row: 1;
  flex: none;
  font-size: var(--fs-micro);
  color: var(--accent-hover);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.guide-toast__summary {
  grid-column: 1 / 3;
  min-width: 0;
  font-size: var(--fs-cap);
  line-height: 1.35;
  color: var(--text-3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.guide-toast__go {
  position: absolute;
  right: 9px;
  bottom: 7px;
  font-size: var(--fs-micro);
  color: var(--accent);
  opacity: 0;
  transition: opacity var(--dur-micro) var(--ease-standard);
}

.guide-toast__link:hover .guide-toast__go,
.guide-toast__link:focus-visible .guide-toast__go {
  opacity: 1;
}

.guide-toast__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--line-hairline);
}

.guide-toast__more {
  display: flex;
  align-items: center;
  min-height: var(--hit-min);
  min-width: 0;
  font-size: var(--fs-cap);
  color: var(--accent);
  text-decoration: none;
}

.guide-toast__action {
  flex: none;
  min-height: var(--hit-min);
  padding: 0 var(--space-3);
  font-size: var(--fs-meta);
}

.guide-toast__more:hover {
  color: var(--accent-hover);
  text-decoration: underline;
}

.guide-toast__more:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--radius-xs);
}

/* 手机横屏矮视口：地图可视高度本就紧张，只留两条、收起简介，热区仍保持 44 */
@media (orientation: landscape) and (max-height: 560px) {
  .guide-toast {
    width: min(360px, calc(100vw - 24px));
    padding: 8px 10px 9px;
  }

  .guide-toast__summary {
    display: none;
  }

  .guide-toast__item:nth-child(n + 3) {
    display: none;
  }

  .guide-toast__list {
    gap: 4px;
  }

  .guide-toast__link {
    padding: 5px 8px;
  }
}

.guide-toast-enter-active,
.guide-toast-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard);
}

@media (prefers-reduced-motion: reduce) {
  .guide-toast-enter-active,
  .guide-toast-leave-active {
    transition: none;
  }
}

.guide-toast-enter-from,
.guide-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
</style>
