/**
 * stations-geo 错位审计（比 verify midFar 更细）：
 * 1) 国境/区域锚点违规
 * 2) 走廊 hints 投影距离（soft≥5 / hard≥12）
 * 3) 同廊进度倒挂（襄阳东级：贴轨但钉错公里）
 * 4) corridor seed 偏离宿主 / 跨廊错钉
 * 5) 方位后缀对（安阳 vs 安阳东）异常远距
 *
 *   node scripts/audit-stations-geo.mjs
 *   node scripts/audit-stations-geo.mjs --min-severity soft
 *   node scripts/audit-stations-geo.mjs --json tmp/stations-geo-audit.json
 *   node scripts/audit-stations-geo.mjs --fetch          # Overpass 对照可疑站
 *   node scripts/audit-stations-geo.mjs --fetch --write  # 用 OSM 纠正（不覆盖 wiki）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const corrDir = join(root, 'data/presets/corridors');
const geoPath = join(root, 'data/stations-geo.json');

const wantFetch = process.argv.includes('--fetch');
const wantWrite = process.argv.includes('--write');
const minSeverity = (() => {
  const i = process.argv.indexOf('--min-severity');
  return i >= 0 ? process.argv[i + 1] : 'soft'; // soft | hard
})();
const jsonOut = (() => {
  const i = process.argv.indexOf('--json');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const onlyName = (() => {
  const i = process.argv.indexOf('--name');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const SOFT_KM = 5;
const HARD_KM = 12;
const SEED_MAX_KM = 12;
/** 进度倒挂：相对前一锚站回退超过此里程 → 可疑 */
const BACKTRACK_KM = 25;
/** 方位对：同名根站 vs 东/西/南/北/北站 等，超过此距 → 可疑 */
const SUFFIX_PAIR_MAX_KM = 80;

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** 与 geocode.ts STATION_REGION_ANCHORS 对齐（审计用） */
const STATION_REGION_ANCHORS = {
  潜江: { lng: 112.7685, lat: 30.4212, maxKm: 60 },
  荆州: { lng: 112.209, lat: 30.322, maxKm: 60 },
  宜昌东: { lng: 111.4608, lat: 30.6586, maxKm: 60 },
  枝江北: { lng: 111.751, lat: 30.512, maxKm: 60 },
  仙桃: { lng: 113.387, lat: 30.365, maxKm: 60 },
  天门南: { lng: 113.447, lat: 30.55, maxKm: 60 },
  汉川: { lng: 113.84, lat: 30.65, maxKm: 60 },
  扬州: { lng: 119.346, lat: 32.392, maxKm: 40 },
  扬州东: { lng: 119.55, lat: 32.42, maxKm: 40 },
  泰州: { lng: 119.976, lat: 32.531, maxKm: 40 },
  泰州南: { lng: 119.92, lat: 32.42, maxKm: 40 },
  南通西: { lng: 120.761, lat: 32.104, maxKm: 40 },
  张家港: { lng: 120.669, lat: 31.819, maxKm: 40 },
  六安: { lng: 116.494, lat: 31.717, maxKm: 40 },
  小中甸: { lng: 99.81346, lat: 27.56238, maxKm: 40 },
  香格里拉: { lng: 99.68854, lat: 27.81332, maxKm: 40 },
  怀化南: { lng: 109.98898, lat: 27.51439, maxKm: 25 },
  怀化: { lng: 109.96333, lat: 27.56083, maxKm: 25 },
  贵阳北: { lng: 106.6725, lat: 26.6225, maxKm: 25 },
  宜宾西: { lng: 104.6033361, lat: 28.7257667, maxKm: 30 },
  兴文: { lng: 105.244562, lat: 28.338113, maxKm: 30 },
  千岛湖: { lng: 119.1880833, lat: 29.7374, maxKm: 25 },
  三阳: { lng: 118.801888, lat: 30.029526, maxKm: 25 },
  建德: { lng: 119.5314, lat: 29.6849, maxKm: 30 },
  桐庐: { lng: 119.727725, lat: 29.791394, maxKm: 20 },
  桐庐东: { lng: 119.75968, lat: 29.85729, maxKm: 20 },
  富阳: { lng: 119.955, lat: 30.003, maxKm: 30 },
  长白山: { lng: 128.1219234, lat: 42.4605171, maxKm: 5 },
  安图西: { lng: 128.8876889, lat: 43.1110361, maxKm: 25 },
  大石头南: { lng: 128.4507972, lat: 43.297925, maxKm: 25 },
  襄阳东: { lng: 112.2903833, lat: 32.0162806, maxKm: 15 },
  许昌北: { lng: 113.92425, lat: 34.144447, maxKm: 25 },
  鄢陵南: { lng: 114.134064, lat: 34.065302, maxKm: 25 },
  扶沟南: { lng: 114.381253, lat: 33.997681, maxKm: 25 },
  棋子湾: { lng: 108.8044167, lat: 19.3389778, maxKm: 20 },
  金月湾: { lng: 108.7122333, lat: 18.7802889, maxKm: 20 },
  山阴南: { lng: 112.832057, lat: 39.491682, maxKm: 30 },
  玉山南: { lng: 118.2880639, lat: 28.6499917, maxKm: 25 },
  海阳: { lng: 121.2846167, lat: 36.1214278, maxKm: 30 },
  海阳北: { lng: 120.9549389, lat: 37.0685306, maxKm: 25 },
  鹤壁: { lng: 114.26732889, lat: 35.76007389, maxKm: 25 },
  鹤壁东: { lng: 114.2948806, lat: 35.7055722, maxKm: 25 },
  淮阳南: { lng: 114.896263, lat: 33.504908, maxKm: 25 },
  溆浦: { lng: 110.573708, lat: 27.929358, maxKm: 30 },
  溆浦南: { lng: 110.5887194, lat: 27.6082361, maxKm: 20 },
  新化: { lng: 111.29777, lat: 27.731218, maxKm: 30 },
  新化南: { lng: 111.1551583, lat: 27.6581333, maxKm: 20 },
  新乡南: { lng: 113.85258806, lat: 35.04253806, maxKm: 25 },
  新余北: { lng: 114.8910417, lat: 27.9154333, maxKm: 25 },
  宜昌北: { lng: 111.4693833, lat: 30.7484194, maxKm: 25 },
};

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function normalize(name) {
  return String(name || '')
    .replace(/站$/, '')
    .trim();
}

