import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  diskKey,
  fingerprint,
  getPreciseHotCache,
  savePreciseHotCache,
  markPreciseHotPinned,
} from './preciseRouteCache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../../../../data/cache/precise');

function clearEntry(trainCode: string, stops: Array<{ name: string; lng: number; lat: number }>) {
  const path = join(CACHE_DIR, `${diskKey(fingerprint(trainCode, stops))}.json`);
  if (existsSync(path)) unlinkSync(path);
}

describe('preciseRouteCache', () => {
  it('round-trips trainCode + stop fingerprint', () => {
    const stops = [
      { name: '上海虹桥', lng: 121.316, lat: 31.194 },
      { name: '杭州东', lng: 120.213, lat: 30.291 },
    ];
    clearEntry('G7501', stops);
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
    assert.equal(getPreciseHotCache('G7502', stops), null);
  });

  it('skips station-only entries', () => {
    const stops = [
      { name: 'A', lng: 100, lat: 30 },
      { name: 'B', lng: 101, lat: 31 },
    ];
    clearEntry('K1', stops);
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

  it('skips low ok-ratio unless pinned', () => {
    const suffix = `${Date.now()}`;
    const stops = [
      { name: `太原-${suffix}`, lng: 112.586, lat: 37.859 },
      { name: `阳泉-${suffix}`, lng: 113.58, lat: 37.86 },
      { name: `石家庄北-${suffix}`, lng: 114.459, lat: 38.066 },
    ];
    const code = `K${suffix.slice(-6)}`;
    clearEntry(code, stops);

    savePreciseHotCache({
      trainCode: code,
      stops,
      coords: [
        [112.586, 37.859],
        [114.459, 38.066],
      ],
      source: 'mixed',
      segmentsOk: 2,
      segmentsTotal: 3,
    });
    assert.equal(getPreciseHotCache(code, stops), null);

    savePreciseHotCache({
      trainCode: code,
      stops,
      coords: [
        [112.586, 37.859],
        [113.58, 37.86],
        [114.459, 38.066],
      ],
      source: 'mixed',
      segmentsOk: 2,
      segmentsTotal: 3,
      pinned: true,
    });
    const pinned = getPreciseHotCache(code, stops);
    assert.ok(pinned);
    assert.equal(pinned!.pinned, true);
    assert.equal(markPreciseHotPinned(code, stops), true);
    clearEntry(code, stops);
  });
});
