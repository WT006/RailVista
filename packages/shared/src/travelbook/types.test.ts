/**
 * 路书库 shared 层 · 纯函数单测（layer 推断 / 分层轮转 / 区间 / 筛选 / 统计）
 *
 * 运行：`pnpm --filter @railvista/shared test`（已挂进 packages/shared/package.json 的 test 脚本）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYER_RANK_RANGE,
  RECOMMEND_LAYER_ROTATION,
  RECOMMEND_ROTATION_STEP,
  TRAVEL_LAYERS,
  TRAVEL_LAYER_LABEL,
  matchTravelRoute,
  queryTravelRoutes,
  resolveLayer,
  sortRecommendByLayer,
  summarizeTravel,
  toTravelSummary,
  type TravelCounts,
  type TravelRouteSummary,
  type TravelQuery,
} from './types.js';

/** 构造一条用于测试路由序的最小 summary */
function summary(
  id: string,
  layer: TravelRouteSummary['layer'],
  editorRank: number,
  totalKm = 200,
): TravelRouteSummary {
  return {
    id,
    name: `路线 ${id}`,
    subtitle: '测试用',
    provinces: ['测试省'],
    cities: ['测试市'],
    anchorCity: '测试市',
    modes: ['selfdrive', 'public'],
    primaryMode: 'selfdrive',
    shape: 'loop',
    tier: layer === 'L1' ? 'national' : layer === 'L2' ? 'regional' : 'city',
    layer,
    tags: [],
    summary: '测试用假数据（不进真实库）',
    totalKm,
    days: 2,
    bestSeason: [5, 6],
    difficulty: 3,
    roadRefs: ['G1'],
    startNode: 'A',
    endNode: 'B',
    editorRank,
    status: 'published',
    updatedAt: '2026-10-07',
    poiCount: 8,
    mustSeeCount: 4,
    segmentCount: 4,
    nodeCount: 5,
    planCount: 2,
  };
}

/** 固定种子的确定性乱序（不引入随机，保证测试可复现） */
function shuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('TravelLayer 常量', () => {
  it('TRAVEL_LAYERS 是 L1~L5 固定序，且标签齐全', () => {
    assert.deepEqual(TRAVEL_LAYERS, ['L1', 'L2', 'L3', 'L4', 'L5']);
    assert.deepEqual(Object.keys(TRAVEL_LAYER_LABEL), ['L1', 'L2', 'L3', 'L4', 'L5']);
    for (const l of TRAVEL_LAYERS) assert.ok(TRAVEL_LAYER_LABEL[l]?.length > 0);
  });

  it('轮转层序与步长为既定常量', () => {
    assert.deepEqual(RECOMMEND_LAYER_ROTATION, ['L3', 'L4', 'L2', 'L1', 'L5']);
    assert.equal(RECOMMEND_ROTATION_STEP, 2);
  });
});

describe('LAYER_RANK_RANGE 边界', () => {
  /** 区间判定与 include 的正常实现同口径：左闭右开 [min, max) */
  const inRange = (layer: (typeof TRAVEL_LAYERS)[number], rank: number): boolean => {
    const [min, max] = LAYER_RANK_RANGE[layer];
    return rank >= min && rank < max;
  };

  it('每个区间的下界（含）落在区间内，上界（不含）落在区间外', () => {
    for (const layer of TRAVEL_LAYERS) {
      const [min, max] = LAYER_RANK_RANGE[layer];
      assert.equal(min < max, true, `${layer} 区间需有效`);
      assert.equal(inRange(layer, min), true, `${layer} 下界 ${min} 应在区间内`);
      assert.equal(inRange(layer, max - 1), true, `${layer} 内侧上界 ${max - 1} 应在区间内`);
      assert.equal(inRange(layer, max), false, `${layer} 上界 ${max} 不应在区间内`);
      assert.equal(inRange(layer, min - 1), false, `${layer} 下界之外 ${min - 1} 不应在区间内`);
    }
  });

  it('L1 的 1 与 99 应在区间内，100 不应', () => {
    assert.equal(inRange('L1', 1), true);
    assert.equal(inRange('L1', 99), true);
    assert.equal(inRange('L1', 100), false);
  });

  it('L4 的 300 与 399 应在区间内，400 与 299 不应', () => {
    assert.equal(inRange('L4', 300), true);
    assert.equal(inRange('L4', 399), true);
    assert.equal(inRange('L4', 400), false);
    assert.equal(inRange('L4', 299), false);
  });

  it('相邻层区间首尾相接且不重叠', () => {
    for (let i = 1; i < TRAVEL_LAYERS.length; i += 1) {
      const prev = LAYER_RANK_RANGE[TRAVEL_LAYERS[i - 1]];
      const cur = LAYER_RANK_RANGE[TRAVEL_LAYERS[i]];
      assert.equal(prev[1], cur[0], `${TRAVEL_LAYERS[i - 1]} 上界应等于 ${TRAVEL_LAYERS[i]} 下界`);
    }
  });
});