function isPlausibleCnRailPoint(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (lng < 73 || lng > 135 || lat < 18 || lat > 54) return false;
  if (lng >= 128.5 && lat < 41.5) return false;
  if (lng >= 138) return false;
  return true;
}

function lookupStation(geo, name) {
  if (!name) return null;
  const key = normalize(name);
  return geo[name] || geo[key] || geo[`${key}站`] || null;
}

function parseCorridorSeedId(source) {
  if (!source || typeof source !== 'string') return null;
  const m = source.match(/corridor:([a-z0-9_]+)/i);
  return m ? m[1] : null;
}

function isWikiSource(source) {
  return typeof source === 'string' && /(^|[+:])wiki\b/i.test(source);
}

function buildPath(coords) {
  const path = coords.map(([lng, lat]) => ({ lng, lat, distFromStart: 0 }));
  let lengthKm = 0;
  for (let i = 1; i < path.length; i++) {
    lengthKm += haversine(path[i - 1], path[i]);
    path[i].distFromStart = lengthKm;
  }
  return { path, lengthKm };
}

function projectToRailway(path, lengthKm, lng, lat) {
  let best = { distKm: Infinity, progress: 0, point: path[0], alongKm: 0 };
  if (!path.length || lengthKm <= 0) return best;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = b.distFromStart - a.distFromStart || 1e-9;
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    const t = Math.max(
      0,
      Math.min(1, ((lng - a.lng) * dx + (lat - a.lat) * dy) / (dx * dx + dy * dy || 1)),
    );
    const point = { lng: a.lng + dx * t, lat: a.lat + dy * t };
    const distKm = haversine({ lng, lat }, point);
    if (distKm < best.distKm) {
      const alongKm = a.distFromStart + segLen * t;
      best = {
        distKm,
        progress: alongKm / lengthKm,
        point,
        alongKm,
      };
    }
  }
  return best;
}

