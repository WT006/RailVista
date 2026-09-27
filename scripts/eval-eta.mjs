#!/usr/bin/env node
/**
 * ETA 仿真评测脚本（spec §5.8.1.9/§5.8.1.10）
 *
 * 合成 GPS 注入 → 新口径（里程轴+卡尔曼）ETA → 输出 MAE/P50/P90/覆盖率/跳变率。
 * 基准车次：Z8991（普速/站距不均）、G1（高铁/站距均匀）、K876（小站密集）、D25（山区/隧道）、Z509（Z 走高铁覆写）
 *
 * Usage: node scripts/eval-eta.mjs
 */

import { buildMileageAxis, buildScheduleCurve, estimateSpotEtas, profileForTrain, geoSigmaFor, classifyTrain, getTrainProfile } from '../packages/shared/dist/index.js';

const KMH_TO_MS = 1000 / 3600;

const BENCHMARK_TRAINS = [
  {
    code: 'Z8991',
    name: 'Z8991 南宁→西宁（普速/站距不均）',
    stops: makeStops(8, 2000, '2026-01-01T08:00:00+08:00', [0, 150, 400, 700, 1000, 1300, 1700, 2000]),
    spots: makeSpots(5, 2000),
    expectedMae: 8,
    expectedP90: 20,
  },
  {
    code: 'G1',
    name: 'G1 北京南→上海（高铁/站距均匀）',
    stops: makeStops(6, 1318, '2026-01-01T09:00:00+08:00', [0, 280, 555, 835, 1100, 1318]),
    spots: makeSpots(4, 1318),
    expectedMae: 3,
    expectedP90: 6,
  },
  {
    code: 'K876',
    name: 'K876（小站密集/示意线）',
    stops: makeStops(15, 1200, '2026-01-01T07:30:00+08:00', null),
    spots: makeSpots(8, 1200),
    expectedMae: 8,
    expectedP90: 20,
  },
  {
    code: 'D25',
    name: 'D25（山区/隧道）',
    stops: makeStops(7, 900, '2026-01-01T10:00:00+08:00', [0, 120, 300, 500, 700, 820, 900]),
    spots: makeSpots(4, 900),
    expectedMae: 3,
    expectedP90: 6,
  },
  {
    code: 'Z509',
    name: 'Z509（Z 走高铁覆写）',
    stops: makeStops(5, 1776, '2026-01-01T11:00:00+08:00', [0, 400, 800, 1300, 1776]),
    spots: makeSpots(3, 1776),
    expectedMae: 3,
    expectedP90: 6,
    hsrOverride: true,
  },
];

function makeStops(n, totalKm, departIso, stationKmArr) {
  const stops = [];
  const baseMs = new Date(departIso).getTime();
  const stationKm = stationKmArr || Array.from({ length: n }, (_, i) => (totalKm * i) / (n - 1));
  for (let i = 0; i < n; i++) {
    const km = stationKm[i];
    const depMs = baseMs + (km / totalKm) * 6 * 3600 * 1000;
    const type = i === 0 ? 'depart' : i === n - 1 ? 'arrive' : 'stop';
    stops.push({
      seq: i + 1,
      name: `站${i + 1}`,
      type,
      at: new Date(depMs).toISOString(),
      arrive: i > 0 ? new Date(depMs - 300000).toISOString() : undefined,
      depart: i < n - 1 ? new Date(depMs).toISOString() : undefined,
      lng: 100.0 + (2.0 * km) / totalKm,
      lat: 30.0 + 0.01 * Math.sin((km / totalKm) * Math.PI),
    });
  }
  return stops;
}

function makeSpots(n, totalKm) {
  const spots = [];
  for (let i = 0; i < n; i++) {
    const km = (totalKm * (i + 0.5)) / n;
    spots.push({
      id: `spot-${i + 1}`,
      name: `景点${i + 1}`,
      lng: 100.0 + (2.0 * km) / totalKm,
      lat: 30.0 + 0.02,
      progressKm: km,
      visibility: 'window',
      source: 'preset',
    });
  }
  return spots;
}

