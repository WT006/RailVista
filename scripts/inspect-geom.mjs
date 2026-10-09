// 几何体检 + SVG 抽样渲染
import { readFileSync, writeFileSync } from 'node:fs';

const RAD = Math.PI / 180;
const R = 6371000;
function hav(a, b) {
  const dl = (b[0] - a[0]) * RAD;
  const dt = (b[1] - a[1]) * RAD;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dt / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dl / 2) ** 2));
}

function inspect(g) {
  const P = g.points;
  let bigJump = 0, maxJump = 0, backtrack = 0;
  for (let i = 2; i < P.length; i++) {
    const a = P[i - 2], b = P[i - 1], c = P[i];
    const d_ab = hav(a, b), d_bc = hav(b, c), d_ac = hav(a, c);
    if (d_ab > 30 && d_bc > 30) {
      bigJump++;
      if (d_ab > maxJump) maxJump = d_ab;
    }
    // 折返检测：B 距 AC 连线 > 20km 且 AB,BC < 5km
    if (d_ab < 5 && d_bc < 5 && d_ac > 0.05) {
      const p = (d_ab + d_bc + d_ac) / 2;
      const area = Math.sqrt(Math.max(0, p * (p - d_ab) * (p - d_bc) * (p - d_ac)));
      const detour = (2 * area) / Math.max(d_ac, 0.001);
      if (detour > 5) backtrack++;
    }
  }
  let lngMin = Infinity, lngMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  for (const p of P) { if (p[0] < lngMin) lngMin = p[0]; if (p[0] > lngMax) lngMax = p[0]; if (p[1] < latMin) latMin = p[1]; if (p[1] > latMax) latMax = p[1]; }
  return { count: P.length, bigJump, maxJump, backtrack, bbox: [lngMin, latMin, lngMax, latMax] };
}

function svgRender(g, outPath, sampleEvery = 30) {
  const P = g.points;
  if (P.length === 0) return;
  const samp = [];
  for (let i = 0; i < P.length; i += sampleEvery) samp.push(P[i]);
  if (samp[samp.length - 1] !== P[P.length - 1]) samp.push(P[P.length - 1]);

  let lngMin = Infinity, lngMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  for (const p of samp) { if (p[0] < lngMin) lngMin = p[0]; if (p[0] > lngMax) lngMax = p[0]; if (p[1] < latMin) latMin = p[1]; if (p[1] > latMax) latMax = p[1]; }
  const padX = (lngMax - lngMin) * 0.05;
  const padY = (latMax - latMin) * 0.05;
  lngMin -= padX; lngMax += padX; latMin -= padY; latMax += padY;
  const W = 1000, H = 600;
  const sx = (W - 40) / (lngMax - lngMin);
  const sy = (H - 40) / (latMax - latMin);
  const s = Math.min(sx, sy);

  const proj = (p) => [20 + (p[0] - lngMin) * s, H - 20 - (p[1] - latMin) * s];

  let pathD = '';
  for (let i = 0; i < samp.length; i++) {
    const [x, y] = proj(samp[i]);
    pathD += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
  }
  // 起点/终点
  const start = proj(P[0]);
  const end = proj(P[P.length - 1]);
  // bbox label
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#0e1521"/>
<text x="20" y="28" fill="#e6edf3" font-size="18" font-family="monospace">${g.key}  · ${g.class}  · totalKm=${g.totalKm.toFixed(0)}  · officialKm=${g.officialKm ?? '-'}  · points=${P.length}</text>
<text x="20" y="48" fill="#8b949e" font-size="12" font-family="monospace">filledGaps=${(g.gapFill?.filledGaps || []).length} · segments=${(g.segments||[]).length} · componentCount=${g.componentCount} · bbox=[${g.bbox ? g.bbox.map(v=>v.toFixed(1)).join(',') : '-'}]</text>
<text x="20" y="${H - 12}" fill="#8b949e" font-size="11" font-family="monospace">bbox lng=[${(g.bbox?.[0] ?? lngMin).toFixed(2)}, ${(g.bbox?.[2] ?? lngMax).toFixed(2)}] lat=[${(g.bbox?.[1] ?? latMin).toFixed(2)}, ${(g.bbox?.[3] ?? latMax).toFixed(2)}]  · 采样 ${samp.length} 点</text>
<path d="${pathD}" stroke="#3fb950" stroke-width="1.5" fill="none"/>
<circle cx="${start[0].toFixed(1)}" cy="${start[1].toFixed(1)}" r="4" fill="#58a6ff"/>
<circle cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="4" fill="#f85149"/>
<text x="${start[0].toFixed(1) + 6}" y="${start[1].toFixed(1)}" fill="#58a6ff" font-size="11">起 ${P[0][0].toFixed(2)},${P[0][1].toFixed(2)}</text>
<text x="${end[0].toFixed(1) + 6}" y="${end[1].toFixed(1)}" fill="#f85149" font-size="11">讫 ${P[P.length-1][0].toFixed(2)},${P[P.length-1][1].toFixed(2)}</text>
</svg>`;
  writeFileSync(outPath, svg);
}

const keys = ['G219', 'G318', 'G108'];
for (const k of keys) {
  const fp = `data/roads/geom/${k}.json`;
  const g = JSON.parse(readFileSync(fp, 'utf8'));
  const r = inspect(g);
  console.log(`=== ${k} ===`);
  console.log(' points:', r.count, '· >30km跳跃:', r.bigJump, '· 最大:', r.maxJump.toFixed(1) + 'km', '· 折返:', r.backtrack);
  console.log(' bbox:', r.bbox.map((v) => v.toFixed(2)).join(','));
  console.log(' totalKm:', g.totalKm.toFixed(0), '· officialKm:', g.officialKm ?? '-', '· componentCount:', g.componentCount);
  console.log(' gapFill.filledGaps:', (g.gapFill?.filledGaps || []).length, '· via:', (g.gapFill?.filledGaps || [])[0]?.via ?? '-');
  svgRender(g, `data/roads/geom/${k}-preview.svg`, 50);
  console.log(' SVG:', `data/roads/geom/${k}-preview.svg`);
}
