import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRailwayMetrics,
  haversineKm,
  projectToRailway,
} from '@railvista/shared';
import { matchCorridor, sliceCorridorForStops, loadCorridors } from './corridors.js';
import { matchCorridorNetwork } from './corridorNetwork.js';

describe('matchCorridor', () => {
  it('loads lixiang / kunli corridors', () => {
    const list = loadCorridors();
    const ids = list.map((c) => c.id);
    assert.ok(ids.includes('lixiang'), 'missing lixiang');
    assert.ok(ids.includes('kunli'), 'missing kunli');
  });

  it('matches Lijiang→Shangri-La on lixiang for C trains', () => {
    const stops = [
      { name: '丽江', lng: 100.2512118, lat: 26.8143271 },
      { name: '小中甸', lng: 99.81346, lat: 27.56238 },
      { name: '香格里拉', lng: 99.6885399, lat: 27.8133154 },
    ];
    const hit = matchCorridor(stops, { trainCode: 'C118' });
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'lixiang');
    const sliced = sliceCorridorForStops(hit!.corridor, stops);
    assert.ok(sliced && sliced.length >= 2);
  });

  it('stitches Kunming→Shangri-La via kunli+lixiang network', () => {
    const stops = [
      { name: '昆明', lng: 102.720287, lat: 25.0186616 },
      { name: '大理', lng: 100.297, lat: 25.591 },
      { name: '丽江', lng: 100.2512118, lat: 26.8143271 },
      { name: '小中甸', lng: 99.81346, lat: 27.56238 },
      { name: '香格里拉', lng: 99.6885399, lat: 27.8133154 },
    ];
    assert.equal(matchCorridor(stops, { trainCode: 'C118' }), null);
    const net = matchCorridorNetwork(stops, { trainCode: 'C118' });
    assert.ok(net);
    assert.deepEqual(net!.corridorIds, ['kunli', 'lixiang']);
    assert.ok(net!.coords.length >= 2);
  });

  it('allows K trains on lixiang conventional corridor (not HSR)', () => {
    const hit = matchCorridor(
      [
        { name: '丽江', lng: 100.2512118, lat: 26.8143271 },
        { name: '香格里拉', lng: 99.6885399, lat: 27.8133154 },
      ],
      { trainCode: 'K123' },
    );
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'lixiang');
  });

  it('still rejects K trains on jingguang HSR', () => {
    assert.equal(
      matchCorridor(
        [
          { name: '北京西', lng: 116.322, lat: 39.895 },
          { name: '广州南', lng: 113.269, lat: 22.989 },
        ],
        { trainCode: 'K123' },
      ),
      null,
    );
  });

  it('loads phase-1 corridors', () => {
    const list = loadCorridors();
    const ids = list.map((c) => c.id).sort();
    for (const id of ['jinghu', 'jingguang', 'hukun', 'xulan', 'jingha', 'haida', 'qingzang']) {
      assert.ok(ids.includes(id), `missing corridor ${id}`);
    }
  });

  it('loads phase-2 coastal/riverside corridors', () => {
    const list = loadCorridors();
    const ids = list.map((c) => c.id);
    for (const id of [
      'qingrong',
      'xulian',
      'yantong',
      'huhang',
      'hangtai',
      'hangwen',
      'fuxia',
      'guangshengang',
      'huningyanjiang',
      'zhengyu',
      'chengyu',
    ]) {
      assert.ok(ids.includes(id), `missing phase-2 corridor ${id}`);
    }
  });

  it('loads phase-3 corridors (incl. ninghang)', () => {
    const list = loadCorridors();
    const ids = list.map((c) => c.id);
    for (const id of [
      'ninghang',
      'hefu',
      'hangchang',
      'daxi',
      'xicheng',
      'yinxi',
      'yinlan',
      'guiguang',
      'guinan',
      'nankun',
      'zhengtai',
      'rilan',
    ]) {
      assert.ok(ids.includes(id), `missing phase-3 corridor ${id}`);
    }
  });

  it('matches Nanjing-Hangzhou on ninghang', () => {
    const hit = matchCorridor([
      { name: '南京南', lng: 118.798, lat: 31.969 },
      { name: '湖州', lng: 120.1, lat: 30.85 },
      { name: '杭州东', lng: 120.213, lat: 30.291 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'ninghang');
    const sliced = sliceCorridorForStops(hit!.corridor, [
      { name: '南京南', lng: 118.798, lat: 31.969 },
      { name: '杭州东', lng: 120.213, lat: 30.291 },
    ]);
    assert.ok(sliced);
    assert.ok(sliced!.length > 100);
  });

  it('matches Hefei-Fuzhou on hefu', () => {
    const hit = matchCorridor([
      { name: '合肥南', lng: 117.285, lat: 31.80 },
      { name: '黄山北', lng: 118.3, lat: 29.8 },
      { name: '福州南', lng: 119.30, lat: 26.12 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'hefu');
  });

  it('matches Xian-Chengdu on xicheng', () => {
    const hit = matchCorridor([
      { name: '西安北', lng: 108.939, lat: 34.377 },
      { name: '汉中', lng: 107.0, lat: 33.1 },
      { name: '成都东', lng: 104.145, lat: 30.644 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'xicheng');
  });

  it('matches Guiyang-Guangzhou on guiguang', () => {
    const hit = matchCorridor([
      { name: '贵阳北', lng: 106.826, lat: 26.649 },
      { name: '桂林西', lng: 110.2, lat: 25.3 },
      { name: '广州南', lng: 113.269, lat: 22.989 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'guiguang');
  });

  it('matches Hangzhou-Taizhou on hangtai even when Hangzhou East is off the stub', () => {
    const hit = matchCorridor([
      { name: '杭州东', lng: 120.213, lat: 30.291 },
      { name: '台州', lng: 121.32, lat: 28.49 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'hangtai');
    const sliced = sliceCorridorForStops(hit!.corridor, [
      { name: '杭州东', lng: 120.213, lat: 30.291 },
      { name: '台州', lng: 121.32, lat: 28.49 },
    ]);
    assert.ok(sliced);
    assert.ok(sliced!.length > 50);
  });

  it('matches HangzhouWest-Wenzhou on hangwen with far terminal snap', () => {
    const hit = matchCorridor([
      { name: '杭州西', lng: 119.99, lat: 30.29 },
      { name: '温州南', lng: 120.68, lat: 28.07 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'hangwen');
    const sliced = sliceCorridorForStops(hit!.corridor, [
      { name: '杭州西', lng: 119.99, lat: 30.29 },
      { name: '温州南', lng: 120.68, lat: 28.07 },
    ]);
    assert.ok(sliced);
    assert.ok(sliced!.length > 50);
  });

  it('matches Shanghai-Hangzhou on huhang (not full hukun)', () => {
    const hit = matchCorridor([
      { name: '上海虹桥', lng: 121.316, lat: 31.194 },
      { name: '嘉兴南', lng: 120.78, lat: 30.68 },
      { name: '杭州东', lng: 120.213, lat: 30.291 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'huhang');
  });

  it('does NOT match 虹桥→嘉兴→海宁→杭州南 as huhang (普速站 ≠ 高铁南站)', () => {
    const hit = matchCorridor([
      { name: '上海虹桥', lng: 121.3165, lat: 31.194 },
      { name: '嘉兴', lng: 120.7595, lat: 30.7665 },
      { name: '海宁', lng: 120.6813, lat: 30.5362 },
      { name: '杭州南', lng: 120.29, lat: 30.1747 },
    ]);
    assert.equal(hit, null);
  });

  it('still matches Shanghai-Kunming on hukun (not truncated huhang)', () => {
    const hit = matchCorridor([
      { name: '上海虹桥', lng: 121.316, lat: 31.194 },
      { name: '杭州东', lng: 120.213, lat: 30.291 },
      { name: '长沙南', lng: 113.066, lat: 28.151 },
      { name: '昆明南', lng: 102.861, lat: 24.873 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'hukun');
  });

  it('matches Guangzhou-HongKong on guangshengang', () => {
    const hit = matchCorridor([
      { name: '广州南', lng: 113.269, lat: 22.989 },
      { name: '深圳北', lng: 114.029, lat: 22.609 },
      { name: '香港西九龙', lng: 114.165, lat: 22.304 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'guangshengang');
  });

  it('does not truncate guangshengang when HongKong lacks coords', () => {
    const corridors = loadCorridors();
    const c = corridors.find((x) => x.id === 'guangshengang')!;
    const sliced = sliceCorridorForStops(c, [
      { name: '广州南', lng: 113.269, lat: 22.989 },
      { name: '深圳北', lng: 114.029, lat: 22.609 },
      { name: '香港西九龙' },
    ]);
    assert.ok(sliced);
    const end = sliced!.at(-1)!;
    assert.ok(end[0] > 114.1, `end should be near West Kowloon, got ${end}`);
    assert.ok(end[1] < 22.35);
  });

  it('matches Qingdao-Rongcheng on qingrong', () => {
    const hit = matchCorridor([
      { name: '青岛', lng: 120.329, lat: 36.336 },
      { name: '烟台南', lng: 121.35, lat: 37.35 },
      { name: '荣成', lng: 122.404, lat: 37.139 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'qingrong');
  });

  it('matches Fuzhou-Xiamen on fuxia', () => {
    const hit = matchCorridor([
      { name: '福州南', lng: 119.386, lat: 25.994 },
      { name: '泉州', lng: 118.68, lat: 24.92 },
      { name: '厦门北', lng: 118.08, lat: 24.64 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'fuxia');
  });

  it('matches Zhengzhou-Chongqing on zhengyu full length', () => {
    const corridors = loadCorridors();
    const c = corridors.find((x) => x.id === 'zhengyu')!;
    const sliced = sliceCorridorForStops(c, [
      { name: '郑州东', lng: 113.777, lat: 34.76 },
      { name: '襄阳东', lng: 112.25, lat: 32.05 },
      { name: '万州北', lng: 108.4, lat: 30.82 },
      { name: '重庆北', lng: 106.57, lat: 29.62 },
    ]);
    assert.ok(sliced);
    assert.ok(sliced!.length > 400);
    const end = sliced!.at(-1)!;
    assert.ok(end[0] < 107, `end should be near Chongqing, got ${end}`);
  });

  it('matches Chengdu-Chongqing on chengyu', () => {
    const hit = matchCorridor([
      { name: '成都东', lng: 104.121, lat: 30.592 },
      { name: '内江北', lng: 105.05, lat: 29.6 },
      { name: '重庆西', lng: 106.46, lat: 29.56 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'chengyu');
  });

  it('matches Beijing-Shanghai OD on jinghu', () => {
    const hit = matchCorridor([
      { name: '北京南', lng: 116.3789, lat: 39.8651 },
      { name: '济南西', lng: 116.885, lat: 36.668 },
      { name: '南京南', lng: 118.798, lat: 31.969 },
      { name: '上海虹桥', lng: 121.316, lat: 31.194 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'jinghu');
  });

  it('matches Beijing-Guangzhou OD on jingguang', () => {
    const hit = matchCorridor([
      { name: '北京西', lng: 116.322, lat: 39.895 },
      { name: '石家庄', lng: 114.485, lat: 38.01 },
      { name: '郑州东', lng: 113.777, lat: 34.76 },
      { name: '武汉', lng: 114.317, lat: 30.607 },
      { name: '长沙南', lng: 113.066, lat: 28.151 },
      { name: '广州南', lng: 113.269, lat: 22.989 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'jingguang');
  });

  it('matches 重庆西→贵阳东 on yugui (贵阳东≈贵阳北 terminus)', () => {
    const hit = matchCorridor(
      [
        { name: '重庆西', lng: 106.4322, lat: 29.5029 },
        { name: '贵阳东', lng: 106.7407, lat: 26.6676 },
      ],
      { trainCode: 'G1535' },
    );
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'yugui');
    const sliced = sliceCorridorForStops(hit!.corridor, [
      { name: '重庆西', lng: 106.4322, lat: 29.5029 },
      { name: '贵阳东', lng: 106.7407, lat: 26.6676 },
    ]);
    assert.ok(sliced && sliced.length >= 20);
  });

  it('does NOT match K599-like 北京丰台→广州白云 on jingguang (普速平行线)', () => {
    // 安阳/鹤壁 距安阳东/鹤壁东仅数公里，旧逻辑会误套京广高铁导致「线不经过站」
    const stops = [
      { name: '北京丰台', lng: 116.2953, lat: 39.85 },
      { name: '石家庄', lng: 114.485, lat: 38.01 },
      { name: '安阳', lng: 114.3343, lat: 36.1046 },
      { name: '鹤壁', lng: 114.2674, lat: 35.7602 },
      { name: '郑州', lng: 113.658, lat: 34.758 },
      { name: '武汉', lng: 114.317, lat: 30.607 },
      { name: '长沙', lng: 113.0, lat: 28.2 },
      { name: '广州白云', lng: 113.2405, lat: 23.194 },
    ];
    assert.equal(matchCorridor(stops, { trainCode: 'K599' }), null);
    assert.equal(matchCorridorNetwork(stops, { trainCode: 'K599' }), null);
    // 无车次时方位冲突也应拦下（安阳≠安阳东）
    assert.equal(matchCorridor(stops), null);
  });

  it('matches Z-train 西宁→拉萨 on qingzang (普速走廊)', () => {
    const hit = matchCorridor(
      [
        { name: '西宁', lng: 101.749, lat: 36.623 },
        { name: '格尔木', lng: 94.905, lat: 36.402 },
        { name: '拉萨', lng: 91.068, lat: 29.623 },
      ],
      { trainCode: 'Z164' },
    );
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'qingzang');
  });

  it('rejects Z-train on jingguang HSR corridor', () => {
    const hit = matchCorridor(
      [
        { name: '北京西', lng: 116.322, lat: 39.895 },
        { name: '郑州东', lng: 113.777, lat: 34.76 },
        { name: '广州南', lng: 113.269, lat: 22.989 },
      ],
      { trainCode: 'Z5' },
    );
    assert.equal(hit, null);
  });

  it('Z509 兰州→西宁→乌鲁木齐 matches lanxin HSR (not Hexi lanxinxian)', () => {
    // Z509 实际走兰新高铁经西宁；普速兰新线河西绕开西宁 ~119km
    const stops = [
      { name: '兰州', lng: 103.8485056, lat: 36.034178 },
      { name: '西宁', lng: 101.814362, lat: 36.620233 },
      { name: '张掖西', lng: 100.4265546, lat: 38.9225017 },
      { name: '嘉峪关南', lng: 98.3092476, lat: 39.7167075 },
      { name: '哈密', lng: 93.5046494, lat: 42.8484396 },
      { name: '吐鲁番北', lng: 89.1079716, lat: 43.0213639 },
      { name: '乌鲁木齐', lng: 87.5249702, lat: 43.8379242 },
    ];
    const hit = matchCorridor(stops, { trainCode: 'Z509' });
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'lanxin');
    const sliced = sliceCorridorForStops(hit!.corridor, stops);
    assert.ok(sliced && sliced.length >= 2);
    const xn = stops[1];
    let best = Infinity;
    for (const xy of sliced!) {
      best = Math.min(
        best,
        haversineKm({ lng: xy[0], lat: xy[1] }, { lng: xn.lng, lat: xn.lat }),
      );
    }
    assert.ok(best < 5, `西宁应贴合切片，实际 ${best.toFixed(1)}km`);
  });

  it('Z509 short OD 兰州→西宁→乌鲁木齐 still prefers lanxin over lanxinxian', () => {
    const hit = matchCorridor(
      [
        { name: '兰州', lng: 103.8485056, lat: 36.034178 },
        { name: '西宁', lng: 101.814362, lat: 36.620233 },
        { name: '乌鲁木齐', lng: 87.5249702, lat: 43.8379242 },
      ],
      { trainCode: 'Z509' },
    );
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'lanxin');
  });

  it('Hexi conventional Z 兰州→武威→乌鲁木齐 stays on lanxinxian', () => {
    const hit = matchCorridor(
      [
        { name: '兰州', lng: 103.8485056, lat: 36.034178 },
        { name: '武威', lng: 102.6221806, lat: 37.9036926 },
        { name: '张掖', lng: 100.5180683, lat: 38.9735459 },
        { name: '嘉峪关', lng: 98.2539405, lat: 39.7638408 },
        { name: '乌鲁木齐', lng: 87.5249702, lat: 43.8379242 },
      ],
      { trainCode: 'Z40' },
    );
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'lanxinxian');
  });

  it('still matches G-train 北京西→广州南 on jingguang', () => {
    const hit = matchCorridor(
      [
        { name: '北京西', lng: 116.322, lat: 39.895 },
        { name: '石家庄', lng: 114.485, lat: 38.01 },
        { name: '安阳东', lng: 114.427, lat: 36.108 },
        { name: '鹤壁东', lng: 114.336, lat: 35.756 },
        { name: '郑州东', lng: 113.777, lat: 34.76 },
        { name: '武汉', lng: 114.317, lat: 30.607 },
        { name: '长沙南', lng: 113.066, lat: 28.151 },
        { name: '广州南', lng: 113.269, lat: 22.989 },
      ],
      { trainCode: 'G79' },
    );
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'jingguang');
  });

  it('matches Shanghai-Kunming OD on hukun', () => {
    const hit = matchCorridor([
      { name: '上海虹桥', lng: 121.316, lat: 31.194 },
      { name: '杭州东', lng: 120.213, lat: 30.291 },
      { name: '南昌西', lng: 115.792, lat: 28.663 },
      { name: '长沙南', lng: 113.066, lat: 28.151 },
      { name: '贵阳北', lng: 106.673, lat: 26.65 },
      { name: '昆明南', lng: 102.861, lat: 24.873 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'hukun');
  });

  it('matches Xuzhou-Lanzhou OD on xulan', () => {
    const hit = matchCorridor([
      { name: '徐州东', lng: 117.306, lat: 34.267 },
      { name: '郑州东', lng: 113.777, lat: 34.76 },
      { name: '西安北', lng: 108.939, lat: 34.377 },
      { name: '兰州西', lng: 103.758, lat: 36.069 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'xulan');
  });

  it('matches Beijing-Harbin OD on jingha', () => {
    const hit = matchCorridor([
      { name: '北京朝阳', lng: 116.506, lat: 39.944 },
      { name: '承德南', lng: 117.932, lat: 40.886 },
      { name: '沈阳', lng: 123.4, lat: 41.8 },
      { name: '长春西', lng: 125.196, lat: 43.873 },
      { name: '哈尔滨西', lng: 126.575, lat: 45.706 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'jingha');
  });

  it('matches Shenyang-Dalian OD on haida', () => {
    const hit = matchCorridor([
      { name: '沈阳', lng: 123.4, lat: 41.8 },
      { name: '鞍山西', lng: 122.94, lat: 41.12 },
      { name: '营口东', lng: 122.3, lat: 40.58 },
      { name: '大连北', lng: 121.603, lat: 39.087 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'haida');
  });

  it('does NOT match Taiyuan-Shanghai as jinghu (partial southern overlap)', () => {
    const hit = matchCorridor([
      { name: '太原南', lng: 112.598, lat: 37.736 },
      { name: '阳泉北', lng: 113.451, lat: 38.085 },
      { name: '石家庄', lng: 114.485, lat: 38.01 },
      { name: '郑州东', lng: 113.777, lat: 34.76 },
      { name: '合肥', lng: 117.285, lat: 31.885 },
      { name: '南京南', lng: 118.798, lat: 31.969 },
      { name: '苏州北', lng: 120.553, lat: 31.423 },
      { name: '上海虹桥', lng: 121.316, lat: 31.194 },
    ]);
    assert.equal(hit, null);
  });

  it('matches jingguang even when many intermediate names miss hints', () => {
    const hit = matchCorridor([
      { name: '北京西', lng: 116.322, lat: 39.895 },
      { name: '某某东', lng: 115.0, lat: 38.2 }, // 近走廊但不在 hints
      { name: '石家庄', lng: 114.485, lat: 38.01 },
      { name: '临时站', lng: 114.0, lat: 34.5 },
      { name: '长沙南', lng: 113.066, lat: 28.151 },
      { name: '广州南', lng: 113.269, lat: 22.989 },
    ]);
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'jingguang');
  });

  it('sliceCorridorForStops rejects Taiyuan projected onto jinghu', () => {
    const corridors = loadCorridors();
    const jinghu = corridors.find((c) => c.id === 'jinghu')!;
    const sliced = sliceCorridorForStops(jinghu, [
      { name: '太原南', lng: 112.598, lat: 37.736 },
      { name: '上海虹桥', lng: 121.316, lat: 31.194 },
    ]);
    assert.equal(sliced, null);
  });

  it('sliceCorridorForStops keeps jingguang Beijing-Guangzhou length', () => {
    const corridors = loadCorridors();
    const c = corridors.find((x) => x.id === 'jingguang')!;
    const sliced = sliceCorridorForStops(c, [
      { name: '北京西', lng: 116.322, lat: 39.895 },
      { name: '郑州东', lng: 113.777, lat: 34.76 },
      { name: '广州南', lng: 113.269, lat: 22.989 },
    ]);
    assert.ok(sliced);
    assert.ok(sliced!.length > 200);
  });

  it('does not truncate hukun to Changsha when Kunming lacks coords', () => {
    const corridors = loadCorridors();
    const c = corridors.find((x) => x.id === 'hukun')!;
    // 昆明南缺坐标时，应用走廊终点兜底，而不是截到长沙南
    const sliced = sliceCorridorForStops(c, [
      { name: '上海虹桥', lng: 121.316, lat: 31.194 },
      { name: '杭州东', lng: 120.213, lat: 30.291 },
      { name: '长沙南', lng: 113.066, lat: 28.151 },
      { name: '昆明南' },
    ]);
    assert.ok(sliced);
    const end = sliced!.at(-1)!;
    assert.ok(end[0] < 104, `end should be near Kunming, got ${end}`);
    assert.ok(sliced!.length > 800);
  });

  it('slices hukun Shanghai-Kunming full length', () => {
    const corridors = loadCorridors();
    const c = corridors.find((x) => x.id === 'hukun')!;
    const sliced = sliceCorridorForStops(c, [
      { name: '上海虹桥', lng: 121.316, lat: 31.194 },
      { name: '长沙南', lng: 113.066, lat: 28.151 },
      { name: '昆明南', lng: 102.861, lat: 24.873 },
    ]);
    assert.ok(sliced);
    assert.ok(sliced!.length > 800);
    const end = sliced!.at(-1)!;
    assert.ok(end[0] < 104, `end lng should be near Kunming, got ${end}`);
  });

  it('still matches and slices jinghu / jingguang after hukun fixes', () => {
    assert.equal(
      matchCorridor([
        { name: '北京南', lng: 116.3789, lat: 39.8651 },
        { name: '南京南', lng: 118.798, lat: 31.969 },
        { name: '上海虹桥', lng: 121.316, lat: 31.194 },
      ])?.corridor.id,
      'jinghu',
    );
    assert.equal(
      matchCorridor([
        { name: '北京西', lng: 116.322, lat: 39.895 },
        { name: '武汉', lng: 114.317, lat: 30.607 },
        { name: '广州南', lng: 113.269, lat: 22.989 },
      ])?.corridor.id,
      'jingguang',
    );
  });
});

describe('matchCorridorNetwork', () => {
  it('stitches 济南西→杭州东 via jinghu+ninghang', () => {
    const hit = matchCorridorNetwork([
      { name: '济南西', lng: 116.885, lat: 36.668 },
      { name: '南京南', lng: 118.798, lat: 31.969 },
      { name: '杭州东', lng: 120.213, lat: 30.291 },
    ]);
    assert.ok(hit, 'expected network match');
    assert.ok(hit!.corridorIds.includes('jinghu'));
    assert.ok(hit!.corridorIds.includes('ninghang'));
    assert.ok(hit!.coords.length > 200);
    assert.ok(hit!.hops >= 2);
  });

  it('stitches 太原南→兰州西 via daxi+xulan (or zhengtai+xulan)', () => {
    const hit = matchCorridorNetwork([
      { name: '太原南', lng: 112.598, lat: 37.736 },
      { name: '西安北', lng: 108.939, lat: 34.377 },
      { name: '兰州西', lng: 103.758, lat: 36.069 },
    ]);
    assert.ok(hit, 'expected network match');
    assert.ok(hit!.corridorIds.includes('xulan'));
    // 经停含西安北时应优先大西+徐兰；至少要是含徐兰的两段精品拼接
    assert.ok(
      hit!.corridorIds.includes('daxi') || hit!.corridorIds.includes('zhengtai'),
      `unexpected path ${hit!.corridorIds.join('+')}`,
    );
    assert.ok(hit!.coords.length > 200);
  });

  it('does not network-match when single corridor already covers OD', () => {
    // 京沪全程应由单走廊处理，路网返回 null
    const hit = matchCorridorNetwork([
      { name: '北京南', lng: 116.3789, lat: 39.8651 },
      { name: '南京南', lng: 118.798, lat: 31.969 },
      { name: '上海虹桥', lng: 121.316, lat: 31.194 },
    ]);
    assert.equal(hit, null);
  });

  it('stitches 厦门北→北京南 via fuxia+hefu+jinghu (not hukun via Shanghai)', () => {
    const stops = [
      { name: '厦门北', lng: 118.004482, lat: 24.597728 },
      { name: '福州南', lng: 119.386113, lat: 25.994224 },
      { name: '上饶', lng: 117.941062, lat: 28.64769 },
      { name: '黄山北', lng: 118.22474, lat: 29.783277 },
      { name: '合肥南', lng: 117.316, lat: 31.798 },
      { name: '蚌埠南', lng: 117.416, lat: 32.917 },
      { name: '北京南', lng: 116.3789, lat: 39.8651 },
    ];
    const hit = matchCorridorNetwork(stops);
    assert.ok(hit, 'expected network match');
    assert.deepEqual(hit!.corridorIds, ['fuxia', 'hefu', 'jinghu']);
    assert.ok(!hit!.corridorIds.includes('hukun'), 'must not detour via 沪昆');
    // 折线不应摸到上海一带
    const maxLng = Math.max(...hit!.coords.map((c) => c[0]));
    assert.ok(maxLng < 120.5, `unexpected east excursion maxLng=${maxLng}`);
    assert.ok(hit!.coords.length > 400);

    const start = hit!.coords[0];
    const end = hit!.coords[hit!.coords.length - 1];
    assert.ok(
      haversineKm({ lng: start[0], lat: start[1] }, { lng: stops[0].lng, lat: stops[0].lat }) < 40,
      `start must be near 厦门北, got ${start}`,
    );
    assert.ok(
      haversineKm({ lng: end[0], lat: end[1] }, { lng: stops[6].lng, lat: stops[6].lat }) < 40,
      `end must be near 北京南, got ${end}`,
    );

    let maxJump = 0;
    for (let i = 1; i < hit!.coords.length; i++) {
      const d = haversineKm(
        { lng: hit!.coords[i - 1][0], lat: hit!.coords[i - 1][1] },
        { lng: hit!.coords[i][0], lat: hit!.coords[i][1] },
      );
      if (d > maxJump) maxJump = d;
    }
    // 合肥南→蚌埠南桥接约 125km；方向拼错会出现 800km+
    assert.ok(maxJump < 280, `chaotic jump ${maxJump.toFixed(1)}km`);

    const { path, lengthKm } = buildRailwayMetrics(hit!.coords);
    assert.ok(lengthKm > 1500 && lengthKm < 2800, `railKm=${lengthKm.toFixed(0)} out of range`);
    let lastProg = -0.02;
    for (const s of stops) {
      const p = projectToRailway(path, lengthKm, s.lng, s.lat);
      assert.ok(p.distKm < 45, `${s.name} far from rail ${p.distKm}`);
      assert.ok(p.progress + 0.04 >= lastProg, `${s.name} progress regress ${lastProg}→${p.progress}`);
      lastProg = Math.max(lastProg, p.progress);
    }
  });

  it('stitches 鹤壁东→合肥南 via jingguang+zhengfu+shanghehang', () => {
    const hit = matchCorridorNetwork([
      { name: '鹤壁东', lng: 114.336, lat: 35.756 },
      { name: '郑州东', lng: 113.777, lat: 34.76 },
      { name: '周口东', lng: 114.7407189, lat: 33.6468018 },
      { name: '阜阳西', lng: 115.734, lat: 32.916 },
      { name: '淮南南', lng: 117.0359185, lat: 32.5442515 },
      { name: '合肥南', lng: 117.316, lat: 31.798 },
    ]);
    assert.ok(hit, 'expected network match');
    assert.deepEqual(hit!.corridorIds, ['jingguang', 'zhengfu', 'shanghehang']);
    assert.ok(hit!.coords.length > 200);
    const start = hit!.coords[0];
    const end = hit!.coords[hit!.coords.length - 1];
    assert.ok(
      haversineKm({ lng: start[0], lat: start[1] }, { lng: 114.336, lat: 35.756 }) < 40,
    );
    assert.ok(
      haversineKm({ lng: end[0], lat: end[1] }, { lng: 117.316, lat: 31.798 }) < 40,
    );
  });

  it('does not stitch 虹桥→嘉兴→海宁→杭州南 as huhang network', () => {
    // 起终若都贴 huhang，路网直接放弃；单走廊也会因方位冲突拒绝
    assert.equal(
      matchCorridor([
        { name: '上海虹桥', lng: 121.3165, lat: 31.194 },
        { name: '嘉兴', lng: 120.7595, lat: 30.7665 },
        { name: '海宁', lng: 120.6813, lat: 30.5362 },
        { name: '杭州南', lng: 120.29, lat: 30.1747 },
      ]),
      null,
    );
  });

  it('D2206 上海虹桥→南通西 slices hutong with ends on stations', () => {
    const stops = [
      { name: '上海虹桥', lng: 121.3162004, lat: 31.1959782 },
      { name: '太仓南', lng: 121.1476314, lat: 31.4101421 },
      { name: '太仓', lng: 121.203621, lat: 31.502318 },
      { name: '常熟', lng: 120.925844, lat: 31.632807 },
      { name: '张家港', lng: 120.6692114, lat: 31.8193598 },
      { name: '南通西', lng: 120.761105, lat: 32.103557 },
    ];
    const hit = matchCorridor(stops, { trainCode: 'D2206' });
    assert.ok(hit);
    assert.equal(hit!.corridor.id, 'hutong');
    const sliced = sliceCorridorForStops(hit!.corridor, stops);
    assert.ok(sliced && sliced.length >= 2);
    const start = sliced![0];
    const end = sliced![sliced!.length - 1];
    assert.ok(
      haversineKm({ lng: start[0], lat: start[1] }, { lng: 121.3162004, lat: 31.1959782 }) < 1,
      `start gap ${haversineKm({ lng: start[0], lat: start[1] }, { lng: 121.3162004, lat: 31.1959782 })}`,
    );
    assert.ok(
      haversineKm({ lng: end[0], lat: end[1] }, { lng: 120.761105, lat: 32.103557 }) < 1,
      `end gap ${haversineKm({ lng: end[0], lat: end[1] }, { lng: 120.761105, lat: 32.103557 })}`,
    );
  });
});
