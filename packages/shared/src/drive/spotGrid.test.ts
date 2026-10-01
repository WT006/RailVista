import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPOT_GRID_CELL_DEG,
  bboxOfCoords,
  buildSpotGrid,
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
