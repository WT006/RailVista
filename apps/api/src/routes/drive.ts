/**
 * 万里路书 · 全国公路旅游网 —— API 路由（PRD §5.5 + v0.3.0 保留端点）。
 *
 *   GET /api/drive/suggest?q=&kind=&limit=      搜索（四类索引 + geocode 兜底）
 *   GET /api/drive/road/:key                    单条公路（L1 几何 + 统计）
 *   GET /api/drive/route?from=&to=&via=&engine= 双引擎 OD 规划
 *   GET /api/drive/along?from=&to= | road= | route=   沿程：折线 + 景点 + 章节
 *   GET /api/drive/network/stats                路网覆盖统计（含诚实说明）
 *   GET /api/drive/network/overview             地图公路图层（抽稀折线）
 *   GET /api/drive/board                        榜单列表
 *   GET /api/drive/board/:boardId               单个榜单（含 alsoIn 交叉索引）
 *   ── v0.3.0 路书层保留 ──
 *   GET /api/drive/routes | /routes/:id | /stats
 */
import { Hono } from 'hono';
import {
  getDriveHighlights,
  getDriveIndex,
  getDriveRoute,
  driveStats,
} from '../services/driveRoutes.js';
import {
  decimatePoints,
  decimatePointsWithIndex,
  getRoadEntry,
  getRoadGeometryFull,
  isValidRoadKey,
  networkStats,
  officialLengthKm,
  roadNetworkOverview,
} from '../services/roadNetwork.js';
import { geocodeFallback, suggestPlaces } from '../services/roadIndex.js';
import { buildChapters, matchSpotsAlong, roadsideSpotsMeta } from '../services/roadsideSpots.js';
import { PlaceNotFoundError, planDriveRoute, planRoadRoute } from '../services/roadRouting.js';
import { boardsAlsoIn, getBoard, itemHasGeometry, listBoards } from '../services/driveBoards.js';
import { loadRoadTopology, roadTopologyInfo } from '../services/roadTopology.js';
import { computeCumKm } from '@railvista/shared';
import type { AlongSpot, PlaceKind, RankingBoard, RankingItem, RoadRoute } from '@railvista/shared';

export const driveRoute = new Hono();

function badRequest(c: any, message: string) {
  return c.json({ ok: false, error: { code: 'BAD_REQUEST', message } }, 400);
}

// ── 搜索（PRD §4） ───────────────────────────────────────────────────────────
driveRoute.get('/suggest', async (c) => {
  const q = c.req.query('q') ?? '';
  const kindRaw = c.req.query('kind');
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 20));
  const kind = ['place', 'road', 'spot', 'facility'].includes(kindRaw ?? '')
    ? (kindRaw as PlaceKind)
    : undefined;
  let hits = suggestPlaces(q, kind, limit);
  // 降级链：本地未命中 → 高德 → Nominatim（PRD §4.3；place 语义才兜底）
  if (!hits.length && q.trim().length >= 2 && (!kind || kind === 'place')) {
    const remote = await geocodeFallback(q.trim());
    if (remote) hits = [remote];
  }
  return c.json({ ok: true, data: { q, kind: kind ?? null, hits } });
});

