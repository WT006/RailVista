import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeViewHint,
  formatSpotWeatherLabel,
  pickHourlyNearest,
  spotWeatherParts,
  viewHintLabel,
  weatherEmoji,
} from './spotWeather.js';

describe('computeViewHint', () => {
  it('marks clear + good visibility as good', () => {
    assert.equal(
      computeViewHint({ cond: '晴', icon: '100', visKm: 30, cloud: 0.1, precipProb: 0.05 }),
      'good',
    );
  });

  it('marks rain as poor', () => {
    assert.equal(computeViewHint({ cond: '中雨', icon: '305', visKm: 20 }), 'poor');
  });

  it('is stricter for distant spots on haze', () => {
    assert.equal(
      computeViewHint({ cond: '雾', icon: '501', visKm: 8, visibility: 'distant' }),
      'poor',
    );
    assert.equal(
      computeViewHint({ cond: '多云', icon: '101', visKm: 8, visibility: 'window' }),
      'fair',
    );
  });

  it('uses high precip probability', () => {
    assert.equal(computeViewHint({ cond: '多云', precipProb: 0.7, visKm: 25 }), 'poor');
    assert.equal(computeViewHint({ cond: '多云', precipProb: 0.4, visKm: 25 }), 'fair');
  });
});

describe('formatSpotWeatherLabel / spotWeatherParts', () => {
  it('builds a compact decision line with visibility-aware hint', () => {
    const label = formatSpotWeatherLabel(
      {
        cond: '晴',
        icon: '100',
        tempC: 18.4,
        visKm: 28,
        viewHint: 'good',
      },
      'distant',
    );
    assert.match(label, /晴/);
    assert.match(label, /18°/);
    assert.match(label, /远眺条件好/);
    assert.doesNotMatch(label, /适合远眺/);
    assert.doesNotMatch(label, /能见度/);
  });

  it('exposes structured parts for UI chips', () => {
    const parts = spotWeatherParts(
      {
        cond: '晴',
        icon: '100',
        tempC: 15.2,
        visKm: 12,
        viewHint: 'fair',
      },
      'window',
    );
    assert.ok(parts);
    assert.equal(parts!.emoji, '☀️');
    assert.equal(parts!.cond, '晴');
    assert.equal(parts!.temp, '15°');
    assert.equal(parts!.vis, '能见度一般');
    assert.equal(parts!.hint, '窗外一般');
    assert.equal(parts!.viewHint, 'fair');
    assert.equal(parts!.hidesVisibilityBadge, true);
  });

  it('maps viewHint by visibility kind', () => {
    assert.equal(viewHintLabel('good', 'distant'), '远眺条件好');
    assert.equal(viewHintLabel('good', 'window'), '窗外视野好');
    assert.equal(viewHintLabel('poor', 'distant'), '远眺受限');
    assert.equal(viewHintLabel('fair', 'on_track'), '穿行一般');
  });
});

describe('weatherEmoji / pickHourlyNearest', () => {
  it('maps sunny codes', () => {
    assert.equal(weatherEmoji('100'), '☀️');
    assert.equal(weatherEmoji('0'), '☀️');
  });

  it('picks nearest hour within window', () => {
    const hours = [
      { atMs: Date.parse('2026-10-05T06:00:00Z'), id: 'a' },
      { atMs: Date.parse('2026-10-05T07:00:00Z'), id: 'b' },
      { atMs: Date.parse('2026-10-05T08:00:00Z'), id: 'c' },
    ];
    const hit = pickHourlyNearest(hours, '2026-10-05T07:10:00Z');
    assert.equal(hit?.id, 'b');
    assert.equal(pickHourlyNearest(hours, '2026-10-05T12:00:00Z'), null);
  });
});
