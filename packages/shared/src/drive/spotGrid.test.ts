/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHINA_LAND_BBOX,
  SPOT_GRID_CELL_DEG,
  bboxOfCoords,
  buildSpotGrid,
  inHimalayaExteriorBand,
  isAdmissibleChinaPoi,
  isWithinChinaLand,
  partitionByChinaLand,
  queryGrid,
  spotsAlongRoute,
} from './spotGrid.js';
import type { RoadsideSpot } from '../types.js';

function spot(id: string, lng: number, lat: number): RoadsideSpot {
  return { id, name: id, lng, lat, tier: 'B', category: 'nature.lake', score: 60, source: 'seed' };
}

// 沿纬线东行的路线（上海→拉萨的迷你版）
const route: [number, number][] = [
  [100.0, 30.0],
  [101.0, 30.0],
  [102.0, 30.0],
];

describe('drive/spotGrid CHINA_LAND_BBOX', () => {
  it('frozen + bounded to the envelope agreed in PRD §6.2', () => {
    // 必须是 frozen（下游可放心当作常量引用，不会被运行时改写）
    assert.ok(Object.isFrozen(CHINA_LAND_BBOX));
    assert.ok(CHINA_LAND_BBOX.minLng < CHINA_LAND_BBOX.maxLng);
    assert.ok(CHINA_LAND_BBOX.minLat < CHINA_LAND_BBOX.maxLat);
    // 东边界必须小于 135°：把 lng≈135 的伯力 / 哈巴罗夫斯克（俄罗斯远东，
    // province 错放为"黑龙江"的典型误抓点）排除掉；同时抚远市（lng≈134.3）仍在内。
    assert.ok(CHINA_LAND_BBOX.maxLng <= 135);
  });

  it('isWithinChinaLand accepts interior points', () => {
    assert.equal(isWithinChinaLand(116.4, 39.9), true); // 北京
    assert.equal(isWithinChinaLand(121.5, 31.2), true); // 上海
    assert.equal(isWithinChinaLand(134.3, 48.4), true); // 抚远附近（省内）
  });

  it('isWithinChinaLand rejects out-of-bounds points', () => {
    assert.equal(isWithinChinaLand(135.05, 48.48), false); // 哈巴罗夫斯克
    assert.equal(isWithinChinaLand(73.0, 38.0), false);   // 塔吉克斯坦
    assert.equal(isWithinChinaLand(116.0, 16.0), false);  // 越南北部
    assert.equal(isWithinChinaLand(116.0, 54.0), false);  // 漠河北以外
  });

  it('isWithinChinaLand returns false for NaN', () => {
    assert.equal(isWithinChinaLand(NaN, 30), false);
    assert.equal(isWithinChinaLand(100, NaN), false);
  });
});

describe('drive/spotGrid Himalaya / foreign POI', () => {
  it('keeps Chinese-named border towns, drops Nepal latin names in the same bbox', () => {
    assert.equal(inHimalayaExteriorBand(86.68, 27.96), true);
    assert.equal(
      isAdmissibleChinaPoi({ name: 'Everest viewpoint', lng: 86.68, lat: 27.96 }),
      false,
    );
    assert.equal(
      isAdmissibleChinaPoi({ name: '樟木口岸', lng: 85.98, lat: 27.97 }),
      true,
    );
    assert.equal(
      isAdmissibleChinaPoi({ name: '马卡鲁山', lng: 87.09, lat: 27.89 }),
      true,
    );
  });

  it('drops Kinmen / Matsu swept in by Fujian harvest bbox', () => {
    assert.equal(isAdmissibleChinaPoi({ name: '翟山坑道', lng: 118.32, lat: 24.39 }), false);
    assert.equal(isAdmissibleChinaPoi({ name: '東碇燈塔', lng: 118.23, lat: 24.16 }), false);
    assert.equal(isAdmissibleChinaPoi({ name: '厦门鼓浪屿', lng: 118.06, lat: 24.45 }), true);
  });

  it('drops osmTags country outside CN/HK/MO/TW', () => {
    assert.equal(
      isAdmissibleChinaPoi({
        id: 'np',
        name: 'Some Peak',
        lng: 100,
        lat: 30,
        tier: 'B',
        category: 'x',
        score: 60,
        source: 'osm',
        osmTags: { 'addr:country': 'NP' },
      } as RoadsideSpot & { osmTags: Record<string, string> }),
      false,
    );
  });
});

describe('drive/spotGrid partitionByChinaLand', () => {
  it('splits into kept and dropped buckets', () => {
    const spots: RoadsideSpot[] = [
      spot('in', 100.5, 30.0),
      spot('oob', 135.05, 48.48),
      { id: 'bad', name: 'bad', lng: Number.NaN, lat: 30, tier: 'B', category: 'x', score: 50, source: 'seed' },
    ];
    const { kept, dropped } = partitionByChinaLand(spots);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.id, 'in');
    assert.equal(dropped.length, 2);
    assert.deepEqual(dropped.map((s) => s.id).sort(), ['bad', 'oob']);
  });

  it('drops NaN coordinates into the dropped bucket', () => {
    const spots: RoadsideSpot[] = [
      { id: 'nan', name: 'nan', lng: Number.NaN, lat: 30, tier: 'B', category: 'x', score: 50, source: 'seed' },
      spot('ok', 100, 30),
    ];
    const { kept, dropped } = partitionByChinaLand(spots);
    assert.equal(kept.length, 1);
    assert.equal(dropped.length, 1);
  });
});