// ── 单条公路（PRD §2.3 DriveRoad 页数据源） ─────────────────────────────────
driveRoute.get('/road/:key', (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  if (!isValidRoadKey(key)) return badRequest(c, `非法公路主键：${key}`);
  const entry = getRoadEntry(key);
  if (!entry) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `公路不在册：${key}` } }, 404);
  }
  const geom = getRoadGeometryFull(key);
  if (!geom) {
    // 诚实返回：索引在册但几何待补（PRD §3.1 不能装作什么都有）
    return c.json({
      ok: true,
      data: {
        entry,
        geometry: null,
        note: `该编号几何待抓取（node scripts/fetch-road-geometry.mjs --ref ${entry.ref}）`,
      },
    });
  }
  // 传输抽稀：默认 ≤600 点；?full=1 返回原始几何（含逐点 cumKm）
  const full = c.req.query('full') === '1';
  const points = full ? geom.points : decimatePoints(geom.points, 600);
  // 分量数量可能上百（G318 实测 114 段），每段抽稀到 200 点即可满足画线；
  // full=1 时回全量（供导出/调试）。
  const segments = full
    ? geom.segments
    : geom.segments.map((seg) => decimatePoints(seg, 200));
  // v0.6.0：用去重后里程（totalKm），主链长度不等于全线里程
  const totalKm =
    Number.isFinite((geom as { totalKm?: number }).totalKm)
      ? ((geom as { totalKm?: number }).totalKm as number)
      : (geom.cumKm[geom.cumKm.length - 1] ?? entry.lengthKm);
  // B2-1：如实带出「已贯通里程 vs 官方里程」与端点可信度。
  // 注意：entry.lengthKm 对有几何的公路已被 mergeGeometry 覆盖为几何长度，
  // 必须用权威名录的 officialLengthKm，否则覆盖率恒为 100%。
  const connectedKm = Math.round(totalKm * 10) / 10;
  const nominalKm = officialLengthKm(key) || entry.lengthKm;
  const coveragePct = nominalKm > 0 ? Math.round((connectedKm / nominalKm) * 100) : null;
  return c.json({
    ok: true,
    data: {
      entry,
      geometry: { key: geom.key, points, nodes: geom.nodes, simplified: geom.simplified },
      totalKm: connectedKm,
      spotCount: entry.spotCount,
      segments,
      gapAnnotations: geom.gapAnnotations,
      segmentCount: geom.segmentCount,
      gapCount: geom.gapCount,
      // v0.6.0：精度分级 / 连通分量数 / 缝合断档数（供页面如实标注）
      precision: (geom as { precision?: string }).precision ?? null,
      componentCount: (geom as { componentCount?: number }).componentCount ?? geom.segmentCount,
      stitchedGaps: (geom as { stitchedGaps?: number }).stitchedGaps ?? 0,
      officialKm: (geom as { officialKm?: number | null }).officialKm ?? null,
      endpointsUnverified: geom.endpointsUnverified ?? false,
      lengthDeviation: geom.lengthDeviation ?? null,
      connectedKm,
      nominalKm,
      coveragePct,
    },
  });
});

// ── OD 规划（PRD §5.1 双引擎） ──────────────────────────────────────────────
driveRoute.get('/route', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const via = (c.req.query('via') ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  const engine = c.req.query('engine') === 'local' ? 'local' : 'auto';
  if (!from || !to) return badRequest(c, '缺少 from / to 参数');
  try {
    const route = await planDriveRoute({ from, to, via, engine });
    return c.json({ ok: true, data: { route } });
  } catch (e) {
    if (e instanceof PlaceNotFoundError) {
      return c.json({ ok: false, error: { code: e.code, message: e.message, field: e.field } }, 404);
    }
    throw e;
  }
});

