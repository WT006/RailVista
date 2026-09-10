import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPolyline,
  buildRailwayMetrics,
  resolveSchedule,
  resolveTripPolyline,
  scheduleProgress,
  sliceStopsByOd,
} from './index.js';
import type { Stop } from './types.js';

describe('sliceStopsByOd', () => {
  it('slices middle segment', () => {
    const stops: Stop[] = [
      { seq: 1, name: 'A', arriveTime: null, departTime: '10:00' },
      { seq: 2, name: 'B', arriveTime: '11:00', departTime: '11:05' },
      { seq: 3, name: 'C', arriveTime: '12:00', departTime: '12:05' },
      { seq: 4, name: 'D', arriveTime: '13:00', departTime: null },
    ];
    const sliced = sliceStopsByOd(stops, 'B', 'C');
    assert.equal(sliced.length, 2);
    assert.equal(sliced[0].type, 'depart');
    assert.equal(sliced[1].type, 'arrive');
  });
});

describe('resolveSchedule', () => {
  it('applies offset', () => {
    const r = resolveSchedule(
      '2026-08-11T22:00:00+08:00',
      '2026-08-12T18:28:00+08:00',
      '2026-08-11T23:00:00+08:00',
    );
    assert.equal(r.offsetMs, 60 * 60 * 1000);
  });
});

describe('polyline + progress', () => {
  it('builds metrics and interpolates schedule progress', () => {
    const stops: Stop[] = [
      {
        seq: 1,
        name: '西宁',
        type: 'depart',
        at: '2026-08-11T22:00:00+08:00',
        arriveTime: null,
        departTime: '2026-08-11T22:00:00+08:00',
        lng: 101.8,
        lat: 36.6,
      },
      {
        seq: 2,
        name: '拉萨',
        type: 'arrive',
        at: '2026-08-12T18:28:00+08:00',
        arriveTime: '2026-08-12T18:28:00+08:00',
        departTime: null,
        lng: 91.0,
        lat: 29.6,
      },
    ];
    const poly = buildPolyline(stops);
    const { lengthKm } = buildRailwayMetrics(poly);
    assert.ok(lengthKm > 100);
    const mid = scheduleProgress({
      now: new Date('2026-08-12T08:14:00+08:00'),
      departure: new Date('2026-08-11T22:00:00+08:00'),
      arrival: new Date('2026-08-12T18:28:00+08:00'),
      stops,
      offsetMs: 0,
    });
    assert.ok(mid > 0 && mid < 1);
  });

  it('slices precise railway by OD', () => {
    const full: [number, number][] = [
      [101.8, 36.6],
      [100.0, 36.5],
      [98.0, 35.0],
      [94.0, 34.0],
      [91.0, 29.6],
    ];
    const sliced = resolveTripPolyline({
      stops: [
        { lng: 100.0, lat: 36.5 },
        { lng: 94.0, lat: 34.0 },
      ],
      preciseRailway: full,
    });
    assert.equal(sliced.source, 'precise');
    assert.ok(sliced.coords.length >= 2);
  });
});
