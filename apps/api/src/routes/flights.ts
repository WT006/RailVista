import { Hono } from 'hono';
import { lookupFlight } from '../services/flightLookup.js';

export const flightsRoute = new Hono();

/**
 * GET /flights/lookup?flightNo=CZ3467&date=2026-10-07
 * 按航班号 + 日期查询航班（在线服务可用时自动带出起降机场、时刻、登机口；
 * 否则返回本地确定信息，由前端补选）。
 */
flightsRoute.get('/lookup', async (c) => {
  const flightNo = (c.req.query('flightNo') ?? '').trim();
  const date = (c.req.query('date') ?? '').trim();
  if (!flightNo || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json(
      {
        ok: false,
        error: { code: 'BAD_REQUEST', message: '需要 flightNo 与 date(YYYY-MM-DD) 参数' },
      },
      400,
    );
  }
  const data = await lookupFlight(flightNo, date);
  return c.json({ ok: true, data });
});
