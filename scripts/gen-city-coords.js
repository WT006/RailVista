const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const geoDir = join(__dirname, '..', 'apps', 'web', 'public', 'geo');
const provinces = JSON.parse(readFileSync(join(geoDir, 'china-provinces.json'), 'utf8'));
const cities = JSON.parse(readFileSync(join(geoDir, 'china-cities.json'), 'utf8'));

const provinceByAdcode = new Map();
for (const f of provinces.features) {
  const p = f.properties;
  provinceByAdcode.set(String(p.adcode), p.name);
}
provinceByAdcode.set('710000', '台湾省');

const cityMap = new Map();

// 直辖市 / 港澳 / 台湾 从省级 geo 注入
const directCities = ['北京市', '天津市', '上海市', '重庆市', '香港特别行政区', '澳门特别行政区', '台湾省'];
for (const f of provinces.features) {
  const p = f.properties;
  if (directCities.includes(p.name)) {
    cityMap.set(p.name, {
      name: p.name,
      adcode: p.adcode,
      lng: p.center[0],
      lat: p.center[1],
      province: p.name,
    });
  }
}

// 地级市 / 自治州 / 地区 / 盟
for (const f of cities.features) {
  const p = f.properties;
  if (!p || p.level !== 'city' || !p.name) continue;
  const provinceAdcode = p.parent?.adcode;
  const province = provinceByAdcode.get(String(provinceAdcode)) || '';
  cityMap.set(p.name, {
    name: p.name,
    adcode: p.adcode,
    lng: p.center[0],
    lat: p.center[1],
    province,
  });
}

const list = Array.from(cityMap.values()).sort((a, b) => a.adcode - b.adcode);
writeFileSync(join(geoDir, 'city-coords.json'), JSON.stringify(list, null, 2), 'utf8');
console.log(`generated ${list.length} cities`);
