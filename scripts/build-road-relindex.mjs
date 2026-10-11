// 构建分省国道关系索引（一次性，本地）
import { buildRelIndex } from './lib/road-local.mjs';
const force = process.argv.includes('--force');
await buildRelIndex({ force });
console.log('→ data/roads/rel-index/');
