import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ScenicSpot, Stop, UserSegment } from '@railvista/shared';
import { buildUserSegment, resolveTripPolyline } from '@railvista/shared';

export const useTripStore = defineStore('trip', () => {
  const segment = ref<UserSegment | null>(null);
  const stopsAll = ref<Stop[]>([]);
  const scenicSpots = ref<ScenicSpot[]>([]);
  const railwayCoords = ref<[number, number][]>([]);
  const polylineHint = ref('示意线（站点连线），非真实轨道');
  const railwaySource = ref<'precise' | 'station'>('station');

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
  }) {
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
    if (params.railHint) {
      polylineHint.value = params.railHint;
    } else {
      polylineHint.value =
        resolved.source === 'precise'
          ? '真实轨道线（OpenStreetMap）'
          : '示意线（站点连线），非真实轨道';
    }
  }

  function clear() {
    segment.value = null;
    stopsAll.value = [];
    scenicSpots.value = [];
    railwayCoords.value = [];
    railwaySource.value = 'station';
    polylineHint.value = '示意线（站点连线），非真实轨道';
  }

  return {
    segment,
    stopsAll,
    scenicSpots,
    railwayCoords,
    railwaySource,
    polylineHint,
    setTrip,
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
