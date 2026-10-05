<script setup lang="ts">
/**
 * 票面配置编辑器：TicketConfig 所有展示项均可编辑，禁止硬编码文案。
 * 直接读写 ticketStore.config（草稿自动落盘），保存动作入 saved 列表。
 */
import { computed } from 'vue';
import type {
  TicketRouteConfig,
  TicketSealEmblem,
  TicketStatItem,
  TicketTagItem,
} from '@railvista/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { AIRLINES, ALLIANCES, themesForKind } from '../../data/ticket';

const store = useTicketStore();
const config = computed(() => store.config);

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
const elevText = computed({
  get: () => (config.value.route.elevPoints ?? []).join(', '),
  set: (v: string) =>
    patchRoute({
      elevPoints: v
        .split(/[,，\s]/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n)),
    }),
});

function updateStat(i: number, p: Partial<TicketStatItem>) {
  const stats = config.value.stats.map((s, j) => (j === i ? { ...s, ...p } : s));
  store.patch({ stats });
}
function removeStat(i: number) {
  store.patch({ stats: config.value.stats.filter((_, j) => j !== i) });
}
function addStat() {
  store.patch({ stats: [...config.value.stats, { label: '新数据项', value: '—' }] });
}
function updateTag(i: number, p: Partial<TicketTagItem>) {
  const tags = config.value.tags.map((t, j) => (j === i ? { ...t, ...p } : t));
  store.patch({ tags });
}
function removeTag(i: number) {
  store.patch({ tags: config.value.tags.filter((_, j) => j !== i) });
}
function addTag() {
  store.patch({ tags: [...config.value.tags, { text: '新标签' }] });
}

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

function onBgFile(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) {
    window.alert('背景图建议小于 1.5MB（需存入本地配置）');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    store.patch({
      background: { ...config.value.background, imageUrl: String(reader.result) },
    });
  };
  reader.readAsDataURL(file);
  input.value = '';
}

const EMBLEMS: { value: TicketSealEmblem; label: string }[] = [
  { value: 'none', label: '无徽记' },
  { value: 'rail', label: '铁路徽' },
  { value: 'road', label: '公路徽' },
  { value: 'air', label: '民航徽' },
];
</script>

