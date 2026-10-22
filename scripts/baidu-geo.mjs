#!/usr/bin/env node
/**
 * 百度地图取数：路书库坐标核实 + 路段里程实测。
 *
 * 用法:
 *   node scripts/baidu-geo.mjs health                          # 探活：哪些服务可通、白名单是否放行
 *   node scripts/baidu-geo.mjs geo   targets.json [out.json]   # 地名 → WGS-84 坐标
 *   node scripts/baidu-geo.mjs drive legs.json    [out.json]   # 节点对 → 驾车里程/时长
 *
 * targets.json: [{ "key":"hs-p-guangmingding", "name":"光明顶", "city":"黄山市" }]
 * legs.json:    [{ "key":"hs-1", "from":[118.34,29.71], "to":[118.16,30.13], "via":[] }]
 *
 * ── 密钥口径（红线：不硬编码进业务代码）────────────────────────────────
 *   AK 只从两处读取，**都���在本仓库之外**：
 *     1) 环境变量 `BAIDU_MAP_KEY`（推荐，CI / 部署环境用这个）
 *     2) 本地 `tmp/baidu-key.txt`（该目录被 .gitignore 忽略，仅供本地开发）
 *   两者都没有 → 直接退出并给出提示，**不写死任何默认 AK**。
 *
 * ── 坐标系口径 ─────────────────────────────────────────────────────────
 *   · Place/地理编码 返回 BD-09，统一走 geoconv(from=5→to=1) 转成 WGS-84 再落库，
 *     与 OSM 公路几何、_regions.json 的「WGS-84 近似值」同一基准。
 *   · 驾车规划用 coord_type=wgs84 + ret_coordtype=wgs84ll，进出都是 WGS-84，免转换。
 *
 * ── 网络口径（2026-10-22 实测）─────────────────────────────────────────
 *   百度 AK 的「IP 白名单」校验发生在**边缘节点**上，同一把 AK 会因落到不同
 *   边缘而给出不同结果：
 *     · status 210 「APP IP校验失败」= 该边缘看到的出口 IP 不在白名单里
 *     · status 200 「APP不存在，AK有误」 = 该边缘的校验分支给出的另一种失败表述
 *   因此本客户端做三件事：
 *     1) 解析 api.map.baidu.com 的全部 A 记录，逐个探活并维护「可用边缘集」
 *     2) 请求失败时轮换边缘 + 退避重试
 *     3) 全边缘失败时明确报错（区分「IP 未放行」与「服务未开通」），不静默降级
 *   结果带本地缓存（tmp/baidu-cache），重复跑不再消耗额度。
 */
process.env.NO_PROXY = '*';
process.env.no_proxy = '*';
process.env.HTTPS_PROXY = '';
process.env.HTTP_PROXY = '';

import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tmp', 'baidu-cache');
fs.mkdirSync(CACHE, { recursive: true });

const HOST = 'api.map.baidu.com';
const KEY_FILE = path.join(ROOT, 'tmp', 'baidu-key.txt');

/** 密钥只从环境变量或 gitignore 的本地文件读，绝不硬编码。 */
function readAk() {
  const fromEnv = (process.env.BAIDU_MAP_KEY ?? '').trim();
  if (fromEnv) return { ak: fromEnv, from: '环境变量 BAIDU_MAP_KEY' };
  try {
    const ak = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (ak) return { ak, from: '本地文件 tmp/baidu-key.txt（已 gitignore）' };
  } catch {
    /* 落到下面的报错分支 */
  }
  console.error(
    [
      '',
      '✗ 没有可用的百度地图 AK。',
      '  请设置环境变量：  $env:BAIDU_MAP_KEY = "<你的 AK>"',
      '  或写入本地文件：  tmp/baidu-key.txt（该目录已被 .gitignore 忽略，不会入库）',
      '  本脚本不内置任何默认密钥。',
      '',
    ].join('\n'),
  );
  process.exit(2);
}
const { ak: AK, from: AK_FROM } = readAk();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 边缘节点池 ───────────────────────────────────────────────────────────
let edgePool = [];
let edgeCursor = 0;

async function resolveEdges() {
  try {
    const rec = await dns.resolve4(HOST);
    edgePool = [...new Set(rec)];
  } catch {
    edgePool = [];
  }
  if (!edgePool.length) edgePool = ['14.215.182.208', '14.215.182.24', '14.215.182.56', '14.215.182.113'];
  return edgePool;
}

/** 直连指定边缘（保留 SNI 与 Host 头），返回 { status, body }。 */
function requestViaEdge(edge, urlPath) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: edge,
        servername: HOST,
        path: urlPath,
        method: 'GET',
        headers: { Host: HOST, 'User-Agent': 'RailVista/0.11.1 (roadbook-geo)' },
      },
      (r) => {
        let b = '';
        r.on('data', (d) => { b += d; });
        r.on('end', () => resolve({ httpStatus: r.statusCode, body: b, edge }));
      },
    );
    req.on('error', (e) => resolve({ httpStatus: 0, body: '', edge, error: e.message }));
    req.setTimeout(12000, () => { req.destroy(); resolve({ httpStatus: 0, body: '', edge, error: 'timeout' }); });
    req.end();
  });
}

