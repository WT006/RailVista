/**
 * 全库景点坐标校准（按 docs/scenic-spots-location-verify.md）
 *
 * 规则：
 * - 具名点：钉 Wikidata/Nominatim 本体真值；加大 maxDistKm，禁止吸到车站
 * - 大面积：本体范围内适当靠轨（向最近走廊插值）
 * - 看不见（真值离轨过远且非 distant 可覆盖）→ 报告 reject，不造望点
 *
 * 用法：
 *   node scripts/calibrate-scenic-spot-locations.mjs           # 干跑报告
 *   node scripts/calibrate-scenic-spot-locations.mjs --write   # 写 patches + 应用进 scenic-spots.json
 *   node scripts/calibrate-scenic-spot-locations.mjs --write --fetch  # 含外部真值检索
 *
 * 产出：
 *   data/presets/_scenic-calibration-report.json
 *   data/presets/scenic-spot-calibration-patches.json
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const FETCH = process.argv.includes('--fetch');
const UA = 'RailVistaScenicCalibrate/1.0 (local; scenic spot QA)';

const DEFAULT_MAX = { on_track: 3, window: 8, distant: 35 };

function haversineKm(a, b) {
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

function projectToPoly(path, lng, lat) {
  let best = { distKm: Infinity, point: { lng: path[0][0], lat: path[0][1] }, idx: 0 };
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const denom = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((lng - a[0]) * dx + (lat - a[1]) * dy) / denom));
    const point = { lng: a[0] + dx * t, lat: a[1] + dy * t };
    const distKm = haversineKm({ lng, lat }, point);
    if (distKm < best.distKm) best = { distKm, point, idx: i };
  }
  return best;
}

function decimalPlaces(n) {
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

function cleanQueryName(name) {
  return String(name)
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/方向/g, '')
    .replace(/远眺/g, '')
    .replace(/一带/g, '')
    .trim();
}

/** 大面积 / 廊道类：可靠轨；具名点：钉真值 */
function classifySpot(s) {
  const name = s.name || '';
  const cat = s.category || 'other';
  const id = s.id || '';

  if (s.visibility === 'on_track') return 'on_track';

  const namedHints =
    /古城|长城|大佛|石窟|寺庙|寺$|塔$|峰$|雪山|丹霞|莫高窟|土楼|瀑布|大桥|特大桥|海峡|展线|盐桥|人字桥|天门山|武陵源|凤凰|宏村|西递|三星堆|乐山|华山|泰山|黄山|长白山|峨眉|九华|武当|壶口|都江堰|鼓浪屿|外滩|陆家嘴/;
  if (namedHints.test(name) || /peak|mountain|grotto|bridge|pass|wall|pagoda|temple/i.test(id)) {
    if (cat === 'mountain' || cat === 'engineering' || cat === 'other' || cat === 'gorge') {
      // 山麓/盆地等广域名例外
      if (/盆地|平原|戈壁|花海|北麓|南麓|无人区|草原|湿地|海岸|滨海|田园|峰林|峡谷段/.test(name)) {
        return 'area';
      }
      return 'named';
    }
  }

  if (
    cat === 'lake' ||
    cat === 'desert' ||
    cat === 'grassland' ||
    /盆地|平原|戈壁|花海|北麓|南麓|无人区|草原|湿地|海岸|滨海|田园|盐湖|湖$|江$|河$|海$|峡$|湾|沙漠|雅丹|胡杨|油菜|茶山|雨林|峰丛|喀斯特/.test(
      name,
    )
  ) {
    return 'area';
  }

  if (s.visibility === 'distant') return 'named';
  return 'area';
}

