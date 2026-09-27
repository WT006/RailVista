import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDelayField,
  addAnchor,
  deltaAt,
  remainingSlack,
  type DelayField,
} from './delayField.js';
import { getTrainProfile, type TrainProfile } from './trainProfile.js';
import { buildScheduleCurve, type ScheduleCurve } from './scheduleCurve.js';
import type { Stop } from '../types.js';

function makeStops(): Stop[] {
  return [
    {
      seq: 1,
      name: 'A',
      type: 'depart',
      at: '2026-01-01T08:00:00+08:00',
      depart: '2026-01-01T08:00:00+08:00',
      lng: 100.0,
      lat: 30.0,
    },
    {
      seq: 2,
      name: 'B',
      type: 'stop',
      at: '2026-01-01T09:00:00+08:00',
      arrive: '2026-01-01T09:00:00+08:00',
      depart: '2026-01-01T09:05:00+08:00',
      lng: 101.0,
      lat: 30.0,
    },
    {
      seq: 3,
      name: 'C',
      type: 'arrive',
      at: '2026-01-01T10:00:00+08:00',
      arrive: '2026-01-01T10:00:00+08:00',
      lng: 102.0,
      lat: 30.0,
    },
  ];
}

function makeCurve(prof: TrainProfile): ScheduleCurve {
  const stops = makeStops();
  const stationKm = [0, 100_000, 200_000];
  return buildScheduleCurve({ stops, stationKm, prof });
}

describe('createDelayField', () => {
  it('starts with empty anchors', () => {
    const field = createDelayField();
    assert.equal(field.anchors.length, 0);
  });
});

describe('addAnchor', () => {
  it('adds anchor and sorts by mileage', () => {
    const field = createDelayField();
    addAnchor(field, { u: 100_000, delta: 600, t: 0, credibility: 'high', recoverable: true });
    addAnchor(field, { u: 0, delta: 0, t: 0, credibility: 'high', recoverable: true });
    assert.equal(field.anchors[0].u, 0);
    assert.equal(field.anchors[1].u, 100_000);
  });
});

