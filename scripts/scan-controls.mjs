/**
 * 万里路书 · 控制点异常扫描（scripts/scan-controls.mjs）
 *
 * 找出「被地理编码到台湾/境外/明显错误省份」的控制点——这类点会把国道走廊拖到海峡对岸
 * （如 G319 高雄、G357 东山被编到台南东山区），必须改成大陆端真实点位。
 *
 * 用法：node scripts/scan-controls.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CTRL_DIR = join('data', 'cache', 'amap', 'controls');
const PROV_ORDER = ['北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏',
  '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南',
  '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆'];

// 台湾岛粗略范围（金门/马祖另判）
const inTaiwan = (lng, lat) => lng >= 120.0 && lng <= 122.1 && lat >= 21.8 && lat <= 25.6;

const hits = [];
for (const f of readdirSync(CTRL_DIR).filter((x) => /^G\d{3}\.json$/.test(x)).sort()) {
  const ref = f.replace('.json', '');
  const c = JSON.parse(readFileSync(join(CTRL_DIR, f), 'utf8'));
  for (let i = 0; i < (c.controls ?? []).length; i += 1) {
    const x = c.controls[i];
    const prov = String(x.province ?? '');
    const bad = /台湾|台湾省/.test(prov) || inTaiwan(x.lng, x.lat);
    const provOk = PROV_ORDER.some((p) => prov.includes(p));
    if (bad || !provOk) {
      hits.push({ ref, i, name: x.name, lng: x.lng, lat: x.lat, province: prov, district: x.district ?? '', why: bad ? '台湾/境外' : '省份异常' });
    }
  }
}
console.log('异常控制点', hits.length);
for (const h of hits) console.log(h.ref, '#' + h.i, h.name, h.lng.toFixed(3) + ',' + h.lat.toFixed(3), h.province, h.district, '←', h.why);