function severityRank(s) {
  return { hard: 3, soft: 2, info: 1 }[s] || 0;
}

function addIssue(byName, issue) {
  const name = normalize(issue.name);
  if (onlyName && name !== normalize(onlyName)) return;
  if (!byName.has(name)) byName.set(name, []);
  byName.get(name).push(issue);
}

const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
const files = readdirSync(corrDir).filter(
  (f) => f.endsWith('.json') && !f.startsWith('_') && !f.includes('__'),
);
const corridorsById = new Map();
const claimMap = new Map();
const built = new Map();

for (const f of files) {
  const c = JSON.parse(readFileSync(join(corrDir, f), 'utf8'));
  if (!c.railway?.length) continue;
  const id = c.id || f.replace(/\.json$/, '');
  corridorsById.set(id, c);
  built.set(id, buildPath(c.railway));
  for (const raw of c.stationsHint || []) {
    const name = normalize(raw);
    if (!claimMap.has(name)) claimMap.set(name, []);
    claimMap.get(name).push(id);
  }
}

/** @type {Map<string, Array<object>>} */
const byName = new Map();

// —— 1) 国境 / 区域锚点 ——
for (const [raw, s] of Object.entries(geo)) {
  const name = normalize(raw);
  if (!s?.lng || !s?.lat) continue;
  if (!isPlausibleCnRailPoint(s.lng, s.lat)) {
    addIssue(byName, {
      name,
      severity: 'hard',
      kind: 'out-of-cn',
      detail: `lng=${s.lng} lat=${s.lat} source=${s.source || '?'}`,
      lng: s.lng,
      lat: s.lat,
      source: s.source,
    });
  }
  const anchor = STATION_REGION_ANCHORS[name];
  if (anchor) {
    const d = haversine({ lng: s.lng, lat: s.lat }, anchor);
    if (d > anchor.maxKm) {
      addIssue(byName, {
        name,
        severity: 'hard',
        kind: 'region-anchor',
        detail: `距锚点 ${d.toFixed(1)}km > ${anchor.maxKm}km`,
        lng: s.lng,
        lat: s.lat,
        source: s.source,
        suggest: { lng: anchor.lng, lat: anchor.lat, source: 'anchor:region' },
      });
    }
  }
}

