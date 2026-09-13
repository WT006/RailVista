import { randomBytes } from 'node:crypto';
import { haversineKm } from '@railvista/shared';
import {
  buildRailGeometry,
  buildSegmentGeometry,
  formatRailCoords,
  isHighspeedTrain,
  type LngLat,
} from './osmRailway.js';
import { matchCorridor, sliceCorridorForStops } from './corridors.js';
import { matchCorridorNetwork } from './corridorNetwork.js';

export type RailJobStatus = 'queued' | 'running' | 'done' | 'partial' | 'failed';

export type NamedStop = { name: string; lng: number; lat: number };

/** 前端分层展示用 */
export type RailQualityTier = 'corridor' | 'network' | 'local' | 'osm' | 'soft' | 'mixed' | 'station';

export type RailJobSnapshot = {
  jobId: string;
  status: RailJobStatus;
  segmentsTotal: number;
  segmentsDone: number;
  segmentsOk: number;
  coords: [number, number][];
  source: 'osm' | 'mixed' | 'station';
  message: string;
  /** 精度层级，供 UI 区分文案 */
  qualityTier?: RailQualityTier;
  trainCode?: string;
  /** 校正后的经停坐标（必须带站名，供前端按名合并） */
  stops?: NamedStop[];
};

type SegSlot = { coords: LngLat[]; ok: boolean; reason?: string } | null;

type RailJob = Omit<RailJobSnapshot, 'stops'> & {
  stops: NamedStop[];
  slots: SegSlot[];
  clientKey: string;
  stopsFp: string;
  createdAt: number;
  updatedAt: number;
};

const JOB_TTL_MS = 30 * 60 * 1000;
/** 本地轨网为主时可适度并发 */
const CONCURRENCY = 3;
const STRICT_VIA_KM = 12;
const SOFT_VIA_KM = 25;
const jobs = new Map<string, RailJob>();
const runningByClient = new Map<string, string>();
/** 同 OD 最近一次结束的任务，供失败段定向重试 */
const lastFinishedByClient = new Map<string, string>();

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
      if (runningByClient.get(job.clientKey) === id) runningByClient.delete(job.clientKey);
      if (lastFinishedByClient.get(job.clientKey) === id) lastFinishedByClient.delete(job.clientKey);
    }
  }
}

function stopsFingerprint(stops: NamedStop[], trainCode?: string): string {
  return `${trainCode || ''}|${stops.map((s) => `${s.name}:${s.lng.toFixed(3)},${s.lat.toFixed(3)}`).join('|')}`;
}

function mergeSlots(stops: NamedStop[], slots: SegSlot[]): LngLat[] {
  const merged: LngLat[] = [];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const slot = slots[i];
    // 跨站补缝：精确折线已挂在缺口首段，后续段跳过以免示意线叠回
    if (slot?.reason === 'bridge:skip' || slot?.reason === 'bridge:soft-skip') continue;
    const fallback: LngLat[] = [
      { lng: stops[i].lng, lat: stops[i].lat },
      { lng: stops[i + 1].lng, lat: stops[i + 1].lat },
    ];
    const line = slot && slot.coords.length >= 2 ? slot.coords : fallback;
    if (merged.length) merged.push(...line.slice(1));
    else merged.push(...line);
  }
  return merged;
}

function deriveQualityTier(job: RailJob): RailQualityTier {
  const reasons = job.slots.map((s) => s?.reason || '').filter(Boolean);
  if (reasons.some((r) => r.startsWith('corridor:'))) return 'corridor';
  if (reasons.some((r) => r.startsWith('network:'))) return 'network';
  if (job.segmentsOk === 0) return 'station';
  const hasSoft = reasons.some((r) => r.includes('bridge:soft'));
  const hasLocal = reasons.some((r) => r === 'local' || r.startsWith('local'));
  const hasOsm = reasons.some((r) => r === 'osm' || r.includes(':span'));
  if (hasSoft && job.segmentsOk < job.segmentsTotal) return 'soft';
  if (hasSoft && job.segmentsOk === job.segmentsTotal) return 'soft';
  if (job.segmentsOk < job.segmentsTotal) return 'mixed';
  if (hasLocal && !hasOsm) return 'local';
  if (hasOsm) return 'osm';
  if (hasLocal) return 'local';
  return 'mixed';
}

