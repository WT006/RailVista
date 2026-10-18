<script setup lang="ts">
/**
 * 万里路书 · 旅行纪念票（顶部菜单第 4 入口 /ticket）
 *
 * 引导式制作（鸿蒙风格交互）：
 *  - 顶部 HmSegmented 切票种；
 *  - 侧栏按票种给出引导构建器（铁路=选车次+少量个性化；自驾=规划路线+路牌增删；飞行=航班号查询）；
 *  - 主栏票面实时预览；按票种裁剪的微调编辑器折叠为「高级微调」。
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import type { TicketConfig, TicketKind, TrainSummary } from '@railvista/shared';
import TicketFace from '../components/ticket/TicketFace.vue';
import TicketEditor from '../components/ticket/TicketEditor.vue';
import TicketExportModal from '../components/ticket/TicketExportModal.vue';
import TrainPicker from '../components/ticket/TrainPicker.vue';
import RailwayPersonalize from '../components/ticket/RailwayPersonalize.vue';
import DriveBuilder from '../components/ticket/DriveBuilder.vue';
import FlightBuilder from '../components/ticket/FlightBuilder.vue';
import HmSegmented, { type SegOption } from '../components/ticket/hm/HmSegmented.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';
import {
  listTicketTraces,
  removeTicketTrace,
  type TicketTrace,
} from '../lib/ticketTrace';
import {
  SAVED_TICKET_MAX,
  ticketCoreName,
  useTicketStore,
  type SavedTicket,
} from '../stores/ticketStore';

usePointerSpotlight();

const store = useTicketStore();
const tracesAll = ref<TicketTrace[]>([]);
/** 默认只展示最近 1 条，展开后显示其余 */
const tracesExpanded = ref(false);

function refreshTraces() {
  tracesAll.value = listTicketTraces();
}

/** 只展示与当前票种一致的痕迹（铁路 / 自驾 / 飞行分开） */
const traces = computed(() =>
  tracesAll.value.filter((t) => t.kind === store.config.kind),
);

const visibleTraces = computed(() =>
  tracesExpanded.value ? traces.value : traces.value.slice(0, 1),
);
const hiddenTraceCount = computed(() => Math.max(0, traces.value.length - 1));

/** 已保存也按票种分开，不与异种混排 */
const savedForKind = computed(() =>
  store.saved.filter((s) => s.config.kind === store.config.kind),
);

onMounted(refreshTraces);