// —— 2+3) 走廊 hints：投影距离 + 进度倒挂 ——
for (const [id, c] of corridorsById) {
  const hints = (c.stationsHint || []).map(normalize).filter(Boolean);
  if (hints.length < 2) continue;
  const { path, lengthKm } = built.get(id);
  const rows = [];
  for (let i = 0; i < hints.length; i++) {
    const name = hints[i];
    const s = lookupStation(geo, name);
    if (!s?.lng || !s?.lat) {
      rows.push({ i, name, miss: true });
      continue;
    }
    const proj = projectToRailway(path, lengthKm, s.lng, s.lat);
    rows.push({
      i,
      name,
      miss: false,
      distKm: proj.distKm,
      alongKm: proj.alongKm,
      progress: proj.progress,
      lng: s.lng,
      lat: s.lat,
      source: s.source,
    });

    if (proj.distKm >= HARD_KM) {
      addIssue(byName, {
        name,
        severity: 'hard',
        kind: 'midFar',
        corridor: id,
        detail: `距 ${id} ${proj.distKm.toFixed(1)}km`,
        distKm: proj.distKm,
        lng: s.lng,
        lat: s.lat,
        source: s.source,
      });
    } else if (proj.distKm >= SOFT_KM) {
      addIssue(byName, {
        name,
        severity: 'soft',
        kind: 'softFar',
        corridor: id,
        detail: `距 ${id} ${proj.distKm.toFixed(1)}km（门禁未拦）`,
        distKm: proj.distKm,
        lng: s.lng,
        lat: s.lat,
        source: s.source,
      });
    }
  }

  const known = rows.filter((r) => !r.miss);
  if (known.length < 3) continue;

  // 用首末确定方向：沿站序沿程应整体升或整体降
  const first = known[0];
  const last = known[known.length - 1];
  const forward = last.alongKm >= first.alongKm;
  let prev = null;
  for (const r of known) {
    if (!prev) {
      prev = r;
      continue;
    }
    const delta = forward ? r.alongKm - prev.alongKm : prev.alongKm - r.alongKm;
    if (delta < -BACKTRACK_KM) {
      addIssue(byName, {
        name: r.name,
        severity: 'hard',
        kind: 'progress-backtrack',
        corridor: id,
        detail: `${id} 站序 ${prev.name}→${r.name} 沿程回退 ${(-delta).toFixed(1)}km（同廊错公里/飞点）`,
        distKm: r.distKm,
        alongKm: r.alongKm,
        prevAlongKm: prev.alongKm,
        lng: r.lng,
        lat: r.lat,
        source: r.source,
      });
    }
    // 仅当本站贴轨时更新锚（飞点不污染进度链）
    if (r.distKm <= SOFT_KM) prev = r;
  }
}

// —— 4) seed 偏离宿主 / 跨廊 ——
for (const [raw, s] of Object.entries(geo)) {
  const name = normalize(raw);
  if (!s?.lng || !s?.lat) continue;
  const seedId = parseCorridorSeedId(s.source);
  if (!seedId) continue;
  const host = built.get(seedId);
  if (!host) continue;
  const distHost = projectToRailway(host.path, host.lengthKm, s.lng, s.lat).distKm;
  if (distHost > SEED_MAX_KM) {
    addIssue(byName, {
      name,
      severity: 'hard',
      kind: 'seed-off-host',
      corridor: seedId,
      detail: `source→${seedId} 但距宿主 ${distHost.toFixed(1)}km`,
      distKm: distHost,
      lng: s.lng,
      lat: s.lat,
      source: s.source,
    });
  }
  const claimants = claimMap.get(name) || [];
  for (const otherId of claimants) {
    if (otherId === seedId) continue;
    const other = built.get(otherId);
    if (!other) continue;
    const distOther = projectToRailway(other.path, other.lengthKm, s.lng, s.lat).distKm;
    if (distOther < 3 && distHost > 8 && distHost - distOther > 5) {
      addIssue(byName, {
        name,
        severity: 'hard',
        kind: 'cross-claim',
        corridor: seedId,
        detail: `seed ${seedId}@${distHost.toFixed(1)} vs claim ${otherId}@${distOther.toFixed(1)}`,
        lng: s.lng,
        lat: s.lat,
        source: s.source,
      });
    }
  }
}

