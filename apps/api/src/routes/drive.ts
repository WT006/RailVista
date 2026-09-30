/**
 * 万里路书 · 精品自驾公路 —— API 路由。
 *
 *   GET /api/drive/routes           线路列表（读 _index.json）
 *   GET /api/drive/routes/:id       线路详情（含 geometry + chapters + alerts + highlights）
 *   GET /api/drive/stats            全库统计
 */
import { Hono } from 'hono';
import {
  getDriveHighlights,
  getDriveIndex,
  getDriveRoute,
  driveStats,
} from '../services/driveRoutes.js';

export const driveRoute = new Hono();

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
