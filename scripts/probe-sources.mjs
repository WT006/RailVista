// 数据源可用性探针：Overpass route relation / 高德 web key / 天地图
import { overpassQuery } from './lib/overpass.mjs';

const AMAP_KEY = process.env.AMAP_KEY || '5c4da48f09d20c88e18e51c252b65416';

async function testAmap() {
  console.log('\n===== 高德 Amap =====');
  // 1) regeo 验证 key
  const regeo = `https://restapi.amap.com/v3/geocode/regeo?location=116.4810,39.9970&key=${AMAP_KEY}`;
  try {
    const r = await fetch(regeo);
    const j = await r.json();
    console.log('regeo status:', j.status, 'info:', j.info, 'infocode:', j.infocode,
      'addr:', j.regeocode?.formatted_address);
  } catch (e) {
    console.log('regeo 失败:', e.message);
  }
  // 2) 短距离驾车规划（看返回结构 + road 名）
  const drive = `https://restapi.amap.com/v3/direction/driving?origin=98.5395,28.0953&destination=98.5000,28.1200&key=${AMAP_KEY}&extensions=all`;
  try {
    const r = await fetch(drive);
    const j = await r.json();
    console.log('driving status:', j.status, 'info:', j.info, 'infocode:', j.infocode);
    const path = j.route?.paths?.[0];
    if (path) {
      console.log('  distance(m):', path.distance, 'steps:', path.steps?.length);
      for (const s of (path.steps || []).slice(0, 3)) {
        console.log('   road:', s.road, '| instruction:', s.instruction?.slice(0, 40));
      }
    }
  } catch (e) {
    console.log('driving 失败:', e.message);
  }
}

async function testRelation(ref) {
  console.log(`\n===== Overpass route relation ${ref} =====`);
  // 取关系本体 + 成员（含角色与顺序），再展开几何
  const q = `[out:json][timeout:120];rel["type"="route"]["route"="road"]["ref"="${ref}"];out body;>;out geom;`;
  const t0 = Date.now();
  const els = await overpassQuery(q, 120);
  console.log('elements:', els.length, 'in', ((Date.now() - t0) / 1000).toFixed(0), 's');
  const rels = els.filter((e) => e.type === 'relation');
  console.log('relations:', rels.length);
  for (const rel of rels.slice(0, 5)) {
    const members = rel.members || [];
    const wayMembers = members.filter((m) => m.type === 'way');
    const roles = {};
    for (const m of wayMembers) roles[m.role || '(empty)'] = (roles[m.role || '(empty)'] || 0) + 1;
    console.log(`  rel ${rel.id} network=${rel.tags?.network} name=${rel.tags?.name} ways=${wayMembers.length} roles=${JSON.stringify(roles)}`);
  }
  return { els, rels };
}

async function testTianditu() {
  console.log('\n===== 天地图 Tianditu =====');
  // 无 token 情况下探测公开端点
  const urls = [
    'https://api.tianditu.gov.cn/geocoder?ds={"keyWord":"北京"}&tk=test',
    'https://t0.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetCapabilities',
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
      const txt = await r.text();
      console.log(r.status, u.slice(0, 60), '->', txt.slice(0, 120).replace(/\n/g, ' '));
    } catch (e) {
      console.log('FAIL', u.slice(0, 60), e.message);
    }
  }
}

await testAmap();
const ref = process.argv[2] || 'G219';
await testRelation(ref);
await testTianditu();
