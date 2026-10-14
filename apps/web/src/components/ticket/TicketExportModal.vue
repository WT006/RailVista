<script setup lang="ts">
/**
 * 已保存纪念票：弹层预览 PNG + 本机下载。
 * 离屏渲染 TicketFace 再截图，避免预览缩放影响导出清晰度。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { TicketConfig } from '@railvista/shared';
import TicketFace from './TicketFace.vue';
import {
  captureTicketPng,
  downloadDataUrl,
  ticketDownloadName,
} from '../../lib/ticketExport';

const props = defineProps<{
  open: boolean;
  config: TicketConfig | null;
  name: string;
}>();

const emit = defineEmits<{ close: [] }>();

const faceRef = ref<HTMLElement | null>(null);
const previewUrl = ref('');
const busy = ref(false);
const error = ref('');

let gen = 0;

function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) emit('close');
}

async function renderPreview() {
  const my = ++gen;
  previewUrl.value = '';
  error.value = '';
  if (!props.open || !props.config) return;
  busy.value = true;
  try {
    await nextTick();
    // 等布局 / 容器查询生效
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const el = faceRef.value;
    if (!el || my !== gen) return;
    const url = await captureTicketPng(el, 2);
    if (my !== gen) return;
    previewUrl.value = url;
  } catch (e) {
    if (my !== gen) return;
    error.value = e instanceof Error ? e.message : '生成图片失败';
  } finally {
    if (my === gen) busy.value = false;
  }
}

watch(
  () => [props.open, props.config?.id, props.config?.updatedAt] as const,
  (curr) => {
    const open = Boolean(curr[0]);
    if (open) window.addEventListener('keydown', onDocKey);
    else window.removeEventListener('keydown', onDocKey);
    void renderPreview();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  gen += 1;
  window.removeEventListener('keydown', onDocKey);
});

function onDownload() {
  if (!previewUrl.value || !props.config) return;
  downloadDataUrl(
    previewUrl.value,
    ticketDownloadName(props.name, props.config.serial),
  );
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && config"
      class="tx-modal"
      role="dialog"
      aria-modal="true"
      aria-label="纪念票图片"
    >
      <button type="button" class="tx-modal__backdrop" aria-label="关闭" @click="emit('close')" />
      <div class="tx-modal__panel">
        <header class="tx-modal__head">
          <div class="tx-modal__titles">
            <strong>{{ name || config.title }}</strong>
            <span>{{ config.serial }}</span>
          </div>
          <button type="button" class="btn ghost btn-sm" @click="emit('close')">关闭</button>
        </header>

        <div class="tx-modal__body">
          <div v-if="busy" class="tx-modal__status">正在生成图片…</div>
          <p v-else-if="error" class="tx-modal__err">{{ error }}</p>
          <img
            v-if="previewUrl"
            class="tx-modal__img"
            :src="previewUrl"
            :alt="name || '纪念票'"
          />
          <!-- 离屏票面：固定设计宽，供截图；不参与可见布局 -->
          <div class="tx-modal__offscreen" aria-hidden="true">
            <div ref="faceRef" class="tx-modal__face">
              <TicketFace :config="config" />
            </div>
          </div>
        </div>

        <footer class="tx-modal__foot">
          <button
            type="button"
            class="btn primary"
            :disabled="!previewUrl || busy"
            @click="onDownload"
          >
            下载图片
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tx-modal {
  position: fixed;
  inset: 0;
  z-index: 9200;
  display: grid;
  place-items: center;
  padding: var(--space-3);
}
.tx-modal__backdrop {
  position: absolute;
  inset: 0;
  border: none;
  padding: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  cursor: pointer;
}
.tx-modal__panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(420px, 100%);
  max-height: min(92vh, 900px);
  border-radius: var(--radius-lg);
  background: var(--surface-1);
  border: 1px solid var(--line-default);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.tx-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-3) var(--space-2);
}
.tx-modal__titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}
.tx-modal__titles strong {
  font-size: var(--fs-meta);
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tx-modal__titles span {
  font-size: var(--fs-cap);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.tx-modal__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 var(--space-3) var(--space-2);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.tx-modal__status,
.tx-modal__err {
  margin: var(--space-4) 0;
  font-size: var(--fs-meta);
  color: var(--text-3);
}
.tx-modal__err { color: var(--danger); }
.tx-modal__img {
  width: 100%;
  max-width: 380px;
  height: auto;
  border-radius: var(--radius-md);
  display: block;
}
/* 移出视口但保持可绘制（勿用 opacity:0，html-to-image 会出空白） */
.tx-modal__offscreen {
  position: fixed;
  left: -10000px;
  top: 0;
  width: 380px;
  pointer-events: none;
  z-index: -1;
}
.tx-modal__face {
  width: 380px;
  aspect-ratio: 3 / 4.2;
  container-type: inline-size;
}
.tx-modal__foot {
  display: flex;
  justify-content: center;
  padding: var(--space-2) var(--space-3) var(--space-3);
  border-top: 1px solid var(--line-default);
}
.tx-modal__foot .btn {
  min-width: 160px;
  min-height: 44px;
}
</style>
