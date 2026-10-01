import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackSampler } from './trackSampler.js';
import type { DriveHighlight, RoadbookChapter } from '../types.js';

const H: DriveHighlight = {
  id: 'h1', routeId: 'r', name: '无人雅丹', lng: 101, lat: 37, alongKm: 10,
  side: 'right', category: 'landform', worthSlowDown: true, canPark: true,
  intro: '', howToPlay: '',
};

const CHAPTERS: RoadbookChapter[] = [
  { id: 'c1', index: 1, title: '一', fromKm: 0, toKm: 50, summary: '', roadRefs: [], towns: [], highlightIds: [], spotIds: [], tips: [] },
  { id: 'c2', index: 2, title: '二', fromKm: 50, toKm: 100, summary: '', roadRefs: [], towns: [], highlightIds: [], spotIds: [], tips: [] },
];

describe('drive/trackSampler', () => {
  it('emits start on first feed', () => {
    const s = createTrackSampler();
    const out = s.feed({ lng: 100, lat: 37, ts: 0 });
    assert.equal(out[0].type, 'start');
  });

  it('emits pass only after distance AND time thresholds', () => {
    const s = createTrackSampler();
    s.feed({ lng: 100, lat: 37, ts: 0 });
    // 位移 600m 但时间未到 120s
    const near = s.feed({ lng: 100.006, lat: 37, ts: 10_000 });
    assert.ok(!near.some((p) => p.type === 'pass'));
    // 位移 600m 且时间 >120s
    const far = s.feed({ lng: 100.012, lat: 37, ts: 140_000 });
    assert.ok(far.some((p) => p.type === 'pass'));
  });

  it('emits checkin when within highlight radius', () => {
    const s = createTrackSampler({ highlights: [H] });
    s.feed({ lng: 100, lat: 37, ts: 0, alongKm: 0 });
    const out = s.feed({ lng: 101, lat: 37, ts: 200_000, alongKm: 10.05 });
    const ck = out.find((p) => p.type === 'checkin');
    assert.ok(ck, 'should emit checkin');
    assert.equal(ck!.highlightId, 'h1');
    // 不重复打卡
    const again = s.feed({ lng: 101, lat: 37, ts: 400_000, alongKm: 10.02 });
    assert.ok(!again.some((p) => p.type === 'checkin'));
  });

  it('emits stay after prolonged low speed', () => {
    const s = createTrackSampler();
    s.feed({ lng: 100, lat: 37, ts: 0 });
    s.feed({ lng: 100, lat: 37, ts: 60_000, speedKmh: 0 });
    const out = s.feed({ lng: 100, lat: 37, ts: 360_000, speedKmh: 0 });
    const stay = out.find((p) => p.type === 'stay');
    assert.ok(stay, 'should emit stay');
    assert.ok((stay!.dwellMin ?? 0) >= 5);
  });

  it('emits chapter crossing', () => {
    const s = createTrackSampler({ chapters: CHAPTERS });
    s.feed({ lng: 100, lat: 37, ts: 0, alongKm: 0 });
    const out = s.feed({ lng: 101, lat: 37, ts: 200_000, alongKm: 51 });
    const ch = out.find((p) => p.type === 'chapter');
    assert.ok(ch, 'should emit chapter');
    assert.equal(ch!.chapterId, 'c2');
  });

  it('finish emits end', () => {
    const s = createTrackSampler();
    s.feed({ lng: 100, lat: 37, ts: 0 });
    const out = s.finish(10_000);
    assert.equal(out[out.length - 1].type, 'end');
  });
});
