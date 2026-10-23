#!/usr/bin/env node
/**
 * 百度地图取数：路书库坐标核实 + 路段里程实测（**仅离线脚本**）。
 *
 * 注意：apps/api 运行时已去掉百度驾车/geocode；公开上线勿再依赖 BAIDU_MAP_KEY。
 * 本脚本仅供历史补库 / 人工核验，可选用。
 *
 * 用法:
 *   node scripts/baidu-geo.mjs geo  targets.json [out.json]   # 地名 → WGS-84 坐标
 *   node scripts/baidu-geo.mjs drive legs.json  [out.json]    # 节点对 → 驾车里程/时长
 *
 * targets.json: [{ "key":"hs-p-guangmingding", "name":"光明顶", "city":"黄山市" }]
 * legs.json:    [{ "key":"hs-1", "from":[118.34,29.71], "to":[118.16,30.13], "via":[] }]
 *
 * 坐标系口径（重要）：
 *   · Place/地理编码 返回 BD-09，统一走 geoconv(from=5→to=1) 转成 WGS-84 再落库，
 *     与 OSM 公路几何、_regions.json 的「WGS-84 近似值」同一基准。
 *   · 驾车规划用 coord_type=wgs84 + ret_coordtype=wgs84ll，进出都是 WGS-84，免转换。
 *
 * ak 来源：环境变量 BAIDU_MAP_KEY，或本地 gitignore 文件 tmp/baidu-key.txt。
 * 结果带本地缓存（tmp/baidu-cache），重复跑不再消耗额度。
 */
process.env.NO_PROXY = '*';
process.env.no_proxy = '*';
process.env.HTTPS_PROXY = '';
process.env.HTTP_PROXY = '';

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tmp', 'baidu-cache');
fs.mkdirSync(CACHE, { recursive: true });

const AK =
  process.env.BAIDU_MAP_KEY ||
  fs.readFileSync(path.join(ROOT, 'tmp', 'baidu-key.txt'), 'utf8').trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  const cf = path.join(CACHE, 'baidu__' + createHash('sha256').update(url).digest('hex').slice(0, 32) + '.json');
  if (fs.existsSync(cf)) return JSON.parse(fs.readFileSync(cf, 'utf8'));
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': 'RailVista/0.8.0 (roadbook-geo)' },
      });
      const data = await res.json();
      // status 0 = 成功；配额/并发类错误退避重试
      if (data.status === 0 || data.status === 101 || data.status === 200) {
        fs.writeFileSync(cf, JSON.stringify(data));
        return data;
      }
      if (i < tries - 1) await sleep(900 * (i + 1));
    } catch {
      if (i < tries - 1) await sleep(700 * (i + 1));
    }
  }
  fs.writeFileSync(cf, JSON.stringify({ status: -1 }));
  return { status: -1 };
}

/** BD-09 批量转 WGS-84：coords 为 "lng,lat|lng,lat"，单次上限 40 */
async function bd09ToWgs84(points) {
  const out = new Array(points.length).fill(null);
  for (let i = 0; i < points.length; i += 40) {
    const chunk = points.slice(i, i + 40);
    const coords = chunk.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join('|');
    const url = `https://api.map.baidu.com/geoconv/v1/?coords=${encodeURIComponent(coords)}&from=5&to=1&ak=${AK}`;
    const data = await getJson(url);
    if (data.status === 0 && Array.isArray(data.result)) {
      data.result.forEach((r, j) => {
        out[i + j] = [r.x, r.y];
      });
    }
    await sleep(220);
  }
  return out;
}

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

async function resolveOne(name, city) {
  const q = `https://api.map.baidu.com/place/v2/search?query=${encodeURIComponent(name)}&region=${encodeURIComponent(city)}&output=json&ak=${AK}`;
  const d = await getJson(q);
  const hit = d.status === 0 && d.results?.[0];
  if (hit) {
    return {
      bd: [hit.location.lng, hit.location.lat],
      matched: hit.name,
      addr: [hit.province, hit.city, hit.district].filter(Boolean).join('/'),
      via: 'place',
    };
  }
  const g = `https://api.map.baidu.com/geocoding/v3/?address=${encodeURIComponent(name + city)}&output=json&extensions_p=1&ak=${AK}`;
  const gd = await getJson(g);
  if (gd.status === 0 && gd.result?.location) {
    const c = gd.result.components || {};
    return {
      bd: [gd.result.location.lng, gd.result.location.lat],
      matched: gd.result.formatted_address || name,
      addr: [c.province, c.city, c.district].filter(Boolean).join('/'),
      via: 'geocode',
    };
  }
  return null;
}

