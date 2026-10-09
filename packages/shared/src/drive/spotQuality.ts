/**
 * 公路景点是否值得作为「景点」展示（图集 / 沿程可共用）。
 * 不改库文件；OSM 测绘支峰、乐园设施、金门工事在这里挡掉。
 * 落图约为库内原生点的一成（约一千），UI 应标明「展示 N / 库内 M」。
 */
import { inKinmenMatsu } from './spotGrid.js';

export const ROAD_ATLAS_MIN_SCORE = 65;

const PEAK_CATS = new Set(['nature.mountain', 'nature.canyon']);
const CJK_RE = /[\u4e00-\u9fff]/;
const NOTABLE_PEAK = /主峰|雪山|景区|风景区|国家公园|大峡谷/;
const FAMOUS_PEAK =
  /(?<![枯翠])华山|(?<!小)黄山|(?<!小)峨眉|衡山|恒山|嵩山|长白|武夷|武当山|梵净|贡嘎|梅里|卡瓦格博|南迦巴瓦|卓奥友|希夏邦马|冈仁波齐|珠穆朗玛(?!南)|乔戈里|慕士塔格|公格尔|博格达|各拉丹冬|格拉丹东|阿尼玛卿|四姑娘|哈巴雪山|玉龙雪山|梧桐山|骊山|崂山|太白|青城|点苍|鸡足|神农架|神农顶|武功山|三清山|丹霞/;
const FALSE_FAMOUS = /小黄山|枯华山|小峨眉|牛黄山|梅恒山|北武当|珠穆朗玛南峰/;
const SURVEY_PEAK = /海拔峰|[IVX]{1,4}\s*峰|\bI\b|\bII\b|\bIII\b|Kangri|Peak$|Ri I|Marble Peak/;
const GENERIC_VIEW = /观景台|觀景台|瞭望台|瞭望點|瞭望点|眺望|观景点|觀景點|台阶|臺階/;
const PARK_FACILITY =
  /奇航|漂流|过山车|矿山车|娱乐天地|摩天轮|旋转木马|碰碰车|Jump\s*360|游乐/;
const MILITARY_WORKS = /坑道|砲陣|據點|据点|觀測所|观测所|碉堡|鐵漢堡|铁汉堡|鐵堡/;
const JUNK_LABEL =
  /^(景点|教堂|天鹅|觀光长廊|观光长廊)$|65km|35km|飞龙乘云|爱情码头|殡葬|酒吧街|霹破石|聽海軒|听海轩|蜜月阁|佛山第一梯|走马岗网红/;
const FOREIGN_LABEL = /Núi |Ялалт|Cát Cát|Walk To The Edge|Loi Pangnao|Fupingbao|Газированная/;
const TOMB_KEEP = /乾陵|定陵|长陵|昭陵|福陵|黄帝陵|成吉思汗|中山陵|鲁迅|聂耳|苏公|明孝陵|清东陵|清西陵/;
const RUIN_KEEP = /古城|故城|高昌|楼兰|殷墟|三星堆|金沙|古格|圆明园|大明宫|交河|小河墓地|城头山|良渚|圆明/;

export type AtlasRoadDisplaySpot = {
  name: string;
  lng?: number;
  lat?: number;
  score?: number;
  category?: string;
  source?: string;
  ele?: number;
};

function isNotableMountain(s: AtlasRoadDisplaySpot): boolean {
  const name = s.name ?? '';
  const score = s.score ?? 0;
  if (String(s.source ?? '').startsWith('hand-curated')) return true;
  if (!CJK_RE.test(name) || SURVEY_PEAK.test(name) || FALSE_FAMOUS.test(name)) return false;
  const ele = s.ele;
  if (NOTABLE_PEAK.test(name) && !/神山/.test(name)) {
    if (!Number.isFinite(ele) || (ele as number) >= 800) return true;
  }
  if (FAMOUS_PEAK.test(name)) {
    if (Number.isFinite(ele) && (ele as number) < 800) return false;
    return true;
  }
  // 略放宽：中高海拔中文峰（仍挡矮测绘峰 / 罗马数字峰；目标落图约一千）
  if (Number.isFinite(ele) && (ele as number) >= 1000 && score >= 65) return true;
  if (Number.isFinite(ele) && (ele as number) >= 700 && score >= 76) return true;
  return false;
}

