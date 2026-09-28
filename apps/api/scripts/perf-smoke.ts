import { loadStationIndex } from '../src/services/stationIndex.js';
import { trainSource } from '../src/services/cr12306.js';

const date = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const v = await fn();
  console.log(`>>> ${label}: ${Date.now() - t}ms`);
  return v;
}

await loadStationIndex();
console.log('--- 车次查询（西宁 → 拉萨）---');
const t1 = await time('第 1 次（冷）', () => trainSource.searchTrains('西宁', '拉萨', date));
await time('第 2 次（缓存命中）', () => trainSource.searchTrains('西宁', '拉萨', date));

console.log('--- 换一个 OD（验证会话复用 / A1）---');
await time('北京南 → 上海虹桥（冷，但会话应复用）', () =>
  trainSource.searchTrains('北京南', '上海虹桥', date),
);

if (t1.length) {
  const t = t1[0]!;
  console.log('--- 经停站（', t.trainCode, '）---');
  const s1 = await time('第 1 次（冷）', () =>
    trainSource.getStops({
      trainNo: t.trainNo,
      trainCode: t.trainCode,
      from: t.from.telecode,
      to: t.to.telecode,
      date: t.date,
    }),
  );
  await time('第 2 次（缓存命中）', () =>
    trainSource.getStops({
      trainNo: t.trainNo,
      trainCode: t.trainCode,
      from: t.from.telecode,
      to: t.to.telecode,
      date: t.date,
    }),
  );
  const missing = s1.filter((s) => s.lng == null || s.lat == null).length;
  console.log(`>>> 站点 ${s1.length} 个，缺坐标 ${missing} 个`);
} else {
  console.log('>>> 未查到车次，跳过经停测试');
}
