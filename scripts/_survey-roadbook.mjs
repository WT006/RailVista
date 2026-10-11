import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'data/presets/roadbooks';
const files = readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
let routes=0, nodes=0, pois=0;
let missingNodeCoord=0, missingPoiCoord=0;
let layerCount={L1:0,L2:0,L3:0,L4:0,L5:0};
const l1=[];
for (const f of files) {
  const data = JSON.parse(readFileSync(join(dir,f),'utf8'));
  for (const r of data.routes) {
    routes++;
    const layer = r.layer || (r.tier==='national'?'L1':r.tier==='regional'?'L2':(r.days<=2?'L4':'L3'));
    layerCount[layer]=(layerCount[layer]||0)+1;
    for (const n of r.nodes||[]) { nodes++; if(!Number.isFinite(n.lng)||!Number.isFinite(n.lat)) missingNodeCoord++; }
    for (const p of r.pois||[]) { pois++; if(!Number.isFinite(p.lng)||!Number.isFinite(p.lat)) missingPoiCoord++; }
    if (layer==='L1') l1.push({id:r.id, name:r.name, days:r.days, totalKm:r.totalKm, pois:(r.pois||[]).length, density:+((r.pois||[]).length/r.days).toFixed(2)});
  }
}
console.log('文件数', files.length);
console.log('路线', routes, '节点', nodes, 'POI', pois);
console.log('缺坐标节点', missingNodeCoord, '缺坐标POI', missingPoiCoord);
console.log('分层分布', layerCount);
console.log('L1 路线数', l1.length);
const l1pois=l1.reduce((s,x)=>s+x.pois,0);
console.log('L1 POI 总数', l1pois, 'L1 平均密度', +(l1pois/l1.length).toFixed(2), 'L1 总天数', l1.reduce((s,x)=>s+x.days,0));
console.log('--- L1 密度最低 12 条（密度=POI/天数）---');
l1.sort((a,b)=>a.density-b.density).slice(0,12).forEach(x=>console.log(`${x.id}  ${x.name}  ${x.days}天/${x.totalKm}km  POI=${x.pois}  密度=${x.density}`));
