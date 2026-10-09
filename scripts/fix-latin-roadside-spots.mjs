/**
 * 纠正公路景点库中的外语名 → 中文，并剔除非中国境内 / 邻国串味点。
 *
 *   node scripts/fix-latin-roadside-spots.mjs --dry --skip-fetch
 *   node scripts/fix-latin-roadside-spots.mjs --write --skip-fetch
 *   node scripts/fix-latin-roadside-spots.mjs --write            # 顺带回查 OSM tags
 *
 * 策略：
 *  1) 境内门禁：中国陆地 bbox / 金门马祖 / 喜马拉雅南坡拉丁 / 非 CN country
 *  2) 邻国语言名（越北河江、尼泊尔徒步等）即使坐标在 bbox 内也删
 *  3) 取名：OSM 中文标签 → 词典 → 规则翻译；品牌/官方英文保留；垃圾/无法确认删除
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inHimalayaExteriorBand,
  inKinmenMatsu,
  isAdmissibleHarvestPoi,
} from './lib/china-land.mjs';
import { provinceOfPoint } from './lib/province-bbox.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPOTS_PATH = join(ROOT, 'data/roads/roadside-spots.json');
const CACHE_PATH = join(ROOT, 'data/roads/cache/latin-osm-tags.json');
const REPORT_PATH = join(ROOT, 'data/roads/latin-spots-fix-report.json');
const DICT_PATH = join(ROOT, 'scripts/lib/latin-spot-zh-dict.json');

const DRY = process.argv.includes('--dry');
const WRITE = process.argv.includes('--write');
const SKIP_FETCH = process.argv.includes('--skip-fetch');

const OVERPASS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const CJK_RE = /[\u4e00-\u9fff]/;
const LATIN_NAME_RE = /^[A-Za-z0-9\s\-'’\.\(\)\/,&+:;!?]+$/;
const CHINA_LAND = { minLng: 73.5, minLat: 17.5, maxLng: 134.77, maxLat: 53.56 };

function isWithinChinaLand(lng, lat) {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= CHINA_LAND.minLng &&
    lng <= CHINA_LAND.maxLng &&
    lat >= CHINA_LAND.minLat &&
    lat <= CHINA_LAND.maxLat
  );
}

function isLatinName(name) {
  const n = String(name ?? '').trim();
  if (!n || CJK_RE.test(n)) return false;
  return LATIN_NAME_RE.test(n);
}

function hasCjk(s) {
  return CJK_RE.test(String(s ?? ''));
}

function parseOsmId(id) {
  const m = String(id).match(/^osm-(node|way|relation)-(\d+)$/);
  if (!m) return null;
  return { type: m[1], osmId: Number(m[2]) };
}

async function overpass(query, attempt = 0) {
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'RailVista/fix-latin-roadside-spots',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(120000),
      });
      if (res.status === 429 || res.status === 504 || res.status === 502) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      console.warn(`[overpass] ${url} → ${e.message || e}`);
    }
  }
  if (attempt < 3) {
    const wait = 5000 * (attempt + 1);
    console.warn(`[overpass] 退避 ${wait}ms (${attempt + 1}/3)`);
    await new Promise((r) => setTimeout(r, wait));
    return overpass(query, attempt + 1);
  }
  throw lastErr;
}

function loadTagCache() {
  if (!existsSync(CACHE_PATH)) return new Map();
  try {
    const cached = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    return new Map(Object.entries(cached).map(([k, v]) => [Number(k), v]));
  } catch {
    return new Map();
  }
}

function saveTagCache(map) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(Object.fromEntries(map), null, 0));
}

async function fetchOsmTags(nodeIds) {
  const out = loadTagCache();
  const missing = nodeIds.filter((id) => !out.has(id));
  console.log(`[fetch] 缓存已有 ${out.size}，待抓 ${missing.length}`);
  const batchSize = 40;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    const q = `[out:json][timeout:90];node(id:${batch.join(',')});out tags;`;
    console.log(`[fetch] ${i + 1}–${Math.min(i + batchSize, missing.length)} / ${missing.length}`);
    try {
      const json = await overpass(q);
      for (const el of json.elements || []) {
        if (el.type === 'node' && el.id != null) out.set(el.id, el.tags || {});
      }
      for (const id of batch) if (!out.has(id)) out.set(id, {});
      saveTagCache(out);
    } catch (e) {
      console.warn(`[fetch] 本批失败，已存 ${out.size}：${e.message || e}`);
      saveTagCache(out);
      await new Promise((r) => setTimeout(r, 8000));
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return out;
}

const KEEP_OFFICIAL_EN = [
  /^disney\b/i,
  /^universal\b/i,
  /^hard rock\b/i,
  /^starbucks\b/i,
  /^mcdonald/i,
  /^kfc\b/i,
  /^ikea\b/i,
  /^apple store\b/i,
  /^hilton\b/i,
  /^marriott\b/i,
  /^holiday inn\b/i,
  /^sheraton\b/i,
  /^intercontinental\b/i,
  /^four seasons\b/i,
  /^ritz[- ]carlton\b/i,
  /^hyatt\b/i,
  /^novotel\b/i,
  /^ibis\b/i,
  /^mgm\b/i,
  /^mission hills\b/i,
  /^sunac\b/i,
  /^para site$/i,
  /^island6$/i,
  /^artis\s*tree$/i,
  /^ocata?\b/i,
];

/** 邻国串味 / 境外语言名 */
const FOREIGN_SCENIC_NAME = [
  /\b(sapa|sa pa|dong van|muong hoa|mai pi leng|ma pi leng|quan ba|ha giang|trai tim|thac\b|nui\b|núi\b|pho'?s place|heaven sapa|ban samakhixay|bac sun|cam vut|cong troi|duong hanh|ta van|ta giang|tinh tuc|lung khuy|khau lan|pai lung|grotte tien|tran ton|ban luoc)\b/i,
  /\b(manaslu|namche|lukla|pokhara|kathmandu|everest|lobuche|kongma|chukhung|melamchi|gangtok|sikkim|thimphu|paro|hanuman|chorten|bahrabise|nasim pati|haa valley|larke pass|larkya|tilman pass|hilsha|taru kharka|dhungsel|jharna|kailash mansarow?ar darshan|lapche la|lapcha)\b/i,
  /\b(chogolisa|ghent kangri|sherpi kangri|pangpoche|praqpa|reo purgyil|kataklik|kabang ri|summa ri|dongkya|om parvat|marsimik|ganja la|sinche la)\b/i,
  /\b(cementerio|treffpunkt|eingang|rocas curiosas|mirador)\b/i,
  /\b(loi pangnao|fupingbao|walk to the edge)\b/i,
  /\bnam shan,\s*lantau\b/i,
];

/** 噪声 / 无景点价值 */
const DROP_JUNK_NAME = [
  /^(park|a park|tower|cave|spring|waterfall|pagoda|temple|bridge|lake|river|museum|palace|beach|island|viewpoint|lookout|lookoff|garden|forest|mountain view|sunset view|holy hill|buddha flags|national park|pass|gate|entrance|platform|panorama|panorama view|panoramic view|market|arch|dam|summit|col|quarry|leaky|buddah|tulou|karez|res|csjs|podium)$/i,
  /^(beautiful|nice|amazing|stunning|cool|free|good|entire|new|old|small|huge|remote|unnamed|first)\b/i,
  /^(sunset|sunrise|sundown|lake|river|mountain|valley|bridge|glacier|rice|farmland|bird|canal|flag|temple|pagoda|tower|parking|sea of cloud)\b/i,
  /\b(view point|viewpoint|lookout|photo spot|photospot|instagram)\b/i,
  /^bg\d/i,
  /^(mf|l1|l2|m1|e\d{1,2}|pb\s*\d+|jk\d+)$/i,
  /^[gs]\d{1,4}\b/i,
  /\broad\s*mark/i,
  /^\d{2,4}$/,
  /^\d{3,4}\s*m\b/i,
  /^jump\s*360$/i,
  /^gwm haval\b/i,
  /proving ground/i,
  /^closed\b/i,
  /^start (of|point)\b/i,
  /^on the way\b/i,
  /^to (the|stupa)\b/i,
  /^need to\b/i,
  /^possible camp/i,
  /^a rap,/i,
  /^chess table$/i,
  /^sat(ellite)? dish$/i,
  /^pedestrian\b/i,
  /^parking entry\b/i,
  /^mpemba effect$/i,
  /^ferris$/i,
  /^circus of nego/i,
  /^joezeff\b/i,
  /^ev ralph$/i,
  /^65km\/35km$/i,
  /^1517\b/i,
  /^chinese border$/i,
  /^tibetan border$/i,
  /^hotel near\b/i,
  /^hot spring from nearby/i,
  /^bamboo rafting\b/i,
  /^near led\b/i,
  /^people park$/i,
  /^(monday|friday|sunday|night)\s+(market|bazaar)/i,
  /^street food\b/i,
  /^food street$/i,
  /^huge tea market$/i,
  /^cafe factory$/i,
  /^garden camping$/i,
  /^ski resort$/i,
  /^movie city$/i,
  /^film park$/i,
  /^light (and fire )?show\b/i,
  /^fountain show$/i,
  /^paragliding\b/i,
  /^orthodox grave/i,
  /^japanese tunnel$/i,
  /^air-raid shelter$/i,
  /^pillbox\b/i,
  /^eiffel tower$/i,
  /^stonehenge$/i,
  /^jurassic park$/i,
  /^russia folk town$/i,
  /^mig-17/i,
  /^gallery\s*\d+/i,
  /^place of birth of first karmapa$/i,
  /^chinese cooking workshop$/i,
  /^big bouddha found/i,
  /^fantasy town park/i,
  /^fukui garden$/i,
  /^dragon mountain kungfu/i,
  /^water fall 520/i,
  /^hehe national park/i,
  /^forest park entrance$/i,
  /^xue xi pavillon/i,
  /^pa phi viewpoint$/i,
  /^buddha (flags|statue)$/i,
  /^amazing view on the city$/i,
  /^glass bodem/i,
  /^gace with/i,
  /^aloh cheekoh$/i,
  /^an imposing\b/i,
  /^herb collecting\b/i,
  /^mother and baby$/i,
  /^the awesome\b/i,
  /^the eye of ai$/i,
  /^the house of pig/i,
  /^statue of (florence|man)\b/i,
  /^special villa$/i,
  /^marina maison$/i,
  /^mahlya\b/i,
  /^kwan-jin\b/i,
  /^kern\b/i,
  /^khamar\b/i,
  /^konchok\b/i,
  /^kunchokling\b/i,
  /^noesagang$/i,
  /^pagnueng$/i,
  /^pangthompo$/i,
  /^rebu gang$/i,
  /^ritiling$/i,
  /^ritseling\b/i,
  /^sanglaphu$/i,
  /^saserga$/i,
  /^seo ho$/i,
  /^sonam$/i,
  /^stonecow$/i,
  /^bontela$/i,
  /^chombu$/i,
  /^dolma la$/i,
  /^jhari la\b/i,
  /^jhong cave$/i,
  /^lamla la$/i,
  /^lapthal$/i,
  /^north face lookout of mount kailas$/i,
  /^kailash\b/i,
  /^hill-top viewpoint towards/i,
  /^mt\.\s*manaslu/i,
  /^k2 viewpoint$/i,
  /^(wetlands|zoo|waterwheels?|yurts|waterfalls?|walkbridge|way to stupa)$/i,
  /^danger:/i,
  /^view (to|over|on|of)\b/i,
  /^viewing platform for\b/i,
  /^mushrooms village\b/i,
  /^thach son\b/i,
  /^waterfall quy\b/i,
  /^iang khac/i,
  /^terrace rice fields\b/i,
  /^water wheel$/i,
  /^very bad piece of road\b/i,
  /^you have a road for coming\b/i,
  /^yellow river and mountains$/i,
  /^western sea fleet$/i,
  /^viewing platform$/i,
  /^view up the valley$/i,
  /^1\.\s*bay$/i,
  /^baden-powell\b/i,
  /^gurudongmar$/i,
  /^marble peak$/i,
  /^yanamax$/i,
  /^kangju kangri$/i,
  /^water source$/i,
  /^yang neo$/i,
  /^zbhd spotting\b/i,
  /^y\d{2}$/i,
  /^waterfall \(small\)$/i,
  /^wasserfall$/i,
  /^water fall$/i,
  /^nam keo\b/i,
  /^xiav lagoon$/i,
];

const PINYIN_CHUNKS = [
  [/haizi/gi, '海子'],
  [/qinglong/gi, '青龙'],
  [/kanbula/gi, '坎布拉'],
  [/balagezong/gi, '巴拉格宗'],
  [/tianya\s*haijiao/gi, '天涯海角'],
  [/pingjiang/gi, '平江'],
  [/sanke/gi, '三棵树'],
  [/yuzhu/gi, '玉珠'],
  [/ranwu/gi, '然乌'],
  [/dianchi/gi, '滇池'],
];

function loadProperZh() {
  const base = existsSync(DICT_PATH) ? JSON.parse(readFileSync(DICT_PATH, 'utf8')) : {};
  return new Map(
    Object.entries(base)
      .filter(([, v]) => typeof v === 'string' && /[\u4e00-\u9fff]/.test(v))
      .map(([k, v]) => [k.toLowerCase(), v]),
  );
}

function applyPinyinChunks(s) {
  let out = s;
  for (const [re, zh] of PINYIN_CHUNKS) out = out.replace(re, zh);
  return out;
}

/** 仅当专名头已是中文，或整句为纯描述时返回中文 */
function patternTranslate(name) {
  const n = String(name).trim().replace(/,+$/, '');
  if (!n) return null;

  let m = n.match(/^mountain\s+pass\s+(\d+)\s*m(?:\s+approx)?$/i);
  if (m) return `垭口（约${m[1]}米）`;
  m = n.match(/^(\d+)\s*m\s+mountain\s+pass$/i);
  if (m) return `垭口（约${m[1]}米）`;
  m = n.match(/^pass\s+(\d+)\s*m$/i);
  if (m) return `垭口（约${m[1]}米）`;
  m = n.match(/^(\d+)\s*m\s+pass$/i);
  if (m) return `垭口（约${m[1]}米）`;
  m = n.match(/^(\d+)\s*m\s+(?:pass\s+)?lookout$/i);
  if (m) return `观景台（约${m[1]}米）`;
  m = n.match(/^(\d+)\s*m\s+viewpoint$/i);
  if (m) return `观景点（约${m[1]}米）`;

  m = n.match(/^(.+?)\s+pass\s+(\d+)\s*m(?:\s+approx)?$/i);
  if (m) {
    const head = applyPinyinChunks(m[1].trim());
    if (hasCjk(head) && !/[A-Za-z]{3,}/.test(head)) return `${head}垭口（约${m[2]}米）`;
    return null;
  }

  m = n.match(/^(.+?)\s+Pass$/i);
  if (m) {
    const head = applyPinyinChunks(m[1].trim());
    if (hasCjk(head) && !/[A-Za-z]{3,}/.test(head)) return `${head}垭口`;
    return null;
  }

  m = n.match(/^(.+?)\s+(\d+)\s*m\s+viewing\s+platform$/i);
  if (m) {
    const head = applyPinyinChunks(m[1].trim());
    if (hasCjk(head) && !/[A-Za-z]{3,}/.test(head)) return `${head}观景台（约${m[2]}米）`;
    return null;
  }

  for (const [re, suffix] of [
    [/^(.+?)\s+viewing\s+platform$/i, '观景台'],
    [/^(.+?)\s+lookout$/i, '观景台'],
    [/^(.+?)\s+viewpoint$/i, '观景点'],
    [/^(.+?)\s+national\s+geopark$/i, '国家地质公园'],
    [/^(.+?)\s+wetland\s+park$/i, '湿地公园'],
    [/^(.+?)\s+ancient\s+temple$/i, '古寺'],
    [/^(.+?)\s+road$/i, '路'],
    [/^(.+?)\s+waterfalls?$/i, '瀑布'],
    [/^(.+?)\s+museum$/i, '博物馆'],
  ]) {
    m = n.match(re);
    if (!m) continue;
    const head = applyPinyinChunks(m[1].trim());
    if (hasCjk(head) && !/[A-Za-z]{3,}/.test(head)) return `${head}${suffix}`;
  }

  m = n.match(/^(.+?)\s+national\s+park(?:\s+(west|east)\s+entrance)?$/i);
  if (m) {
    const head = applyPinyinChunks(m[1].trim());
    if (hasCjk(head) && !/[A-Za-z]{3,}/.test(head)) {
      const gate = m[2] ? (String(m[2]).toLowerCase() === 'west' ? '西门' : '东门') : '';
      return `${head}国家公园${gate}`;
    }
  }

  return null;
}

function pickOsmZh(tags) {
  if (!tags) return '';
  for (const k of ['name:zh', 'name:zh-Hans', 'name:zh-Hant', 'name:zh-CN']) {
    const v = String(tags[k] ?? '').trim();
    if (v && hasCjk(v)) return v;
  }
  const local = String(tags.name ?? '').trim();
  if (local && hasCjk(local)) return local;
  for (const k of ['wikipedia:zh', 'wikipedia']) {
    const wiki = String(tags[k] ?? '').trim();
    if (!wiki || (k === 'wikipedia' && !/^zh:/i.test(wiki))) continue;
    const title = wiki.replace(/^zh:/i, '').replace(/_/g, ' ').trim();
    if (title && hasCjk(title)) return title;
  }
  return '';
}

function isForeignScenic(name) {
  return FOREIGN_SCENIC_NAME.some((re) => re.test(name));
}

function shouldKeepOfficialEn(name) {
  return KEEP_OFFICIAL_EN.some((re) => re.test(name));
}

function shouldDropJunk(name) {
  return DROP_JUNK_NAME.some((re) => re.test(name.trim()));
}

/** 常见英文专名：含 Museum/Gallery/Resort 等且非描述句 */
function looksLikeCommonEnglishName(name) {
  const n = String(name).trim();
  if (n.length < 5 || n.length > 72) return false;
  if (/^(the|a|an)\s/i.test(n) && !/\b(museum|gallery|palace|resort)\b/i.test(n)) return false;
  return /\b(museum|gallery|resort|hotel|expo|aquarium|palace museum)\b/i.test(n);
}

function resolveName(spot, liveTags, properZh) {
  const tags = { ...(spot.osmTags || {}), ...(liveTags || {}) };
  const nm = String(spot.name).trim();

  // 邻国串味优先删；词典/OSM 中文优先于「含 viewpoint」类垃圾规则
  if (isForeignScenic(nm)) return { name: nm, action: 'drop_foreign', tags };

  const osmZh = pickOsmZh(tags);
  if (osmZh) return { name: osmZh, action: 'osm_zh', tags };

  const key = nm.toLowerCase().replace(/,+$/, '');
  if (properZh.has(key)) return { name: properZh.get(key), action: 'dict', tags };

  const patterned = patternTranslate(nm);
  if (patterned && hasCjk(patterned) && !/[A-Za-z]{3,}/.test(patterned)) {
    return { name: patterned, action: 'pattern', tags };
  }

  if (shouldDropJunk(nm)) return { name: nm, action: 'drop_junk', tags };

  if (shouldKeepOfficialEn(nm)) return { name: nm, action: 'keep_en', tags };
  if (looksLikeCommonEnglishName(nm) && Number(spot.score || 0) >= 60) {
    return { name: nm, action: 'keep_en', tags };
  }

  return { name: nm, action: 'unresolved', tags };
}

function chinaGate(spot, tags) {
  const lng = Number(spot.lng);
  const lat = Number(spot.lat);
  if (!isWithinChinaLand(lng, lat)) return { ok: false, reason: 'outside_china_bbox' };
  if (inKinmenMatsu(lng, lat)) return { ok: false, reason: 'kinmen_matsu' };
  if (inHimalayaExteriorBand(lng, lat) && isLatinName(spot.name)) {
    return { ok: false, reason: 'himalaya_exterior_latin' };
  }
  if (!isAdmissibleHarvestPoi({ lng, lat, name: spot.name, tags })) {
    return { ok: false, reason: 'admissible_poi_false' };
  }
  return { ok: true, reason: '' };
}

function mergeOsmTags(prev, live) {
  const merged = { ...(prev || {}), ...(live || {}) };
  const prefer = [
    'name:zh',
    'name:zh-Hans',
    'name:zh-Hant',
    'name',
    'name:en',
    'wikipedia:zh',
    'wikipedia',
    'wikidata',
    'tourism',
    'natural',
    'ele',
  ];
  const entries = [];
  const seen = new Set();
  for (const k of prefer) {
    if (merged[k] != null && merged[k] !== '') {
      entries.push([k, merged[k]]);
      seen.add(k);
    }
  }
  for (const [k, v] of Object.entries(merged)) {
    if (seen.has(k) || v == null || v === '') continue;
    entries.push([k, v]);
    if (entries.length >= 16) break;
  }
  return Object.fromEntries(entries.slice(0, 16));
}

async function main() {
  if (!DRY && !WRITE) {
    console.error('请指定 --dry 或 --write');
    process.exit(1);
  }

  const properZh = loadProperZh();
  console.log(`[fix] 词典 ${properZh.size} 条`);

  const doc = JSON.parse(readFileSync(SPOTS_PATH, 'utf8'));
  const spots = Array.isArray(doc.spots) ? doc.spots : [];
  const latin = spots.filter((s) => isLatinName(s.name));
  console.log(`[fix] 全库 ${spots.length}，外语名 ${latin.length}`);

  let liveMap = loadTagCache();
  if (SKIP_FETCH) {
    console.log(`[fix] --skip-fetch：缓存 tags ${liveMap.size}`);
  } else {
    const ids = latin.map((s) => parseOsmId(s.id)?.osmId).filter(Boolean);
    liveMap = await fetchOsmTags(ids);
    console.log(`[fix] OSM tags ${liveMap.size}`);
  }

  const report = {
    updated: new Date().toISOString().slice(0, 10),
    latinTotal: latin.length,
    renamed: [],
    keptEn: [],
    dropped: [],
    unresolved: [],
    actions: {},
  };

  const dropIds = new Set();
  let renamedCount = 0;

  for (const spot of spots) {
    if (!isLatinName(spot.name)) continue;
    const parsed = parseOsmId(spot.id);
    const live = parsed ? liveMap.get(parsed.osmId) || {} : {};
    const gate = chinaGate(spot, { ...(spot.osmTags || {}), ...live });
    if (!gate.ok) {
      dropIds.add(spot.id);
      report.dropped.push({
        id: spot.id,
        name: spot.name,
        reason: gate.reason,
        lng: spot.lng,
        lat: spot.lat,
        province: spot.province,
      });
      report.actions[gate.reason] = (report.actions[gate.reason] || 0) + 1;
      continue;
    }

    const resolved = resolveName(spot, live, properZh);
    report.actions[resolved.action] = (report.actions[resolved.action] || 0) + 1;

    if (
      resolved.action === 'drop_junk' ||
      resolved.action === 'drop_foreign' ||
      resolved.action === 'unresolved'
    ) {
      dropIds.add(spot.id);
      report.dropped.push({
        id: spot.id,
        name: spot.name,
        reason: resolved.action,
        lng: spot.lng,
        lat: spot.lat,
        province: spot.province,
      });
      if (resolved.action === 'unresolved') {
        report.unresolved.push({ id: spot.id, name: spot.name, province: spot.province });
      }
      continue;
    }

    if (resolved.action === 'keep_en') {
      spot.osmTags = mergeOsmTags(spot.osmTags, live);
      report.keptEn.push({ id: spot.id, name: spot.name, province: spot.province });
      continue;
    }

    const prev = spot.name;
    spot.name = resolved.name;
    spot.osmTags = mergeOsmTags(spot.osmTags, live);
    spot.province = provinceOfPoint(Number(spot.lng), Number(spot.lat), spot.province) || spot.province;
    if (resolved.action === 'osm_zh' || resolved.action === 'dict') {
      spot.score = Math.min(96, Math.round(Number(spot.score || 50) + 3));
    }
    renamedCount += 1;
    report.renamed.push({
      id: spot.id,
      from: prev,
      to: spot.name,
      via: resolved.action,
      province: spot.province,
    });
  }

  const nextSpots = spots.filter((s) => !dropIds.has(s.id));
  console.log(
    `[fix] 改名 ${renamedCount}，保留英文 ${report.keptEn.length}，删除 ${dropIds.size}，剩余 ${nextSpots.length}`,
  );
  console.log('[fix] actions', report.actions);

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`[fix] 报告 → ${REPORT_PATH}`);

  if (WRITE && !DRY) {
    const noteExtra = `；${report.updated} 外语名纠正：改中文 ${renamedCount}、保留官方英文 ${report.keptEn.length}、删除境外/垃圾/无法确认 ${dropIds.size}`;
    doc.spots = nextSpots;
    doc.updated = report.updated;
    doc.note = String(doc.note || '').replace(/；20\d{2}-\d{2}-\d{2} 外语名纠正：[^\n]*/g, '') + noteExtra;
    writeFileSync(SPOTS_PATH, `${JSON.stringify(doc)}\n`);
    console.log(`[fix] 已写入 ${SPOTS_PATH}`);
  } else {
    console.log('[fix] dry-run，未写库');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
