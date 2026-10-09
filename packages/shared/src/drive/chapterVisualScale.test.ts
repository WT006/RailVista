import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildChapterVisualScale,
  kmToVisualPct,
  visualPctToKm,
} from './chapterVisualScale.js';

describe('chapterVisualScale', () => {
  it('equal lengths → near-equal visual widths', () => {
    const scale = buildChapterVisualScale(
      [
        { fromKm: 0, toKm: 100 },
        { fromKm: 100, toKm: 200 },
        { fromKm: 200, toKm: 300 },
      ],
      300,
    );
    assert.equal(scale.slices.length, 3);
    for (const s of scale.slices) {
      assert.ok(s.widthPct > 30 && s.widthPct < 40, `width=${s.widthPct}`);
    }
  });

  it('tiny chapter still visible vs bloated tail (G107-like)', () => {
    const chapters = [
      { fromKm: 0, toKm: 52 },
      { fromKm: 52, toKm: 104 },
      { fromKm: 104, toKm: 566 },
      { fromKm: 566, toKm: 10243 },
    ];
    const scale = buildChapterVisualScale(chapters, 10243);
    const first = scale.slices[0]!;
    const last = scale.slices[scale.slices.length - 1]!;
    // 纯路程下首段约 0.5%；混合后应明显更宽
    assert.ok(first.widthPct >= 8, `first width ${first.widthPct}`);
    // 末段仍最长，但不该占满 95%+
    assert.ok(last.widthPct < 70, `last width ${last.widthPct}`);
    const sum = scale.slices.reduce((a, s) => a + s.widthPct, 0);
    assert.ok(Math.abs(sum - 100) < 0.5, `sum=${sum}`);
  });

  it('km ↔ visual round-trip at chapter edges', () => {
    const scale = buildChapterVisualScale(
      [
        { fromKm: 0, toKm: 50 },
        { fromKm: 50, toKm: 200 },
        { fromKm: 200, toKm: 500 },
      ],
      500,
    );
    for (const km of [0, 50, 200, 500, 125]) {
      const pct = kmToVisualPct(scale, km);
      const back = visualPctToKm(scale, pct);
      assert.ok(Math.abs(back - km) < 1.5, `km=${km} pct=${pct} back=${back}`);
    }
  });
});
