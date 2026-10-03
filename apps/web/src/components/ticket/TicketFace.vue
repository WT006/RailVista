<script setup lang="ts">
/**
 * 纪念票票面渲染器：纯 props 驱动，零硬编码文案。
 * 一切展示项来自 TicketConfig；主题色板来自 src/data/ticket.ts，
 * 通过 CSS 变量（--tk-*）注入，组件内不写死任何颜色。
 */
import { computed } from 'vue';
import type { TicketConfig } from '@railvista/shared';
import { AIRLINES, ALLIANCES, TICKET_KIND_META, ticketTheme } from '../../data/ticket';
import brandLockup from '../../assets/heyworld-brand.png';
import brandMark from '../../assets/heyworld-logo.png';

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
  if (!ref) return null;
  return AIRLINES[ref.code] ?? null;
});
const alliance = computed(() => {
  const id = props.config.airline?.alliance;
  return id ? ALLIANCES[id] ?? null : null;
});

/** 路牌制式：G+3位数字=国道红盾，其余 G/S 编号=高速绿盾 */
const shields = computed(() =>
  (props.config.route.shields ?? []).map((ref) => ({
    ref,
    national: /^G\d{3}$/.test(ref.trim().toUpperCase()),
  })),
);

/** 海拔剖面归一化路径（viewBox 320x52） */
const elev = computed(() => {
  const pts = props.config.route.elevPoints ?? [];
  if (pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const xy = pts.map((v, i) => [
    (i / (pts.length - 1)) * 320,
    46 - ((v - min) / span) * 38,
  ]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const peak = xy.reduce((a, b) => (b[1] < a[1] ? b : a), xy[0]!);
  return { line, area: `${line} L320 52 L0 52 Z`, peak };
});

/** 确定性伪二维码：由 qr.value 哈希播种（上线时替换为真实 QR 库） */
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
  const inFinder = (r: number, c: number) => (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
  const cells: { r: number; c: number }[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!inFinder(r, c) && rnd() > 0.52) cells.push({ r, c });
    }
  }
  return cells;
});

const stubYear = computed(() => (props.config.dateText || '').slice(0, 4) || new Date().getFullYear().toString());
</script>

