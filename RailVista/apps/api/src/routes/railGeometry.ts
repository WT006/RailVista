import { Hono } from 'hono';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRailGeometry, type LngLat } from '../services/osmRailway.js';
import { enrichStopsCoords } from '../services/geocode.js';
import { matchCorridor, sliceCorridorForStops, loadCorridors } from '../services/corridors.js';
import { matchCorridorNetwork } from '../services/corridorNetwork.js';
import { createRailGeometryJob, getRailGeometryJob } from '../services/railGeometryJob.js';
import { loadScenicSpots, matchScenicSpotsForRailway } from '../services/scenicSpots.js';
import { clientKeyFromRequest } from '../lib/clientIdentity.js';
import { slicePolylineByOd } from '@railvista/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const presetsDir = join(__dirname, '../../../../data/presets');

export const railGeometryRoute = new Hono();

// 启动时加载走廊预置与风景库
loadCorridors();
loadScenicSpots();

function attachScenic<T extends { coords: [number, number][] }>(data: T) {
  return {
    ...data,
    scenicSpots: matchScenicSpotsForRailway(data.coords),
  };
}

type Body = {
  stops?: Array<{ lng?: number; lat?: number; name?: string }>;
  trainCode?: string;
  /** preset：仅精品预置/走廊（快）；full：含 OSM 现场拼线（慢，按需） */
  mode?: 'preset' | 'full';
  /** 仅重算上一趟失败段 */
  retryFailedOnly?: boolean;
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

async function resolveStops(body: Body) {
  const enriched = await enrichStopsCoords(
    (body.stops || []).map((s) => ({
      name: s.name || '',
      lng: s.lng,
      lat: s.lat,
    })),
    { trainCode: body.trainCode },
  );
  const stops: LngLat[] = enriched
    .filter((s) => s.lng != null && s.lat != null)
    .map((s) => ({ lng: Number(s.lng), lat: Number(s.lat) }));
  return { enriched, stops };
}

railGeometryRoute.post('/jobs', async (c) => {
  let body: Body = {};
  try {
    body = (await c.req.json()) as Body;
  } catch {
    return c.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: '需要 JSON body' } },
      400,
    );
  }

  const { enriched } = await resolveStops(body);
  const namedStops = enriched
    .filter((s) => s.lng != null && s.lat != null && Number.isFinite(s.lng) && Number.isFinite(s.lat))
    .map((s) => ({ name: s.name, lng: Number(s.lng), lat: Number(s.lat) }));
  if (namedStops.length < 2) {
    return c.json(
      {
        ok: false,
        error: { code: 'BAD_REQUEST', message: '至少需要 2 个可定位的经停站' },
      },
      400,
    );
  }

  try {
    const job = createRailGeometryJob({
      stops: namedStops,
      trainCode: body.trainCode,
      clientKey: clientKeyFromRequest((n) => c.req.header(n)),
      retryFailedOnly: !!body.retryFailedOnly,
    });
    return c.json({
      ok: true,
      data: {
        ...job,
        // 回传全部 enrich 结果（含站名），前端按名合并，禁止按下标写坐标
        stops: enriched.map((s) => ({
          name: s.name,
          lng: s.lng != null ? Number(s.lng) : undefined,
          lat: s.lat != null ? Number(s.lat) : undefined,
        })),
      },
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    const status =
      err.code === 'BAD_REQUEST' ? 400 : err.code === 'BUSY' ? 503 : 500;
    return c.json(
      {
        ok: false,
        error: {
          code: err.code || 'JOB_FAIL',
          message: err.message || '创建精确路线任务失败',
        },
      },
      status,
    );
  }
});

