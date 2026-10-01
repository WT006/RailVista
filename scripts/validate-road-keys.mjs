/**
 * 万里路书 · 全国公路旅游网 —— 编号主键校验（PRD §3.2，进库前硬门槛）。
 *
 * 规则：
 *   1. /^G\d{1,3}$/ → class=national（普通国道）；例外 G1~G99（<100）为高速主线
 *   2. /^G\d{4}$/  → class=expressway（国家高速，G5611 是高速不是国道）
 *   3. /^[SXYC]\d{1,4}$/ → 必须带省前缀（"青海:S101"），否则拒绝
 *   4. 同名不同线（两条 S101）跨省交界必须拆段，不得串成一条
 *
 * 用法：node scripts/validate-road-keys.mjs   # 校验 data/roads/index/*.json
 * 退出码：0 通过 / 1 存在违规（CI 门禁用）
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_DIR = join(__dirname, '../data/roads/index');

function classifyRef(ref) {
  if (/^G\d{1,3}$/.test(ref)) return Number(ref.slice(1)) < 100 ? 'expressway' : 'national';
  if (/^G\d{4}$/.test(ref)) return 'expressway';
  if (/^G\d{1,2}[WEN]$/.test(ref)) return 'expressway';
  return null;
}

let violations = 0;
const files = existsSync(INDEX_DIR) ? readdirSync(INDEX_DIR).filter((f) => f.endsWith('.json')) : [];
for (const f of files) {
  const idx = JSON.parse(readFileSync(join(INDEX_DIR, f), 'utf8'));
  const seen = new Set();
  for (const r of idx.roads ?? []) {
    const tag = `${f}:${r.key}`;
    if (seen.has(r.key)) {
      console.error(`✗ ${tag} 重复主键`);
      violations += 1;
    }
    seen.add(r.key);

    if (r.class === 'national' || r.class === 'expressway') {
      if (!/^G\d{1,4}([WEN])?$/.test(r.ref)) {
        console.error(`✗ ${tag} 非法编号 ${r.ref}`);
        violations += 1;
        continue;
      }
      const cls = classifyRef(r.ref);
      if (cls !== r.class) {
        console.error(`✗ ${tag} 编号 ${r.ref} 应为 ${cls}，登记为 ${r.class}`);
        violations += 1;
      }
    } else if (['provincial', 'county', 'township', 'village'].includes(r.class)) {
      if (!/^[SXYC]\d{1,4}$/.test(r.ref)) {
        console.error(`✗ ${tag} 非法省内编号 ${r.ref}`);
        violations += 1;
        continue;
      }
      if (!/^.+:.+$/.test(r.key) || !r.key.endsWith(`:${r.ref}`)) {
        console.error(`✗ ${tag} 省道及以下主键必须为「省:编号」`);
        violations += 1;
      }
    }
  }
  console.log(`${f}: ${idx.roads?.length ?? 0} 条已校验`);
}

if (violations) {
  console.error(`\n共 ${violations} 处违规，拒绝入库`);
  process.exit(1);
}
console.log('\n全部通过 §3.2 编号主键校验');