const kindOptions: SegOption[] = [
  { label: '铁路', value: 'railway', icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C8 2 6 3.6 6 7v7.5A2.5 2.5 0 008.5 17l-1.5 2h1.6l1.5-2h3.8l1.5 2H17l-1.5-2a2.5 2.5 0 002.5-2.5V7c0-3.4-2-5-6-5zm-2.5 3h5A1.5 1.5 0 0116 6.5V10H8V6.5A1.5 1.5 0 019.5 5zM8.5 13a1.3 1.3 0 110 2.6 1.3 1.3 0 010-2.6zm7 0a1.3 1.3 0 110 2.6 1.3 1.3 0 010-2.6z"/></svg>' },
  { label: '自驾', value: 'drive', icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M18.9 16.6c.2-.4.3-.9.3-1.3l-.9-4.4c-.2-1-.8-1.9-2-1.9H7.7c-1.2 0-1.8.9-2 1.9l-.9 4.4c0 .4.1.9.3 1.3V19c0 .6.4 1 1 1h.7c.6 0 1-.4 1-1v-1h8.4v1c0 .6.4 1 1 1h.7c.6 0 1-.4 1-1zM7.4 15.6a1.1 1.1 0 110-2.2 1.1 1.1 0 010 2.2zm9.2 0a1.1 1.1 0 110-2.2 1.1 1.1 0 010 2.2zM6.5 12.4l.7-2.6h9.6l.7 2.6z"/></svg>' },
  { label: '飞行', value: 'flight', icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 15.4v-2l-8-5V3.5a1.5 1.5 0 00-3 0V8.4l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-6.1z"/></svg>' },
];

const notice = ref('');
let noticeTimer: number | undefined;
function flash(msg: string) {
  notice.value = msg;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice.value = '';
  }, 2400);
}

const exportOpen = ref(false);
const exportName = ref('');
const exportConfig = ref<TicketConfig | null>(null);

/** 居中弹窗提示（重复保存等），自动消失；key 强制重挂载避免连点无感 */
const alertOpen = ref(false);
const alertMsg = ref('');
const alertKey = ref(0);
let alertTimer: number | undefined;
async function showAlert(msg: string, ms = 2400) {
  // 若票面预览还开着，先关掉，避免挡住提示
  exportOpen.value = false;
  window.clearTimeout(alertTimer);
  alertMsg.value = msg;
  alertOpen.value = false;
  alertKey.value += 1;
  await nextTick();
  alertOpen.value = true;
  alertTimer = window.setTimeout(() => {
    alertOpen.value = false;
  }, ms);
}
function closeAlert() {
  window.clearTimeout(alertTimer);
  alertOpen.value = false;
}

function onKind(v: string | number) {
  if (v !== store.config.kind) {
    store.newTicket(v as TicketKind);
    tracesExpanded.value = false;
  }
}
function onPickTrain(t: TrainSummary) {
  store.applyTrain(t);
  flash(`已自动生成票面：${t.trainCode} ${t.from.name} → ${t.to.name}`);
}

function openExport(item: Pick<SavedTicket, 'name' | 'config'>) {
  exportName.value = item.name;
  exportConfig.value = item.config;
  exportOpen.value = true;
}

function closeExport() {
  exportOpen.value = false;
}

/** 保存到本机列表后仍留在编辑页；点列表项再弹图片预览 / 下载 */
function onSave() {
  // 先本地判断，避免漏检时误走成功绿字
  if (store.findDuplicate()) {
    notice.value = '';
    void showAlert('该纪念票已保存，请勿重复保存');
    return;
  }
  const result = store.save();
  if (result.status === 'duplicate') {
    notice.value = '';
    void showAlert('该纪念票已保存，请勿重复保存');
    return;
  }
  refreshTraces();
  flash('已保存到本机列表，点击条目可查看图片并下载');
  openExport(result.item);
}

function onViewSaved(s: SavedTicket) {
  openExport({ name: ticketCoreName(s.config) || s.name, config: s.config });
}

function onLoadSaved(s: SavedTicket) {
  store.loadSaved(s.id);
  flash(`已载入：${savedLabel(s)}`);
}

function onLoadTrace(t: TicketTrace) {
  store.loadConfig(t.config);
  flash(`已载入行程痕迹：${traceLabel(t)}`);
}

function onRemoveTrace(id: string) {
  removeTicketTrace(id);
  refreshTraces();
  if (traces.value.length <= 1) tracesExpanded.value = false;
  flash('已删除痕迹');
}

function savedLabel(s: SavedTicket) {
  return ticketCoreName(s.config) || s.name;
}

function traceLabel(t: TicketTrace) {
  return ticketCoreName(t.config) || t.name;
}

const hasTrain = computed(() => store.config.kind === 'railway' && !!store.config.route.middleLabel);
const showAdvanced = ref(false);
</script>

<template>
  <div class="ticket-page rv-page">
    <div class="rv-shell">
      <header class="ticket-hero">
        <p class="ticket-hero__eyebrow">HEY WORLD · COMMEMORATIVE PASS</p>
        <h1>旅行纪念票</h1>
        <p class="sub">
          选好关键项，票面大部分自动生成：铁路联动 12306 车次，自驾一键规划路牌，飞行自动匹配机场与航程。
        </p>
      </header>

      <div class="kind-switch">
        <HmSegmented :options="kindOptions" :model-value="store.config.kind" @update:model-value="onKind" />
      </div>

      <div class="rv-grid" :class="{ 'is-preview': store.previewOnly }">
        <!-- 票面预览 -->
        <div class="rv-col rv-col--main">
          <section class="rv-card" data-spotlight>
            <div class="tk-toolbar">
              <span class="tk-toolbar__hint">
                {{ store.config.kind === 'railway' ? '选好车次即自动成票'
                  : store.config.kind === 'drive' ? '规划路线即自动成票'
                  : '输入航班号即自动成票' }}
              </span>
              <div class="tk-toolbar__acts">
                <button class="btn ghost btn-sm" type="button" @click="store.previewOnly = !store.previewOnly">
                  {{ store.previewOnly ? '返回编辑' : '纯预览' }}
                </button>
                <button class="btn primary btn-sm" type="button" @click="onSave">保存</button>
              </div>
            </div>

            <div class="tk-face-wrap">
              <TicketFace :config="store.config" />
            </div>
            <p v-if="notice" class="tk-notice" role="status">{{ notice }}</p>
          </section>
        </div>

        <!-- 引导构建器 -->
        <div v-show="!store.previewOnly" class="rv-col rv-col--side">
          <!-- 行程痕迹置顶：仅当前票种；默认最近 1 条，其余折叠 -->
          <section v-if="traces.length" class="rv-card" data-spotlight>
            <div class="trace-head">
              <h2 class="builder-title">行程痕迹</h2>
              <button
                v-if="hiddenTraceCount > 0 || tracesExpanded"
                type="button"
                class="trace-more"
                :aria-expanded="tracesExpanded"
                @click="tracesExpanded = !tracesExpanded"
              >
                <span>{{ tracesExpanded ? '收起' : `更多 ${hiddenTraceCount} 条` }}</span>
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  :style="{ transform: tracesExpanded ? 'rotate(180deg)' : undefined }"
                >
                  <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            </div>
            <ul class="saved-list">
              <li v-for="t in visibleTraces" :key="t.id">
                <button
                  type="button"
                  class="saved-list__meta"
                  :aria-label="`载入痕迹 ${traceLabel(t)}`"
                  @click="onLoadTrace(t)"
                >
                  <strong>{{ traceLabel(t) }}</strong>
                  <span>{{ new Date(t.updatedAt).toLocaleString() }}</span>
                </button>
                <div class="saved-list__acts">
                  <button class="btn ghost btn-sm" type="button" @click="onLoadTrace(t)">载入</button>
                  <button class="btn ghost btn-sm" type="button" @click="onRemoveTrace(t.id)">删除</button>
                </div>
              </li>
            </ul>
          </section>

          <section v-if="store.config.kind === 'railway'" class="rv-card" data-spotlight>
            <h2 class="builder-title">① 选择车次</h2>
            <TrainPicker @pick="onPickTrain" />
            <RailwayPersonalize v-if="hasTrain" />
          </section>

          <section v-else-if="store.config.kind === 'drive'" class="rv-card" data-spotlight>
            <h2 class="builder-title">规划自驾路线</h2>
            <DriveBuilder />
          </section>

          <section v-else class="rv-card" data-spotlight>
            <h2 class="builder-title">查询航班</h2>
            <FlightBuilder />
          </section>

          <!-- 高级全字段 -->
          <section class="rv-card" data-spotlight>
            <button type="button" class="adv-toggle" @click="showAdvanced = !showAdvanced">
              <span>高级微调</span>
              <svg v-if="!showAdvanced" viewBox="0 0 24 24" width="17" height="17"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/></svg>
              <svg v-else viewBox="0 0 24 24" width="17" height="17"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 15l6-6 6 6"/></svg>
            </button>
            <TicketEditor v-show="showAdvanced" @save="onSave" />
          </section>

          <!-- 已保存：仅当前票种；载入编辑 / 图片预览下载 / 删除 -->
          <section v-if="savedForKind.length" class="rv-card" data-spotlight>
            <h2 class="builder-title">已保存纪念票</h2>
            <p class="saved-hint">
              最多 {{ SAVED_TICKET_MAX }} 张 · 「载入」继续编辑，点名称可查看图片并下载
            </p>
            <ul class="saved-list">
              <li v-for="s in savedForKind" :key="s.id">
                <button
                  type="button"
                  class="saved-list__meta"
                  :aria-label="`查看 ${savedLabel(s)} 图片`"
                  @click="onViewSaved(s)"
                >
                  <strong>{{ savedLabel(s) }}</strong>
                  <span>{{ new Date(s.updatedAt).toLocaleString() }}</span>
                </button>
                <div class="saved-list__acts">
                  <button class="btn ghost btn-sm" type="button" @click="onLoadSaved(s)">载入</button>
                  <button class="btn ghost btn-sm" type="button" @click="onViewSaved(s)">下载</button>
                  <button class="btn ghost btn-sm" type="button" @click="store.removeSaved(s.id)">删除</button>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </div>

      <p class="footnote">
        纪念票与行程痕迹仅保存在本机浏览器；时刻 / 航班数据来自公开查询，未接入航班动态服务时起降时刻需自行补填，仅供纪念。
      </p>
    </div>

    <TicketExportModal
      :open="exportOpen"
      :config="exportConfig"
      :name="exportName"
      @close="closeExport"
    />

    <Teleport to="body">
      <div
        v-if="alertOpen"
        :key="alertKey"
        class="tk-alert"
        role="alertdialog"
        aria-modal="true"
        aria-live="assertive"
      >
        <button type="button" class="tk-alert__backdrop" aria-label="关闭" @click="closeAlert" />
        <div class="tk-alert__panel">
          <p class="tk-alert__msg">{{ alertMsg }}</p>
          <button type="button" class="btn primary btn-sm" @click="closeAlert">知道了</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 与 select-hero / drive-hero / rb-hero 同级：页标题用 --fs-display，说明用 --fs-meta */
.ticket-hero {
  margin: 0 0 var(--space-5);
}

.ticket-hero__eyebrow {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-eyebrow);
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
}

