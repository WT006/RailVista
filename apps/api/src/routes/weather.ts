/**
 * 景点到达时刻天气
 *   POST /api/weather/spots  { spots: [{ spotId, lng, lat, atIso, visibility? }] }
 */
import { Hono } from 'hono';
import { querySpotWeathers, type SpotWeatherQuery } from '../services/qweather.js';

export const weatherRoute = new Hono();

weatherRoute.post('/spots', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: '无效 JSON' } }, 400);
  }
  const spotsRaw = (body as { spots?: unknown })?.spots;
  if (!Array.isArray(spotsRaw) || spotsRaw.length === 0) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'spots 不能为空' } }, 400);
  }
  if (spotsRaw.length > 40) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: '单次最多 40 个景点' } }, 400);
  }

  const spots: SpotWeatherQuery[] = [];
  for (const raw of spotsRaw) {
    const s = raw as Partial<SpotWeatherQuery>;
    if (!s || typeof s.spotId !== 'string') continue;
    const lng = Number(s.lng);
    const lat = Number(s.lat);
    const atIso = String(s.atIso || '');
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !atIso) continue;
    spots.push({
      spotId: s.spotId,
      lng,
      lat,
      atIso,
      visibility: typeof s.visibility === 'string' ? s.visibility : undefined,
    });
  }
  if (!spots.length) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: '无有效景点参数' } }, 400);
  }

  try {
    const data = await querySpotWeathers(spots);
    return c.json({ ok: true, data });
  } catch (e) {
    return c.json(
      {
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: (e as Error)?.message || '天气查询失败' },
      },
      502,
    );
  }
});

weatherRoute.get('/status', (c) => {
  const host = process.env.QWEATHER_API_HOST?.trim();
  const key = process.env.QWEATHER_API_KEY?.trim();
  return c.json({
    ok: true,
    data: {
      qweather: Boolean(host && key),
      provider: process.env.WEATHER_PROVIDER || 'auto',
    },
  });
});
