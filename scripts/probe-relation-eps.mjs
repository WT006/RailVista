// 逐 Overpass 端点核查国道 route relation 是否存在及成员覆盖
const EPS = [
  ['mailru', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'],
  ['de', 'https://overpass-api.de/api/interpreter'],
  ['ch', 'https://overpass.osm.ch/api/interpreter'],
  ['kumi', 'https://overpass.kumi.systems/api/interpreter'],
];
const UA = 'RailVista/0.4.0 (drive-net-builder)';
const ref = process.argv[2] || 'G219';

const queries = {
  // 标准：route=road + ref
  standard: `[out:json][timeout:120];rel["route"="road"]["ref"="${ref}"];out body;`,
  // 任意 type=route
  anyType: `[out:json][timeout:120];rel["ref"="${ref}"];out body;`,
};

for (const [name, ep] of EPS) {
  for (const [qn, q] of Object.entries(queries)) {
    try {
      const r = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) { console.log(`${name} ${qn}: HTTP ${r.status}`); continue; }
      const j = await r.json();
      const rels = (j.elements || []).filter((e) => e.type === 'relation');
      const desc = rels.map((x) => `id=${x.id} type=${x.tags?.type} route=${x.tags?.route} members=${(x.members||[]).length}`);
      console.log(`${name} ${qn}: ${rels.length} rels ${JSON.stringify(desc)}`);
    } catch (e) {
      console.log(`${name} ${qn}: FAIL ${e.message}`);
    }
  }
}
