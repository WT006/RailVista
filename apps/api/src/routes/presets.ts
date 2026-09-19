import { Hono } from 'hono';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const presetsDir = join(__dirname, '../../../../data/presets');

export const presetsRoute = new Hono();

const PRESET_MAP: Record<string, string> = {
  z8991: 'z8991.json',
  Z8991: 'z8991.json',
};

const RAILWAY_MAP: Record<string, string> = {
  z8991: 'z8991-railway.json',
  Z8991: 'z8991-railway.json',
};

presetsRoute.get('/:id', (c) => {
  const id = c.req.param('id');
  const file = PRESET_MAP[id] || `${id.toLowerCase()}.json`;
  const path = join(presetsDir, file);
  if (!existsSync(path)) {
    return c.json(
      { ok: false, error: { code: 'NOT_FOUND', message: `预置包不存在：${id}` } },
      404,
    );
  }
  const data = JSON.parse(readFileSync(path, 'utf8'));

  const railFile = RAILWAY_MAP[id] || `${String(id).toLowerCase()}-railway.json`;
  const railPath = join(presetsDir, railFile);
  if (existsSync(railPath)) {
    try {
      data.railway = JSON.parse(readFileSync(railPath, 'utf8'));
      data.railwaySource = 'osm';
    } catch {
      /* ignore broken railway asset */
    }
  }

  return c.json({ ok: true, data });
});
