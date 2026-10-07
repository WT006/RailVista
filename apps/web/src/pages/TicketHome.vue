<script setup lang="ts">
/**
 * 万里路书 · 旅行纪念票（顶部菜单第 4 入口 /ticket）
 *
 * 引导式制作（鸿蒙风格交互）：
 *  - 顶部 HmSegmented 切票种；
 *  - 侧栏按票种给出引导构建器（铁路=选车次+少量个性化；自驾=规划路线+路牌增删；飞行=航班号查询）；
 *  - 主栏票面实时预览；全字段编辑器折叠为「高级」。
 */
import { computed, ref } from 'vue';
import type { TicketKind, TrainSummary } from '@railvista/shared';
import TicketFace from '../components/ticket/TicketFace.vue';
import TicketEditor from '../components/ticket/TicketEditor.vue';
import TrainPicker from '../components/ticket/TrainPicker.vue';
import RailwayPersonalize from '../components/ticket/RailwayPersonalize.vue';
import DriveBuilder from '../components/ticket/DriveBuilder.vue';
import FlightBuilder from '../components/ticket/FlightBuilder.vue';
import HmSegmented, { type SegOption } from '../components/ticket/hm/HmSegmented.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';
import { useTicketStore } from '../stores/ticketStore';

usePointerSpotlight();

const store = useTicketStore();

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

function onKind(v: string | number) {
  if (v !== store.config.kind) store.newTicket(v as TicketKind);
}
function onPickTrain(t: TrainSummary) {
  store.applyTrain(t);
  flash(`已自动生成票面：${t.trainCode} ${t.from.name} → ${t.to.name}`);
}
function onSave() {
  store.save();
  flash('纪念票已保存到本机列表');
}

const hasTrain = computed(() => store.config.kind === 'railway' && !!store.config.route.middleLabel);
const showAdvanced = ref(false);
</script>

<template>
  <div class="ticket-page rv-page">
    <div class="rv-shell">
      <header class="rv-head">
        <p class="rv-head__eyebrow">HEY WORLD · COMMEMORATIVE PASS</p>
        <h1 class="rv-head__title">旅行纪念票</h1>
        <p class="rv-head__sub">
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
              <span>高级 · 全字段编辑</span>
              <svg v-if="!showAdvanced" viewBox="0 0 24 24" width="17" height="17"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/></svg>
              <svg v-else viewBox="0 0 24 24" width="17" height="17"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 15l6-6 6 6"/></svg>
            </button>
            <TicketEditor v-show="showAdvanced" />
          </section>

          <!-- 已保存 -->
          <section v-if="store.saved.length" class="rv-card" data-spotlight>
            <h2 class="builder-title">已保存纪念票</h2>
            <ul class="saved-list">
              <li v-for="s in store.saved" :key="s.id">
                <div class="saved-list__meta">
                  <strong>{{ s.name }}</strong>
                  <span>{{ new Date(s.updatedAt).toLocaleString() }}</span>
                </div>
                <div class="saved-list__acts">
                  <button class="btn ghost btn-sm" type="button" @click="store.loadSaved(s.id)">载入</button>
                  <button class="btn ghost btn-sm" type="button" @click="store.removeSaved(s.id)">删除</button>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </div>

      <p class="footnote">纪念票仅保存在本机浏览器；时刻 / 航班数据来自公开查询，未接入航班动态服务时起降时刻需自行补填，仅供纪念。</p>
    </div>
  </div>
</template>

<style scoped>
.ticket-page .rv-grid { margin-top: var(--space-2); }

.kind-switch { max-width: 420px; margin: var(--space-2) auto 0; }

.tk-toolbar {
  display: flex; justify-content: space-between; align-items: center;
  gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-2);
}
.tk-toolbar__hint { font-size: var(--fs-cap); color: var(--text-3); letter-spacing: 0.04em; }
.tk-toolbar__acts { display: flex; gap: var(--space-1); }

/* 票面固定 3:4.5 竖向比例 */
.tk-face-wrap {
  width: 100%; max-width: 380px; margin: 0 auto;
  aspect-ratio: 3 / 4.2;
}

.tk-notice { margin: var(--space-2) 0 0; text-align: center; font-size: var(--fs-meta); color: var(--success); }

.ticket-page .rv-grid.is-preview .rv-col--main {
  grid-column: 1 / -1; width: 100%; max-width: 560px; margin-inline: auto;
}
.ticket-page .rv-grid.is-preview .tk-face-wrap { max-width: 430px; }

.builder-title { font-size: var(--fs-h4); margin: 0 0 var(--space-2); letter-spacing: 0.02em; }

.adv-toggle {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 4px 2px;
  border: none; background: transparent;
  font-size: var(--fs-meta); color: var(--text-2); cursor: pointer;
  font-family: inherit;
}
.adv-toggle:hover { color: var(--text-1); }

.saved-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.saved-list li {
  display: flex; justify-content: space-between; align-items: center; gap: var(--space-1);
  padding: var(--space-1); border: 1px solid var(--surface-3); border-radius: var(--radius-sm);
}
.saved-list__meta { display: flex; flex-direction: column; min-width: 0; }
.saved-list__meta strong { font-size: var(--fs-meta); color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.saved-list__meta span { font-size: var(--fs-cap); color: var(--text-3); }
.saved-list__acts { display: flex; gap: 4px; flex-shrink: 0; }

.footnote { margin: var(--space-3) 0 0; color: var(--text-3); font-size: var(--fs-cap); text-align: center; }
</style>