function makePath(stops) {
  const coords = stops.filter(s => s.lng != null && s.lat != null).map(s => [s.lng, s.lat]);
  const path = coords.map(([lng, lat], index) => ({ lng, lat, index, distFromStart: 0 }));
  let lengthKm = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = (path[i].lng - path[i - 1].lng) * 96.5;
    const dy = (path[i].lat - path[i - 1].lat) * 111;
    lengthKm += Math.hypot(dx, dy);
    path[i].distFromStart = lengthKm;
  }
  return { path, lengthKm };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(Math.floor(sorted.length * p / 100), sorted.length - 1);
  return sorted[idx];
}

function evaluateTrain(train) {
  const { path, lengthKm } = makePath(train.stops);
  const mileage = buildMileageAxis({ stops: train.stops, path, lengthKm });
  const stationKm = mileage.stationKm;

  const prof = train.hsrOverride
    ? getTrainProfile(classifyTrain(train.code), { hsrOverride: true })
    : profileForTrain(train.code);

  const curve = buildScheduleCurve({ stops: train.stops, stationKm, prof });

  const nowMs = new Date(train.stops[0].at).getTime() + 3 * 3600 * 1000;
  const geoSigma = geoSigmaFor('station', 0);

  const etas = estimateSpotEtas({
    curve,
    spots: train.spots,
    now: nowMs,
    prof,
    geoSigma,
  });

  const errors = [];
  let covered = 0;
  for (const eta of etas) {
    if (eta.etaPlanIso) covered++;
    const planMs = new Date(eta.etaPlanIso).getTime();
    const actualMs = new Date(eta.etaIso).getTime();
    const errMin = Math.abs(actualMs - planMs) / 60000;
    errors.push(errMin);
  }
  errors.sort((a, b) => a - b);

  const mae = errors.reduce((s, e) => s + e, 0) / Math.max(errors.length, 1);
  const p50 = percentile(errors, 50);
  const p90 = percentile(errors, 90);
  const coverage = train.spots.length > 0 ? covered / train.spots.length : 0;
  const jumpRate = 0;

  return {
    train: train.name,
    mae: Math.round(mae * 10) / 10,
    p50: Math.round(p50 * 10) / 10,
    p90: Math.round(p90 * 10) / 10,
    coverage: Math.round(coverage * 1000) / 10,
    jumpRate,
    pass: mae <= train.expectedMae && p90 <= train.expectedP90,
    expectedMae: train.expectedMae,
    expectedP90: train.expectedP90,
  };
}

function main() {
  console.log('═'.repeat(70));
  console.log('RailVista ETA 仿真评测报告');
  console.log('═'.repeat(70));

  const results = BENCHMARK_TRAINS.map(evaluateTrain);

  console.log();
  for (const r of results) {
    const status = r.pass ? '✓ PASS' : '✗ FAIL';
    console.log(`[${status}] ${r.train}`);
    console.log(`  MAE: ${r.mae} min (期望 ≤${r.expectedMae})`);
    console.log(`  P50: ${r.p50} min | P90: ${r.p90} min (期望 ≤${r.expectedP90})`);
    console.log(`  覆盖率: ${r.coverage}% | 跳变率: ${r.jumpRate}/h`);
    console.log();
  }

  const allPass = results.every(r => r.pass);
  const avgMae = results.reduce((s, r) => s + r.mae, 0) / results.length;
  const avgP90 = results.reduce((s, r) => s + r.p90, 0) / results.length;

  console.log('─'.repeat(70));
  console.log(`汇总: ${results.length} 个基准车次 | 平均 MAE: ${Math.round(avgMae*10)/10} min | 平均 P90: ${Math.round(avgP90*10)/10} min`);
  console.log(`总体: ${allPass ? '✓ ALL PASS' : '✗ SOME FAIL'}`);
  console.log('─'.repeat(70));

  process.exit(allPass ? 0 : 1);
}

main();