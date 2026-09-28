import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMileageAxis } from './mileage.js';
import { buildRailwayMetrics, resolveProgress } from './progress.js';
import { buildScheduleCurve } from './scheduleCurve.js';
import { estimateSpotEtas } from './spotEta.js';
import { profileForTrain, classifyTrain, getTrainProfile } from './trainProfile.js';
import { gcj02ToWgs84 } from '../geo/coordTransform.js';
import type { Stop, ScenicSpot } from '../types.js';

function makePath(stops: Stop[]): { path: ReturnType<typeof buildRailwayMetrics>['path']; lengthKm: number } {
  const coords = stops.filter(s => s.lng != null && s.lat != null).map(s => [s.lng!, s.lat!] as [number, number]);
  return buildRailwayMetrics(coords);
}

function makeStop(seq: number, name: string, type: Stop['type'], lng: number, lat: number, departIso?: string, arriveIso?: string): Stop {
  return { seq, name, type, lng, lat, depart: departIso, arrive: arriveIso, at: arriveIso || departIso };
}

describe('基准车次回归 — Z8991（普速/站距不均）', () => {
  it('P0-1: 格尔木里程进度 ≈ 0.44 而非站序 0.14', () => {
    const coords: [number, number][] = [];
    for (let i = 0; i <= 100; i++) {
      coords.push([100 + i * 0.1, 30 + i * 0.06]);
    }
    const { path, lengthKm } = buildRailwayMetrics(coords);

    const stops: Stop[] = [
      makeStop(1, '南宁', 'depart', 100.0, 30.0, '2026-01-01T08:00:00+08:00'),
      makeStop(2, '格尔木', 'stop', 104.4, 32.64, '2026-01-01T20:00:00+08:00', '2026-01-01T19:50:00+08:00'),
      makeStop(3, '德令哈', 'stop', 106.0, 33.6, '2026-01-01T22:00:00+08:00', '2026-01-01T21:50:00+08:00'),
      makeStop(4, '哈尔盖', 'stop', 107.0, 34.2, '2026-01-01T23:30:00+08:00', '2026-01-01T23:20:00+08:00'),
      makeStop(5, '刚察', 'stop', 107.5, 34.5, '2026-01-02T01:00:00+08:00', '2026-01-02T00:50:00+08:00'),
      makeStop(6, '天峻', 'stop', 108.0, 34.8, '2026-01-02T02:30:00+08:00', '2026-01-02T02:20:00+08:00'),
      makeStop(7, '湟源', 'stop', 109.0, 35.4, '2026-01-02T04:00:00+08:00', '2026-01-02T03:50:00+08:00'),
      makeStop(8, '西宁', 'arrive', 110.0, 36.0, undefined, '2026-01-02T06:00:00+08:00'),
    ];

    const result = buildMileageAxis({ stops, path, lengthKm });
    const L = lengthKm * 1000;
    const geermuProgress = result.stationKm[1] / L;
    const indexProgress = 1 / (stops.length - 1);

    assert.ok(geermuProgress > 0.3, `格尔木里程进度 ${geermuProgress.toFixed(3)} 应 > 0.3（站序=${indexProgress.toFixed(3)}）`);
    assert.ok(Math.abs(geermuProgress - indexProgress) > 0.1, `里程进度 ${geermuProgress.toFixed(3)} 应与站序 ${indexProgress.toFixed(3)} 显著不同`);
  });

  it('里程轴单调且端点钉定', () => {
    const stops: Stop[] = [
      makeStop(1, 'A', 'depart', 100.0, 30.0, '2026-01-01T08:00:00+08:00'),
      makeStop(2, 'B', 'stop', 102.0, 31.0, '2026-01-01T12:00:00+08:00', '2026-01-01T11:50:00+08:00'),
      makeStop(3, 'C', 'arrive', 105.0, 32.0, undefined, '2026-01-01T18:00:00+08:00'),
    ];
    const { path, lengthKm } = makePath(stops);
    const result = buildMileageAxis({ stops, path, lengthKm });
    assert.equal(result.stationKm[0], 0);
    assert.equal(result.stationKm[stops.length - 1], lengthKm * 1000);
    for (let i = 1; i < result.stationKm.length; i++) {
      assert.ok(result.stationKm[i] >= result.stationKm[i - 1] - 1, `monotone at ${i}`);
    }
  });
});

