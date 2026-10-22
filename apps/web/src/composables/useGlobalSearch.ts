import { computed, ref } from 'vue';
import type {
  GlobalSearchResult,
  SearchCorridorHit,
  SearchRoadHit,
  SearchRoadbookHit,
  SearchSpotHit,
  SearchTrainHit,
} from '@railvista/shared';
import { api } from '../api/client';

/** 统一的结果项（扁平化，供命令面板键盘导航） */
export type SearchItem =
  | { kind: 'train'; hit: SearchTrainHit }
  | { kind: 'corridor'; hit: SearchCorridorHit }
  | { kind: 'road'; hit: SearchRoadHit }
  | { kind: 'spot'; hit: SearchSpotHit }
  | { kind: 'roadbook'; hit: SearchRoadbookHit };

// ── 模块级单例：命令面板在整站唯一，且由 App + 多个导航入口共同读写 ──
const isOpen = ref(false);
const query = ref('');
const result = ref<GlobalSearchResult | null>(null);
const loading = ref(false);
const error = ref('');

let debounceTimer: number | undefined;
let requestSeq = 0;

function resetState(): void {
  query.value = '';
  result.value = null;
  error.value = '';
}

async function runSearch(q: string): Promise<void> {
  const seq = ++requestSeq;
  const trimmed = q.trim();
  if (!trimmed) {
    result.value = null;
    loading.value = false;
    error.value = '';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const r = await api.searchAll(trimmed);
    if (seq !== requestSeq) return; // 过期响应，丢弃
    result.value = r;
  } catch (e) {
    if (seq !== requestSeq) return;
    result.value = null;
    error.value = (e as Error)?.message || '搜索失败，请稍后再试';
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

function onInput(v: string): void {
  query.value = v;
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => void runSearch(v), 150);
}

function open(): void {
  isOpen.value = true;
  resetState();
}

function close(): void {
  isOpen.value = false;
  // 关闭后清掉在途请求，避免结果落盘到下一次打开
  requestSeq += 1;
  loading.value = false;
  resetState();
}

function toggle(): void {
  if (isOpen.value) close();
  else open();
}

/** 扁平化命中项（按 车次 → 铁路线 → 公路 → 景点 → 路书 顺序，供 ↑↓ 导航） */
const flatItems = computed<SearchItem[]>(() => {
  const r = result.value;
  if (!r) return [];
  const out: SearchItem[] = [];
  for (const hit of r.trains) out.push({ kind: 'train', hit });
  for (const hit of r.corridors) out.push({ kind: 'corridor', hit });
  for (const hit of r.roads) out.push({ kind: 'road', hit });
  for (const hit of r.spots) out.push({ kind: 'spot', hit });
  for (const hit of r.roadbooks) out.push({ kind: 'roadbook', hit });
  return out;
});

export function useGlobalSearch() {
  return {
    isOpen,
    query,
    result,
    loading,
    error,
    flatItems,
    onInput,
    open,
    close,
    toggle,
  };
}