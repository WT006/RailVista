/**
 * 路书库 shared 层 · 校验器单测（V1~V9 / V13 / V16 / V17）
 *
 * 每条判据至少一对用例：正例（合法、不报该规则的 error）与反例（应报该规则的 error/warn）。
 * 运行：`pnpm --filter @railvista/shared test`
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  layerText,
  validateTravelRoute,
  type ValidationIssue,
} from './index.js';
import {
  TRAVEL_LAYER_LABEL,
  type TravelDay,
  type TravelLayer,
  type TravelNode,
  type TravelPoi,
  type TravelRouteDetail,
  type TravelSegment,
} from './types.js';

// ── 最小合法基线（在所有 V 判据下应零 error） ────────────────────────────
function node(name: string, city = '测试市', role: TravelNode['role'] = 'pass', extra: Partial<TravelNode> = {}): TravelNode {
  return { name, province: '测试省', city, lng: 120, lat: 30, role, ...extra };
}

function poi(id: string, mustSee = false, extra: Partial<TravelPoi> = {}): TravelPoi {
  return {
    id,
    name: `景点${id}`,
    province: '测试省',
    city: '测试市',
    category: 'mountain',
    lng: 120,
    lat: 30,
    tagline: '一句话特色',
    intro: '景点介绍正文',
    mustSee,
    ...extra,
  };
}

function segment(id: string, index: number, extra: Partial<TravelSegment> = {}): TravelSegment {
  return {
    id,
    index,
    name: `路段${index}`,
    fromNode: 'N1',
    toNode: 'N2',
    roadRefs: ['G101'],
    roadClass: '国道',
    distanceKm: 100,
    poiIds: [],
    ...extra,
  };
}

const BASE_NODES: TravelNode[] = [
  node('N1', '测试市', 'hub'),
  node('N2', '测试市', 'stay'),
  node('N3', '测试市', 'stay'),
  node('N4', '测试市', 'pass'),
];

const BASE_POIS: TravelPoi[] = [
  poi('p1', true),
  poi('p2', true),
  poi('p3', true),
  poi('p4'),
  poi('p5'),
  poi('p6'),
];

const BASE_SEGMENTS: TravelSegment[] = [
  segment('s1', 1, { fromNode: 'N1', toNode: 'N2', poiIds: ['p1'], distanceKm: 100 }),
  segment('s2', 2, { fromNode: 'N2', toNode: 'N3', poiIds: ['p2'], distanceKm: 100 }),
  segment('s3', 3, { fromNode: 'N3', toNode: 'N4', poiIds: ['p3'], distanceKm: 100 }),
];

function planDay(day: number, extra: Partial<TravelDay> = {}): TravelDay {
  return {
    day,
    title: `第${day}天`,
    fromNode: 'N1',
    toNode: 'N4',
    distanceKm: 300,
    roadRefs: ['G101'],
    stayCity: '测试市',
    poiIds: ['p1', 'p2', 'p3'],
    summary: '当天概览',
    ...extra,
  };
}

const CAR_FREE_OK =
  '最近的高铁站：测试站（距 N1 约 20km，站前有公交与出租车接驳）。接驳：测试站→N4 每日约 6 班客运班车，车程约 1 小时。不可达段：无。结论：全程无车可行。';
const MILEAGE_NOTE_OK =
  '3 个主路段累加 300km，另计支线往返 0km = 300km；不含景区内部区间车。里程为按公开公路里程表与地图测距估算，实际以导航实测为准。';

/** 一条在全部 V 判据下都合法的最小路线 */
function validRoute(over: Partial<TravelRouteDetail> = {}): TravelRouteDetail {
  return {
    id: 'test-route',
    name: '测试路线',
    subtitle: '一句亮点',
    provinces: ['测试省'],
    cities: ['测试市'],
    anchorCity: '测试市',
    modes: ['selfdrive', 'public'],
    primaryMode: 'selfdrive',
    shape: 'loop',
    tier: 'city',
    layer: 'L4',
    tags: [],
    summary: '测试用一句话速写，含徒步选项说明。',
    totalKm: 300,
    mileageNote: MILEAGE_NOTE_OK,
    days: 2,
    bestSeason: [5, 6],
    difficulty: 3,
    roadRefs: ['G101'],
    startNode: 'N1',
    endNode: 'N4',
      intro: {
        overview: '整体介绍正文',
        bestSeason: '5-6 月',
        seasonNotes: [],
        days: 2,
        difficulty: 3,
        difficultyNote: '难度成因说明',
        audience: ['家庭'],
        avoid: [],
      },
    nodes: BASE_NODES,
    segments: BASE_SEGMENTS,
    pois: BASE_POIS,
    plan: [planDay(1), planDay(2)],
    practical: { carFree: CAR_FREE_OK },
    sources: [{ title: '项目内公路索引', publisher: 'RailVista', usedFor: '道路编号' }],
    editorRank: 301,
    status: 'published',
    updatedAt: '2026-10-07',
    ...over,
  };
}