// —— 5) 方位后缀对（跳过跨省同名：河口南≠河口、巴东≠巴东北 等）——
const SUFFIX_RE = /(东|西|南|北|北站|南站|东站|西站)$/;
/** 根名与带方位名本就不是同城一对 */
const SUFFIX_HOMONYM_SKIP = new Set([
  '河口南|河口',
  '巴东北|巴东',
  '凯里南|凯里', // 高铁南站可距老站较远，soft 阈值另行
]);
const names = [...new Set(Object.keys(geo).map(normalize))];
for (const name of names) {
  if (!SUFFIX_RE.test(name)) continue;
  const base = name.replace(SUFFIX_RE, '');
  if (!base || base.length < 2) continue;
  if (SUFFIX_HOMONYM_SKIP.has(`${name}|${base}`)) continue;
  const a = lookupStation(geo, name);
  const b = lookupStation(geo, base);
  if (!a?.lng || !b?.lng) continue;
  const d = haversine(a, b);
  // 硬：>200km 几乎必有一方飞点；软：80–200 且至少一方非 wiki（避免误伤大城）
  if (d > 200) {
    addIssue(byName, {
      name,
      severity: 'hard',
      kind: 'suffix-pair',
      detail: `与「${base}」相距 ${d.toFixed(0)}km（同城方位站通常 <${SUFFIX_PAIR_MAX_KM}km）`,
      distKm: d,
      lng: a.lng,
      lat: a.lat,
      source: a.source,
      peer: { name: base, lng: b.lng, lat: b.lat, source: b.source },
    });
  } else if (d > SUFFIX_PAIR_MAX_KM && !isWikiSource(a.source) && !isWikiSource(b.source)) {
    addIssue(byName, {
      name,
      severity: 'soft',
      kind: 'suffix-pair',
      detail: `与「${base}」相距 ${d.toFixed(0)}km（同城方位站通常 <${SUFFIX_PAIR_MAX_KM}km）`,
      distKm: d,
      lng: a.lng,
      lat: a.lat,
      source: a.source,
      peer: { name: base, lng: b.lng, lat: b.lat, source: b.source },
    });
  }
}

function worstSeverity(issues) {
  return issues.reduce((w, x) => (severityRank(x.severity) > severityRank(w) ? x.severity : w), 'info');
}

const minRank = severityRank(minSeverity);
const stations = [...byName.entries()]
  .map(([name, issues]) => {
    const filtered = issues.filter((x) => severityRank(x.severity) >= minRank);
    if (!filtered.length) return null;
    return {
      name,
      severity: worstSeverity(filtered),
      issues: filtered,
      source: lookupStation(geo, name)?.source,
      lng: lookupStation(geo, name)?.lng,
      lat: lookupStation(geo, name)?.lat,
    };
  })
  .filter(Boolean)
  .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.name.localeCompare(b.name, 'zh'));

console.log(
  `AUDIT stations-geo: suspects=${stations.length} (min=${minSeverity}) totalGeo=${Object.keys(geo).length}`,
);
const hard = stations.filter((s) => s.severity === 'hard');
const soft = stations.filter((s) => s.severity === 'soft');
console.log(`  hard=${hard.length} soft=${soft.length}`);

for (const s of stations.slice(0, 80)) {
  const top = s.issues[0];
  console.log(
    `${s.severity.toUpperCase()} ${s.name}: ${top.kind} ${top.detail}${s.issues.length > 1 ? ` (+${s.issues.length - 1})` : ''}`,
  );
}
if (stations.length > 80) console.log(`  ... +${stations.length - 80} more`);

async function overpassLookup(namesBatch) {
  const unique = [...new Set(namesBatch.map(normalize).filter(Boolean))];
  const found = new Map();
  if (!unique.length) return found;
  const bbox = '18,73,54,135';
  const clauses = unique
    .flatMap((n) => {
      const withStation = n.endsWith('站') ? n : `${n}站`;
      return [
        `node["railway"="station"]["name"="${n}"](${bbox});`,
        `node["railway"="station"]["name"="${withStation}"](${bbox});`,
        `node["railway"="station"]["name:zh"="${n}"](${bbox});`,
        `node["railway"="station"]["name:zh"="${withStation}"](${bbox});`,
        `node["railway"="halt"]["name"="${n}"](${bbox});`,
        `node["railway"="halt"]["name:zh"="${n}"](${bbox});`,
      ];
    })
    .join('\n');
  const query = `[out:json][timeout:25];\n(\n${clauses}\n);\nout center;`;

  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'RailVista/0.1 (station-geo audit)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(28000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const best = new Map();
      for (const el of json.elements || []) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) continue;
        if (!isPlausibleCnRailPoint(lon, lat)) continue;
        const tagName = normalize(el.tags?.['name:zh'] || el.tags?.name || '');
        for (const requested of unique) {
          if (tagName !== requested && tagName !== `${requested}`) continue;
          let score = el.tags?.railway === 'station' ? 60 : 20;
          if ((el.tags?.['name:zh'] || '') === `${requested}站`) score += 40;
          const prev = best.get(requested);
          if (!prev || score > prev.score) {
            best.set(requested, { lng: lon, lat, score });
          }
        }
      }
      for (const [k, v] of best) found.set(k, v);
      return found;
    } catch {
      /* try next */
    }
  }
  return found;
}

