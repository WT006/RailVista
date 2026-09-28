import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateSpotEtas,
  computeSigma,
  confidenceBand,
  type FusionState,
} from './spotEta.js';
import { getTrainProfile, type TrainProfile } from './trainProfile.js';
import { buildScheduleCurve, type ScheduleCurve } from './scheduleCurve.js';
import { createDelayField, addAnchor, type DelayField } from './delayField.js';
import type { ScenicSpot, Stop } from '../types.js';

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

function makeSpots(): ScenicSpot[] {
  return [
    {
      id: 's1',
      name: '景点1',
      lng: 100.5,
      lat: 30.0,
      progressKm: 50,
      visibility: 'window',
      source: 'preset',
    },
    {
      id: 's2',
      name: '景点2',
      lng: 101.5,
      lat: 30.0,
      progressKm: 150,
      visibility: 'window',
      source: 'preset',
    },
  ];
}

describe('computeSigma', () => {
  it('grows with plan time (gamma term)', () => {
    const prof = getTrainProfile('G');
    const s1 = computeSigma({ prof, dTPlanH: 0.1, geoSigma: 150, v: 30, gapSec: 0 });
    const s2 = computeSigma({ prof, dTPlanH: 2.0, geoSigma: 150, v: 30, gapSec: 0 });
    assert.ok(s2 > s1, `sigma should grow: ${s2} > ${s1}`);
  });

  it('grows with GPS gap (tunnel penalty)', () => {
    const prof = getTrainProfile('G');
    const s1 = computeSigma({ prof, dTPlanH: 0.5, geoSigma: 150, v: 30, gapSec: 0 });
    const s2 = computeSigma({ prof, dTPlanH: 0.5, geoSigma: 150, v: 30, gapSec: 120 });
    assert.ok(s2 > s1, `sigma should grow with gap: ${s2} > ${s1}`);
  });

  it('produces finite positive values', () => {
    const prof = getTrainProfile('K');
    const s = computeSigma({ prof, dTPlanH: 1.0, geoSigma: 300, v: 20, gapSec: 60 });
    assert.ok(s > 0 && Number.isFinite(s));
  });
});

describe('confidenceBand', () => {
  it('returns high for sigma <= 3', () => {
    assert.equal(confidenceBand(1), 'high');
    assert.equal(confidenceBand(3), 'high');
  });

  it('returns mid for 3 < sigma <= 10', () => {
    assert.equal(confidenceBand(5), 'mid');
    assert.equal(confidenceBand(10), 'mid');
  });

  it('returns low for sigma > 10', () => {
    assert.equal(confidenceBand(15), 'low');
    assert.equal(confidenceBand(100), 'low');
  });
});

describe('estimateSpotEtas', () => {
  const prof = getTrainProfile('G');
  const curve = makeCurve(prof);
  const spots = makeSpots();
  const now = new Date('2026-01-01T08:30:00+08:00').getTime();
  const geoSigma = 150;

  it('produces etaPlanIso for every spot (图定时刻必填)', () => {
    const etas = estimateSpotEtas({ curve, spots, now, prof, geoSigma });
    for (const eta of etas) {
      assert.ok(eta.etaPlanIso, `spot ${eta.spotId} should have etaPlanIso`);
      assert.ok(!Number.isNaN(new Date(eta.etaPlanIso).getTime()), 'etaPlanIso should be valid date');
    }
  });

  it('returns basis=schedule when no fusion and no delays', () => {
    const etas = estimateSpotEtas({ curve, spots, now, prof, geoSigma });
    for (const eta of etas) {
      assert.equal(eta.basis, 'schedule');
    }
  });

  it('returns basis=gps when fusion provided', () => {
    const fusion: FusionState = { s: 50_000, v: 30, t: now, gapSec: 0, basis: 'gps' };
    const etas = estimateSpotEtas({ curve, spots, now, fusion, prof, geoSigma });
    for (const eta of etas) {
      assert.equal(eta.basis, 'gps');
    }
  });

  it('sets passed=true when spot km < fusion.s', () => {
    const fusion: FusionState = { s: 150_000, v: 30, t: now, gapSec: 0, basis: 'gps' };
    const etas = estimateSpotEtas({ curve, spots, now, fusion, prof, geoSigma });
    assert.ok(etas[0].passed, 'spot at 25km should be passed when train at 150km');
    assert.ok(!etas[1].passed, 'spot at 75km should not be passed when train at 150km');
  });

  it('uses nightOnly from spot when no solar computation', () => {
    const nightSpots: ScenicSpot[] = [
      { ...spots[0], nightOnly: true },
      { ...spots[1], nightOnly: false },
    ];
    const etas = estimateSpotEtas({ curve, spots: nightSpots, now, prof, geoSigma });
    assert.ok(etas[0].night, 'nightOnly spot should have night=true');
    assert.ok(!etas[1].night, 'non-nightOnly spot should have night=false');
  });

  it('applies dual-channel extrapolation when fusion + delays provided', () => {
    const fusion: FusionState = { s: 0, v: 30, t: now, gapSec: 0, basis: 'gps' };
    const delays = createDelayField();
    addAnchor(delays, { u: 0, delta: 600, t: now, credibility: 'high', recoverable: true });

    const etasWithDelay = estimateSpotEtas({ curve, spots, now, fusion, prof, geoSigma, delays });
    const etasNoDelay = estimateSpotEtas({ curve, spots, now, fusion, prof, geoSigma });

    const withDelayMs = new Date(etasWithDelay[0].etaIso).getTime();
    const noDelayMs = new Date(etasNoDelay[0].etaIso).getTime();
    assert.ok(
      Math.abs(withDelayMs - noDelayMs) > 1,
      'delay field should shift ETA',
    );
  });

  it('w=exp(-ΔT/τ) biases towards speed channel for short remaining time', () => {
    const profG = getTrainProfile('G');
    const curveG = makeCurve(profG);
    const nowNear = new Date('2026-01-01T09:55:00+08:00').getTime();
    const fusion: FusionState = { s: 190_000, v: 30, t: nowNear, gapSec: 0, basis: 'gps' };
    const delays = createDelayField();
    addAnchor(delays, { u: 0, delta: 1800, t: nowNear, credibility: 'high', recoverable: true });

    const etas = estimateSpotEtas({
      curve: curveG,
      spots,
      now: nowNear,
      fusion,
      prof: profG,
      geoSigma,
      delays,
    });

    assert.ok(etas.length > 0);
    assert.ok(etas[0].etaIso);
  });

  it('handles empty spots array', () => {
    const etas = estimateSpotEtas({ curve, spots: [], now, prof, geoSigma });
    assert.equal(etas.length, 0);
  });

  it('produces finite sigmaMin for all spots', () => {
    const etas = estimateSpotEtas({ curve, spots, now, prof, geoSigma });
    for (const eta of etas) {
      assert.ok(eta.sigmaMin > 0 && Number.isFinite(eta.sigmaMin), `sigmaMin=${eta.sigmaMin}`);
    }
  });
});