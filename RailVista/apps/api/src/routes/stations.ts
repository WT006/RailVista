import { Hono } from 'hono';
import { suggestStations } from '../services/stationIndex.js';

export const stationsRoute = new Hono();

stationsRoute.get('/suggest', (c) => {
  const q = c.req.query('q') || '';
  const list = suggestStations(q, 20).map((s) => ({
    name: s.name,
    telecode: s.telecode,
    city: s.city,
  }));
  return c.json({ ok: true, data: { stations: list } });
});
