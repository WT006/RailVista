<script setup lang="ts">
/**
 * 纪念票票面渲染器：纯 config 驱动，分票种精致版式。
 * - 铁路：真实车票双行站名（拼音）+ 规范中国铁路路徽
 * - 自驾：途经点链 + 国标路牌 + 黑金「此生必驾」盾牌
 * - 飞行：登机牌版式（大 IATA、机场英文名、条码），不含任何自驾元素
 * 主题色板来自 src/data/ticket.ts，经 CSS 变量注入。
 */
import { computed } from 'vue';
import { mustDriveFromShields, type TicketConfig } from '@railvista/shared';
import { AIRLINES, ALLIANCES, TICKET_KIND_META, ticketTheme } from '../../data/ticket';
import RoadShield from './RoadShield.vue';
import brandLockup from '../../assets/heyworld-brand.png';
import brandMark from '../../assets/heyworld-logo.png';
import railwayMark from '../../assets/ticket/china-railway-mark.png';

const props = defineProps<{ config: TicketConfig }>();

const theme = computed(() => ticketTheme(props.config.background.theme));

const styleVars = computed<Record<string, string>>(() => {
  const t = theme.value;
  return {
    '--tk-grad': `linear-gradient(165deg, ${t.grad[0]} 0%, ${t.grad[1]} 48%, ${t.grad[2]} 100%)`,
    '--tk-acc': t.accent,
    '--tk-acc-hi': t.accentHi,
    '--tk-tx': t.fg.tx,
    '--tk-tx2': t.fg.tx2,
    '--tk-tx3': t.fg.tx3,
    '--tk-line': t.fg.line,
    '--tk-chip': t.fg.chip,
    '--tk-chip-line': t.fg.chipLine,
    '--tk-serial': t.serialColor ?? t.accent,
  };
});

const kindMeta = computed(() => TICKET_KIND_META[props.config.kind]);
const airline = computed(() => {
  const ref = props.config.airline;
  if (!ref?.code) return null;
  return AIRLINES[ref.code.toLowerCase()] ?? null;
});
const ALLIANCE_KEY_MAP: Record<string, string> = {
  '星空联盟': 'staralliance',
  '天合联盟': 'skyteam',
  '寰宇一家': 'oneworld',
};
const alliance = computed(() => {
  const id = props.config.airline?.alliance;
  if (!id) return null;
  const key = ALLIANCE_KEY_MAP[id] ?? id;
  return ALLIANCES[key] ?? null;
});

const shields = computed(() => props.config.route.shields ?? []);
const waypoints = computed(() => props.config.route.waypoints ?? []);
const mustNumber = computed(() => mustDriveFromShields(shields.value));
/** 路牌展示列表：若已出现此生必驾徽记，则隐藏同编号的普通国道路牌，避免重复 */
const displayShields = computed(() => {
  if (!mustNumber.value) return shields.value;
  return shields.value.filter((s) => s.replace(/^[A-Za-z]/, '') !== mustNumber.value);
});

/** 确定性伪二维码（由 qr.value 哈希播种） */
const qrCells = computed(() => {
  const s = props.config.qr.value || 'railvista';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = 21;
  const inFinder = (r: number, c: number) =>
    (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
  const cells: { r: number; c: number }[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!inFinder(r, c) && rnd() > 0.52) cells.push({ r, c });
    }
  }
  return cells;
});

/** 确定性一维条码（登机牌用）：条宽 1-3 */
const barcode = computed<number[]>(() => {
  const s = props.config.serial || 'barcode';
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 46 }, () => 1 + Math.floor(rnd() * 3));
});

const endA = computed(() => props.config.route.ends[0]);
const endB = computed(() => props.config.route.ends[1]);
</script>

