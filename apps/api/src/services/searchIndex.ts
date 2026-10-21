/**
 * 全局搜索（发现入口）—— 聚合索引服务。
 *
 * 一个「车次 / 铁路走廊 / 编号公路 / 景点（铁路库 + 公路库）/ 路书」五类实体放进
 * 同一份结果，解决「数据广度够了、发现入口为零」的留存卡点。
 *
 * 景点附带 corridorNames / roadbookNames：
 *   - rail 景点：lines[].corridorId → 走廊名（点 → 铁路线）
 *   - 任意景点：路书 pois（name 全等匹配）→ 路书名（点 → 路书库）
 * 让用户搜到景点后能一眼看到它关联的「线」与「书」，而不是孤立 POI。
 *
 * 性能：数据全部常驻内存（由各 service 的 mtime 缓存保证），每次搜索线性扫描，
 * 36893 条公路景点 + 811 铁路景点 单次 < 50ms；q 为空时直接短路。
 */
import {
  isTrainCodeLike,
  trainCodeKind,
  type GlobalSearchResult,
  type SearchCorridorHit,
  type SearchRoadHit,
  type SearchRoadbookHit,
  type SearchSpotHit,
  type SearchTrainHit,
} from '@railvista/shared';
import type { RoadsideSpot, ScenicSpotInput, SpotLineRef, TravelRouteDetail } from '@railvista/shared';
import { loadCorridors, type CorridorPreset } from './corridors.js';
import { loadScenicSpots } from './scenicSpots.js';
import { loadRoadIndex } from './roadNetwork.js';
import { getRoadsideSpots } from './roadsideSpots.js';
import { listAllTravelRoutes } from './travelRoutes.js';

// ── 分组结果上限：命令面板每屏 6~10 条，各组给一个合理上限避免一屏刷爆 ──
const LIMITS = {
  trains: 1,
  corridors: 8,
  roads: 10,
  spots: 14,
  roadbooks: 6,
} as const;

const TRAIN_NORMALIZE_RE = /^([GDCZTKYS]?)(\d{1,5})$/i;

interface Scored<T> {
  item: T;
  score: number;
}

/** 单字段匹配打分：全等 100 / 前缀 86 / 包含 68 / 未命中 0 */
function scoreField(text: string | undefined, ql: string): number {
  if (!text) return 0;
  const t = text.trim().toLowerCase();
  if (!t) return 0;
  if (t === ql) return 100;
  if (t.startsWith(ql)) return 86;
  if (t.includes(ql)) return 68;
  return 0;
}

/** 一组字段取最高分（tags / dimensions / honors 等数组字段缩放一点，避免压过主名） */
function maxScoreOf(arr: readonly (string | undefined)[] | undefined, ql: string, scale = 1): number {
  if (!arr) return 0;
  let best = 0;
  for (const s of arr) {
    const score = scoreField(s, ql);
    if (score > best) best = score;
  }
  return best * scale;
}

function byScoreDesc<T>(a: Scored<T>, b: Scored<T>): number {
  return b.score - a.score;
}

function topOf<T>(arr: Scored<T>[], limit: number): T[] {
  arr.sort(byScoreDesc);
  return arr.slice(0, limit).map((x) => x.item);
}

const cmpZh = (a: string, b: string): number => a.localeCompare(b, 'zh');

/** 从景点 id 里去掉库前缀，让搜索结果的跳转键与页面既有约定一致 */
function bareSpotId(id: string): string {
  const i = id.indexOf('/');
  return i >= 0 ? id.slice(i + 1) : id;
}

