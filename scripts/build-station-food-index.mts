/**
 * 生成「火车站 → 地方特色美食」运行时索引 apps/web/src/data/stationFoods.json。
 *
 * 数据源
 * - data/presets/foods/*.json                 人工编写的地级市（含重庆区县/老挝等子单元）美食库
 * - data/presets/foods/city-aliases.json      12306 县级市/州府标签 → 「省/单元」键
 * - data/stations-city-12306.json             12306 官方站表自带的售票地市归属（主口径）
 * - data/stations-geo.json + corridors + presets  站名全集补充（12306 没有的站走坐标归市）
 *
 * 为什么以 12306 归属为主：stations-geo 的经纬度多为走廊折线投影近似值，实测 1272 个可对照站里
 * 238 个（19%）按坐标会归到邻市（厦门站→漳州、义乌→绍兴、广州北→清远），拿它做主源会推错地方菜。
 *
 * 门禁：站名全集中任一站解析不到「有美食数据的城市」→ 报错退出，不允许半成品上线。
 * 运行：pnpm --filter @railvista/api exec tsx ../../scripts/build-station-food-index.mts
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeOfPoint } from '../apps/web/src/data/prefectureSeeds.ts';

const R = join(dirname(fileURLToPath(import.meta.url)), '..');
const FOOD_DIR = join(R, 'data/presets/foods');
const OUT = join(R, 'apps/web/src/data/stationFoods.json');
const RESERVED = new Set(['city-aliases.json', 'unresolved-stations.json']);

type DishIn = { n?: unknown; d?: unknown };
type CityIn = { prov?: unknown; city?: unknown; tag?: unknown; dishes?: unknown };

const errors: string[] = [];
const warnings: string[] = [];

/** 省/单元 → 美食行（p 省、t 风味标签、d [菜名, 一句话]） */
const cities = new Map<string, { p: string; t: string; d: [string, string][] }>();

function addCity(source: string, raw: CityIn) {
  const prov = String(raw.prov ?? '').trim();
  const city = String(raw.city ?? '').trim();
  const tag = String(raw.tag ?? '').trim();
  const where = `${source}/${prov}/${city}`;
  const dishesRaw = Array.isArray(raw.dishes) ? (raw.dishes as DishIn[]) : [];
  if (!prov || !city) return errors.push(`${where}：prov/city 缺失`);
  if (!tag || tag.length > 8) return errors.push(`${where}：tag 需为 1-8 字`);
  if (dishesRaw.length < 3 || dishesRaw.length > 6) return errors.push(`${where}：dishes 需 3-6 道，实际 ${dishesRaw.length}`);
  const dishes: [string, string][] = [];
  dishesRaw.forEach((dish, i) => {
    const n = String(dish?.n ?? '').trim();
    const d = String(dish?.d ?? '').trim();
    if (n.length < 2 || n.length > 12) errors.push(`${where} 第${i + 1}道：菜名需 2-12 字（实际「${n}」）`);
    if (d.length < 4 || d.length > 30) errors.push(`${where} 第${i + 1}道：说明需 4-30 字（实际「${d}」）`);
    if (n && d) dishes.push([n, d]);
  });
  const key = `${prov}/${city}`;
  if (cities.has(key)) return errors.push(`${key}：重复出现在 ${source}`);
  cities.set(key, { p: prov, t: tag, d: dishes });
}

if (!existsSync(FOOD_DIR)) {
  errors.push(`缺少美食库目录 ${FOOD_DIR}`);
} else {
  for (const f of readdirSync(FOOD_DIR).filter((x) => x.endsWith('.json') && !RESERVED.has(x))) {
    const parsed = JSON.parse(readFileSync(join(FOOD_DIR, f), 'utf8')) as { entries?: unknown };
    const entries = Array.isArray(parsed.entries) ? (parsed.entries as CityIn[]) : [];
    if (!entries.length) errors.push(`${f}：entries 为空`);
    for (const e of entries) addCity(f.replace(/\.json$/, ''), e);
  }
}

/** 12306 市属标签 → 单元键 */
const aliasPath = join(FOOD_DIR, 'city-aliases.json');
const aliasRaw = existsSync(aliasPath)
  ? (JSON.parse(readFileSync(aliasPath, 'utf8')) as { aliases?: Record<string, string> }).aliases ?? {}
  : {};
const ALIAS: Record<string, string> = {};
for (const [label, key] of Object.entries(aliasRaw)) {
  const k = String(key ?? '').trim();
  if (!k.includes('/')) {
    errors.push(`city-aliases：${label} 的目标「${k}」不是 省/单元 形式`);
    continue;
  }
  ALIAS[label] = k;
}

const bounds = JSON.parse(readFileSync(join(R, 'apps/web/src/data/prefectureBounds.json'), 'utf8')) as {
  units: Array<{ p: string; n: string }>;
};
const UNIT: Record<string, string> = {};
for (const u of bounds.units) {
  const name = String(u.n).trim();
  const key = `${String(u.p).trim()}/${name}`;
  if (UNIT[name] && UNIT[name] !== key) warnings.push(`政区单元名重名跨省：${name}`);
  else UNIT[name] = key;
}

