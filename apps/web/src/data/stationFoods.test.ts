/**
 * 车站美食索引的覆盖与正确性门禁。
 * 目的：「每一个火车站都有地方特色美食」是产品承诺，加站 / 改库时不能悄悄漏掉。
 * 运行：pnpm test（根脚本已串上本文件）
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stationFood, stationFoodTop } from './stationFoods';
import { stationFoodCardHtml } from '../lib/stationFoodHtml';

const repoFile = (rel: string) => readFileSync(new URL(`../../../../${rel}`, import.meta.url), 'utf8');

const index = JSON.parse(repoFile('apps/web/src/data/stationFoods.json')) as {
  cities: Record<string, { p: string; t: string; d: [string, string][] }>;
  stations: Record<string, string>;
};
const geoStations = Object.keys(JSON.parse(repoFile('data/stations-geo.json')) as Record<string, unknown>);
const city12306 = JSON.parse(repoFile('data/stations-city-12306.json')) as {
  stations: Record<string, { city: string }>;
};

describe('车站美食索引覆盖', () => {
  it('索引里每个站都能取到 ≥3 道有说明的美食', () => {
    const bad: string[] = [];
    for (const [station, key] of Object.entries(index.stations)) {
      const city = index.cities[key];
      if (!city) bad.push(`${station}→${key}(无城市条目)`);
      else if (city.d.length < 3) bad.push(`${station}→${key}(仅${city.d.length}道)`);
      else if (city.d.some(([n, d]) => !n.trim() || !d.trim())) bad.push(`${station}→${key}(有空菜名或说明)`);
    }
    assert.deepEqual(bad, [], `存在缺美食数据的车站：${bad.slice(0, 10).join('、')}`);
  });

  it('12306 全量站在册（例外必须在 unresolved-stations.json 里写明原因）', () => {
    const missingGeo = geoStations.filter((n) => !index.stations[n]);
    assert.deepEqual(missingGeo, [], `站名主表缺归属：${missingGeo.slice(0, 10).join('、')}`);

    const allow = JSON.parse(repoFile('data/presets/foods/unresolved-stations.json')) as {
      stations: Array<{ name: string; reason: string }>;
    };
    const allowed = new Set(allow.stations.map((s) => s.name));
    for (const s of allow.stations) {
      assert.ok(s.reason.trim().length >= 6, `${s.name} 的例外登记缺原因`);
      assert.ok(!index.stations[s.name], `${s.name} 已能归市，应从例外名单删除`);
    }
    const missing12306 = Object.keys(city12306.stations).filter((n) => !index.stations[n] && !allowed.has(n));
    assert.deepEqual(missing12306, [], `12306 站缺归属且未登记例外：${missing12306.join('、')}`);
    assert.ok(allowed.size <= 5, `例外名单失控（${allowed.size} 个），应补齐归属`);
  });

  it('每个城市条目都有风味标签且菜数不越界', () => {
    for (const [key, city] of Object.entries(index.cities)) {
      assert.ok(city.t.trim().length >= 2 && city.t.length <= 8, `${key} 的 tag 不合规`);
      assert.ok(city.d.length >= 3 && city.d.length <= 6, `${key} 菜品数应在 3-6，实际 ${city.d.length}`);
    }
  });
});

describe('归市口径以 12306 为准（坐标近似会归错市）', () => {
  const cases: Array<[string, string]> = [
    ['厦门', '福建/厦门'],
    ['义乌', '浙江/金华'],
    ['广州北', '广东/广州'],
    ['永泰', '福建/福州'],
    ['晋江', '福建/泉州'],
    ['宝鸡南', '陕西/宝鸡'],
    ['凯里', '贵州/黔东南'],
    ['格尔木', '青海/海西'],
    ['万象', '老挝/万象'],
    ['香港西九龙', '中国香港/中国香港'],
  ];
  for (const [station, key] of cases) {
    it(`${station} → ${key}`, () => {
      assert.equal(index.stations[station], key);
    });
  }
});

describe('stationFood 取值', () => {
  it('站名带「站」后缀也能取到', () => {
    const a = stationFood('长沙南');
    const b = stationFood('长沙南站');
    assert.ok(a && b);
    assert.equal(a.city, b.city);
  });

  it('索引外的新站按坐标归市兜底', () => {
    // 假设的未收录站：坐标落在长沙附近
    const food = stationFood('某某未收录站', { lng: 112.98, lat: 28.19 });
    assert.ok(food, '坐标兜底应命中长沙');
    assert.equal(food.city, '长沙');
  });

  it('既不在索引也无坐标时返回 null，不编造内容', () => {
    assert.equal(stationFood('不存在的站名XYZ'), null);
  });

  it('底栏用的前 N 道确实被截断', () => {
    const top = stationFoodTop('北京南', null, 2);
    assert.ok(top && top.dishes.length === 2);
  });

  it('地图卡片是拼进 InfoWindow 的 HTML，内容必须转义', () => {
    const html = stationFoodCardHtml({
      province: '测试',
      city: '某市',
      tag: '风味<img src=x onerror=1>',
      dishes: [{ name: 'a"b', note: "<script>alert(1)</script>" }],
    });
    assert.ok(html, '应生成卡片');
    assert.ok(!/<img|<script/i.test(html), '不得出现未转义的标签');
    assert.ok(html.includes('&lt;img') && html.includes('&lt;script'), '尖括号应被转义');
    assert.equal(stationFoodCardHtml(null), '');
  });
});
