<script setup lang="ts">
/**
 * 纪念票票面渲染器：纯 config 驱动，分票种精致版式。
 * - 铁路：真实车票双行站名（拼音）+ 规范中国铁路路徽
 * - 自驾：途经点链 + 国标路牌 + 黑金「此生必驾」盾牌
 * - 飞行：登机牌版式（大 IATA、机场英文名、条码），不含任何自驾元素
 * 主题色板来自 src/data/ticket.ts，经 CSS 变量注入。
 */
/* 【作用域例外层】票面印刷层（票面渲染器）：渐变 / 微字号（印刷排印）/ 微圆角
 * 按印刷品规范保留，不套用界面令牌体系；界面交互控件不在此例外内
 * （2026-10-09 鸿蒙化收敛裁定，见 tokens.css 例外条款）。 */
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

/**
 * 宫格双语标签拆分（如「里程 MILEAGE」→ 中文 + 英文）。
 * 窄票面（容器查询 ≤340px）下英文副标隐藏、仅留中文，保证四宫格不被省略号压坏。
 */
const statsView = computed(() =>
  props.config.stats.map((s) => {
    const parts = /^(\S+)(?:\s+(.+))?$/.exec(s.label.trim());
    return { ...s, labelCn: parts?.[1] ?? s.label, labelEn: parts?.[2] ?? '' };
  }),
);
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
          <div v-for="s in statsView" :key="s.label" class="tk-stats__item">
            <span class="tk-stats__label">
              {{ s.labelCn }}<em v-if="s.labelEn" class="tk-stats__label-en">{{ s.labelEn }}</em>
            </span>
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
          <div v-for="s in statsView" :key="s.label" class="tk-stats__item">
            <span class="tk-stats__label">
              {{ s.labelCn }}<em v-if="s.labelEn" class="tk-stats__label-en">{{ s.labelEn }}</em>
            </span>
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
          <div v-for="s in statsView" :key="s.label" class="tk-stats__item">
            <span class="tk-stats__label">
              {{ s.labelCn }}<em v-if="s.labelEn" class="tk-stats__label-en">{{ s.labelEn }}</em>
            </span>
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
/*
 * 票面是「印刷品」：所有尺寸（字号 / 间距 / 线宽 / 圆角 / 图标尺寸）均以
 * 票面容器宽度为基准等比缩放，基准设计宽度 380px（TicketHome 的 .tk-face-wrap）。
 *   --s = 1cqw / 3.8  —— 380px 容器下 1 设计 px；窄屏手机上面宽收缩到 ~294-340px
 *   时，全部版式同比缩小，杜绝「票面被压缩、页脚被裁、宫格文字出格」。
 * 仅 inline-size 容器（不影响高度由 aspect-ratio 决定）。
 */