describe('resolveLayer', () => {
  it('显式 layer 永远优先（可覆盖 tier 与 days 的推断结果）', () => {
    assert.equal(resolveLayer({ layer: 'L5', tier: 'national', days: 15 }), 'L5');
    assert.equal(resolveLayer({ layer: 'L3', tier: 'city', days: 1 }), 'L3');
    assert.equal(resolveLayer({ layer: 'L1', tier: 'city', days: 1 }), 'L1');
  });

  it('national → L1，regional → L2（与 days 无关）', () => {
    assert.equal(resolveLayer({ tier: 'national', days: 1 }), 'L1');
    assert.equal(resolveLayer({ tier: 'national', days: 20 }), 'L1');
    assert.equal(resolveLayer({ tier: 'regional', days: 1 }), 'L2');
    assert.equal(resolveLayer({ tier: 'regional', days: 7 }), 'L2');
  });

  it('city && days <= 2 → L4；city && days >= 3 → L3', () => {
    assert.equal(resolveLayer({ tier: 'city', days: 1 }), 'L4');
    assert.equal(resolveLayer({ tier: 'city', days: 2 }), 'L4');
    assert.equal(resolveLayer({ tier: 'city', days: 3 }), 'L3');
    assert.equal(resolveLayer({ tier: 'city', days: 6 }), 'L3');
  });

  it('days 缺失 / 0 / 负数 → 保守 L4', () => {
    assert.equal(resolveLayer({ tier: 'city', days: undefined }), 'L4');
    assert.equal(resolveLayer({ tier: 'city', days: 0 }), 'L4');
    assert.equal(resolveLayer({ tier: 'city', days: -3 }), 'L4');
    assert.equal(resolveLayer({ tier: 'city', days: Number.NaN }), 'L4');
  });

  it('tier 缺失 / 非法 → 退化到 days 判定，最保守取 L4', () => {
    assert.equal(resolveLayer({ tier: undefined, days: undefined }), 'L4');
    assert.equal(resolveLayer({ tier: 'city', days: 1.5 }), 'L4');
    assert.equal(resolveLayer({ layer: undefined, tier: 'national', days: 0 }), 'L1');
  });

  it('推断永不产出 L5', () => {
    const tiers = ['national', 'regional', 'city', undefined] as const;
    const daysList = [0, 1, 2, 3, 5, 10, undefined, Number.NaN];
    for (const tier of tiers) {
      for (const days of daysList) {
        const got = resolveLayer({ layer: undefined, tier, days });
        assert.notEqual(got, 'L5', `tier=${String(tier)} days=${String(days)} 不应推断出 L5`);
      }
    }
  });
});

