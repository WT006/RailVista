/**
 * 万里路书 · 国道 OSM route relation 加载库（scripts/lib/road-relation.mjs）
 *
 * 旧管道只取「显式打 ref 的散 way」→ 远端漏标即断成几十段，再用高德两点连线 → 绕路、重复。
 * 本库直接取该编号的 **route relation**：成员是按顺序收录的真实道路（含未打 ref 的连接段），
 * 从根上给出「一条完整、真实、有序」的线。
 *
 * 取数策略（关系动辄数千成员、全国一次取必超时）：
 *   1) rel(id);out body;                        取有序成员清单（小）
 *   2) way(id1)(id2)...;out geom;               成员几何按批拉取（可并发、可断点续传）
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OVERPASS_ENDPOINTS, OVERPASS_USER_AGENT } from './overpass.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function rawPost(ep, data, timeoutSec) {
  const res = await fetch(ep, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': OVERPASS_USER_AGENT },
    body: new URLSearchParams({ data }),
    signal: AbortSignal.timeout(timeoutSec * 1000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (!Array.isArray(j.elements)) throw new Error('no elements');
  return j.elements;
}

/** 多端点 + 退避重试 */
export async function postWithFailover(data, { timeoutSec = 60, tries = 2 } = {}) {
  let lastErr = null;
  for (const ep of OVERPASS_ENDPOINTS) {
    for (let t = 0; t < tries; t += 1) {
      try {
        return await rawPost(ep, data, timeoutSec);
      } catch (e) {
        lastErr = e;
        await sleep(1200 * (t + 1));
      }
    }
  }
  throw new Error('overpass 全部失败：' + lastErr?.message);
}

/**
 * 找到某编号成员最多的 road route relation。
 * @returns {Promise<{id:number, memberCount:number, tags:object}|null>}
 */
export async function findRouteRelation(ref) {
  const q = `[out:json][timeout:60];rel["route"="road"]["ref"="${ref}"];out body;`;
  let best = null;
  for (const ep of OVERPASS_ENDPOINTS) {
    for (let t = 0; t < 2; t += 1) {
      try {
        const els = await rawPost(ep, q, 60);
        const rels = els.filter((e) => e.type === 'relation');
        for (const r of rels) {
          const c = (r.members || []).filter((m) => m.type === 'way').length;
          if (!best || c > best.memberCount) best = { id: r.id, memberCount: c, tags: r.tags || {} };
        }
        if (rels.length) return best;
      } catch (e) {
        await sleep(1200 * (t + 1));
      }
    }
  }
  return best; // 可能为 null
}

function batchDir(ref) {
  return join('data', 'cache', 'roads', 'relbatches', String(ref).replace(/[^\w]/g, ''));
}

/**
 * 拉取并返回整条关系：{ id, members:[{ref,role,seq}], wayGeom:Map<id,[[lng,lat]]> }
 * 分批缓存，可断点续传。
 */
export async function loadRoadRelation(ref, { batchSize = 70, concurrency = 4 } = {}) {
  const meta = await findRouteRelation(ref);
  if (!meta) return null;
  const id = meta.id;

  // 1) 成员清单
  const membersQ = `[out:json][timeout:60];rel(${id});out body;`;
  let rel = null;
  for (const ep of OVERPASS_ENDPOINTS) {
    for (let t = 0; t < 3; t += 1) {
      try {
        const els = await rawPost(ep, membersQ, 60);
        rel = els.find((e) => e.type === 'relation' && e.id === id);
        if (rel) break;
      } catch (e) {
        await sleep(1200 * (t + 1));
      }
    }
    if (rel) break;
  }
  if (!rel) throw new Error('取成员清单失败: ' + ref);
  const members = (rel.members || [])
    .filter((m) => m.type === 'way')
    .map((m, seq) => ({ ref: m.ref, role: m.role || '', seq }));

  // 2) 分批几何（带磁盘缓存）
  const dir = batchDir(ref);
  mkdirSync(dir, { recursive: true });
  const batches = [];
  for (let i = 0; i < members.length; i += batchSize) batches.push(Math.floor(i / batchSize));

  const fetchBatch = async (bi) => {
    const cacheFile = join(dir, bi + '.json');
    if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));
    const slice = members.slice(bi * batchSize, bi * batchSize + batchSize);
    // 并集：多 way id 必须写成 (way(a);way(b);...;)；way(a)(b) 是 AND（交集），结果为空
    const body = '(' + slice.map((m) => `way(${m.ref});`).join('') + ');out geom;';
    const els = await postWithFailover('[out:json][timeout:90];' + body, { timeoutSec: 90, tries: 2 });
    const ways = els
      .filter((e) => e.type === 'way' && Array.isArray(e.geometry))
      .map((e) => ({ id: e.id, geom: e.geometry.map((p) => [p.lon, p.lat]), tags: e.tags || {} }));
    writeFileSync(cacheFile, JSON.stringify(ways));
    return ways;
  };

  const wayGeom = new Map();
  let cursor = 0;
  while (cursor < batches.length) {
    const window = batches.slice(cursor, cursor + concurrency);
    const results = await Promise.all(window.map((bi) => fetchBatch(bi)));
    for (const ways of results) for (const w of ways) wayGeom.set(w.id, w.geom);
    cursor += concurrency;
  }
  return { id, members, wayGeom, tags: meta.tags };
}
