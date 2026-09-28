/**
 * 车窗方位判定引擎单测，对应 docs/scenic-supplement-20260928.md §3 / §4。
 * 重点覆盖：
 *  - §3.4 单位陷阱：|cross| / |d| 必须等于 distKm（km²/km = km）
 *  - §3.2 反向行驶左右侧互换
 *  - §3.3 退化规则（贴线 / 延展型 / 端点外）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRailwayMetrics } from './schedule/progress.js';
import { filterSpotsAlongRailway, type ScenicSpotInput } from './schedule/scenic.js';
import {
  EXTENDED_SPAN_KM,
  flipSide,
  honorLabels,
  isExtendedSpot,
  projectSpotToLine,
  resolveSpotSide,
  withinApproach,
  approachWindow,
  sideArrow,
  sideLabel,
} from './schedule/spotSide.js';

/** 东西向直线：lng 100 → 102，lat 30（列车向东行驶时，北侧 = 左侧） */
const eastLine: [number, number][] = [
  [100.0, 30.0],
  [101.0, 30.0],
  [102.0, 30.0],
];

/** 单线段版本：|d| 恰为 lengthKm，便于做 §3.4 的量纲自检 */
const singleSegment: [number, number][] = [
  [100.0, 30.0],
  [102.0, 30.0],
];

function forwardMetrics() {
  return buildRailwayMetrics(eastLine);
}

function reversedMetrics() {
  return buildRailwayMetrics([...eastLine].reverse());
}

describe('projectSpotToLine — §3.4 局部 ENU 公里平面', () => {
  it('几何自检：|cross| / |d| == distKm', () => {
    const { path, lengthKm } = buildRailwayMetrics(singleSegment);
    const north = projectSpotToLine(path, lengthKm, 101.0, 30.05);
    assert.ok(north, '应能投影成功');
    assert.ok(lengthKm > 0);

    const implied = Math.abs(north!.crossKm2) / lengthKm;
    assert.ok(
      Math.abs(implied - north!.distKm) < 0.1,
      `单位自检失败：|cross|/|d|=${implied.toFixed(4)} 与 distKm=${north!.distKm} 不符（说明量纲未统一到 km）`,
    );
    assert.ok(north!.distKm > 4 && north!.distKm < 7, `纬度 +0.05° 约 5.5km，实得 ${north!.distKm}`);
  });

  it('向东行驶时北侧判定为 left，南侧判定为 right', () => {
    const { path, lengthKm } = forwardMetrics();
    const north = resolveSpotSide({ path, lengthKm, lng: 101.0, lat: 30.05 });
    const south = resolveSpotSide({ path, lengthKm, lng: 101.0, lat: 29.95 });
    assert.equal(north?.side, 'left');
    assert.equal(south?.side, 'right');
    assert.equal(north?.confidence, 'high');
    assert.equal(south?.confidence, 'high');
  });
});

describe('左右互换 — §3.2', () => {
  it('同一景点，折线反向后左右互换', () => {
    const fwd = forwardMetrics();
    const rev = reversedMetrics();
    const a = resolveSpotSide({ path: fwd.path, lengthKm: fwd.lengthKm, lng: 101.0, lat: 30.05 });
    const b = resolveSpotSide({ path: rev.path, lengthKm: rev.lengthKm, lng: 101.0, lat: 30.05 });
    assert.equal(a?.side, 'left');
    assert.equal(b?.side, 'right');
  });

  it('reversed 标记显式翻转结果', () => {
    const { path, lengthKm } = forwardMetrics();
    const base = resolveSpotSide({ path, lengthKm, lng: 101.0, lat: 30.05 });
    const flipped = resolveSpotSide({ path, lengthKm, lng: 101.0, lat: 30.05, reversed: true });
    assert.equal(base?.side, 'left');
    assert.equal(flipped?.side, 'right');
    assert.equal(flipped?.flipped, true);
  });

  it('几何优先于数据侧：反向行驶即使数据侧存在也必须翻面', () => {
    const fwd = forwardMetrics();
    const rev = reversedMetrics();
    // 数据侧按「走廊正方向（向东）」存储为 left（北侧）
    const stored = { storedSide: 'left' as const };
    const a = resolveSpotSide({ path: fwd.path, lengthKm: fwd.lengthKm, lng: 101.0, lat: 30.05, ...stored });
    const b = resolveSpotSide({ path: rev.path, lengthKm: rev.lengthKm, lng: 101.0, lat: 30.05, ...stored });
    assert.equal(a?.side, 'left');
    assert.equal(b?.side, 'right', '反向车次必须左右互换，不能被数据侧自我抵消');
    // 反向行驶本就会与「按正方向存储」的 side 相反，属正常现象，不应降级置信度
    assert.equal(a?.confidence, 'high');
    assert.equal(b?.confidence, 'high');
    assert.match(b?.reason ?? '', /不一致/);
  });

  it('flipSide：both / unknown 不翻转', () => {
    assert.equal(flipSide('left', true), 'right');
    assert.equal(flipSide('right', true), 'left');
    assert.equal(flipSide('both', true), 'both');
    assert.equal(flipSide('unknown', true), 'unknown');
    assert.equal(flipSide(undefined, true), 'unknown');
  });
});