describe('deltaAt', () => {
  const prof = getTrainProfile('G');
  const curve = makeCurve(prof);
  const now = new Date('2026-01-01T08:30:00+08:00').getTime();

  it('returns 0 when no anchors', () => {
    const field = createDelayField();
    assert.equal(deltaAt(field, 50_000, curve, prof, now), 0);
  });

  it('returns anchor delta at anchor position (spec §5.3.1.1a: 10min late → δ=600s)', () => {
    const field = createDelayField();
    addAnchor(field, { u: 50_000, delta: 600, t: now, credibility: 'high', recoverable: true });
    assert.equal(deltaAt(field, 50_000, curve, prof, now), 600);
  });

  it('returns first anchor delta when km before first anchor', () => {
    const field = createDelayField();
    addAnchor(field, { u: 50_000, delta: 600, t: now, credibility: 'high', recoverable: true });
    assert.equal(deltaAt(field, 0, curve, prof, now), 600);
  });

  it('linearly interpolates between two anchors (spec §5.3.1.6a: 5min/15min, 100km → mid=10min)', () => {
    const field = createDelayField();
    addAnchor(field, { u: 0, delta: 300, t: now, credibility: 'high', recoverable: true });
    addAnchor(field, { u: 100_000, delta: 900, t: now, credibility: 'high', recoverable: true });
    const mid = deltaAt(field, 50_000, curve, prof, now);
    assert.ok(Math.abs(mid - 600) < 1, `mid=${mid} should be 600s (10min)`);
  });

  it('extrapolates beyond last anchor with clamp and recovery (spec §5.3.1.4a)', () => {
    const field = createDelayField();
    addAnchor(field, { u: 0, delta: 1800, t: now, credibility: 'high', recoverable: true });
    const deltaEnd = deltaAt(field, 200_000, curve, prof, now);
    assert.ok(deltaEnd <= 180 * 60, `delta=${deltaEnd} should be <= 180min cap`);
    assert.ok(deltaEnd < 1800, `delta=${deltaEnd} should be reduced by recovery slack`);
  });

  it('non-recoverable anchor does not get recovery discount (spec §5.3.1.7a)', () => {
    const fieldRecoverable = createDelayField();
    addAnchor(fieldRecoverable, {
      u: 0,
      delta: 300,
      t: now,
      credibility: 'high',
      recoverable: true,
    });

    const fieldUnrecoverable = createDelayField();
    addAnchor(fieldUnrecoverable, {
      u: 0,
      delta: 300,
      t: now,
      credibility: 'high',
      recoverable: false,
    });

    const dRec = deltaAt(fieldRecoverable, 200_000, curve, prof, now);
    const dUnrec = deltaAt(fieldUnrecoverable, 200_000, curve, prof, now);
    assert.ok(
      dUnrec >= dRec,
      `unrecoverable=${dUnrec} should be >= recoverable=${dRec} (no slack discount)`,
    );
  });

  it('respects δ_floor for high-speed trains (-5min)', () => {
    const profG = getTrainProfile('G');
    const curveG = makeCurve(profG);
    const field = createDelayField();
    addAnchor(field, {
      u: 0,
      delta: -600,
      t: now,
      credibility: 'high',
      recoverable: true,
    });
    const delta = deltaAt(field, 200_000, curveG, profG, now);
    assert.ok(delta >= -300, `delta=${delta} should be >= -300s (-5min floor for G)`);
  });

  it('respects δ_floor for regular trains (0)', () => {
    const profK = getTrainProfile('K');
    const curveK = makeCurve(profK);
    const field = createDelayField();
    addAnchor(field, {
      u: 0,
      delta: -600,
      t: now,
      credibility: 'high',
      recoverable: true,
    });
    const delta = deltaAt(field, 200_000, curveK, profK, now);
    assert.ok(delta >= 0, `delta=${delta} should be >= 0 (floor for K)`);
  });

  it('models delay decreasing when front late 30min, end late 10min (spec §5.3.1.9a)', () => {
    const field = createDelayField();
    addAnchor(field, { u: 0, delta: 1800, t: now, credibility: 'high', recoverable: true });
    addAnchor(field, { u: 200_000, delta: 600, t: now, credibility: 'high', recoverable: true });
    const dStart = deltaAt(field, 10_000, curve, prof, now);
    const dMid = deltaAt(field, 100_000, curve, prof, now);
    const dEnd = deltaAt(field, 190_000, curve, prof, now);
    assert.ok(dStart > dMid, `dStart=${dStart} > dMid=${dMid}`);
    assert.ok(dMid > dEnd, `dMid=${dMid} > dEnd=${dEnd}`);
  });
});

describe('remainingSlack', () => {
  const prof = getTrainProfile('G');
  const curve = makeCurve(prof);

  it('returns 0 when s <= u', () => {
    assert.equal(remainingSlack(curve, 100_000, 50_000), 0);
    assert.equal(remainingSlack(curve, 100_000, 100_000), 0);
  });

  it('sums segSlack for segments fully within [u, s]', () => {
    const slack = remainingSlack(curve, 0, 200_000);
    assert.ok(slack >= 0, `slack=${slack} should be >= 0`);
  });

  it('returns partial slack for partial range', () => {
    const fullSlack = remainingSlack(curve, 0, 200_000);
    const halfSlack = remainingSlack(curve, 0, 100_000);
    assert.ok(halfSlack <= fullSlack, `half=${halfSlack} <= full=${fullSlack}`);
  });
});

describe('μ extrapolation', () => {
  it('delay grows with μ·ΔT_plan over distance', () => {
    const profK = getTrainProfile('K');
    const curveK = makeCurve(profK);
    const now = new Date('2026-01-01T08:00:00+08:00').getTime();

    const field = createDelayField();
    addAnchor(field, {
      u: 0,
      delta: 0,
      t: now,
      credibility: 'high',
      recoverable: false,
    });

    const deltaNear = deltaAt(field, 10_000, curveK, profK, now);
    const deltaFar = deltaAt(field, 190_000, curveK, profK, now);
    assert.ok(deltaFar > deltaNear, `far=${deltaFar} > near=${deltaNear} (μ growth)`);
  });
});