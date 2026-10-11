/**
 * 流星雨预报（年度主要流星雨查表法）
 *
 * 参考 IMO（国际流星组织）年度流星雨日历：峰值日期、ZHR（天顶小时率）、辐射点。
 * 峰值年份精度 ±1 天足够旅行参考；月相照度用于估「实际可见量」。
 */

export interface MeteorShower {
  /** 中文名 */
  name: string;
  /** 峰值时刻（该年 UTC 峰值日的当地中午近似，用于日期比对与月相计算） */
  peakMs: number;
  /** 天顶小时率 */
  zhr: number;
  /** 辐射点赤经/赤纬（度）——判断在旅途可见高度用 */
  raDeg: number;
  decDeg: number;
}

export interface MeteorShowerHit {
  shower: MeteorShower;
  /** 峰值月相照度 0~1（越大月光干扰越强） */
  moonIllum: number;
  /** 月光扣减后的预期强度 0~100 */
  score: number;
  /** 文案：英仙座流星雨 · 极大 8/13 · ZHR 100 · 月光干扰 30% */
  note: string;
}

/** 年度主要流星雨（月-日为 UTC 峰值，rad/dec 为辐射点赤道坐标） */
const SHOWER_TABLE: Array<{ name: string; month: number; day: number; zhr: number; raDeg: number; decDeg: number }> = [
  { name: '象限仪座流星雨', month: 1, day: 4, zhr: 110, raDeg: 230, decDeg: 49 },
  { name: '天琴座流星雨', month: 4, day: 22, zhr: 18, raDeg: 271, decDeg: 34 },
  { name: '宝瓶座η流星雨', month: 5, day: 6, zhr: 50, raDeg: 338, decDeg: -1 },
  { name: '英仙座流星雨', month: 8, day: 13, zhr: 100, raDeg: 48, decDeg: 58 },
  { name: '猎户座流星雨', month: 10, day: 21, zhr: 20, raDeg: 95, decDeg: 16 },
  { name: '狮子座流星雨', month: 11, day: 17, zhr: 15, raDeg: 152, decDeg: 22 },
  { name: '双子座流星雨', month: 12, day: 14, zhr: 150, raDeg: 112, decDeg: 33 },
  { name: '小熊座流星雨', month: 12, day: 22, zhr: 10, raDeg: 217, decDeg: 76 },
];

/** 某年的流星雨表（峰值取当地中午近似时刻） */
function showersForYear(year: number): MeteorShower[] {
  return SHOWER_TABLE.map((s) => {
    // Date.UTC 月份从 0 起；峰值当地中午 ≈ UTC 04:00（中国时区）
    return {
      name: s.name,
      zhr: s.zhr,
      raDeg: s.raDeg,
      decDeg: s.decDeg,
      peakMs: Date.UTC(year, s.month - 1, s.day, 4, 0, 0),
    };
  });
}

/** 行程 [fromMs, toMs] 期间命中的流星雨（峰值 ±2 天窗），按预期强度排序 */
export function findMeteorShowers(
  fromMs: number,
  toMs: number,
  moonIllumAt: (ms: number) => number,
): MeteorShowerHit[] {
  const WINDOW_MS = 2 * 86_400_000;
  const years = new Set<number>();
  for (let y = new Date(fromMs).getUTCFullYear() - 1; y <= new Date(toMs).getUTCFullYear() + 1; y++) {
    years.add(y);
  }
  const hits: MeteorShowerHit[] = [];
  for (const y of years) {
    for (const s of showersForYear(y)) {
      if (s.peakMs + WINDOW_MS < fromMs || s.peakMs - WINDOW_MS > toMs) continue;
      const moonIllum = Math.max(0, Math.min(1, moonIllumAt(s.peakMs)));
      // 预期强度：ZHR 归一化（150 封顶）× 月光透减（满月时仅剩 25%）
      const zhrScore = Math.min(100, (s.zhr / 150) * 100);
      const score = Math.round(zhrScore * (1 - moonIllum * 0.75));
      const md = `${new Date(s.peakMs).getUTCMonth() + 1}/${new Date(s.peakMs).getUTCDate()}`;
      const moonNote = moonIllum > 0.7 ? '月光干扰强' : moonIllum > 0.35 ? '月光干扰中等' : '月光干扰小';
      hits.push({
        shower: s,
        moonIllum,
        score,
        note: `${s.name} · 极大 ${md} · ZHR ${s.zhr} · ${moonNote}`,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}