function prefixCorridorId(spotId) {
  const m = String(spotId).match(/^([a-z0-9]+)-/);
  if (!m) return null;
  const p = m[1];
  // 非走廊前缀的景点 id
  const skip = new Set([
    'qinghai',
    'chaerhan',
    'qaidam',
    'kunlun',
    'yuzhu',
    'kekexili',
    'wudaoliang',
    'fenghuoshan',
    'tuotuohe',
    'tongtian',
    'sanjiangyuan',
    'tanggula',
    'geladandong',
    'cuona',
    'qiangtang',
    'nyainqentanglha',
    'namtso',
    'yangbajing',
    'yarlung',
    'zang',
    'nyingchi',
    'namcha',
    'yamdrok',
    'shigatse',
    'sanxingdui',
    'minjiang',
    'songpan',
    'huanglong',
    'menyuan',
    'qilian',
    'hexi',
    'zhangye',
    'jiayuguan',
    'turpan',
    'hami',
    'dunhuang',
    'yardang',
    'dangjinshan',
    'emerald',
    'altun',
    'taitema',
    'desert',
    'tianshan',
    'bosten',
    'kuqa',
    'tarim',
    'pamir',
    'ejina',
    'badan',
    'heishui',
    'juyan',
    'lashi',
    'tiger',
    'haba',
    'xiaozhongdian',
    'shangri',
    'yuanjiang',
    'puer',
    'xishuangbanna',
    'dai',
    'mohan',
    'erhai',
    'bai',
    'dadu',
    'jinkouhe',
    'anning',
    'qionghai',
    'jinsha',
    'renzi',
    'bisezhai',
    'wantang',
    'hekou',
    'puzhehei',
    'guangnan',
    'baise',
    'wuling',
    'yesanguan',
    'enshi',
    'qingjiang',
    'three',
    'wujiang',
    'guilin',
    'yangshuo',
    'miaoling',
    'hanzhong',
    'leshan',
    'shunan',
    'wumeng',
    'zunyi',
    'jialing',
    'lingguanxia',
    'zhangjiajie',
    'tianmen',
    'furong',
    'aizhai',
    'fenghuang',
    'zhenyuan',
    'wuyang',
    'kaili',
    'taiping',
    'yixian',
    'fuchun',
    'qiandao',
    'jixi',
    'wuyuan',
    'sanqingshan',
    'wuyishan',
    'wanning',
    'sanya',
    'wenchang',
    'xiamen',
    'yuedong',
    'yabuli',
    'xuexiang',
    'mudanjiang',
    'gongger',
    'dari',
    'bashang',
    'ulat',
    'badaling',
    'guanting',
    'poyang',
    'jingdezhen',
    'lamulatso',
    'meili',
    'dukezong',
    'guozigou',
    'sailimu',
    'nalati',
    'fuxian',
    'caohai',
    'beipanjiang',
    'malinghe',
    'lancang',
    'nujiang',
    'shuihong',
    'xiaozhai',
    'xingwen',
    'zhijin',
    'wugongshan',
    'zhangshiyan',
    'daxinganling',
    'hulunbuir',
    'mingsha',
    'yueyaquan',
    'gurbantunggut',
    'mengdong',
    'wanquan',
    'boao',
    'beibu',
    'qiongzhou',
    'luoping',
    'hani',
    'congjiang',
    'tulou',
    'wulin',
    'hakka',
    'gongyi',
    'liangshan',
    'dali',
    'jianshui',
    'wudang',
    'gulongzhong',
    'heijing',
    'shanhaiguan',
    'hanguguan',
    'lingqu',
    'leifeng',
    'yixiantian',
    'qingshuihe',
    'xingfuyuan',
    'lujiazui',
    'zhujiang',
    'chongqing',
    'hzmb',
    'wuhan',
    'nanjing',
    'banna',
    'taklamakan',
    'yulong',
    'qinling',
    'hainan',
    'pingtan',
    'changbai',
    'huangshan',
    'yellow',
  ]);
  if (skip.has(p)) return null;
  return p;
}

