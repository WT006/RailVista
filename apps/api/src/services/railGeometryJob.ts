import { randomBytes } from 'node:crypto';
import { haversineKm, type ScenicSpot } from '@railvista/shared';
import {
  buildRailGeometry,
  buildSegmentGeometry,
  formatRailCoords,
  isHighspeedTrain,
  type LngLat,
} from './osmRailway.js';
import { matchCorridor, sliceCorridorForStops, loadCorridors } from './corridors.js';
import {
  matchCorridorNetwork,
  validateStopsOnCoords,
  anchorSliceEndpoints,
} from './corridorNetwork.js';
import { matchScenicSpotsForRailway } from './scenicSpots.js';
import { getPreciseHotCache, savePreciseHotCache } from './preciseRouteCache.js';
import { findWholeTripLocalPath } from './localRails.js';
import * as overpassTracker from './overpassTracker.js';
import { validateWholeTripPath } from './wholeTripGate.js';
import {
  isTopologyEnabled,
  loadTopology,
  routeStops as topoRouteStops,
  lineNameIds,
} from './railTopology.js';

/** 收集任务经停站命中的走廊线路名集合 → 拓扑边权 id 集合（线路名加权防串线） */
function collectLineNamesForStops(stops: Array<{ name: string }>): Set<number> {
  const names = new Set(stops.map((s) => (s.name || '').replace(/站$/, '').trim()).filter(Boolean));
  if (!names.size) return new Set();
  const lineNames: string[] = [];
  try {
    for (const c of loadCorridors()) {
      const hits = (c.stationsHint || []).some((h) => names.has((h || '').replace(/站$/, '').trim()));
      if (!hits) continue;
      if (c.name) lineNames.push(c.name);
      if (Array.isArray(c.sourceNames)) lineNames.push(...c.sourceNames);
    }
  } catch {
    /* 走廊加载失败不阻塞拓扑寻路 */
  }
  return lineNameIds(lineNames);
}

type CorridorShortcut = {
  coords: [number, number][];
  reason: string;
  tier: Extract<RailQualityTier, 'corridor' | 'network'>;
  message: string;
};

/**
 * 精品走廊/路网整段短路（v3 P0-2：从「首道短路」降为拓扑之后的兜底）。
 * 单走廊切片首尾锚定 OD 站坐标后必须过站级硬门禁；路网结果在 matchCorridorNetwork
 * 内部已过同一门禁。任一经停投影超阈即返回 null，让位给拓扑/逐段 OSM。
 */
function tryCorridorShortcut(stops: NamedStop[], trainCode?: string): CorridorShortcut | null {
  try {
    const single = matchCorridor(stops, { trainCode });
    const sliced = single ? sliceCorridorForStops(single.corridor, stops) : null;
    if (single && sliced && sliced.length >= 2) {
      const anchored = anchorSliceEndpoints(sliced, stops[0], stops[stops.length - 1]);
      const gate = validateStopsOnCoords(anchored, stops, { trainCode, seams: [] });
      if (gate.ok) {
        return {
          coords: anchored,
          reason: `corridor:${single.corridor.id}`,
          tier: 'corridor',
          message: `真实轨道线（精品走廊 ${single.corridor.name}）`,
        };
      }
      console.warn(
        `[rail-job] corridor slice rejected by strict gate: ${gate.reason}`,
        gate.worstStop || '',
        gate.worstKm != null ? Number(gate.worstKm).toFixed(1) : '',
      );
    }
    const networked = matchCorridorNetwork(stops, { trainCode });
    if (networked?.coords && networked.coords.length >= 2) {
      return {
        coords: networked.coords,
        reason: `network:${networked.corridorIds.join('+')}`,
        tier: 'network',
        message: `真实轨道线（精品路网 ${networked.corridorNames.join(' + ')}）`,
      };
    }
  } catch (e) {
    console.warn('[rail-job] corridor shortcut failed', e);
  }
  return null;
}

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
  source: 'osm' | 'mixed' | 'station' | 'local';
  message: string;
  /** 精度层级，供 UI 区分文案 */
  qualityTier?: RailQualityTier;
  trainCode?: string;
  /** 校正后的经停坐标（必须带站名，供前端按名合并） */
  stops?: NamedStop[];
  /** B4：geocode 失败未能定位的经停站名（不再静默丢弃，供前端提示与审计） */
  unresolvedStops?: string[];
  /** 按当前 coords 过滤的风景点 */
  scenicSpots?: ScenicSpot[];
};

