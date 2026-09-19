import { Hono } from 'hono';
import { trainSource } from '../services/cr12306.js';

export const trainsRoute = new Hono();

trainsRoute.get('/', async (c) => {
  const from = c.req.query('from') || '';
  const to = c.req.query('to') || '';
  const date = c.req.query('date') || '';
  if (!from || !to || !date) {
    return c.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: '请填写出发站、到达站和出发日期后再查询' } },
      400,
    );
  }
  try {
    const trains = await trainSource.searchTrains(from, to, date);
    return c.json({ ok: true, data: { trains } });
  } catch (e) {
    const err = e as Error & { code?: string };
    return c.json(
      {
        ok: false,
        error: {
          code: err.code || 'UPSTREAM_FAIL',
          message: err.message || '查询失败',
        },
      },
      502,
    );
  }
});

trainsRoute.get('/stops', async (c) => {
  const trainNo = c.req.query('trainNo') || '';
  const trainCode = c.req.query('trainCode') || '';
  const from = c.req.query('from') || '';
  const to = c.req.query('to') || '';
  const date = c.req.query('date') || '';
  if (!trainNo || !from || !to || !date) {
    return c.json(
      {
        ok: false,
        error: { code: 'BAD_REQUEST', message: '车次信息不完整，请重新选择车次后再试' },
      },
      400,
    );
  }
  try {
    const stops = await trainSource.getStops({ trainNo, trainCode, from, to, date });
    return c.json({ ok: true, data: { stops } });
  } catch (e) {
    const err = e as Error & { code?: string };
    return c.json(
      {
        ok: false,
        error: {
          code: err.code || 'UPSTREAM_FAIL',
          message: err.message || '经停查询失败',
        },
      },
      502,
    );
  }
});
