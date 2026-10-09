import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sliceStopsByOdNames, stationNamesMatch } from './stopOdSlice.js';

describe('stopOdSlice', () => {
  it('stationNamesMatch strips 站 and allows prefix', () => {
    assert.equal(stationNamesMatch('西宁', '西宁'), true);
    assert.equal(stationNamesMatch('西宁站', '西宁'), true);
    assert.equal(stationNamesMatch('西宁', '西宁站'), true);
    assert.equal(stationNamesMatch('重庆西', '西宁'), false);
  });

  it('slices Z223-like full train down to 西宁→拉萨', () => {
    const full = [
      { name: '重庆西' },
      { name: '广元' },
      { name: '兰州' },
      { name: '西宁' },
      { name: '德令哈' },
      { name: '格尔木' },
      { name: '拉萨' },
    ];
    const sliced = sliceStopsByOdNames(full, '西宁', '拉萨');
    assert.ok(sliced);
    assert.deepEqual(
      sliced!.map((s) => s.name),
      ['西宁', '德令哈', '格尔木', '拉萨'],
    );
  });

  it('returns null when OD not found', () => {
    assert.equal(sliceStopsByOdNames([{ name: '西宁' }, { name: '拉萨' }], '北京', '拉萨'), null);
  });
});
