<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useGlobalSearch, type SearchItem } from '../composables/useGlobalSearch';

const gs = useGlobalSearch();
const router = useRouter();

const inputEl = ref<HTMLInputElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const activeIndex = ref(-1);

interface Group {
  key: string;
  label: string;
  items: SearchItem[];
}

const groups = computed<Group[]>(() => {
  const r = gs.result.value;
  if (!r) return [];
  const g: Group[] = [];
  if (r.trains.length) g.push({ key: 'train', label: '车次', items: r.trains.map((hit) => ({ kind: 'train', hit })) });
  if (r.corridors.length) g.push({ key: 'corridor', label: '铁路线', items: r.corridors.map((hit) => ({ kind: 'corridor', hit })) });
  if (r.roads.length) g.push({ key: 'road', label: '编号公路', items: r.roads.map((hit) => ({ kind: 'road', hit })) });
  if (r.spots.length) g.push({ key: 'spot', label: '景点', items: r.spots.map((hit) => ({ kind: 'spot', hit })) });
  if (r.roadbooks.length) g.push({ key: 'roadbook', label: '路书', items: r.roadbooks.map((hit) => ({ kind: 'roadbook', hit })) });
  return g;
});

const hasQuery = computed(() => (gs.query.value ?? '').trim().length > 0);

// ── 键盘导航：结果变化 / 输入变化时重置高亮 ──
watch(() => gs.flatItems.value, () => {
  activeIndex.value = gs.flatItems.value.length ? 0 : -1;
});
watch(() => gs.query.value, () => {
  activeIndex.value = 0;
});

// 打开时聚焦输入框 + 锁背景滚动；关闭时解锁
watch(
  () => gs.isOpen.value,
  (open) => {
    if (open) {
      activeIndex.value = -1;
      document.body.style.overflow = 'hidden';
      void nextTick(() => inputEl.value?.focus());
    } else {
      document.body.style.overflow = '';
    }
  },
);

function scrollActiveIntoView(): void {
  void nextTick(() => {
    const el = listEl.value?.querySelector('.gs-item.is-active');
    el?.scrollIntoView({ block: 'nearest' });
  });
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    gs.close();
    return;
  }
  const items = gs.flatItems.value;
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % items.length;
    scrollActiveIntoView();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + items.length) % items.length;
    scrollActiveIntoView();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = items[activeIndex.value];
    if (item) navigate(item);
  }
}

// ── 跳转目标：把「点」串回「线」与「书」 ──
function navigate(item: SearchItem): void {
  if (item.kind === 'train') {
    void router.push({ path: '/', query: { code: item.hit.code } });
  } else if (item.kind === 'corridor') {
    void router.push(`/route/${encodeURIComponent(item.hit.id)}`);
  } else if (item.kind === 'road') {
    void router.push(`/drive/trip?road=${encodeURIComponent(item.hit.key)}`);
  } else if (item.kind === 'roadbook') {
    void router.push(`/roadbook/${encodeURIComponent(item.hit.id)}`);
  } else if (item.kind === 'spot') {
    const s = item.hit;
    if (s.corridorIds.length) void router.push(`/route/${encodeURIComponent(s.corridorIds[0]!)}`);
    else if (s.roadbookIds.length) void router.push(`/roadbook/${encodeURIComponent(s.roadbookIds[0]!)}`);
    else void router.push('/atlas');
  }
  gs.close();
}

// ── 关键词高亮（安全：先转义再包裹 <mark>） ──
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function highlightHtml(text: string | undefined): string {
  if (!text) return '';
  const q = (gs.query.value ?? '').trim();
  if (!q) return escapeHtml(text);
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let out = '';
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) {
      out += escapeHtml(text.slice(i));
      break;
    }
    out += escapeHtml(text.slice(i, idx));
    out += `<mark>${escapeHtml(text.slice(idx, idx + q.length))}</mark>`;
    i = idx + q.length;
  }
  return out;
}

const TIER_LABEL: Record<string, string> = {
  national: '全国',
  regional: '区域',
  city: '城市',
};
function tierLabel(t: string): string {
  return TIER_LABEL[t] ?? t;
}

const KIND_LABEL: Record<string, string> = {
  hsr: '高速',
  intercity: '城际',
  conventional: '普速',
  other: '其他',
};

