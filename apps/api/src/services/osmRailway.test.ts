import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { acceptSegmentGeometry, type LngLat } from './osmRailway.js';

describe('acceptSegmentGeometry', () => {
  it('accepts near-chord rail line', () => {
    const from: LngLat = { lng: 100.25, lat: 26.81 };
    const to: LngLat = { lng: 99.69, lat: 27.81 };
    const line: LngLat[] = [
      from,
      { lng: 100.1, lat: 27.1 },
      { lng: 99.9, lat: 27.4 },
      to,
    ];
    assert.equal(acceptSegmentGeometry(line, from, to).ok, true);
  });

  it('rejects large detour ratio', () => {
    const from: LngLat = { lng: 100, lat: 27 };
    const to: LngLat = { lng: 100.2, lat: 27 };
    // 绕到华北再回来
    const line: LngLat[] = [
      from,
      { lng: 118, lat: 39 },
      { lng: 116, lat: 39 },
      to,
    ];
    const gate = acceptSegmentGeometry(line, from, to);
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.match(gate.reason, /detour_ratio|lateral|endpoint/);
  });

  it('rejects endpoint far from polyline', () => {
    const from: LngLat = { lng: 100, lat: 27 };
    const to: LngLat = { lng: 100.5, lat: 27.5 };
    const line: LngLat[] = [
      { lng: 110, lat: 30 },
      { lng: 110.2, lat: 30.2 },
    ];
    const gate = acceptSegmentGeometry(line, from, to);
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.reason, 'endpoint_far');
  });
});