railGeometryRoute.get('/jobs/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const job = getRailGeometryJob(jobId);
  if (!job) {
    return c.json(
      { ok: false, error: { code: 'NOT_FOUND', message: '任务不存在或已过期' } },
      404,
    );
  }
  return c.json({ ok: true, data: job });
});

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

  const { enriched, stops } = await resolveStops(body);

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

  // 1) Z8991 专用预置（按 OD 站投影切片后再挂风景，避免全线景点灌入短途）
  const preset = tryPresetRailway(body.trainCode);
  if (preset?.length) {
    const from = enriched.find((s) => s.lng != null && s.lat != null);
    const to = [...enriched].reverse().find((s) => s.lng != null && s.lat != null);
    let coords = preset;
    if (from && to && from !== to) {
      const sliced = slicePolylineByOd(
        preset,
        { lng: Number(from.lng), lat: Number(from.lat) },
        { lng: Number(to.lng), lat: Number(to.lat) },
      );
      if (sliced && sliced.length >= 2) coords = sliced;
    }
    return c.json({
      ok: true,
      data: attachScenic({
        coords,
        stops: enriched,
        source: 'osm' as const,
        segmentsOk: stops.length - 1,
        segmentsTotal: stops.length - 1,
        fromPreset: true,
        canUpgrade: false,
        corridorId: 'z8991',
      }),
    });
  }

  // 2) 干线精品走廊（京沪等）——须首末站归属该走廊，避免太原→沪误套京沪
  // 普速车（K/T/Z…）禁止套高铁走廊，避免「安阳/鹤壁」贴上「安阳东/鹤壁东」平行线
  const matched = matchCorridor(enriched, { trainCode: body.trainCode });
  if (matched) {
    const sliced = sliceCorridorForStops(matched.corridor, enriched);
    if (sliced && sliced.length >= 2) {
      return c.json({
        ok: true,
        data: attachScenic({
          coords: sliced,
          stops: enriched,
          source: 'osm' as const,
          segmentsOk: stops.length - 1,
          segmentsTotal: stops.length - 1,
          fromPreset: true,
          canUpgrade: false,
          corridorId: matched.corridor.id,
          corridorName: matched.corridor.name,
          matchScore: matched.score,
        }),
      });
    }
  }

  // 2b) 单走廊未命中：精品路网多段寻路拼接（京沪+宁杭、大西+徐兰 等）
  const networked = matchCorridorNetwork(enriched, { trainCode: body.trainCode });
  if (networked?.coords && networked.coords.length >= 2) {
    return c.json({
      ok: true,
      data: attachScenic({
        coords: networked.coords,
        stops: enriched,
        source: 'osm' as const,
        segmentsOk: stops.length - 1,
        segmentsTotal: stops.length - 1,
        fromPreset: true,
        canUpgrade: false,
        corridorId: networked.corridorIds.join('+'),
        corridorName: networked.corridorNames.join(' + '),
        transferHubs: networked.transferHubs,
        matchScore: networked.score,
      }),
    });
  }

  const stationLine = stops.map((s) => [s.lng, s.lat] as [number, number]);

  // preset 模式：不打 OSM，交给前端「获取精确路线」按需触发
  if (body.mode === 'preset') {
    return c.json({
      ok: true,
      data: attachScenic({
        coords: stationLine,
        stops: enriched,
        source: 'station' as const,
        segmentsOk: 0,
        segmentsTotal: stops.length - 1,
        fromPreset: false,
        canUpgrade: true,
        message: '无精品预置，可点击获取精确路线',
      }),
    });
  }

  // 3) 现场 OSM 拼线（慢；兼容旧调用，推荐改用 /jobs）
  try {
    const result = await buildRailGeometry(stops, body.trainCode);
    if (result.source === 'none' || result.coords.length < 2) {
      return c.json({
        ok: true,
        data: attachScenic({
          coords: stationLine,
          stops: enriched,
          source: 'station' as const,
          segmentsOk: result.segmentsOk,
          segmentsTotal: result.segmentsTotal,
          fromPreset: false,
          canUpgrade: true,
          message: '未能匹配 OSM 铁路线，已使用站点示意折线',
        }),
      });
    }
    return c.json({
      ok: true,
      data: attachScenic({
        ...result,
        stops: enriched,
        fromPreset: false,
        canUpgrade: false,
      }),
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (stationLine.length >= 2) {
      return c.json({
        ok: true,
        data: attachScenic({
          coords: stationLine,
          stops: enriched,
          source: 'station' as const,
          segmentsOk: 0,
          segmentsTotal: stops.length - 1,
          fromPreset: false,
          canUpgrade: true,
          message: err.message || 'OSM 失败，已使用站点示意折线',
        }),
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