function flatIndex(groupIdx: number, itemIdxInGroup: number): number {
  let acc = 0;
  for (let g = 0; g < groupIdx; g += 1) acc += groups.value[g]?.items.length ?? 0;
  return acc + itemIdxInGroup;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="gs">
      <div v-if="gs.isOpen.value" class="gs-root" @keydown="onKeydown">
        <div class="gs-scrim" @click="gs.close()" />
        <div class="gs-panel" role="dialog" aria-modal="true" aria-label="全局搜索">
          <div class="gs-inputbar">
            <svg class="gs-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
            <input
              ref="inputEl"
              v-model="gs.query.value"
              class="gs-input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="搜索车次、铁路线、公路、景点、路书…"
              @input="(e) => gs.onInput((e.target as HTMLInputElement).value)"
            />
            <span v-if="gs.loading.value" class="gs-spinner" aria-label="搜索中" />
            <button v-else-if="gs.query.value" type="button" class="gs-clear" aria-label="清空" @click="gs.onInput('')">✕</button>
            <kbd class="gs-kbd">Esc</kbd>
          </div>

          <div ref="listEl" class="gs-list">
            <!-- 初始态：输入前给热门提示 -->
            <div v-if="!hasQuery" class="gs-empty">
              <div class="gs-empty-title">从这里出发，一步直达任意内容</div>
              <div class="gs-empty-hints">
                <span>车次号</span><em>G87 · Z8991 · 1461</em>
                <span>铁路线</span><em>宝成线 · 京张高铁</em>
                <span>公路</span><em>G318 · 独库公路</em>
                <span>景点</span><em>雪山 · 油菜 · 故宫</em>
                <span>路书</span><em>川藏线 · 环青海湖</em>
              </div>
            </div>

            <!-- 空结果 -->
            <div v-else-if="!gs.loading.value && !gs.error.value && gs.result.value && !gs.flatItems.value.length" class="gs-empty">
              <div class="gs-empty-title">没有找到「{{ gs.query.value }}」</div>
              <div class="gs-empty-sub">换个关键词试试，比如车次号、线路名、景点名或「雪山」「油菜」这类玩法词。</div>
            </div>

            <!-- 错误 -->
            <div v-else-if="gs.error.value" class="gs-empty">
              <div class="gs-empty-title">搜索出了点问题</div>
              <div class="gs-empty-sub">{{ gs.error.value }}</div>
            </div>

            <!-- 结果分组 -->
            <template v-for="(group, gi) in groups" :key="group.key">
              <div class="gs-group-label">{{ group.label }}<span class="gs-group-count">{{ group.items.length }}</span></div>
              <template v-for="(item, ii) in group.items" :key="`${group.key}-${item.kind}-${ii}`">
                <button
                  type="button"
                  class="gs-item"
                  :class="{ 'is-active': flatIndex(gi, ii) === activeIndex }"
                  @click="navigate(item)"
                  @mousemove="activeIndex = flatIndex(gi, ii)"
                >
                  <!-- 车次 -->
                  <template v-if="item.kind === 'train'">
                    <span class="gs-kind gs-kind--train">{{ item.hit.code.charAt(0) }}</span>
                    <span class="gs-main" v-html="highlightHtml(item.hit.code)" />
                    <span class="gs-meta">{{ KIND_LABEL[item.hit.kind] }}列车</span>
                    <span class="gs-enter">查询时刻 ›</span>
                  </template>

                  <!-- 铁路线 -->
                  <template v-else-if="item.kind === 'corridor'">
                    <span class="gs-kind gs-kind--rail">线</span>
                    <span class="gs-main" v-html="highlightHtml(item.hit.name)" />
                    <span v-if="item.hit.alias.length" class="gs-meta">{{ item.hit.alias.slice(0, 2).join(' · ') }}</span>
                    <span class="gs-meta gs-meta--dim">{{ item.hit.spotCount }} 景点</span>
                    <span class="gs-enter">›</span>
                  </template>

                  <!-- 编号公路 -->
                  <template v-else-if="item.kind === 'road'">
                    <span class="gs-kind gs-kind--road">{{ item.hit.ref.charAt(0) }}</span>
                    <span class="gs-main gs-main--mono" v-html="highlightHtml(item.hit.ref)" />
                    <span v-if="item.hit.name" class="gs-meta" v-html="highlightHtml(item.hit.name)" />
                    <span class="gs-meta gs-meta--dim">{{ item.hit.from }} → {{ item.hit.to }} · {{ Math.round(item.hit.lengthKm) }}km</span>
                    <span class="gs-enter">›</span>
                  </template>

                  <!-- 景点 -->
                  <template v-else-if="item.kind === 'spot'">
                    <span class="gs-kind" :class="item.hit.origin === 'rail' ? 'gs-kind--rail' : 'gs-kind--road'">{{ item.hit.origin === 'rail' ? '铁' : '公' }}</span>
                    <div class="gs-spot-main">
                      <div class="gs-main-line">
                        <span class="gs-main" v-html="highlightHtml(item.hit.name)" />
                        <span v-if="item.hit.province" class="gs-meta gs-meta--dim">{{ item.hit.province }}{{ item.hit.city ? '·' + item.hit.city : '' }}</span>
                      </div>
                      <div v-if="item.hit.dimensions.length || item.hit.tags.length" class="gs-chips">
                        <span v-for="d in item.hit.dimensions.slice(0, 3)" :key="d" class="gs-chip">{{ d }}</span>
                        <span v-for="t in item.hit.tags.slice(0, 3)" :key="t" class="gs-chip gs-chip--tag">{{ t }}</span>
                      </div>
                      <div v-if="item.hit.corridorNames.length || item.hit.roadbookNames.length" class="gs-chips gs-chips--rel">
                        <span v-for="c in item.hit.corridorNames.slice(0, 3)" :key="'c' + c" class="gs-rel">🚄 {{ c }}</span>
                        <span v-for="r in item.hit.roadbookNames.slice(0, 3)" :key="'r' + r" class="gs-rel">📖 {{ r }}</span>
                      </div>
                    </div>
                    <span class="gs-enter">›</span>
                  </template>

                  <!-- 路书 -->
                  <template v-else-if="item.kind === 'roadbook'">
                    <span class="gs-kind gs-kind--book">书</span>
                    <div class="gs-spot-main">
                      <div class="gs-main-line">
                        <span class="gs-main" v-html="highlightHtml(item.hit.name)" />
                        <span class="gs-meta gs-meta--dim">{{ tierLabel(item.hit.tier) }}</span>
                      </div>
                      <div class="gs-chips">
                        <span v-if="item.hit.days" class="gs-chip">{{ item.hit.days }} 天</span>
                        <span v-if="item.hit.totalKm" class="gs-chip">{{ Math.round(item.hit.totalKm) }}km</span>
                        <span v-for="r in item.hit.roadRefs.slice(0, 3)" :key="r" class="gs-chip gs-chip--tag">{{ r }}</span>
                      </div>
                    </div>
                    <span class="gs-enter">›</span>
                  </template>
                </button>
              </template>
            </template>
          </div>

          <div class="gs-footer">
            <span class="gs-foot"><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span class="gs-foot"><kbd>↵</kbd> 打开</span>
            <span class="gs-foot"><kbd>Esc</kbd> 关闭</span>
            <span v-if="gs.result.value" class="gs-foot gs-foot--dim">{{ gs.result.value.total }} 条结果 · {{ gs.result.value.tookMs }}ms</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.gs-root {
  position: fixed;
  inset: 0;
  z-index: 9999;
}
.gs-scrim {
  position: absolute;
  inset: 0;
  background: var(--surface-scrim);
  backdrop-filter: blur(4px);
}
.gs-panel {
  position: absolute;
  left: 50%;
  top: 12vh;
  transform: translateX(-50%);
  width: min(680px, calc(100vw - 32px));
  max-height: min(76vh, 720px);
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border: 1px solid var(--line-strong);
  border-radius: 20px;
  box-shadow: 0 24px 80px -12px rgba(0, 0, 0, 0.6), var(--focus-ring);
  overflow: hidden;
}

.gs-inputbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--line-hairline);
}
.gs-icon {
  color: var(--text-3);
  flex: none;
}
.gs-input {
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-1);
  font-size: var(--fs-input);
  font-family: var(--font-sans);
}
.gs-input::placeholder {
  color: var(--text-3);
}
.gs-clear {
  flex: none;
  border: 0;
  background: var(--fill-subtle);
  color: var(--text-2);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.gs-clear:hover {
  background: var(--interactive-hover);
  color: var(--text-1);
}
.gs-kbd {
  flex: none;
  font-family: var(--font-sans);
  font-size: 11px;
  color: var(--text-3);
  border: 1px solid var(--line-default);
  border-radius: 6px;
  padding: 2px 6px;
  background: var(--fill-subtle);
}
.gs-spinner {
  width: 16px;
  height: 16px;
  flex: none;
  border: 2px solid var(--line-default);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: gs-spin 0.7s linear infinite;
}
@keyframes gs-spin {
  to { transform: rotate(360deg); }
}

.gs-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  min-height: 120px;
}