/** 判定响应属于哪一类失败，用于给出可执行的报错。 */
function classify(data) {
  if (data?.status === 0) return 'ok';
  const msg = String(data?.message ?? '');
  if (/IP校验失败/.test(msg)) return 'ip-blocked';
  if (/APP不存在|AK有误/.test(msg)) return 'ak-rejected';
  if (/权限|未开启|不支持/.test(msg)) return 'service-disabled';
  if (/配额|QPS|频率/.test(msg)) return 'quota';
  return 'other';
}

/**
 * 带边缘轮换与退避重试的取数。
 * 只有「IP 未放行 / AK 被边缘拒绝」这类**瞬时**错误才重试；
 * 「服务未开通」立即失败（换边缘也没用）。
 */
async function getJson(urlPath, { tries = 6, useCache = true } = {}) {
  // AK 作为查询参数附加（路径里不带 ak，避免调用方漏写）
  const sep = urlPath.includes('?') ? '&' : '?';
  const fullPath = `${urlPath}${sep}ak=${encodeURIComponent(AK)}`;
  if (useCache) {
    const cf = path.join(CACHE, 'baidu__' + createHash('sha256').update(fullPath).digest('hex').slice(0, 32) + '.json');
    if (fs.existsSync(cf)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cf, 'utf8'));
        if (cached && cached.status !== undefined) return { ...cached, cached: true };
      } catch { /* 缓存损坏则忽略 */ }
    }
  }

  if (!edgePool.length) await resolveEdges();
  let last = null;
  const seen = [];

  for (let i = 0; i < tries; i += 1) {
    const edge = edgePool[edgeCursor % edgePool.length];
    edgeCursor += 1;
    const res = await requestViaEdge(edge, fullPath);
    if (res.error) {
      seen.push(`${edge}:${res.error}`);
      last = { status: -1, message: res.error };
    } else {
      let data;
      try {
        data = JSON.parse(res.body);
      } catch {
        seen.push(`${edge}:非JSON`);
        last = { status: -1, message: '返回非 JSON 内容' };
      }
      if (data) {
        const kind = classify(data);
        if (kind === 'ok') {
          if (useCache) {
            const cf = path.join(CACHE, 'baidu__' + createHash('sha256').update(fullPath).digest('hex').slice(0, 32) + '.json');
            fs.writeFileSync(cf, JSON.stringify(data));
          }
          return { ...data, edge };
        }
        if (kind === 'service-disabled') {
          return { ...data, _fail: kind, _edge: edge };
        }
        last = data;
        seen.push(`${edge}:${kind}(${data.status})`);
      }
    }
    await sleep(600 * (i + 1));
  }
  return { ...(last ?? { status: -1, message: '全部边缘均失败' }), _fail: classify(last), _seen: seen };
}

/** 把失败原因翻译成人能懂、能动手解决的话。 */
function explainFailure(res) {
  const lines = [
    '',
    `✗ 百度地图请求失败：${res.message ?? '未知错误'}（status=${res.status}）`,
    `  AK 来源：${AK_FROM}`,
  ];
  if (res._fail === 'ip-blocked' || res._fail === 'ak-rejected') {
    lines.push(
      '  判定：**这把 AK 的 IP 白名单没有放行本机当前的出口 IP**。',
      '        百度按边缘节点逐个校验，同一把 AK 会在不同边缘给出不同结果。',
      '  处理办法（二选一）：',
      '    a) 登录百度地图开放平台 → 应用设置 → 服务 IP 白名单，加入本机当前出口公网 IP；',
      '    b) 换一把不做 IP 限制的 AK，并通过环境变量 BAIDU_MAP_KEY 提供。',
      '  本机当前出口 IP 可用下面命令自测：  node scripts/baidu-geo.mjs health',
    );
  } else if (res._fail === 'service-disabled') {
    lines.push(
      '  判定：**这把 AK 没有开通该服务**（在开放平台的应用设置里勾选对应服务类型）。',
      '  可用服务：地点检索 / 地理编码 / 路径规划 / 坐标转换 / 天气等，需分别开通。',
    );
  } else if (res._fail === 'quota') {
    lines.push('  判定：配额或频率限制。稍后重试，或换一把配额更充裕的 AK。');
  }
  if (res._seen?.length) lines.push(`  各边缘结果：${res._seen.join(' | ')}`);
  lines.push('');
  return lines.join('\n');
}

/** BD-09 批量转 WGS-84：coords 为 "lng,lat|lng,lat"，单次上限 40 */
async function bd09ToWgs84(points) {
  const out = new Array(points.length).fill(null);
  for (let i = 0; i < points.length; i += 40) {
    const chunk = points.slice(i, i + 40);
    const coords = chunk.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join('|');
    const res = await getJson(`/geoconv/v1/?coords=${encodeURIComponent(coords)}&from=5&to=1`);
    if (res.status === 0 && Array.isArray(res.result)) {
      res.result.forEach((r, j) => { out[i + j] = [r.x, r.y]; });
    } else if (res._fail) {
      console.error(explainFailure(res));
      process.exit(1);
    }
    await sleep(220);
  }
  return out;
}

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