<template>
  <div class="tk" :class="`tk--${config.kind}`" :style="styleVars">
    <img
      v-if="config.background.imageUrl"
      class="tk__bgimg"
      :src="config.background.imageUrl"
      :style="{ opacity: config.background.opacity }"
      alt=""
      aria-hidden="true"
    />
    <img v-if="config.brand.watermark" class="tk__wm" :src="brandLockup" alt="" aria-hidden="true" />
    <span class="tk__corner tk__corner--tl" aria-hidden="true"></span>
    <span class="tk__corner tk__corner--tr" aria-hidden="true"></span>
    <span class="tk__corner tk__corner--bl" aria-hidden="true"></span>
    <span class="tk__corner tk__corner--br" aria-hidden="true"></span>

    <div class="tk__inner">
      <!-- ════════════ 铁路 ════════════ -->
      <template v-if="config.kind === 'railway'">
        <header class="rail-head">
          <div class="rail-head__brand">
            <img class="rail-head__mark" :src="railwayMark" alt="中国铁路" />
            <div class="rail-head__txt">
              <strong>中国铁路</strong>
              <span>CHINA RAILWAY</span>
            </div>
          </div>
          <span class="rail-head__serial">{{ config.serial }}</span>
        </header>

        <div class="rail-label">电子纪念票 · ELECTRONIC TICKET</div>

        <section class="rail-route">
          <div class="rail-end">
            <strong>{{ endA?.name }}</strong>
            <span>{{ endA?.pinyin }}</span>
          </div>
          <div class="rail-line">
            <span class="rail-line__code">{{ config.route.middleLabel }}</span>
            <span class="rail-line__track"></span>
            <svg class="rail-line__train" viewBox="0 0 24 24" width="22" height="22">
              <path fill="currentColor" d="M12 2C8 2 6 3.6 6 7v7.5A2.5 2.5 0 008.5 17l-1.5 2h1.6l1.5-2h3.8l1.5 2H17l-1.5-2a2.5 2.5 0 002.5-2.5V7c0-3.4-2-5-6-5zm-2.5 3h5A1.5 1.5 0 0116 6.5V10H8V6.5A1.5 1.5 0 019.5 5zM8.5 13a1.3 1.3 0 110 2.6 1.3 1.3 0 010-2.6zm7 0a1.3 1.3 0 110 2.6 1.3 1.3 0 010-2.6z"/>
            </svg>
          </div>
          <div class="rail-end rail-end--r">
            <strong>{{ endB?.name }}</strong>
            <span>{{ endB?.pinyin }}</span>
          </div>
        </section>

        <div class="rail-strip">
          <div class="rail-strip__cell">
            <span>乘车日期 / 开车</span>
            <strong>{{ config.metaLeft || '—' }}</strong>
          </div>
          <div class="rail-strip__cell rail-strip__cell--r">
            <span>车厢 / 座位</span>
            <strong>{{ config.metaRight || '待补' }}</strong>
          </div>
        </div>

        <div class="tk-stats">
          <div v-for="s in config.stats" :key="s.label" class="tk-stats__item">
            <span class="tk-stats__label">{{ s.label }}</span>
            <span class="tk-stats__value">{{ s.value }}<em v-if="s.unit">{{ s.unit }}</em></span>
          </div>
        </div>

        <div v-if="config.tags.length" class="tk-tags">
          <span v-for="t in config.tags" :key="t.text" class="tk-tag" :class="{ 'tk-tag--hot': t.hot }">{{ t.text }}</span>
        </div>
        <p v-if="config.quote" class="tk-quote">{{ config.quote }}</p>
      </template>

      <!-- ════════════ 自驾 ════════════ -->
      <template v-else-if="config.kind === 'drive'">
        <header class="dr-head">
          <div class="dr-head__brand">
            <img :src="brandMark" alt="" />
            <div>
              <strong>自驾纪念票</strong>
              <span>ROAD TRIP TICKET</span>
            </div>
          </div>
          <span class="dr-head__serial">{{ config.serial }}</span>
        </header>

        <h2 class="dr-name">{{ config.subtitle || '我的自驾路线' }}</h2>
        <p v-if="config.metaLeft" class="dr-summary">{{ config.metaLeft }}</p>

        <section v-if="waypoints.length" class="dr-way">
          <template v-for="(w, i) in waypoints" :key="w + i">
            <span class="dr-way__dot" :class="{ 'dr-way__dot--end': i === 0 || i === waypoints.length - 1 }"></span>
            <span class="dr-way__name">{{ w }}</span>
            <span v-if="i < waypoints.length - 1" class="dr-way__seg"></span>
          </template>
        </section>

        <section v-if="mustNumber || displayShields.length" class="dr-shields">
          <RoadShield v-if="mustNumber" :key="'must'" :code="`此生必驾${mustNumber}`" />
          <RoadShield v-for="(s, i) in displayShields" :key="s + i" :code="s" />
        </section>

        <div class="tk-stats">
          <div v-for="s in config.stats" :key="s.label" class="tk-stats__item">
            <span class="tk-stats__label">{{ s.label }}</span>
            <span class="tk-stats__value">{{ s.value }}<em v-if="s.unit">{{ s.unit }}</em></span>
          </div>
        </div>

        <div v-if="config.tags.length" class="tk-tags">
          <span v-for="t in config.tags" :key="t.text" class="tk-tag" :class="{ 'tk-tag--hot': t.hot }">{{ t.text }}</span>
        </div>
        <p v-if="config.quote" class="tk-quote">{{ config.quote }}</p>
      </template>

      <!-- ════════════ 飞行 ════════════ -->
      <template v-else>
        <header class="fl-head">
          <div class="fl-head__air">
            <img v-if="airline?.logo" :src="airline.logo" class="fl-head__logo" :alt="airline.name" />
            <div class="fl-head__txt">
              <strong>{{ airline?.name || config.airline?.name || '航班' }}</strong>
              <span>{{ airline?.en || config.airline?.en || 'AIRLINE' }}</span>
            </div>
          </div>
          <div class="fl-head__right">
            <img v-if="alliance?.logo" :src="alliance.logo" class="fl-head__alliance-logo" :alt="alliance.name" />
            <span class="fl-head__no">{{ config.route.middleLabel }}</span>
          </div>
        </header>

        <section class="fl-route">
          <div class="fl-city">
            <strong>{{ endA?.code }}</strong>
            <span class="fl-city__cn">{{ endA?.name }}</span>
            <span class="fl-city__en">{{ endA?.pinyin }}</span>
          </div>
          <div class="fl-track">
            <span class="fl-track__line"></span>
            <svg viewBox="0 0 24 24" width="24" height="24" class="fl-track__plane">
              <path fill="currentColor" d="M21 15.4v-2l-8-5V3.5a1.5 1.5 0 00-3 0V8.4l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-6.1z"/>
            </svg>
            <span class="fl-track__line"></span>
          </div>
          <div class="fl-city fl-city--r">
            <strong>{{ endB?.code }}</strong>
            <span class="fl-city__cn">{{ endB?.name }}</span>
            <span class="fl-city__en">{{ endB?.pinyin }}</span>
          </div>
        </section>

        <div class="tk-stats tk-stats--flight">
          <div v-for="s in config.stats" :key="s.label" class="tk-stats__item">
            <span class="tk-stats__label">{{ s.label }}</span>
            <span class="tk-stats__value">{{ s.value }}<em v-if="s.unit">{{ s.unit }}</em></span>
          </div>
        </div>

        <div v-if="config.tags.length" class="tk-tags">
          <span v-for="t in config.tags" :key="t.text" class="tk-tag" :class="{ 'tk-tag--hot': t.hot }">{{ t.text }}</span>
        </div>
        <p v-if="config.quote" class="tk-quote">{{ config.quote }}</p>
      </template>

      <!-- ════════════ 页脚 ════════════ -->
      <footer class="tk-foot">
        <template v-if="config.kind === 'flight'">
          <div class="tk-foot__barcode">
            <span
              v-for="(w, i) in barcode"
              :key="i"
              class="tk-foot__bar"
              :style="{ width: w + 'px' }"
            ></span>
          </div>
          <span class="tk-foot__serial">{{ config.serial }}</span>
        </template>
        <template v-else>
          <svg v-if="config.qr.enabled" class="tk-foot__qr" viewBox="0 0 21 21" shape-rendering="crispEdges">
            <rect width="21" height="21" fill="#fff" />
            <rect v-for="c in qrCells" :key="c.r + '-' + c.c" :x="c.c" :y="c.r" width="1" height="1" fill="#111" />
            <!-- finder patterns -->
            <g fill="#111">
              <rect x="0" y="0" width="7" height="7" fill="none" stroke="#111" stroke-width="1.4"/>
              <rect x="2.2" y="2.2" width="2.6" height="2.6"/>
              <rect x="14" y="0" width="7" height="7" fill="none" stroke="#111" stroke-width="1.4"/>
              <rect x="16.2" y="2.2" width="2.6" height="2.6"/>
              <rect x="0" y="14" width="7" height="7" fill="none" stroke="#111" stroke-width="1.4"/>
              <rect x="2.2" y="16.2" width="2.6" height="2.6"/>
            </g>
          </svg>
          <div class="tk-foot__meta">
            <span class="tk-foot__caption">{{ config.qr.caption }}</span>
            <span class="tk-foot__ftext">{{ config.brand.footerText.split('\n')[0] }}</span>
          </div>
          <span class="tk-foot__serial">{{ config.serial }}</span>
        </template>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.tk {
  position: relative;
  width: 100%; height: 100%;
  border-radius: 22px;
  overflow: hidden;
  color: var(--tk-tx);
  background: var(--tk-grad);
  border: 1px solid var(--tk-line);
  box-shadow: 0 24px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08);
}
.tk__bgimg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
.tk__wm {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
  width: 62%; opacity: 0.06; z-index: 0; pointer-events: none;
}
.tk__corner { position: absolute; width: 16px; height: 16px; z-index: 3; opacity: 0.5; }
.tk__corner--tl { top: 12px; left: 12px; border-top: 1.5px solid var(--tk-acc); border-left: 1.5px solid var(--tk-acc); border-top-left-radius: 6px; }
.tk__corner--tr { top: 12px; right: 12px; border-top: 1.5px solid var(--tk-acc); border-right: 1.5px solid var(--tk-acc); border-top-right-radius: 6px; }
.tk__corner--bl { bottom: 12px; left: 12px; border-bottom: 1.5px solid var(--tk-acc); border-left: 1.5px solid var(--tk-acc); border-bottom-left-radius: 6px; }
.tk__corner--br { bottom: 12px; right: 12px; border-bottom: 1.5px solid var(--tk-acc); border-right: 1.5px solid var(--tk-acc); border-bottom-right-radius: 6px; }

