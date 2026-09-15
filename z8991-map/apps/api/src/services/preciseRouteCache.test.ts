import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPreciseHotCache, savePreciseHotCache } from './preciseRouteCache.js';

describe('preciseRouteCache', () => {
  it('round-trips trainCode + stop fingerprint', () => {
    const stops = [
      { name: '上海虹桥', lng: 121.316, lat: 31.194 },
      { name: '杭州东', lng: 120.213, lat: 30.291 },
    ];
    savePreciseHotCache({
      trainCode: 'G7501',
      stops,
      coords: [
        [121.316, 31.194],
        [120.8, 30.7],
        [120.213, 30.291],
      ],
      source: 'osm',
      qualityTier: 'local',
      message: '真实轨道线（本地轨网）',
      segmentsOk: 1,
      segmentsTotal: 1,
    });
    const hit = getPreciseHotCache('G7501', stops);
    assert.ok(hit);
    assert.equal(hit!.coords.length, 3);
    assert.equal(hit!.segmentsOk, 1);
    // 不同车次不命中
    assert.equal(getPreciseHotCache('G7502', stops), null);
  });

  it('skips station-only entries', () => {
    const stops = [
      { name: 'A', lng: 100, lat: 30 },
      { name: 'B', lng: 101, lat: 31 },
    ];
    savePreciseHotCache({
      trainCode: 'K1',
      stops,
      coords: [
        [100, 30],
        [101, 31],
      ],
      source: 'station',
      segmentsOk: 0,
      segmentsTotal: 1,
    });
    assert.equal(getPreciseHotCache('K1', stops), null);
  });
});