<template>
  <div class="ed">
    <!-- 主题 -->
    <section class="ed__sec">
      <h3>票面主题</h3>
      <label class="ed__row">
        <span>风格</span>
        <select
          class="ed__select"
          :value="config.background.theme"
          @change="store.patch({ background: { ...config.background, theme: ($event.target as HTMLSelectElement).value } })"
        >
          <option v-for="t in themesForKind(config.kind)" :key="t.id" :value="t.id">{{ t.label }}</option>
        </select>
      </label>
      <label class="ed__row">
        <span>背景图</span>
        <input
          class="ed__input"
          type="text"
          placeholder="URL 或留空（也可选文件）"
          :value="config.background.imageUrl ?? ''"
          @change="store.patch({ background: { ...config.background, imageUrl: ($event.target as HTMLInputElement).value || undefined } })"
        />
      </label>
      <label class="ed__row">
        <span>选文件</span>
        <input class="ed__input" type="file" accept="image/*" @change="onBgFile" />
      </label>
      <label class="ed__row">
        <span>背景图透明度 {{ config.background.opacity.toFixed(2) }}</span>
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

    <!-- 基础文案 -->
    <section class="ed__sec">
      <h3>基础文案</h3>
      <label class="ed__row"><span>主标题</span><input class="ed__input" :value="config.title" @input="store.patch({ title: ($event.target as HTMLInputElement).value })" /></label>
      <label class="ed__row"><span>副标题</span><input class="ed__input" :value="config.subtitle" @input="store.patch({ subtitle: ($event.target as HTMLInputElement).value })" /></label>
      <label class="ed__row"><span>票号</span><input class="ed__input" :value="config.serial" @input="store.patch({ serial: ($event.target as HTMLInputElement).value })" /></label>
      <label class="ed__row"><span>日期行</span><input class="ed__input" :value="config.dateText" @input="store.patch({ dateText: ($event.target as HTMLInputElement).value })" /></label>
      <label class="ed__row"><span>路线左注</span><input class="ed__input" :value="config.metaLeft ?? ''" @input="store.patch({ metaLeft: ($event.target as HTMLInputElement).value })" /></label>
      <label class="ed__row"><span>路线右注</span><input class="ed__input" :value="config.metaRight ?? ''" @input="store.patch({ metaRight: ($event.target as HTMLInputElement).value })" /></label>
    </section>

    <!-- 路线 -->
    <section class="ed__sec">
      <h3>路线</h3>
      <label class="ed__row"><span>起点名</span><input class="ed__input" :value="config.route.ends[0].name" @input="patchEnd(0, { name: ($event.target as HTMLInputElement).value })" /></label>
      <label class="ed__row"><span>起点拼音</span><input class="ed__input" :value="config.route.ends[0].pinyin ?? ''" @input="patchEnd(0, { pinyin: ($event.target as HTMLInputElement).value || undefined })" /></label>
      <label class="ed__row"><span>起点三字码</span><input class="ed__input" :value="config.route.ends[0].code ?? ''" @input="patchEnd(0, { code: ($event.target as HTMLInputElement).value || undefined })" /></label>
      <label class="ed__row"><span>终点名</span><input class="ed__input" :value="config.route.ends[1].name" @input="patchEnd(1, { name: ($event.target as HTMLInputElement).value })" /></label>
      <label class="ed__row"><span>终点拼音</span><input class="ed__input" :value="config.route.ends[1].pinyin ?? ''" @input="patchEnd(1, { pinyin: ($event.target as HTMLInputElement).value || undefined })" /></label>
      <label class="ed__row"><span>终点三字码</span><input class="ed__input" :value="config.route.ends[1].code ?? ''" @input="patchEnd(1, { code: ($event.target as HTMLInputElement).value || undefined })" /></label>
      <label class="ed__row"><span>中线胶囊</span><input class="ed__input" placeholder="车次号 / 航班号" :value="config.route.middleLabel ?? ''" @input="patchRoute({ middleLabel: ($event.target as HTMLInputElement).value || undefined })" /></label>
      <label class="ed__row"><span>途经点链</span><input class="ed__input" placeholder="逗号分隔，>2 项时启用" v-model="waypointsText" /></label>
      <label class="ed__row"><span>路牌编号</span><input class="ed__input" placeholder="G6, G3011, G109" v-model="shieldsText" /></label>
      <label class="ed__row"><span>海拔采样</span><input class="ed__input" placeholder="2200, 3200, 3817…" v-model="elevText" /></label>
      <label class="ed__row"><span>峰值标注</span><input class="ed__input" :value="config.route.elevPeakLabel ?? ''" @input="patchRoute({ elevPeakLabel: ($event.target as HTMLInputElement).value || undefined })" /></label>
    </section>

    <!-- 数据宫格 -->
    <section class="ed__sec">
      <h3>数据宫格</h3>
      <div v-for="(s, i) in config.stats" :key="i" class="ed__listrow">
        <input class="ed__input" placeholder="标签" :value="s.label" @input="updateStat(i, { label: ($event.target as HTMLInputElement).value })" />
        <input class="ed__input" placeholder="值" :value="s.value" @input="updateStat(i, { value: ($event.target as HTMLInputElement).value })" />
        <input class="ed__input ed__input--narrow" placeholder="单位" :value="s.unit ?? ''" @input="updateStat(i, { unit: ($event.target as HTMLInputElement).value || undefined })" />
        <button class="btn ghost btn-sm" type="button" @click="removeStat(i)">删</button>
      </div>
      <button class="btn ghost btn-sm" type="button" @click="addStat">+ 数据项</button>
    </section>

    <!-- 标签 -->
    <section class="ed__sec">
      <h3>标签胶囊</h3>
      <div v-for="(t, i) in config.tags" :key="i" class="ed__listrow">
        <input class="ed__input" placeholder="文案" :value="t.text" @input="updateTag(i, { text: ($event.target as HTMLInputElement).value })" />
        <label class="ed__check"><input type="checkbox" :checked="!!t.hot" @change="updateTag(i, { hot: ($event.target as HTMLInputElement).checked })" />高亮</label>
        <button class="btn ghost btn-sm" type="button" @click="removeTag(i)">删</button>
      </div>
      <button class="btn ghost btn-sm" type="button" @click="addTag">+ 标签</button>
    </section>

    <!-- 感言 / 印章 / 二维码 / 品牌 -->
    <section class="ed__sec">
      <h3>感言 · 印章 · 二维码 · 品牌</h3>
      <label class="ed__row"><span>一句话感言</span><textarea class="ed__input ed__textarea" rows="2" :value="config.quote" @input="store.patch({ quote: ($event.target as HTMLTextAreaElement).value })"></textarea></label>
      <label class="ed__check"><input type="checkbox" :checked="config.seal.enabled" @change="store.patch({ seal: { ...config.seal, enabled: ($event.target as HTMLInputElement).checked } })" />启用印章</label>
      <label class="ed__row">
        <span>徽记</span>
        <select class="ed__select" :value="config.seal.emblem" @change="store.patch({ seal: { ...config.seal, emblem: ($event.target as HTMLSelectElement).value as TicketSealEmblem } })">
          <option v-for="e in EMBLEMS" :key="e.value" :value="e.value">{{ e.label }}</option>
        </select>
      </label>
      <label class="ed__row"><span>印章文字</span><input class="ed__input" :value="config.seal.text" @input="store.patch({ seal: { ...config.seal, text: ($event.target as HTMLInputElement).value } })" /></label>
      <label class="ed__row"><span>印章副文</span><input class="ed__input" :value="config.seal.sub ?? ''" @input="store.patch({ seal: { ...config.seal, sub: ($event.target as HTMLInputElement).value || undefined } })" /></label>
      <label class="ed__check"><input type="checkbox" :checked="config.qr.enabled" @change="store.patch({ qr: { ...config.qr, enabled: ($event.target as HTMLInputElement).checked } })" />启用二维码</label>
      <label class="ed__row"><span>二维码注</span><input class="ed__input" :value="config.qr.caption" @input="store.patch({ qr: { ...config.qr, caption: ($event.target as HTMLInputElement).value } })" /></label>
      <label class="ed__row"><span>二维码内容</span><input class="ed__input" :value="config.qr.value" @input="store.patch({ qr: { ...config.qr, value: ($event.target as HTMLInputElement).value } })" /></label>
      <label class="ed__check"><input type="checkbox" :checked="config.brand.logo" @change="store.patch({ brand: { ...config.brand, logo: ($event.target as HTMLInputElement).checked } })" />顶部品牌微标</label>
      <label class="ed__check"><input type="checkbox" :checked="config.brand.watermark" @change="store.patch({ brand: { ...config.brand, watermark: ($event.target as HTMLInputElement).checked } })" />票面品牌水印</label>
      <label class="ed__row"><span>页脚文字</span><textarea class="ed__input ed__textarea" rows="2" :value="config.brand.footerText" @input="store.patch({ brand: { ...config.brand, footerText: ($event.target as HTMLTextAreaElement).value } })"></textarea></label>
    </section>

    <!-- 航司（飞行票） -->
    <section v-if="config.kind === 'flight'" class="ed__sec">
      <h3>承运航司</h3>
      <label class="ed__row">
        <span>航司</span>
        <select class="ed__select" :value="config.airline?.code ?? ''" @change="onAirlineCode(($event.target as HTMLSelectElement).value)">
          <option v-for="a in Object.values(AIRLINES)" :key="a.code" :value="a.code">{{ a.name }} {{ a.prefix }}</option>
        </select>
      </label>
      <label class="ed__row"><span>航班号</span><input class="ed__input" :value="config.airline?.flightNo ?? ''" @input="store.patch({ airline: { ...(config.airline ?? { code: '', name: '', en: '', flightNo: '' }), flightNo: ($event.target as HTMLInputElement).value } })" /></label>
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
      <p class="ed__hint">联盟口径：南航 2019 年已退出天合联盟；选航司时会自动带出正确联盟。</p>
    </section>

    <div class="ed__actions">
      <button class="btn primary btn-sm" type="button" @click="store.save()">保存配置</button>
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
  width: 100%; min-height: 34px;
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
.ed__check { display: flex; align-items: center; gap: 6px; font-size: var(--fs-meta); color: var(--text-2); }
.ed__check input { accent-color: var(--accent); }
.ed__listrow { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.ed__listrow .ed__input { flex: 1; min-width: 70px; }
.ed__hint { font-size: var(--fs-cap); color: var(--text-3); margin: 0; line-height: 1.6; }
.ed__actions { display: flex; gap: var(--space-1); justify-content: flex-end; }
</style>