const errorsOf = (issues: ValidationIssue[]): ValidationIssue[] => issues.filter((i) => i.level === 'error');
const warnsOf = (issues: ValidationIssue[]): ValidationIssue[] => issues.filter((i) => i.level === 'warn');
const hasField = (issues: ValidationIssue[], field: string): boolean =>
  issues.some((i) => i.field === field);

describe('validateTravelRoute 基线', () => {
  it('合法路线：零 error 零 warn', () => {
    const issues = validateTravelRoute(validRoute());
    assert.deepEqual(errorsOf(issues), [], `意外 error: ${JSON.stringify(errorsOf(issues))}`);
    assert.deepEqual(warnsOf(issues), [], `意外 warn: ${JSON.stringify(warnsOf(issues))}`);
  });
});

describe('V1 pois ≥ 6', () => {
  it('正例：正好 6 个不报错', () => {
    assert.equal(hasField(errorsOf(validateTravelRoute(validRoute())), 'pois'), false);
  });

  it('反例：5 个 pois → error', () => {
    const issues = errorsOf(validateTravelRoute(validRoute({ pois: BASE_POIS.slice(0, 5) })));
    assert.equal(hasField(issues, 'pois'), true);
  });
});

describe('V2 mustSee ≥ 3', () => {
  it('正例：正好 3 个必去不报错', () => {
    const pois = [poi('p1', true), poi('p2', true), poi('p3', true), poi('p4'), poi('p5'), poi('p6')];
    const issues = errorsOf(validateTravelRoute(validRoute({ pois })));
    assert.equal(hasField(issues, 'pois'), false);
  });

  it('反例：只有 2 个必去 → error', () => {
    const pois = [poi('p1', true), poi('p2', true), poi('p3'), poi('p4'), poi('p5'), poi('p6')];
    const issues = errorsOf(validateTravelRoute(validRoute({ pois })));
    assert.equal(hasField(issues, 'pois'), true);
  });
});

describe('V3 nodes ≥ 4', () => {
  it('正例：4 个节点不报错', () => {
    const issues = errorsOf(validateTravelRoute(validRoute()));
    assert.equal(hasField(issues, 'nodes'), false);
  });

  it('反例：3 个节点 → error', () => {
    const issues = errorsOf(validateTravelRoute(validRoute({ nodes: BASE_NODES.slice(0, 3) })));
    assert.equal(hasField(issues, 'nodes'), true);
  });
});

describe('V4 segments ≥ 3', () => {
  it('正例：3 段不报错', () => {
    const issues = errorsOf(validateTravelRoute(validRoute()));
    assert.equal(hasField(issues, 'segments'), false);
  });

  it('反例：2 段 → error', () => {
    const issues = errorsOf(validateTravelRoute(validRoute({ segments: BASE_SEGMENTS.slice(0, 2) })));
    assert.equal(hasField(issues, 'segments'), true);
  });
});

