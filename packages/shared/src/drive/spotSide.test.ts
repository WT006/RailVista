/**
 * 公路左右侧判定单测。
 *
 * 覆盖的重点（对应 spotSide.ts 顶部注释里的坑）：
 *  1. **量纲陷阱**：必须把方向向量与偏移向量换算到同一个局部 ENU 公里平面再叉乘。
 *     混用（单位切向量）×（经纬度度差）会让符号翻转 —— 这是本模块存在的理由。
 *  2. 四个方位语义：left / right / both（贴线）/ unknown（投影落到端点外）。
 *  3. flipRoadSide：反向行驶左右互换，both / unknown 不变。
 *  4. 里程与垂距的量纲自检：crossKm2 / distKm 必须等于 distKm（km²/km = km）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  flipRoadSide,
  projectSpotToPath,
  resolveRoadSide,
  roadSideArrow,
  roadSideLabel,
  roadSideShort,
  ROAD_SIDE_BOTH_KM,
} from './spotSide.js';

/** 正东向折线：lng 100 → 102，lat 30。车往东开时，北侧 = 左手边。 */
const eastPath: [number, number, number?][] = [
  [100.0, 30.0],
  [101.0, 30.0],
  [102.0, 30.0],
];

/** 单段版本：便于做量纲自检 */
const singleSegment: [number, number, number?][] = [
  [100.0, 30.0],
  [102.0, 30.0],
];

describe('projectSpotToPath', () => {
  it('里程与垂距落在合理量级（km，不是度）', () => {
    // 正东向 2 个经度 ≈ 2 × 111.32 × cos30° ≈ 192.8 km
    const p = projectSpotToPath(singleSegment, 101.0, 30.5);
    assert.ok(p, '应当能投影');
    // 垂距 0.5 纬度 ≈ 55.3 km
    assert.ok(Math.abs(p!.distKm - 55.3) < 1.5, `垂距应约 55.3km，实得 ${p!.distKm}`);
    // 投影点在中点，累计里程应约 96.4 km
    assert.ok(Math.abs(p!.alongKm - 96.4) < 2, `里程应约 96.4km，实得 ${p!.alongKm}`);
  });

  it('§量纲自检：cross 必须是 km²（|cross| / 垂距 = 该段长度 km，而不是度）', () => {
    const p = projectSpotToPath(singleSegment, 101.0, 30.5);
    assert.ok(p);
    const ratio = Math.abs(p!.crossKm2) / p!.distKm;
    // 这里的段向量 bb **没有归一化**（归一化不改变叉积符号，但会改变量级），
    // 所以 |cross| = |bb| × 垂距，即 |cross| / 垂距 = 段长。
    // 段长 = 2° 经度 × 111.32 × cos30° ≈ 192.8 km。
    // 若哪天把「度」混进公里平面，这个值会差出 1~2 个数量级 —— 这就是本条的意义。
    const segKm = 2 * 111.32 * Math.cos((30 * Math.PI) / 180);
    assert.ok(
      Math.abs(ratio - segKm) < 1.5,
      `叉积量纲应为 km²：|cross|/垂距 = ${ratio.toFixed(1)} 应等于段长 ${segKm.toFixed(1)}`,
    );
  });

  it('航向角：正东向折线的 headingDeg 约 90°', () => {
    const p = projectSpotToPath(singleSegment, 101.0, 30.1);
    assert.ok(p);
    assert.ok(Math.abs(p!.headingDeg - 90) < 1, `航向应约 90°，实得 ${p!.headingDeg}`);
  });

  it('投影落到折线端点之外时标记 clampedOutside', () => {
    // 远在起点以西（lng 99 < 100），外推约 96 km >> 1 km 阈值
    const p = projectSpotToPath(singleSegment, 99.0, 30.0)!;
    assert.equal(p.clampedOutside, true);
    assert.ok(p.extrapolatedKm > 1);
  });

  it('端点外 1 km 以内不算「判不出」——用端点方向外推给方位', () => {
    // 起点以西 0.005° ≈ 0.48 km：起终城市里的景点常落在这个范围
    const p = projectSpotToPath(singleSegment, 99.995, 30.01)!;
    assert.equal(p.clampedOutside, false, '1km 内的端点外投影不该判 unknown');
    assert.ok(p.extrapolatedKm > 0 && p.extrapolatedKm < 1);
    assert.equal(p.alongKm, 0, '里程必须夹在路线范围内，不能为负');
    const r = resolveRoadSide(p);
    assert.ok(r.side === 'left' || r.side === 'right');
    assert.ok(
      r.confidence === 'mid' || r.confidence === 'low',
      `外推判定的置信度最多 mid，实得 ${r.confidence}`,
    );
    assert.match(String(r.reason ?? ''), /外推/);
  });
});