function canOverwrite(src) {
  if (!src) return true;
  if (isWikiSource(src)) return false;
  return true;
}

async function maybeFetchAndFix() {
  if (!wantFetch) return;
  const targets = stations.filter((s) => s.severity === 'hard' || s.issues.some((i) => i.kind === 'progress-backtrack'));
  console.log(`\nFETCH Overpass for ${targets.length} suspects…`);
  const BATCH = 12;
  let fixed = 0;
  let compared = 0;
  const fixes = [];

  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const osm = await overpassLookup(batch.map((x) => x.name));
    await new Promise((r) => setTimeout(r, 1100));
    for (const s of batch) {
      const hit = osm.get(s.name);
      if (!hit) {
        console.log(`  MISS OSM ${s.name}`);
        continue;
      }
      const cur = lookupStation(geo, s.name);
      if (!cur?.lng) continue;
      const delta = haversine(cur, hit);
      compared += 1;
      // 区域锚点过滤 OSM 误匹配
      const anchor = STATION_REGION_ANCHORS[s.name];
      if (anchor && haversine(hit, anchor) > anchor.maxKm) {
        console.log(`  SKIP OSM ${s.name}: OSM 出区域锚点`);
        continue;
      }
      if (delta < 3) {
        console.log(`  OK ${s.name}: OSM Δ=${delta.toFixed(2)}km`);
        continue;
      }
      console.log(
        `  DIFF ${s.name}: Δ=${delta.toFixed(1)}km  (${cur.lng.toFixed(4)},${cur.lat.toFixed(4)}) → (${hit.lng.toFixed(4)},${hit.lat.toFixed(4)})`,
      );
      fixes.push({ name: s.name, from: { ...cur }, to: hit, delta });
      if (wantWrite && canOverwrite(cur.source)) {
        geo[s.name] = {
          name: s.name,
          lng: Number(hit.lng.toFixed(6)),
          lat: Number(hit.lat.toFixed(6)),
          source: 'osm:audit',
          telecode: cur.telecode,
        };
        // 清掉带「站」后缀的重复键若存在且同源
        const withZhan = `${s.name}站`;
        if (geo[withZhan] && canOverwrite(geo[withZhan].source)) {
          geo[withZhan] = { ...geo[s.name], name: withZhan };
        }
        fixed += 1;
      } else if (wantWrite && isWikiSource(cur.source)) {
        console.log(`  PROTECT wiki ${s.name}`);
      }
    }
  }

  if (wantWrite && fixed) {
    writeFileSync(geoPath, JSON.stringify(geo, null, 0));
    console.log(`\nWRITE stations-geo: fixed=${fixed}`);
  } else {
    console.log(`\nFETCH done compared=${compared} wouldFix=${fixes.length} (use --write to apply)`);
  }
  return fixes;
}

const report = {
  generatedAt: new Date().toISOString(),
  totals: { hard: hard.length, soft: soft.length, suspects: stations.length },
  stations,
};

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${jsonOut}`);
}

await maybeFetchAndFix();
