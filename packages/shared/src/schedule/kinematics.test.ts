import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { solveSegment, tauAt, tauInverse, speedAt, minSegmentTime } from './kinematics.js';
import { getTrainProfile } from './trainProfile.js';

describe('solveSegment', () => {
  it('solves for cruise speed with valid inputs', () => {
    const prof = getTrainProfile('G');
    const dS = 100_000;
    const dT = 24 * 60;
    const seg = solveSegment(dS, dT, prof);
    assert.ok(seg.v > 0);
    assert.ok(seg.v <= prof.vCap + 1);
  });

  it('degrades when discriminant negative', () => {
    const prof = getTrainProfile('OTHER');
    const dS = 100_000;
    const dT = 60;
    const seg = solveSegment(dS, dT, prof);
    assert.ok(seg.degraded);
  });

  it('clamps to vCap and records slack', () => {
    const prof = getTrainProfile('K');
    const dS = 100_000;
    const dT = 3 * 3600;
    const seg = solveSegment(dS, dT, prof);
    assert.ok(seg.v <= prof.vCap + 1);
  });
});

describe('tauAt', () => {
  it('satisfies boundary conditions', () => {
    const prof = getTrainProfile('G');
    const dS = 50_000;
    const dT = 12 * 60;
    const seg = solveSegment(dS, dT, prof);
    assert.ok(Math.abs(tauAt(seg, dS, dT, prof, 0)) < 0.1);
    assert.ok(Math.abs(tauAt(seg, dS, dT, prof, dS) - dT) < 0.1);
  });

  it('is monotone', () => {
    const prof = getTrainProfile('D');
    const dS = 80_000;
    const dT = 20 * 60;
    const seg = solveSegment(dS, dT, prof);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const x = (dS * i) / 100;
      const t = tauAt(seg, dS, dT, prof, x);
      assert.ok(t >= prev - 0.1, `monotone at ${i}`);
      prev = t;
    }
  });
});

describe('tauInverse', () => {
  it('is inverse of tauAt', () => {
    const prof = getTrainProfile('G');
    const dS = 100_000;
    const dT = 24 * 60;
    const seg = solveSegment(dS, dT, prof);
    for (let i = 0; i <= 20; i++) {
      const x = (dS * i) / 20;
      const t = tauAt(seg, dS, dT, prof, x);
      const xBack = tauInverse(seg, dS, dT, prof, t);
      assert.ok(Math.abs(xBack - x) < 2, `inverse at x=${x}, got ${xBack}`);
    }
  });
});

describe('speedAt', () => {
  it('approaches 0 at endpoints', () => {
    const prof = getTrainProfile('G');
    const dS = 100_000;
    const dT = 24 * 60;
    const seg = solveSegment(dS, dT, prof);
    assert.ok(speedAt(seg, dS, dT, prof, 0) < 1);
    assert.ok(speedAt(seg, dS, dT, prof, dS) < 1);
  });
});

describe('minSegmentTime', () => {
  it('returns positive for positive distance', () => {
    const prof = getTrainProfile('G');
    assert.ok(minSegmentTime(100_000, prof) > 0);
  });
});