type SegSlot = { coords: LngLat[]; ok: boolean; reason?: string } | null;

type RailJob = Omit<RailJobSnapshot, 'stops'> & {
  stops: NamedStop[];
  unresolvedStops: string[];
  slots: SegSlot[];
  clientKey: string;
  stopsFp: string;
  createdAt: number;
  updatedAt: number;
  /** 被同客户端新 OD 任务取代后不再写缓存 / 进度 */
  abandoned?: boolean;
};

const JOB_TTL_MS = 30 * 60 * 1000;
/**
 * 整趟精确任务墙钟上限：超时后用已有结果收尾，避免卡在 Overpass。
 * B5：默认提到 120s，长途车（段数>10 的 K/T/Z）按 10s/段放宽，减少「超时降级示意线」长尾。
 */
function jobMaxMs(job?: { segmentsTotal: number }) {
  const base = Number(process.env.RAIL_JOB_MAX_MS || 0);
  if (base > 0) return base;
  const bySegments = job ? job.segmentsTotal * 10_000 : 0;
  return Math.max(120_000, bySegments);
}
/** 同时真正跑 runJob 的上限（多人共享） */
function maxInflightJobs() {
  return Math.max(1, Number(process.env.RAIL_JOB_MAX_INFLIGHT || 8));
}
/** 等待开跑的排队上限；满则 BUSY */
function maxQueuedJobs() {
  return Math.max(0, Number(process.env.RAIL_JOB_MAX_QUEUED || 24));
}
/** 本地轨网为主时可适度并发 */
const CONCURRENCY = 3;
const STRICT_VIA_KM = 12;
const SOFT_VIA_KM = 25;
const jobs = new Map<string, RailJob>();
/** 同一浏览器 clientKey 当前进行中的任务（换 OD 时作废旧任务） */
const runningByClient = new Map<string, string>();
/** 同客户端 + 同 OD 最近一次结束的任务，供失败段定向重试 */
const lastFinishedByKey = new Map<string, string>();
let inflightJobs = 0;
const startQueue: Array<{ job: RailJob; onlyFailed: boolean }> = [];

function finishedKey(clientKey: string, stopsFp: string) {
  return `${clientKey}||${stopsFp}`;
}

function jobTimedOut(job: RailJob): boolean {
  return Date.now() - job.createdAt >= jobMaxMs(job);
}

function shouldStopJob(job: RailJob): boolean {
  return !!job.abandoned || jobTimedOut(job);
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
      if (runningByClient.get(job.clientKey) === id) runningByClient.delete(job.clientKey);
      const fk = finishedKey(job.clientKey, job.stopsFp);
      if (lastFinishedByKey.get(fk) === id) lastFinishedByKey.delete(fk);
      removeFromStartQueue(id);
    }
  }
}

function removeFromStartQueue(jobId: string) {
  const i = startQueue.findIndex((q) => q.job.jobId === jobId);
  if (i >= 0) startQueue.splice(i, 1);
}

function launchJob(job: RailJob, opts?: { onlyFailed?: boolean }) {
  inflightJobs += 1;
  void runJob(job, opts)
    .catch((e) => {
      console.error('[rail-job] fatal', job.jobId, e);
      if (!job.abandoned) {
        job.status = 'failed';
        job.message = e instanceof Error ? e.message : '精确路线生成失败';
        refreshJobDerived(job);
        finishJob(job);
      }
    })
    .finally(() => {
      inflightJobs = Math.max(0, inflightJobs - 1);
      pumpStartQueue();
    });
}