.ticket-hero h1 {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-display);
  font-weight: 700;
  line-height: var(--lh-tight);
  letter-spacing: -0.01em;
  color: var(--text-1);
}

.ticket-hero .sub {
  margin: 0;
  max-width: 36em;
  font-size: var(--fs-meta);
  line-height: var(--lh-normal);
  color: var(--text-2);
}

.ticket-page .rv-grid { margin-top: var(--space-2); }

.kind-switch { max-width: 420px; margin: var(--space-2) auto 0; }

.tk-toolbar {
  display: flex; justify-content: space-between; align-items: center;
  gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-2);
}
.tk-toolbar__hint { font-size: var(--fs-cap); color: var(--text-3); letter-spacing: 0.04em; }
.tk-toolbar__acts { display: flex; gap: var(--space-1); }

/* 票面框：3:4.2 竖向比例。
   同时是 TicketFace 的容器查询祖先（container-type 必须建在父元素上：
   cqw 在容器自身上不引用自己，写在 .tk 上会回退到视口宽度，桌面宽屏下
   票面会被放大数倍、圆角变「车窗」——2026-10-11 回归修复）。
   框内一切尺寸按框宽等比缩放，因此同一比例在手机/桌面版式完全一致，无需断点。 */
.tk-face-wrap {
  width: 100%; max-width: 380px; margin: 0 auto;
  aspect-ratio: 3 / 4.2;
  container-type: inline-size;
}