async function cmdGeo(inFile, outFile) {
  const targets = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const hits = [];
  for (const t of targets) {
    const r = await resolveOne(t.name, t.city);
    if (!r) {
      hits.push({ ...t, ok: false, note: 'NO RESULT' });
      console.log(`✗ ${t.key}  ${t.name}（${t.city}）→ 无结果`);
      continue;
    }
    r.target = t;
    hits.push(r);
    await sleep(200);
  }
  const wgs = await bd09ToWgs84(hits.filter((h) => h.bd).map((h) => h.bd));
  const wgsArr = wgs.values();
  const out = [];
  for (const h of hits) {
    if (!h.bd) {
      out.push({ key: h.key, ok: false, note: 'NO RESULT' });
      continue;
    }
    const w = wgsArr.next().value;
    if (!w) {
      out.push({ key: h.key, ok: false, note: 'geoconv 失败', bd: h.bd });
      continue;
    }
    const inCity = !h.addr || h.addr.includes(h.target.city.slice(0, 2));
    out.push({
      key: h.key,
      ok: true,
      lng: r2(w[0]),
      lat: r4(w[1]),
      lngExact: r4(w[0]),
      latExact: r4(w[1]),
      name: h.target.name,
      matched: h.matched,
      ad: h.addr,
      src: h.via,
      flag: inCity ? '✓' : '⚠疑似不在预期市',
    });
    console.log(
      `${inCity ? '✓' : '⚠'} ${h.key}  ${h.target.name} → ${r2(w[0])},${r4(w[1])} | ${h.matched} | ${h.addr} [${h.via}]`,
    );
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`\n已写入 ${outFile}（命中 ${out.filter((o) => o.ok).length}/${out.length}）`);
}

async function cmdDrive(inFile, outFile) {
  const legs = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const out = [];
  for (const l of legs) {
    const fmt = (p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`; // 百度：纬度在前
    const wp = l.via?.length ? `&waypoints=${encodeURIComponent(l.via.map(fmt).join(';'))}` : '';
    const url =
      `https://api.map.baidu.com/direction/v2/routing?origin=${encodeURIComponent(fmt(l.from))}` +
      `&destination=${encodeURIComponent(fmt(l.to))}${wp}&coord_type=wgs84&ret_coordtype=wgs84ll&ak=${AK}`;
    const d = await getJson(url);
    const r = d.status === 0 ? d.result?.routes?.[0] : null;
    if (!r) {
      out.push({ key: l.key, ok: false, status: d.status, note: 'NO ROUTE' });
      console.log(`✗ ${l.key}  ${l.from} → ${l.to} 规划失败 status=${d.status}`);
      continue;
    }
    const km = Math.round(r.distance / 100) / 10;
    const h = Math.round((r.duration / 360) * 10) / 10;
    out.push({ key: l.key, ok: true, km, hours: h, note: l.note });
    console.log(`${l.key}  ${l.from.join(',')} → ${l.to.join(',')} = ${km}km / ${h}h  ${l.note ? '· ' + l.note : ''}`);
    await sleep(240);
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`\n已写入 ${outFile}（成功 ${out.filter((o) => o.ok).length}/${out.length}）`);
}

const [cmd, inFile, outFile] = process.argv.slice(2);
if (!cmd || !inFile) {
  console.log('用法: node scripts/baidu-geo.mjs <geo|drive> <in.json> [out.json]');
  process.exit(1);
}
const out = outFile || `tmp/baidu-${cmd}-${path.basename(inFile).replace(/\.json$/, '')}.json`;
if (cmd === 'geo') await cmdGeo(inFile, out);
else if (cmd === 'drive') await cmdDrive(inFile, out);
else {
  console.log('未知命令', cmd);
  process.exit(1);
}
