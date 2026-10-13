/**
 * 万里路书 · 控制点纠偏（scripts/fix-controls.mjs）
 *
 * 官方控制点由地名地理编码得到，个别地名会把控制点编到错误的省份/境外
 * （G216 红山嘴口岸被编到吐鲁番鄯善县；G357 东山被编到台湾台南东山区；G319 起点高雄在台湾），
 * 直接导致走廊骨架歪斜、几何被拖到海峡对岸或别的省，出现「飞地」组件与乱线。
 * 本脚本按人工核实的坐标就地修正 / 剔除，并落盘 data/roads/reports/controls-fix.json 备查。
 *
 * 用法：node scripts/fix-controls.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CTRL_DIR = join('data', 'cache', 'amap', 'controls');
const FIX_FILE = join('data', 'roads', 'reports', 'controls-fix.json');

/** 人工核实：ref → 修正动作（move=改坐标；drop=该点在境外/台湾且大陆端另有点，剔除） */
const FIXES = [
  {
    ref: 'G216', action: 'move', name: '红山嘴（口岸）', lng: 88.934199, lat: 48.092113,
    district: '福海县', note: '红山嘴口岸位于阿勒泰地区福海县（中蒙边境），原地理编码误落到吐鲁番市鄯善县',
  },
  {
    ref: 'G357', action: 'move', name: '东山', lng: 117.4295, lat: 23.702034,
    district: '东山县', note: '东山为福建漳州市东山县（东山岛），原地理编码误落到台湾台南市东山区',
  },
  {
    ref: 'G319', action: 'drop', name: '高雄',
    note: 'G319 规划起点写「高雄」（台湾），无跨海通道；大陆端起点为厦门（已在控制点链 #1），故剔除该点',
  },
];

let changed = 0;
for (const fx of FIXES) {
  const p = join(CTRL_DIR, fx.ref + '.json');
  if (!existsSync(p)) { console.log('跳过（无控制文件）', fx.ref); continue; }
  const c = JSON.parse(readFileSync(p, 'utf8'));
  const idx = (c.controls ?? []).findIndex((x) => x.name === fx.name);
  if (idx < 0) { console.log('跳过（无该控制点或已处理）', fx.ref, fx.name); continue; }
  if (fx.action === 'drop') {
    const [gone] = c.controls.splice(idx, 1);
    c.droppedControls = [...(c.droppedControls ?? []), { ...gone, droppedAt: new Date().toISOString(), note: fx.note }];
    console.log('✓ 剔除', fx.ref, fx.name, gone.lng, gone.lat, '—', fx.note);
  } else {
    const hit = c.controls[idx];
    const before = { lng: hit.lng, lat: hit.lat, district: hit.district };
    hit.lng = fx.lng; hit.lat = fx.lat;
    if (fx.district) hit.district = fx.district;
    hit.fixedAt = new Date().toISOString();
    hit.fixNote = fx.note;
    console.log('✓', fx.ref, fx.name, JSON.stringify(before), '→', fx.lng, fx.lat, '—', fx.note);
  }
  writeFileSync(p, JSON.stringify(c, null, 1), 'utf8');
  changed += 1;
}
writeFileSync(FIX_FILE, JSON.stringify(FIXES, null, 1), 'utf8');
console.log('处理', changed, '条 →', FIX_FILE);