describe('sortRecommendByLayer', () => {
  const fixture: TravelRouteSummary[] = [
    summary('l1-a', 'L1', 1),
    summary('l1-b', 'L1', 2),
    summary('l1-c', 'L1', 3),
    summary('l2-a', 'L2', 101),
    summary('l3-a', 'L3', 201),
    summary('l3-b', 'L3', 202),
    summary('l4-a', 'L4', 301),
    summary('l5-a', 'L5', 401),
  ];

  it('按轮转层序每轮每层取 2 条', () => {
    assert.deepEqual(
      sortRecommendByLayer(fixture).map((r) => r.id),
      [
        'l3-a', 'l3-b', // 轮1 L3 取 2
        'l4-a',         // 轮1 L4 只剩 1
        'l2-a',         // 轮1 L2 只剩 1
        'l1-a', 'l1-b', // 轮1 L1 取 2
        'l5-a',         // 轮1 L5 只剩 1
        'l1-c',         // 轮2 仅 L1 有剩
      ],
    );
  });

  it('空数组与单元素层都能正常收尾', () => {
    assert.deepEqual(sortRecommendByLayer([]), []);
    assert.deepEqual(sortRecommendByLayer([summary('only', 'L5', 401)]).map((r) => r.id), ['only']);
  });

  it('editorRank 相同时用 id 兜底，保证顺序确定', () => {
    const dupRank = [summary('zzz', 'L3', 201), summary('aaa', 'L3', 201), summary('mmm', 'L3', 201)];
    const firstRun = sortRecommendByLayer(dupRank).map((r) => r.id);
    assert.deepEqual(firstRun, ['aaa', 'mmm', 'zzz']);
    // 反序输入结果不变
    assert.deepEqual(
      sortRecommendByLayer([...dupRank].reverse()).map((r) => r.id),
      ['aaa', 'mmm', 'zzz'],
    );
  });

  it('输出与输入数组原始顺序无关（50 种乱序结果一致）', () => {
    const baseline = sortRecommendByLayer(fixture).map((r) => r.id).join('|');
    for (let seed = 1; seed <= 50; seed += 1) {
      assert.equal(sortRecommendByLayer(shuffle(fixture, seed)).map((r) => r.id).join('|'), baseline);
    }
  });

  it('不重不漏：输出成员集合与输入完全一致', () => {
    const out = sortRecommendByLayer(shuffle(fixture, 7));
    assert.equal(out.length, fixture.length);
    assert.deepEqual(new Set(out.map((r) => r.id)), new Set(fixture.map((r) => r.id)));
  });

  it('只读：不修改传入数组', () => {
    const input = [...fixture];
    const snapshot = input.map((r) => r.id).join('|');
    sortRecommendByLayer(input);
    assert.equal(input.map((r) => r.id).join('|'), snapshot);
  });

  it('layer 为脏值时回退到 resolveLayer，不产出 undefined 分组', () => {
    const dirty = [
      { ...summary('x', 'L3', 201), layer: undefined as unknown as TravelRouteSummary['layer'] },
    ];
    assert.deepEqual(sortRecommendByLayer(dirty).map((r) => r.id), ['x']);
  });
});