.tk {
  container-type: inline-size;
  --s: calc(1cqw / 3.8);
  position: relative;
  width: 100%; height: 100%;
  border-radius: calc(22 * var(--s));
  overflow: hidden;
  color: var(--tk-tx);
  background: var(--tk-grad);
  border: 1px solid var(--tk-line);
  box-shadow:
    0 calc(24 * var(--s)) calc(60 * var(--s)) rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.tk__bgimg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
.tk__wm {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
  width: 62%; opacity: 0.06; z-index: 0; pointer-events: none;
}
.tk__corner {
  position: absolute;
  width: calc(16 * var(--s)); height: calc(16 * var(--s));
  z-index: 3; opacity: 0.5;
}
.tk__corner--tl { top: calc(12 * var(--s)); left: calc(12 * var(--s)); border-top: calc(1.5 * var(--s)) solid var(--tk-acc); border-left: calc(1.5 * var(--s)) solid var(--tk-acc); border-top-left-radius: calc(6 * var(--s)); }
.tk__corner--tr { top: calc(12 * var(--s)); right: calc(12 * var(--s)); border-top: calc(1.5 * var(--s)) solid var(--tk-acc); border-right: calc(1.5 * var(--s)) solid var(--tk-acc); border-top-right-radius: calc(6 * var(--s)); }
.tk__corner--bl { bottom: calc(12 * var(--s)); left: calc(12 * var(--s)); border-bottom: calc(1.5 * var(--s)) solid var(--tk-acc); border-left: calc(1.5 * var(--s)) solid var(--tk-acc); border-bottom-left-radius: calc(6 * var(--s)); }
.tk__corner--br { bottom: calc(12 * var(--s)); right: calc(12 * var(--s)); border-bottom: calc(1.5 * var(--s)) solid var(--tk-acc); border-right: calc(1.5 * var(--s)) solid var(--tk-acc); border-bottom-right-radius: calc(6 * var(--s)); }

.tk__inner {
  position: relative; z-index: 2;
  height: 100%;
  display: flex; flex-direction: column;
  padding: calc(22 * var(--s)) calc(22 * var(--s)) calc(16 * var(--s));
}

/* ── 通用统计 / 标签 / 感言 / 页脚 ── */
.tk-stats {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: calc(8 * var(--s));
  margin-top: calc(14 * var(--s));
}
.tk-stats--flight { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.tk-stats__item {
  min-width: 0;
  padding: calc(9 * var(--s)) calc(10 * var(--s));
  border-radius: calc(12 * var(--s));
  background: var(--tk-chip);
  border: 1px solid var(--tk-chip-line);
  display: flex; flex-direction: column; gap: calc(3 * var(--s));
}
.tk-stats__label {
  font-size: calc(9 * var(--s)); letter-spacing: 0.08em; color: var(--tk-tx3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tk-stats__label-en { font-style: normal; }
.tk-stats__value { font-size: calc(14 * var(--s)); font-weight: 700; color: var(--tk-tx); white-space: nowrap; }
.tk-stats__value em { font-size: calc(9 * var(--s)); font-style: normal; color: var(--tk-tx3); margin-left: calc(2 * var(--s)); }

.tk-tags { display: flex; flex-wrap: wrap; gap: calc(6 * var(--s)); margin-top: calc(12 * var(--s)); }
.tk-tag {
  padding: calc(4 * var(--s)) calc(10 * var(--s)); border-radius: 999px;
  font-size: calc(11 * var(--s)); color: var(--tk-tx2);
  background: var(--tk-chip); border: 1px solid var(--tk-chip-line);
}
.tk-tag--hot { color: var(--tk-acc-hi); border-color: color-mix(in srgb, var(--tk-acc) 45%, transparent); }
.tk-quote {
  margin: calc(12 * var(--s)) 0 0;
  font-size: calc(12.5 * var(--s)); line-height: 1.6; color: var(--tk-tx2); font-style: italic;
}

.tk-foot {
  margin-top: auto; padding-top: calc(14 * var(--s));
  border-top: calc(1 * var(--s)) dashed var(--tk-line);
  display: flex; align-items: center; gap: calc(12 * var(--s));
}
.tk-foot__qr {
  width: calc(52 * var(--s)); height: calc(52 * var(--s));
  flex-shrink: 0; border-radius: calc(8 * var(--s));
}
.tk-foot__meta { display: flex; flex-direction: column; gap: calc(3 * var(--s)); min-width: 0; }
.tk-foot__caption { font-size: calc(11 * var(--s)); font-weight: 600; color: var(--tk-acc); letter-spacing: 0.05em; }
.tk-foot__ftext { font-size: calc(9.5 * var(--s)); color: var(--tk-tx3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tk-foot__serial {
  margin-left: auto; font-size: calc(10 * var(--s)); letter-spacing: 0.06em;
  color: var(--tk-serial); font-family: 'Arial', monospace; white-space: nowrap;
}
.tk-foot__barcode {
  display: flex; align-items: stretch; gap: calc(1.5 * var(--s));
  height: calc(40 * var(--s)); flex: 1; overflow: hidden;
}
.tk-foot__bar { background: var(--tk-tx); height: 100%; }

/* ────────── 铁路 ────────── */
.rail-head { display: flex; align-items: center; justify-content: space-between; gap: calc(8 * var(--s)); }
.rail-head__brand { display: flex; align-items: center; gap: calc(10 * var(--s)); min-width: 0; }
.rail-head__mark {
  width: calc(30 * var(--s)); height: calc(33 * var(--s));
  object-fit: contain; flex-shrink: 0;
  filter: drop-shadow(0 calc(2 * var(--s)) calc(4 * var(--s)) rgba(0,0,0,0.3));
}
.rail-head__txt { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.rail-head__txt strong { font-size: calc(15 * var(--s)); letter-spacing: 0.06em; }
.rail-head__txt span { font-size: calc(8.5 * var(--s)); letter-spacing: 0.22em; color: var(--tk-tx3); }
.rail-head__serial { font-size: calc(9.5 * var(--s)); color: var(--tk-serial); font-family: Arial; letter-spacing: 0.05em; white-space: nowrap; }
.rail-label { margin-top: calc(14 * var(--s)); font-size: calc(9.5 * var(--s)); letter-spacing: 0.28em; color: var(--tk-tx3); text-align: center; }
.rail-route { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: calc(10 * var(--s)); margin-top: calc(16 * var(--s)); }
.rail-end { display: flex; flex-direction: column; gap: calc(3 * var(--s)); min-width: 0; }
.rail-end--r { align-items: flex-end; }
.rail-end strong { font-size: calc(25 * var(--s)); font-weight: 800; letter-spacing: 0.02em; }
.rail-end span { font-size: calc(9.5 * var(--s)); letter-spacing: 0.18em; color: var(--tk-tx3); }
.rail-line {
  position: relative; display: flex; flex-direction: column; align-items: center;
  gap: calc(5 * var(--s)); width: calc(74 * var(--s)); flex-shrink: 0;
}
.rail-line__code {
  font-size: calc(12 * var(--s)); font-weight: 800; color: var(--tk-acc-hi);
  padding: calc(2 * var(--s)) calc(9 * var(--s)); border-radius: calc(8 * var(--s));
  white-space: nowrap;
  background: color-mix(in srgb, var(--tk-acc) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--tk-acc) 40%, transparent);
}
.rail-line__track { width: 100%; border-top: calc(2 * var(--s)) dashed var(--tk-line); }
.rail-line__train {
  position: absolute; top: calc(16 * var(--s));
  width: calc(22 * var(--s)); height: calc(22 * var(--s));
  color: var(--tk-acc); transform: rotate(90deg);
}
.rail-strip { display: grid; grid-template-columns: 1fr 1fr; gap: calc(10 * var(--s)); margin-top: calc(18 * var(--s)); }
.rail-strip__cell {
  display: flex; flex-direction: column; gap: calc(4 * var(--s));
  padding: calc(10 * var(--s)) calc(12 * var(--s));
  border-radius: calc(12 * var(--s));
  background: var(--tk-chip); border: 1px solid var(--tk-chip-line);
  min-width: 0;
}
.rail-strip__cell--r { text-align: right; }
.rail-strip__cell span { font-size: calc(9 * var(--s)); letter-spacing: 0.08em; color: var(--tk-tx3); }
.rail-strip__cell strong { font-size: calc(13 * var(--s)); font-weight: 700; }

/* ────────── 自驾 ────────── */
.dr-head { display: flex; align-items: center; justify-content: space-between; gap: calc(8 * var(--s)); }
.dr-head__brand { display: flex; align-items: center; gap: calc(10 * var(--s)); min-width: 0; }
.dr-head__brand img { width: calc(26 * var(--s)); height: calc(26 * var(--s)); border-radius: calc(7 * var(--s)); flex-shrink: 0; }
.dr-head__brand div { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.dr-head__brand strong { font-size: calc(14.5 * var(--s)); }
.dr-head__brand span { font-size: calc(8.5 * var(--s)); letter-spacing: 0.2em; color: var(--tk-tx3); }
.dr-head__serial { font-size: calc(9.5 * var(--s)); color: var(--tk-serial); font-family: Arial; white-space: nowrap; }
.dr-name { margin: calc(14 * var(--s)) 0 0; font-size: calc(21 * var(--s)); font-weight: 800; text-align: center; letter-spacing: 0.02em; }
.dr-summary { margin: calc(7 * var(--s)) 0 0; font-size: calc(11.5 * var(--s)); color: var(--tk-tx2); text-align: center; letter-spacing: 0.04em; }
.dr-way { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: calc(5 * var(--s)) calc(7 * var(--s)); margin-top: calc(16 * var(--s)); }
.dr-way__dot { width: calc(7 * var(--s)); height: calc(7 * var(--s)); border-radius: 50%; background: var(--tk-tx3); }
.dr-way__dot--end {
  width: calc(10 * var(--s)); height: calc(10 * var(--s));
  background: var(--tk-acc);
  box-shadow: 0 0 0 calc(3 * var(--s)) color-mix(in srgb, var(--tk-acc) 25%, transparent);
}
.dr-way__name { font-size: calc(12 * var(--s)); color: var(--tk-tx2); }
.dr-way__seg { width: calc(16 * var(--s)); border-top: calc(1.5 * var(--s)) dashed var(--tk-line); }
.dr-shields {
  display: flex; flex-wrap: wrap; gap: calc(8 * var(--s));
  margin-top: calc(16 * var(--s)); align-items: center; justify-content: center;
}

/* ────────── 飞行 ────────── */
.fl-head { display: flex; align-items: center; justify-content: space-between; gap: calc(8 * var(--s)); }
.fl-head__air { display: flex; align-items: center; gap: calc(10 * var(--s)); min-width: 0; }
.fl-head__logo {
  width: calc(38 * var(--s)); height: calc(38 * var(--s));
  object-fit: contain; background: #fff; border-radius: calc(8 * var(--s));
  padding: calc(4 * var(--s)); flex-shrink: 0;
  box-shadow: 0 1px calc(4 * var(--s)) rgba(0,0,0,0.3);
}
.fl-head__txt { display: flex; flex-direction: column; gap: calc(2 * var(--s)); min-width: 0; }
.fl-head__txt strong { font-size: calc(15 * var(--s)); letter-spacing: 0.03em; line-height: 1.2; }
.fl-head__txt span { font-size: calc(8 * var(--s)); letter-spacing: 0.18em; color: var(--tk-tx3); }
.fl-head__right { display: flex; flex-direction: column; align-items: flex-end; gap: calc(5 * var(--s)); flex-shrink: 0; }
.fl-head__alliance-logo {
  height: calc(20 * var(--s)); width: auto; max-width: calc(80 * var(--s));
  object-fit: contain; background: rgba(255,255,255,0.92);
  border-radius: calc(4 * var(--s)); padding: calc(3 * var(--s)) calc(6 * var(--s));
}
.fl-head__no { font-size: calc(20 * var(--s)); font-weight: 800; color: var(--tk-acc-hi); font-family: Arial; letter-spacing: 0.5px; }
.fl-route { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: calc(10 * var(--s)); margin-top: calc(20 * var(--s)); }
.fl-city { display: flex; flex-direction: column; gap: calc(3 * var(--s)); min-width: 0; }
.fl-city--r { align-items: flex-end; text-align: right; }
.fl-city strong { font-size: calc(38 * var(--s)); font-weight: 800; font-family: Arial; letter-spacing: 1px; line-height: 1; }
.fl-city__cn { font-size: calc(13 * var(--s)); font-weight: 600; margin-top: calc(3 * var(--s)); }
.fl-city__en {
  font-size: calc(8.5 * var(--s)); color: var(--tk-tx3);
  letter-spacing: 0.04em; max-width: calc(130 * var(--s));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fl-city--r .fl-city__en { text-align: right; }
.fl-track { display: flex; align-items: center; gap: calc(4 * var(--s)); width: calc(80 * var(--s)); flex-shrink: 0; }
.fl-track__line { flex: 1; border-top: calc(2 * var(--s)) dashed var(--tk-line); }
.fl-track__plane { width: calc(24 * var(--s)); height: calc(24 * var(--s)); color: var(--tk-acc); flex-shrink: 0; }
.fl-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: calc(8 * var(--s)); margin-top: calc(18 * var(--s)); }
.fl-strip__cell {
  display: flex; flex-direction: column; gap: calc(4 * var(--s));
  padding: calc(9 * var(--s)) calc(11 * var(--s));
  border-radius: calc(12 * var(--s));
  background: var(--tk-chip); border: 1px solid var(--tk-chip-line);
}
.fl-strip__cell span { font-size: calc(8.5 * var(--s)); letter-spacing: 0.08em; color: var(--tk-tx3); }
.fl-strip__cell strong { font-size: calc(12.5 * var(--s)); font-weight: 700; }

/* ────────── 窄票面（≤340px，典型手机竖屏）──────────
 * 英文副标隐藏、宫格数值微缩、内边距收紧：为铁路 / 自驾票面争取纵向空间，
 * 保证页脚（二维码 / 条码 / 票号）在票面框内完整可见。 */
@container (max-width: 340px) {
  .tk__inner {
    padding: calc(18 * var(--s)) calc(18 * var(--s)) calc(14 * var(--s));
  }
  .tk-stats__item {
    padding: calc(7 * var(--s)) calc(8 * var(--s));
  }
  .tk-stats__label-en {
    display: none;
  }
  .tk-stats__value {
    font-size: calc(12.5 * var(--s));
  }
  .tk-foot {
    padding-top: calc(11 * var(--s));
    gap: calc(10 * var(--s));
  }
}
</style>