.tk__inner {
  position: relative; z-index: 2;
  height: 100%;
  display: flex; flex-direction: column;
  padding: 22px 22px 16px;
}

/* ── 通用统计 / 标签 / 感言 / 页脚 ── */
.tk-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
  margin-top: 14px;
}
.tk-stats--flight { grid-template-columns: repeat(3, 1fr); }
.tk-stats__item {
  min-width: 0;
  padding: 9px 10px;
  border-radius: 12px;
  background: var(--tk-chip);
  border: 1px solid var(--tk-chip-line);
  display: flex; flex-direction: column; gap: 3px;
}
.tk-stats__label { font-size: 9px; letter-spacing: 0.08em; color: var(--tk-tx3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tk-stats__value { font-size: 14px; font-weight: 700; color: var(--tk-tx); }
.tk-stats__value em { font-size: 9px; font-style: normal; color: var(--tk-tx3); margin-left: 2px; }

.tk-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.tk-tag {
  padding: 4px 10px; border-radius: 999px;
  font-size: 11px; color: var(--tk-tx2);
  background: var(--tk-chip); border: 1px solid var(--tk-chip-line);
}
.tk-tag--hot { color: var(--tk-acc-hi); border-color: color-mix(in srgb, var(--tk-acc) 45%, transparent); }
.tk-quote { margin: 12px 0 0; font-size: 12.5px; line-height: 1.6; color: var(--tk-tx2); font-style: italic; }

.tk-foot {
  margin-top: auto; padding-top: 14px;
  border-top: 1px dashed var(--tk-line);
  display: flex; align-items: center; gap: 12px;
}
.tk-foot__qr { width: 52px; height: 52px; flex-shrink: 0; border-radius: 8px; }
.tk-foot__meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.tk-foot__caption { font-size: 11px; font-weight: 600; color: var(--tk-acc); letter-spacing: 0.05em; }
.tk-foot__ftext { font-size: 9.5px; color: var(--tk-tx3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tk-foot__serial { margin-left: auto; font-size: 10px; letter-spacing: 0.06em; color: var(--tk-serial); font-family: 'Arial', monospace; white-space: nowrap; }
.tk-foot__barcode { display: flex; align-items: stretch; gap: 1.5px; height: 40px; flex: 1; overflow: hidden; }
.tk-foot__bar { background: var(--tk-tx); height: 100%; }

/* ────────── 铁路 ────────── */
.rail-head { display: flex; align-items: center; justify-content: space-between; }
.rail-head__brand { display: flex; align-items: center; gap: 10px; }
.rail-head__mark { width: 30px; height: 33px; object-fit: contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); }
.rail-head__txt { display: flex; flex-direction: column; line-height: 1.15; }
.rail-head__txt strong { font-size: 15px; letter-spacing: 0.06em; }
.rail-head__txt span { font-size: 8.5px; letter-spacing: 0.22em; color: var(--tk-tx3); }
.rail-head__serial { font-size: 9.5px; color: var(--tk-serial); font-family: Arial; letter-spacing: 0.05em; }
.rail-label { margin-top: 14px; font-size: 9.5px; letter-spacing: 0.28em; color: var(--tk-tx3); text-align: center; }
.rail-route { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; margin-top: 16px; }
.rail-end { display: flex; flex-direction: column; gap: 3px; }
.rail-end--r { align-items: flex-end; }
.rail-end strong { font-size: 25px; font-weight: 800; letter-spacing: 0.02em; }
.rail-end span { font-size: 9.5px; letter-spacing: 0.18em; color: var(--tk-tx3); }
.rail-line { position: relative; display: flex; flex-direction: column; align-items: center; gap: 5px; width: 74px; }
.rail-line__code {
  font-size: 12px; font-weight: 800; color: var(--tk-acc-hi);
  padding: 2px 9px; border-radius: 8px;
  background: color-mix(in srgb, var(--tk-acc) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--tk-acc) 40%, transparent);
}
.rail-line__track { width: 100%; border-top: 2px dashed var(--tk-line); }
.rail-line__train { position: absolute; top: 16px; color: var(--tk-acc); transform: rotate(90deg); }
.rail-strip { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 18px; }
.rail-strip__cell { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 12px; background: var(--tk-chip); border: 1px solid var(--tk-chip-line); }
.rail-strip__cell--r { text-align: right; }
.rail-strip__cell span { font-size: 9px; letter-spacing: 0.08em; color: var(--tk-tx3); }
.rail-strip__cell strong { font-size: 13px; font-weight: 700; }

/* ────────── 自驾 ────────── */
.dr-head { display: flex; align-items: center; justify-content: space-between; }
.dr-head__brand { display: flex; align-items: center; gap: 10px; }
.dr-head__brand img { width: 26px; height: 26px; border-radius: 7px; }
.dr-head__brand div { display: flex; flex-direction: column; line-height: 1.15; }
.dr-head__brand strong { font-size: 14.5px; }
.dr-head__brand span { font-size: 8.5px; letter-spacing: 0.2em; color: var(--tk-tx3); }
.dr-head__serial { font-size: 9.5px; color: var(--tk-serial); font-family: Arial; }
.dr-name { margin: 14px 0 0; font-size: 21px; font-weight: 800; text-align: center; letter-spacing: 0.02em; }
.dr-summary { margin: 7px 0 0; font-size: 11.5px; color: var(--tk-tx2); text-align: center; letter-spacing: 0.04em; }
.dr-way { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 5px 7px; margin-top: 16px; }
.dr-way__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--tk-tx3); }
.dr-way__dot--end { width: 10px; height: 10px; background: var(--tk-acc); box-shadow: 0 0 0 3px color-mix(in srgb, var(--tk-acc) 25%, transparent); }
.dr-way__name { font-size: 12px; color: var(--tk-tx2); }
.dr-way__seg { width: 16px; border-top: 1.5px dashed var(--tk-line); }
.dr-shields { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; align-items: center; justify-content: center; }

