import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildScheduleCurve } from './scheduleCurve.js';
import { getTrainProfile } from './trainProfile.js';
import type { Stop } from '../types.js';

describe('buildScheduleCurve', () => {
  it('builds curve with correct endpoints', () => {
    const stops: Stop[] = [
      { seq: 1, name: 'A', arriveTime: null, departTime: '2026-01-01T10:00:00+08:00', type: 'depart' },
      { seq: 2, name: 'B', arriveTime: '2026-01-01T11:00:00+08:00', departTime: '2026-01-01T11:02:00+08:00', type: 'stop' },
      { seq: 3, name: 'C', arriveTime: '2026-01-01T12:00:00+08:00', departTime: null, type: 'arrive' },
    ];
    const stationKm = [0, 50_000, 100_000];
    const prof = getTrainProfile('G');
    const curve = buildScheduleCurve({ stops, stationKm, prof });

    const t0 = curve.timeAtKm(0);
    assert.equal(new Date(t0).getHours(), 10);
    const tEnd = curve.timeAtKm(100_000);
    assert.equal(new Date(tEnd).getHours(), 12);
  });

  it('timeAtKm and kmAtTime are inverse', () => {
    const stops: Stop[] = [
      { seq: 1, name: 'A', arriveTime: null, departTime: '2026-01-01T10:00:00+08:00', type: 'depart' },
      { seq: 2, name: 'B', arriveTime: '2026-01-01T12:00:00+08:00', departTime: null, type: 'arrive' },
    ];
    const stationKm = [0, 100_000];
    const prof = getTrainProfile('G');
    const curve = buildScheduleCurve({ stops, stationKm, prof });

    for (let i = 0; i <= 20; i++) {
      const km = (100_000 * i) / 20;
      const t = curve.timeAtKm(km);
      const kmBack = curve.kmAtTime(t);
      assert.ok(Math.abs(kmBack - km) < 3, `inverse at km=${km}, got ${kmBack}`);
    }
  });

  it('handles cross-day segment', () => {
    const stops: Stop[] = [
      { seq: 1, name: 'A', arriveTime: null, departTime: '2026-01-01T23:50:00+08:00', type: 'depart' },
      { seq: 2, name: 'B', arriveTime: '2026-01-02T01:20:00+08:00', departTime: null, type: 'arrive' },
    ];
    const stationKm = [0, 100_000];
    const prof = getTrainProfile('Z');
    const curve = buildScheduleCurve({ stops, stationKm, prof });

    const t0 = curve.timeAtKm(0);
    const tEnd = curve.timeAtKm(100_000);
    const dTSec = (tEnd - t0) / 1000;
    assert.ok(Math.abs(dTSec - 5400) < 1, `cross-day dT=${dTSec}, expected 5400`);
  });

  it('computes segSlack', () => {
    const stops: Stop[] = [
      { seq: 1, name: 'A', arriveTime: null, departTime: '2026-01-01T10:00:00+08:00', type: 'depart' },
      { seq: 2, name: 'B', arriveTime: '2026-01-01T12:00:00+08:00', departTime: null, type: 'arrive' },
    ];
    const stationKm = [0, 100_000];
    const prof = getTrainProfile('G');
    const curve = buildScheduleCurve({ stops, stationKm, prof });

    assert.equal(curve.segSlack.length, 1);
    assert.ok(curve.segSlack[0] >= 0);
  });
});