/**
 * 万里路书 · 路书库 —— HTTP 路由。
 *
 * 端点（全部挂在 /api/travel 下）：
 *   GET /overview          区划 + 统计 + 源文件清单（列表页一次拿齐）
 *   GET /regions           省 → 地级行政区底座（含 coverage / routeIds 回写）
 *   GET /facets            筛选面板分面值（每项带路线数）
 *   GET /routes            列表：省 / 市 / 玩法 / 内容分层 / 关键词 / 月份 / 难度 / 天数 / 里程 / 排序
 *   GET /route/:id         单条详情（道路分段 · 逐日行程 · 景点介绍）
 *   GET /by-road/:ref      按公路编号反查路线（G318 有哪些玩法）
 *
 * 筛选逻辑全部下沉到 packages/shared/travelbook，这里只做参数收集与类型转换，
 * 保证 Web 与未来鸿蒙端用的是同一份 matchTravelRoute / queryTravelRoutes。
 */
import { Hono } from 'hono';
import { TRAVEL_LAYERS } from '@railvista/shared';
import {
  getTravelFacets,
  getTravelOverview,
  getTravelRegions,
  getTravelRoute,
  getRoutesByRoadRef,
  invalidateTravelCache,
  listTravelRoutes,
  type TravelQuery,
} from '../services/travelRoutes.js';

export const travelRoute = new Hono();

const NOT_FOUND = (c: any, id: string) =>
  c.json({ ok: false, error: { code: 'NOT_FOUND', message: `路书不在库：${id}` } }, 404);

function toInt(raw: string | undefined, fallback: number | undefined): number | undefined {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toNum(raw: string | undefined, fallback: number | undefined): number | undefined {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const MODES = ['selfdrive', 'charter', 'public', 'cycling', 'hiking', 'mixed'] as const;
const SHAPES = ['loop', 'point', 'outback', 'corridor'] as const;
const TIERS = ['national', 'regional', 'city'] as const;
/** 内容分层白名单直接取自 shared，避免两边漂移 */
const LAYERS = TRAVEL_LAYERS;
const SORTS = ['recommend', 'km-desc', 'km-asc', 'days-asc', 'days-desc', 'layer'] as const;

/** 从 query string 收集 TravelQuery。非法值一律忽略而不是报错（列表页容错优先）。 */
function readQuery(c: any): TravelQuery {
  const q: TravelQuery = {};
  const province = c.req.query('province');
  if (province) q.province = province;
  const city = c.req.query('city');
  if (city) q.city = city;

  const mode = c.req.query('mode');
  if (mode && (MODES as readonly string[]).includes(mode)) {
    q.mode = mode as TravelQuery['mode'];
  }

  const kw = c.req.query('q') ?? c.req.query('keyword');
  if (kw) q.q = kw;

  const month = toInt(c.req.query('month'), undefined);
  if (month !== undefined && month >= 1 && month <= 12) q.month = month;

  const md = toInt(c.req.query('maxDifficulty'), undefined);
  if (md !== undefined && md >= 1 && md <= 5) q.maxDifficulty = md;

  const mDays = toInt(c.req.query('maxDays'), undefined);
  if (mDays !== undefined && mDays > 0) q.maxDays = mDays;

  const mKm = toNum(c.req.query('maxKm'), undefined);
  if (mKm !== undefined && mKm > 0) q.maxKm = mKm;

  const shape = c.req.query('shape');
  if (shape && (SHAPES as readonly string[]).includes(shape)) {
    q.shape = shape as TravelQuery['shape'];
  }

  const tier = c.req.query('tier');
  if (tier && (TIERS as readonly string[]).includes(tier)) {
    q.tier = tier as TravelQuery['tier'];
  }

  const layer = c.req.query('layer');
  if (layer && (LAYERS as readonly string[]).includes(layer)) {
    q.layer = layer as TravelQuery['layer'];
  }

  const sort = c.req.query('sort');
  if (sort && (SORTS as readonly string[]).includes(sort)) {
    q.sort = sort as TravelQuery['sort'];
  }

  const limit = toInt(c.req.query('limit'), undefined);
  if (limit !== undefined && limit > 0) q.limit = Math.min(200, limit);
  const offset = toInt(c.req.query('offset'), undefined);
  if (offset !== undefined && offset >= 0) q.offset = offset;

  return q;
}

// ── 列表页一次拿齐：区划 + 统计 + 源文件清单 ────────────────────────────────
travelRoute.get('/overview', (c) => {
  return c.json({ ok: true, data: getTravelOverview() });
});

// ── 区划底座 ────────────────────────────────────────────────────────────────
travelRoute.get('/regions', (c) => {
  return c.json({ ok: true, data: getTravelRegions() });
});

// ── 筛选面板分面值 ──────────────────────────────────────────────────────────
travelRoute.get('/facets', (c) => {
  return c.json({ ok: true, data: getTravelFacets() });
});

// ── 列表 ────────────────────────────────────────────────────────────────────
travelRoute.get('/routes', (c) => {
  const result = listTravelRoutes(readQuery(c));
  return c.json({ ok: true, data: result });
});

// ── 按公路编号反查玩法 ──────────────────────────────────────────────────────
travelRoute.get('/by-road/:ref', (c) => {
  const ref = decodeURIComponent(c.req.param('ref'));
  const routes = getRoutesByRoadRef(ref);
  return c.json({
    ok: true,
    data: {
      ref: ref.trim().toUpperCase(),
      total: routes.length,
      routes,
      // 诚实：零命中不等于编号错，可能是这条路还没写玩法
      note: routes.length ? undefined : `该编号暂无关联路书，可能尚未收录玩法。`,
    },
  });
});

// ── 详情 ────────────────────────────────────────────────────────────────────
travelRoute.get('/route/:id', (c) => {
  const id = decodeURIComponent(c.req.param('id'));
  const detail = getTravelRoute(id);
  if (!detail) return NOT_FOUND(c, id);
  return c.json({ ok: true, data: detail });
});

// ── 开发辅助：数据热更新 ────────────────────────────────────────────────────
travelRoute.post('/reload', (c) => {
  invalidateTravelCache();
  return c.json({ ok: true, data: { totalRoutes: getTravelOverview().totalRoutes } });
});