describe('drive/spotGrid buildSpotGrid', () => {
  it('buckets spots into 0.05° cells', () => {
    const grid = buildSpotGrid([spot('a', 100.02, 30.02), spot('b', 100.04, 30.04)]);
    // 两点同格（0.02 与 0.04 同属 [0.00,0.05) 格）
    assert.equal(grid.cells.size, 1);
  });

  it('separates distant spots into different cells', () => {
    const grid = buildSpotGrid([spot('a', 100.02, 30.02), spot('b', 100.07, 30.02)]);
    assert.equal(grid.cells.size, 2);
  });

  it('skips invalid coordinates', () => {
    const grid = buildSpotGrid([spot('a', NaN, 30), spot('b', 100, 30)]);
    assert.equal(grid.size, 2);
    assert.equal(grid.cells.size, 1);
  });

  it('skips out-of-China spots so they can never match any route (P2-3)', () => {
    // 三条 POI：境内哈尔滨 + 境外哈巴罗夫斯克 + 境外德黑兰；只有哈尔滨应入网。
    // khv / khv2 故意放在同一 cellKey（用极接近的 lng/lat 制造同格），
    // 用来证明即使网格能召回它们，也会因它们不在入网下标里而被整体丢弃。
    // irn 放在西边一格，验证另一侧的境外点也被同样丢弃。
    const grid = buildSpotGrid([
      spot('hrb', 126.6, 45.75),
      spot('khv', 135.05, 48.48), // lng>135 → 哈巴罗夫斯克，错放 province=黑龙江
      spot('khv2', 135.06, 48.49), // 与 khv 同格，但仍在境外
      spot('irn', 51.4, 35.7),     // lng<73.5 → 德黑兰（境外，西侧一格）
    ]);
    assert.equal(grid.size, 4);                    // size 仍是原始数组长度
    assert.equal(grid.cells.size, 1);              // 仅哈尔滨入网
    const [, idxList] = [...grid.cells.entries()][0]!;
    assert.deepEqual(idxList, [0]);
    // 路线 bbox 即使扩到 5000km 也不能再把它们召回
    const candidates = queryGrid(grid, { minLng: -180, maxLng: 180, minLat: -90, maxLat: 90 });
    assert.deepEqual(candidates, [0]);
  });

  it('cell size is 0.05 degrees', () => {
    assert.equal(SPOT_GRID_CELL_DEG, 0.05);
  });
});

describe('drive/spotGrid bboxOfCoords', () => {
  it('computes tight bbox without buffer', () => {
    const bb = bboxOfCoords(route)!;
    assert.ok(Math.abs(bb.minLng - 100) < 1e-9);
    assert.ok(Math.abs(bb.maxLng - 102) < 1e-9);
    assert.ok(Math.abs(bb.minLat - 30) < 1e-9);
  });

  it('expands bbox by buffer kilometers', () => {
    const bb = bboxOfCoords(route, 35)!;
    // 纬度方向 35km ≈ 0.315°
    assert.ok(bb.maxLat - 30 > 0.3 && bb.maxLat - 30 < 0.33);
  });

  it('returns null for empty coords', () => {
    assert.equal(bboxOfCoords([]), null);
  });
});

describe('drive/spotGrid queryGrid', () => {
  it('collects only candidates inside bbox-expanded cells', () => {
    const spots = [
      spot('in1', 100.5, 30.0),
      spot('in2', 101.5, 30.05),
      spot('out', 110.0, 45.0), // 远离路线
    ];
    const grid = buildSpotGrid(spots);
    const bb = bboxOfCoords(route, 12)!;
    const idx = queryGrid(grid, bb);
    assert.equal(idx.length, 2);
    assert.deepEqual(idx.sort(), [0, 1]);
  });
});

describe('drive/spotGrid spotsAlongRoute', () => {
  it('end-to-end: grid candidates -> filterSpotsAlongRoad ordering', () => {
    const spots = [
      spot('far', 101.8, 30.0),
      spot('near', 100.2, 30.0),
      spot('mid', 101.2, 30.0),
      spot('beyond-end', 102.5, 30.0), // 路线终点 102 之外 ~48km，超出缓冲应被过滤
      spot('nowhere', 80.0, 20.0),
    ];
    const grid = buildSpotGrid(spots);
    const out = spotsAlongRoute(spots, grid, route);
    assert.equal(out.length, 3);
    assert.equal(out[0]!.id, 'near');
    assert.equal(out[2]!.id, 'far');
  });

  it('returns [] when no candidates in covered cells', () => {
    const spots = [spot('nowhere', 80.0, 20.0)];
    const grid = buildSpotGrid(spots);
    assert.deepEqual(spotsAlongRoute(spots, grid, route), []);
  });
});