<template>
  <div
    class="tk"
    :class="[`tk--${config.kind}`, { 'tk--guil-blue': theme.guil === 'blue' }]"
    :style="styleVars"
  >
    <div class="tk__guil" aria-hidden="true"></div>
    <img v-if="config.brand.watermark" class="tk__wm" :src="brandLockup" alt="" aria-hidden="true" />
    <img
      v-if="config.background.imageUrl"
      class="tk__bgimg"
      :src="config.background.imageUrl"
      :style="{ opacity: config.background.opacity }"
      alt=""
      aria-hidden="true"
    />
    <div class="tk__frame" aria-hidden="true"></div>
    <span class="tk__corner tk__corner--tl" aria-hidden="true"></span>
    <span class="tk__corner tk__corner--tr" aria-hidden="true"></span>
    <span class="tk__corner tk__corner--bl" aria-hidden="true"></span>
    <span class="tk__corner tk__corner--br" aria-hidden="true"></span>

    <div class="tk__inner">
      <!-- 顶部品牌微标 + 票种 chip -->
      <div class="tk__microtop">
        <div v-if="config.brand.logo" class="tk__brand">
          <img :src="brandMark" alt="" />
          <span>WANLI ROADBOOK · 万里路书</span>
        </div>
        <span v-else></span>
        <span class="tk__typechip">{{ kindMeta.chip }}</span>
      </div>

      <!-- 票号 + 条码 -->
      <div class="tk__serialrow">
        <span class="tk__serial">No. {{ config.serial }}</span>
        <span class="tk__barcode" aria-hidden="true"></span>
      </div>

      <h2 class="tk__title"><span class="tk__dia">✦</span> {{ config.title }} <span class="tk__dia">✦</span></h2>
      <p v-if="config.subtitle" class="tk__sub">{{ config.subtitle }}</p>

      <!-- 印章行 -->
      <div v-if="config.seal.enabled && config.seal.text" class="tk__seal">
        <svg v-if="config.seal.emblem === 'rail'" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <path d="M24 4c7 7 11 13 11 19H13c0-6 4-12 11-19z" fill="var(--tk-acc)" />
          <rect x="10" y="27" width="28" height="4" rx="2" fill="var(--tk-acc)" />
          <rect x="16" y="33" width="16" height="4" rx="2" fill="var(--tk-acc)" />
          <rect x="8" y="39" width="32" height="4" rx="2" fill="var(--tk-acc)" />
        </svg>
        <svg v-else-if="config.seal.emblem === 'road'" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <path d="M14 42 L20 8 h8 l6 34 z" fill="var(--tk-acc)" opacity=".85" />
          <path d="M23 12 v26" stroke="var(--tk-grad)" stroke-width="2" stroke-dasharray="4 3" />
          <circle cx="24" cy="6" r="3" fill="var(--tk-acc-hi)" />
        </svg>
        <svg v-else-if="config.seal.emblem === 'air'" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <path d="M6 28 L42 14 l-4 8 -14 4 6 10 -6 2 -6-10 -8 4 z" fill="var(--tk-acc)" />
        </svg>
        <span class="tk__seal-text">
          {{ config.seal.text }}
          <em v-if="config.seal.sub">{{ config.seal.sub }}</em>
        </span>
      </div>

      <!-- 飞行：航司官方 logo + 联盟徽章 -->
      <div v-if="config.kind === 'flight' && config.airline" class="tk__alrow">
        <img v-if="airline" class="tk__allogo" :src="airline.logo" :alt="config.airline.name" />
        <div class="tk__alname">
          <strong>{{ config.airline.name }}</strong>
          <span>{{ config.airline.en }}</span>
        </div>
        <span class="tk__alno">{{ config.airline.flightNo }}</span>
      </div>
      <span v-if="config.kind === 'flight' && alliance" class="tk__alliance">
        <img :src="alliance.logo" alt="" />
        <span>{{ alliance.name }}</span>
      </span>

      <!-- 路线区 -->
      <div class="tk__routebox">
        <!-- 飞行：IATA 大字 + 航迹弧 -->
        <template v-if="config.kind === 'flight'">
          <div class="tk__iatarow">
            <div class="tk__iata">
              <strong>{{ config.route.ends[0].code || config.route.ends[0].name }}</strong>
              <span>{{ config.route.ends[0].name }}</span>
            </div>
            <div class="tk__arc">
              <svg viewBox="0 0 200 44" aria-hidden="true">
                <path d="M6 36 Q100 -4 194 36" fill="none" stroke="var(--tk-acc)" stroke-width="1.4" stroke-dasharray="4 4" stroke-opacity=".8" />
                <circle cx="6" cy="36" r="3" fill="var(--tk-acc)" />
                <circle cx="194" cy="36" r="3" fill="var(--tk-acc)" />
                <text x="100" y="14" font-size="15" fill="var(--tk-acc-hi)" text-anchor="middle" transform="rotate(8 100 14)">✈</text>
              </svg>
            </div>
            <div class="tk__iata tk__iata--r">
              <strong>{{ config.route.ends[1].code || config.route.ends[1].name }}</strong>
              <span>{{ config.route.ends[1].name }}</span>
            </div>
          </div>
        </template>

        <!-- 自驾：途经点链 -->
        <div v-else-if="(config.route.waypoints ?? []).length > 2" class="tk__wprow">
          <div v-for="(w, i) in config.route.waypoints" :key="`${w}-${i}`" class="tk__wp">
            <span class="tk__wp-dot" aria-hidden="true"></span>
            <span class="tk__wp-nm">{{ w }}</span>
          </div>
        </div>

        <!-- 铁路 / 兜底：两端点 + 中线 -->
        <div v-else class="tk__routeline">
          <div class="tk__station">
            <span class="tk__station-cn">{{ config.route.ends[0].name }}</span>
            <span v-if="config.route.ends[0].pinyin" class="tk__station-py">{{ config.route.ends[0].pinyin }}</span>
          </div>
          <div class="tk__arrowline">
            <span class="tk__rail" aria-hidden="true"></span>
            <span v-if="config.route.middleLabel" class="tk__train">{{ config.route.middleLabel }}</span>
          </div>
          <div class="tk__station">
            <span class="tk__station-cn">{{ config.route.ends[1].name }}</span>
            <span v-if="config.route.ends[1].pinyin" class="tk__station-py">{{ config.route.ends[1].pinyin }}</span>
          </div>
        </div>

        <!-- 自驾：路牌 + 海拔剖面 -->
        <div v-if="shields.length" class="tk__shields">
          <svg v-for="s in shields" :key="s.ref" class="tk__shield" viewBox="0 0 40 44" aria-hidden="true">
            <template v-if="!s.national">
              <rect x="1" y="1" width="38" height="42" rx="5" fill="#0a7a3d" stroke="#fff" stroke-width="2" />
              <rect x="1" y="1" width="38" height="11" rx="5" fill="#d0342c" />
              <rect x="1" y="8" width="38" height="4" fill="#d0342c" />
              <text x="20" y="9.5" font-size="6" fill="#fff" text-anchor="middle" font-family="sans-serif">国家高速</text>
              <text x="20" y="33" :font-size="s.ref.length > 3 ? 12 : 15" fill="#fff" text-anchor="middle" font-weight="bold" font-family="sans-serif">{{ s.ref }}</text>
            </template>
            <template v-else>
              <rect x="1" y="1" width="38" height="42" rx="5" fill="#d0342c" stroke="#fff" stroke-width="2" />
              <text x="20" y="17" font-size="7" fill="#fff" text-anchor="middle" font-family="sans-serif">国道</text>
              <text x="20" y="34" font-size="13" fill="#fff" text-anchor="middle" font-weight="bold" font-family="sans-serif">{{ s.ref }}</text>
            </template>
          </svg>
        </div>
        <svg v-if="elev" class="tk__elev" viewBox="0 0 320 52" preserveAspectRatio="none" aria-hidden="true">
          <path :d="elev.area" fill="var(--tk-acc)" opacity=".16" />
          <path :d="elev.line" fill="none" stroke="var(--tk-acc)" stroke-width="1.5" stroke-opacity=".85" />
          <circle :cx="elev.peak[0]" :cy="elev.peak[1]" r="3" fill="var(--tk-acc-hi)" />
          <text v-if="config.route.elevPeakLabel" :x="Math.min(elev.peak[0] + 7, 220)" :y="elev.peak[1] + 2" font-size="8" fill="var(--tk-acc-hi)" font-family="sans-serif">{{ config.route.elevPeakLabel }}</text>
        </svg>

        <div v-if="config.metaLeft || config.metaRight" class="tk__routemeta">
          <span>{{ config.metaLeft }}</span>
          <span>{{ config.metaRight }}</span>
        </div>
      </div>

      <!-- 数据宫格（原型 .stats 固定 2 列；曾对飞行票用3 列把字压到 10px 以下，已去） -->
      <div v-if="config.stats.length" class="tk__stats">
        <div v-for="(s, i) in config.stats" :key="i" class="tk__stat">
          <span class="tk__stat-lb">{{ s.label }}</span>
          <span class="tk__stat-vl">{{ s.value }}<small v-if="s.unit"> {{ s.unit }}</small></span>
        </div>
      </div>

      <!-- 标签胶囊 -->
      <div v-if="config.tags.length" class="tk__tags">
        <span v-for="(t, i) in config.tags" :key="i" class="tk__tag" :class="{ 'tk__tag--hot': t.hot }">{{ t.text }}</span>
      </div>

      <!-- 感言 -->
      <p v-if="config.quote" class="tk__quote">{{ config.quote }}</p>

      <!-- 页脚：微缩文字 + 二维码 -->
      <div class="tk__foot">
        <span class="tk__micro">{{ config.brand.footerText }}</span>
        <div v-if="config.qr.enabled" class="tk__qrbox">
          <svg viewBox="0 0 21 21" shape-rendering="crispEdges" role="img" :aria-label="config.qr.caption">
            <g fill="#1a1a2e">
              <rect x="0" y="0" width="7" height="7" /><rect x="14" y="0" width="7" height="7" /><rect x="0" y="14" width="7" height="7" />
              <rect x="2" y="2" width="3" height="3" fill="#fff" /><rect x="16" y="2" width="3" height="3" fill="#fff" /><rect x="2" y="16" width="3" height="3" fill="#fff" />
              <rect x="3" y="3" width="1" height="1" /><rect x="17" y="3" width="1" height="1" /><rect x="3" y="17" width="1" height="1" />
              <rect v-for="(c, i) in qrCells" :key="i" :x="c.c" :y="c.r" width="1" height="1" />
            </g>
          </svg>
          <span class="tk__qrcap">{{ config.qr.caption }}</span>
        </div>
      </div>
    </div>

    <!-- 飞行：副券撕线 -->
    <div v-if="config.kind === 'flight'" class="tk__stub" aria-hidden="true">
      <span class="tk__stub-perf"></span>
      <span class="tk__stub-notch tk__stub-notch--t"></span>
      <span class="tk__stub-notch tk__stub-notch--b"></span>
      <span class="tk__stub-item">{{ config.airline?.flightNo || config.route.middleLabel }}</span>
      <span class="tk__stub-barcode"></span>
      <span class="tk__stub-item">HEY WORLD · {{ stubYear }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 票面设计语言：典藏票据感（烫金 / 防伪底纹 / 钢印双框 / 齿孔撕线）。
   颜色一律取自 --tk-* 变量（由 src/data/ticket.ts 主题注入）。 */
.tk {
  --tk-acc: var(--accent);
  box-sizing: border-box;
  position: relative;
  width: 100%;
  /* 基准来自原型 万里路书-纪念票模板原型.html .ticket：宽 400 / min-height 640。
     缺了 min-height 时，感言的 margin-top:auto 失效，内容全部堆在顶部、底部留白，
     实测宽高比掉到 0.78（应为 0.625）——票面被压扁。*/
  max-width: 400px;
  min-height: 640px;
  margin-inline: auto;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--tk-grad);
  color: var(--tk-tx);
  box-shadow: var(--elev-3), 0 0 0 1px color-mix(in srgb, var(--tk-acc) 20%, transparent);
  transition: transform var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
}
/* 内层不加 border-box 时，padding 会被加在 .tk 的宽度之外 —— 实测 324px 宽的票面
   内层实际占 347px，右侧内容（BOARDING PAS / CZ3467 / LXA）被切掉。
   全局 base.css 未设 box-sizing，这里只在票面内局部修正，不动全局。 */