function refreshJobDerived(job: RailJob) {
  const ok = job.slots.filter((s) => s?.ok).length;
  job.segmentsOk = ok;
  job.coords = formatRailCoords(mergeSlots(job.stops, job.slots));
  if (ok === 0) job.source = 'station';
  else if (ok >= Math.ceil(job.segmentsTotal * 0.7)) job.source = 'osm';
  else job.source = 'mixed';
  job.qualityTier = deriveQualityTier(job);
  job.updatedAt = Date.now();
}

function snapshot(job: RailJob): RailJobSnapshot {
  return {
    jobId: job.jobId,
    status: job.status,
    segmentsTotal: job.segmentsTotal,
    segmentsDone: job.segmentsDone,
    segmentsOk: job.segmentsOk,
    coords: job.coords,
    source: job.source,
    message: job.message,
    qualityTier: job.qualityTier,
    trainCode: job.trainCode,
    stops: job.stops.map((s) => ({ name: s.name, lng: s.lng, lat: s.lat })),
  };
}

function finalizeMessage(job: RailJob) {
  const tier = job.qualityTier || deriveQualityTier(job);
  if (job.segmentsOk === 0) {
    const reasons = job.slots.map((s) => s?.reason).filter(Boolean);
    const mostlyEmpty =
      reasons.filter((r) => r === 'overpass_empty' || r === 'no_ways').length >=
      Math.ceil(job.segmentsTotal / 2);
    job.status = 'failed';
    job.message = mostlyEmpty
      ? '暂无可用轨道数据（本地未覆盖且 OSM 不可用），请稍后重试'
      : '未能匹配精确轨道，仍为示意线';
    return;
  }
  if (job.segmentsOk < job.segmentsTotal) {
    job.status = 'partial';
    if (tier === 'soft') {
      job.message = `近似轨道（跨站补缝） ${job.segmentsOk}/${job.segmentsTotal}，缺口为示意`;
    } else {
      job.message = `部分精确 ${job.segmentsOk}/${job.segmentsTotal}，缺口为示意`;
    }
    return;
  }
  job.status = 'done';
  if (tier === 'corridor') job.message = job.message || '真实轨道线（精品走廊）';
  else if (tier === 'network') job.message = job.message || '真实轨道线（精品路网）';
  else if (tier === 'local') job.message = '真实轨道线（本地轨网）';
  else if (tier === 'soft') job.message = '近似轨道（跨站补缝）';
  else if (tier === 'osm') job.message = '真实轨道线（OSM）';
  else job.message = '真实轨道线（按需生成）';
}

async function runJob(job: RailJob, opts?: { onlyFailed?: boolean }) {
  job.status = 'running';
  if (!opts?.onlyFailed) {
    job.message = `加载中 0/${job.segmentsTotal}`;
  } else {
    job.message = `重试缺口…`;
  }
  refreshJobDerived(job);

  // 0) 先尝试精品走廊 / 路网拼接（整段精确，避免站间 OSM 部分失败）
  if (!opts?.onlyFailed) {
    try {
      const corridorStops = job.stops.map((s) => ({ name: s.name, lng: s.lng, lat: s.lat }));
      const single = matchCorridor(corridorStops, { trainCode: job.trainCode });
      const sliced = single ? sliceCorridorForStops(single.corridor, corridorStops) : null;
      if (sliced && sliced.length >= 2) {
        for (let i = 0; i < job.segmentsTotal; i++) {
          job.slots[i] = { coords: [], ok: true, reason: `corridor:${single!.corridor.id}` };
        }
        job.segmentsDone = job.segmentsTotal;
        job.segmentsOk = job.segmentsTotal;
        job.coords = sliced;
        job.source = 'osm';
        job.qualityTier = 'corridor';
        job.status = 'done';
        job.message = `真实轨道线（精品走廊 ${single!.corridor.name}）`;
        job.updatedAt = Date.now();
        finishJob(job);
        return;
      }
      const networked = matchCorridorNetwork(corridorStops, { trainCode: job.trainCode });
      if (networked?.coords && networked.coords.length >= 2) {
        for (let i = 0; i < job.segmentsTotal; i++) {
          job.slots[i] = {
            coords: [],
            ok: true,
            reason: `network:${networked.corridorIds.join('+')}`,
          };
        }
        job.segmentsDone = job.segmentsTotal;
        job.segmentsOk = job.segmentsTotal;
        job.coords = networked.coords;
        job.source = 'osm';
        job.qualityTier = 'network';
        job.status = 'done';
        job.message = `真实轨道线（精品路网 ${networked.corridorNames.join(' + ')}）`;
        job.updatedAt = Date.now();
        finishJob(job);
        return;
      }
    } catch (e) {
      console.warn('[rail-job] corridor shortcut failed', job.jobId, e);
    }
  }

  const preferHs = isHighspeedTrain(job.trainCode);
  const pending: number[] = [];
  for (let i = 0; i < job.segmentsTotal; i++) {
    if (opts?.onlyFailed) {
      if (!job.slots[i]?.ok) pending.push(i);
    } else {
      pending.push(i);
    }
  }

  let next = 0;
  const worker = async () => {
    while (true) {
      const pi = next;
      next += 1;
      if (pi >= pending.length) return;
      const i = pending[pi];

      const from = job.stops[i];
      const to = job.stops[i + 1];
      try {
        const seg = await buildSegmentGeometry(from, to, { preferHighspeed: preferHs });
        job.slots[i] = { coords: seg.coords, ok: seg.ok, reason: seg.reason };
      } catch (e) {
        console.warn('[rail-job] segment failed', job.jobId, i, e);
        job.slots[i] = {
          coords: [from, to],
          ok: false,
          reason: e instanceof Error ? e.message : 'error',
        };
      }

      job.segmentsDone = job.slots.filter((s) => s != null).length;
      refreshJobDerived(job);
      job.message = `加载中 ${job.segmentsDone}/${job.segmentsTotal}`;
    }
  };

  const n = Math.min(CONCURRENCY, Math.max(1, pending.length));
  if (pending.length) {
    await Promise.all(Array.from({ length: n }, () => worker()));
  }

  // 失败段：严格/软桥补缝
  await bridgeFailedSegments(job, preferHs);

  // 仍有缺口：整 OD 一次 Overpass 寻路回退（山区常比逐 hop 稳）
  if (job.segmentsOk < job.segmentsTotal) {
    await tryWholeTripFallback(job);
  }

  finalizeMessage(job);
  refreshJobDerived(job);
  finishJob(job);
}

