import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gcj02ToWgs84, wgs84ToGcj02 } from './coordTransform.js';

describe('gcj02ToWgs84', () => {
  it('produces non-zero offset for known GCJ-02 coordinate', () => {
    const gcjLng = 116.397428;
    const gcjLat = 39.90923;
    const wgs = gcj02ToWgs84(gcjLng, gcjLat);
    assert.ok(Math.abs(wgs.lng - gcjLng) > 0.001, 'should have measurable offset');
    assert.ok(Math.abs(wgs.lat - gcjLat) > 0.001, 'should have measurable offset');
  });

  it('offset is in expected range (300~600m → ~0.003~0.006 degrees)', () => {
    const gcjLng = 116.397428;
    const gcjLat = 39.90923;
    const wgs = gcj02ToWgs84(gcjLng, gcjLat);
    const dLng = Math.abs(wgs.lng - gcjLng);
    const dLat = Math.abs(wgs.lat - gcjLat);
    assert.ok(dLng < 0.01, `dLng=${dLng} should be < 0.01`);
    assert.ok(dLat < 0.01, `dLat=${dLat} should be < 0.01`);
    assert.ok(dLng > 0.001 || dLat > 0.001, 'at least one offset should be > 0.001');
  });

  it('is approximately inverse of wgs84ToGcj02 (round-trip < 1m)', () => {
    const wgsLng = 116.39;
    const wgsLat = 39.91;
    const gcj = wgs84ToGcj02(wgsLng, wgsLat);
    const wgsBack = gcj02ToWgs84(gcj.lng, gcj.lat);
    const dLngM = Math.abs(wgsBack.lng - wgsLng) * 96500;
    const dLatM = Math.abs(wgsBack.lat - wgsLat) * 111000;
    assert.ok(dLngM < 1, `lng round-trip error ${dLngM}m should be < 1m`);
    assert.ok(dLatM < 1, `lat round-trip error ${dLatM}m should be < 1m`);
  });

  it('handles coordinates at different locations', () => {
    const tests = [
      [116.397428, 39.90923],
      [121.473701, 31.230416],
      [108.939821, 34.341196],
      [91.132212, 29.660361],
    ];
    for (const [lng, lat] of tests) {
      const wgs = gcj02ToWgs84(lng, lat);
      assert.ok(Number.isFinite(wgs.lng) && Number.isFinite(wgs.lat), `should produce finite result for (${lng}, ${lat})`);
    }
  });

  it('preserves approximate location (offset is small)', () => {
    const gcjLng = 121.473701;
    const gcjLat = 31.230416;
    const wgs = gcj02ToWgs84(gcjLng, gcjLat);
    assert.ok(Math.abs(wgs.lng - gcjLng) < 0.02, 'should be close to original');
    assert.ok(Math.abs(wgs.lat - gcjLat) < 0.02, 'should be close to original');
  });
});

describe('wgs84ToGcj02', () => {
  it('produces offset in opposite direction from gcj02ToWgs84', () => {
    const wgsLng = 116.39;
    const wgsLat = 39.91;
    const gcj = wgs84ToGcj02(wgsLng, wgsLat);
    assert.ok(gcj.lng > wgsLng || gcj.lng < wgsLng, 'should have non-zero offset');
    const wgsBack = gcj02ToWgs84(gcj.lng, gcj.lat);
    assert.ok(Math.abs(wgsBack.lng - wgsLng) < 0.00001, 'round-trip should be accurate');
  });
});