.tk__inner { box-sizing: border-box; }
.tk:hover {
  transform: translateY(-4px);
  box-shadow: var(--elev-4), 0 0 0 1px color-mix(in srgb, var(--tk-acc) 38%, transparent);
}

.tk__guil {
  position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: .55;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cg fill='none' stroke='%23D4A853' stroke-opacity='.09'%3E%3Cpath d='M0 35 Q35 10 70 35 T140 35'/%3E%3Cpath d='M0 70 Q35 45 70 70 T140 70'/%3E%3Cpath d='M0 105 Q35 80 70 105 T140 105'/%3E%3Ccircle cx='70' cy='70' r='46' stroke-opacity='.05'/%3E%3Ccircle cx='70' cy='70' r='30' stroke-opacity='.04'/%3E%3C/g%3E%3C/svg%3E");
}
.tk--guil-blue .tk__guil {
  opacity: .9;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cg fill='none' stroke='%237fb8d4' stroke-opacity='.38'%3E%3Cpath d='M0 40 Q40 12 80 40 T160 40'/%3E%3Cpath d='M0 80 Q40 52 80 80 T160 80'/%3E%3Cpath d='M0 120 Q40 92 80 120 T160 120'/%3E%3Ccircle cx='80' cy='80' r='52' stroke-opacity='.22'/%3E%3Ccircle cx='80' cy='80' r='36' stroke-opacity='.16'/%3E%3Ccircle cx='80' cy='80' r='22' stroke-opacity='.12'/%3E%3C/g%3E%3C/svg%3E");
}
.tk__wm {
  position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%);
  width: 76%; opacity: .05; z-index: 1; pointer-events: none;
}
.tk--guil-blue .tk__wm { opacity: .08; filter: invert(.35) sepia(1) saturate(3) hue-rotate(170deg); }
.tk__bgimg {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; z-index: 1; pointer-events: none; mix-blend-mode: luminosity;
}
.tk__frame {
  position: absolute; inset: 9px; z-index: 3; pointer-events: none;
  border: 1px solid color-mix(in srgb, var(--tk-acc) 34%, transparent);
  border-radius: var(--radius-md);
}
.tk__frame::before {
  content: ''; position: absolute; inset: 4px;
  border: 1px solid color-mix(in srgb, var(--tk-acc) 14%, transparent);
  border-radius: var(--radius-sm);
}
.tk__corner { position: absolute; width: 18px; height: 18px; z-index: 4; pointer-events: none; opacity: .8; }
.tk__corner--tl { top: 14px; left: 14px; border-top: 2px solid var(--tk-acc); border-left: 2px solid var(--tk-acc); border-top-left-radius: var(--radius-sm); }
.tk__corner--tr { top: 14px; right: 14px; border-top: 2px solid var(--tk-acc); border-right: 2px solid var(--tk-acc); border-top-right-radius: var(--radius-sm); }
.tk__corner--bl { bottom: 14px; left: 14px; border-bottom: 2px solid var(--tk-acc); border-left: 2px solid var(--tk-acc); border-bottom-left-radius: var(--radius-sm); }
.tk__corner--br { bottom: 14px; right: 14px; border-bottom: 2px solid var(--tk-acc); border-right: 2px solid var(--tk-acc); border-bottom-right-radius: var(--radius-sm); }