function finishJob(job: RailJob) {
  if (runningByClient.get(job.clientKey) === job.jobId) {
    runningByClient.delete(job.clientKey);
  }
  lastFinishedByClient.set(job.clientKey, job.jobId);
}

/** 折线上最近点距离（km）；用于判断桥接线是否仍经过被跳过的中间站 */
function minDistToPolylineKm(pt: LngLat, line: LngLat[]): number {
  let best = Infinity;
  for (const p of line) {
    const d = haversineKm(pt, p);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 连续失败段：尝试 from(缺口前)→to(缺口后) 一次拼线。
 * 严格桥 via≤12km；软桥 via≤25km（reason=bridge:soft，前端标近似）。
 */
async function bridgeFailedSegments(job: RailJob, preferHs: boolean) {
  let i = 0;
  while (i < job.segmentsTotal) {
    if (job.slots[i]?.ok) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < job.segmentsTotal && !job.slots[j]?.ok) j += 1;
    const span = j - i;
    if (span >= 1 && span <= 4) {
      const from = job.stops[i];
      const to = job.stops[j];
      if (to) {
        try {
          const seg = await buildSegmentGeometry(from, to, { preferHighspeed: preferHs });
          if (seg.ok && seg.coords.length >= 2) {
            const vias = job.stops.slice(i + 1, j);
            const farStrict = vias.find((v) => minDistToPolylineKm(v, seg.coords) > STRICT_VIA_KM);
            const farSoft = vias.find((v) => minDistToPolylineKm(v, seg.coords) > SOFT_VIA_KM);
            if (!farStrict) {
              applyBridge(job, i, j, seg.coords, `${seg.reason || 'bridge'}:span`, 'bridge:skip');
            } else if (!farSoft) {
              console.warn(
                `[rail-job] soft bridge via ${farStrict.name} span ${from.name}→${to.name}`,
                job.jobId,
              );
              applyBridge(job, i, j, seg.coords, 'bridge:soft:span', 'bridge:soft-skip');
            } else {
              console.warn(
                `[rail-job] bridge reject via ${farSoft.name} far from span ${from.name}→${to.name}`,
                job.jobId,
              );
            }
          }
        } catch (e) {
          console.warn('[rail-job] bridge failed', job.jobId, i, j, e);
        }
      }
    }
    i = Math.max(j, i + 1);
  }
}

function applyBridge(
  job: RailJob,
  i: number,
  j: number,
  coords: LngLat[],
  headReason: string,
  skipReason: string,
) {
  job.slots[i] = { coords, ok: true, reason: headReason };
  for (let k = i + 1; k < j; k++) {
    job.slots[k] = { coords: [], ok: true, reason: skipReason };
  }
  refreshJobDerived(job);
}

/** 整段 OD 一次构图；若整趟连通则覆盖为完整精确线 */
async function tryWholeTripFallback(job: RailJob) {
  try {
    const result = await buildRailGeometry(
      job.stops.map((s) => ({ lng: s.lng, lat: s.lat })),
      job.trainCode,
    );
    if (result.source === 'none' || result.coords.length < 2) return;
    // 仅当整趟（或几乎整趟）连通时采用，避免用不完整整图覆盖已有好段
    if (result.segmentsOk < job.segmentsTotal && result.segmentsOk <= job.segmentsOk) return;
    if (result.segmentsOk < Math.ceil(job.segmentsTotal * 0.85)) return;

    job.slots[0] = {
      coords: result.coords.map(([lng, lat]) => ({ lng, lat })),
      ok: true,
      reason: 'osm:whole',
    };
    for (let k = 1; k < job.segmentsTotal; k++) {
      job.slots[k] = { coords: [], ok: true, reason: 'bridge:skip' };
    }
    job.coords = result.coords;
    job.source = result.source === 'osm' ? 'osm' : 'mixed';
    refreshJobDerived(job);
    console.log(
      `[rail-job] whole-trip fallback ok ${result.segmentsOk}/${result.segmentsTotal}`,
      job.jobId,
    );
  } catch (e) {
    console.warn('[rail-job] whole-trip fallback failed', job.jobId, e);
  }
}

export function createRailGeometryJob(params: {
  stops: Array<{ name?: string; lng: number; lat: number }>;
  trainCode?: string;
  clientKey: string;
  /** 仅重算上一趟失败段，保留已成功的精确段 */
  retryFailedOnly?: boolean;
}): RailJobSnapshot {
  pruneJobs();

  const stops: NamedStop[] = params.stops
    .filter((s) => Number.isFinite(s.lng) && Number.isFinite(s.lat))
    .map((s, i) => ({
      name: (s.name || '').trim() || `stop_${i}`,
      lng: Number(s.lng),
      lat: Number(s.lat),
    }));
  if (stops.length < 2) {
    throw Object.assign(new Error('至少需要 2 个可定位的经停站'), { code: 'BAD_REQUEST' });
  }

  const existingId = runningByClient.get(params.clientKey);
  if (existingId) {
    const existing = jobs.get(existingId);
    if (existing && (existing.status === 'queued' || existing.status === 'running')) {
      return snapshot(existing);
    }
  }

  const fp = stopsFingerprint(stops, params.trainCode);
  const jobId = `rj_${randomBytes(8).toString('hex')}`;
  const total = stops.length - 1;

  let slots: SegSlot[] = Array.from({ length: total }, () => null);
  let onlyFailed = false;

  if (params.retryFailedOnly) {
    const prevId = lastFinishedByClient.get(params.clientKey);
    const prev = prevId ? jobs.get(prevId) : undefined;
    if (
      prev &&
      prev.stopsFp === fp &&
      (prev.status === 'partial' || prev.status === 'failed') &&
      prev.slots.length === total
    ) {
      slots = prev.slots.map((s) => (s ? { ...s, coords: [...(s.coords || [])] } : null));
      onlyFailed = slots.some((s) => !s?.ok);
      if (!onlyFailed) {
        // 无失败段则整趟重跑
        slots = Array.from({ length: total }, () => null);
      }
    }
  }

  const job: RailJob = {
    jobId,
    status: 'queued',
    segmentsTotal: total,
    segmentsDone: slots.filter((s) => s != null).length,
    segmentsOk: slots.filter((s) => s?.ok).length,
    coords: formatRailCoords(
      mergeSlots(
        stops,
        slots.map((s) => s || { coords: [], ok: false }),
      ),
    ),
    source: 'station',
    message: onlyFailed ? '重试缺口…' : '排队中',
    qualityTier: 'station',
    trainCode: params.trainCode,
    stops,
    slots,
    clientKey: params.clientKey,
    stopsFp: fp,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  jobs.set(jobId, job);
  runningByClient.set(params.clientKey, jobId);
  void runJob(job, { onlyFailed }).catch((e) => {
    console.error('[rail-job] fatal', jobId, e);
    job.status = 'failed';
    job.message = e instanceof Error ? e.message : '精确路线生成失败';
    refreshJobDerived(job);
    finishJob(job);
  });

  return snapshot(job);
}

export function getRailGeometryJob(jobId: string): RailJobSnapshot | null {
  pruneJobs();
  const job = jobs.get(jobId);
  return job ? snapshot(job) : null;
}