// ── 沿程：一次返回折线 + 景点 + 章节（核心端点，PRD §5.5） ───────────────────
driveRoute.get('/along', async (c) => {
  const roadKey = c.req.query('road');
  const routeId = c.req.query('route');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const cat = (c.req.query('cat') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const min = Number(c.req.query('min'));
  const max = Number(c.req.query('max'));
  const buffer = Number(c.req.query('buffer'));

  let route: RoadRoute | null = null;
  let legacyHighlights: unknown;
  let legacyChapters: unknown;

  if (roadKey) {
    // C2 整条公路
    if (!isValidRoadKey(roadKey)) return badRequest(c, `非法公路主键：${roadKey}`);
    route = planRoadRoute(roadKey);
    if (!route) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `公路不在册或几何待补：${roadKey}` } }, 404);
    }
    route.engine = 'road-geometry';
    // B2-1：不要笼统宣称「整条公路」。实测主链常只是 OSM 抓取时碰巧串起来的一条链，
    // 与该公路真实走向无关；这里如实展示已贯通里程占官方里程的比例。
    const entry = getRoadEntry(roadKey);
    const nominalKm = roadKey ? officialLengthKm(roadKey) || entry?.lengthKm || 0 : 0;
    const connectedKm = Math.round(route.lengthKm * 10) / 10;
    const pct = nominalKm > 0 ? Math.round((connectedKm / nominalKm) * 100) : null;
    const segNote = route.segments?.length ? `，另有 ${route.segments.length} 段未贯通` : '';
    route.engineNote =
      `OSM 众包还原：已贯通 ${connectedKm} km` +
      (pct !== null ? ` / 官方里程 ${nominalKm} km（${pct}%）` : '') +
      segNote +
      '，非官方线位，不作为导航依据';
  } else if (routeId) {
    // 榜单 / 路书条目（v1 DriveRoute 打样数据）
    const legacy = getDriveRoute(routeId);
    if (!legacy) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `路线不存在：${routeId}` } }, 404);
    }
    const coords = legacy.geometry.map((p) => [p[0], p[1]] as [number, number, number?]);
    route = {
      id: `legacy-${legacy.id}`,
      name: legacy.name,
      roadKeys: legacy.roadRefs,
      provinces: legacy.provinces,
      lengthKm: legacy.totalKm,
      coords,
      chapters: legacy.chapters.map((ch) => ({ title: ch.title, fromKm: ch.fromKm, toKm: ch.toKm })),
      engine: 'roadbook',
      engineNote: '精品线路书预置数据（v1 打样）',
    };
    legacyHighlights = getDriveHighlights(routeId);
    legacyChapters = legacy.chapters;
  } else if (from && to) {
    // C1 点对点
    try {
      route = await planDriveRoute({ from, to, engine: c.req.query('engine') === 'local' ? 'local' : 'auto' });
    } catch (e) {
      if (e instanceof PlaceNotFoundError) {
        return c.json({ ok: false, error: { code: e.code, message: e.message, field: e.field } }, 404);
      }
      throw e;
    }
  } else {
    return badRequest(c, '缺少参数：from+to（点对点）/ road=编号（整条公路）/ route=路线ID（路书）');
  }

  // B3-2：先抽稀再匹配。原先在未抽稀的全量折线上跑匹配（抽稀在响应组装时），
  // G318 4673 点实测 124ms；抽到 600 点后匹配量降一个数量级。
  // 抽稀对沿程匹配的影响可接受：600 点仍能保持道路走向的空间连续性。
  //
  // v0.6.5（P0-1）：抽稀的同时按**同一下标**切片 route.cumKm。
  // 抽稀会切掉弯道、缩短折线（G318 3669→600 点后重算里程缩水 117.8km / 7.2%），
  // 若前端在降采样链上重算里程，末段（1518.6~1568.8km）会落在重算链之外 →
  // 分段折线遍历不到任何点 → d="" → 地图上「点了没反应」。
  // 因此里程必须由服务端在全分辨率链上算好后随坐标下发。
  const decimated = decimatePointsWithIndex(route.coords as [number, number, number?][], 600);
  const matchCoords = decimated.points;
  const matchCumKm = route.cumKm
    ? decimated.indices.map((i) => route.cumKm![i]!)
    : undefined;
  const alongOpts = {
    categories: cat.length ? cat : undefined,
    minScore: Number.isFinite(min) ? min : undefined,
    maxCount: Number.isFinite(max) && max > 0 ? Math.min(max, 500) : 200,
    bufferKm: Number.isFinite(buffer) && buffer > 0 ? buffer : undefined,
  };

  // v0.6.0：整条公路在 OSM 中常由多个连通分量组成（城区 ref 断档）。
  // 沿程景点必须覆盖**全部分量**，否则「G318 沿线景点」只找得到最长那一段。
  // 做法：逐分量匹配 + 里程偏移累加；跨分量重复命中的点位按"离路更近"去重。
  let spots: AlongSpot[];
  const extraChains = (route.segments ?? []).filter((c) => Array.isArray(c) && c.length >= 2);
  if (route.engine === 'road-geometry' && extraChains.length) {
    const chains: [number, number, number?][][] = [matchCoords, ...extraChains.map((c) => c as [number, number, number?][])];
    const merged: AlongSpot[] = [];
    const bestById = new Map<string, number>();
    let offsetKm = 0;
    for (const chain of chains) {
      const part = matchSpotsAlong(decimatePoints(chain, 400), alongOpts);
      for (const sp of part) {
        const shifted = { ...sp, progressKm: Math.round((sp.progressKm + offsetKm) * 10) / 10 };
        const prev = bestById.get(sp.id);
        if (prev === undefined) {
          bestById.set(sp.id, merged.length);
          merged.push(shifted);
        } else if (shifted.distKm < merged[prev]!.distKm) {
          merged[prev] = shifted;
        }
      }
      const cum = computeCumKm(chain as [number, number][]);
      offsetKm += cum[cum.length - 1] ?? 0;
    }
    merged.sort((a, b) => a.progressKm - b.progressKm);
    const cap = alongOpts.maxCount ?? 200;
    spots = merged.slice(0, cap);
  } else {
    spots = matchSpotsAlong(matchCoords, alongOpts);
  }

  return c.json({
    ok: true,
    data: {
      route: {
        ...route,
        coords: matchCoords,
        // 与 coords 同源同长度；缺失时省略，前端会退回 haversine 兜底并降级提示
        ...(matchCumKm ? { cumKm: matchCumKm } : {}),
      },
      spots,
      chapters: route.chapters ?? buildChapters(matchCoords, route.lengthKm),
      highlights: legacyHighlights,
      legacyChapters,
      spotLibrary: roadsideSpotsMeta(),
    },
  });
});

