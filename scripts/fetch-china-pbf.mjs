/**
 * 万里路书 · 全国省份 PBF 下载（scripts/fetch-china-pbf.mjs）
 *
 * 数据源：https://download.openstreetmap.fr/extracts/asia/china/{prov}-latest.osm.pbf
 *   （Geofabrik 与 planet.openstreetmap.org 在国内网络常见不可达，本仓库以 openstreetmap.fr 为主源）
 *
 * 用法：
 *   node scripts/fetch-china-pbf.mjs --all
 *   node scripts/fetch-china-pbf.mjs --prov hainan
 *   node scripts/fetch-china-pbf.mjs --all --force      # 忽略已有文件重新下载
 *
 * 特性：断点续传（Range）· md5 校验 · 体积比对 · 逐省落盘，可反复重跑。
 */
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'data/cache/osm');
const BASE = 'https://download.openstreetmap.fr/extracts/asia/china/';
const UA = { 'User-Agent': 'RailVista/0.6.0 (road-network-pipeline)' };

const ALL_PROVINCES = [
  'anhui', 'beijing', 'chongqing', 'fujian', 'gansu', 'guangdong', 'guangxi', 'guizhou',
  'hainan', 'hebei', 'heilongjiang', 'henan', 'hubei', 'hunan', 'inner_mongolia', 'jiangsu',
  'jiangxi', 'jilin', 'liaoning', 'ningxia', 'qinghai', 'shaanxi', 'shandong', 'shanghai',
  'shanxi', 'sichuan', 'tianjin', 'tibet', 'xinjiang', 'yunnan', 'zhejiang',
];

const args = process.argv.slice(2);
const getArg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const force = args.includes('--force');
const only = getArg('--prov');
const targets = only ? [only] : ALL_PROVINCES;

function fileSize(p) {
  try { return statSync(p).size; } catch { return 0; }
}

async function md5Of(path) {
  const hash = createHash('md5');
  const stream = Readable.from((async function* () {
    const { createReadStream } = await import('node:fs');
    for await (const chunk of createReadStream(path, { highWaterMark: 1 << 22 })) yield chunk;
  })());
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function remoteSize(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: UA, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    return Number(res.headers.get('content-length') || 0);
  } catch {
    return null;
  }
}

async function download(url, dest) {
  const startAt = force ? 0 : fileSize(dest);
  const headers = { ...UA };
  if (startAt > 0) headers.Range = 'bytes=' + startAt + '-';
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(1800000) });
  if (!res.ok && res.status !== 206) throw new Error('HTTP ' + res.status);
  if (startAt > 0 && res.status !== 206) {
    // 服务端不支持续传：整体重来
    try { unlinkSync(dest); } catch { /* ignore */ }
    return download(url, dest);
  }
  const ws = createWriteStream(dest, { flags: startAt > 0 ? 'a' : 'w' });
  let got = startAt;
  for await (const chunk of res.body) {
    ws.write(chunk);
    got += chunk.length;
  }
  ws.end();
  await new Promise((r) => ws.on('finish', r));
  return got;
}

mkdirSync(OUT_DIR, { recursive: true });
let okCount = 0;
let skipCount = 0;
let failCount = 0;
let totalBytes = 0;
const manifest = [];

for (let i = 0; i < targets.length; i += 1) {
  const prov = targets[i];
  const name = prov + '-latest.osm.pbf';
  const dest = join(OUT_DIR, name);
  const url = BASE + name;
  const tag = '[' + String(i + 1).padStart(2) + '/' + targets.length + '] ' + prov.padEnd(16);
  const want = await remoteSize(url);
  const have = fileSize(dest);
  if (!force && want && have === want) {
    console.log(tag + (have / 1048576).toFixed(1) + 'MB  已存在（体积一致，跳过）');
    skipCount += 1;
    totalBytes += have;
    manifest.push({ prov, file: name, bytes: have, md5: null, checked: 'size' });
    continue;
  }
  const t0 = Date.now();
  try {
    const bytes = await download(url, dest);
    const secs = (Date.now() - t0) / 1000;
    const size = fileSize(dest);
    // md5 校验（远端 md5 对应 {prov}.osm.pbf，与 -latest 同源同内容）
    let md5Ok = 'n/a';
    try {
      const md5Res = await fetch(BASE + prov + '.osm.pbf.md5', { headers: UA, signal: AbortSignal.timeout(30000) });
      if (md5Res.ok) {
        const text = await md5Res.text();
        const expect = (text.match(/[0-9a-f]{32}/i) || [])[0];
        if (expect) {
          const got = await md5Of(dest);
          md5Ok = got === expect ? 'ok' : 'MISMATCH(' + got + ' vs ' + expect + ')';
        }
      }
    } catch { /* md5 不可得时不影响主流程 */ }
    console.log(tag + (size / 1048576).toFixed(1) + 'MB  ' + secs.toFixed(0) + 's  ' +
      (secs > 0 ? (size / 1048576 / secs).toFixed(2) : '-') + ' MB/s  md5=' + md5Ok);
    okCount += 1;
    totalBytes += size;
    manifest.push({ prov, file: name, bytes: size, md5: md5Ok, checked: md5Ok === 'ok' ? 'md5' : 'size' });
  } catch (e) {
    console.log(tag + '失败：' + (e && e.message ? e.message : e));
    failCount += 1;
  }
}

writeFileSync(join(OUT_DIR, '_manifest.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: BASE,
  provinces: manifest,
}, null, 1), 'utf8');

console.log('\n== 汇总 ==');
console.log('  新下载 ' + okCount + ' · 已存在 ' + skipCount + ' · 失败 ' + failCount);
console.log('  合计 ' + (totalBytes / 1073741824).toFixed(2) + ' GiB → data/cache/osm/');
console.log('  下一步：node scripts/build-road-census.mjs --all');
if (failCount) process.exit(1);
