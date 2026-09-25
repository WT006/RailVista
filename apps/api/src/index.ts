import './loadEnv.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { stationsRoute } from './routes/stations.js';
import { trainsRoute } from './routes/trains.js';
import { presetsRoute } from './routes/presets.js';
import { railGeometryRoute } from './routes/railGeometry.js';
import { loadStationIndex } from './services/stationIndex.js';
import { trustedClientIp } from './lib/clientIdentity.js';
import { buildVersionFingerprint, type VersionFingerprint } from './services/versionFingerprint.js';
import { ensureSingleInstance } from './services/singleInstance.js';

const app = new Hono().basePath('/api');

const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(
  '*',
  cors({
    origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((s) => s.trim()),
    allowHeaders: ['Content-Type', 'Accept', 'X-Client-Id', 'X-Railvista-Client-Id'],
  }),
);

type Bucket = { n: number; reset: number };
/** 限流分桶：通用 / 精确任务轮询 分开，避免同 IP 多人轮询挤爆搜车 */
const hitsGeneral = new Map<string, Bucket>();
const hitsRailPoll = new Map<string, Bucket>();

function takeHit(map: Map<string, Bucket>, key: string, now: number): number {
  let bucket = map.get(key);
  if (!bucket || now > bucket.reset) {
    bucket = { n: 0, reset: now + 60_000 };
    map.set(key, bucket);
  }
  bucket.n += 1;
  return bucket.n;
}

function pruneHits(map: Map<string, Bucket>, now: number) {
  if (map.size < 2_000) return;
  for (const [k, v] of map) {
    if (now > v.reset) map.delete(k);
  }
}

app.use('*', async (c, next) => {
  const ip = trustedClientIp((n) => c.req.header(n));
  const now = Date.now();
  const path = c.req.path;
  const isRailJobPoll = c.req.method === 'GET' && path.includes('/rail-geometry/jobs/');
  const isRailMutate = path.includes('/rail-geometry') && !isRailJobPoll;

  pruneHits(hitsGeneral, now);
  pruneHits(hitsRailPoll, now);

  if (isRailJobPoll) {
    // 1.5s 轮询 ≈ 40/min；多人同出口放宽
    if (takeHit(hitsRailPoll, ip, now) > 180) {
      return c.json(
        { ok: false, error: { code: 'RATE_LIMIT', message: '请求过于频繁，请稍后再试' } },
        429,
      );
    }
  } else {
    const limit = isRailMutate ? 36 : 120;
    if (takeHit(hitsGeneral, ip, now) > limit) {
      return c.json(
        { ok: false, error: { code: 'RATE_LIMIT', message: '请求过于频繁，请稍后再试' } },
        429,
      );
    }
  }
  await next();
});

const versionFingerprint: VersionFingerprint = buildVersionFingerprint();

function autoUpgradeFlag(): boolean {
  const v = String(process.env.RAIL_AUTO_UPGRADE ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

app.get('/health', (c) =>
  c.json({
    ok: true,
    data: {
      status: 'up',
      version: versionFingerprint,
      features: { autoUpgrade: autoUpgradeFlag() },
    },
  }),
);
app.route('/stations', stationsRoute);
app.route('/trains', trainsRoute);
app.route('/presets', presetsRoute);
app.route('/rail-geometry', railGeometryRoute);

const port = Number(process.env.PORT || 3000);

await ensureSingleInstance(port);

await loadStationIndex();
const { loadLocalHsrRails } = await import('./services/localRails.js');
loadLocalHsrRails();
console.log(`[railvista-api] AMAP_KEY=${process.env.AMAP_KEY ? 'set' : 'missing'} listening on :${port}`);

serve({ fetch: app.fetch, port });

export default app;