describe('V5 plan.length === days === intro.days', () => {
  it('正例：三者一致不报错', () => {
    const issues = errorsOf(validateTravelRoute(validRoute()));
    assert.equal(hasField(issues, 'plan'), false);
    assert.equal(hasField(issues, 'intro.days'), false);
  });

  it('反例1：plan.length ≠ days → error', () => {
    const issues = errorsOf(validateTravelRoute(validRoute({ plan: [planDay(1)] })));
    assert.equal(hasField(issues, 'plan'), true);
  });

  it('反例2：intro.days ≠ days → error（原为 warn，已升级）', () => {
    const issues = validateTravelRoute(
      validRoute({ intro: { ...validRoute().intro, days: 5 } }),
    );
    assert.equal(hasField(errorsOf(issues), 'intro.days'), true);
    assert.equal(hasField(warnsOf(issues), 'intro.days'), false);
  });
});

describe('V6 practical.carFree 非空且 ≥ 20 字', () => {
  it('正例：20 字以上的无车方案不报错', () => {
    const issues = errorsOf(validateTravelRoute(validRoute()));
    assert.equal(hasField(issues, 'practical.carFree'), false);
  });

  it('反例1：完全没写 → error', () => {
    const issues = errorsOf(validateTravelRoute(validRoute({ practical: {} })));
    assert.equal(hasField(issues, 'practical.carFree'), true);
  });

  it('反例2：写了但不足 20 字 → error', () => {
    const issues = errorsOf(validateTravelRoute(validRoute({ practical: { carFree: '可坐高铁' } })));
    assert.equal(hasField(issues, 'practical.carFree'), true);
  });
});

describe('V7 mileageNote 非空', () => {
  it('正例：写了口径说明不报错', () => {
    const issues = errorsOf(validateTravelRoute(validRoute()));
    assert.equal(hasField(issues, 'mileageNote'), false);
  });

  it('反例1：缺失 → error', () => {
    const issues = errorsOf(validateTravelRoute(validRoute({ mileageNote: undefined })));
    assert.equal(hasField(issues, 'mileageNote'), true);
  });

  it('反例2：只有空白字符 → error', () => {
    const issues = errorsOf(validateTravelRoute(validRoute({ mileageNote: '   ' })));
    assert.equal(hasField(issues, 'mileageNote'), true);
  });

  it('边界：非空但过短 → 降级 warn，不阻断', () => {
    const issues = validateTravelRoute(validRoute({ mileageNote: '估算' }));
    assert.equal(hasField(errorsOf(issues), 'mileageNote'), false);
    assert.equal(hasField(warnsOf(issues), 'mileageNote'), true);
  });
});

describe('V8 modes 需含 selfdrive（徒步 / 岛屿例外）', () => {
  it('正例：含 selfdrive 不报错', () => {
    const issues = errorsOf(validateTravelRoute(validRoute()));
    assert.equal(hasField(issues, 'modes'), false);
  });

  it('反例：既无 selfdrive 也无例外条件 → error', () => {
    const r = validRoute({
      layer: 'L3',
      tier: 'city',
      days: 3,
      modes: ['public'],
      primaryMode: 'public',
    });
    const issues = errorsOf(validateTravelRoute(r));
    assert.equal(hasField(issues, 'modes'), true);
  });

  it('例外1：primaryMode=hiking 且 summary 提到徒步 → 放行', () => {
    const r = validRoute({
      layer: 'L3',
      tier: 'city',
      days: 3,
      modes: ['hiking'],
      primaryMode: 'hiking',
      summary: '全程徒步穿越，沿国家步道行走。',
    });
    assert.equal(hasField(errorsOf(validateTravelRoute(r)), 'modes'), false);
  });

  it('例外2：shape=point 且 summary 提到岛屿 → 放行', () => {
    const r = validRoute({
      layer: 'L3',
      tier: 'city',
      days: 3,
      modes: ['public'],
      primaryMode: 'public',
      shape: 'point',
      summary: '岛屿线路，全程步行 + 轮渡接驳。',
    });
    assert.equal(hasField(errorsOf(validateTravelRoute(r)), 'modes'), false);
  });

  it('例外不成立：primaryMode=hiking 但 summary 没提徒步 → 仍报错', () => {
    const r = validRoute({
      layer: 'L3',
      tier: 'city',
      days: 3,
      modes: ['hiking'],
      primaryMode: 'hiking',
      summary: '风景很好的一条线路。',
    });
    assert.equal(hasField(errorsOf(validateTravelRoute(r)), 'modes'), true);
  });
});

