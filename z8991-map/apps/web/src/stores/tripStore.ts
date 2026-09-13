import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ScenicSpot, Stop, UserSegment } from '@railvista/shared';
import { buildUserSegment, resolveTripPolyline } from '@railvista/shared';
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

  function schedulePersist(opts?: { bumpOpenedAt?: boolean; setResume?: boolean }) {
    void import('../lib/persistTrip').then(({ persistActiveTrip }) => {
      void persistActiveTrip(opts);
    });
  }

  let pollTimer: ReturnType<typeof setInterval> | undefined;

  function stopPrecisePoll() {
    if (pollTimer != null) {
      clearInterval(pollTimer);
      pollTimer = undefined;
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

  function applyPreciseCoords(
    coords: [number, number][],
    opts?: { hint?: string; source?: 'precise' | 'station'; canUpgrade?: boolean },
  ) {
    if (coords.length < 2) return;
    railwayCoords.value = coords;
    if (opts?.source) railwaySource.value = opts.source;
    else if (coords.length > (segment.value?.stops.length || 0) + 2) {
      railwaySource.value = 'precise';
    }
    if (opts?.hint) polylineHint.value = opts.hint;
    if (opts?.canUpgrade != null) canUpgradePrecise.value = opts.canUpgrade;
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
    stopPrecisePoll();
    preciseJob.value = null;
    preciseLoading.value = false;
    preciseError.value = '';
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
    scenicSpots.value = filterSpotsForSegment(params.spots || [], segment.value);

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
    stopPrecisePoll();
    isDemo.value = false;
    segment.value = JSON.parse(JSON.stringify(snap.segment));
    stopsAll.value = JSON.parse(JSON.stringify(snap.stopsAll));
    scenicSpots.value = JSON.parse(JSON.stringify(snap.scenicSpots));
    railwayCoords.value = JSON.parse(JSON.stringify(snap.railwayCoords));
    railwaySource.value = snap.railwaySource;
    polylineHint.value = snap.polylineHint;
    canUpgradePrecise.value = snap.canUpgradePrecise;
    preciseLoading.value = false;
    preciseError.value = '';
    if (snap.preciseStatus === 'done' || snap.preciseStatus === 'partial') {
      preciseJob.value = {
        jobId: `cached:${snap.key}`,
        status: snap.preciseStatus,
        segmentsTotal: 1,
        segmentsDone: 1,
        segmentsOk: 1,
        coords: JSON.parse(JSON.stringify(snap.railwayCoords)),
        source: snap.railwaySource === 'precise' ? 'osm' : 'station',
        message: snap.polylineHint,
      };
    } else {
      preciseJob.value = null;
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

    preciseLoading.value = true;
    preciseError.value = '';
    stopPrecisePoll();

    const retryFailedOnly =
      preciseJob.value?.status === 'partial' || preciseJob.value?.status === 'failed';

    try {
      const job = await api.createRailGeometryJob({
        trainCode: seg.trainCode,
        stops,
        retryFailedOnly,
      });
      preciseJob.value = job;
      if (job.stops?.length) applyStopCoords(job.stops);
      if (job.coords?.length >= 2) {
        applyPreciseCoords(job.coords, {
          hint: hintForJob(job),
          source: job.source === 'station' ? 'station' : 'precise',
        });
      }

      if (job.status === 'done' || job.status === 'partial' || job.status === 'failed') {
        finishJob(job);
        return;
      }

      pollTimer = setInterval(() => {
        void pollPreciseJob(job.jobId);
      }, 1500);
    } catch (e) {
      preciseLoading.value = false;
      preciseError.value = e instanceof Error ? e.message : '创建精确路线任务失败';
    }
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

  async function pollPreciseJob(jobId: string) {
    try {
      const job = await api.getRailGeometryJob(jobId);
      preciseJob.value = job;
      if (job.stops?.length) applyStopCoords(job.stops);
      if (job.coords?.length >= 2) {
        applyPreciseCoords(job.coords, {
          hint: hintForJob(job),
          source: job.source === 'station' ? 'station' : 'precise',
        });
      }
      if (job.status === 'done' || job.status === 'partial' || job.status === 'failed') {
        finishJob(job);
      }
    } catch (e) {
      stopPrecisePoll();
      preciseLoading.value = false;
      preciseError.value = e instanceof Error ? e.message : '查询精确路线进度失败';
    }
  }

  function finishJob(job: RailGeometryJob) {
    stopPrecisePoll();
    preciseLoading.value = false;
    preciseJob.value = job;

    if (job.status === 'failed' || job.source === 'station') {
      canUpgradePrecise.value = true;
      polylineHint.value = hintForJob(job) || '未能生成精确路线，仍为示意线';
      preciseError.value = job.message || '生成失败';
      return;
    }

    applyPreciseCoords(job.coords, {
      hint: hintForJob(job),
      source: 'precise',
      canUpgrade: job.status === 'partial',
    });
    preciseError.value = '';
    if (job.status === 'done' || job.status === 'partial') {
      schedulePersist({ bumpOpenedAt: false, setResume: false });
    }
  }

  function clear() {
    stopPrecisePoll();
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
    clear,
  };
});

function filterSpotsForSegment(spots: ScenicSpot[], seg: UserSegment): ScenicSpot[] {
  if (!spots.length) return [];
  const start = new Date(seg.baseDepartureIso).getTime();
  const end = new Date(seg.baseArrivalIso).getTime();
  const timed = spots.filter((s) => {
    if (!s.at) return true;
    const t = new Date(s.at).getTime();
    return t >= start - 30 * 60000 && t <= end + 30 * 60000;
  });
  return timed.length ? timed : spots;
}