.tk-notice { margin: var(--space-2) 0 0; text-align: center; font-size: var(--fs-meta); color: var(--success); }

.ticket-page .rv-grid.is-preview .rv-col--main {
  grid-column: 1 / -1; width: 100%; max-width: 560px; margin-inline: auto;
}
.ticket-page .rv-grid.is-preview .tk-face-wrap { max-width: 430px; }

.builder-title { font-size: var(--fs-h3); margin: 0 0 var(--space-2); letter-spacing: 0.02em; }

/* 机场 / 车站联想展开时抬升整张构建卡。
 * .rv-card 有 isolation:isolate，子元素 z-index 压不过后面的「高级微调」等兄弟卡
 *（与 drive-od.has-suggest-open 同一做法）。 */
.rv-card:has(:deep(.is-suggest-open)) {
  position: relative;
  z-index: 50;
}

.adv-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 32px;
  padding: 4px 2px;
  border: none;
  background: transparent;
  font-size: var(--fs-meta);
  font-weight: 600;
  color: var(--text-2);
  cursor: pointer;
  font-family: inherit;
  line-height: 1.2;
}
.adv-toggle svg { width: 14px; height: 14px; flex-shrink: 0; }
@media (hover: hover) and (pointer: fine) {
  .adv-toggle:hover { color: var(--text-1); }
}

