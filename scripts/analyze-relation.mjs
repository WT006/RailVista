// 按 OSM route relation 成员顺序装配，分析连续性 / 角色 / 残余缺口
// 用法: node scripts/analyze-relation.mjs G219 [--save]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { OVERPASS_ENDPOINTS, OVERPASS_USER_AGENT } from './lib/overpass.mjs';

const ref = process.argv[2];
const SAVE = process.argv.includes('--save');
const CACHE = join('data', 'cache', 'roads', `rel-${ref}.json`);

const RAD = Math.PI / 180;
const R = 6371000;
function hav(a, b) {
  const dl = (b[0] - a[0]) * RAD, dt = (b[1] - a[1]) * RAD;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dt / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dl / 2) ** 2));
}

async function rawQuery(ep, q, timeoutSec) {
  const res = await fetch(ep, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': OVERPASS_USER_AGENT },
    body: new URLSearchParams({ data: q }),
    signal: AbortSignal.timeout(timeoutSec * 1000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (!Array.isArray(j.elements)) throw new Error('no elements');
  return j.elements;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rawQueryRetry(ep, q, timeoutSec, tries = 3) {
  let lastErr;
  for (let t = 0; t < tries; t += 1) {
    try {
      return await rawQuery(ep, q, timeoutSec);
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (t + 1));
    }
  }
  throw lastErr;
}

async function loadRelation() {
  if (existsSync(CACHE)) {
    console.log('缓存命中', CACHE);
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }
  // 先在各端点找关系 id
  const q0 = `[out:json][timeout:60];rel["route"="road"]["ref"="${ref}"];out body;`;
  let id = null;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const els0 = await rawQueryRetry(ep, q0, 60, 3);
      const rels0 = els0.filter((e) => e.type === 'relation');
      if (rels0.length) {
        rels0.sort((a, b) => (b.members || []).length - (a.members || []).length);
        id = rels0[0].id;
        console.log('relation id', id, 'members', (rels0[0].members || []).length, '@', ep);
        break;
      }
    } catch { /* 下一端点 */ }
  }
  if (!id) throw new Error('无 route relation: ' + ref);
  // 逐端点取完整关系（必须包含该 relation）
  const q = `[out:json][timeout:240];rel(${id});out body;>;out geom;`;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const els = await rawQueryRetry(ep, q, 240, 2);
      if (els.some((e) => e.type === 'relation' && e.id === id)) {
        if (SAVE) {
          mkdirSync(join('data', 'cache', 'roads'), { recursive: true });
          writeFileSync(CACHE, JSON.stringify(els));
        }
        return els;
      }
      console.log('  端点无该关系，跳过:', ep);
    } catch (e) {
      console.log('  取数失败:', ep, e.message);
    }
  }
  throw new Error('无法取到完整关系: ' + ref);
}

const els = await loadRelation();
const rel = els.find((e) => e.type === 'relation');
const wayGeom = new Map();
for (const e of els) if (e.type === 'way' && Array.isArray(e.geometry)) wayGeom.set(e.id, e.geometry.map((p) => [p.lon, p.lat]));

const members = (rel.members || []).filter((m) => m.type === 'way');
console.log('way members:', members.length, '| 有几何:', [...wayGeom.keys()].length);
const roles = {};
for (const m of members) roles[m.role || '(empty)'] = (roles[m.role || '(empty)'] || 0) + 1;
console.log('roles:', JSON.stringify(roles));

// 沿成员顺序行走
const SNAP_M = 150; // 共享端点判定
let connected = 0, reversed = 0, gaps = 0;
const gapList = [];
let prevEnd = null;
let orderedKm = 0;
for (let i = 0; i < members.length; i++) {
  const g = wayGeom.get(members[i].ref);
  if (!g || g.length < 2) continue;
  const a = g[0], b = g[g.length - 1];
  let seg = g;
  let useStart = a;
  if (prevEnd === null) {
    prevEnd = b;
    orderedKm += segLen(g);
    continue;
  }
  const dFwd = hav(prevEnd, a);
  const dRev = hav(prevEnd, b);
  if (dFwd <= SNAP_M) {
    connected++;
    prevEnd = b;
  } else if (dRev <= SNAP_M) {
    reversed++;
    seg = [...g].reverse();
    prevEnd = a;
  } else {
    gaps++;
    const d = Math.min(dFwd, dRev);
    gapList.push({ afterMember: i - 1, role: members[i].role || '', gapM: Math.round(d) });
    if (dRev < dFwd) { seg = [...g].reverse(); prevEnd = a; } else prevEnd = b;
  }
  orderedKm += segLen(seg);
}
function segLen(g) { let s = 0; for (let i = 1; i < g.length; i++) s += hav(g[i - 1], g[i]); return s; }

console.log('\n=== 顺序装配结果 ===');
console.log('顺接:', connected, '| 反向接:', reversed, '| 断口:', gaps);
console.log('累计有序里程:', (orderedKm / 1000).toFixed(0), 'km');
const big = gapList.filter((x) => x.gapM > 500);
console.log('断口 >500m 的有', big.length, '处:');
for (const x of big.slice(0, 60)) console.log(`  after#${x.afterMember} role=${x.role} gap=${(x.gapM / 1000).toFixed(1)}km`);
const totGapKm = gapList.reduce((s, x) => s + x.gapM, 0) / 1000;
console.log('断口里程合计:', totGapKm.toFixed(0), 'km');
