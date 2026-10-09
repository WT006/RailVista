import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAtlasRoadDisplaySpot } from './spotQuality.js';

describe('isAtlasRoadDisplaySpot', () => {
  it('keeps real attractions', () => {
    assert.equal(
      isAtlasRoadDisplaySpot({ name: '天际100', score: 79, category: 'viewpoint.observation-deck' }),
      true,
    );
    assert.equal(
      isAtlasRoadDisplaySpot({ name: '华山南峰', score: 79, category: 'nature.mountain', ele: 2150 }),
      true,
    );
    assert.equal(
      isAtlasRoadDisplaySpot({ name: '冈仁波齐', score: 94, category: 'nature.mountain', source: 'hand-curated' }),
      true,
    );
    assert.equal(
      isAtlasRoadDisplaySpot({ name: '幻彩詠香江', score: 73, category: 'viewpoint.landmark' }),
      true,
    );
    // 放宽后：海拔≥1000，或「≥700 且高分」的中文峰可落图
    assert.equal(
      isAtlasRoadDisplaySpot({ name: '念青唐古拉', score: 72, category: 'nature.mountain', ele: 7162 }),
      true,
    );
    assert.equal(
      isAtlasRoadDisplaySpot({ name: '云雾山', score: 80, category: 'nature.mountain', ele: 900 }),
      true,
    );
  });

  it('drops OSM survey noise', () => {
    assert.equal(
      isAtlasRoadDisplaySpot({ name: '筆架山', score: 82, category: 'nature.mountain', ele: 457 }),
      false,
    );
    assert.equal(
      isAtlasRoadDisplaySpot({ name: '晶彩奇航', score: 77, category: 'viewpoint.landmark' }),
      false,
    );
    assert.equal(
      isAtlasRoadDisplaySpot({
        name: '翟山坑道',
        score: 80,
        category: 'viewpoint.landmark',
        lng: 118.32,
        lat: 24.39,
      }),
      false,
    );
    assert.equal(
      isAtlasRoadDisplaySpot({ name: '迷魂台', score: 65, category: 'viewpoint.observation-deck' }),
      false,
    );
    assert.equal(
      isAtlasRoadDisplaySpot({ name: '迷魂台', score: 67, category: 'viewpoint.observation-deck' }),
      false,
    );
    assert.equal(
      isAtlasRoadDisplaySpot({ name: '段功墓', score: 73, category: 'viewpoint.landmark' }),
      false,
    );
    assert.equal(
      isAtlasRoadDisplaySpot({ name: '织机洞遗址', score: 68, category: 'culture.ruin' }),
      false,
    );
    assert.equal(
      isAtlasRoadDisplaySpot({ name: '黑角頭燈塔', score: 73, category: 'viewpoint.landmark' }),
      false,
    );
  });
});
