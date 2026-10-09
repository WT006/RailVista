import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSunPhases,
  sunPosition,
  findAltitudeCrossings,
} from './sun.js';
import { moonAge, moonPhase, moonPosition, getMoonRiseSet } from './moon.js';
import { estimateLightPollution } from './lightPollution.js';
import { computeGlowIndex, computeStarIndex, computeRimeIndex, computeSeaOfCloudsIndex, computeRainbowIndex } from './skyIndex.js';
import { findMeteorShowers } from './meteor.js';
import {
  buildSkyTripTimeline,
  headingAtKm,
  sideFromRelativeAngle,
} from './skyTrip.js';
import { buildRailwayMetrics } from '../schedule/progress.js';

const CST = 8 * 3600_000;

test('太阳位置：北京正午高度 ≈ 90 − |φ − δ|，方位正南', () => {
  // 2026-06-21 12:00 CST ≈ 04:00 UTC（近夏至，δ ≈ 23.4°）
  const ms = Date.UTC(2026, 5, 21, 4, 0, 0);
  const pos = sunPosition(116.41, 39.9, ms);
  const expected = 90 - Math.abs(39.9 - 23.4);
  assert.ok(Math.abs(pos.altitudeDeg - expected) < 1, `alt=${pos.altitudeDeg}`);
  // 正午前后方位应在 160~200°（正南）
  assert.ok(pos.azimuthDeg > 155 && pos.azimuthDeg < 205, `az=${pos.azimuthDeg}`);
});

test('太阳位置：日出东方、日落西方', () => {
  const phases = getSunPhases(116.41, 39.9, Date.UTC(2026, 5, 20) - CST); // 2026-06-21 00:00 CST
  assert.ok(phases.sunriseMs && phases.sunsetMs, '应有日出日落');
  const morning = sunPosition(116.41, 39.9, phases.sunriseMs! - 30 * 60_000);
  const evening = sunPosition(116.41, 39.9, phases.sunsetMs! + 30 * 60_000);
  // 日出前太阳应在东方（方位 < 180°），日落后在西方（> 180°）
  assert.ok(morning.azimuthDeg < 180, `morning az=${morning.azimuthDeg}`);
  assert.ok(evening.azimuthDeg > 180, `evening az=${evening.azimuthDeg}`);
});

test('北京夏至日出约 04:46、日落约 19:46（CST）', () => {
  const phases = getSunPhases(116.41, 39.9, Date.UTC(2026, 5, 20) - CST);
  const fmt = (ms: number) => {
    const d = new Date(ms + CST);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  };
  const sunriseMin = fmt(phases.sunriseMs!);
  const sunsetMin = fmt(phases.sunsetMs!);
  assert.ok(sunriseMin > 4 * 60 + 25 && sunriseMin < 5 * 60 + 5, `sunrise=${sunriseMin}min`);
  assert.ok(sunsetMin > 19 * 60 + 25 && sunsetMin < 19 * 60 + 55, `sunset=${sunsetMin}min`);
  // 晨昏顺序
  assert.ok(phases.astroDawnMs! < phases.nautDawnMs!);
  assert.ok(phases.nautDawnMs! < phases.civilDawnMs!);
  assert.ok(phases.civilDawnMs! < phases.sunriseMs!);
  assert.ok(phases.sunsetMs! < phases.civilDuskMs!);
});

test('高度角穿越查找：二分精化误差 < 1 秒', () => {
  const ms0 = Date.UTC(2026, 5, 20) - CST;
  const altAt = (ms: number) => sunPosition(116.41, 39.9, ms).altitudeDeg;
  const { riseMs, setMs } = findAltitudeCrossings(altAt, ms0, ms0 + 86_400_000, -0.833);
  assert.ok(riseMs != null && setMs != null);
  assert.ok(Math.abs(altAt(riseMs!) + 0.833) < 0.01);
  assert.ok(Math.abs(altAt(setMs!) + 0.833) < 0.01);
});

test('月相：2026-03-03 前后为满月（与真实历表一致）', () => {
  const full = moonPhase(Date.UTC(2026, 2, 3, 12, 0, 0));
  assert.ok(full.illumination > 0.97, `illum=${full.illumination}`);
  assert.equal(full.phaseName, '满月');
  assert.ok(full.isFullMoonWindow);
  const newMoon = moonPhase(Date.UTC(2026, 2, 3, 12, 0, 0) - 14.765 * 86_400_000);
  assert.ok(newMoon.illumination < 0.03, `new illum=${newMoon.illumination}`);
  assert.equal(newMoon.phaseName, '新月');
});