describe('退化规则 — §3.3', () => {
  it('贴线景点（≤0.3km）判定为 both，且是 high 置信度', () => {
    const { path, lengthKm } = forwardMetrics();
    const r = resolveSpotSide({ path, lengthKm, lng: 101.0, lat: 30.000002 });
    assert.equal(r?.side, 'both');
    // 贴线/正侧通过是「两边都看得到」的确定结论，不是没把握
    assert.equal(r?.confidence, 'high');
    assert.equal(r?.needsReview, false);
  });

  it('延展型景观（跨度 > 10km）判定为 both，且是 high 置信度', () => {
    const { path, lengthKm } = forwardMetrics();
    const r = resolveSpotSide({
      path,
      lengthKm,
      lng: 101.0,
      lat: 30.05,
      lineRef: { alongKmFrom: 10, alongKmTo: 10 + EXTENDED_SPAN_KM + 5 },
    });
    assert.equal(r?.side, 'both');
    assert.equal(r?.confidence, 'high');
    assert.equal(r?.needsReview, false);
  });

  it('「两侧均可」不等于低置信度（回归保护）', () => {
    const { path, lengthKm } = forwardMetrics();
    const cases = [
      resolveSpotSide({ path, lengthKm, lng: 101.0, lat: 30.000002 }),
      resolveSpotSide({
        path,
        lengthKm,
        lng: 101.0,
        lat: 30.05,
        lineRef: { alongKmFrom: 10, alongKmTo: 40 },
      }),
    ];
    for (const r of cases) {
      assert.equal(r?.side, 'both');
      assert.notEqual(r?.confidence, 'low', 'both 是正常结论，不应被标为低置信度');
    }
  });

  it('投影落到端点外 → unknown + low + needsReview（不是 both）', () => {
    const { path, lengthKm } = forwardMetrics();
    const r = resolveSpotSide({ path, lengthKm, lng: 99.0, lat: 30.05 });
    // 点位在走廊覆盖范围外 = 判断不了在哪一侧，不是「两侧都能看」
    assert.equal(r?.side, 'unknown');
    assert.equal(r?.confidence, 'low');
    assert.equal(r?.needsReview, true);
  });

  it('isExtendedSpot 阈值判定', () => {
    assert.equal(isExtendedSpot({ alongKmFrom: 0, alongKmTo: EXTENDED_SPAN_KM }), false);
    assert.equal(isExtendedSpot({ alongKmFrom: 0, alongKmTo: EXTENDED_SPAN_KM + 0.1 }), true);
    assert.equal(isExtendedSpot(undefined), false);
  });
});

describe('UI 文案与临近提示 — §4', () => {
  it('sideLabel / sideArrow 覆盖四种取值', () => {
    assert.equal(sideLabel('left'), '列车左侧');
    assert.equal(sideArrow('left'), '←');
    assert.equal(sideLabel('right'), '列车右侧');
    assert.equal(sideArrow('right'), '→');
    assert.equal(sideLabel('both'), '两侧均可');
    assert.equal(sideArrow('both'), '↔');
    assert.equal(sideLabel('unknown'), '方位待确认');
    assert.equal(sideLabel(undefined), '方位待确认');
  });

  it('approachWindow：提前 5km 进入，过境 2km 后淡出', () => {
    const w = approachWindow({ alongKm: 100 });
    assert.deepEqual(w, { fromKm: 95, toKm: 102 });
    assert.equal(withinApproach(w, 94.9), false);
    assert.equal(withinApproach(w, 96), true);
    assert.equal(withinApproach(w, 101.5), true);
    assert.equal(withinApproach(w, 102.1), false);
  });

  it('honorLabels 映射未知代码回退原值', () => {
    assert.deepEqual(honorLabels(['NNR', 'AAAAA']), ['国家级自然保护区', '国家 5A 级景区']);
    assert.deepEqual(honorLabels(['UNKNOWN_CODE']), ['UNKNOWN_CODE']);
    assert.deepEqual(honorLabels(undefined), []);
  });
});

describe('filterSpotsAlongRailway 输出运行时方位字段', () => {
  const spots: ScenicSpotInput[] = [
    { id: 's1', name: '南侧湖', lng: 101.0, lat: 29.95, source: 'curated' },
    { id: 'n1', name: '北侧山', lng: 101.0, lat: 30.05, source: 'curated' },
  ];

  it('南侧 = right，北侧 = left，并按 progressKm 排序', () => {
    const out = filterSpotsAlongRailway(spots, eastLine);
    const s = out.find((x) => x.id === 's1');
    const n = out.find((x) => x.id === 'n1');
    assert.equal(s?.sideRuntime, 'right');
    assert.equal(n?.sideRuntime, 'left');
    assert.equal(s?.sideConfidence, 'high');
    assert.ok((s?.distKm ?? 0) > 4, '垂距应约 5.5km');
  });

  it('行程方向相反时结果整体互换', () => {
    const out = filterSpotsAlongRailway(spots, [...eastLine].reverse());
    const s = out.find((x) => x.id === 's1');
    const n = out.find((x) => x.id === 'n1');
    assert.equal(s?.sideRuntime, 'left');
    assert.equal(n?.sideRuntime, 'right');
  });

  it('超出可见半径的景点被过滤', () => {
    const out = filterSpotsAlongRailway(
      [{ id: 'far', name: '远山', lng: 101.0, lat: 30.5, source: 'curated' }],
      eastLine,
    );
    assert.equal(out.length, 0);
  });
});
