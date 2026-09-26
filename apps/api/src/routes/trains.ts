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
  const startedAt = Date.now();
  try {
    const trains = await trainSource.searchTrains(from, to, date);
    return c.json({ ok: true, data: { trains, meta: { elapsedMs: Date.now() - startedAt } } });
  } catch (e) {
    const err = e as Error & { code?: string };
    return c.json(
      {
        ok: false,
        error: {
          code: err.code || 'UPSTREAM_FAIL',
          message: err.message || '查询失败',
        },
        meta: { elapsedMs: Date.now() - startedAt },
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
  const startedAt = Date.now();
  try {
    const stops = await trainSource.getStops({ trainNo, trainCode, from, to, date });
    // coordPending：本次响应里仍缺坐标的站（后台还在补），前端可据此提示
    const coordPending = stops.filter(
      (s) => s.lng == null || s.lat == null || !Number.isFinite(Number(s.lng)),
    ).length;
    return c.json({
      ok: true,
      data: { stops, meta: { elapsedMs: Date.now() - startedAt, coordPending } },
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    return c.json(
      {
        ok: false,
        error: {
          code: err.code || 'UPSTREAM_FAIL',
          message: err.message || '经停查询失败',
        },
        meta: { elapsedMs: Date.now() - startedAt },
      },
      502,
    );
  }
});

/** 手动补齐坐标：等远程补点完成后再返回（「重新发车」用） */
trainsRoute.get('/stops/enrich', async (c) => {
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
  const startedAt = Date.now();
  try {
    const stops = await trainSource.enrichStopsNow({ trainNo, trainCode, from, to, date });
    const coordPending = stops.filter(
      (s) => s.lng == null || s.lat == null || !Number.isFinite(Number(s.lng)),
    ).length;
    return c.json({
      ok: true,
      data: { stops, meta: { elapsedMs: Date.now() - startedAt, coordPending } },
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    return c.json(
      {
        ok: false,
        error: {
          code: err.code || 'UPSTREAM_FAIL',
          message: err.message || '坐标补齐失败',
        },
        meta: { elapsedMs: Date.now() - startedAt },
      },
      502,
    );
  }
});
