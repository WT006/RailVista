import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isotonicRegression,
  fillByTimeInterpolation,
  enforceMinSegment,
  geoSigmaFor,
  buildMileageAxis,
} from './mileage.js';
import { buildRailwayMetrics } from './progress.js';
import type { Stop } from '../types.js';

describe('isotonicRegression', () => {
  it('returns input when already monotone', () => {
    const result = isotonicRegression([1, 2, 3, 4], [1, 1, 1, 1]);
    assert.deepEqual(result, [1, 2, 3, 4]);
  });

  it('fixes non-monotone sequence', () => {
    const result = isotonicRegression([3, 1, 2], [1, 1, 1]);
    assert.ok(result[0] <= result[1] && result[1] <= result[2]);
    assert.deepEqual(result, [2, 2, 2]);
  });

  it('respects weights', () => {
    const result = isotonicRegression([1, 10, 2], [1, 100, 1]);
    assert.ok(result[0] <= result[1] && result[1] <= result[2]);
    assert.ok(result[1] > 9);
  });

  it('handles empty and single element', () => {
    assert.deepEqual(isotonicRegression([], []), []);
    assert.deepEqual(isotonicRegression([42], [1]), [42]);
  });
});

describe('fillByTimeInterpolation', () => {
  it('fills missing values by time proportion', () => {
    const raw = [0, NaN, 1000];
    const stops: Stop[] = [
      { seq: 1, name: 'A', arriveTime: null, departTime: '2026-01-01T10:00:00+08:00' },
      { seq: 2, name: 'B', arriveTime: '2026-01-01T11:00:00+08:00', departTime: '2026-01-01T11:05:00+08:00' },
      { seq: 3, name: 'C', arriveTime: '2026-01-01T12:00:00+08:00', departTime: null },
    ];
    fillByTimeInterpolation(raw, stops);
    assert.equal(raw[1], 500);
  });

  it('fills missing values by index when no times', () => {
    const raw = [0, NaN, 1000];
    const stops: Stop[] = [
      { seq: 1, name: 'A', arriveTime: null, departTime: null },
      { seq: 2, name: 'B', arriveTime: null, departTime: null },
      { seq: 3, name: 'C', arriveTime: null, departTime: null },
    ];
    fillByTimeInterpolation(raw, stops);
    assert.equal(raw[1], 500);
  });

  it('handles leading missing', () => {
    const raw = [NaN, NaN, 1000];
    const stops: Stop[] = [
      { seq: 1, name: 'A', arriveTime: null, departTime: null },
      { seq: 2, name: 'B', arriveTime: null, departTime: null },
      { seq: 3, name: 'C', arriveTime: null, departTime: null },
    ];
    fillByTimeInterpolation(raw, stops);
    assert.equal(raw[0], 1000);
    assert.equal(raw[1], 1000);
  });
});

describe('enforceMinSegment', () => {
  it('enforces minimum segment length', () => {
    const result = enforceMinSegment([0, 10, 20, 1000], 200);
    assert.ok(result[1] - result[0] >= 200 - 1);
    assert.equal(result[3], 1000);
  });

  it('preserves already-valid segments', () => {
    const result = enforceMinSegment([0, 300, 600, 900], 200);
    assert.deepEqual(result, [0, 300, 600, 900]);
  });

  it('handles consecutive small gaps', () => {
    const result = enforceMinSegment([0, 10, 20, 30, 1000], 200);
    assert.ok(result[1] - result[0] >= 200 - 1);
    assert.ok(result[2] - result[1] >= 200 - 1);
    assert.ok(result[3] - result[2] >= 200 - 1);
    assert.equal(result[4], 1000);
  });
});

describe('geoSigmaFor', () => {
  it('returns correct sigma for each source', () => {
    assert.equal(geoSigmaFor('precise', 100000), 150);
    assert.equal(geoSigmaFor('corridor', 100000), 150);
    assert.equal(geoSigmaFor('local', 100000), 300);
    assert.equal(geoSigmaFor('soft', 100000), 500);
    assert.equal(geoSigmaFor('station', 100000), 12000);
  });
});

