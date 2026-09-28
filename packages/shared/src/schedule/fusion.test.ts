import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFusionState,
  predict,
  update,
  observationVariance,
  passGates,
  type FusionStateInternal,
} from './fusion.js';
import { getTrainProfile, type TrainProfile } from './trainProfile.js';
import { buildScheduleCurve, type ScheduleCurve } from './scheduleCurve.js';
import { buildRailwayMetrics } from './progress.js';
import type { Stop, GpsSample, RailwayPoint } from '../types.js';

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
  const stationKm = [0, 200_000];
  return buildScheduleCurve({ stops, stationKm, prof });
}

function makePath(): { path: RailwayPoint[]; lengthKm: number } {
  const coords: [number, number][] = [];
  for (let i = 0; i <= 20; i++) {
    coords.push([100.0 + (2.0 * i) / 20, 30.0]);
  }
  return buildRailwayMetrics(coords);
}

describe('observationVariance', () => {
  it('computes R = σ_acc² + σ_geo² with σ_acc = max(accuracy, 15)', () => {
    const R = observationVariance(10, 300);
    assert.equal(R, 15 * 15 + 300 * 300);
  });

  it('uses accuracy directly when > 15', () => {
    const R = observationVariance(50, 200);
    assert.equal(R, 50 * 50 + 200 * 200);
  });
});

describe('createFusionState', () => {
  it('initializes with default covariance and schedule basis', () => {
    const st = createFusionState({ s0: 0, v0: 30, t0: 0 });
    assert.equal(st.s, 0);
    assert.equal(st.v, 30);
    assert.equal(st.basis, 'schedule');
    assert.equal(st.gapSec, 0);
    assert.equal(st.lastS, 0);
    assert.deepEqual(st.P, [[100, 0], [0, 10]]);
  });
});

describe('predict', () => {
  it('advances position by v·dt', () => {
    const prof = getTrainProfile('G');
    const curve = makeCurve(prof);
    let st = createFusionState({ s0: 0, v0: 30, t0: 0 });
    st = predict(st, 10, curve, prof, true);
    assert.ok(Math.abs(st.s - 300) < 1, `s=${st.s}`);
  });

  it('amplifies q when no GPS (gapSec grows)', () => {
    const prof = getTrainProfile('G');
    const curve = makeCurve(prof);
    let st = createFusionState({ s0: 0, v0: 30, t0: 0 });
    st = predict(st, 5, curve, prof, false);
    assert.ok(st.gapSec > 0, `gapSec=${st.gapSec}`);
    const PNoGps = st.P[0][0];

    let st2 = createFusionState({ s0: 0, v0: 30, t0: 0 });
    st2 = predict(st2, 5, curve, prof, true);
    assert.ok(PNoGps > st2.P[0][0], 'no-GPS covariance should be larger');
  });

  it('resets gapSec when GPS available', () => {
    const prof = getTrainProfile('G');
    const curve = makeCurve(prof);
    let st = createFusionState({ s0: 0, v0: 30, t0: 0 });
    st = predict(st, 5, curve, prof, false);
    st = predict(st, 5, curve, prof, true);
    assert.equal(st.gapSec, 0);
  });
});

describe('update', () => {
  it('fuses observation with Kalman gain', () => {
    const prof = getTrainProfile('G');
    let st = createFusionState({ s0: 1000, v0: 30, t0: 0 });
    st = update(st, 1100, 500, prof);
    assert.ok(st.s > 1000 && st.s < 1100, `s=${st.s} should be between prior and obs`);
  });

  it('enforces monotonic constraint s >= lastS', () => {
    const prof = getTrainProfile('G');
    let st = createFusionState({ s0: 5000, v0: 30, t0: 0 });
    st = { ...st, lastS: 5000 };
    st = update(st, 4000, 100, prof);
    assert.ok(st.s >= 5000, `s=${st.s} should not go below lastS=5000`);
  });

  it('clamps speed to 1.3·vCap', () => {
    const prof = getTrainProfile('G');
    let st = createFusionState({ s0: 0, v0: 0, t0: 0 });
    st = { ...st, P: [[10000, 0], [0, 10000]] };
    st = update(st, 100000, 10, prof);
    assert.ok(st.v <= prof.vCap * 1.3 + 0.1, `v=${st.v} should be <= 1.3*vCap`);
  });

  it('updates basis to gps after first update', () => {
    const prof = getTrainProfile('G');
    let st = createFusionState({ s0: 0, v0: 30, t0: 0 });
    st = update(st, 100, 500, prof);
    assert.equal(st.basis, 'gps');
  });
});

