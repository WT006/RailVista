#!/usr/bin/env node
// s-cut-gaps.mjs —— 全量省/县/乡道：主链内 >CUT_KM 的断口切割，后段移入 segments
// 消除大 gap 直线（假线形态）；<CUT_KM 的缝合保留（缝合语义）
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'data/roads/geom';
const CUT_KM = Number(process.env.CUT_KM || 40);

function havKm(a, b) {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function chainKm(c) {
  let km = 0;
  for (let j = 1; j < c.length; j += 1) km += havKm(c[j - 1], c[j]);
  return km;
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.includes('-accept') && !f.includes('-spot') && !/^G\d+\.json$/.test(f));
let cutFiles = 0, cutCount = 0;
// 对单条链递归切割 >CUT_KM 断口，返回子段数组
function cutChain(chain) {
  const out = [];
  let cur = chain;
  for (;;) {
    let bi = -1, bd = 0;
    for (let i = 1; i < cur.length; i += 1) {
      const d = havKm(cur[i - 1], cur[i]);
      if (d > bd) { bd = d; bi = i; }
    }
    if (bi < 0 || bd <= CUT_KM) { out.push(cur); break; }
    const tail = cur.slice(bi);
    out.push(cur.slice(0, bi));
    cur = tail;
    cutCount += 1;
  }
  return out.filter((c) => c.length >= 2);
}

for (const f of files) {
  const fp = path.join(DIR, f);
  let g;
  try { g = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; }
  if (!g.points || g.points.length < 2) continue;
  let segs = (g.segments || []).map((c) => c.map((p) => (Array.isArray(p) ? p : [p.lng, p.lat])));
  let chain = g.points.map((p) => (Array.isArray(p) ? p : [p.lng, p.lat]));
  const before = segs.length;
  // 主链与每条 segment 内部都递归切割
  const mainParts = cutChain(chain);
  let newSegs = [...mainParts.slice(1)];
  for (const sg of segs) newSegs.push(...cutChain(sg));
  segs = newSegs;
  const changed = segs.length !== before || mainParts.length > 1;
  if (!changed) continue;
  chain = mainParts[0];
  const mainKm = chainKm(chain);
  const restKm = segs.reduce((acc, c) => acc + chainKm(c), 0);
  g.points = chain;
  g.segments = segs;
  // gap 标注：保留 atKm 落在新主链内的
  const cutKmAt = mainKm;
  g.gapAnnotations = (g.gapAnnotations || []).filter((gp) => gp.atKm < cutKmAt - 1);
  g.totalKm = Math.round(mainKm * 10) / 10;
  g.drawnKm = Math.round((mainKm + restKm) * 10) / 10;
  g.componentCount = 1 + segs.length;
  g.bigGapCut = true;
  fs.writeFileSync(fp, JSON.stringify(g));
  cutFiles += 1;
}
console.log(`切割完成: ${cutFiles} 条文件, ${cutCount} 处 >${CUT_KM}km 断口移入 segments`);