export function searchAll(rawQ: string): GlobalSearchResult {
  const started = Date.now();
  const q = (rawQ ?? '').trim();
  const ql = q.toLowerCase();

  if (!ql) {
    return {
      q,
      tookMs: 0,
      total: 0,
      trains: [],
      corridors: [],
      roads: [],
      spots: [],
      roadbooks: [],
    };
  }

  // ── 1. 车次号 ──
  const trains: SearchTrainHit[] = [];
  if (isTrainCodeLike(q)) {
    const m = TRAIN_NORMALIZE_RE.exec(q);
    const code = ((m?.[1] ?? '').toUpperCase() || '') + (m?.[2] ?? '');
    trains.push({ code, kind: trainCodeKind(code) });
  }

  // ── 预构建辅助索引 ──
  // 走廊名映射 + 走廊景点计数（rail 景点 lines[].corridorId）
  const corridors = loadCorridors();
  const corridorById = new Map<string, CorridorPreset>();
  const corridorSpotCount = new Map<string, number>();
  for (const c of corridors) corridorById.set(c.id, c);

  const railSpots = loadScenicSpots();
  for (const s of railSpots) {
    for (const line of s.lines ?? []) {
      const cid = line.corridorId;
      corridorSpotCount.set(cid, (corridorSpotCount.get(cid) ?? 0) + 1);
    }
  }

  // 路书反向索引：poi.name（小写）→ 路书 { id, name }
  const roadbooks = listAllTravelRoutes();
  const poiRoadbooks = new Map<string, { id: string; name: string }[]>();
  for (const rb of roadbooks) {
    for (const poi of rb.pois ?? []) {
      const key = (poi.name ?? '').trim().toLowerCase();
      if (!key) continue;
      const list = poiRoadbooks.get(key) ?? [];
      if (!list.some((x) => x.id === rb.id)) list.push({ id: rb.id, name: rb.name });
      poiRoadbooks.set(key, list);
    }
  }
  const relatedRoadbooks = (name: string): { ids: string[]; names: string[] } => {
    const list = poiRoadbooks.get((name ?? '').trim().toLowerCase());
    if (!list?.length) return { ids: [], names: [] };
    return { ids: list.map((x) => x.id), names: list.map((x) => x.name) };
  };

  const lineFor = (line: SpotLineRef): { id: string; name: string } | null => {
    const c = corridorById.get(line.corridorId);
    return c ? { id: c.id, name: c.name } : null;
  };

  // ── 2. 铁路走廊 ──
  const corridorsItems: Scored<SearchCorridorHit>[] = [];
  for (const c of corridors) {
    let score = scoreField(c.name, ql);
    score = Math.max(score, maxScoreOf(c.sourceNames, ql, 0.9));
    score = Math.max(score, maxScoreOf(c.stationsHint, ql, 0.6));
    if (score <= 0) continue;
    corridorsItems.push({
      score,
      item: {
        id: c.id,
        name: c.name,
        alias: c.sourceNames ?? [],
        stationsHint: c.stationsHint ?? [],
        spotCount: corridorSpotCount.get(c.id) ?? 0,
      },
    });
  }

  // ── 3. 编号公路 ──
  const roadsItems: Scored<SearchRoadHit>[] = [];
  for (const r of loadRoadIndex().entries) {
    let score = scoreField(r.ref, ql);
    score = Math.max(score, scoreField(r.name, ql));
    score = Math.max(score, scoreField(r.fromPlace, ql, ));
    score = Math.max(score, scoreField(r.toPlace, ql));
    if (score <= 0) continue;
    roadsItems.push({
      score,
      item: {
        key: r.key,
        ref: r.ref,
        name: r.name,
        class: r.class,
        from: r.fromPlace,
        to: r.toPlace,
        lengthKm: r.lengthKm,
      },
    });
  }

  // ── 4. 景点（铁路库 + 公路库 双源） ──
  const spotItems: Scored<SearchSpotHit>[] = [];

  for (const s of railSpots) {
    let score = scoreField(s.name, ql);
    score = Math.max(score, maxScoreOf(s.tags, ql, 0.9));
    score = Math.max(score, maxScoreOf(s.dimensions, ql, 0.85));
    score = Math.max(score, scoreField(s.intro, ql, ) * 0.6); // 简介全等价值低，仅兜底
    if (score <= 0 && s.intro && (s.intro.toLowerCase().includes(ql))) score = 40;
    if (score <= 0) continue;

    const corridorIds: string[] = [];
    const corridorNames: string[] = [];
    for (const line of s.lines ?? []) {
      const linfo = lineFor(line);
      if (!linfo) continue;
      if (!corridorIds.includes(linfo.id)) {
        corridorIds.push(linfo.id);
        corridorNames.push(linfo.name);
      }
    }
    const rb = relatedRoadbooks(s.name);

    spotItems.push({
      score,
      item: {
        id: bareSpotId(String(s.id)),
        name: s.name,
        lng: s.lng,
        lat: s.lat,
        category: s.category,
        dimensions: s.dimensions ?? [],
        tags: s.tags ?? [],
        origin: 'rail',
        corridorIds,
        corridorNames,
        roadbookIds: rb.ids,
        roadbookNames: rb.names,
        intro: s.intro,
      },
    });
  }

  for (const s of getRoadsideSpots()) {
    let score = scoreField(s.name, ql);
    score = Math.max(score, scoreField(s.tagline, ql, ) * 0.9);
    score = Math.max(score, scoreField(s.category, ql, ) * 0.8);
    score = Math.max(score, maxScoreOf(s.tags, ql, 0.8));
    score = Math.max(score, maxScoreOf(s.honors, ql, 0.8));
    if (score <= 0) continue;

    const rb = relatedRoadbooks(s.name);
    spotItems.push({
      score,
      item: {
        id: String(s.id),
        name: s.name,
        lng: s.lng,
        lat: s.lat,
        category: s.category,
        dimensions: [],
        tags: s.tags ?? [],
        province: s.province,
        city: s.city,
        origin: 'road',
        corridorIds: [],
        corridorNames: [],
        roadbookIds: rb.ids,
        roadbookNames: rb.names,
        intro: s.intro ?? s.tagline,
      },
    });
  }

  // ── 5. 路书 ──
  const roadbookItems: Scored<SearchRoadbookHit>[] = [];
  for (const rb of roadbooks) {
    if (rb.status !== 'published') continue;
    let score = scoreField(rb.name, ql);
    score = Math.max(score, scoreField(rb.subtitle, ql, ) * 0.9);
    score = Math.max(score, scoreField(rb.summary, ql, ) * 0.6);
    score = Math.max(score, scoreField(rb.anchorCity, ql, ) * 0.7);
    score = Math.max(score, maxScoreOf(rb.alias, ql, 0.9));
    score = Math.max(score, maxScoreOf(rb.provinces, ql, 0.7));
    score = Math.max(score, maxScoreOf(rb.cities, ql, 0.7));
    score = Math.max(score, maxScoreOf(rb.tags, ql, 0.8));
    score = Math.max(score, maxScoreOf(rb.roadRefs, ql, 0.8));
    if (score <= 0) continue;

    roadbookItems.push({
      score,
      item: {
        id: rb.id,
        name: rb.name,
        subtitle: rb.subtitle,
        tags: rb.tags,
        cities: [...new Set([rb.anchorCity, ...rb.cities])].sort(cmpZh),
        provinces: rb.provinces,
        roadRefs: rb.roadRefs,
        tier: rb.tier,
        days: rb.days,
        totalKm: rb.totalKm,
      },
    });
  }

  const corridorsHits = topOf(corridorsItems, LIMITS.corridors);
  const roadsHits = topOf(roadsItems, LIMITS.roads);
  const spotsHits = topOf(spotItems, LIMITS.spots);
  const roadbookHits = topOf(roadbookItems, LIMITS.roadbooks);

  return {
    q,
    tookMs: Date.now() - started,
    total: trains.length + corridorsHits.length + roadsHits.length + spotsHits.length + roadbookHits.length,
    trains,
    corridors: corridorsHits,
    roads: roadsHits,
    spots: spotsHits,
    roadbooks: roadbookHits,
  };
}