.tk__inner {
  position: relative; z-index: 2;
  /* 原型 .t-inner：padding 30px 26px 24px + min-height 640px。
     flex:1 让内层撑满 .tk 的 min-height，感言的 margin-top:auto 才会生效。*/
  padding: 30px 26px 24px;
  min-height: 640px;
  flex: 1;
  display: flex; flex-direction: column; gap: var(--space-1);
}
.tk--flight .tk__inner { padding-right: 108px; }

.tk__microtop { display: flex; justify-content: space-between; align-items: center; gap: var(--space-1); }
.tk__brand { display: flex; align-items: center; gap: 7px; min-width: 0; }
.tk__brand img { height: 15px; opacity: .85; flex-shrink: 0; }
.tk__brand span { font-size: 9px; letter-spacing: 2.5px; color: var(--tk-tx3); white-space: nowrap; }
.tk__typechip {
  font-size: 9px; letter-spacing: 2px; color: var(--tk-acc);
  border: 1px solid color-mix(in srgb, var(--tk-acc) 45%, transparent);
  background: color-mix(in srgb, var(--tk-acc) 8%, transparent);
  padding: 3px 9px; border-radius: 3px; white-space: nowrap;
}

.tk__serialrow { display: flex; justify-content: space-between; align-items: center; }
.tk__serial {
  font-family: 'SF Mono', 'JetBrains Mono', Consolas, monospace;
  font-size: 10px; letter-spacing: 1px; color: var(--tk-serial);
}
.tk__barcode {
  width: 96px; height: 20px; opacity: .8;
  background: repeating-linear-gradient(90deg,
    var(--tk-tx2) 0 1.5px, transparent 1.5px 3px,
    var(--tk-tx2) 3px 4.5px, transparent 4.5px 6px,
    var(--tk-tx2) 6px 8px, transparent 8px 10.5px,
    var(--tk-tx2) 10.5px 12px, transparent 12px 14px);
}

