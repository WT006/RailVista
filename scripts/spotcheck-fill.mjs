/**
 * 万里路书 · 补全段抽样复核（scripts/spotcheck-fill.mjs）
 *
 * 目的：证明补进去的线确实走在「本国道」上，而不是高德推荐的一条更快的高速/其它路。
 * 做法：对比旧几何（备份目录）找出「新增点」，沿新增点抽样，用高德逆地理编码
 *      读取该点最近道路名，统计命中本国道编号的比例。
 *
 * 用法：node scripts/spotcheck-fill.mjs G228,G331,G215 data/roads/geom.bak-20261012
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { haversineM } from './lib/road-assemble.mjs';
import { AMAP_KEY } from './lib/amap.mjs';

const OLD_DIR = process.argv[3] || 'data/roads/geom.bak-20261012';
const NEW_DIR = 'data/roads/geom';
const SAMPLE = Number(process.env.SAMPLE || 14);

async function regeo(lng, lat) {
  const u = `https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${AMAP_KEY}&extensions=all&output=json`;
  const j = await fetch(u).then((r) => r.json()).catch(() => null);
  const roads = (j?.regeocode?.roads ?? []).map((r) => r.name).filter(Boolean);
  return {
    addr: j?.regeocode?.formatted_address ?? '?',
    roads: roads.length ? roads : ((j?.regeocode?.roadinters ?? []).map((r) => r.name).filter(Boolean)),
  };
}

function nearAny(p, pts, tolM) {
  const stride = Math.max(1, Math.floor(pts.length / 3000));
  for (let i = 0; i < pts.length; i += stride) if (haversineM(p[0], p[1], pts[i][0], pts[i][1]) < tolM) return true;
  return false;
}

for (const ref of (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
  const np = join(NEW_DIR, ref + '.json');
  const op = join(OLD_DIR, ref + '.json');
  if (!existsSync(np)) { console.log(ref, '缺文件'); continue; }
  const ng = JSON.parse(readFileSync(np, 'utf8'));
  const og = existsSync(op) ? JSON.parse(readFileSync(op, 'utf8')) : { points: [], segments: [] };
  const oldPts = [og.points, ...(og.segments ?? [])].flat();
  const num = ref.slice(1);
  const fresh = ng.points.filter((p) => !nearAny(p, oldPts, 1500));
  console.log('\n=== ' + ref + ' 新增点 ' + fresh.length + ' / 总点 ' + ng.points.length);
  const step = Math.max(1, Math.floor(fresh.length / SAMPLE));
  let hit = 0, n = 0;
  for (let i = 0; i < fresh.length && n < SAMPLE; i += step) {
    const p = fresh[i];
    const r = await regeo(p[0], p[1]);
    const ok = r.roads.some((x) => x.includes(num + '国道') || x.includes('国道' + num) || new RegExp('^G0?' + num + '(?![0-9])').test(x));
    if (ok) hit += 1;
    n += 1;
    console.log('  ' + (ok ? '✓' : '·') + ' ' + p.map((v) => (+v).toFixed(4)).join(',') + '  ' + (r.roads.slice(0, 3).join('/') || '(无名)') + '  @' + r.addr.slice(0, 28));
    await new Promise((r2) => setTimeout(r2, 120));
  }
  console.log('  命中本国道编号：' + hit + '/' + n);
}
