import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ScenicSpot, Stop, UserSegment } from '@railvista/shared';
import { buildUserSegment, filterSpotsAlongRailway, resolveTripPolyline } from '@railvista/shared';
import { api, type RailGeometryJob } from '../api/client';
import type { TripSnapshot } from '../lib/tripCache';

export const useTripStore = defineStore('trip', () => {
  const segment = ref<UserSegment | null>(null);
  const stopsAll = ref<Stop[]>([]);
  const scenicSpots = ref<ScenicSpot[]>([]);
  const railwayCoords = ref<[number, number][]>([]);
  const polylineHint = ref('示意线（站点连线），非真实轨道');
  const railwaySource = ref<'precise' | 'station'>('station');
  /** 未命中精品预置时可按需升级 */
  const canUpgradePrecise = ref(false);
  const preciseJob = ref<RailGeometryJob | null>(null);
  const preciseLoading = ref(false);
  const preciseError = ref('');
  /** 演示行程不写最近列表 / 不参与自动恢复 */
  const isDemo = ref(false);
  /** 本趟已成功的最佳精确折线：重试失败时不降级覆盖 */
  let bestPrecise: {
    coords: [number, number][];
    segmentsOk: number;
    segmentsTotal: number;
  } | null = null;

  function schedulePersist(opts?: { bumpOpenedAt?: boolean; setResume?: boolean }) {
    void import('../lib/persistTrip').then(({ persistActiveTrip }) => {
      void persistActiveTrip(opts);
    });
  }

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let clientTimeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let lastProgressPersistAt = 0;
  let lastProgressPersistSeg = -1;
  /** 换行程 / 新任务时递增，用于丢弃过期 create/poll 回写 */
  let preciseEpoch = 0;
  let activeJobId: string | null = null;
  /** 前端硬超时：服务端若卡在补缝/Overpass，仍要给出友好结束态 */
  const CLIENT_PRECISE_TIMEOUT_MS = 55_000;

  function stopPrecisePoll() {
    if (pollTimer != null) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    if (clientTimeoutTimer != null) {
      clearTimeout(clientTimeoutTimer);
      clientTimeoutTimer = undefined;
    }
  }

  function invalidatePreciseWriters() {
    preciseEpoch += 1;
    activeJobId = null;
    stopPrecisePoll();
  }

  function isActivePreciseWriter(jobId: string, epoch: number) {
    return epoch === preciseEpoch && activeJobId === jobId;
  }

  /** 任务站序须与当前行程 OD 一致（服务端可能仍返回旧 job） */
  function jobMatchesCurrentTrip(job: RailGeometryJob): boolean {
    const seg = segment.value;
    if (!seg?.stops?.length) return false;
    if (job.trainCode && job.trainCode !== seg.trainCode) return false;
    if (!job.stops?.length) return true;
    const segNames = seg.stops.map((s) => s.name);
    const jobNames = job.stops.map((s) => s.name).filter(Boolean);
    if (jobNames.length < 2) return false;
    return (
      jobNames[0] === segNames[0] &&
      jobNames[jobNames.length - 1] === segNames[segNames.length - 1]
    );
  }

  /** 加载中途把已有精确折线写入本地缓存（节流），避免刷新丢失 */
  function persistPreciseProgress(job: RailGeometryJob, force = false) {
    if (isDemo.value) return;
    if (!job.coords || job.coords.length < 2) return;
    if (job.source === 'station' && (job.segmentsOk || 0) < 1) return;
    const seg = job.segmentsDone || 0;
    const now = Date.now();
    if (
      !force &&
      seg === lastProgressPersistSeg &&
      now - lastProgressPersistAt < 3500
    ) {
      return;
    }
    lastProgressPersistSeg = seg;
    lastProgressPersistAt = now;
    schedulePersist({ bumpOpenedAt: false, setResume: false });
  }

  function flushPrecisePersist() {
    const job = preciseJob.value;
    if (job && (job.status === 'running' || job.status === 'queued')) {
      persistPreciseProgress(job, true);
    } else if (railwaySource.value === 'precise' && railwayCoords.value.length >= 2) {
      schedulePersist({ bumpOpenedAt: false, setResume: false });
    }
  }

  function applyStopCoords(
    stops: Array<{ name?: string; lng?: number; lat?: number }>,
  ) {
    if (!stops.length || !segment.value) return;
    // 只按站名合并；禁止按下标写坐标（任务站列表是「有坐标子集」，下标会对齐错导致环路）
    const byName = new Map(
      stops
        .filter(
          (s) =>
            !!s.name &&
            s.lng != null &&
            s.lat != null &&
            Number.isFinite(s.lng) &&
            Number.isFinite(s.lat),
        )
        .map((s) => [s.name!, { lng: s.lng!, lat: s.lat! }] as const),
    );
    if (!byName.size) return;
    const patch = (list: Stop[]) =>
      list.map((s) => {
        const hit = byName.get(s.name);
        if (!hit) return s;
        return { ...s, lng: hit.lng, lat: hit.lat };
      });
    stopsAll.value = patch(stopsAll.value);
    if (segment.value) {
      segment.value = {
        ...segment.value,
        stops: patch(segment.value.stops),
      };
    }
    // 示意线阶段：坐标补全后重建站点折线，避免只靠几个站画出大跨三角
    if (railwaySource.value === 'station' && segment.value) {
      const resolved = resolveTripPolyline({ stops: segment.value.stops });
      if (resolved.coords.length >= 2) {
        railwayCoords.value = resolved.coords;
      }
    }
  }

  function rememberBestPrecise(job: RailGeometryJob, coords: [number, number][]) {
    if (coords.length < 2) return;
    if (!(job.segmentsOk > 0) || job.source === 'station') return;
    if (!bestPrecise || job.segmentsOk >= bestPrecise.segmentsOk) {
      bestPrecise = {
        coords: coords.slice() as [number, number][],
        segmentsOk: job.segmentsOk,
        segmentsTotal: job.segmentsTotal,
      };
    }
  }

  /** 是否应用本趟结果：禁止用更差/示意线覆盖已有精确段 */
  function shouldApplyJobCoords(job: RailGeometryJob): boolean {
    if (!job.coords || job.coords.length < 2) return false;
    if (job.source === 'station' || job.segmentsOk <= 0) {
      // 零成功：保留 best / 当前精确线
      return !(bestPrecise || (railwaySource.value === 'precise' && railwayCoords.value.length >= 2));
    }
    if (!bestPrecise) return true;
    return job.segmentsOk >= bestPrecise.segmentsOk;
  }

  function coordsForJobDisplay(job: RailGeometryJob): [number, number][] {
    if (shouldApplyJobCoords(job)) return job.coords;
    if (bestPrecise?.coords?.length && bestPrecise.coords.length >= 2) {
      return bestPrecise.coords;
    }
    if (railwaySource.value === 'precise' && railwayCoords.value.length >= 2) {
      return railwayCoords.value.slice() as [number, number][];
    }
    return job.coords?.length >= 2 ? job.coords : [];
  }

  function applyPreciseCoords(
    coords: [number, number][],
    opts?: {
      hint?: string;
      source?: 'precise' | 'station';
      canUpgrade?: boolean;
      scenicSpots?: ScenicSpot[];
    },
  ) {
    if (coords.length < 2) return;
    railwayCoords.value = coords;
    if (opts?.source) railwaySource.value = opts.source;
    else if (coords.length > (segment.value?.stops.length || 0) + 2) {
      railwaySource.value = 'precise';
    }
    if (opts?.hint) polylineHint.value = opts.hint;
    if (opts?.canUpgrade != null) canUpgradePrecise.value = opts.canUpgrade;
    if (opts?.scenicSpots != null) {
      scenicSpots.value = filterSpotsAlongRailway(opts.scenicSpots, coords);
    } else if (scenicSpots.value.length) {
      scenicSpots.value = filterSpotsAlongRailway(scenicSpots.value, coords);
    }
  }

  function setTrip(params: {
    trainCode: string;
    trainNo: string;
    date: string;
    fromName: string;
    toName: string;
    fromTelecode?: string;
    toTelecode?: string;
    stops: Stop[];
    spots?: ScenicSpot[];
    /** 完整精细铁路线（如 OSM），会按 OD 截取 */
    preciseRailway?: [number, number][] | null;
    railHint?: string;
    canUpgradePrecise?: boolean;
    /** 演示入口：不写本地行程缓存 */
    isDemo?: boolean;
  }) {
    invalidatePreciseWriters();
    preciseJob.value = null;
    preciseLoading.value = false;
    preciseError.value = '';
    bestPrecise = null;
    isDemo.value = !!params.isDemo;

    stopsAll.value = params.stops;
    segment.value = buildUserSegment({
      trainCode: params.trainCode,
      trainNo: params.trainNo,
      date: params.date,
      fromName: params.fromName,
      toName: params.toName,
      fromTelecode: params.fromTelecode,
      toTelecode: params.toTelecode,
      stopsAll: params.stops,
    });

    const resolved = resolveTripPolyline({
      stops: segment.value.stops,
      preciseRailway: params.preciseRailway,
    });
    railwayCoords.value = resolved.coords;
    railwaySource.value = resolved.source;
    canUpgradePrecise.value =
      params.canUpgradePrecise ?? resolved.source === 'station';
    if (params.railHint) {
      polylineHint.value = params.railHint;
    } else {
      polylineHint.value =
        resolved.source === 'precise'
          ? '真实轨道线（OpenStreetMap）'
          : '示意线（站点连线），非真实轨道';
    }

    // 服务端已按折线过滤；再用最终 OD 折线收紧一次（Z8991 全线预置等）
    const incoming = params.spots || [];
    scenicSpots.value = incoming.length
      ? filterSpotsAlongRailway(incoming, resolved.coords)
      : [];

    if (!isDemo.value) {
      void import('./prefsStore').then(({ usePrefsStore }) => {
        usePrefsStore().loadForCurrentTrip();
        void import('../lib/persistTrip').then(({ persistActiveTrip }) => {
          void persistActiveTrip({ bumpOpenedAt: true, setResume: false }).then((snap) => {
            if (!snap) console.warn('[trip] persist after setTrip returned null');
          });
        });
      });
    }
  }

  function hydrateFromSnapshot(snap: TripSnapshot) {
    invalidatePreciseWriters();
    isDemo.value = false;
    lastProgressPersistAt = 0;
    lastProgressPersistSeg = -1;
    bestPrecise = null;
    segment.value = JSON.parse(JSON.stringify(snap.segment));
    stopsAll.value = JSON.parse(JSON.stringify(snap.stopsAll));
    scenicSpots.value = JSON.parse(JSON.stringify(snap.scenicSpots));
    railwayCoords.value = JSON.parse(JSON.stringify(snap.railwayCoords));
    railwaySource.value = snap.railwaySource;
    polylineHint.value = snap.polylineHint;
    if (snap.railwaySource === 'station') {
      canUpgradePrecise.value = true;
    } else {
      canUpgradePrecise.value = snap.canUpgradePrecise;
    }
    preciseLoading.value = false;
    preciseError.value = '';
    const resumeId =
      snap.preciseJobId && !snap.preciseJobId.startsWith('cached:')
        ? snap.preciseJobId
        : null;

    if (snap.preciseStatus === 'done' || snap.preciseStatus === 'partial') {
      preciseJob.value = {
        jobId: resumeId || `cached:${snap.key}`,
        status: resumeId ? 'running' : snap.preciseStatus,
        segmentsTotal: 1,
        segmentsDone: resumeId ? 0 : 1,
        segmentsOk: resumeId ? 0 : 1,
        coords: JSON.parse(JSON.stringify(snap.railwayCoords)),
        source: snap.railwaySource === 'precise' ? 'osm' : 'station',
        message: resumeId ? '恢复精确路线加载…' : snap.polylineHint,
      };
      if (
        snap.railwaySource === 'precise' &&
        snap.railwayCoords.length >= 2 &&
        snap.preciseStatus === 'partial'
      ) {
        // 尽量从文案解析 11/12；解析不到则至少保住折线
        const m = String(snap.polylineHint || '').match(/(\d+)\s*\/\s*(\d+)/);
        const ok = m ? Number(m[1]) : 1;
        const total = m ? Number(m[2]) : Math.max(1, (snap.segment?.stops?.length || 2) - 1);
        if (preciseJob.value) {
          preciseJob.value.segmentsOk = ok;
          preciseJob.value.segmentsTotal = total;
          if (!resumeId) {
            preciseJob.value.segmentsDone = total;
            preciseJob.value.status = snap.preciseStatus;
          }
        }
        bestPrecise = {
          coords: JSON.parse(JSON.stringify(snap.railwayCoords)),
          segmentsOk: ok,
          segmentsTotal: total,
        };
      } else if (snap.railwaySource === 'precise' && snap.railwayCoords.length >= 2) {
        const total = Math.max(1, (snap.segment?.stops?.length || 2) - 1);
        bestPrecise = {
          coords: JSON.parse(JSON.stringify(snap.railwayCoords)),
          segmentsOk: total,
          segmentsTotal: total,
        };
        if (preciseJob.value && !resumeId) {
          preciseJob.value.segmentsOk = total;
          preciseJob.value.segmentsTotal = total;
          preciseJob.value.segmentsDone = total;
        }
      }
    } else {
      preciseJob.value = null;
    }

    // 若缓存里有未完成任务 id，尝试续轮询（服务端进程仍持有该 job 时）
    if (resumeId && snap.railwaySource === 'precise' && snap.railwayCoords.length >= 2) {
      canUpgradePrecise.value = true;
      preciseLoading.value = true;
      preciseError.value = '';
      activeJobId = resumeId;
      const epoch = preciseEpoch;
      void pollPreciseJob(resumeId, epoch).then(() => {
        if (
          !isActivePreciseWriter(resumeId, epoch) ||
          !preciseJob.value ||
          (preciseJob.value.status !== 'queued' && preciseJob.value.status !== 'running')
        ) {
          return;
        }
        pollTimer = setInterval(() => {
          void pollPreciseJob(resumeId, epoch);
        }, 1500);
        armClientPreciseTimeout(resumeId, epoch);
      });
    }
  }

  async function upgradePrecise() {
    const seg = segment.value;
    if (!seg || preciseLoading.value) return;
    if (!canUpgradePrecise.value && railwaySource.value === 'precise') return;

    // 提交全部经停（含缺坐标），由服务端 enrich；禁止只传「当前有坐标子集」导致段数随重试膨胀
    const stops = seg.stops.map((s) => ({
      name: s.name,
      lng: s.lng,
      lat: s.lat,
    }));
    const known = stops.filter((s) => s.lng != null && s.lat != null).length;
    if (known < 2 && stops.length < 2) {
      preciseError.value = '经停站坐标不足，无法加载精确路线';
      return;
    }

    invalidatePreciseWriters();
    const epoch = preciseEpoch;
    preciseLoading.value = true;
    preciseError.value = '';

    const retryFailedOnly =
      preciseJob.value?.status === 'partial' || preciseJob.value?.status === 'failed';

    try {
      const job = await api.createRailGeometryJob({
        trainCode: seg.trainCode,
        stops,
        retryFailedOnly,
      });
      if (epoch !== preciseEpoch) return;
      if (!jobMatchesCurrentTrip(job)) {
        preciseLoading.value = false;
        preciseJob.value = null;
        preciseError.value = '精确路线任务与当前行程不一致，请重试';
        return;
      }
      activeJobId = job.jobId;
      preciseJob.value = job;
      if (job.stops?.length) applyStopCoords(job.stops);
      if (shouldApplyJobCoords(job)) {
        applyPreciseCoords(job.coords, {
          hint: hintForJob(job),
          source: 'precise',
          canUpgrade: true,
          scenicSpots: job.scenicSpots,
        });
        rememberBestPrecise(job, job.coords);
        persistPreciseProgress(job, true);
      }

      if (job.status === 'done' || job.status === 'partial' || job.status === 'failed') {
        finishJob(job, epoch);
        return;
      }

      armClientPreciseTimeout(job.jobId, epoch);
      pollTimer = setInterval(() => {
        void pollPreciseJob(job.jobId, epoch);
      }, 1500);
    } catch (e) {
      if (epoch !== preciseEpoch) return;
      preciseLoading.value = false;
      preciseError.value = e instanceof Error ? e.message : '创建精确路线任务失败';
    }
  }

  function applyClientPreciseTimeout(jobId: string, epoch: number) {
    if (!isActivePreciseWriter(jobId, epoch)) return;
    const prev = preciseJob.value;
    stopPrecisePoll();
    preciseLoading.value = false;
    canUpgradePrecise.value = true;
    const ok = Math.max(prev?.segmentsOk ?? 0, bestPrecise?.segmentsOk ?? 0);
    const total = prev?.segmentsTotal || bestPrecise?.segmentsTotal || 1;
    const kept = coordsForJobDisplay({
      ...(prev || {
        jobId,
        status: 'partial',
        segmentsTotal: total,
        segmentsDone: total,
        segmentsOk: ok,
        coords: [],
        source: 'station',
        message: '',
      }),
      segmentsOk: ok,
      source: ok > 0 ? 'mixed' : 'station',
      coords: prev?.coords?.length ? prev.coords : bestPrecise?.coords || [],
    } as RailGeometryJob);
    const msg =
      ok > 0
        ? `部分精确 ${ok}/${total}（加载超时），已保留已加载路段，可重试缺口`
        : '精确路线加载超时，仍为示意线，可稍后重试';
    preciseJob.value = {
      jobId: prev?.jobId || jobId,
      status: 'partial',
      segmentsTotal: total,
      segmentsDone: total,
      segmentsOk: ok,
      coords: kept,
      source: ok > 0 ? 'mixed' : 'station',
      message: msg,
      qualityTier: ok > 0 ? 'mixed' : 'station',
      trainCode: prev?.trainCode || segment.value?.trainCode,
      stops: prev?.stops,
    };
    if (kept.length >= 2 && ok > 0) {
      applyPreciseCoords(kept, { hint: msg, source: 'precise', canUpgrade: true });
    } else {
      polylineHint.value = msg;
    }
    preciseError.value = '';
    schedulePersist({ bumpOpenedAt: false, setResume: false });
  }

  function armClientPreciseTimeout(jobId: string, epoch: number) {
    if (clientTimeoutTimer != null) clearTimeout(clientTimeoutTimer);
    clientTimeoutTimer = setTimeout(() => {
      applyClientPreciseTimeout(jobId, epoch);
    }, CLIENT_PRECISE_TIMEOUT_MS);
  }

  function hintForJob(job: RailGeometryJob): string {
    if (job.message) return job.message;
    switch (job.qualityTier) {
      case 'corridor':
        return '真实轨道线（精品走廊）';
      case 'network':
        return '真实轨道线（精品路网）';
      case 'local':
        return '真实轨道线（本地轨网）';
      case 'soft':
        return '近似轨道（跨站补缝）';
      case 'osm':
        return '真实轨道线（OSM）';
      case 'mixed':
        return '部分精确（混合来源）';
      default:
        return '示意线（站点连线）';
    }
  }

  async function pollPreciseJob(jobId: string, epoch = preciseEpoch) {
    try {
      const job = await api.getRailGeometryJob(jobId);
      if (!isActivePreciseWriter(jobId, epoch)) return;
      if (!jobMatchesCurrentTrip(job)) {
        stopPrecisePoll();
        preciseLoading.value = false;
        preciseError.value = '精确路线任务与当前行程不一致，请重试';
        return;
      }
      preciseJob.value = job;
      if (job.stops?.length) applyStopCoords(job.stops);
      if (shouldApplyJobCoords(job)) {
        const stillRunning = job.status === 'queued' || job.status === 'running';
        applyPreciseCoords(job.coords, {
          hint: hintForJob(job),
          source: 'precise',
          canUpgrade: stillRunning || job.status === 'partial' || job.status === 'failed',
          scenicSpots: job.scenicSpots,
        });
        rememberBestPrecise(job, job.coords);
        if (stillRunning) persistPreciseProgress(job);
      } else if (job.status === 'queued' || job.status === 'running') {
        // 重试进行中：只更新文案，不降级折线
        if (job.message) polylineHint.value = job.message;
      }
      if (job.status === 'done' || job.status === 'partial' || job.status === 'failed') {
        finishJob(job, epoch);
      }
    } catch (e) {
      if (!isActivePreciseWriter(jobId, epoch)) return;
      stopPrecisePoll();
      preciseLoading.value = false;
      // 任务已过期：保留已缓存折线，允许再次升级
      if (railwaySource.value === 'precise' && railwayCoords.value.length >= 2) {
        canUpgradePrecise.value = true;
        preciseError.value = '';
        preciseJob.value = {
          jobId: `cached:stale`,
          status: 'partial',
          segmentsTotal: preciseJob.value?.segmentsTotal || 1,
          segmentsDone: preciseJob.value?.segmentsDone || 1,
          segmentsOk: preciseJob.value?.segmentsOk || 1,
          coords: railwayCoords.value.slice() as [number, number][],
          source: 'osm',
          message: polylineHint.value || '已缓存部分精确路线',
        };
        schedulePersist({ bumpOpenedAt: false, setResume: false });
        return;
      }
      preciseError.value = e instanceof Error ? e.message : '查询精确路线进度失败';
    }
  }

  function finishJob(job: RailGeometryJob, epoch = preciseEpoch) {
    if (epoch !== preciseEpoch) return;
    if (activeJobId != null && activeJobId !== job.jobId) return;
    if (!jobMatchesCurrentTrip(job)) {
      stopPrecisePoll();
      preciseLoading.value = false;
      preciseError.value = '精确路线任务与当前行程不一致，请重试';
      return;
    }
    stopPrecisePoll();
    preciseLoading.value = false;

    const displayCoords = coordsForJobDisplay(job);
    const keptBest =
      !shouldApplyJobCoords(job) &&
      !!(bestPrecise || (railwaySource.value === 'precise' && railwayCoords.value.length >= 2));
    const ok = keptBest
      ? Math.max(job.segmentsOk, bestPrecise?.segmentsOk || 0)
      : job.segmentsOk;
    const total = job.segmentsTotal || bestPrecise?.segmentsTotal || 1;

    let message = hintForJob(job);
    if (keptBest && ok > 0) {
      message = `部分精确 ${ok}/${total}（缺口重试未改善），已保留已加载路段，可再试`;
    } else if (job.status === 'partial' && ok > 0 && !(job.message || '').includes(`${ok}/${total}`)) {
      message = job.message?.includes('部分精确')
        ? job.message
        : `部分精确 ${ok}/${total}，缺口为示意`;
    }

    preciseJob.value = {
      ...job,
      segmentsOk: ok,
      coords: displayCoords.length >= 2 ? displayCoords : job.coords,
      message,
      source: ok > 0 && (job.source === 'station' || keptBest) ? 'mixed' : job.source,
      qualityTier: ok > 0 && job.qualityTier === 'station' ? 'mixed' : job.qualityTier,
    };

    if (job.status === 'failed') {
      canUpgradePrecise.value = true;
      if (displayCoords.length >= 2 && ok > 0) {
        applyPreciseCoords(displayCoords, {
          hint: message,
          source: 'precise',
          canUpgrade: true,
        });
        preciseError.value = '';
      } else {
        polylineHint.value = message || '未能生成精确路线，仍为示意线';
        preciseError.value = job.message || '生成失败';
      }
      return;
    }

    if (displayCoords.length >= 2 && ok > 0) {
      applyPreciseCoords(displayCoords, {
        hint: message,
        source: 'precise',
        canUpgrade: job.status === 'partial' || keptBest,
        scenicSpots: shouldApplyJobCoords(job) ? job.scenicSpots : undefined,
      });
      if (shouldApplyJobCoords(job)) rememberBestPrecise(job, job.coords);
      else if (bestPrecise) rememberBestPrecise({ ...job, segmentsOk: ok, coords: displayCoords }, displayCoords);
    } else {
      polylineHint.value = message;
      canUpgradePrecise.value = true;
    }
    preciseError.value = '';
    if (job.status === 'done' || job.status === 'partial') {
      schedulePersist({ bumpOpenedAt: false, setResume: false });
    }
  }

  function clear() {
    invalidatePreciseWriters();
    lastProgressPersistAt = 0;
    lastProgressPersistSeg = -1;
    bestPrecise = null;
    segment.value = null;
    stopsAll.value = [];
    scenicSpots.value = [];
    railwayCoords.value = [];
    railwaySource.value = 'station';
    polylineHint.value = '示意线（站点连线），非真实轨道';
    canUpgradePrecise.value = false;
    preciseJob.value = null;
    preciseLoading.value = false;
    preciseError.value = '';
    isDemo.value = false;
  }

  return {
    segment,
    stopsAll,
    scenicSpots,
    railwayCoords,
    railwaySource,
    polylineHint,
    canUpgradePrecise,
    preciseJob,
    preciseLoading,
    preciseError,
    isDemo,
    setTrip,
    hydrateFromSnapshot,
    applyPreciseCoords,
    upgradePrecise,
    stopPrecisePoll,
    flushPrecisePersist,
    clear,
  };
});