.tk__title {
  font-size: 19px; font-weight: 800; letter-spacing: 3px; color: var(--tk-tx);
  margin: 0;
}
.tk__dia { color: var(--tk-acc); font-size: 12px; vertical-align: 2px; }
.tk__sub { font-size: 11px; letter-spacing: 2px; color: var(--tk-tx2); margin: 0; }

.tk__seal { display: flex; align-items: center; gap: 6px; }
.tk__seal svg { width: 20px; height: 20px; flex-shrink: 0; }
.tk__seal-text { font-size: 9px; letter-spacing: 2px; color: var(--tk-tx3); }
.tk__seal-text em { font-style: normal; margin-left: 6px; color: var(--tk-acc); }

.tk__alrow { display: flex; align-items: center; gap: 9px; }
/* 航司 logo 原图自带白底（为白底场景设计）。实测：直接去白底后国航红凤凰、
   厦航深蓝在深色票面上几乎不可见 —— 故按原型 .al-logo 保留白底，
   但缩小并柔化，降低"贴了个白方块"的突兀感。*/
.tk__allogo {
  height: 30px; min-width: 40px; background: rgba(255, 255, 255, .92);
  border-radius: 6px;
  padding: 3px 6px; object-fit: contain;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .18), 0 0 0 1px rgba(255, 255, 255, .1);
}
.tk__alname { display: flex; flex-direction: column; min-width: 0; }
.tk__alname strong { font-size: 14px; letter-spacing: 1px; color: var(--tk-tx); }
.tk__alname span { font-size: 8.5px; letter-spacing: 1.5px; color: var(--tk-tx3); margin-top: 2px; }
.tk__alno {
  margin-left: auto; font-family: 'SF Mono', Consolas, monospace;
  font-size: 17px; font-weight: 700; color: var(--tk-acc); letter-spacing: 1px;
}
.tk__alliance {
  display: inline-flex; align-items: center; gap: 5px; align-self: flex-start;
  padding: 3px 9px 3px 4px; border-radius: var(--radius-full);
  background: rgba(255, 255, 255, .92); box-shadow: var(--elev-1);
}
.tk__alliance img { height: 15px; object-fit: contain; }
.tk__alliance span { font-size: 9px; color: #333; letter-spacing: .5px; font-weight: 600; }

.tk__routebox {
  padding: var(--space-2); border-top: 1px solid var(--tk-line); border-bottom: 1px solid var(--tk-line);
  display: flex; flex-direction: column; gap: var(--space-1);
}
.tk__routeline { display: flex; align-items: center; gap: 10px; }
.tk__station { text-align: center; min-width: 0; }
.tk__station-cn { display: block; font-size: 24px; font-weight: 800; letter-spacing: 2px; color: var(--tk-tx); }
.tk__station-py { display: block; font-size: 8px; letter-spacing: 2px; color: var(--tk-tx3); margin-top: 3px; }
.tk__arrowline { flex: 1; position: relative; height: 16px; }
.tk__rail {
  position: absolute; left: 0; right: 0; top: 7px; height: 2px; border-radius: 1px;
  background: linear-gradient(90deg, transparent, var(--tk-acc) 15%, var(--tk-acc) 85%, transparent);
}
.tk__rail::after {
  content: ''; position: absolute; left: 0; right: 0; top: 4px; height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--tk-acc) 45%, transparent) 15%, color-mix(in srgb, var(--tk-acc) 45%, transparent) 85%, transparent);
}
.tk__train {
  position: absolute; left: 50%; top: -4px; transform: translateX(-50%);
  font-size: 12px; color: var(--tk-acc);
  background: color-mix(in srgb, var(--tk-acc) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--tk-acc) 35%, transparent);
  padding: 1px 6px; border-radius: var(--radius-full);
}