function pumpStartQueue() {
  while (inflightJobs < maxInflightJobs() && startQueue.length) {
    const next = startQueue.shift()!;
    if (next.job.abandoned) continue;
    if (next.job.status !== 'queued' && next.job.status !== 'running') continue;
    next.job.message = next.onlyFailed ? '重试缺口…' : '加载中…';
    next.job.updatedAt = Date.now();
    launchJob(next.job, { onlyFailed: next.onlyFailed });
  }
  startQueue.forEach((q, i) => {
    if (!q.job.abandoned && q.job.status === 'queued') {
      q.job.message = `排队中（第 ${i + 1} 位）…`;
      q.job.updatedAt = Date.now();
    }
  });
}

function scheduleRunJob(job: RailJob, opts?: { onlyFailed?: boolean }) {
  if (inflightJobs < maxInflightJobs()) {
    launchJob(job, opts);
    return;
  }
  job.message = `排队中（第 ${startQueue.length + 1} 位）…`;
  startQueue.push({ job, onlyFailed: !!opts?.onlyFailed });
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
  const merged = formatRailCoords(mergeSlots(job.stops, job.slots));
  const hasRealSlotCoords = job.slots.some((s) => !!(s?.ok && s.coords.length >= 2));
  // 走廊/热缓存/种子折线：槽位常无 coords，禁止 mergeSlots 退化成站间示意线
  if (hasRealSlotCoords || job.coords.length < 2) {
    job.coords = merged;
  }
  if (ok === 0) job.source = 'station';
  else if (ok >= Math.ceil(job.segmentsTotal * 0.7)) {
    if (job.source === 'station') job.source = 'osm';
  } else if (job.source === 'station') {
    job.source = 'mixed';
  }
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
    unresolvedStops: job.unresolvedStops?.length ? job.unresolvedStops : undefined,
    scenicSpots: matchScenicSpotsForRailway(job.coords),
  };
}