describe('V9 layer 与 tier 一致性', () => {
  const cases: { layer: TravelLayer; tier: TravelRouteDetail['tier']; days: number; ok: boolean }[] = [
    { layer: 'L1', tier: 'national', days: 8, ok: true },
    { layer: 'L1', tier: 'city', days: 2, ok: false },
    { layer: 'L2', tier: 'regional', days: 5, ok: true },
    { layer: 'L2', tier: 'national', days: 8, ok: false },
    { layer: 'L3', tier: 'city', days: 3, ok: true },
    { layer: 'L3', tier: 'regional', days: 5, ok: false },
    { layer: 'L4', tier: 'city', days: 2, ok: true },
    { layer: 'L4', tier: 'regional', days: 5, ok: false },
    { layer: 'L5', tier: 'city', days: 2, ok: true },
    { layer: 'L5', tier: 'regional', days: 5, ok: true }, // 文档 §3.2：L5 允许 city 或 regional
    { layer: 'L5', tier: 'national', days: 8, ok: false },
  ];

  for (const c of cases) {
    it(`${c.layer} + ${c.tier} → ${c.ok ? '放行' : 'error'}`, () => {
      const r = validRoute({
        layer: c.layer,
        tier: c.tier,
        days: c.days,
        intro: { ...validRoute().intro, days: c.days },
        plan: Array.from({ length: c.days }, (_, i) => planDay(i + 1)),
      });
      assert.equal(hasField(errorsOf(validateTravelRoute(r)), 'layer'), !c.ok);
    });
  }

  it('layer 缺失时不校验 tier（走推断，不报错）', () => {
    const r = validRoute({ layer: undefined, tier: 'national', days: 10, intro: { ...validRoute().intro, days: 10 }, plan: Array.from({ length: 10 }, (_, i) => planDay(i + 1)) });
    assert.equal(hasField(errorsOf(validateTravelRoute(r)), 'layer'), false);
  });
});

describe('V13 sources ≥ 1', () => {
  it('正例：有 1 条来源无 warn', () => {
    assert.equal(hasField(warnsOf(validateTravelRoute(validRoute())), 'sources'), false);
  });

  it('反例：没有来源 → warn（不是 error）', () => {
    const issues = validateTravelRoute(validRoute({ sources: [] }));
    assert.equal(hasField(warnsOf(issues), 'sources'), true);
    assert.equal(hasField(errorsOf(issues), 'sources'), false);
  });
});

describe('V16 L4 必须同时含 selfdrive 与 public', () => {
  it('正例：selfdrive + public 都在 → 不报错', () => {
    const r = validRoute({ layer: 'L4', tier: 'city', days: 2, modes: ['selfdrive', 'public'], primaryMode: 'selfdrive' });
    assert.equal(hasField(errorsOf(validateTravelRoute(r)), 'modes'), false);
  });

  it('反例：缺 public → error', () => {
    const r = validRoute({ layer: 'L4', tier: 'city', days: 2, modes: ['selfdrive'], primaryMode: 'selfdrive' });
    assert.equal(hasField(errorsOf(validateTravelRoute(r)), 'modes'), true);
  });

  it('反例：缺 selfdrive → error', () => {
    const r = validRoute({ layer: 'L4', tier: 'city', days: 2, modes: ['public'], primaryMode: 'public' });
    assert.equal(hasField(errorsOf(validateTravelRoute(r)), 'modes'), true);
  });

  it('非 L4 层不受该约束限制（L3 只含 public 也放行）', () => {
    const r = validRoute({ layer: 'L3', tier: 'city', days: 3, intro: { ...validRoute().intro, days: 3 }, plan: [planDay(1), planDay(2), planDay(3)], modes: ['public'], primaryMode: 'public', summary: '岛屿线路，步行即可完成。', shape: 'point' });
    assert.equal(hasField(errorsOf(validateTravelRoute(r)), 'modes'), false);
  });
});