describe('buildMileageAxis', () => {
  it('builds monotone axis with pinned endpoints', () => {
    const coords: [number, number][] = [];
    for (let i = 0; i <= 100; i++) {
      coords.push([100 + i * 0.1, 30]);
    }
    const { path, lengthKm } = buildRailwayMetrics(coords);

    const stops: Stop[] = [
      { seq: 1, name: 'S0', arriveTime: null, departTime: '2026-01-01T10:00:00+08:00', lng: 100, lat: 30 },
      { seq: 2, name: 'S1', arriveTime: '2026-01-01T11:00:00+08:00', departTime: '2026-01-01T11:02:00+08:00', lng: 104, lat: 30 },
      { seq: 3, name: 'S2', arriveTime: '2026-01-01T12:00:00+08:00', departTime: '2026-01-01T12:02:00+08:00', lng: 105, lat: 30 },
      { seq: 4, name: 'S3', arriveTime: '2026-01-01T13:00:00+08:00', departTime: '2026-01-01T13:02:00+08:00', lng: 106, lat: 30 },
      { seq: 5, name: 'S4', arriveTime: '2026-01-01T14:00:00+08:00', departTime: '2026-01-01T14:02:00+08:00', lng: 107, lat: 30 },
      { seq: 6, name: 'S5', arriveTime: '2026-01-01T15:00:00+08:00', departTime: '2026-01-01T15:02:00+08:00', lng: 108, lat: 30 },
      { seq: 7, name: 'S6', arriveTime: '2026-01-01T16:00:00+08:00', departTime: '2026-01-01T16:02:00+08:00', lng: 109, lat: 30 },
      { seq: 8, name: 'S7', arriveTime: '2026-01-01T17:00:00+08:00', departTime: null, lng: 110, lat: 30 },
    ];

    const result = buildMileageAxis({ stops, path, lengthKm });

    assert.equal(result.stationKm[0], 0);
    assert.equal(result.stationKm[7], lengthKm * 1000);
    for (let i = 1; i < result.stationKm.length; i++) {
      assert.ok(result.stationKm[i] >= result.stationKm[i - 1] - 1, `monotone at ${i}`);
    }
    for (let i = 1; i < result.stationKm.length; i++) {
      assert.ok(result.stationKm[i] - result.stationKm[i - 1] >= 199, `min segment at ${i}`);
    }
  });

  it('handles missing coordinates', () => {
    const coords: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      coords.push([100 + i, 30]);
    }
    const { path, lengthKm } = buildRailwayMetrics(coords);

    const stops: Stop[] = [
      { seq: 1, name: 'A', arriveTime: null, departTime: '2026-01-01T10:00:00+08:00', lng: 100, lat: 30 },
      { seq: 2, name: 'B', arriveTime: '2026-01-01T11:00:00+08:00', departTime: '2026-01-01T11:02:00+08:00' },
      { seq: 3, name: 'C', arriveTime: '2026-01-01T12:00:00+08:00', departTime: null, lng: 110, lat: 30 },
    ];

    const result = buildMileageAxis({ stops, path, lengthKm });
    assert.equal(result.degradation, 'none');
    assert.ok(Number.isFinite(result.stationKm[1]));
    assert.ok(result.stationKm[1] > 0 && result.stationKm[1] < lengthKm * 1000);
  });

  it('degrades to all_missing when no coordinates', () => {
    const coords: [number, number][] = [[100, 30], [110, 30]];
    const { path, lengthKm } = buildRailwayMetrics(coords);

    const stops: Stop[] = [
      { seq: 1, name: 'A', arriveTime: null, departTime: '2026-01-01T10:00:00+08:00' },
      { seq: 2, name: 'B', arriveTime: '2026-01-01T11:00:00+08:00', departTime: '2026-01-01T11:02:00+08:00' },
      { seq: 3, name: 'C', arriveTime: '2026-01-01T12:00:00+08:00', departTime: null },
    ];

    const result = buildMileageAxis({ stops, path, lengthKm });
    assert.equal(result.degradation, 'all_missing');
  });

  it('degrades to zero_length when total length is zero', () => {
    const stops: Stop[] = [
      { seq: 1, name: 'A', arriveTime: null, departTime: '2026-01-01T10:00:00+08:00', lng: 100, lat: 30 },
      { seq: 2, name: 'B', arriveTime: '2026-01-01T11:00:00+08:00', departTime: null, lng: 100, lat: 30 },
    ];

    const result = buildMileageAxis({ stops, path: [], lengthKm: 0 });
    assert.equal(result.degradation, 'zero_length');
  });

  it('produces mileage progress different from station-index progress', () => {
    const coords: [number, number][] = [];
    for (let i = 0; i <= 100; i++) {
      coords.push([100 + i * 0.1, 30]);
    }
    const { path, lengthKm } = buildRailwayMetrics(coords);

    const stops: Stop[] = [
      { seq: 1, name: 'S0', arriveTime: null, departTime: '2026-01-01T10:00:00+08:00', lng: 100, lat: 30 },
      { seq: 2, name: 'S1', arriveTime: '2026-01-01T14:00:00+08:00', departTime: '2026-01-01T14:02:00+08:00', lng: 104.4, lat: 30 },
      { seq: 3, name: 'S2', arriveTime: '2026-01-01T18:00:00+08:00', departTime: null, lng: 110, lat: 30 },
    ];

    const result = buildMileageAxis({ stops, path, lengthKm });
    const L = lengthKm * 1000;
    const mileageProgress = result.stationKm[1] / L;
    const indexProgress = 1 / (stops.length - 1);

    assert.ok(Math.abs(mileageProgress - 0.44) < 0.05, `mileage progress ≈ 0.44, got ${mileageProgress}`);
    assert.ok(Math.abs(indexProgress - 0.5) < 0.01, `index progress = 0.5`);
    assert.ok(Math.abs(mileageProgress - indexProgress) > 0.03, 'mileage ≠ index');
  });
});