function finalizeMessage(job: RailJob, opts?: { timedOut?: boolean }) {
  const tier = job.qualityTier || deriveQualityTier(job);
  const timedOut = !!opts?.timedOut || jobTimedOut(job);
  if (job.segmentsOk === 0) {
    const reasons = job.slots.map((s) => s?.reason).filter(Boolean);
    const mostlyEmpty =
      reasons.filter((r) => r === 'overpass_empty' || r === 'no_ways' || r === 'overpass_disabled')
        .length >= Math.ceil(job.segmentsTotal / 2);
    // 二期：零成功段不硬 failed，保留示意线并可重试
    job.status = 'partial';
    job.qualityTier = 'station';
    if (timedOut) {
      job.message = '精确路线加载超时，仍为示意线，可稍后重试';
    } else {
      job.message = mostlyEmpty
        ? '暂无可用轨道数据（本地未覆盖且 OSM 不可用），仍为示意线，可稍后重试'
        : '未能匹配精确轨道，仍为示意线，可重试';
    }
    return;
  }
  if (job.segmentsOk < job.segmentsTotal) {
    job.status = 'partial';
    if (timedOut) {
      job.message = `部分精确 ${job.segmentsOk}/${job.segmentsTotal}（加载超时），缺口为示意，可重试缺口`;
    } else if (tier === 'soft') {
      job.message = `部分精确 ${job.segmentsOk}/${job.segmentsTotal}（跨站补缝），缺口为示意`;
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
  if (job.abandoned) return;
  job.status = 'running';
  if (!opts?.onlyFailed) {
    job.message = `加载中 0/${job.segmentsTotal}`;
  } else {
    job.message = `重试缺口…`;
  }
  refreshJobDerived(job);

  // 0) 热门指纹缓存（含真实轨段的成功/部分结果）
  if (!opts?.onlyFailed) {
    const hot = getPreciseHotCache(job.trainCode, job.stops);
    // v3：热缓存回放前必须过站级硬门禁。缓存条目不携带 seams，
    // 接缝处按段内阈值判（更严；误杀仅损失缓存收益，触发重算，不会放出坏线）。
    const hotGate =
      hot && hot.coords.length >= 2
        ? validateStopsOnCoords(hot.coords, job.stops, { trainCode: job.trainCode })
        : null;
    if (hot && hotGate && !hotGate.ok) {
      console.warn(
        `[rail-job] hot cache rejected by strict gate: ${hotGate.reason}`,
        hotGate.worstStop || '',
        hotGate.worstKm != null ? Number(hotGate.worstKm).toFixed(1) : '',
      );
    }
    if (hot && hot.coords.length >= 2 && hotGate?.ok) {
      if (job.abandoned) return;
      const okCount = Math.min(hot.segmentsOk, job.segmentsTotal);
      for (let i = 0; i < job.segmentsTotal; i++) {
        job.slots[i] =
          i < okCount
            ? { coords: [], ok: true, reason: 'hot-cache' }
            : { coords: [], ok: false, reason: 'hot-cache-gap' };
      }
      job.segmentsDone = job.segmentsTotal;
      job.segmentsOk = okCount;
      job.coords = hot.coords;
      job.source = hot.source;
      job.qualityTier = (hot.qualityTier as RailQualityTier) || 'local';
      job.status = okCount >= job.segmentsTotal ? 'done' : 'partial';
      job.message =
        hot.message ||
        (okCount >= job.segmentsTotal
          ? '真实轨道线（热门缓存）'
          : `部分精确（热门缓存） ${okCount}/${job.segmentsTotal}`);
      job.updatedAt = Date.now();
      finishJob(job);
      return;
    }
  }

  if (job.abandoned) return;

  const preferHs = isHighspeedTrain(job.trainCode);

  // 1) 拓扑优先（v3 P0-2：真·全图逐段，经停锚定在线；实测 K771 逐站投影 0.0km）。
  //    旧顺序里走廊/路网短路在拓扑之前，宽松门禁（45km/55%/280km）会截胡拓扑，
  //    放出偏离站坐标 9~112km 的坏拼线。现改为：拓扑全成功 → done；
  //    部分成功 → 成功段写槽位，失败段先走廊按段兜底再逐段 OSM；
  //    拓扑未启用/加载失败/抛错 → 保持原「走廊整段 → 贪心整趟 → 逐段」兜底链。
  let topoPartialDone = false;
  let greedyFallbackAllowed = false;
  if (isTopologyEnabled()) {
    if (loadTopology()) {
      try {
        const lineHitSet = collectLineNamesForStops(job.stops);
        const routed = topoRouteStops(job.stops, { highspeed: preferHs, lineHitSet });
        // 拓扑结果同样必须过站级硬门禁（实测 C650 拓扑绕路：折线 628km / 站序弦长 228km）
        const wholeGate =
          routed.failures.length === 0 && routed.coords.length >= 2
            ? validateStopsOnCoords(routed.coords, job.stops, { trainCode: job.trainCode })
            : null;
        if (wholeGate?.ok) {
          if (job.abandoned) return;
          for (let i = 0; i < job.segmentsTotal; i++) {
            job.slots[i] = { coords: [], ok: true, reason: 'topo' };
          }
          job.segmentsDone = job.segmentsTotal;
          job.segmentsOk = job.segmentsTotal;
          job.coords = routed.coords;
          job.source = 'local';
          job.qualityTier = 'local';
          job.status = 'done';
          job.message = '真实轨道线（全图拓扑逐段寻路）';
          job.updatedAt = Date.now();
          finishJob(job);
          return;
        }
        if (wholeGate && !wholeGate.ok) {
          // 整图绕路/折返/离线：丢弃全部拓扑段，走「整段走廊兜底 → 按段走廊 → 逐段 OSM」
          console.warn(
            `[rail-topology] whole result rejected by strict gate: ${wholeGate.reason}`,
            wholeGate.worstStop || '',
            wholeGate.worstKm != null ? Number(wholeGate.worstKm).toFixed(1) : '',
            job.jobId,
          );
          greedyFallbackAllowed = true;
        } else {
          let okCount = 0;
          for (let i = 0; i < routed.segResults.length && i < job.segmentsTotal; i++) {
            const sr = routed.segResults[i];
            if (!sr.ok) continue;
            // 部分成功的拓扑段也要逐段过门禁（离线/跳变段不写槽，交走廊/OSM 重算）
            const segGate = validateStopsOnCoords(
              sr.coords as [number, number][],
              [job.stops[i], job.stops[i + 1]],
              { trainCode: job.trainCode, seams: [] },
            );
            if (!segGate.ok) continue;
            job.slots[i] = {
              coords: sr.coords.map(([lng, lat]) => ({ lng, lat })),
              ok: true,
              reason: 'topo',
            };
            okCount++;
          }
          if (okCount > 0) {
            // 部分成功：成功段写槽位，失败段交给既有逐段流程（走廊切片/公网兜底）
            topoPartialDone = true;
            console.log(
              `[rail-topology] partial ${okCount}/${job.segmentsTotal}, failures=${routed.failures.map((f) => f.reason).join(',')}`,
              job.jobId,
            );
          }
          // 全部段失败：不再执行老贪心整趟（防绕过逐段精度），直接落逐段流程
        }
      } catch (e) {
        console.warn('[rail-topology] routeStops failed, fallback to greedy', job.jobId, e);
        greedyFallbackAllowed = true;
      }
    } else {
      console.warn('[rail-topology] load failed, fallback to greedy', job.jobId);
      greedyFallbackAllowed = true;
    }
  } else {
    greedyFallbackAllowed = true;
  }

  // 2) 拓扑不可用/整图被门禁拒绝时的整段精品走廊/路网短路（v3 P0-2：降为兜底，且必须过站级硬门禁）
  if (greedyFallbackAllowed && !opts?.onlyFailed) {
    const shortcut = tryCorridorShortcut(job.stops, job.trainCode);
    if (shortcut && !job.abandoned) {
      for (let i = 0; i < job.segmentsTotal; i++) {
        job.slots[i] = { coords: [], ok: true, reason: shortcut.reason };
      }
      job.segmentsDone = job.segmentsTotal;
      job.segmentsOk = job.segmentsTotal;
      job.coords = shortcut.coords;
      job.source = 'osm';
      job.qualityTier = shortcut.tier;
      job.status = 'done';
      job.message = shortcut.message;
      job.updatedAt = Date.now();
      finishJob(job);
      return;
    }
  }

  // 3) 老贪心整趟兜底（仅拓扑未启用/加载失败/抛错时）——必须过 S1 质量门禁
  if (greedyFallbackAllowed && !opts?.onlyFailed) {
    try {
      const odFrom = job.stops[0];
      const odTo = job.stops[job.stops.length - 1];
      const wholePath = findWholeTripLocalPath(odFrom, odTo, { highspeed: preferHs });
      if (wholePath && wholePath.length >= 2) {
        const gate = validateWholeTripPath(wholePath, job.stops, { trainCode: job.trainCode });
        if (!gate.ok) {
          console.warn(`[rail-job] whole-trip rejected: ${gate.stage} ${gate.detail || ''}`, job.jobId);
        } else if (job.abandoned) {
          return;
        } else {
          for (let i = 0; i < job.segmentsTotal; i++) {
            job.slots[i] = { coords: [], ok: true, reason: 'local:whole' };
          }
          job.segmentsDone = job.segmentsTotal;
          job.segmentsOk = job.segmentsTotal;
          job.coords = wholePath.map((p) => [p.lng, p.lat] as [number, number]);
          job.source = 'local';
          job.qualityTier = 'local';
          job.status = 'done';
          job.message = '真实轨道线（本地图全局寻路）';
          job.updatedAt = Date.now();
          finishJob(job);
          return;
        }
      }
    } catch (e) {
      console.warn('[rail-job] whole-trip local path failed', job.jobId, e);
    }
  }

  // 4) 拓扑部分成功/整图被拒：各失败段先尝试走廊「按段」切片（两站 OD + 硬门禁），
  //    走廊也无的段再进入逐段 OSM worker。
  const segCorridorFill =
    topoPartialDone || (greedyFallbackAllowed && !opts?.onlyFailed);
  let pending: number[] = [];
  for (let i = 0; i < job.segmentsTotal; i++) {
    if (opts?.onlyFailed || topoPartialDone) {
      if (!job.slots[i]?.ok) pending.push(i);
    } else {
      pending.push(i);
    }
  }
  if (segCorridorFill && pending.length && !job.abandoned) {
    const rest: number[] = [];
    let corridorFilled = 0;
    for (const i of pending) {
      if (job.abandoned) return;
      const segShortcut = tryCorridorShortcut([job.stops[i], job.stops[i + 1]], job.trainCode);
      if (segShortcut) {
        job.slots[i] = {
          coords: segShortcut.coords.map(([lng, lat]) => ({ lng, lat })),
          ok: true,
          reason: segShortcut.reason,
        };
        corridorFilled += 1;
      } else {
        rest.push(i);
      }
    }
    if (corridorFilled > 0) {
      console.log(
        `[rail-job] topo partial: corridor filled ${corridorFilled}/${pending.length}`,
        job.jobId,
      );
      refreshJobDerived(job);
    }
    pending = rest;
  }

  let next = 0;
  const worker = async () => {
    while (true) {
      if (shouldStopJob(job)) return;
      const pi = next;
      next += 1;
      if (pi >= pending.length) return;
      const i = pending[pi];

      const from = job.stops[i];
      const to = job.stops[i + 1];
      try {
        const seg = await buildSegmentGeometry(from, to, { preferHighspeed: preferHs });
        if (job.abandoned) return;
        job.slots[i] = { coords: seg.coords, ok: seg.ok, reason: seg.reason };
      } catch (e) {
        if (job.abandoned) return;
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

  if (job.abandoned) return;

  // 超时：不再补缝 / 整趟 Overpass，直接友好收尾
  if (jobTimedOut(job)) {
    console.warn('[rail-job] deadline after segments', job.jobId, `${jobMaxMs(job)}ms`);
    // 未写完的槽位按示意失败占位，保证 segmentsDone 完整
    for (let i = 0; i < job.segmentsTotal; i++) {
      if (job.slots[i] == null) {
        const from = job.stops[i];
        const to = job.stops[i + 1];
        job.slots[i] = { coords: [from, to], ok: false, reason: 'job_timeout' };
      }
    }
    job.segmentsDone = job.segmentsTotal;
    refreshJobDerived(job);
    finalizeMessage(job, { timedOut: true });
    refreshJobDerived(job);
    finishJob(job);
    return;
  }

  // 失败段：严格/软桥补缝（仍受墙钟限制）
  if (job.segmentsOk < job.segmentsTotal) {
    job.message = `补缝中 ${job.segmentsOk}/${job.segmentsTotal}…`;
    await bridgeFailedSegments(job, preferHs);
  }
  if (job.abandoned) return;

  if (jobTimedOut(job)) {
    console.warn('[rail-job] deadline after bridge', job.jobId);
    refreshJobDerived(job);
    finalizeMessage(job, { timedOut: true });
    refreshJobDerived(job);
    finishJob(job);
    return;
  }

  // 仍有缺口：短途才整 OD Overpass（长途如广州南→南京南会拖死）
  if (job.segmentsOk < job.segmentsTotal) {
    const longTrip = job.segmentsTotal >= 8 || job.stops.length >= 10;
    if (longTrip || overpassTracker.isLocalOnly()) {
      console.log(
        `[rail-job] skip whole-trip Overpass (long trip segs=${job.segmentsTotal} localOnly=${overpassTracker.isLocalOnly()})`,
        job.jobId,
      );
    } else {
      job.message = `收尾中 ${job.segmentsOk}/${job.segmentsTotal}…`;
      await tryWholeTripFallback(job);
    }
  }
  if (job.abandoned) return;

  finalizeMessage(job, { timedOut: jobTimedOut(job) });
  refreshJobDerived(job);
  finishJob(job);
}

function abandonJob(job: RailJob) {
  job.abandoned = true;
  job.status = 'failed';
  job.message = '已取消（已切换行程）';
  job.updatedAt = Date.now();
  removeFromStartQueue(job.jobId);
  if (runningByClient.get(job.clientKey) === job.jobId) {
    runningByClient.delete(job.clientKey);
  }
  pumpStartQueue();
}

function finishJob(job: RailJob) {
  if (job.abandoned) return;
  if (runningByClient.get(job.clientKey) === job.jobId) {
    runningByClient.delete(job.clientKey);
  }
  lastFinishedByKey.set(finishedKey(job.clientKey, job.stopsFp), job.jobId);
  if (job.segmentsOk > 0 && job.source !== 'station' && job.coords.length >= 2) {
    savePreciseHotCache({
      trainCode: job.trainCode,
      stops: job.stops,
      coords: job.coords as [number, number][],
      source: job.source,
      qualityTier: job.qualityTier,
      message: job.message,
      segmentsOk: job.segmentsOk,
      segmentsTotal: job.segmentsTotal,
    });
  }
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
    if (shouldStopJob(job)) return;
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
          job.message = `补缝中 ${from.name}→${to.name}…`;
          const seg = await buildSegmentGeometry(from, to, { preferHighspeed: preferHs });
          if (job.abandoned) return;
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
  /** B4：未能定位坐标的经停站名（明确记录，不静默丢弃） */
  unresolvedStops?: string[];
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

  const fp = stopsFingerprint(stops, params.trainCode);
  const existingId = runningByClient.get(params.clientKey);
  if (existingId) {
    const existing = jobs.get(existingId);
    if (existing && (existing.status === 'queued' || existing.status === 'running')) {
      // 同 OD 幂等复用；同一浏览器换行程则作废旧任务（不同 clientKey 互不影响）
      if (existing.stopsFp === fp) {
        return snapshot(existing);
      }
      abandonJob(existing);
    }
  }

  if (inflightJobs >= maxInflightJobs() && startQueue.length >= maxQueuedJobs()) {
    throw Object.assign(new Error('精确路线排队已满，请稍后再试'), { code: 'BUSY' });
  }

  const jobId = `rj_${randomBytes(8).toString('hex')}`;
  const total = stops.length - 1;

  let slots: SegSlot[] = Array.from({ length: total }, () => null);
  let onlyFailed = false;
  let seedCoords: [number, number][] | null = null;
  let seedSource: RailJob['source'] = 'station';
  let seedTier: RailQualityTier = 'station';
  let seedMessage = '排队中';

  if (params.retryFailedOnly) {
    const prevId = lastFinishedByKey.get(finishedKey(params.clientKey, fp));
    const prev = prevId ? jobs.get(prevId) : undefined;
    if (
      prev &&
      prev.stopsFp === fp &&
      (prev.status === 'partial' || prev.status === 'failed') &&
      prev.slots.length === total
    ) {
      slots = prev.slots.map((s) => (s ? { ...s, coords: [...(s.coords || [])] } : null));
      onlyFailed = slots.some((s) => !s?.ok);
      // 关键：沿用上一趟已拼好的折线（ok 槽位常 coords=[]，mergeSlots 会退化成示意线）
      if (prev.coords?.length >= 2 && prev.segmentsOk > 0 && prev.source !== 'station') {
        seedCoords = prev.coords.slice() as [number, number][];
        seedSource = prev.source;
        seedTier = prev.qualityTier || 'mixed';
        seedMessage = prev.message || `部分精确 ${prev.segmentsOk}/${prev.segmentsTotal}`;
      }
      if (!onlyFailed) {
        // 无失败段则整趟重跑
        slots = Array.from({ length: total }, () => null);
        seedCoords = null;
        seedSource = 'station';
        seedTier = 'station';
        seedMessage = '排队中';
      }
    }
  }

  const mergedNow = formatRailCoords(
    mergeSlots(
      stops,
      slots.map((s) => s || { coords: [], ok: false }),
    ),
  );
  const job: RailJob = {
    jobId,
    status: 'queued',
    segmentsTotal: total,
    segmentsDone: slots.filter((s) => s != null).length,
    segmentsOk: slots.filter((s) => s?.ok).length,
    coords: seedCoords && seedCoords.length >= 2 ? seedCoords : mergedNow,
    source: seedCoords ? seedSource : 'station',
    message: onlyFailed ? '重试缺口…' : seedMessage,
    qualityTier: seedCoords ? seedTier : 'station',
    trainCode: params.trainCode,
    stops,
    unresolvedStops: params.unresolvedStops || [],
    slots,
    clientKey: params.clientKey,
    stopsFp: fp,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  jobs.set(jobId, job);
  runningByClient.set(params.clientKey, jobId);
  scheduleRunJob(job, { onlyFailed });

  return snapshot(job);
}

export function getRailGeometryJob(jobId: string): RailJobSnapshot | null {
  pruneJobs();
  const job = jobs.get(jobId);
  return job ? snapshot(job) : null;
}
