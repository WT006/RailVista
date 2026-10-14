<script setup lang="ts">
/**
 * 票面高级微调：只暴露「票面真实会渲染」的字段，并按票种显隐。
 * 引导构建器负责成票；此处不做印章 / 海拔等未上票死字段。
 */
import { computed, ref } from 'vue';
import type { TicketRouteConfig, TicketStatItem, TicketTagItem } from '@railvista/shared';
import { classifyRoadSign, scenicPresets } from '@railvista/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { AIRLINES, ALLIANCES, themesForKind } from '../../data/ticket';

const store = useTicketStore();
const emit = defineEmits<{ save: [] }>();
const config = computed(() => store.config);
const kind = computed(() => config.value.kind);
const isRail = computed(() => kind.value === 'railway');
const isDrive = computed(() => kind.value === 'drive');
const isFlight = computed(() => kind.value === 'flight');

function patchRoute(p: Partial<TicketRouteConfig>) {
  store.patch({ route: { ...config.value.route, ...p } });
}
function patchEnd(index: 0 | 1, p: Partial<TicketRouteConfig['ends'][number]>) {
  const ends = [...config.value.route.ends] as TicketRouteConfig['ends'];
  ends[index] = { ...ends[index], ...p };
  patchRoute({ ends });
}

const waypointsText = computed({
  get: () => (config.value.route.waypoints ?? []).join(', '),
  set: (v: string) =>
    patchRoute({ waypoints: v.split(/[,，]/).map((s) => s.trim()).filter(Boolean) }),
});
const shieldsText = computed({
  get: () => (config.value.route.shields ?? []).join(', '),
  set: (v: string) =>
    patchRoute({ shields: v.split(/[,，\s]/).map((s) => s.trim()).filter(Boolean) }),
});

const shieldSpecs = computed(() => (config.value.route.shields ?? []).map((r) => classifyRoadSign(r)));

function appendShield(code: string) {
  const cur = config.value.route.shields ?? [];
  if (cur.includes(code)) return;
  patchRoute({ shields: [...cur, code] });
}

function updateStat(i: number, p: Partial<TicketStatItem>) {
  const stats = config.value.stats.map((s, j) => (j === i ? { ...s, ...p } : s));
  store.patch({ stats });
}
function removeStat(i: number) {
  store.patch({ stats: config.value.stats.filter((_, j) => j !== i) });
}
function addStat() {
  if (config.value.stats.length >= 6) return;
  store.patch({ stats: [...config.value.stats, { label: '新数据项', value: '—' }] });
}

function updateTag(i: number, p: Partial<TicketTagItem>) {
  const tags = config.value.tags.map((t, j) => (j === i ? { ...t, ...p } : t));
  store.patch({ tags });
}
function removeTag(i: number) {
  store.patch({ tags: config.value.tags.filter((_, j) => j !== i) });
}
function addTag(text = '新标签', hot = false) {
  if (config.value.tags.length >= 8) return;
  if (config.value.tags.some((t) => t.text === text)) return;
  store.patch({ tags: [...config.value.tags, { text, hot }] });
}

const TAG_PRESETS = ['风景侧', '已打卡', '窗边', '供氧车厢'] as const;

function onAirlineCode(code: string) {
  const meta = AIRLINES[code];
  if (!meta) return;
  const digits = config.value.airline?.flightNo.match(/\d{3,4}$/)?.[0] ?? '3467';
  store.patch({
    airline: {
      code: meta.code,
      name: meta.name,
      en: meta.en,
      flightNo: `${meta.prefix}${digits}`,
      alliance: meta.alliance,
    },
  });
}

/** 背景图校验提示（替代 window.alert：与页面提示条模式一致，自动消退） */
const bgNotice = ref('');
const bgFileName = ref('');
let bgNoticeTimer: number | undefined;
function showBgNotice(msg: string) {
  bgNotice.value = msg;
  window.clearTimeout(bgNoticeTimer);
  bgNoticeTimer = window.setTimeout(() => {
    bgNotice.value = '';
  }, 4000);
}

