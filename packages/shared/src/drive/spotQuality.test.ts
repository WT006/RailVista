import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeAtlasRoadSpots, isAtlasRoadDisplaySpot } from './spotQuality.js';

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

describe('dedupeAtlasRoadSpots', () => {
  it('merges same-name and peak-family near duplicates', () => {
    const out = dedupeAtlasRoadSpots([
      {
        id: 'a',
        name: '冈仁波齐',
        lng: 81.31,
        lat: 31.07,
        score: 94,
        category: 'nature.mountain',
        source: 'hand-curated',
      },
      {
        id: 'b',
        name: '冈仁波齐峰',
        lng: 81.312,
        lat: 31.071,
        score: 83,
        category: 'nature.mountain',
      },
      {
        id: 'c',
        name: '洛子峰',
        lng: 86.93,
        lat: 27.96,
        score: 79,
        category: 'nature.mountain',
        ele: 8516,
      },
      {
        id: 'd',
        name: '洛子东峰',
        lng: 86.94,
        lat: 27.96,
        score: 79,
        category: 'nature.mountain',
        ele: 8383,
      },
      {
        id: 'e',
        name: '天涯海角',
        lng: 109.35,
        lat: 18.29,
        score: 70,
        category: 'viewpoint.landmark',
      },
      {
        id: 'f',
        name: '天涯海角',
        lng: 109.352,
        lat: 18.295,
        score: 65,
        category: 'viewpoint.landmark',
      },
    ]);
    const names = out.map((s) => s.name).sort();
    assert.deepEqual(names, ['冈仁波齐', '天涯海角', '洛子峰']);
  });

  it('thins dense urban non-peak clusters', () => {
    // 西安城门：1km 内多门，只留评分最高的 2 处
    const gates = [
      { id: '1', name: '含光门', lng: 108.93, lat: 34.25, score: 65, category: 'culture.heritage' },
      { id: '2', name: '朱雀门', lng: 108.931, lat: 34.251, score: 65, category: 'culture.heritage' },
      { id: '3', name: '勿幕门', lng: 108.932, lat: 34.252, score: 65, category: 'culture.heritage' },
      { id: '4', name: '文昌门', lng: 108.933, lat: 34.249, score: 65, category: 'culture.heritage' },
      {
        id: '5',
        name: '西安鼓楼博物馆',
        lng: 108.94,
        lat: 34.26,
        score: 78,
        category: 'culture.museum',
        hasWiki: true,
      },
    ];
    const out = dedupeAtlasRoadSpots(gates);
    assert.ok(out.length <= 3, `expected ≤3 urban keeps, got ${out.length}`);
    assert.ok(
      out.some((s) => s.name === '西安鼓楼博物馆'),
      'highest-ranked museum should survive',
    );
  });
});