describe('passGates', () => {
  const prof = getTrainProfile('G');
  const curve = makeCurve(prof);
  const { path, lengthKm } = makePath();

  it('passes for valid GPS near the line', () => {
    const state = createFusionState({ s0: 0, v0: 30, t0: 0 });
    const gps: GpsSample = { lng: 100.0, lat: 30.001, accuracy: 20, timestamp: Date.now() };
    const result = passGates({
      gps,
      state,
      path,
      lengthKm,
      prof,
      lastS: 0,
      dt: 1,
    });
    assert.ok(result.pass, `should pass: ${result.reason}`);
  });

  it('hard rejects when perpendicular distance exceeds dist gate', () => {
    const state = createFusionState({ s0: 0, v0: 30, t0: 0 });
    const gps: GpsSample = { lng: 100.0, lat: 30.5, accuracy: 20, timestamp: Date.now() };
    const result = passGates({
      gps,
      state,
      path,
      lengthKm,
      prof,
      lastS: 0,
      dt: 1,
    });
    assert.ok(!result.pass, 'should reject');
    assert.ok(!result.soft, 'should be hard reject');
    assert.match(result.reason, /垂距/);
  });

  it('soft rejects when innovation exceeds 3σ gate', () => {
    const state = createFusionState({ s0: 0, v0: 30, t0: 0 });
    const gps: GpsSample = { lng: 102.0, lat: 30.0, accuracy: 15, timestamp: Date.now() };
    const result = passGates({
      gps,
      state,
      path,
      lengthKm,
      prof,
      lastS: 0,
      dt: 1,
    });
    assert.ok(!result.pass, 'should reject');
    assert.ok(result.soft, 'should be soft reject');
    assert.match(result.reason, /新息/);
  });

  it('hard rejects when implied velocity exceeds 1.3·vCap', () => {
    const state = createFusionState({ s0: 0, v0: 30, t0: 0 });
    const gps: GpsSample = { lng: 100.001, lat: 30.0, accuracy: 15, timestamp: Date.now() };
    const result = passGates({
      gps,
      state,
      path,
      lengthKm,
      prof,
      lastS: 0,
      dt: 0.001,
    });
    assert.ok(!result.pass, 'should reject');
    assert.ok(!result.soft, 'should be hard reject');
    assert.match(result.reason, /物理/);
  });

  it('widens dist gate by 1.5x for station source', () => {
    const state = createFusionState({ s0: 0, v0: 30, t0: 0 });
    const gps: GpsSample = { lng: 100.0, lat: 30.009, accuracy: 20, timestamp: Date.now() };
    const resultNormal = passGates({
      gps,
      state,
      path,
      lengthKm,
      prof,
      source: 'precise',
      lastS: 0,
      dt: 1,
    });
    const resultStation = passGates({
      gps,
      state,
      path,
      lengthKm,
      prof,
      source: 'station',
      lastS: 0,
      dt: 1,
    });
    assert.ok(!resultNormal.pass, 'normal source should reject (dist > 800m)');
    assert.ok(resultStation.pass, `station source should pass (dist < 1200m): ${resultStation.reason}`);
  });
});

describe('no-signal degradation', () => {
  it('covariance grows over multiple no-GPS predict steps', () => {
    const prof = getTrainProfile('G');
    const curve = makeCurve(prof);
    let st = createFusionState({ s0: 0, v0: 30, t0: 0 });
    const P0 = st.P[0][0];
    for (let i = 0; i < 10; i++) {
      st = predict(st, 5, curve, prof, false);
    }
    assert.ok(st.P[0][0] > P0, `P=${st.P[0][0]} should grow from ${P0}`);
    assert.ok(st.gapSec >= 45, `gapSec=${st.gapSec} should be >= 45s`);
  });
});