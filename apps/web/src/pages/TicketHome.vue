<script setup lang="ts">
/**
 * 万里路书 · 旅行纪念票（顶部菜单第 4 入口 /ticket）
 *
 * 主栏：票面实时预览（TicketFace，纯配置驱动）+ 铁路票车次选择联动（TrainPicker）
 * 侧栏：票面配置编辑器（TicketEditor）+ 已保存配置列表
 * 页面骨架 / 卡片 / 光晕交互遵循全站规范（rv-page / rv-shell / rv-grid / rv-card + usePointerSpotlight）
 */
import { ref } from 'vue';
import type { TicketKind, TrainSummary } from '@railvista/shared';
import TicketFace from '../components/ticket/TicketFace.vue';
import TicketEditor from '../components/ticket/TicketEditor.vue';
import TrainPicker from '../components/ticket/TrainPicker.vue';
import { usePointerSpotlight } from '../composables/usePointerSpotlight';
import { useTicketStore } from '../stores/ticketStore';
import { TICKET_KIND_META } from '../data/ticket';

usePointerSpotlight();

const store = useTicketStore();
const KINDS: TicketKind[] = ['railway', 'drive', 'flight'];

const notice = ref('');
let noticeTimer: number | undefined;
function flash(msg: string) {
  notice.value = msg;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice.value = '';
  }, 2400);
}

function onPickTrain(t: TrainSummary) {
  store.applyTrain(t);
  flash(`已联动票面：${t.trainCode} ${t.from.name} → ${t.to.name}`);
}

function onSave() {
  store.save();
  flash('配置已保存到本机列表');
}
</script>

<template>
  <div class="ticket-page rv-page">

    <div class="rv-shell">
      <header class="rv-head">
        <p class="rv-head__eyebrow">HEY WORLD · COMMEMORATIVE PASS</p>
        <h1 class="rv-head__title">旅行纪念票</h1>
        <p class="rv-head__sub">
          把一段旅程做成一张值得收藏的票：票面全部配置驱动，铁路票可联动 12306 实时车次。
        </p>
      </header>

      <div class="rv-grid" :class="{ 'is-preview': store.previewOnly }">
        <div class="rv-col rv-col--main">
          <section class="rv-card" data-spotlight>
            <div class="tk-toolbar">
              <div class="seg" role="tablist" aria-label="票种">
                <button
                  v-for="k in KINDS"
                  :key="k"
                  type="button"
                  class="seg__btn"
                  :class="{ 'is-active': store.config.kind === k }"
                  @click="store.newTicket(k)"
                >
                  {{ TICKET_KIND_META[k].label }}
                </button>
              </div>
              <div class="tk-toolbar__acts">
                <button class="btn ghost btn-sm" type="button" @click="store.previewOnly = !store.previewOnly">
                  {{ store.previewOnly ? '返回编辑' : '纯预览' }}
                </button>
                <button class="btn primary btn-sm" type="button" @click="onSave">保存配置</button>
              </div>
            </div>

            <TicketFace :config="store.config" />
            <p v-if="notice" class="tk-notice" role="status">{{ notice }}</p>
          </section>

          <section
            v-if="store.config.kind === 'railway' && !store.previewOnly"
            class="rv-card"
            data-spotlight
          >
            <h2 class="rv-head__title">选择车次 <span class="muted">· 选中后自动联动票面</span></h2>
            <TrainPicker @pick="onPickTrain" />
          </section>
        </div>

        <div v-show="!store.previewOnly" class="rv-col rv-col--side">
          <section class="rv-card" data-spotlight>
            <h2 class="rv-head__title">票面配置</h2>
            <p class="muted">所有展示项均可编辑，草稿自动存本机。</p>
            <TicketEditor />
          </section>

          <section v-if="store.saved.length" class="rv-card" data-spotlight>
            <h2 class="rv-head__title">已保存配置</h2>
            <ul class="saved-list" v-auto-animate>
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

      <p class="footnote">票面配置仅保存在本机浏览器；时刻数据来自公开查询，仅供参考。</p>
    </div>
  </div>
</template>

<style scoped>
/* 页面级排版微调；模块样式遵循 base.css / tokens.css */
.ticket-page .rv-grid { margin-top: var(--space-2); }

.tk-toolbar {
  display: flex; justify-content: space-between; align-items: center;
  gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-2);
}
.tk-toolbar__acts { display: flex; gap: var(--space-1); }

.seg {
  display: flex; gap: 2px; padding: 3px;
  background: var(--surface-2); border: 1px solid var(--surface-3);
  border-radius: var(--radius-full);
}
.seg__btn {
  border: none; background: transparent; cursor: pointer;
  padding: 6px 14px; border-radius: var(--radius-full);
  color: var(--text-2); font-size: var(--fs-meta); font-family: inherit;
  transition: color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard);
}
.seg__btn:hover { color: var(--text-1); }
.seg__btn.is-active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }

.tk-notice {
  margin: var(--space-2) 0 0; text-align: center;
  font-size: var(--fs-meta); color: var(--success);
}

.ticket-page .rv-grid.is-preview .rv-col--main {
  grid-column: 1 / -1; width: 100%; max-width: 560px; margin-inline: auto;
}

.saved-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.saved-list li {
  display: flex; justify-content: space-between; align-items: center; gap: var(--space-1);
  padding: var(--space-1); border: 1px solid var(--surface-3); border-radius: var(--radius-sm);
}
.saved-list__meta { display: flex; flex-direction: column; min-width: 0; }
.saved-list__meta strong { font-size: var(--fs-meta); color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.saved-list__meta span { font-size: var(--fs-cap); color: var(--text-3); }
.saved-list__acts { display: flex; gap: 4px; flex-shrink: 0; }

.muted { color: var(--text-3); font-size: var(--fs-meta); margin: 0 0 var(--space-1); }
.footnote { margin: var(--space-3) 0 0; color: var(--text-3); font-size: var(--fs-cap); text-align: center; }
</style>