function loadCorridors() {
  const dir = join(root, 'data/presets/corridors');
  const map = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f.includes('__')) continue;
    const c = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (c.id && Array.isArray(c.railway) && c.railway.length >= 2) {
      map.set(c.id, c.railway);
    }
  }
  const z8991 = join(root, 'data/presets/z8991-railway.json');
  if (existsSync(z8991)) {
    map.set('qingzang', JSON.parse(readFileSync(z8991, 'utf8')));
  }
  return map;
}

function nearestCorridor(corridors, lng, lat, preferId) {
  let best = null;
  const tryIds = preferId && corridors.has(preferId) ? [preferId, ...corridors.keys()] : [...corridors.keys()];
  const seen = new Set();
  for (const id of tryIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const path = corridors.get(id);
    if (!path) continue;
    const proj = projectToPoly(path, lng, lat);
    if (!best || proj.distKm < best.distKm) {
      best = { corridorId: id, ...proj };
    }
    // 若 prefer 走廊已足够近，不必扫完全部
    if (preferId && id === preferId && proj.distKm < 40) break;
  }
  return best;
}

function loadStations() {
  const geo = JSON.parse(readFileSync(join(root, 'data/stations-geo.json'), 'utf8'));
  return Object.values(geo).filter((s) => s && Number.isFinite(s.lng) && Number.isFinite(s.lat));
}