describe('queryTravelRoutes', () => {
  const fixture: TravelRouteSummary[] = [
    summary('l1-a', 'L1', 1, 3200),
    summary('l1-b', 'L1', 2, 1800),
    summary('l3-a', 'L3', 201, 220),
    summary('l4-a', 'L4', 301, 260),
  ];

  it('默认（recommend）走分层轮转', () => {
    assert.deepEqual(
      queryTravelRoutes(fixture, {}).map((r) => r.id),
      ['l3-a', 'l4-a', 'l1-a', 'l1-b'],
    );
  });

  it("sort='layer' 是回归基线：editorRank 升序，同 rank 按里程降序", () => {
    assert.deepEqual(
      queryTravelRoutes(fixture, { sort: 'layer' }).map((r) => r.id),
      ['l1-a', 'l1-b', 'l3-a', 'l4-a'],
    );
    const baseline = [...fixture].sort((a, b) => a.editorRank - b.editorRank || b.totalKm - a.totalKm);
    assert.deepEqual(queryTravelRoutes(fixture, { sort: 'layer' }).map((r) => r.id), baseline.map((r) => r.id));
  });

  it('翻页不重不漏：逐页拼接等于一次性全量', () => {
    const all = queryTravelRoutes(fixture, {}).map((r) => r.id);
    const paged: string[] = [];
    for (let offset = 0; offset < fixture.length; offset += 2) {
      paged.push(...queryTravelRoutes(fixture, { offset, limit: 2 }).map((r) => r.id));
    }
    assert.deepEqual(paged, all);
    assert.deepEqual(queryTravelRoutes(fixture, { offset: 999, limit: 2 }), []);
  });

  it('draft 路线默认被过滤，带关键词时才出现', () => {
    const withDraft = [...fixture, { ...summary('draft-1', 'L1', 4), status: 'draft' as const }];
    assert.ok(!queryTravelRoutes(withDraft, {}).some((r) => r.id === 'draft-1'));
    assert.ok(queryTravelRoutes(withDraft, { q: '路线' }).some((r) => r.id === 'draft-1'));
  });
});

describe('matchTravelRoute 的 layer 分支', () => {
  const list = [summary('l3-a', 'L3', 201), summary('l1-a', 'L1', 1)];

  it('q.layer 按分层精确过滤', () => {
    const q: TravelQuery = { layer: 'L3' };
    assert.deepEqual(list.filter((r) => matchTravelRoute(r, q)).map((r) => r.id), ['l3-a']);
  });

  it('q.layer 缺省时不过滤任何层', () => {
    assert.equal(list.filter((r) => matchTravelRoute(r, {})).length, 2);
  });

  it('layer 与其它条件是「与」关系', () => {
    const q: TravelQuery = { layer: 'L3', maxKm: 100 };
    assert.equal(list.filter((r) => matchTravelRoute(r, q)).length, 0);
  });
});

describe('toTravelSummary / summarizeTravel', () => {
  it('详情缺 layer 时由 tier + days 推断并写入 summary', () => {
    const s = toTravelSummary({
      id: 'x',
      name: 'x',
      subtitle: 'x',
      provinces: ['A'],
      cities: ['B'],
      anchorCity: 'B',
      modes: ['selfdrive'],
      primaryMode: 'selfdrive',
      shape: 'loop',
      tier: 'city',
      tags: [],
      summary: 'x',
      totalKm: 100,
      days: 3,
      bestSeason: [5],
      difficulty: 2,
      roadRefs: [],
      startNode: 'a',
      endNode: 'b',
      intro: {
        overview: 'o',
        bestSeason: '5月',
        days: 3,
        difficulty: 2,
        difficultyNote: 'n',
        audience: ['all'],
      },
      nodes: [],
      segments: [],
      pois: [],
      plan: [],
      practical: {},
      editorRank: 250,
      status: 'published',
      updatedAt: '2026-10-07',
    });
    assert.equal(s.layer, 'L3');
  });

  it('byLayer 缺层填 0，五层恒在', () => {
    const counts: TravelCounts = summarizeTravel([summary('l1-a', 'L1', 1)]);
    assert.deepEqual(counts.byLayer, { L1: 1, L2: 0, L3: 0, L4: 0, L5: 0 });
    assert.equal(Object.keys(counts.byLayer).length, 5);
  });

  it('byLayer 各层之和等于 routes 总数', () => {
    const routes = [
      summary('l1-a', 'L1', 1),
      summary('l3-a', 'L3', 201),
      summary('l3-b', 'L3', 202),
      summary('l5-a', 'L5', 401),
    ];
    const counts = summarizeTravel(routes);
    const sum = Object.values(counts.byLayer).reduce((s, n) => s + n, 0);
    assert.equal(sum, counts.routes);
  });

  it('空集合时统计全部归零且不抛错', () => {
    const counts = summarizeTravel([]);
    assert.deepEqual(counts.byLayer, { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 });
    assert.equal(counts.routes, 0);
  });
});
