import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPolyline,
  buildRailwayMetrics,
  filterSpotsAlongRailway,
  haversineKm,
  resolveSchedule,
  resolveTripPolyline,
  scheduleProgress,
  slicePolylineByOd,
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

  it('reverses slice when OD travels opposite to corridor storage', () => {
    // 走廊存储：西→东；行程：东→西
    const full: [number, number][] = [
      [100.0, 30.0],
      [101.0, 30.0],
      [102.0, 30.0],
      [103.0, 30.0],
    ];
    const sliced = slicePolylineByOd(full, { lng: 102.5, lat: 30.0 }, { lng: 100.5, lat: 30.0 });
    assert.ok(sliced && sliced.length >= 2);
    const start = sliced![0];
    const end = sliced![sliced!.length - 1];
    assert.ok(
      haversineKm({ lng: start[0], lat: start[1] }, { lng: 102.5, lat: 30.0 }) < 5,
      `start should be near from, got ${start}`,
    );
    assert.ok(
      haversineKm({ lng: end[0], lat: end[1] }, { lng: 100.5, lat: 30.0 }) < 5,
      `end should be near to, got ${end}`,
    );
    assert.ok(start[0] > end[0], 'polyline should run east→west');
  });
});

describe('filterSpotsAlongRailway', () => {
  const line: [number, number][] = [
    [100.0, 30.0],
    [101.0, 30.0],
    [102.0, 30.0],
  ];

  it('returns empty for short polyline', () => {
    assert.deepEqual(filterSpotsAlongRailway([{ id: 'a', name: 'A', lng: 100, lat: 30, source: 'curated' }], [[100, 30]]), []);
  });

  it('keeps window spots within 8km and sorts by progress', () => {
    const spots = filterSpotsAlongRailway(
      [
        {
          id: 'far',
          name: 'Far',
          lng: 101.0,
          lat: 30.2,
          visibility: 'window',
          source: 'curated',
        },
        {
          id: 'near-end',
          name: 'NearEnd',
          lng: 101.95,
          lat: 30.01,
          visibility: 'window',
          source: 'curated',
        },
        {
          id: 'near-start',
          name: 'NearStart',
          lng: 100.05,
          lat: 30.01,
          visibility: 'window',
          source: 'curated',
        },
      ],
      line,
    );
    assert.equal(spots.length, 2);
    assert.equal(spots[0].id, 'near-start');
    assert.equal(spots[1].id, 'near-end');
    assert.ok((spots[0].progressKm ?? 0) < (spots[1].progressKm ?? 0));
  });

  it('respects custom maxDistKm and distant default', () => {
    const far = filterSpotsAlongRailway(
      [
        {
          id: 'peak',
          name: 'Peak',
          lng: 101.0,
          lat: 30.25,
          visibility: 'distant',
          source: 'curated',
        },
      ],
      line,
    );
    assert.equal(far.length, 1);

    const tight = filterSpotsAlongRailway(
      [
        {
          id: 'peak2',
          name: 'Peak2',
          lng: 101.0,
          lat: 30.25,
          visibility: 'distant',
          maxDistKm: 5,
          source: 'curated',
        },
      ],
      line,
    );
    assert.equal(tight.length, 0);
  });
});
