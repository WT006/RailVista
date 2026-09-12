import { randomBytes } from 'node:crypto';
import {
  buildSegmentGeometry,
  formatRailCoords,
  isHighspeedTrain,
  type LngLat,
} from './osmRailway.js';
import { matchCorridor, sliceCorridorForStops } from './corridors.js';
import { matchCorridorNetwork } from './corridorNetwork.js';

export type RailJobStatus = 'queued' | 'running' | 'done' | 'partial' | 'failed';

export type NamedStop = { name: string; lng: number; lat: number };

export type RailJobSnapshot = {
  jobId: string;
  status: RailJobStatus;
  segmentsTotal: number;
  segmentsDone: number;
  segmentsOk: number;
  coords: [number, number][];
  source: 'osm' | 'mixed' | 'station';
  message: string;
  trainCode?: string;
  /** 校正后的经停坐标（必须带站名，供前端按名合并） */
  stops?: NamedStop[];
};

type SegSlot = { coords: LngLat[]; ok: boolean; reason?: string } | null;

type RailJob = Omit<RailJobSnapshot, 'stops'> & {
  stops: NamedStop[];
  slots: SegSlot[];
  clientKey: string;
  createdAt: number;
  updatedAt: number;
};

const JOB_TTL_MS = 30 * 60 * 1000;
/** 本地轨网为主时可适度并发 */
const CONCURRENCY = 3;
const jobs = new Map<string, RailJob>();
const runningByClient = new Map<string, string>();

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
      if (runningByClient.get(job.clientKey) === id) runningByClient.delete(job.clientKey);
    }
  }
}

function mergeSlots(stops: NamedStop[], slots: SegSlot[]): LngLat[] {
  const merged: LngLat[] = [];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const slot = slots[i];
    // 跨站补缝：精确折线已挂在缺口首段，后续段跳过以免示意线叠回
    if (slot?.reason === 'bridge:skip') continue;
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

function refreshJobDerived(job: RailJob) {
  const ok = job.slots.filter((s) => s?.ok).length;
  job.segmentsOk = ok;
  job.coords = formatRailCoords(mergeSlots(job.stops, job.slots));
  if (ok === 0) job.source = 'station';
  else if (ok >= Math.ceil(job.segmentsTotal * 0.7)) job.source = 'osm';
  else job.source = 'mixed';
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
    trainCode: job.trainCode,
    stops: job.stops.map((s) => ({ name: s.name, lng: s.lng, lat: s.lat })),
  };
}

async function runJob(job: RailJob) {
  job.status = 'running';
  job.message = `加载中 0/${job.segmentsTotal}`;
  refreshJobDerived(job);

  // 0) 先尝试精品走廊 / 路网拼接（整段精确，避免站间 OSM 部分失败）
  try {
    const corridorStops = job.stops.map((s) => ({ name: s.name, lng: s.lng, lat: s.lat }));
    const single = matchCorridor(corridorStops);
    const sliced = single ? sliceCorridorForStops(single.corridor, corridorStops) : null;
    if (sliced && sliced.length >= 2) {
      for (let i = 0; i < job.segmentsTotal; i++) {
        job.slots[i] = { coords: [], ok: true, reason: `corridor:${single!.corridor.id}` };
      }
      job.segmentsDone = job.segmentsTotal;
      job.segmentsOk = job.segmentsTotal;
      job.coords = sliced;
      job.source = 'osm';
      job.status = 'done';
      job.message = `精品走廊 ${single!.corridor.name}`;
      job.updatedAt = Date.now();
      if (runningByClient.get(job.clientKey) === job.jobId) {
        runningByClient.delete(job.clientKey);
      }
      return;
    }
    const networked = matchCorridorNetwork(corridorStops);
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
      job.status = 'done';
      job.message = `精品路网 ${networked.corridorNames.join(' + ')}`;
      job.updatedAt = Date.now();
      if (runningByClient.get(job.clientKey) === job.jobId) {
        runningByClient.delete(job.clientKey);
      }
      return;
    }
  } catch (e) {
    console.warn('[rail-job] corridor shortcut failed', job.jobId, e);
  }

  const preferHs = isHighspeedTrain(job.trainCode);
  let next = 0;

  const worker = async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= job.segmentsTotal) return;

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

      job.segmentsDone += 1;
      refreshJobDerived(job);
      job.message = `加载中 ${job.segmentsDone}/${job.segmentsTotal}`;
    }
  };

  const n = Math.min(CONCURRENCY, job.segmentsTotal);
  await Promise.all(Array.from({ length: n }, () => worker()));

  // 失败段：尝试用更长跨度（跳过中间失败站）补缝，提高局部连续精确率
  await bridgeFailedSegments(job, preferHs);

  if (job.segmentsOk === 0) {
    job.status = 'failed';
    const reasons = job.slots.map((s) => s?.reason).filter(Boolean);
    const mostlyEmpty =
      reasons.filter((r) => r === 'overpass_empty' || r === 'no_ways').length >=
      Math.ceil(job.segmentsTotal / 2);
    job.message = mostlyEmpty
      ? '暂无可用轨道数据（本地未覆盖且 OSM 不可用），请稍后重试'
      : '未能匹配精确轨道，仍为示意线';
  } else if (job.segmentsOk < job.segmentsTotal) {
    job.status = 'partial';
    job.message = `部分精确 ${job.segmentsOk}/${job.segmentsTotal}，缺口为示意`;
  } else {
    job.status = 'done';
    job.message = '真实轨道线（按需生成）';
  }
  refreshJobDerived(job);
  if (runningByClient.get(job.clientKey) === job.jobId) {
    runningByClient.delete(job.clientKey);
  }
}

/** 连续失败段：尝试 from(缺口前)→to(缺口后) 一次拼线，成功则填满缺口 */
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
            job.slots[i] = {
              coords: seg.coords,
              ok: true,
              reason: `${seg.reason || 'bridge'}:span`,
            };
            for (let k = i + 1; k < j; k++) {
              job.slots[k] = { coords: [], ok: true, reason: 'bridge:skip' };
            }
            refreshJobDerived(job);
          }
        } catch (e) {
          console.warn('[rail-job] bridge failed', job.jobId, i, j, e);
        }
      }
    }
    i = Math.max(j, i + 1);
  }
}

export function createRailGeometryJob(params: {
  stops: Array<{ name?: string; lng: number; lat: number }>;
  trainCode?: string;
  clientKey: string;
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

  const jobId = `rj_${randomBytes(8).toString('hex')}`;
  const total = stops.length - 1;
  const job: RailJob = {
    jobId,
    status: 'queued',
    segmentsTotal: total,
    segmentsDone: 0,
    segmentsOk: 0,
    coords: formatRailCoords(stops.map((s) => ({ lng: s.lng, lat: s.lat }))),
    source: 'station',
    message: '排队中',
    trainCode: params.trainCode,
    stops,
    slots: Array.from({ length: total }, () => null),
    clientKey: params.clientKey,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(jobId, job);
  runningByClient.set(params.clientKey, jobId);

  void runJob(job).catch((e) => {
    console.error('[rail-job] fatal', jobId, e);
    job.status = 'failed';
    job.message = e instanceof Error ? e.message : '精确路线生成失败';
    refreshJobDerived(job);
    if (runningByClient.get(job.clientKey) === jobId) runningByClient.delete(job.clientKey);
  });

  return snapshot(job);
}

export function getRailGeometryJob(jobId: string): RailJobSnapshot | null {
  pruneJobs();
  const job = jobs.get(jobId);
  return job ? snapshot(job) : null;
}