// ── 路网统计与图层（PRD §3.1 诚实边界 + 验收 #6） ────────────────────────────
driveRoute.get('/network/stats', (c) => {
  const meta = roadsideSpotsMeta();
  loadRoadTopology(); // 确保拓扑已尝试加载（懒加载，~11ms）
  return c.json({
    ok: true,
    data: { ...networkStats(meta.count), topology: roadTopologyInfo() },
  });
});

driveRoute.get('/network/overview', (c) => {
  // v0.6.0：默认只回干线（高速+国道）；?classes= 放宽等级，?limit= 控制条数，?points= 控制抽稀点数
  const raw = (c.req.query('classes') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const allowed = ['expressway', 'national', 'provincial', 'county', 'township', 'village'] as const;
  const classes = raw.filter((s): s is (typeof allowed)[number] => (allowed as readonly string[]).includes(s));
  const limit = Number(c.req.query('limit')) || undefined;
  const points = Number(c.req.query('points')) || undefined;
  return c.json({ ok: true, data: roadNetworkOverview({ classes, limit, maxPoints: points }) });
});

// ── 榜单（PRD §7） ──────────────────────────────────────────────────────────
driveRoute.get('/board', (c) => {
  return c.json({ ok: true, data: listBoards() });
});

driveRoute.get('/board/:boardId', (c) => {
  const boardId = c.req.param('boardId');
  const board = getBoard(boardId);
  if (!board) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `榜单不存在：${boardId}` } }, 404);
  }
  // 补齐 alsoIn 交叉索引 + 几何可用性（决定条目走 C2 还是 C1 兜底）
  const items: RankingItem[] = board.items.map((item) => ({
    ...item,
    alsoIn: [
      ...new Set(item.roadKeys.flatMap((k) => boardsAlsoIn(k)).filter((id) => id !== board.id)),
    ],
  }));
  const enriched: RankingBoard = { ...board, items };
  return c.json({ ok: true, data: { board: enriched, geomAvailable: items.map(itemHasGeometry) } });
});

// ── v0.3.0 路书层保留（PRD §8：降级保留，不删） ─────────────────────────────
driveRoute.get('/routes', (c) => {
  const idx = getDriveIndex();
  return c.json({ ok: true, data: { routes: idx.routes, updated: idx.updated } });
});

driveRoute.get('/routes/:id', (c) => {
  const id = c.req.param('id');
  const route = getDriveRoute(id);
  if (!route) {
    return c.json(
      { ok: false, error: { code: 'NOT_FOUND', message: `自驾线路不存在：${id}` } },
      404,
    );
  }
  const highlights = getDriveHighlights(id);
  return c.json({ ok: true, data: { route, highlights } });
});

driveRoute.get('/stats', (c) => c.json({ ok: true, data: driveStats() }));