function nearestStation(stations, lng, lat) {
  let best = { distKm: Infinity, station: null };
  for (const st of stations) {
    const d = haversineKm({ lng, lat }, st);
    if (d < best.distKm) best = { distKm: d, station: st };
  }
  return best;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchWikidataBatch(names) {
  const values = names.map((n) => `"${n.replace(/"/g, '')}"@zh`).join(' ');
  const sparql = `
SELECT ?label ?item ?coord WHERE {
  VALUES ?label { ${values} }
  ?item rdfs:label ?label.
  ?item wdt:P625 ?coord.
}
`;
  // POST 避免超长 GET；超时放宽
  const res = await fetch('https://query.wikidata.org/sparql', {
    method: 'POST',
    headers: {
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: new URLSearchParams({ query: sparql, format: 'json' }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`wikidata ${res.status}`);
  const json = await res.json();
  const map = new Map();
  for (const b of json.results?.bindings || []) {
    const label = b.label?.value;
    const item = b.item?.value?.split('/').pop();
    const coord = b.coord?.value;
    if (!label || !coord) continue;
    const m = coord.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
    if (!m) continue;
    const lng = Number(m[1]);
    const lat = Number(m[2]);
    if (lng < 73 || lng > 135 || lat < 18 || lat > 54) continue;
    if (!map.has(label)) map.set(label, { wikidataId: item, lng, lat });
  }
  return map;
}

function persistTruthCache(spots, truthByQuery, truthCachePath) {
  const items = spots.map((s) => {
    const q = cleanQueryName(s.name);
    const t = truthByQuery.get(q);
    if (!t || t.lng == null) return { spotId: s.id, spotName: s.name, queryName: q, wikidataId: null };
    return {
      spotId: s.id,
      spotName: s.name,
      queryName: q,
      wikidataId: t.wikidataId || null,
      lng: t.lng,
      lat: t.lat,
      source: t.source || 'wikidata',
      distKmFromSpot: Number(haversineKm(s, t).toFixed(2)),
    };
  });
  writeFileSync(
    truthCachePath,
    JSON.stringify({ updated: new Date().toISOString().slice(0, 10), items }, null, 2) + '\n',
    'utf8',
  );
  return items.filter((i) => i.lng != null).length;
}

async function fetchNominatim(name) {
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({
      q: name,
      countrycodes: 'cn',
      format: 'json',
      limit: '3',
    });
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  const arr = await res.json();
  if (!Array.isArray(arr) || !arr.length) return null;
  const ranked = [...arr].sort((a, b) => {
    const score = (x) => {
      let s = Number(x.importance) || 0;
      if (/peak|volcano|attraction|park|reservoir|lake|river/.test(x.class + x.type)) s += 1;
      return s;
    };
    return score(b) - score(a);
  });
  const hit = ranked[0];
  return { lng: Number(hit.lon), lat: Number(hit.lat), source: 'nominatim', osm: hit.osm_type + hit.osm_id };
}

function lerpTowardRail(feature, railPoint, pull = 0.55) {
  // pull=0 保留真值；pull=1 完全到轨；大面积用中等靠轨
  return {
    lng: feature.lng + (railPoint.lng - feature.lng) * pull,
    lat: feature.lat + (railPoint.lat - feature.lat) * pull,
  };
}

function ensureMaxDist(visibility, distKm, current) {
  const base = current ?? DEFAULT_MAX[visibility] ?? 8;
  const need = Math.ceil(distKm * 1.15 * 10) / 10;
  if (need <= base) return current;
  // distant 上限 50；window 升到 distant 由调用方处理
  return Math.min(Math.max(need, base), visibility === 'distant' ? 50 : Math.max(base, need));
}

async function main() {
  const spotsDoc = JSON.parse(readFileSync(join(root, 'data/presets/scenic-spots.json'), 'utf8'));
  const spots = spotsDoc.spots;
  const corridors = loadCorridors();
  const stations = loadStations();

  const truthCachePath = join(root, 'data/presets/_scenic-wikidata-truths.json');
  let truthByQuery = new Map();
  if (existsSync(truthCachePath)) {
    const cached = JSON.parse(readFileSync(truthCachePath, 'utf8'));
    for (const it of cached.items || []) {
      if (it.queryName && it.lng != null) truthByQuery.set(it.queryName, it);
    }
    console.log(`loaded truth cache: ${truthByQuery.size}`);
  }

  if (FETCH) {
    const queries = [...new Set(spots.map((s) => cleanQueryName(s.name)).filter(Boolean))];
    const pending = queries.filter((q) => !truthByQuery.has(q));
    console.log(`fetching wikidata: ${pending.length} pending / ${queries.length} total (cache ${truthByQuery.size})`);
    for (let i = 0; i < pending.length; i += 25) {
      const batch = pending.slice(i, i + 25);
      try {
        const map = await fetchWikidataBatch(batch);
        for (const [label, v] of map) {
          truthByQuery.set(label, { queryName: label, ...v, source: 'wikidata' });
        }
        const hit = persistTruthCache(spots, truthByQuery, truthCachePath);
        console.log(`  batch ${Math.floor(i / 25) + 1}/${Math.ceil(pending.length / 25)}: +${map.size} (cache hits ${hit})`);
      } catch (e) {
        console.warn(`  batch failed: ${e.message}`);
      }
      await sleep(1500);
    }
    // Nominatim 补缺（限流）；已命中的跳过
    let miss = queries.filter((q) => !truthByQuery.has(q));
    const namedMiss = miss.filter((q) =>
      /山|湖|城|峡|桥|寺|峰|关|林|海|江|河|泉|窟|楼|寨|坝|湿地|草原|沙漠|丹霞|雪山|古城|盐桥|盆地|平原/.test(q),
    );
    miss = namedMiss.slice(0, 80);
    console.log(`nominatim for ${miss.length} named misses (of ${queries.filter((q) => !truthByQuery.has(q)).length} total miss)...`);
    let ni = 0;
    for (const q of miss) {
      ni += 1;
      try {
        const hit = await fetchNominatim(q);
        if (hit) {
          truthByQuery.set(q, { queryName: q, ...hit });
          console.log(`  nominatim ${ni}/${miss.length}: ${q} ok`);
        } else {
          console.log(`  nominatim ${ni}/${miss.length}: ${q} empty`);
        }
      } catch (e) {
        console.warn(`  nominatim ${q}: ${e.message}`);
      }
      if (ni % 5 === 0) persistTruthCache(spots, truthByQuery, truthCachePath);
      await sleep(1100);
    }
    const hit = persistTruthCache(spots, truthByQuery, truthCachePath);
    console.log(`wrote ${truthCachePath} (withCoord ${hit})`);
  }

  const patches = [];
  const report = [];

  for (const s of spots) {
    const kind = classifySpot(s);
    const prefer = prefixCorridorId(s.id);
    // 青藏系无前缀走廊
    const prefer2 =
      prefer ||
      (['qinghai-lake', 'chaerhan-salt-bridge', 'qaidam-gobi', 'kunlun-pass', 'yuzhu-peak', 'kekexili', 'wudaoliang', 'fenghuoshan', 'tuotuohe-source', 'tongtian-river', 'sanjiangyuan', 'tanggula-pass', 'geladandong', 'cuona-lake', 'qiangtang-grassland', 'nyainqentanglha', 'namtso-distant', 'yangbajing-geothermal', 'qingshuihe-bridge-qingzang'].includes(s.id)
        ? 'qingzang'
        : null);

    const railNow = nearestCorridor(corridors, s.lng, s.lat, prefer2);
    const sta = nearestStation(stations, s.lng, s.lat);
    const q = cleanQueryName(s.name);
    const truth = truthByQuery.get(q);
    // 同名错配守卫：真值相对策展旧点飞得过远则忽略
    const truthOk = (() => {
      if (!truth || truth.lng == null) return null;
      const moved = haversineKm(s, truth);
      const coarse = decimalPlaces(s.lng) <= 1 || decimalPlaces(s.lat) <= 1;
      const maxMove = coarse ? 120 : 80;
      if (moved > maxMove) return null;
      // 真值也必须能关联到合理走廊（prefer 或全局最近 < 100km）
      const railT = nearestCorridor(corridors, truth.lng, truth.lat, prefer2);
      if (!railT || railT.distKm > 100) return null;
      if (prefer2 && railT.corridorId !== prefer2 && railT.distKm > 40) {
        // 允许全局最近走廊，但若 prefer 存在且真值离 prefer 走廊很远则可疑
        const preferRail = corridors.has(prefer2)
          ? projectToPoly(corridors.get(prefer2), truth.lng, truth.lat)
          : null;
        if (preferRail && preferRail.distKm > 80) return null;
      }
      return truth;
    })();
    const coarse = decimalPlaces(s.lng) <= 1 || decimalPlaces(s.lat) <= 1;
    const maxNow = s.maxDistKm ?? DEFAULT_MAX[s.visibility] ?? 8;

    const row = {
      id: s.id,
      name: s.name,
      kind,
      old: { lng: s.lng, lat: s.lat, visibility: s.visibility, maxDistKm: s.maxDistKm ?? null },
      corridorId: railNow?.corridorId ?? null,
      distRailKm: railNow ? Number(railNow.distKm.toFixed(2)) : null,
      nearStation: sta.distKm < 0.8 ? sta.station?.name : null,
      stationDistKm: Number(sta.distKm.toFixed(2)),
      coarse,
      truth: truthOk
        ? {
            lng: truthOk.lng,
            lat: truthOk.lat,
            source: truthOk.source || 'wikidata',
            distFromOld: Number(haversineKm(s, truthOk).toFixed(2)),
          }
        : truth
          ? { rejected: true, distFromOld: Number(haversineKm(s, truth).toFixed(2)), lng: truth.lng, lat: truth.lat }
          : null,
      action: 'keep',
      reason: '',
    };

    // on_track：保留近轨；若离轨远则靠轨
    if (kind === 'on_track') {
      if (railNow && railNow.distKm > 3) {
        const p = railNow.point;
        patches.push({
          id: s.id,
          lng: Number(p.lng.toFixed(6)),
          lat: Number(p.lat.toFixed(6)),
          reason: 'on_track_snap',
        });
        row.action = 'snap_on_track';
        row.reason = 'on_track too far from rail';
      } else {
        row.action = 'keep';
        row.reason = 'on_track ok';
      }
      report.push(row);
      continue;
    }

    // 车站吸附：当前点几乎贴站，且有真值离站更远 → 改真值
    const adsorbed =
      sta.distKm < 0.6 &&
      truthOk &&
      haversineKm(truthOk, sta.station) > 2 &&
      haversineKm(s, truthOk) > 1.5;

    if (kind === 'named') {
      if (truthOk) {
        const railAtTruth = nearestCorridor(corridors, truthOk.lng, truthOk.lat, prefer2);
        const dist = railAtTruth?.distKm ?? Infinity;
        // 真值过远看不见：>55km 且非明确远眺可及 → reject 仅报告
        if (dist > 55) {
          row.action = 'reject_or_manual';
          row.reason = `named truth ${dist.toFixed(1)}km from rail — review visibility`;
          const patch = {
            id: s.id,
            lng: Number(truthOk.lng.toFixed(6)),
            lat: Number(truthOk.lat.toFixed(6)),
            visibility: 'distant',
            maxDistKm: Math.min(50, Math.ceil(dist * 1.1)),
            reason: 'named_truth_far',
          };
          if (dist <= 80) {
            patches.push(patch);
            row.action = 'set_truth_distant';
          }
        } else {
          const vis = dist > DEFAULT_MAX.window ? 'distant' : s.visibility === 'on_track' ? 'distant' : s.visibility;
          const maxDistKm = ensureMaxDist(vis === 'window' && dist > 8 ? 'distant' : vis, dist, s.maxDistKm);
          const patch = {
            id: s.id,
            lng: Number(truthOk.lng.toFixed(6)),
            lat: Number(truthOk.lat.toFixed(6)),
            reason: adsorbed ? 'unstick_station_to_truth' : 'named_truth',
          };
          if (dist > 8) patch.visibility = 'distant';
          if (maxDistKm != null && maxDistKm !== s.maxDistKm) patch.maxDistKm = maxDistKm;
          if (haversineKm(s, truthOk) > 0.35 || patch.visibility || patch.maxDistKm || adsorbed) {
            patches.push(patch);
            row.action = patch.reason;
          } else {
            row.action = 'keep';
            row.reason = 'already near truth';
          }
        }
      } else if (adsorbed) {
        row.action = 'manual_station_adsorb';
        row.reason = 'on station but no truth';
      } else if (coarse && railNow && railNow.distKm > 12) {
        const p = lerpTowardRail(s, railNow.point, 0.7);
        patches.push({
          id: s.id,
          lng: Number(p.lng.toFixed(6)),
          lat: Number(p.lat.toFixed(6)),
          reason: 'named_coarse_pull_rail',
        });
        row.action = 'coarse_pull';
      } else {
        row.action = truth ? 'keep_bad_truth_rejected' : 'keep_no_truth';
        row.reason = truth ? 'homonym truth rejected' : 'no external truth';
      }
      report.push(row);
      continue;
    }

    // area：有可信真值则从真值靠轨；否则从当前点靠轨
    const feature = truthOk ? { lng: truthOk.lng, lat: truthOk.lat } : { lng: s.lng, lat: s.lat };
    const railAtFeat = nearestCorridor(corridors, feature.lng, feature.lat, prefer2);
    if (!railAtFeat) {
      row.action = 'keep_no_rail';
      report.push(row);
      continue;
    }

    const dist = railAtFeat.distKm;
    let target;
    let reason;
    if (dist <= 3) {
      target = truthOk ? feature : { lng: s.lng, lat: s.lat };
      reason = truthOk ? 'area_truth_near_rail' : 'area_ok';
    } else if (dist <= 25) {
      target = lerpTowardRail(feature, railAtFeat.point, truthOk ? 0.45 : 0.6);
      reason = truthOk ? 'area_truth_pull_rail' : 'area_pull_rail';
    } else if (dist <= 45) {
      target = lerpTowardRail(feature, railAtFeat.point, 0.75);
      reason = 'area_strong_pull_rail';
    } else {
      row.action = 'reject_or_manual';
      row.reason = `area feature ${dist.toFixed(1)}km from rail`;
      report.push(row);
      continue;
    }

    const railAfter = nearestCorridor(corridors, target.lng, target.lat, prefer2);
    const distAfter = railAfter?.distKm ?? dist;
    let visibility = s.visibility;
    let maxDistKm = s.maxDistKm;
    if (distAfter > (DEFAULT_MAX[visibility] ?? 8)) {
      if (visibility === 'window' && distAfter > 8) visibility = 'distant';
      maxDistKm = ensureMaxDist(visibility, distAfter, maxDistKm);
    }

    const moved = haversineKm(s, target) > 0.4;
    const metaChanged = visibility !== s.visibility || maxDistKm !== s.maxDistKm;
    if (moved || metaChanged || (truthOk && haversineKm(s, truthOk) > 1 && dist <= 3)) {
      const patch = {
        id: s.id,
        lng: Number(target.lng.toFixed(6)),
        lat: Number(target.lat.toFixed(6)),
        reason,
      };
      if (visibility !== s.visibility) patch.visibility = visibility;
      if (maxDistKm != null && maxDistKm !== s.maxDistKm) patch.maxDistKm = maxDistKm;
      patches.push(patch);
      row.action = reason;
    } else {
      row.action = 'keep';
      row.reason = 'area ok';
    }
    report.push(row);
  }

  const reportPath = join(root, 'data/presets/_scenic-calibration-report.json');
  const patchPath = join(root, 'data/presets/scenic-spot-calibration-patches.json');
  const summary = {
    updated: new Date().toISOString().slice(0, 10),
    total: spots.length,
    patches: patches.length,
    byAction: {},
    adsorbedFixed: patches.filter((p) => p.reason === 'unstick_station_to_truth').length,
    namedTruth: patches.filter((p) => p.reason === 'named_truth' || p.reason === 'set_truth_distant').length,
    areaPull: patches.filter((p) => String(p.reason).includes('area')).length,
  };
  for (const r of report) {
    summary.byAction[r.action] = (summary.byAction[r.action] || 0) + 1;
  }

  writeFileSync(reportPath, JSON.stringify({ summary, report }, null, 2) + '\n', 'utf8');
  writeFileSync(
    patchPath,
    JSON.stringify({ version: 1, updated: summary.updated, note: 'auto calibration; applied by build-scenic-spots-curated.mjs', patches }, null, 2) +
      '\n',
    'utf8',
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log(`report -> ${reportPath}`);
  console.log(`patches -> ${patchPath}`);

  if (WRITE) {
    const byId = new Map(patches.map((p) => [p.id, p]));
    let applied = 0;
    for (const s of spots) {
      const p = byId.get(s.id);
      if (!p) continue;
      s.lng = p.lng;
      s.lat = p.lat;
      if (p.visibility) s.visibility = p.visibility;
      if (p.maxDistKm != null) s.maxDistKm = p.maxDistKm;
      applied += 1;
    }
    spotsDoc.updated = summary.updated;
    spotsDoc.note =
      '策展+自动校准：具名钉本体，大面积适当靠轨。见 scenic-spot-calibration-patches.json / docs/scenic-spots-location-verify.md';
    writeFileSync(join(root, 'data/presets/scenic-spots.json'), JSON.stringify(spotsDoc, null, 2) + '\n', 'utf8');
    console.log(`applied ${applied} patches -> scenic-spots.json`);
  } else {
    console.log('dry-run only; pass --write to apply. Pass --fetch to refresh external truths.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