function onBgFile(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) {
    showBgNotice('背景图建议小于 1.5MB（需存入本地配置）');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    bgFileName.value = file.name;
    store.patch({
      background: { ...config.value.background, imageUrl: String(reader.result) },
    });
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function clearBgFile() {
  bgFileName.value = '';
  store.patch({
    background: { ...config.value.background, imageUrl: undefined },
  });
}
</script>

<template>
  <div class="ed">
    <!-- 外观 -->
    <section class="ed__sec">
      <h3>外观</h3>
      <label class="ed__row">
        <span>主题</span>
        <select
          class="ed__select"
          :value="config.background.theme"
          @change="store.patch({ background: { ...config.background, theme: ($event.target as HTMLSelectElement).value } })"
        >
          <option v-for="t in themesForKind(config.kind)" :key="t.id" :value="t.id">{{ t.label }}</option>
        </select>
      </label>
      <div class="ed__row">
        <span>背景图</span>
        <div class="ed__file">
          <label class="ed__file-btn">
            <input type="file" accept="image/*" class="ed__file-input" @change="onBgFile" />
            {{ bgFileName || config.background.imageUrl ? '更换图片' : '选择图片' }}
          </label>
          <span class="ed__file-name" :title="bgFileName || undefined">
            {{ bgFileName || (config.background.imageUrl ? '已选背景图' : '未选择') }}
          </span>
          <button
            v-if="bgFileName || config.background.imageUrl"
            type="button"
            class="ed__file-clear"
            @click="clearBgFile"
          >
            清除
          </button>
        </div>
      </div>
      <p v-if="bgNotice" class="ed__hint ed__hint--warn" role="status">{{ bgNotice }}</p>
      <label class="ed__row">
        <span>透明度 {{ config.background.opacity.toFixed(2) }}</span>
        <input
          class="ed__range"
          type="range"
          min="0"
          max="0.6"
          step="0.02"
          :value="config.background.opacity"
          @input="store.patch({ background: { ...config.background, opacity: Number(($event.target as HTMLInputElement).value) } })"
        />
      </label>
    </section>

    <!-- 文案 -->
    <section class="ed__sec">
      <h3>文案</h3>
      <label class="ed__row">
        <span>存档名称</span>
        <input
          class="ed__input"
          :value="config.title"
          placeholder="保存到列表时使用，不印在票面"
          @input="store.patch({ title: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <label class="ed__row">
        <span>票号</span>
        <input class="ed__input" :value="config.serial" @input="store.patch({ serial: ($event.target as HTMLInputElement).value })" />
      </label>
      <template v-if="isDrive">
        <label class="ed__row">
          <span>路线名</span>
          <input class="ed__input" :value="config.subtitle" @input="store.patch({ subtitle: ($event.target as HTMLInputElement).value })" />
        </label>
        <label class="ed__row">
          <span>日期行</span>
          <input class="ed__input" :value="config.dateText" @input="store.patch({ dateText: ($event.target as HTMLInputElement).value })" />
        </label>
        <label class="ed__row">
          <span>行程摘要</span>
          <input class="ed__input" :value="config.metaLeft ?? ''" @input="store.patch({ metaLeft: ($event.target as HTMLInputElement).value })" />
        </label>
      </template>
      <template v-if="isRail">
        <label class="ed__row">
          <span>乘车信息</span>
          <input class="ed__input" :value="config.metaLeft ?? ''" placeholder="日期 · 开车时刻" @input="store.patch({ metaLeft: ($event.target as HTMLInputElement).value })" />
        </label>
        <label class="ed__row">
          <span>座位信息</span>
          <input class="ed__input" :value="config.metaRight ?? ''" placeholder="车厢 / 座位" @input="store.patch({ metaRight: ($event.target as HTMLInputElement).value })" />
        </label>
      </template>
    </section>

    <!-- 路线 -->
    <section class="ed__sec">
      <h3>路线</h3>

      <template v-if="isRail">
        <label class="ed__row"><span>出发站</span><input class="ed__input" :value="config.route.ends[0].name" @input="patchEnd(0, { name: ($event.target as HTMLInputElement).value })" /></label>
        <label class="ed__row"><span>出发拼音</span><input class="ed__input" :value="config.route.ends[0].pinyin ?? ''" @input="patchEnd(0, { pinyin: ($event.target as HTMLInputElement).value || undefined })" /></label>
        <label class="ed__row"><span>到达站</span><input class="ed__input" :value="config.route.ends[1].name" @input="patchEnd(1, { name: ($event.target as HTMLInputElement).value })" /></label>
        <label class="ed__row"><span>到达拼音</span><input class="ed__input" :value="config.route.ends[1].pinyin ?? ''" @input="patchEnd(1, { pinyin: ($event.target as HTMLInputElement).value || undefined })" /></label>
        <label class="ed__row"><span>车次</span><input class="ed__input" placeholder="如 Z8991" :value="config.route.middleLabel ?? ''" @input="patchRoute({ middleLabel: ($event.target as HTMLInputElement).value || undefined })" /></label>
      </template>

      <template v-else-if="isDrive">
        <label class="ed__row"><span>途经点</span><input class="ed__input" placeholder="逗号分隔，如 西宁,青海湖,敦煌" v-model="waypointsText" /></label>
        <label class="ed__row"><span>路牌</span><input class="ed__input" placeholder="G6, G109, 此生必驾318" v-model="shieldsText" /></label>
        <div class="ed__row">
          <span>快捷加</span>
          <div class="ed__chips">
            <button v-for="p in scenicPresets()" :key="p.ref" class="ed__chip" type="button" @click="appendShield(p.ref)">{{ p.label }}</button>
            <button class="ed__chip" type="button" @click="appendShield('G6')">+ G6</button>
            <button class="ed__chip" type="button" @click="appendShield('G109')">+ G109</button>
            <button class="ed__chip" type="button" @click="appendShield('S203')">+ S203</button>
          </div>
        </div>
        <p v-if="shieldSpecs.length" class="ed__hint">
          {{ shieldSpecs.map((s) => `${s.ref}→${s.label}${s.scenicName ? '·' + s.scenicName : ''}`).join('；') }}
        </p>
      </template>

      <template v-else>
        <label class="ed__row"><span>出发机场</span><input class="ed__input" :value="config.route.ends[0].name" @input="patchEnd(0, { name: ($event.target as HTMLInputElement).value })" /></label>
        <label class="ed__row"><span>出发三字码</span><input class="ed__input" :value="config.route.ends[0].code ?? ''" @input="patchEnd(0, { code: ($event.target as HTMLInputElement).value || undefined })" /></label>
        <label class="ed__row"><span>出发英文</span><input class="ed__input" :value="config.route.ends[0].pinyin ?? ''" @input="patchEnd(0, { pinyin: ($event.target as HTMLInputElement).value || undefined })" /></label>
        <label class="ed__row"><span>到达机场</span><input class="ed__input" :value="config.route.ends[1].name" @input="patchEnd(1, { name: ($event.target as HTMLInputElement).value })" /></label>
        <label class="ed__row"><span>到达三字码</span><input class="ed__input" :value="config.route.ends[1].code ?? ''" @input="patchEnd(1, { code: ($event.target as HTMLInputElement).value || undefined })" /></label>
        <label class="ed__row"><span>到达英文</span><input class="ed__input" :value="config.route.ends[1].pinyin ?? ''" @input="patchEnd(1, { pinyin: ($event.target as HTMLInputElement).value || undefined })" /></label>
        <label class="ed__row"><span>航班号</span><input class="ed__input" placeholder="如 CZ3467" :value="config.route.middleLabel ?? ''" @input="patchRoute({ middleLabel: ($event.target as HTMLInputElement).value || undefined })" /></label>
      </template>
    </section>

    <!-- 数据：宫格 + 标签 -->
    <section class="ed__sec">
      <h3>数据与标签</h3>
      <p class="ed__hint">宫格建议不超过 6 项；标签不超过 8 个。</p>
      <div v-for="(s, i) in config.stats" :key="'s' + i" class="ed__listrow">
        <input class="ed__input" placeholder="标签" :value="s.label" @input="updateStat(i, { label: ($event.target as HTMLInputElement).value })" />
        <input class="ed__input" placeholder="值" :value="s.value" @input="updateStat(i, { value: ($event.target as HTMLInputElement).value })" />
        <input class="ed__input ed__input--narrow" placeholder="单位" :value="s.unit ?? ''" @input="updateStat(i, { unit: ($event.target as HTMLInputElement).value || undefined })" />
        <button class="btn ghost btn-sm" type="button" @click="removeStat(i)">删</button>
      </div>
      <button class="btn ghost btn-sm" type="button" :disabled="config.stats.length >= 6" @click="addStat">+ 数据项</button>

      <div v-for="(t, i) in config.tags" :key="'t' + i" class="ed__listrow">
        <input class="ed__input" placeholder="文案" :value="t.text" @input="updateTag(i, { text: ($event.target as HTMLInputElement).value })" />
        <label class="ed__check"><input type="checkbox" :checked="!!t.hot" @change="updateTag(i, { hot: ($event.target as HTMLInputElement).checked })" />高亮</label>
        <button class="btn ghost btn-sm" type="button" @click="removeTag(i)">删</button>
      </div>
      <div class="ed__chips">
        <button
          v-for="p in TAG_PRESETS"
          :key="p"
          class="ed__chip"
          type="button"
          :disabled="config.tags.length >= 8"
          @click="addTag(p, true)"
        >
          + {{ p }}
        </button>
        <button class="ed__chip" type="button" :disabled="config.tags.length >= 8" @click="addTag()">+ 自定义</button>
      </div>
    </section>

    <!-- 页脚：感言 / 码 / 品牌 -->
    <section class="ed__sec">
      <h3>感言与页脚</h3>
      <label class="ed__row">
        <span>感言</span>
        <textarea
          class="ed__input ed__textarea"
          rows="2"
          :value="config.quote"
          @input="store.patch({ quote: ($event.target as HTMLTextAreaElement).value })"
        ></textarea>
      </label>

      <label
        v-if="!isFlight"
        class="ed__check"
      >
        <input
          type="checkbox"
          :checked="config.qr.enabled"
          @change="store.patch({ qr: { ...config.qr, enabled: ($event.target as HTMLInputElement).checked } })"
        />
        启用二维码
      </label>
      <label class="ed__check">
        <input
          type="checkbox"
          :checked="config.brand.watermark"
          @change="store.patch({ brand: { ...config.brand, watermark: ($event.target as HTMLInputElement).checked } })"
        />
        票面品牌水印
      </label>
    </section>

    <!-- 航司（飞行） -->
    <section v-if="isFlight" class="ed__sec">
      <h3>承运航司</h3>
      <label class="ed__row">
        <span>航司</span>
        <select class="ed__select" :value="config.airline?.code ?? ''" @change="onAirlineCode(($event.target as HTMLSelectElement).value)">
          <option v-for="a in Object.values(AIRLINES)" :key="a.code" :value="a.code">{{ a.name }} {{ a.prefix }}</option>
        </select>
      </label>
      <label class="ed__row">
        <span>航班号</span>
        <input
          class="ed__input"
          :value="config.airline?.flightNo ?? ''"
          @input="store.patch({ airline: { ...(config.airline ?? { code: '', name: '', en: '', flightNo: '' }), flightNo: ($event.target as HTMLInputElement).value } })"
        />
      </label>
      <label class="ed__row">
        <span>联盟</span>
        <select
          class="ed__select"
          :value="config.airline?.alliance ?? ''"
          @change="store.patch({ airline: { ...(config.airline ?? { code: '', name: '', en: '', flightNo: '' }), alliance: ($event.target as HTMLSelectElement).value || null } })"
        >
          <option value="">无</option>
          <option v-for="(a, id) in ALLIANCES" :key="id" :value="id">{{ a.name }}</option>
        </select>
      </label>
    </section>

    <div class="ed__actions">
      <button class="btn primary btn-sm" type="button" @click="emit('save')">保存配置</button>
      <button class="btn ghost btn-sm" type="button" @click="store.newTicket(config.kind)">恢复默认</button>
    </div>
  </div>
</template>

<style scoped>
.ed { display: flex; flex-direction: column; gap: var(--space-2); }
.ed__sec { display: flex; flex-direction: column; gap: var(--space-1); }
.ed__sec h3 {
  font-size: var(--fs-meta); font-weight: 600; letter-spacing: 1px;
  color: var(--text-2); margin: 0;
  padding-bottom: 6px; border-bottom: 1px solid var(--surface-3);
}
.ed__row { display: grid; grid-template-columns: 84px 1fr; gap: var(--space-1); align-items: center; }
.ed__row > span { font-size: var(--fs-meta); color: var(--text-3); }
.ed__input,
.ed__select {
  width: 100%; min-height: 46px;
  background: var(--surface-2); color: var(--text-1);
  border: 1px solid var(--surface-3); border-radius: var(--radius-sm);
  padding: 4px var(--space-1); font-size: var(--fs-meta); font-family: inherit;
  outline: none; transition: border-color var(--dur-fast) var(--ease-standard);
}
.ed__input:focus,
.ed__select:focus { border-color: var(--accent); }
.ed__input--narrow { max-width: 64px; }
.ed__textarea { resize: vertical; min-height: 52px; }
.ed__range { width: 100%; accent-color: var(--accent); }
.ed__file {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ed__file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
.ed__file-btn {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-default);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--fs-meta);
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    background var(--dur-fast) var(--ease-standard);
}
@media (hover: hover) and (pointer: fine) {
  .ed__file-btn:hover {
    border-color: var(--accent-border, var(--accent));
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }
}
.ed__file-btn:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.ed__file-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-cap);
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ed__file-clear {
  flex: none;
  min-height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-3);
  font-size: var(--fs-cap);
  cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  .ed__file-clear:hover { color: var(--danger); }
}
.ed__check { display: flex; align-items: center; gap: 6px; font-size: var(--fs-meta); color: var(--text-2); }
.ed__check input { accent-color: var(--accent); }
.ed__listrow { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.ed__listrow .ed__input { flex: 1; min-width: 70px; }
.ed__chips { display: flex; gap: 6px; flex-wrap: wrap; }
.ed__chip {
  font-size: var(--fs-cap); color: var(--text-2);
  background: var(--surface-2); border: 1px solid var(--surface-3);
  border-radius: var(--radius-full); padding: 3px 10px; cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.ed__chip:disabled { opacity: 0.45; cursor: not-allowed; }
@media (hover: hover) and (pointer: fine) {
  .ed__chip:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
}
.ed__hint { font-size: var(--fs-cap); color: var(--text-3); margin: 0; line-height: 1.6; }
.ed__hint--warn { color: var(--warning); }
.ed__actions { display: flex; gap: var(--space-1); justify-content: flex-end; }

@media (pointer: coarse) {
  .ed__chip {
    display: inline-flex;
    align-items: center;
    min-height: 38px;
    padding: 8px 14px;
  }
  .ed__check {
    min-height: 40px;
  }
  .ed__check input {
    width: 20px;
    height: 20px;
  }
  .ed__range {
    height: 32px;
  }
  .ed__listrow .btn {
    min-width: 44px;
    min-height: 40px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ed__input,
  .ed__chip {
    transition: none;
  }
}
</style>
