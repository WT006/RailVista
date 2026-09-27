import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTrain, getTrainProfile, applyProfileModifiers } from './trainProfile.js';

describe('classifyTrain', () => {
  it('classifies train codes correctly', () => {
    assert.equal(classifyTrain('G1'), 'G');
    assert.equal(classifyTrain('D123'), 'D');
    assert.equal(classifyTrain('C2001'), 'C');
    assert.equal(classifyTrain('Z8991'), 'Z');
    assert.equal(classifyTrain('T15'), 'T');
    assert.equal(classifyTrain('K123'), 'K');
    assert.equal(classifyTrain('1234'), 'OTHER');
    assert.equal(classifyTrain(undefined), 'OTHER');
  });
});

describe('getTrainProfile', () => {
  it('returns correct vCap for each class', () => {
    const KMH_TO_MS = 1000 / 3600;
    assert.ok(Math.abs(getTrainProfile('G').vCap - 310 * KMH_TO_MS) < 0.1);
    assert.ok(Math.abs(getTrainProfile('D').vCap - 250 * KMH_TO_MS) < 0.1);
    assert.ok(Math.abs(getTrainProfile('K').vCap - 120 * KMH_TO_MS) < 0.1);
  });

  it('overrides Z to D when hsrOverride', () => {
    const prof = getTrainProfile('Z', { hsrOverride: true });
    assert.equal(prof.trainClass, 'D');
  });
});

describe('applyProfileModifiers', () => {
  it('applies singleLine modifier', () => {
    const prof = getTrainProfile('K');
    const originalMu = prof.mu;
    const originalRecover = prof.recoverCap;
    applyProfileModifiers(prof, { singleLine: true });
    assert.ok(prof.mu > originalMu);
    assert.ok(prof.recoverCap < originalRecover);
  });

  it('applies nighttime modifier', () => {
    const prof = getTrainProfile('K');
    const originalMu = prof.mu;
    applyProfileModifiers(prof, { nighttime: true });
    assert.ok(prof.mu > originalMu);
  });

  it('applies hubArea modifier', () => {
    const prof = getTrainProfile('G');
    const originalVCap = prof.vCap;
    applyProfileModifiers(prof, { hubArea: true });
    assert.ok(prof.vCap < originalVCap);
  });
});