/* ────────── 飞行 ────────── */
.fl-head { display: flex; align-items: center; justify-content: space-between; }
.fl-head__air { display: flex; align-items: center; gap: 10px; min-width: 0; }
.fl-head__logo { width: 38px; height: 38px; object-fit: contain; background: #fff; border-radius: 8px; padding: 4px; flex-shrink: 0; box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
.fl-head__txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fl-head__txt strong { font-size: 15px; letter-spacing: 0.03em; line-height: 1.2; }
.fl-head__txt span { font-size: 8px; letter-spacing: 0.18em; color: var(--tk-tx3); }
.fl-head__right { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
.fl-head__alliance-logo { height: 20px; width: auto; max-width: 80px; object-fit: contain; background: rgba(255,255,255,0.92); border-radius: 4px; padding: 3px 6px; }
.fl-head__no { font-size: 20px; font-weight: 800; color: var(--tk-acc-hi); font-family: Arial; letter-spacing: 0.5px; }
.fl-route { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; margin-top: 20px; }
.fl-city { display: flex; flex-direction: column; gap: 3px; }
.fl-city--r { align-items: flex-end; text-align: right; }
.fl-city strong { font-size: 38px; font-weight: 800; font-family: Arial; letter-spacing: 1px; line-height: 1; }
.fl-city__cn { font-size: 13px; font-weight: 600; margin-top: 3px; }
.fl-city__en { font-size: 8.5px; color: var(--tk-tx3); letter-spacing: 0.04em; max-width: 130px; }
.fl-city--r .fl-city__en { text-align: right; }
.fl-track { display: flex; align-items: center; gap: 4px; width: 80px; }
.fl-track__line { flex: 1; border-top: 2px dashed var(--tk-line); }
.fl-track__plane { color: var(--tk-acc); flex-shrink: 0; }
.fl-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 18px; }
.fl-strip__cell { display: flex; flex-direction: column; gap: 4px; padding: 9px 11px; border-radius: 12px; background: var(--tk-chip); border: 1px solid var(--tk-chip-line); }
.fl-strip__cell span { font-size: 8.5px; letter-spacing: 0.08em; color: var(--tk-tx3); }
.fl-strip__cell strong { font-size: 12.5px; font-weight: 700; }
</style>