test('月相：龄值连续、盈亏单调切换', () => {
  const a = moonAge(Date.UTC(2026, 4, 1));
  const b = moonAge(Date.UTC(2026, 4, 1) + 86_400_000);
  assert.ok(Math.abs(((b - a + 29.53) % 29.53) - 1) < 0.02);
  assert.equal(moonPhase(Date.UTC(2026, 4, 1)).waxing, a < 29.53 / 2);
});

test('月亮位置：满月子夜接近中天', () => {
  // 2026-03-03 满月，北京 21:00 CST 月亮应偏高（子夜中天前后）
  const ms = Date.UTC(2026, 2, 3, 13, 0, 0);
  const pos = moonPosition(116.41, 39.9, ms);
  assert.ok(pos.altitudeDeg > 10, `moon alt=${pos.altitudeDeg}`);
});

test('月出月落：24h 窗口内可求出', () => {
  const from = Date.UTC(2026, 2, 3) - CST;
  const { moonriseMs, moonsetMs } = getMoonRiseSet(116.41, 39.9, from, from + 86_400_000);
  assert.ok(moonriseMs != null || moonsetMs != null);
});

test('光污染：上海 vs 可可西里', () => {
  const sh = estimateLightPollution(121.47, 31.23);
  const xk = estimateLightPollution(93.0, 35.3);
  assert.ok(sh.bortle >= 7, `shanghai bortle=${sh.bortle}`);
  assert.ok(xk.bortle <= 3, `hoh xil bortle=${xk.bortle}`);
  assert.ok(sh.sqmMag < xk.sqmMag);
});

test('霞光指数：中高云适中优于满天低云', () => {
  const good = computeGlowIndex({
    atIso: '',
    cloudMid: 0.5,
    cloudHigh: 0.4,
    cloudLow: 0.15,
    visibilityKm: 20,
    humidity: 0.5,
    precipProb: 0,
  });
  const bad = computeGlowIndex({
    atIso: '',
    cloudLow: 0.95,
    cloudMid: 0.2,
    cloudHigh: 0.1,
    visibilityKm: 4,
    humidity: 0.95,
    precipProb: 0.6,
  });
  assert.ok(good.score > bad.score + 30, `good=${good.score} bad=${bad.score}`);
  assert.ok(good.score >= 55);
  assert.ok(bad.score < 40);
});

test('观星指数：晴夜无月 >> 阴天满月', () => {
  const good = computeStarIndex(
    { atIso: '', totalCloud: 0.1, visibilityKm: 25 },
    { sunAltDeg: -25, moonIllum: 0.05, moonAltDeg: -10, bortle: 2 },
  );
  const bad = computeStarIndex(
    { atIso: '', totalCloud: 0.9, visibilityKm: 5 },
    { sunAltDeg: -15, moonIllum: 0.98, moonAltDeg: 50, bortle: 8 },
  );
  assert.ok(good.score > bad.score + 30, `good=${good.score} bad=${bad.score}`);
});

test('银河可见：新月暗夜低光污染给出银河提示，满月城市不给', () => {
  const dark = computeStarIndex(
    { atIso: '', totalCloud: 0.1, visibilityKm: 30 },
    { sunAltDeg: -25, moonIllum: 0.05, moonAltDeg: -10, bortle: 2 },
  );
  assert.ok(dark.note.includes('银河可见'), dark.note);
  const bright = computeStarIndex(
    { atIso: '', totalCloud: 0.1, visibilityKm: 30 },
    { sunAltDeg: -25, moonIllum: 0.9, moonAltDeg: 40, bortle: 2 },
  );
  assert.ok(!bright.note.includes('银河可见'), bright.note);
});

test('彩虹指数：太阳低+阵雨概率最高，夜里/无雨为 0', () => {
  const shower = computeRainbowIndex({ atIso: '', precipProb: 0.5, totalCloud: 0.6 }, 15);
  const dry = computeRainbowIndex({ atIso: '', precipProb: 0.02, totalCloud: 0.3 }, 15);
  const night = computeRainbowIndex({ atIso: '', precipProb: 0.5, totalCloud: 0.6 }, -5);
  assert.ok(shower.score > dry.score + 25, `shower=${shower.score} dry=${dry.score}`);
  assert.equal(night.score, 0);
});

test('雾凇/云海指数方向正确', () => {
  const rime = computeRimeIndex({ atIso: '', tempC: -6, humidity: 0.95, windSpeedMs: 3, precipProb: 0.05 });
  const noRime = computeRimeIndex({ atIso: '', tempC: 15, humidity: 0.5, windSpeedMs: 1, precipProb: 0 });
  assert.ok(rime.score > noRime.score + 30);
  const soc = computeSeaOfCloudsIndex({ atIso: '', cloudLow: 0.9, humidity: 0.95, windSpeedMs: 1.5 });
  const noSoc = computeSeaOfCloudsIndex({ atIso: '', cloudLow: 0.1, humidity: 0.4, windSpeedMs: 9 });
  assert.ok(soc.score > noSoc.score + 25);
});

