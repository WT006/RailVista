import { Hono } from 'hono';
import { lookupFlight, searchFlightsByRoute } from '../services/flightLookup.js';

export const flightsRoute = new Hono();

/**
 * GET /flights/lookup?flightNo=CZ3467&date=2026-10-07
 * 按航班号 + 日期查询：FlyClaw query → 本地兜底。
 */
flightsRoute.get('/lookup', async (c) => {
  const flightNo = (c.req.query('flightNo') ?? '').trim();
  const date = (c.req.query('date') ?? '').trim();
  const from = (c.req.query('from') ?? '').trim() || undefined;
  const to = (c.req.query('to') ?? '').trim() || undefined;
  if (!flightNo || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json(
      {
        ok: false,
        error: { code: 'BAD_REQUEST', message: '需要 flightNo 与 date(YYYY-MM-DD) 参数' },
      },
      400,
    );
  }
  const data = await lookupFlight(flightNo, date, from, to);
  return c.json({ ok: true, data });
});

/**
 * GET /flights/search?from=PEK&to=SHA&date=2026-10-15
 * 按航线搜索：FlyClaw search（飞猪等），返回列表含价格。
 */
flightsRoute.get('/search', async (c) => {
  const from = (c.req.query('from') ?? '').trim();
  const to = (c.req.query('to') ?? '').trim();
  const date = (c.req.query('date') ?? '').trim();
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json(
      {
        ok: false,
        error: { code: 'BAD_REQUEST', message: '需要 from、to 与 date(YYYY-MM-DD) 参数' },
      },
      400,
    );
  }
  const data = await searchFlightsByRoute(from, to, date);
  return c.json({ ok: true, data });
});
