/**
 * 天象观景 · 逐时气象采样
 *   POST /api/sky/met  { points: [{ pointId, lng, lat, atIso }] }
 */
import { Hono } from 'hono';
import { querySkyMet, type SkyMetQuery } from '../services/skyMet.js';

export const skyRoute = new Hono();

skyRoute.post('/met', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: '无效 JSON' } }, 400);
  }
  const pointsRaw = (body as { points?: unknown })?.points;
  if (!Array.isArray(pointsRaw) || pointsRaw.length === 0) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'points 不能为空' } }, 400);
  }
  if (pointsRaw.length > 80) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: '单次最多 80 个点' } }, 400);
  }

  const points: SkyMetQuery[] = [];
  for (const raw of pointsRaw) {
    const p = raw as Partial<SkyMetQuery>;
    if (!p || typeof p.pointId !== 'string') continue;
    const lng = Number(p.lng);
    const lat = Number(p.lat);
    const atIso = String(p.atIso || '');
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !atIso) continue;
    points.push({ pointId: p.pointId, lng, lat, atIso });
  }
  if (!points.length) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: '无有效点位参数' } }, 400);
  }

  try {
    const data = await querySkyMet(points);
    return c.json({ ok: true, data });
  } catch (e) {
    return c.json(
      {
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: (e as Error)?.message || '气象查询失败' },
      },
      502,
    );
  }
});

skyRoute.get('/status', (c) =>
  c.json({ ok: true, data: { source: 'open-meteo', ready: true } }),
);