async function resolveOne(name, city) {
  const q = `/place/v2/search?query=${encodeURIComponent(name)}&region=${encodeURIComponent(city)}&output=json`;
  const d = await getJson(q);
  const hit = d.status === 0 && d.results?.[0];
  if (hit) {
    return { bd: [hit.location.lng, hit.location.lat], matched: hit.name, addr: [hit.province, hit.city, hit.district].filter(Boolean).join('/'), via: 'place' };
  }
  const g = `/geocoding/v3/?address=${encodeURIComponent(name + city)}&output=json&extensions_p=1`;
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
  if (gd._fail) {
    console.error(explainFailure(gd));
    process.exit(1);
  }
  return null;
}

async function cmdHealth() {
  const edges = await resolveEdges();
  console.log(`AK 来源：${AK_FROM}（${AK.slice(0, 6)}…${AK.slice(-4)}）`);
  console.log(`边缘池：${edges.join(', ')}\n`);

  const SERVICES = [
    ['地点检索 place/v2/search', '/place/v2/search?query=%E9%9B%B7%E5%8F%B0&region=%E6%AD%A6%E5%A8%81%E5%B8%82&output=json'],
    ['地点详情 place/v2/detail', '/place/v2/detail?uid=2e5e43152f25114bd42ce2e7&output=json&scope=2'],
    ['地理编码 geocoding/v3', '/geocoding/v3/?address=' + encodeURIComponent('陕西省西安市钟楼') + '&output=json'],
    ['坐标转换 geoconv/v1', '/geoconv/v1/?coords=116.487000,39.991000&from=1&to=5'],
    ['驾车规划 direction/v2', '/direction/v2/routing?origin=34.341000,108.940000&destination=34.412000,109.070000&coord_type=wgs84&ret_coordtype=wgs84ll'],
    ['轻量驾车 directionlite/v1', '/directionlite/v1/driving?origin=34.341000,108.940000&destination=34.412000,109.070000&coord_type=wgs84'],
  ];

  const usable = [];
  for (const [name, p] of SERVICES) {
    const res = await getJson(p, { tries: edges.length, useCache: false });
    const kind = classify(res);
    const mark = kind === 'ok' ? '✅' : '❌';
    console.log(`${mark} ${name.padEnd(26)} ${kind === 'ok' ? '可用' : `${kind}（status=${res.status} ${res.message ?? ''}）`}`);
    if (kind === 'ok') usable.push(name);
    await sleep(200);
  }

  console.log('');
  if (usable.length) {
    console.log(`✅ 可用服务 ${usable.length}/${SERVICES.length}：${usable.join('、')}`);
  } else {
    console.log('❌ 全部服务不可用 —— 判定为「AK 的 IP 白名单未放行本机出口 IP」。');
    console.log('   本机出口公网 IP：');
    try {
      const r = await fetch('https://ipinfo.io/ip', { signal: AbortSignal.timeout(8000) });
      console.log(`     ${(await r.text()).trim()}`);
      console.log('   把上面这个 IP 加进百度开放平台该应用的「服务 IP 白名单」即可放行。');
    } catch {
      console.log('     （探测失败，请自行用浏览器访问 ipinfo.io 查询）');
    }
  }
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
      key: h.key, ok: true, lng: r2(w[0]), lat: r4(w[1]),
      lngExact: r4(w[0]), latExact: r4(w[1]),
      name: h.target.name, matched: h.matched, ad: h.addr, src: h.via,
      flag: inCity ? '✓' : '⚠疑似不在预期市',
    });
    console.log(`${inCity ? '✓' : '⚠'} ${h.key}  ${h.target.name} → ${r2(w[0])},${r4(w[1])} | ${h.matched} | ${h.addr} [${h.via}]`);
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
    const res = await getJson(
      `/direction/v2/routing?origin=${encodeURIComponent(fmt(l.from))}&destination=${encodeURIComponent(fmt(l.to))}${wp}&coord_type=wgs84&ret_coordtype=wgs84ll`,
    );
    const r = res.status === 0 ? res.result?.routes?.[0] : null;
    if (!r) {
      if (res._fail) {
        console.error(explainFailure(res));
        process.exit(1);
      }
      out.push({ key: l.key, ok: false, status: res.status, note: 'NO ROUTE' });
      console.log(`✗ ${l.key}  ${l.from} → ${l.to} 规划失败 status=${res.status}`);
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
if (!cmd) {
  console.log('用法: node scripts/baidu-geo.mjs <health|geo|drive> [in.json] [out.json]');
  process.exit(1);
}
await resolveEdges();
const out = outFile || (cmd === 'health' ? '' : `tmp/baidu-${cmd}-${path.basename(inFile ?? 'x').replace(/\.json$/, '')}.json`);
if (cmd === 'health') await cmdHealth();
else if (cmd === 'geo') await cmdGeo(inFile, out);
else if (cmd === 'drive') await cmdDrive(inFile, out);
else {
  console.log('未知命令', cmd);
  process.exit(1);
}
