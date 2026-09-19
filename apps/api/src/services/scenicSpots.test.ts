/**
 * API：风景点按行程折线匹配
 * pnpm --filter @railvista/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearScenicSpotCache, loadScenicSpots, matchScenicSpotsForRailway } from './scenicSpots.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const presetsDir = join(__dirname, '../../../../data/presets');

describe('scenicSpots', () => {
  it('loads curated library', () => {
    clearScenicSpotCache();
    const spots = loadScenicSpots();
    assert.ok(spots.length >= 100, `expected curated spots, got ${spots.length}`);
  });

  it('matches Z8991 / Qingzang railway', () => {
    clearScenicSpotCache();
    const railway = JSON.parse(
      readFileSync(join(presetsDir, 'z8991-railway.json'), 'utf8'),
    ) as [number, number][];
    const hits = matchScenicSpotsForRailway(railway);
    assert.ok(hits.length >= 15, `qingzang should hit many spots, got ${hits.length}`);
    assert.ok(hits.every((h, i) => i === 0 || (h.progressKm ?? 0) >= (hits[i - 1].progressKm ?? 0)));
    assert.ok(hits.some((h) => h.name.includes('青海湖') || h.id === 'qinghai-lake'));
  });

  it('returns empty for short polyline', () => {
    assert.deepEqual(matchScenicSpotsForRailway([[116, 39]]), []);
    assert.deepEqual(matchScenicSpotsForRailway(null), []);
  });

  it('Jinghu has few/no curated scenic hits', () => {
    const corridor = JSON.parse(
      readFileSync(join(presetsDir, 'corridors/jinghu.json'), 'utf8'),
    ) as { railway: [number, number][] };
    const hits = matchScenicSpotsForRailway(corridor.railway);
    assert.ok(hits.length <= 5, `jinghu should be sparse, got ${hits.length}`);
  });
});
