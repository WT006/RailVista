/**
 * 路牌制式自动识别单测（GB 5768 路线编号标志）。
 * 覆盖：国家高速 / 省级高速 / 国道 / 省道 / 县乡村道 / 此生必驾 / 兜底。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRoadSign, classifyRoadSigns, hasBand, scenicPresets } from './roadSign.js';

test('国家高速：G+1/2/4 位 → 绿底红顶条', () => {
  for (const ref of ['G6', 'G30', 'G3011', 'g1503']) {
    const s = classifyRoadSign(ref);
    assert.equal(s.kind, 'national-expressway', ref);
    assert.equal(s.bandText, '国家高速');
    assert.equal(s.palette.bg, '#0a7a3d');
    assert.equal(s.palette.band, '#d0342c');
    assert.ok(hasBand(s.kind));
  }
});

test('普通国道：G+3 位 → 红底白字无顶条', () => {
  for (const ref of ['G109', 'G318', 'G217']) {
    const s = classifyRoadSign(ref);
    assert.equal(s.kind, 'national-highway', ref);
    assert.equal(s.bandText, '');
    assert.equal(s.palette.bg, '#d0342c');
    assert.equal(s.palette.fg, '#ffffff');
    assert.ok(!hasBand(s.kind));
  }
});

test('省级高速 S+1/2/4 位 vs 省道 S+3 位', () => {
  assert.equal(classifyRoadSign('S15').kind, 'provincial-expressway');
  assert.equal(classifyRoadSign('S15').bandText, '省级高速');
  assert.equal(classifyRoadSign('S15').palette.band, '#f5c400');
  assert.equal(classifyRoadSign('S203').kind, 'provincial-highway');
  assert.equal(classifyRoadSign('S203').palette.bg, '#f5c400');
  assert.equal(classifyRoadSign('S203').palette.fg, '#1a1a1a');
});

test('县道/乡道/村道 → 白底黑字', () => {
  assert.equal(classifyRoadSign('X008').kind, 'county');
  assert.equal(classifyRoadSign('Y002').kind, 'township');
  assert.equal(classifyRoadSign('C011').kind, 'village');
  for (const ref of ['X008', 'Y002', 'C011']) {
    assert.equal(classifyRoadSign(ref).palette.bg, '#ffffff');
    assert.equal(classifyRoadSign(ref).palette.fg, '#1a1a1a');
  }
});

test('此生必驾：前缀识别 + 线路名', () => {
  const s = classifyRoadSign('此生必驾318');
  assert.equal(s.kind, 'scenic');
  assert.equal(s.digits, '318');
  assert.equal(s.bandText, '此生必驾');
  assert.match(s.scenicName ?? '', /川藏/);
  assert.equal(classifyRoadSign('必驾109').digits, '109');
  assert.match(classifyRoadSign('此生必驾217').scenicName ?? '', /独库/);
});

test('此生必驾不带前缀时按国道处理（不误判）', () => {
  assert.equal(classifyRoadSign('318').kind, 'national-highway');
  assert.equal(classifyRoadSign('G318').kind, 'national-highway');
});

test('兜底：未知输入回落国道红盾，绝不空白', () => {
  const s = classifyRoadSign('???');
  assert.equal(s.kind, 'national-highway');
  assert.ok(s.ref);
});

test('批量分类与预设', () => {
  const list = classifyRoadSigns(['G6', '此生必驾109', 'S203']);
  assert.deepEqual(list.map((x) => x.kind), ['national-expressway', 'scenic', 'provincial-highway']);
  const presets = scenicPresets();
  assert.ok(presets.length >= 3);
  assert.ok(presets.some((p) => p.ref === '此生必驾318'));
});
