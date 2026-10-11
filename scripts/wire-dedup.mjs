#!/usr/bin/env node
// 一次性接线：两构建器在 simplify 前应用 dedupBacktrack
import fs from 'node:fs';

const targets = ['scripts/build-national-through.mjs', 'scripts/build-expressway-through.mjs'];
const oldLine = '  const simplified = comps.map((c) => simplifyDP(c, DP_TOL));';
const newLine = '  const simplified = comps.map((c) => simplifyDP(dedupBacktrack(c, Number(process.env.LOOP_TRIM_KM || 15)), DP_TOL));';
const impOld = "import { haversineM, simplifyDP, polylineM } from './lib/road-assemble.mjs';";
const impNew = impOld + "\nimport { dedupBacktrack } from './lib/road-build.mjs';";

for (const p of targets) {
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('dedupBacktrack')) { console.log(p, '已接线，跳过'); continue; }
  if (!s.includes(oldLine)) { console.log(p, 'simplify 锚点未命中'); process.exit(1); }
  s = s.replace(oldLine, newLine);
  if (!s.includes(impOld)) { console.log(p, 'import 锚点未命中'); process.exit(1); }
  s = s.replace(impOld, impNew);
  fs.writeFileSync(p, s);
  console.log(p, '接线完成');
}