function isOsmLabelNoise(s: AtlasRoadDisplaySpot): boolean {
  const name = s.name ?? '';
  const score = s.score ?? 0;
  const cat = s.category ?? '';
  if (PARK_FACILITY.test(name) || MILITARY_WORKS.test(name)) return true;
  if (JUNK_LABEL.test(name) || FOREIGN_LABEL.test(name)) return true;
  if (/墓$|墓地$/.test(name) && !TOMB_KEEP.test(name)) return true;
  if (cat === 'culture.ruin' && !RUIN_KEEP.test(name) && score < 80) return true;
  if (/燈塔|灯塔/.test(name) && score < 76) return true;
  if (/石刻$/.test(name) && cat !== 'culture.heritage' && score < 76) return true;
  if (cat === 'viewpoint.observation-deck' && score < 68) return true;
  if (GENERIC_VIEW.test(name) && (score < 73 || /台阶|臺階|牌坊/.test(name))) return true;
  if (name.length <= 2 && score < 73) return true;
  return false;
}

/** 图集落图：真景点，不是 OSM 测绘点 */
export function isAtlasRoadDisplaySpot(s: AtlasRoadDisplaySpot): boolean {
  if ((s.score ?? 0) < ROAD_ATLAS_MIN_SCORE) return false;
  if (s.lng != null && s.lat != null && inKinmenMatsu(s.lng, s.lat)) return false;
  if (isOsmLabelNoise(s)) return false;
  const cat = s.category ?? '';
  if (PEAK_CATS.has(cat)) return isNotableMountain(s);
  return true;
}

// ── 近重复 / 城区密集聚去重（不改库）────────────────────────────────────────

const NAME_STRIP_RE =
  /(国家考古遗址公园|考古遗址公园|国家地质公园|地质公园|森林公园|国家公园|风景名胜区|风景区|景区|博物院|博物馆|纪念馆|美术馆|展览馆|陈列馆|观光厅|观景台|觀景台|瞭望台|瞭望點|主峰|峰)$/g;

/** 城区非山岳：约 1km 内最多保留几处（按评分） */
export const ROAD_ATLAS_URBAN_TOP_K = 2;
/** 城区密度半径（km） */
export const ROAD_ATLAS_URBAN_RADIUS_KM = 1.0;