.gs-empty {
  padding: 32px 24px;
  text-align: center;
}
.gs-empty-title {
  color: var(--text-1);
  font-size: var(--fs-h3);
  margin-bottom: 8px;
}
.gs-empty-sub {
  color: var(--text-3);
  font-size: 13px;
}
.gs-empty-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  justify-content: center;
  margin-top: 18px;
  color: var(--text-3);
  font-size: 13px;
}
.gs-empty-hints span {
  color: var(--text-2);
}
.gs-empty-hints em {
  font-style: normal;
  color: var(--text-3);
}

.gs-group-label {
  padding: 10px 12px 5px;
  font-size: var(--fs-eyebrow);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: 8px;
}
.gs-group-count {
  color: var(--text-3);
  opacity: 0.7;
}

.gs-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
  font-size: var(--fs-body);
}
.gs-item.is-active {
  background: var(--surface-3);
}
.gs-item:hover {
  background: var(--interactive-hover);
}

.gs-kind {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
}
.gs-kind--train {
  background: rgba(116, 189, 137, 0.18);
  color: #74bd89;
}
.gs-kind--rail {
  background: rgba(77, 159, 255, 0.16);
  color: var(--accent-hover);
}
.gs-kind--road {
  background: rgba(224, 145, 90, 0.18);
  color: #e0915a;
}
.gs-kind--book {
  background: rgba(157, 140, 240, 0.18);
  color: #9d8cf0;
}

