import { Hono } from 'hono';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRailGeometry, type LngLat } from '../services/osmRailway.js';
import { enrichStopsCoords } from '../services/geocode.js';
import { matchCorridor, sliceCorridorForStops, loadCorridors } from '../services/corridors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const presetsDir = join(__dirname, '../../../../data/presets');

export const railGeometryRoute = new Hono();

// 启动时加载走廊预置
loadCorridors();

type Body = {
  stops?: Array<{ lng?: number; lat?: number; name?: string }>;
  trainCode?: string;
  /** preset：仅精品预置/走廊（快）；full：含 OSM 现场拼线（慢，按需） */
  mode?: 'preset' | 'full';
};

function tryPresetRailway(trainCode?: string): [number, number][] | null {
  if (!trainCode || !/^Z8991$/i.test(trainCode)) return null;
  const path = join(presetsDir, 'z8991-railway.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as [number, number][];
  } catch {
    return null;
  }
}

railGeometryRoute.post('/', async (c) => {
  let body: Body = {};
  try {
    body = (await c.req.json()) as Body;
  } catch {
    return c.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: '需要 JSON body' } },
      400,
    );
  }

  const enriched = await enrichStopsCoords(
    (body.stops || []).map((s) => ({
      name: s.name || '',
      lng: s.lng,
      lat: s.lat,
    })),
  );
  const stops: LngLat[] = enriched
    .filter((s) => s.lng != null && s.lat != null)
    .map((s) => ({ lng: Number(s.lng), lat: Number(s.lat) }));

  if (stops.length < 2) {
    return c.json(
      {
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: '至少需要 2 个可定位的经停站',
        },
      },
      400,
    );
  }

  // 1) Z8991 专用预置
  const preset = tryPresetRailway(body.trainCode);
  if (preset?.length) {
    return c.json({
      ok: true,
      data: {
        coords: preset,
        stops: enriched,
        source: 'osm',
        segmentsOk: stops.length - 1,
        segmentsTotal: stops.length - 1,
        fromPreset: true,
        corridorId: 'z8991',
      },
    });
  }

  // 2) 干线精品走廊（京沪等）——须首末站归属该走廊，避免太原→沪误套京沪
  const matched = matchCorridor(enriched);
  if (matched) {
    const sliced = sliceCorridorForStops(matched.corridor, enriched);
    if (sliced && sliced.length >= 2) {
      return c.json({
        ok: true,
        data: {
          coords: sliced,
          stops: enriched,
          source: 'osm',
          segmentsOk: stops.length - 1,
          segmentsTotal: stops.length - 1,
          fromPreset: true,
          corridorId: matched.corridor.id,
          corridorName: matched.corridor.name,
          matchScore: matched.score,
        },
      });
    }
  }

  const stationLine = stops.map((s) => [s.lng, s.lat] as [number, number]);

  // preset 模式：不打 OSM，交给前端「获取精确路线」按需触发
  if (body.mode === 'preset') {
    return c.json({
      ok: true,
      data: {
        coords: stationLine,
        stops: enriched,
        source: 'station',
        segmentsOk: 0,
        segmentsTotal: stops.length - 1,
        fromPreset: false,
        message: '无精品预置，可点击获取精确路线',
      },
    });
  }

  // 3) 现场 OSM 拼线（慢，按需）
  try {
    const result = await buildRailGeometry(stops, body.trainCode);
    if (result.source === 'none' || result.coords.length < 2) {
      return c.json({
        ok: true,
        data: {
          coords: stationLine,
          stops: enriched,
          source: 'station',
          segmentsOk: result.segmentsOk,
          segmentsTotal: result.segmentsTotal,
          message: '未能匹配 OSM 铁路线，已使用站点示意折线',
        },
      });
    }
    return c.json({
      ok: true,
      data: { ...result, stops: enriched, fromPreset: false },
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (stationLine.length >= 2) {
      return c.json({
        ok: true,
        data: {
          coords: stationLine,
          stops: enriched,
          source: 'station',
          segmentsOk: 0,
          segmentsTotal: stops.length - 1,
          message: err.message || 'OSM 失败，已使用站点示意折线',
        },
      });
    }
    return c.json(
      {
        ok: false,
        error: {
          code: err.code || 'OSM_FAIL',
          message: err.message || '铁路线构建失败',
        },
      },
      502,
    );
  }
});