describe('基准车次回归 — G1（高铁/站距均匀）', () => {
  it('均匀站距 → 里程进度接近站序进度', () => {
    const stops: Stop[] = [
      makeStop(1, '北京南', 'depart', 116.38, 39.87, '2026-01-01T09:00:00+08:00'),
      makeStop(2, '济南西', 'stop', 117.00, 36.65, '2026-01-01T10:30:00+08:00', '2026-01-01T10:28:00+08:00'),
      makeStop(3, '南京南', 'stop', 118.80, 31.95, '2026-01-01T12:30:00+08:00', '2026-01-01T12:28:00+08:00'),
      makeStop(4, '上海虹桥', 'arrive', 121.47, 31.23, undefined, '2026-01-01T13:30:00+08:00'),
    ];
    const { path, lengthKm } = makePath(stops);
    const result = buildMileageAxis({ stops, path, lengthKm });
    const prof = profileForTrain('G1');
    const curve = buildScheduleCurve({ stops, stationKm: result.stationKm, prof });
    assert.ok(curve.stationKm.length === stops.length);
    assert.ok(curve.segSlack.length === stops.length - 1);
  });

  it('高铁参数 vCap=310km/h', () => {
    const prof = profileForTrain('G1');
    assert.ok(prof.vCap > 80, `vCap=${prof.vCap} should be > 80 m/s`);
  });
});

describe('基准车次回归 — K（小站密集/示意线）', () => {
  it('多站密集 → 里程轴最小段 ≥ 200m', () => {
    const stops: Stop[] = [];
    for (let i = 0; i < 15; i++) {
      const type = i === 0 ? 'depart' : i === 14 ? 'arrive' : 'stop';
      const dep = i < 14 ? new Date(2026, 0, 1, 7, 30 + i * 20).toISOString() : undefined;
      const arr = i > 0 ? new Date(2026, 0, 1, 7, 28 + i * 20).toISOString() : undefined;
      stops.push(makeStop(i + 1, `站${i + 1}`, type, 100 + i * 0.5, 30 + i * 0.1, dep, arr));
    }
    const { path, lengthKm } = makePath(stops);
    const result = buildMileageAxis({ stops, path, lengthKm });
    for (let i = 1; i < result.stationKm.length; i++) {
      assert.ok(result.stationKm[i] - result.stationKm[i - 1] >= 199, `min segment at ${i}`);
    }
  });
});

describe('基准车次回归 — D（山区/隧道）', () => {
  it('山区修正 → σ_geo ×1.5', () => {
    const prof = getTrainProfile('D', { mountainous: true });
    const profBase = getTrainProfile('D');
    assert.ok(prof.sigma0 > profBase.sigma0, `山区 σ0=${prof.sigma0} > 基础=${profBase.sigma0}`);
  });
});

describe('基准车次回归 — Z509（Z 走高铁覆写）', () => {
  it('hsrOverride → Z 改用 D 档参数', () => {
    const cls = classifyTrain('Z509');
    assert.equal(cls, 'Z');
    const prof = getTrainProfile(cls, { hsrOverride: true });
    assert.equal(prof.trainClass, 'D');
    assert.ok(prof.vCap > 60, `覆写后 vCap=${prof.vCap} 应为 D 档速度`);
  });

  it('无覆写 → Z 保持原参数', () => {
    const prof = getTrainProfile('Z');
    assert.equal(prof.trainClass, 'Z');
  });
});