.gs-main {
  font-weight: 600;
  white-space: nowrap;
}
.gs-main--mono {
  font-family: var(--font-display);
  letter-spacing: 0.02em;
}
.gs-main mark,
.gs-meta mark {
  color: var(--accent-hover);
  background: var(--accent-soft);
  border-radius: 3px;
  padding: 0 1px;
}

.gs-meta {
  color: var(--text-2);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gs-meta--dim {
  color: var(--text-3);
}

.gs-enter {
  margin-left: auto;
  flex: none;
  color: var(--text-3);
  white-space: nowrap;
}

.gs-spot-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.gs-main-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.gs-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.gs-chip {
  font-size: 11px;
  color: var(--text-2);
  background: var(--fill-subtle);
  border: 1px solid var(--line-hairline);
  border-radius: 5px;
  padding: 1px 6px;
}
.gs-chip--tag {
  color: var(--text-3);
}
.gs-chips--rel {
  gap: 4px 8px;
}
.gs-rel {
  font-size: 11px;
  color: var(--accent-hover);
}

.gs-footer {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  border-top: 1px solid var(--line-hairline);
}
.gs-foot {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-3);
}
.gs-foot kbd {
  font-family: var(--font-sans);
  font-size: 10px;
  color: var(--text-3);
  border: 1px solid var(--line-default);
  border-radius: 4px;
  padding: 1px 4px;
  background: var(--fill-subtle);
}
.gs-foot--dim {
  margin-left: auto;
}

/* 手机竖屏：面板整体等比缩放到 75%（transform scale，内容随之变小），
 * 居中悬浮、四周露出页面背景，不再是全屏抽屉 */
@media (max-width: 599px) {
  .gs-panel {
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%) scale(0.75);
    width: 100%;
    height: 100%;
    max-height: none;
    border-radius: 20px;
  }
}

/* 过渡 */
.gs-enter-active,
.gs-leave-active {
  transition: opacity 0.18s ease;
}
.gs-enter-active .gs-panel,
.gs-leave-active .gs-panel {
  transition: transform 0.18s ease;
}
.gs-enter-from,
.gs-leave-to {
  opacity: 0;
}
.gs-enter-from .gs-panel,
.gs-leave-to .gs-panel {
  transform: translateX(-50%) translateY(-8px) scale(0.985);
}
@media (max-width: 599px) {
  .gs-enter-from .gs-panel,
  .gs-leave-to .gs-panel {
    transform: translate(-50%, -50%) scale(0.71);
  }
}
</style>