function stripUnitSuffix(label: string): string {
  return label
    .replace(/(藏族羌族|哈萨克族柯尔克孜|柯尔克孜|蒙古族藏|蒙古藏|哈萨克|蒙古|锡伯|彝|哈尼族彝|壮|回|白|傣族景颇|傈僳|藏|苗|布依|土家族苗|土家|满|朝鲜)?族?自治州$/, '')
    .replace(/自治州$/, '')
    .replace(/地区$/, '')
    .replace(/盟$/, '')
    .replace(/市$/, '');
}

/** 12306 市属标签解析到单元键；解析不了返回 '' */
function cityKeyFrom12306Label(label: string): string {
  if (!label) return '';
  if (ALIAS[label]) return ALIAS[label];
  if (UNIT[label]) return UNIT[label];
  const sh = stripUnitSuffix(label);
  if (sh && UNIT[sh]) return UNIT[sh];
  return '';
}

const unresolvableLabels = new Set<string>();
const s12Path = join(R, 'data/stations-city-12306.json');
if (!existsSync(s12Path)) {
  errors.push('缺 data/stations-city-12306.json，请先跑 node scripts/build-station-city-12306.mjs');
}
const S12: Record<string, string> = {};
/** 12306 全量站名（含市属标签解析不了的），都要进站名全集，避免静默漏站 */
const S12_ALL: string[] = [];
if (existsSync(s12Path)) {
  const raw = JSON.parse(readFileSync(s12Path, 'utf8')) as {
    stations: Record<string, { city?: string }>;
  };
  for (const [name, v] of Object.entries(raw.stations ?? {})) {
    S12_ALL.push(name);
    const label = String(v?.city ?? '').trim();
    const key = cityKeyFrom12306Label(label);
    if (!key) {
      if (label) unresolvableLabels.add(label);
      continue;
    }
    S12[name] = key;
  }
}
if (unresolvableLabels.size) {
  // 标签解析不了（多为极小众县级地名）→ 该站退回坐标归市，仅提示不阻断
  warnings.push(
    `12306 标签未建别名，相关站改用坐标归市：${[...unresolvableLabels].join('、')}（核实后补进 city-aliases.json）`,
  );
}

/** 站名全集：12306 全量 + geo 主表 + 走廊 stationsHint + 预置包 stations */
type Seed = { name: string; lng?: number; lat?: number; src: string };
const universe = new Map<string, Seed>();

function put(seed: Seed) {
  const name = String(seed.name ?? '').trim();
  if (!name || universe.has(name)) return;
  universe.set(name, seed);
}

const geo = JSON.parse(readFileSync(join(R, 'data/stations-geo.json'), 'utf8')) as Record<
  string,
  { lng?: number; lat?: number }
>;
for (const [name, g] of Object.entries(geo)) put({ name, lng: g.lng, lat: g.lat, src: 'geo' });

const corridorDir = join(R, 'data/presets/corridors');
for (const f of readdirSync(corridorDir).filter((x) => x.endsWith('.json'))) {
  const c = JSON.parse(readFileSync(join(corridorDir, f), 'utf8')) as {
    id?: string;
    stationsHint?: string[];
    railway?: number[][];
  };
  const line = c.railway ?? [];
  const mid = line.length ? line[Math.floor(line.length / 2)] : null;
  for (const raw of c.stationsHint ?? []) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    put({ name, lng: mid?.[0], lat: mid?.[1], src: `corridor:${c.id ?? f}` });
  }
}

const presetDir = join(R, 'data/presets');
for (const f of readdirSync(presetDir).filter((x) => x.endsWith('.json'))) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(presetDir, f), 'utf8'));
  } catch {
    continue;
  }
  const list = (parsed as { stations?: unknown[] })?.stations;
  if (!Array.isArray(list)) continue;
  for (const s of list) {
    const o = s as { name?: unknown; lng?: unknown; lat?: unknown };
    const name = String(o?.name ?? '').trim();
    if (!name) continue;
    put({
      name,
      lng: typeof o.lng === 'number' ? o.lng : undefined,
      lat: typeof o.lat === 'number' ? o.lat : undefined,
      src: `preset:${f}`,
    });
  }
}
for (const name of S12_ALL) put({ name, src: '12306' });

/** 站 → 城市键：12306 精确 → 去方位后缀 12306 → 坐标归市 → 站名前缀撞单元名 */
const stationCity: Record<string, string> = {};
const how: Record<string, '12306' | '12306-strip' | 'coord' | 'name-prefix'> = {};
const dropped: Array<{ name: string; why: string }> = [];

const stationKeys = Object.keys(S12);
function trimToKnown(name: string): { hit?: string; base?: string } {
  for (const suffix of ['东', '南', '西', '北', '站']) {
    if (name.length <= 2 || !name.endsWith(suffix)) continue;
    const base = name.slice(0, -1);
    if (S12[base]) return { hit: S12[base], base };
  }
  return {};
}

const unitNamesSorted = Object.keys(UNIT)
  .filter((n) => n.length >= 2)
  .sort((a, b) => b.length - a.length);

