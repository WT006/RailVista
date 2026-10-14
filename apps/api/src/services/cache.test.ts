import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from './cache.js';

describe('TtlCache', () => {
  it('evicts oldest when over max', () => {
    const c = new TtlCache(10, 60_000);
    for (let i = 0; i < 12; i += 1) c.set(`k${i}`, i, 3600);
    assert.ok(c.size <= 10);
    assert.equal(c.get('k0'), undefined);
    assert.equal(c.get('k11'), 11);
  });

  it('expires on get and on sweep', async () => {
    const c = new TtlCache(100, 1);
    c.set('a', 1, 1);
    assert.equal(c.get('a'), 1);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(c.get('a'), undefined);
  });

  it('get refreshes LRU so hot keys survive prune', () => {
    const c = new TtlCache(5, 60_000);
    for (let i = 0; i < 5; i += 1) c.set(`k${i}`, i, 3600);
    assert.equal(c.get('k0'), 0);
    c.set('k5', 5, 3600);
    // prune drops ~10% of max (=1); oldest unused should go first
    assert.equal(c.get('k0'), 0);
  });
});
