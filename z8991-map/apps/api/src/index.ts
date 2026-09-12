import './loadEnv.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { stationsRoute } from './routes/stations.js';
import { trainsRoute } from './routes/trains.js';
import { presetsRoute } from './routes/presets.js';
import { railGeometryRoute } from './routes/railGeometry.js';
import { loadStationIndex } from './services/stationIndex.js';

const app = new Hono().basePath('/api');

const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(
  '*',
  cors({
    origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((s) => s.trim()),
  }),
);

const hits = new Map<string, { n: number; reset: number }>();
app.use('*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  let bucket = hits.get(ip);
  if (!bucket || now > bucket.reset) {
    bucket = { n: 0, reset: now + 60_000 };
    hits.set(ip, bucket);
  }
  bucket.n += 1;
  const path = c.req.path;
  const isRailJobPoll = c.req.method === 'GET' && path.includes('/rail-geometry/jobs/');
  const limit = path.includes('/rail-geometry') ? (isRailJobPoll ? 120 : 24) : 90;
  if (bucket.n > limit) {
    return c.json(
      { ok: false, error: { code: 'RATE_LIMIT', message: '请求过于频繁，请稍后再试' } },
      429,
    );
  }
  await next();
});

app.get('/health', (c) => c.json({ ok: true, data: { status: 'up' } }));
app.route('/stations', stationsRoute);
app.route('/trains', trainsRoute);
app.route('/presets', presetsRoute);
app.route('/rail-geometry', railGeometryRoute);

const port = Number(process.env.PORT || 3000);

await loadStationIndex();
const { loadLocalHsrRails } = await import('./services/localRails.js');
loadLocalHsrRails();
console.log(`[railvista-api] AMAP_KEY=${process.env.AMAP_KEY ? 'set' : 'missing'} listening on :${port}`);

serve({ fetch: app.fetch, port });

export default app;
