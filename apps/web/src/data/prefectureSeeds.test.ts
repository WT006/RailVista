/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { roadDisplayPlace } from './prefectureSeeds.ts';

describe('roadDisplayPlace', () => {
  it('assigns Maijishan to Gansu / Tianshui, not the harvest label 陕西', () => {
    const place = roadDisplayPlace(106, 34.35, '陕西');
    assert.equal(place.displayProvince, '甘肃');
    assert.equal(place.displayCity, '天水');
  });

  it('assigns Wudang to Hubei / Shiyan, not 河南', () => {
    const place = roadDisplayPlace(111, 32.4, '河南');
    assert.equal(place.displayProvince, '湖北');
    assert.equal(place.displayCity, '十堰');
  });

  it('assigns Xuankong Si to Shanxi / Datong, not 河北', () => {
    const place = roadDisplayPlace(113.70799, 39.6597, '河北');
    assert.equal(place.displayProvince, '山西');
    assert.equal(place.displayCity, '大同');
  });

  it('assigns Diqing spots to Yunnan, not the Sichuan harvest bbox', () => {
    for (const [lng, lat] of [
      [100.05, 27.28],
      [99.77, 27.87],
      [99.7, 27.82],
    ] as Array<[number, number]>) {
      const place = roadDisplayPlace(lng, lat, '四川');
      assert.equal(place.displayProvince, '云南');
      assert.equal(place.displayCity, '迪庆');
    }
  });

  it('keeps Hong Kong / Macau out of Guangdong', () => {
    const hk = roadDisplayPlace(114.16765, 22.29062, '广东');
    assert.equal(hk.displayProvince, '香港');
    const mo = roadDisplayPlace(113.543, 22.198, '广东');
    assert.equal(mo.displayProvince, '澳门');
  });

  it('falls back to the harvest label only when the point misses prefecture polygons', () => {
    const place = roadDisplayPlace(0, 0, '陕西');
    assert.equal(place.displayProvince, '陕西');
    assert.equal(place.displayCity, '陕西');
  });
});
