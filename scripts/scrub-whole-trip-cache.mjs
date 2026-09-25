/**
 * 清除 1b 伪整趟贪心产生的污染缓存（S1）。
 *
 * 删除判定（满足其一）：
 *   ① message 含「本地图全局寻路」（1b 伪精确标记文案）
 *   ② stopsFp 不以当前 g<GEOM_VERSION> 前缀开头（旧版本条目 / 孤儿文件）
 * pinned 条目仅按 ① 删除（污染不豁免），其余保留。
 *
 * 用法：
 *   node scripts/scrub-whole-trip-cache.mjs --dry-run
 *   node scripts/scrub-whole-trip-cache.mjs            # 实际删除
 *   node scripts/scrub-whole-trip-cache.mjs --dir <path>
 */
import { readdirSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = join(__dirname, '..', 'data/cache/precise');
const GEOM_VERSION = 2;
const POISON_MARK = '本地图全局寻路';

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dirIdx = args.indexOf('--dir');
  const dir = dirIdx >= 0 ? args[dirIdx + 1] : DEFAULT_DIR;
  return { dryRun, dir };
}

const { dryRun, dir } = parseArgs();

if (!existsSync(dir)) {
  console.log(`cache dir not found: ${dir}`);
  console.log('scanned=0 deleted=0 kept=0');
  process.exit(0);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
let deleted = 0;
let kept = 0;
const deletedList = [];

for (const f of files) {
  const path = join(dir, f);
  let entry = null;
  try {
    entry = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // 损坏文件视为孤儿条目，按 ② 处理
  }

  let reason = '';
  if (entry && typeof entry.message === 'string' && entry.message.includes(POISON_MARK)) {
    reason = 'poison:whole-trip';
  } else if (!entry || typeof entry.stopsFp !== 'string' || !entry.stopsFp.startsWith(`g${GEOM_VERSION}|`)) {
    reason = 'stale-version';
  }

  if (reason) {
    deleted += 1;
    deletedList.push(`${f} (${reason})`);
    if (!dryRun) {
      try {
        unlinkSync(path);
      } catch (e) {
        console.warn(`failed to delete ${f}:`, e.message);
      }
    }
  } else {
    kept += 1;
  }
}

console.log(`scanned=${files.length} deleted=${deleted} kept=${kept}${dryRun ? ' (dry-run)' : ''}`);
for (const d of deletedList.slice(0, 50)) {
  console.log(`  del ${d}`);
}
if (deletedList.length > 50) console.log(`  ... +${deletedList.length - 50} more`);
process.exit(0);