describe('V17 anchorCity 应包含在 cities 内', () => {
  it('正例：anchorCity ∈ cities → 无 warn', () => {
    assert.equal(hasField(warnsOf(validateTravelRoute(validRoute())), 'anchorCity'), false);
  });

  it('反例：anchorCity 不在 cities → warn（不是 error）', () => {
    const issues = validateTravelRoute(validRoute({ cities: ['甲市', '乙市'], anchorCity: '丙市' }));
    assert.equal(hasField(warnsOf(issues), 'anchorCity'), true);
    assert.equal(hasField(errorsOf(issues), 'anchorCity'), false);
  });
});

describe('V19 分层天数上限（warn 级）', () => {
  const cases: { layer: TravelLayer; days: number; ok: boolean }[] = [
    { layer: 'L1', days: 15, ok: true }, // L1 只卡上限：阿里 15 天是合理形态
    { layer: 'L1', days: 16, ok: false },
    { layer: 'L2', days: 3, ok: true },
    { layer: 'L2', days: 7, ok: true },
    { layer: 'L2', days: 2, ok: false },
    { layer: 'L3', days: 2, ok: true },
    { layer: 'L3', days: 5, ok: true },
    { layer: 'L3', days: 6, ok: false }, // keketuohai-kanas-6d 曾踩的就是这条
    { layer: 'L4', days: 3, ok: true },
    { layer: 'L4', days: 4, ok: false },
    { layer: 'L5', days: 2, ok: true },
    { layer: 'L5', days: 6, ok: false },
  ];

  for (const c of cases) {
    it(`${c.layer} ${c.days} 天 → ${c.ok ? '放行' : 'warn'}`, () => {
      const r = validRoute({
        layer: c.layer,
        tier: c.layer === 'L1' ? 'national' : c.layer === 'L2' ? 'regional' : 'city',
        days: c.days,
        intro: { ...validRoute().intro, days: c.days },
        plan: Array.from({ length: c.days }, (_, i) => planDay(i + 1)),
      });
      assert.equal(hasField(warnsOf(validateTravelRoute(r)), 'days'), !c.ok);
    });
  }

  it('判据是 warn 级，不阻断（error 中不应出现 days 天数上限问题）', () => {
    const r = validRoute({
      layer: 'L3',
      tier: 'city',
      days: 6,
      intro: { ...validRoute().intro, days: 6 },
      plan: Array.from({ length: 6 }, (_, i) => planDay(i + 1)),
    });
    const issues = validateTravelRoute(r);
    assert.equal(hasField(warnsOf(issues), 'days'), true);
    assert.equal(
      hasField(errorsOf(issues), 'days'),
      false,
      `V19 不得判 error：${JSON.stringify(errorsOf(issues).filter((i) => i.field === 'days'))}`,
    );
  });

  it('layer 缺省时按 resolveLayer 推断结果判定', () => {
    // tier=national → 推断 L1，上限 15；16 天超出
    const r = validRoute({
      layer: undefined,
      tier: 'national',
      days: 16,
      intro: { ...validRoute().intro, days: 16 },
      plan: Array.from({ length: 16 }, (_, i) => planDay(i + 1)),
    });
    assert.equal(hasField(warnsOf(validateTravelRoute(r)), 'days'), true);
  });
});

/**
 * V20：景点坐标校验。
 *
 * 背景：判据长期只校验 `nodes[]` 的坐标，从不校验 `pois[]`，
 * 导致 22 个缺坐标的景点长期静默通过闸门，直到人工 review 才发现。
 * 这组用例锁住「缺坐标」与「坐标越界」两类问题，防止漏洞复发。
 */
