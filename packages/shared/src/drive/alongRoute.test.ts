import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALONG_DEFAULT_MIN_SCORE,
  ROAD_BUFFER_KM,
  detourKmOf,
  filterSpotsAlongRoad,
} from './alongRoute.js';
import type { RoadsideSpot } from '../types.js';

// 一条沿纬线东行的路线：lat 恒 30，lng 从 100 到 103（约 288km）
const route: [number, number][] = [
  [100.0, 30.0],
  [101.0, 30.0],
  [102.0, 30.0],
  [103.0, 30.0],
];

function spot(partial: Partial<RoadsideSpot> & { id: string; name: string }): RoadsideSpot {
  return {
    lng: 100.5,
    lat: 30.0,
    tier: 'B',
    category: 'nature.lake',
    score: 60,
    source: 'seed',
    ...partial,
  };
}

describe('drive/alongRoute ROAD_BUFFER_KM', () => {
  it('matches PRD §5.3 hard-coded levels', () => {
    assert.equal(ROAD_BUFFER_KM.roadside, 0.3);
    assert.equal(ROAD_BUFFER_KM.detour5, 3);
    assert.equal(ROAD_BUFFER_KM.detour20, 12);
    assert.equal(ROAD_BUFFER_KM.distant, 35);
  });
});

describe('drive/alongRoute detourKmOf', () => {
  it('returns 0 when spot is on the roadside', () => {
    assert.equal(detourKmOf(0.1), 0);
    assert.equal(detourKmOf(0), 0);
  });
  it('computes distKm*2-0.3 floored to 0.5', () => {
    // 2.4km → 4.8−0.3 = 4.5
    assert.equal(detourKmOf(2.4), 4.5);
    // 2.35 → 4.4 → floor 4.0
    assert.equal(detourKmOf(2.35), 4.0);
    // 10 → 19.7 → 19.5
    assert.equal(detourKmOf(10), 19.5);
  });
  it('never below 0.5 once detour is needed', () => {
    assert.equal(detourKmOf(0.4), 0.5);
  });
});

describe('drive/alongRoute filterSpotsAlongRoad', () => {
  it('returns [] for empty spots or short coords', () => {
    assert.deepEqual(filterSpotsAlongRoad([], route), []);
    assert.deepEqual(
      filterSpotsAlongRoad([spot({ id: 'a', name: 'A' })], [[100, 30]]),
      [],
    );
  });

  it('sorts matched spots by progressKm ascending', () => {
    const spots = [
      spot({ id: 'far', name: '远', lng: 102.5, lat: 30.0 }),
      spot({ id: 'near', name: '近', lng: 100.2, lat: 30.0 }),
      spot({ id: 'mid', name: '中', lng: 101.2, lat: 30.0 }),
    ];
    const out = filterSpotsAlongRoad(spots, route);
    assert.equal(out.length, 3);
    assert.ok(out[0]!.progressKm <= out[1]!.progressKm);
    assert.ok(out[1]!.progressKm <= out[2]!.progressKm);
    assert.equal(out[0]!.id, 'near');
    assert.equal(out[2]!.id, 'far');
  });

  it('respects per-visibility buffers (PRD §5.3)', () => {
    // 距路线约 0.1° 纬度 ≈ 11km
    const spots = [
      // roadside 档（0.3km）：11km 外应被过滤
      spot({ id: 'rs', name: '路侧点', lng: 100.5, lat: 30.1, visibility: 'roadside' }),
      // detour5 档（3km）：同样应被过滤
      spot({ id: 'd5', name: '小绕点', lng: 100.5, lat: 30.1, visibility: 'detour5' }),
      // detour20 档（12km）：11km 内应保留
      spot({ id: 'd20', name: '景区', lng: 100.5, lat: 30.1, visibility: 'detour20' }),
    ];
    const out = filterSpotsAlongRoad(spots, route);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.id, 'd20');
    assert.ok(out[0]!.distKm > 10 && out[0]!.distKm < 12);
  });

  it('caps global bufferKm below per-spot visibility', () => {
    const spots = [
      spot({ id: 'd20', name: '景区', lng: 100.5, lat: 30.1, visibility: 'detour20' }),
    ];
    // bufferKm=3 全局收紧：11km 的景区被过滤
    assert.equal(filterSpotsAlongRoad(spots, route, { bufferKm: 3 }).length, 0);
    // bufferKm=12 保留
    assert.equal(filterSpotsAlongRoad(spots, route, { bufferKm: 12 }).length, 1);
  });

  it('determines side relative to route forward direction', () => {
    // 北侧（lat 更大）= 东行路线的左侧
    const spots = [
      spot({ id: 'north', name: '北侧点', lng: 100.5, lat: 30.05 }),
      spot({ id: 'south', name: '南侧点', lng: 100.5, lat: 29.95 }),
      spot({ id: 'very-near', name: '贴路点', lng: 100.5, lat: 30.005 }),
    ];
    const out = filterSpotsAlongRoad(spots, route);
    const north = out.find((s) => s.id === 'north')!;
    const south = out.find((s) => s.id === 'south')!;
    const veryNear = out.find((s) => s.id === 'very-near')!;
    assert.equal(north.side, 'left');
    assert.equal(south.side, 'right');
    // ~5.5km → mid 置信；~0.55km → high 置信
    assert.equal(north.sideConfidence, 'mid');
    assert.equal(veryNear.sideConfidence, 'high');
  });

  it('filters by minScore (default 35) and categories prefix', () => {
    const spots = [
      spot({ id: 'low', name: '路人点', score: 20 }),
      spot({ id: 'cat', name: '分类不符', category: 'service.parking' }),
      spot({ id: 'ok', name: '合格点', category: 'engineering.spiral-road' }),
    ];
    const out = filterSpotsAlongRoad(spots, route, { categories: ['engineering'] });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.id, 'ok');
    // minScore 默认值本身
    assert.equal(ALONG_DEFAULT_MIN_SCORE, 35);
  });

  it('computes detourKm on matched spots and truncates with maxCount windowed', () => {
    const spots = Array.from({ length: 50 }, (_, i) =>
      spot({ id: `s${i}`, name: `点${i}`, lng: 100.05 + i * 0.058, lat: 30.08, score: 40 + (i % 10) }),
    );
    const all = filterSpotsAlongRoad(spots, route);
    assert.ok(all.length > 10);
    assert.ok(all[0]!.detourKm >= 0);
    const capped = filterSpotsAlongRoad(spots, route, { maxCount: 6 });
    assert.equal(capped.length, 6);
    // 截断后仍按 progressKm 升序
    for (let i = 1; i < capped.length; i += 1) {
      assert.ok(capped[i - 1]!.progressKm <= capped[i]!.progressKm);
    }
  });
});
