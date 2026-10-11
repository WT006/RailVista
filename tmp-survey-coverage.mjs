import { readdirSync, readFileSync } from 'fs';
const dir = 'data/presets/roadbooks';
const files = readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const provCount = {};
const routeCount = 0;
let totalRoutes = 0;
const routesByProv = {};
for (const f of files) {
  let j; try { j = JSON.parse(readFileSync(`${dir}/${f}`,'utf8')); } catch(e){ console.log('PARSE ERR', f, e.message); continue; }
  const routes = j.routes || [];
  totalRoutes += routes.length;
  for (const r of routes) {
    const provs = r.provinces || [];
    for (const p of provs) {
      provCount[p] = (provCount[p]||0)+1;
      (routesByProv[p] = routesByProv[p]||[]).push(r.id);
    }
  }
}
console.log('FILES:', files.length, 'TOTAL ROUTES:', totalRoutes);
const allProvs = ['北京','天津','河北','山西','内蒙古','辽宁','吉林','黑龙江','上海','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','广西','海南','重庆','四川','贵州','云南','西藏','陕西','甘肃','青海','宁夏','新疆','香港','澳门','台湾'];
console.log('--- COVERED (route count) ---');
for (const p of allProvs) if (provCount[p]) console.log(p, provCount[p]);
console.log('--- UNCOVERED (0 routes) ---');
console.log(allProvs.filter(p=>!provCount[p]).join(' '));
