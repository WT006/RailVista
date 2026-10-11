#!/usr/bin/env node
// 探针：查指定省 rvwn 中 ref 匹配的 way 数量与名称样本
// node scripts/probe-ref.mjs heilongjiang 2504 绕城
import { openRvwn } from '../scripts/lib/rvwn.mjs';
import { join } from 'node:path';

const slug = process.argv[2];
const patterns = process.argv.slice(3);
const rv = openRvwn(join('data', 'roads', 'net', slug + '.rvwn'));
let total = 0;
const hits = [];
for (const w of rv.iterateWays()) {
  total += 1;
  const refs = (w.ref || '').toString();
  const name = (w.name || '').toString();
  for (const pat of patterns) {
    const re = new RegExp(pat, 'i');
    if (re.test(refs) || re.test(name)) {
      hits.push({ id: w.id, ref: refs, name: name, hw: w.highway });
      break;
    }
  }
}
console.log(`${slug}: 总way ${total} · 命中 ${hits.length}`);
hits.slice(0, 15).forEach((h) => console.log(`  #${h.id} ref="${h.ref}" name="${h.name}" hw=${h.hw}`));