for (const seed of universe.values()) {
  const name = seed.name;
  if (S12[name]) {
    stationCity[name] = S12[name];
    how[name] = '12306';
    continue;
  }
  const stripped = trimToKnown(name);
  if (stripped.hit) {
    stationCity[name] = stripped.hit;
    how[name] = '12306-strip';
    continue;
  }
  if (typeof seed.lng === 'number' && typeof seed.lat === 'number') {
    const place = placeOfPoint(seed.lng, seed.lat);
    const key = UNIT[String(place.city ?? '').trim()];
    const label = `${String(place.province ?? '').trim()}/${String(place.city ?? '').trim()}`;
    const resolvedKey = key ?? (cities.has(label) ? label : '');
    if (resolvedKey) {
      stationCity[name] = resolvedKey;
      how[name] = 'coord';
      continue;
    }
    dropped.push({ name, why: `坐标未归单元(${label})` });
    continue;
  }
  const byName = unitNamesSorted.find((u) => name.length > u.length && name.startsWith(u));
  if (byName) {
    stationCity[name] = UNIT[byName];
    how[name] = 'name-prefix';
    continue;
  }
  dropped.push({ name, why: '12306 无此站且无坐标' });
}

/** 门禁：每个站都要落到一个「有美食数据」的城市 */
const uncovered: Array<{ name: string; key: string }> = [];
for (const [name, key] of Object.entries(stationCity)) {
  if (!cities.has(key)) uncovered.push({ name, key });
}
/** 归不了市的站必须在 unresolved-stations.json 里登记原因，否则按漏配处理（不允许静默掉站） */
const allowPath = join(FOOD_DIR, 'unresolved-stations.json');
const allowed = new Map<string, string>();
if (existsSync(allowPath)) {
  const list = (
    JSON.parse(readFileSync(allowPath, 'utf8')) as {
      stations?: Array<{ name?: string; reason?: string }>;
    }
  ).stations ?? [];
  for (const e of list) {
    const n = String(e?.name ?? '').trim();
    if (!n) continue;
    if (!String(e?.reason ?? '').trim()) errors.push(`unresolved-stations.json：${n} 缺 reason`);
    allowed.set(n, String(e?.reason ?? '').trim());
  }
}
const unregistered = dropped.filter((d) => !allowed.has(d.name));
const staleAllowed = [...allowed.keys()].filter((n) => !dropped.some((d) => d.name === n));
if (uncovered.length) {
  const byKey = new Map<string, number>();
  for (const u of uncovered) byKey.set(u.key, (byKey.get(u.key) ?? 0) + 1);
  errors.push(
    `覆盖率不足：${uncovered.length} 站所属城市尚无美食库条目 —— ` +
      [...byKey.entries()].map(([k, v]) => `${k}:${v}站`).join('、'),
  );
}
if (unregistered.length) {
  errors.push(
    `有 ${unregistered.length} 个站无法归市（补 city-aliases 或登记进 unresolved-stations.json）：` +
      unregistered.slice(0, 30).map((d) => `${d.name}（${d.why}）`).join('、'),
  );
}
if (staleAllowed.length) warnings.push(`unresolved-stations.json 中已可归市、可删除：${staleAllowed.join('、')}`);

if (errors.length) {
  console.error(`✗ 美食索引生成失败（${errors.length} 类问题）`);
  for (const e of errors.slice(0, 40)) console.error(`  - ${e}`);
  if (warnings.length) {
    console.warn('! 提示：');
    for (const w of warnings.slice(0, 20)) console.warn(`  - ${w}`);
  }
  process.exit(1);
}

const usedKeys = new Set(Object.values(stationCity));
const unusedCities = [...cities.keys()].filter((k) => !usedKeys.has(k));

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  note: '由 scripts/build-station-food-index.mts 生成；数据源 data/presets/foods/*.json，请勿手工编辑本文件',
  cities: Object.fromEntries(cities),
  stations: stationCity,
};
writeFileSync(OUT, JSON.stringify(out), 'utf8');

const counts = { '12306': 0, '12306-strip': 0, coord: 0, 'name-prefix': 0 } as Record<string, number>;
for (const h of Object.values(how)) counts[h] = (counts[h] ?? 0) + 1;
const dishCount = [...cities.values()].reduce((n, c) => n + c.d.length, 0);
const kb = (Buffer.byteLength(JSON.stringify(out), 'utf8') / 1024).toFixed(1);
console.log(
  `✓ 美食索引：${Object.keys(stationCity).length} 站全覆盖 / ${cities.size} 个城市单元 / ${dishCount} 道特色菜 / ${kb} KB`,
);
console.log(
  `  归市来源：12306 直命中 ${counts['12306']}，去方位后缀 ${counts['12306-strip']}，坐标 ${counts.coord}，站名前缀 ${counts['name-prefix']}`,
);
if (unusedCities.length) console.log(`  已写但暂无站归属的城市（保留备用）：${unusedCities.length} 个`);
if (warnings.length) {
  console.log(`  提示 ${warnings.length} 条：`);
  for (const w of warnings.slice(0, 20)) console.log(`   - ${w}`);
}
console.log('  产物：apps/web/src/data/stationFoods.json');
