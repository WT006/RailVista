// 查 OSM 上所有 ref=G219 的 way
const queries = [
  // 多种 ref 写法
  '[out:json][timeout:180];way["ref"="G219"]["highway"];out geom;',
  '[out:json][timeout:180];way["ref"="G 219"]["highway"];out geom;',
  '[out:json][timeout:180];way["ref"~"^G ?219$"]["highway"];out geom;',
];
const SERVER = 'https://overpass.osm.ch/api/interpreter';
(async () => {
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    console.log(`\n=== 尝试 ${i + 1}: ${q} ===`);
    try {
      const r = await fetch(SERVER + '?data=' + encodeURIComponent(q), {
        headers: { 'User-Agent': 'RailVista-road-gap-research/1.0' },
      });
      const txt = await r.text();
      if (r.status !== 200) {
        console.log('status:', r.status, '· 首 200:', txt.slice(0, 200));
        continue;
      }
      const j = JSON.parse(txt);
      const ways = (j.elements || []).filter((e) => e.type === 'way');
      let totalNodes = 0;
      const samples = [];
      for (const w of ways) {
        totalNodes += (w.geometry || []).length;
        if (samples.length < 5) samples.push({ id: w.id, ref: w.tags?.ref, name: w.tags?.name, highway: w.tags?.highway, nodes: (w.geometry || []).length });
      }
      console.log('ways:', ways.length, '· 总 nodes:', totalNodes);
      console.log('样本:', JSON.stringify(samples, null, 2));
    } catch (e) {
      console.log('ERR:', e.message);
    }
  }
})();