describe('V20景点坐标校验', () => {
  /**
   * 替换第0 个 POI 的坐标字段。
   * 注意：必须显式写 `lng: undefined` 而不是靠对象展开去「删」——
   * `{...p, ...{}}` 会保留 p 原有的 lng，属性根本没被删掉，测试会假绿。
   */
  function withPoiCoord(over: Partial<TravelPoi>, extra: Partial<TravelRouteDetail> = {}): TravelRouteDetail {
    const base = validRoute();
    const pois = base.pois.map((p, i) => (i === 0 ? { ...p, ...over } : p)) as TravelPoi[];
    return { ...base, pois, ...extra };
  }

  function errorsOfPoi(issues: ValidationIssue[]) {
    return issues.filter((i) => i.level === 'error' && i.field === 'pois');
  }

  it('基线路线（全部 POI 带坐标）不报错', () => {
    assert.equal(errorsOfPoi(validateTravelRoute(validRoute())).length, 0);
  });

  it('缺 lng → error', () => {
    const r = withPoiCoord({ lng: undefined });
    const errs = errorsOfPoi(validateTravelRoute(r));
    assert.equal(errs.length, 1, `应为 error，实际：${JSON.stringify(errs)}`);
    assert.match(errs[0].message, /坐标非法或缺失/);
  });

  it('缺 lat → error', () => {
    const r = withPoiCoord({ lat: undefined });
    assert.equal(errorsOfPoi(validateTravelRoute(r)).length, 1);
  });

  it('lng 为 NaN → error（Number.isFinite 会拦住）', () => {
    const r = withPoiCoord({ lng: Number.NaN });
    assert.equal(errorsOfPoi(validateTravelRoute(r)).length, 1);
  });

  it('两个坐标都缺 → 只报一次，不重复刷屏', () => {
    const r = withPoiCoord({ lng: undefined, lat: undefined });
    assert.equal(errorsOfPoi(validateTravelRoute(r)).length, 1);
  });

  it('经度 0（明显是漏填而非真实坐标）→ error', () => {
    // 0 是合法 number，能通过 Number.isFinite；靠范围判据兜住
    const r = withPoiCoord({ lng: 0, lat: 0 });
    assert.ok(errorsOfPoi(validateTravelRoute(r)).length >= 1);
  });

  const OUT_OF_RANGE: Array<[string, number, number]> = [
    ['经度偏西', 60, 30],
    ['经度偏东', 150, 30],
    ['纬度偏南', 120, 0],
    ['纬度偏北', 120, 60],
  ];
  for (const [label, lng, lat] of OUT_OF_RANGE) {
    it(`${label} ${lng},${lat} → error`, () => {
      const r = withPoiCoord({ lng, lat });
      const errs = errorsOfPoi(validateTravelRoute(r));
      assert.ok(errs.length >= 1, `${label} 应报范围越界`);
    });
  }

  it('边界值 73 / 136 / 3 / 54 不判越界（中国陆地范围内）', () => {
    for (const [lng, lat] of [
      [73, 3],
      [136, 54],
      [120, 30],
    ]) {
      const r = withPoiCoord({ lng, lat });
      assert.equal(
        errorsOfPoi(validateTravelRoute(r)).length,
        0,
        `${lng},${lat} 在范围内不应报错`,
      );
    }
  });

  it('漠河北红村与乌苏里卡伦浅滩的真实坐标放行（回归保护）', () => {
    // 这两个是本轮实际补齐的存量数据，坐标来自公开地理资料
    for (const [lng, lat] of [
      [123.28, 53.55],
      [123.26, 53.56],
    ]) {
      const r = withPoiCoord({ lng, lat });
      assert.equal(errorsOfPoi(validateTravelRoute(r)).length, 0);
    }
  });
});

describe('layerText', () => {
  it('返回受影响层的中文标签', () => {
    for (const l of Object.keys(TRAVEL_LAYER_LABEL) as TravelLayer[]) {
      assert.equal(layerText(l), TRAVEL_LAYER_LABEL[l]);
    }
  });

  it('未知值原样返回', () => {
    assert.equal(layerText('L9'), 'L9');
    assert.equal(layerText(''), '');
  });
});
