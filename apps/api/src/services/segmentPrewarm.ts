/**
 * F2 ③ 热门 OD 预热：进程启动后空闲时，按 `data/presets/precise-hotlist.json`
 * 把热门线路的各站间段几何提前算好并落盘/入内存，让首次真实请求直接命中。
 *
 * 默认只走本地轨网 + 走廊切片（`network:false`），不打公网 Overpass，
 * 也不写负缓存（避免预热失败反而挡住真实请求）。
 * 需要连公网预热时设置 RAIL_SEG_PREWARM_NETWORK=1（谨慎：会打到公共 Overpass）。
 *
 * 小内存机（如 4GB）建议 RAIL_SEG_PREWARM_MODE=hsr：只预热 G/D/C，
 * 避免启动后立刻解析 ~70MB 普速 china-rail.graph。关预热：RAIL_SEG_PREWARM=0
 * 或 RAIL_SEG_PREWARM_DELAY_MS=-1。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSegmentGeometry, isHighspeedTrain } from './osmRailway.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOTLIST = join(__dirname, '../../../../data/presets/precise-hotlist.json');

type HotStop = { name?: string; lng?: number; lat?: number };
type HotEntry = { id?: string; trainCode?: string; stops?: HotStop[] };
type PrewarmMode = 'all' | 'hsr';

function enabled(): boolean {
  const v = String(process.env.RAIL_SEG_PREWARM ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

function useNetwork(): boolean {
  const v = String(process.env.RAIL_SEG_PREWARM_NETWORK ?? '0').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/** all = 热清单全量；hsr = 只预热高铁车次（省普速大图内存） */
export function prewarmMode(): PrewarmMode {
  const m = String(process.env.RAIL_SEG_PREWARM_MODE ?? 'all').trim().toLowerCase();
  if (m === 'hsr' || m === 'highspeed' || m === 'gdc') return 'hsr';
  return 'all';
}

function loadHotlist(): HotEntry[] {
  if (!existsSync(HOTLIST)) return [];
  try {
    const raw = JSON.parse(readFileSync(HOTLIST, 'utf8')) as { entries?: HotEntry[] };
    return Array.isArray(raw.entries) ? raw.entries : [];
  } catch (e) {
    console.warn('[seg-prewarm] hotlist unreadable', e);
    return [];
  }
}

export async function prewarmSegments(): Promise<{ entries: number; segments: number; ms: number }> {
  const empty = { entries: 0, segments: 0, ms: 0 };
  if (!enabled()) return empty;

  const mode = prewarmMode();
  let entries = loadHotlist();
  if (mode === 'hsr') {
    const before = entries.length;
    entries = entries.filter((e) => isHighspeedTrain(e.trainCode));
    if (before > entries.length) {
      console.log(
        `[seg-prewarm] mode=hsr skipped ${before - entries.length} conventional hotlist entries`,
      );
    }
  }
  if (!entries.length) return empty;

  const network = useNetwork();
  const concurrency = Math.max(1, Number(process.env.RAIL_SEG_PREWARM_CONCURRENCY || 2));
  const pairs: Array<{ from: { lng: number; lat: number }; to: { lng: number; lat: number }; hs: boolean }> = [];
  const seen = new Set<string>();

  for (const e of entries) {
    const hs = isHighspeedTrain(e.trainCode);
    const stops = (e.stops || []).filter(
      (s) => Number.isFinite(s.lng) && Number.isFinite(s.lat),
    ) as Array<{ name?: string; lng: number; lat: number }>;
    for (let i = 0; i + 1 < stops.length; i += 1) {
      const from = stops[i];
      const to = stops[i + 1];
      const key = `${hs ? 'hs' : 'cv'}|${from.lng.toFixed(3)},${from.lat.toFixed(3)}|${to.lng.toFixed(3)},${to.lat.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ from: { lng: from.lng, lat: from.lat }, to: { lng: to.lng, lat: to.lat }, hs });
    }
  }
  if (!pairs.length) return empty;

  const t0 = Date.now();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, pairs.length) }, async () => {
    for (;;) {
      const idx = cursor;
      cursor += 1;
      if (idx >= pairs.length) return;
      const p = pairs[idx];
      try {
        await buildSegmentGeometry(p.from, p.to, {
          preferHighspeed: p.hs,
          network,
        });
      } catch {
        /* 预热失败不阻塞启动 */
      }
    }
  });
  await Promise.all(workers);

  const ms = Date.now() - t0;
  console.log(
    `[seg-prewarm] mode=${mode} entries=${entries.length} segments=${pairs.length} network=${network} ${ms}ms`,
  );
  return { entries: entries.length, segments: pairs.length, ms };
}