function haversineKm(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const to = (x: number) => (x * Math.PI) / 180;
  const dLat = to(b.lat - a.lat);
  const dLng = to(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(to(a.lat)) * Math.cos(to(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

function coreName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '').replace(NAME_STRIP_RE, '');
}

function isPeakCat(cat: string | undefined): boolean {
  return PEAK_CATS.has(cat ?? '');
}

function spotRank(s: AtlasRoadDisplaySpot & { hasWiki?: boolean }): number {
  let r = s.score ?? 0;
  if (String(s.source ?? '').startsWith('hand-curated')) r += 20;
  if (s.hasWiki) r += 5;
  // 更短主名略优先（冈仁波齐 > 冈仁波齐峰）
  r += Math.max(0, 12 - (s.name?.length ?? 12)) * 0.15;
  return r;
}

/** 同名 / 近名 / 峰群卫星是否应合并 */
function isNearDuplicate(
  a: AtlasRoadDisplaySpot & { lng: number; lat: number },
  b: AtlasRoadDisplaySpot & { lng: number; lat: number },
): boolean {
  const d = haversineKm(a, b);
  const na = (a.name ?? '').replace(/\s+/g, '');
  const nb = (b.name ?? '').replace(/\s+/g, '');
  if (na && na === nb && d <= 2) return true;

  const ca = coreName(a.name ?? '');
  const cb = coreName(b.name ?? '');
  if (ca.length >= 2 && ca === cb && d <= 1.5) return true;

  // 峰群：洛子峰 / 洛子中一峰 / 洛子东峰
  if (isPeakCat(a.category) && isPeakCat(b.category) && d <= 2.5) {
    if (
      ca.length >= 2 &&
      cb.length >= 2 &&
      (ca.startsWith(cb) || cb.startsWith(ca) || ca.includes(cb) || cb.includes(ca))
    ) {
      return true;
    }
  }

  // 一名称包含另一（≥3 字核心），1km 内
  if (ca.length >= 3 && cb.length >= 3 && d <= 1.0) {
    if (ca.includes(cb) || cb.includes(ca) || na.includes(nb) || nb.includes(na)) return true;
  }
  return false;
}

export type AtlasRoadDedupeSpot = AtlasRoadDisplaySpot & {
  id?: string;
  lng: number;
  lat: number;
  hasWiki?: boolean;
};

/**
 * 图集公路景点去重：近名合并 + 城区密集聚限流。
 * 保留高分 / 手选 / 有百科；不改景点库。
 */
export function dedupeAtlasRoadSpots<T extends AtlasRoadDedupeSpot>(spots: T[]): T[] {
  type Row = { s: T; key: string };
  const rows: Row[] = [];
  const seenKey = new Set<string>();
  spots.forEach((s, i) => {
    if (!Number.isFinite(s.lng) || !Number.isFinite(s.lat) || !(s.name ?? '')) return;
    const key = s.id || `${s.name}@${s.lng.toFixed(5)},${s.lat.toFixed(5)}#${i}`;
    if (seenKey.has(key)) return;
    seenKey.add(key);
    rows.push({ s, key });
  });
  if (rows.length < 2) return rows.map((r) => r.s);

  const cell = 0.012;
  const grid = new Map<string, Row[]>();
  for (const row of rows) {
    const k = `${Math.floor(row.s.lng / cell)},${Math.floor(row.s.lat / cell)}`;
    const arr = grid.get(k);
    if (arr) arr.push(row);
    else grid.set(k, [row]);
  }

  const neighbors = (row: Row): Row[] => {
    const ix = Math.floor(row.s.lng / cell);
    const iy = Math.floor(row.s.lat / cell);
    const out: Row[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get(`${ix + dx},${iy + dy}`);
        if (arr) out.push(...arr);
      }
    }
    return out;
  };

  const assigned = new Set<string>();
  const afterName: T[] = [];
  for (const row of rows) {
    if (assigned.has(row.key)) continue;
    const group: T[] = [row.s];
    assigned.add(row.key);
    const q = [row];
    while (q.length) {
      const cur = q.pop()!;
      for (const o of neighbors(cur)) {
        if (assigned.has(o.key)) continue;
        if (!isNearDuplicate(cur.s, o.s)) continue;
        assigned.add(o.key);
        group.push(o.s);
        q.push(o);
      }
    }
    group.sort((a, b) => spotRank(b) - spotRank(a));
    afterName.push(group[0]!);
  }

  // 城区限流：非山岳，1km 内最多 ROAD_ATLAS_URBAN_TOP_K 处
  const sorted = afterName.slice().sort((a, b) => spotRank(b) - spotRank(a));
  const kept: T[] = [];
  for (const s of sorted) {
    if (isPeakCat(s.category)) {
      kept.push(s);
      continue;
    }
    const nearby = kept.filter(
      (o) => !isPeakCat(o.category) && haversineKm(s, o) <= ROAD_ATLAS_URBAN_RADIUS_KM,
    );
    if (nearby.length >= ROAD_ATLAS_URBAN_TOP_K) continue;
    kept.push(s);
  }
  return kept;
}