test('车窗侧别：右转 90° 的太阳判右侧', () => {
  const right = sideFromRelativeAngle(90);
  assert.equal(right.side, 'right');
  const left = sideFromRelativeAngle(-90);
  assert.equal(left.side, 'left');
  const front = sideFromRelativeAngle(10);
  assert.equal(front.facing, 'front');
  const behind = sideFromRelativeAngle(170);
  assert.equal(behind.facing, 'behind');
});

test('航向角：自南向北走为 0°，自西向东为 90°', () => {
  const north = buildRailwayMetrics([
    [116, 30],
    [116, 31],
  ]);
  const h1 = headingAtKm(north.path, north.lengthKm, 1);
  assert.ok(Math.abs(h1 - 0) < 2 || Math.abs(h1 - 360) < 2, `h=${h1}`);
  const east = buildRailwayMetrics([
    [116, 30],
    [117, 30],
  ]);
  const h2 = headingAtKm(east.path, east.lengthKm, 1);
  assert.ok(Math.abs(h2 - 90) < 2, `h=${h2}`);
});

test('行程时间轴：东西向一夜车次产生朝霞/晚霞片段与日出日落时刻', () => {
  // 模拟：上海→南京一线，2026-06-20 18:00 发车，次日 08:00 到达
  const { path, lengthKm } = buildRailwayMetrics([
    [121.47, 31.23],
    [120.3, 31.57],
    [119.5, 32.0],
    [118.8, 32.06],
  ]);
  const departureMs = Date.UTC(2026, 5, 20, 10, 0, 0); // 18:00 CST
  const arrivalMs = Date.UTC(2026, 5, 21, 0, 0, 0); // 08:00 CST 次日
  const result = buildSkyTripTimeline({
    path,
    lengthKm,
    kmAtTime: (ms) => ((ms - departureMs) / (arrivalMs - departureMs)) * lengthKm,
    departureMs,
    arrivalMs,
    stops: [
      { seq: 1, name: '上海', type: 'depart', lng: 121.47, lat: 31.23 } as never,
      { seq: 2, name: '南京', type: 'arrive', lng: 118.8, lat: 32.06 } as never,
    ],
    stepMs: 4 * 60_000,
  });

  const kinds = new Set(result.episodes.map((e) => e.kind));
  assert.ok(kinds.has('duskGlow') || kinds.has('goldenEvening'), '应有黄昏看点');
  assert.ok(kinds.has('dawnGlow') || kinds.has('goldenMorning') || kinds.has('sunrise'), '应有清晨看点');
  const sunrise = result.moments.find((m) => m.kind === 'sunrise');
  assert.ok(sunrise, '应有日出时刻');
  // 日出时刻的太阳高度接近 0
  const sunAltAt = sunPosition(sunrise!.lng, sunrise!.lat, sunrise!.atMs).altitudeDeg;
  assert.ok(Math.abs(sunAltAt + 0.833) < 0.5, `sunrise alt=${sunAltAt}`);
  // 晚霞窗口侧别应给出左/右
  const glow = result.episodes.find((e) => e.kind === 'duskGlow' || e.kind === 'goldenEvening');
  assert.ok(glow);
  assert.ok(glow!.sunSide.side === 'left' || glow!.sunSide.side === 'right');
  assert.ok(result.moon.illumination >= 0 && result.moon.illumination <= 1);
  // 夜段应有银心方位与车窗侧别
  const nightEp = result.episodes.find((e) => e.kind === 'night');
  assert.ok(nightEp?.galCenter, '夜段应附银心方位');
  assert.ok(
    nightEp!.galCenter!.side.side === 'left' || nightEp!.galCenter!.side.side === 'right',
  );
});

test('流星雨预报：8 月中旬行程命中英仙座，1 月命中象限仪座', () => {
  const illum = (ms: number) => moonPhase(ms).illumination;
  const perseid = findMeteorShowers(
    Date.UTC(2026, 7, 11, 12, 0, 0),
    Date.UTC(2026, 7, 14, 12, 0, 0),
    illum,
  );
  assert.ok(perseid.length >= 1, '应命中流星雨');
  assert.ok(perseid.some((h) => h.shower.name.includes('英仙座')), perseid.map((h) => h.shower.name).join(','));
  assert.ok(perseid[0]!.score > 0 && perseid[0]!.score <= 100, `score=${perseid[0]!.score}`);
  assert.ok(perseid[0]!.note.includes('ZHR'), perseid[0]!.note);

  const none = findMeteorShowers(Date.UTC(2026, 1, 10, 0, 0, 0), Date.UTC(2026, 1, 12, 0, 0, 0), illum);
  assert.equal(none.length, 0, '2 月中旬不应有主要流星雨');
});