describe('resolveRoadSide', () => {
  it('往东开：景点在北（lat 更大）判定为左侧', () => {
    const p = projectSpotToPath(eastPath, 101.0, 30.5)!;
    assert.ok(p.crossKm2 > 0, `北侧叉积应为正，实得 ${p.crossKm2}`);
    assert.equal(resolveRoadSide(p).side, 'left');
  });

  it('往东开：景点在南（lat 更小）判定为右侧', () => {
    const p = projectSpotToPath(eastPath, 101.0, 29.5)!;
    assert.equal(resolveRoadSide(p).side, 'right');
  });

  it('往北开：景点在西（lng 更小）判定为左侧', () => {
    const northPath: [number, number, number?][] = [
      [100.0, 30.0],
      [100.0, 31.0],
      [100.0, 32.0],
    ];
    const p = projectSpotToPath(northPath, 99.5, 31.0)!;
    assert.equal(resolveRoadSide(p).side, 'left');
  });

  it('贴线（≤80m）判 both，且是确定结论（high）而不是低置信度', () => {
    // 0.0005 纬度 ≈ 55 m < 80 m
    const p = projectSpotToPath(eastPath, 101.0, 30.0005)!;
    const r = resolveRoadSide(p);
    assert.equal(r.side, 'both');
    assert.equal(r.confidence, 'high');
  });

  it('刚过 both 阈值（>80m）必须给出明确的左/右，不能和稀泥', () => {
    // 0.002 纬度 ≈ 221 m
    const p = projectSpotToPath(eastPath, 101.0, 30.002)!;
    const r = resolveRoadSide(p);
    assert.ok(r.side === 'left' || r.side === 'right', `应给出明确方位，实得 ${r.side}`);
    assert.ok(p.distKm > ROAD_SIDE_BOTH_KM);
  });

  it('投影落在起终点之外 → unknown + low', () => {
    const p = projectSpotToPath(singleSegment, 99.0, 30.0)!;
    const r = resolveRoadSide(p);
    assert.equal(r.side, 'unknown');
    assert.equal(r.confidence, 'low');
  });

  it('置信度按垂距分档：≤1km high / ≤8km mid / 更远 low', () => {
    const near = resolveRoadSide(projectSpotToPath(eastPath, 101.0, 30.008)!); // ≈0.9km
    const mid = resolveRoadSide(projectSpotToPath(eastPath, 101.0, 30.05)!); // ≈5.5km
    const far = resolveRoadSide(projectSpotToPath(eastPath, 101.0, 30.2)!); // ≈22km
    assert.equal(near.confidence, 'high');
    assert.equal(mid.confidence, 'mid');
    assert.equal(far.confidence, 'low');
  });
});

describe('flipRoadSide', () => {
  it('反向行驶左右互换', () => {
    assert.equal(flipRoadSide('left', true), 'right');
    assert.equal(flipRoadSide('right', true), 'left');
  });

  it('正向不变', () => {
    assert.equal(flipRoadSide('left', false), 'left');
    assert.equal(flipRoadSide('right', false), 'right');
  });

  it('both / unknown 不受方向影响（贴线就是贴线，判不出就是判不出）', () => {
    assert.equal(flipRoadSide('both', true), 'both');
    assert.equal(flipRoadSide('unknown', true), 'unknown');
  });
});

describe('展示文案', () => {
  it('公路侧文案不能出现「列车」', () => {
    for (const s of ['left', 'right', 'both', 'unknown'] as const) {
      assert.ok(
        !roadSideLabel(s).includes('列车'),
        `公路方位文案不该提列车：${roadSideLabel(s)}`,
      );
    }
  });

  it('四种取值都有文案与箭头', () => {
    assert.equal(roadSideLabel('left'), '行进方向左侧');
    assert.equal(roadSideLabel('right'), '行进方向右侧');
    assert.equal(roadSideLabel('both'), '就在路上');
    assert.equal(roadSideLabel('unknown'), '方位待定');
    assert.equal(roadSideArrow('left'), '←');
    assert.equal(roadSideArrow('right'), '→');
    assert.equal(roadSideShort('unknown'), '待定');
  });

  it('紧凑文案更短', () => {
    assert.ok(roadSideShort('left').length < roadSideLabel('left').length);
  });
});
