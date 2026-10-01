/**
 * 自驾轨迹记录组合式函数（Web）。
 *
 * 复用零框架依赖的 createTrackSampler（只存关键点，省电省流量），
 * 持久化到 localStorage（key: railvista.drive.tracks）。
 */
import { ref } from 'vue';
import {
  createTrackSampler,
  type DriveHighlight,
  type DriveTrack,
  type FeedSample,
  type RoadbookChapter,
  type TrackKeyPoint,
} from '@railvista/shared';

const STORAGE_KEY = 'railvista.drive.tracks';

export function useTrackRecorder(routeId?: string) {
  const recording = ref(false);
  const track = ref<DriveTrack | null>(null);
  let sampler: ReturnType<typeof createTrackSampler> | null = null;

  function start(highlights: DriveHighlight[], chapters: RoadbookChapter[]) {
    sampler = createTrackSampler({ highlights, chapters });
    track.value = {
      id: `track-${Date.now()}`,
      routeId,
      title: '',
      startedAt: new Date().toISOString(),
      totalKm: 0,
      points: [],
      checkinCount: 0,
      status: 'recording',
    };
    recording.value = true;
  }

  function feed(sample: FeedSample) {
    if (!sampler || !recording.value || !track.value) return;
    const emitted = sampler.feed(sample);
    if (emitted.length === 0) return;
    track.value.points.push(...emitted);
    track.value.checkinCount = track.value.points.filter((p) => p.type === 'checkin').length;
    const lastAlong = track.value.points[track.value.points.length - 1].alongKm;
    if (lastAlong != null) track.value.totalKm = Math.round(lastAlong * 10) / 10;
  }

  function finish(): DriveTrack | null {
    if (!sampler || !track.value) return null;
    const ended: TrackKeyPoint[] = sampler.finish(Date.now());
    if (track.value.points.length > 0) {
      track.value.points.push(...ended);
      track.value.status = 'finished';
      track.value.endedAt = new Date().toISOString();
      track.value.checkinCount = track.value.points.filter((p) => p.type === 'checkin').length;
      const last = track.value.points[track.value.points.length - 1];
      if (last.alongKm != null) track.value.totalKm = Math.round(last.alongKm * 10) / 10;
      persist(track.value);
    }
    recording.value = false;
    return track.value;
  }

  function persist(t: DriveTrack) {
    try {
      const list = loadTracks();
      list.push(t);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* storage may be unavailable in private mode */
    }
  }

  function loadTracks(): DriveTrack[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as DriveTrack[];
    } catch {
      return [];
    }
  }

  return { recording, track, start, feed, finish, loadTracks };
}
