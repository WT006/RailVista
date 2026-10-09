// 从 gapFill.prev* 回滚所有国道的补全状态
// 用于切换到新分支后恢复原始 OSM 数据
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'data/roads/geom';
const files = fs.readdirSync(DIR).filter((f) => /^G\d+\.json$/.test(f));

let rolled = 0;
let skipped = 0;
let hasGapFill = 0;
let origThrough = 0;

for (const f of files) {
  const fp = path.join(DIR, f);
  const g = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (g.class !== 'national') {
    skipped++;
    continue;
  }
  if (!g.gapFill) {
    origThrough++;
    continue;
  }
  hasGapFill++;
  // 恢复原始数据
  g.points = g.gapFill.prevPoints;
  g.segments = g.gapFill.prevSegments || [];
  g.gapAnnotations = g.gapFill.prevGapAnnotations || [];
  g.totalKm = g.gapFill.prevTotalKm;
  // 删除 gapFill 元数据（保留 prev 以便再次回滚）
  delete g.gapFill.filledGaps;
  delete g.gapFill.unfilledGaps;
  g.gapFill.rolledBackAt = new Date().toISOString();
  g.gapFill.note = 'rolled back to pre-amap-fill state for re-design';

  fs.writeFileSync(fp, JSON.stringify(g));
  rolled++;
}

console.log('--- 回滚结果 ---');
console.log('national 国道文件:', files.length);
console.log('原本就贯通(无 gapFill):', origThrough);
console.log('有 gapFill 的国道:', hasGapFill);
console.log('成功回滚:', rolled);
console.log('非 national 跳过:', skipped);