describe('缺陷修正回归', () => {
  it('P1-1: accuracy > 300 判弱（旧门限 800）', () => {
    const stops: Stop[] = [
      makeStop(1, 'A', 'depart', 100.0, 30.0, '2026-01-01T08:00:00+08:00'),
      makeStop(2, 'B', 'arrive', 102.0, 30.0, undefined, '2026-01-01T10:00:00+08:00'),
    ];
    const { path, lengthKm } = makePath(stops);
    const result = resolveProgress({
      now: new Date('2026-01-01T09:00:00+08:00'),
      departure: new Date('2026-01-01T08:00:00+08:00'),
      arrival: new Date('2026-01-01T10:00:00+08:00'),
      stops,
      offsetMs: 0,
      calibration: null,
      gps: { lng: 101.0, lat: 30.0, accuracy: 500, timestamp: Date.now() },
      path,
      lengthKm,
    });
    assert.ok(result.mode.includes('弱') || result.mode.includes('GPS'), `accuracy=500 应判弱: ${result.mode}`);
  });

  it('P2-1: GCJ-02→WGS-84 转换消除系统偏移', () => {
    const gcjLng = 116.397428;
    const gcjLat = 39.90923;
    const wgs = gcj02ToWgs84(gcjLng, gcjLat);
    assert.ok(Math.abs(wgs.lng - gcjLng) > 0.001, '应有非零偏移修正');
    assert.ok(Math.abs(wgs.lat - gcjLat) > 0.001, '应有非零偏移修正');
  });

  it('P0-1: 里程轴构建不退化为站序', () => {
    const stops: Stop[] = [
      makeStop(1, 'A', 'depart', 100.0, 30.0, '2026-01-01T08:00:00+08:00'),
      makeStop(2, 'B', 'stop', 104.0, 30.0, '2026-01-01T14:00:00+08:00', '2026-01-01T13:50:00+08:00'),
      makeStop(3, 'C', 'arrive', 110.0, 30.0, undefined, '2026-01-01T18:00:00+08:00'),
    ];
    const { path, lengthKm } = makePath(stops);
    const result = buildMileageAxis({ stops, path, lengthKm });
    const L = lengthKm * 1000;
    const mileageProgress = result.stationKm[1] / L;
    const indexProgress = 1 / (stops.length - 1);
    assert.ok(Math.abs(mileageProgress - indexProgress) > 0.03, '里程进度应与站序不同');
  });
});

describe('降级与边界分支', () => {
  it('零长区间保护：相邻站同坐标 → 拉开至 200m', () => {
    const stops: Stop[] = [
      makeStop(1, 'A', 'depart', 100.0, 30.0, '2026-01-01T08:00:00+08:00'),
      makeStop(2, 'B', 'stop', 100.001, 30.0, '2026-01-01T08:30:00+08:00', '2026-01-01T08:25:00+08:00'),
      makeStop(3, 'C', 'arrive', 102.0, 30.0, undefined, '2026-01-01T10:00:00+08:00'),
    ];
    const { path, lengthKm } = makePath(stops);
    const result = buildMileageAxis({ stops, path, lengthKm });
    assert.ok(result.stationKm[1] - result.stationKm[0] >= 199, '零长区间应拉开至 ≥200m');
  });

  it('全缺坐标 → all_missing 降级', () => {
    const stops: Stop[] = [
      makeStop(1, 'A', 'depart', 100.0, 30.0, '2026-01-01T08:00:00+08:00'),
      { seq: 2, name: 'B', type: 'stop', arriveTime: '2026-01-01T09:00:00+08:00', departTime: '2026-01-01T09:05:00+08:00' },
      makeStop(3, 'C', 'arrive', 102.0, 30.0, undefined, '2026-01-01T10:00:00+08:00'),
    ];
    const { path, lengthKm } = makePath(stops);
    const result = buildMileageAxis({ stops, path, lengthKm });
    assert.notEqual(result.degradation, 'all_missing', '部分缺坐标不应 all_missing');
  });

  it('ETA 空值处理：无景点 → 空数组', () => {
    const stops: Stop[] = [
      makeStop(1, 'A', 'depart', 100.0, 30.0, '2026-01-01T08:00:00+08:00'),
      makeStop(2, 'B', 'arrive', 102.0, 30.0, undefined, '2026-01-01T10:00:00+08:00'),
    ];
    const stationKm = [0, 200_000];
    const prof = profileForTrain('G');
    const curve = buildScheduleCurve({ stops, stationKm, prof });
    const etas = estimateSpotEtas({
      curve,
      spots: [],
      now: Date.now(),
      prof,
      geoSigma: 150,
    });
    assert.equal(etas.length, 0);
  });
});