.tk__iatarow { display: flex; align-items: center; gap: 8px; }
.tk__iata { min-width: 0; }
.tk__iata--r { text-align: right; }
.tk__iata strong { display: block; font-size: 34px; font-weight: 800; letter-spacing: 2px; line-height: 1; color: var(--tk-tx); }
.tk__iata span { display: block; font-size: 10px; letter-spacing: 1px; color: var(--tk-tx2); margin-top: 4px; }
.tk__arc { flex: 1; height: 44px; }
.tk__arc svg { width: 100%; height: 100%; overflow: visible; }

.tk__wprow { display: flex; align-items: flex-start; }
.tk__wp { flex: 1; text-align: center; position: relative; min-width: 0; }
.tk__wp-dot {
  display: block; width: 8px; height: 8px; border-radius: var(--radius-full);
  background: var(--tk-acc); margin: 0 auto; position: relative; z-index: 2;
  box-shadow: 0 0 8px color-mix(in srgb, var(--tk-acc) 80%, transparent);
}
.tk__wp-nm { display: block; font-size: 11px; font-weight: 600; color: var(--tk-tx); margin-top: 6px; }
.tk__wp:not(:last-child)::after {
  content: ''; position: absolute; top: 3.5px; left: calc(50% + 7px); right: calc(-50% + 7px);
  border-top: 1.5px dashed color-mix(in srgb, var(--tk-acc) 55%, transparent); z-index: 1;
}

