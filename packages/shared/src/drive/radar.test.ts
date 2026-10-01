import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCumKm,
  determineSide,
  driveHaversineKm,
  projectToRoute,
  resolveDirection,
  simplifyDP,
} from './geo.js';
import { computeRadar, lookaheadKmOf, speedBandOf } from './radar.js';
import type { DriveHighlight } from '../types.js';

describe('drive/geo driveHaversineKm', () => {
  it('computes known distance (Beijing -> Shanghai ~1068km)', () => {
    const d = driveHaversineKm({ lng: 116.4, lat: 39.9 }, { lng: 121.47, lat: 31.23 });
    assert.ok(d > 1000 && d < 1150, `expected ~1068km, got ${d}`);
  });

  it('returns 0 for same point', () => {
    assert.equal(driveHaversineKm({ lng: 100, lat: 37 }, { lng: 100, lat: 37 }), 0);
  });
});

describe('drive/geo projectToRoute', () => {
  // 一条沿纬线东行的直线：lat 恒 37，lng 从 100 到 101（约 96km）
  const line: [number, number][] = [
    [100.0, 37.0],
    [100.5, 37.0],
    [101.0, 37.0],
  ];

  it('projects a point exactly on the line to correct mileage', () => {
    const r = projectToRoute(line, 100.5, 37.0);
    assert.ok(Math.abs(r.offRouteM) < 1, `offRoute ${r.offRouteM}`);
    // 纬度 37° 处经度 1° ≈ 88.9km，中点 ≈ 44.5km
    assert.ok(r.alongKm > 40 && r.alongKm < 48, `alongKm ${r.alongKm} (expected ~44.5)`);
  });

  it('projects off-line point with measurable lateral distance', () => {
    // 偏离 0.1° 纬度 ≈ 11km
    const r = projectToRoute(line, 100.5, 37.1);
    assert.ok(r.offRouteM > 9000 && r.offRouteM < 13000, `offRoute ${r.offRouteM}`);
  });

  it('tangent heading points east (90°)', () => {
    const r = projectToRoute(line, 100.5, 37.0);
    assert.ok(Math.abs(r.tangentHeading - 90) < 2, `heading ${r.tangentHeading}`);
  });
});

describe('drive/geo resolveDirection', () => {
  it('same direction -> forward', () => {
    assert.equal(resolveDirection(90, 90), 'forward');
  });
  it('opposite direction -> backward', () => {
    assert.equal(resolveDirection(270, 90), 'backward');
  });
  it('no heading -> unknown', () => {
    assert.equal(resolveDirection(undefined, 90), 'unknown');
  });
  it('perpendicular (90° off) is not forward', () => {
    assert.equal(resolveDirection(0, 90), 'backward');
  });
});

describe('drive/geo simplifyDP', () => {
  it('collapses collinear points to endpoints', () => {
    const line: [number, number][] = [
      [100, 37], [100.1, 37], [100.2, 37], [100.3, 37], [100.4, 37],
    ];
    const out = simplifyDP(line, 50);
    assert.equal(out.length, 2);
  });
  it('keeps a corner', () => {
    const l: [number, number][] = [
      [100, 37], [100.5, 37], [100.5, 37.5],
    ];
    const out = simplifyDP(l, 50);
    assert.equal(out.length, 3);
  });
});

describe('drive/geo determineSide', () => {
  const line: [number, number][] = [[100, 37], [101, 37]]; // 东行
  it('north of eastbound road is left when heading east', () => {
    const proj = projectToRoute(line, 100.5, 37);
    const side = determineSide(proj, 90, { lng: 100.5, lat: 37.5 });
    assert.equal(side, 'left');
  });
  it('flips when heading west', () => {
    const proj = projectToRoute(line, 100.5, 37);
    const side = determineSide(proj, 270, { lng: 100.5, lat: 37.5 });
    assert.equal(side, 'right');
  });
});

describe('drive/geo computeCumKm', () => {
  it('monotone increasing', () => {
    const cum = computeCumKm([[100, 37], [100.5, 37], [101, 37]]);
    assert.equal(cum[0], 0);
    assert.ok(cum[1] > 0 && cum[2] > cum[1]);
  });
});

describe('drive/radar speedBandOf', () => {
  it('classifies speed bands', () => {
    assert.equal(speedBandOf(39), 'slow');
    assert.equal(speedBandOf(40), 'cruise');
    assert.equal(speedBandOf(80), 'cruise');
    assert.equal(speedBandOf(81), 'fast');
  });
});

describe('drive/radar lookaheadKmOf', () => {
  it('clamps between 3 and 15', () => {
    assert.equal(lookaheadKmOf(0), 3);
    assert.equal(lookaheadKmOf(120), 6);
    assert.equal(lookaheadKmOf(400), 15);
  });
});

describe('drive/radar computeRadar', () => {
  const geometry: [number, number][] = [];
  // 东西向直线 0~300km：每 1km 一个点（简化：每 10km 一个点）
  for (let km = 0; km <= 300; km += 10) {
    geometry.push([100 + km / 96, 37.0]);
  }
  const totalKm = 300;

  function h(id: string, alongKm: number, worthSlowDown: boolean, canPark: boolean): DriveHighlight {
    return {
      id, routeId: 'test', name: id, lng: 100 + alongKm / 96, lat: 37,
      alongKm, side: 'right', category: 'landform', worthSlowDown, canPark,
      intro: '', howToPlay: '',
    };
  }

  const highlights = [
    h('park-a', 1, false, true),   // 可以停车
    h('slow-b', 2, true, false),   // 值得减速
    h('both-c', 3, true, true),    // 两者
    h('far-d', 200, true, true),   // 超出前瞻
  ];

  it('at fast speed only returns worthSlowDown', () => {
    const r = computeRadar({ lng: 100, lat: 37, speedMs: 30, heading: 90, geometry, totalKm, highlights });
    assert.equal(r.band, 'fast');
    assert.ok(r.primary, 'should have primary');
    assert.ok(r.primary!.highlight.worthSlowDown, 'primary must be worthSlowDown');
  });

  it('at slow speed only returns canPark', () => {
    const r = computeRadar({ lng: 100, lat: 37, speedMs: 5, heading: 90, geometry, totalKm, highlights });
    assert.equal(r.band, 'slow');
    assert.ok(r.primary!.highlight.canPark, 'primary must be canPark');
  });

  it('at cruise speed returns either', () => {
    const r = computeRadar({ lng: 100, lat: 37, speedMs: 16, heading: 90, geometry, totalKm, highlights });
    assert.equal(r.band, 'cruise');
    assert.ok(r.primary);
    assert.ok(r.primary!.highlight.worthSlowDown || r.primary!.highlight.canPark);
  });

  it('excludes highlights beyond lookahead', () => {
    const r = computeRadar({ lng: 100, lat: 37, speedMs: 16, heading: 90, geometry, totalKm, highlights });
    const ids = [r.primary?.highlight.id, r.secondary?.highlight.id];
    assert.ok(!ids.includes('far-d'), `far-d should be excluded, got ${ids}`);
  });

  it('detects direction backward', () => {
    const r = computeRadar({ lng: 103, lat: 37, speedMs: 16, heading: 270, geometry, totalKm, highlights });
    assert.equal(r.direction, 'backward');
  });

  it('cardText uses correct unit', () => {
    const r = computeRadar({ lng: 100, lat: 37, speedMs: 16, heading: 90, geometry, totalKm, highlights });
    assert.match(r.primary!.cardText, /前方/);
    assert.match(r.primary!.cardText, /小确幸/);
  });
});