.saved-hint {
  margin: calc(var(--space-1) * -1) 0 var(--space-2);
  font-size: var(--fs-cap);
  color: var(--text-3);
}
.saved-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.saved-list li {
  display: flex; justify-content: space-between; align-items: center; gap: var(--space-1);
  padding: var(--space-1); border: 1px solid var(--surface-3); border-radius: var(--radius-sm);
}
.saved-list__meta {
  display: flex; flex-direction: column; min-width: 0; flex: 1;
  margin: 0; padding: 4px 6px; border: none; border-radius: var(--radius-sm);
  background: transparent; text-align: left; cursor: pointer; font-family: inherit;
}
.saved-list__meta strong {
  display: flex; align-items: center; gap: 6px; min-width: 0;
  font-size: var(--fs-meta); color: var(--text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.saved-list__meta span { font-size: var(--fs-cap); color: var(--text-3); }
.trace-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1);
  margin-bottom: var(--space-1);
  min-height: 28px;
}
.trace-head .builder-title {
  margin: 0;
  font-size: var(--fs-meta);
  line-height: 1.2;
}
.trace-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  flex-shrink: 0;
  min-height: 28px;
  padding: 2px 8px;
  border: 1px solid var(--line-default);
  border-radius: var(--radius-full);
  background: transparent;
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-3);
  cursor: pointer;
  line-height: 1;
}
.trace-more svg {
  width: 12px;
  height: 12px;
  transition: transform 0.15s ease;
}
@media (hover: hover) and (pointer: fine) {
  .trace-more:hover { color: var(--text-1); border-color: var(--line-strong); background: var(--surface-2); }
}
.trace-more:focus-visible { outline: none; box-shadow: var(--focus-ring); }
@media (hover: hover) and (pointer: fine) {
  .saved-list__meta:hover strong { color: var(--accent); }
}
.saved-list__meta:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.saved-list__acts { display: flex; gap: 4px; flex-shrink: 0; }
/* 触屏：载入/删除按钮命中区补齐 ≥44vp（桌面保留紧凑小按钮） */
@media (pointer: coarse) {
  .saved-list__acts .btn {
    min-width: 44px;
    min-height: 40px;
  }
}

.footnote { margin: var(--space-3) 0 0; color: var(--text-3); font-size: var(--fs-cap); text-align: center; }
</style>

<!-- Teleport 到 body：非 scoped，避免弹层无样式像「没反应」 -->
<style>
.tk-alert {
  position: fixed;
  inset: 0;
  z-index: 10050;
  display: grid;
  place-items: center;
  padding: 16px;
}
.tk-alert__backdrop {
  position: absolute;
  inset: 0;
  border: none;
  padding: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(3px);
  cursor: pointer;
}
.tk-alert__panel {
  position: relative;
  z-index: 1;
  width: min(320px, 100%);
  padding: 20px 18px;
  border-radius: 16px;
  background: #1a222e;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
}
.tk-alert__msg {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: #e7ecf3;
  font-weight: 600;
}
.tk-alert__panel .btn {
  min-width: 96px;
  min-height: 40px;
}
</style>