.tk__shields { display: flex; gap: 7px; flex-wrap: wrap; }
.tk__shield { width: 38px; height: 42px; }
.tk__elev { width: 100%; height: 52px; display: block; }

.tk__routemeta { display: flex; justify-content: space-between; gap: var(--space-1); font-size: 11px; color: var(--tk-tx2); }

.tk__stats {
  display: grid; grid-template-columns: 1fr 1fr; gap: 1px;
  background: var(--tk-line); border: 1px solid var(--tk-line);
  border-radius: var(--radius-sm); overflow: hidden;
}
.tk__stat { background: var(--tk-chip); padding: 9px 12px; min-width: 0; }
.tk__stat-lb { display: block; font-size: 9px; letter-spacing: 1.5px; color: var(--tk-tx3); }
.tk__stat-vl { display: block; font-size: 15px; font-weight: 700; color: var(--tk-tx); margin-top: 3px; }
.tk__stat-vl small { font-size: 10px; font-weight: 400; color: var(--tk-tx2); }

.tk__tags { display: flex; gap: 6px; flex-wrap: wrap; }
.tk__tag {
  font-size: 10px; color: var(--tk-tx2);
  border: 1px solid var(--tk-chip-line); background: var(--tk-chip);
  padding: 3px 9px; border-radius: var(--radius-full);
}
.tk__tag--hot {
  color: var(--tk-acc);
  border-color: color-mix(in srgb, var(--tk-acc) 40%, transparent);
  background: color-mix(in srgb, var(--tk-acc) 10%, transparent);
}

.tk__quote {
  margin: auto 0 0; padding: 11px 14px;
  font-size: 12.5px; line-height: 1.7; font-style: italic; color: var(--tk-tx2);
  border-left: 2px solid var(--tk-acc);
  background: color-mix(in srgb, var(--tk-acc) 7%, transparent);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.tk__foot {
  display: flex; justify-content: space-between; align-items: flex-end; gap: var(--space-2);
  padding-top: var(--space-2); border-top: 1px solid var(--tk-line);
}
.tk__micro { font-size: 8px; letter-spacing: 1.5px; color: var(--tk-tx3); line-height: 1.8; white-space: pre-line; }
.tk__qrbox { text-align: center; flex-shrink: 0; }
.tk__qrbox svg { width: 46px; height: 46px; background: #fff; border-radius: 5px; padding: 4px; }
.tk__qrcap { display: block; font-size: 7.5px; letter-spacing: 1px; color: var(--tk-tx3); margin-top: 3px; }

/* 飞行副券 */
.tk__stub {
  position: absolute; z-index: 2; top: 84px; bottom: 66px; right: 16px; width: 78px;
  display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  padding: var(--space-2) 0;
}
.tk__stub-perf { position: absolute; left: 0; top: -60px; bottom: -40px; border-left: 2px dashed rgba(255, 255, 255, .28); }
.tk__stub-notch { position: absolute; left: -11px; width: 22px; height: 22px; border-radius: var(--radius-full); background: var(--surface-0); }
.tk__stub-notch--t { top: -66px; }
.tk__stub-notch--b { bottom: -46px; }
.tk__stub-item {
  writing-mode: vertical-rl; font-family: 'SF Mono', Consolas, monospace;
  font-size: 10px; letter-spacing: 3px; color: var(--tk-tx2);
}
.tk__stub-barcode {
  width: 22px; height: 96px; opacity: .8;
  background: repeating-linear-gradient(0deg,
    var(--tk-tx2) 0 1.5px, transparent 1.5px 3px,
    var(--tk-tx2) 3px 5px, transparent 5px 6.5px,
    var(--tk-tx2) 6.5px 8px, transparent 8px 11px);
}

@media (max-width: 480px) {
  /* 窄屏：按原型 @media(max-width:460px) 取消 min-height ——
     否则 324px 宽的票面仍锁 640px 高，宽高比被拉到 0.51，票面变成长条。*/
  .tk,
  .tk__inner { min-height: 0; }
  .tk__inner { padding: 22px 18px 18px; }
  .tk--flight .tk__inner { padding-right: 18px; }
  .tk__stub { display: none; }
  .tk__station-cn { font-size: 21px; }
  .tk__iata strong { font-size: 28px; }
}
</style>
