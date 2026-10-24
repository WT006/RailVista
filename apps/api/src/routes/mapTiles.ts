/**
 * 天地图 WMTS 瓦片反代 + 磁盘缓存。
 *
 * 浏览器 → GET /api/map-tiles/{layer}/{z}/{y}/{x}
 *         →（命中缓存）直接回 PNG
 *         →（未命中）上游 t{0-7}.tianditu.gov.cn 再落盘
 *
 * Key 仅在服务端 `TIANDITU_TK`；按需访问产生的缓存，不批量预扒。
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';

export const mapTilesRoute = new Hono();

const LAYERS = new Set(['vec', 'cva', 'img', 'cia']);
const MAX_Z = 18;
const UPSTREAM_HOSTS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_DIR = join(__dirname, '../../.cache/tianditu-tiles');

function cacheDir(): string {
  const fromEnv = process.env.TIANDITU_TILE_CACHE_DIR?.trim();
  return fromEnv || DEFAULT_CACHE_DIR;
}

function cacheTtlMs(): number {
  const sec = Number(process.env.TIANDITU_TILE_CACHE_TTL_SEC || 60 * 60 * 24 * 14);
  return (Number.isFinite(sec) && sec > 0 ? sec : 60 * 60 * 24 * 14) * 1000;
}

function requireTk(): string {
  const tk = (process.env.TIANDITU_TK || process.env.VITE_TIANDITU_TK || '').trim();
  if (!tk) {
    throw new Error('未配置 TIANDITU_TK（apps/api/.env）');
  }
  return tk;
}

function parseCoord(raw: string, name: string): number | null {
  if (!/^\d{1,8}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  if (name === 'z' && n > MAX_Z) return null;
  return n;
}

function tilePath(layer: string, z: number, y: number, x: number): string {
  return join(cacheDir(), layer, String(z), String(y), `${x}.png`);
}

function upstreamUrl(layer: string, z: number, y: number, x: number, tk: string): string {
  const host = UPSTREAM_HOSTS[(z + y + x) % UPSTREAM_HOSTS.length]!;
  return (
    `https://t${host}.tianditu.gov.cn/${layer}_w/wmts` +
    `?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default` +
    `&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}` +
    `&tk=${encodeURIComponent(tk)}`
  );
}

async function readFreshCache(file: string): Promise<Buffer | null> {
  try {
    const st = await stat(file);
    if (Date.now() - st.mtimeMs > cacheTtlMs()) return null;
    return await readFile(file);
  } catch {
    return null;
  }
}

async function writeCache(file: string, body: Buffer): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${createHash('sha1').update(String(Date.now()) + Math.random()).digest('hex').slice(0, 8)}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, file);
  } catch {
    try {
      await unlink(`${file}.tmp`);
    } catch {
      /* ignore */
    }
  }
}

async function fetchUpstream(layer: string, z: number, y: number, x: number): Promise<{ body: Buffer; contentType: string }> {
  const tk = requireTk();
  const url = upstreamUrl(layer, z, y, x, tk);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RailVistaTileProxy/1.0)',
      Referer: 'https://map.tianditu.gov.cn/',
      Accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const err = new Error(`上游瓦片 ${res.status}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 32) {
    throw new Error('上游瓦片过小，可能无效');
  }
  const contentType = res.headers.get('content-type') || 'image/png';
  return { body: buf, contentType };
}

mapTilesRoute.get('/:layer/:z/:y/:x', async (c) => {
  const layer = String(c.req.param('layer') || '').toLowerCase();
  if (!LAYERS.has(layer)) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'layer 须为 vec|cva|img|cia' } }, 400);
  }
  const z = parseCoord(c.req.param('z') || '', 'z');
  const y = parseCoord(c.req.param('y') || '', 'y');
  const x = parseCoord(c.req.param('x') || '', 'x');
  if (z == null || y == null || x == null) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'z/y/x 非法' } }, 400);
  }

  const file = tilePath(layer, z, y, x);
  const cached = await readFreshCache(file);
  if (cached) {
    c.header('Content-Type', 'image/png');
    c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    c.header('X-Tile-Cache', 'HIT');
    return c.body(new Uint8Array(cached));
  }

  try {
    const { body, contentType } = await fetchUpstream(layer, z, y, x);
    void writeCache(file, body);
    c.header('Content-Type', contentType.includes('image') ? contentType : 'image/png');
    c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    c.header('X-Tile-Cache', 'MISS');
    return c.body(new Uint8Array(body));
  } catch (e) {
    const status = (e as { status?: number }).status;
    // 缓存过期但仍有文件：上游失败时降级旧缓存
    if (existsSync(file)) {
      try {
        const stale = await readFile(file);
        c.header('Content-Type', 'image/png');
        c.header('Cache-Control', 'public, max-age=300');
        c.header('X-Tile-Cache', 'STALE');
        return c.body(new Uint8Array(stale));
      } catch {
        /* fall through */
      }
    }
    if (status === 418 || status === 403 || status === 429) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'UPSTREAM_QUOTA',
            message: `天地图上游拒绝（HTTP ${status}），可能日配额用尽或 Key 类型不符`,
          },
        },
        502,
      );
    }
    const msg = e instanceof Error ? e.message : '瓦片拉取失败';
    if (msg.includes('TIANDITU_TK')) {
      return c.json({ ok: false, error: { code: 'NO_TK', message: msg } }, 503);
    }
    return c.json({ ok: false, error: { code: 'UPSTREAM_ERROR', message: msg } }, 502);
  }
});

mapTilesRoute.get('/_status', (c) => {
  const hasTk = Boolean((process.env.TIANDITU_TK || process.env.VITE_TIANDITU_TK || '').trim());
  return c.json({
    ok: true,
    data: {
      tk: hasTk ? 'set' : 'missing',
      cacheDir: cacheDir(),
      ttlSec: Math.round(cacheTtlMs() / 1000),
      layers: [...LAYERS],
    },
  });
});
