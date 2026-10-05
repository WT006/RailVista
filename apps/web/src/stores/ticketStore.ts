/**
 * 万里路书 · 旅行纪念票 store（Pinia setup 风格，持久化手写 localStorage，
 * 容错模式参照 prefsStore：try/catch 包裹、隐私模式静默兜底）。
 *
 * - config：当前编辑中的票面配置（草稿自动落盘 railvista:ticketDraft）
 * - saved：已保存的配置列表（railvista:ticketSaved）
 * - applyTrain：12306 车次选择结果 → 票面配置联动
 */
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import {
  createTicketConfig,
  makeTicketSerial,
  type TicketConfig,
  type TicketKind,
  type TrainSummary,
} from '@railvista/shared';

const DRAFT_KEY = 'railvista:ticketDraft';
const SAVED_KEY = 'railvista:ticketSaved';

export interface SavedTicket {
  id: string;
  name: string;
  updatedAt: number;
  config: TicketConfig;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export const useTicketStore = defineStore('ticket', () => {
  const config = ref<TicketConfig>(readJson<TicketConfig | null>(DRAFT_KEY, null) ?? createTicketConfig('railway'));
  const saved = ref<SavedTicket[]>(readJson<SavedTicket[]>(SAVED_KEY, []));
  /** 纯预览模式：隐藏编辑侧栏，票面居中放大 */
  const previewOnly = ref(false);

  let persistTimer: number | undefined;
  watch(
    config,
    () => {
      window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(() => writeJson(DRAFT_KEY, config.value), 300);
    },
    { deep: true },
  );

  function patch(p: Partial<TicketConfig>) {
    config.value = { ...config.value, ...p, updatedAt: Date.now() };
  }

  /** 切换票种 = 以该票种出厂默认开一张新票（已保存的不受影响） */
  function newTicket(kind: TicketKind) {
    config.value = createTicketConfig(kind);
  }

  /** 车次选择联动：TrainSummary → 票面配置 */
  function applyTrain(t: TrainSummary) {
    const seq = saved.value.length + 1;
    patch({
      kind: 'railway',
      title: '铁路纪念票',
      serial: makeTicketSerial('railway', t.date, seq),
      dateText: `${t.date} · ${t.departTime} 开`,
      metaLeft: `${t.date} · ${t.departTime} 开`,
      metaRight: t.duration ? `历时 ${t.duration}` : '',
      route: {
        ...config.value.route,
        ends: [{ name: t.from.name }, { name: t.to.name }],
        middleLabel: t.trainCode,
        waypoints: [],
      },
      stats: [
        { label: '出发 DEPART', value: t.departTime },
        { label: '到达 ARRIVE', value: t.arriveTime },
        { label: '历时 DURATION', value: t.duration || '—' },
        { label: '车次 TRAIN', value: t.trainCode },
      ],
    });
  }

  function save(name?: string): SavedTicket {
    const item: SavedTicket = {
      id: config.value.id,
      name: name?.trim() || config.value.title || '未命名纪念票',
      updatedAt: Date.now(),
      config: clone(config.value),
    };
    const i = saved.value.findIndex((s) => s.id === item.id);
    if (i >= 0) saved.value.splice(i, 1, item);
    else saved.value.unshift(item);
    writeJson(SAVED_KEY, saved.value);
    return item;
  }

  function loadSaved(id: string) {
    const hit = saved.value.find((s) => s.id === id);
    if (hit) config.value = clone(hit.config);
  }

  function removeSaved(id: string) {
    saved.value = saved.value.filter((s) => s.id !== id);
    writeJson(SAVED_KEY, saved.value);
  }

  return {
    config,
    saved,
    previewOnly,
    patch,
    newTicket,
    applyTrain,
    save,
    loadSaved,
    removeSaved,
  };
});
