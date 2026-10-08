/**
 * 六省景点补全数据级断言（2026-10-05）
 * pnpm --filter @railvista/shared test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../../../data');

const scenic = JSON.parse(readFileSync(join(dataDir, 'presets/scenic-spots.json'), 'utf8')) as {
  spots: Array<{ id: string; name: string; province?: string; lng: number; lat: number; category?: string }>;
};
const road = JSON.parse(readFileSync(join(dataDir, 'roads/roadside-spots.json'), 'utf8')) as {
  spots: Array<{ id: string; name: string; province?: string; lng: number; lat: number; category?: string }>;
};

const SIX = ['安徽', '湖北', '天津', '宁夏', '青海', '贵州'] as const;
const RAIL_T: Record<string, number> = { 安徽: 10, 湖北: 12, 天津: 8, 宁夏: 8, 青海: 15, 贵州: 12 };
const ROAD_T: Record<string, number> = { 安徽: 50, 湖北: 50, 天津: 30, 宁夏: 40, 青海: 40, 贵州: 100 };

describe('sixProvFill 铁路主库', () => {
  it('每条均有 id/name/lng/lat', () => {
    for (const s of scenic.spots) {
      assert.ok(s.id, 'missing id');
      assert.ok(s.name, 'missing name');
      assert.ok(typeof s.lng === 'number', `${s.id}: lng not number`);
      assert.ok(typeof s.lat === 'number', `${s.id}: lat not number`);
    }
  });

  for (const p of SIX) {
    it(`铁路 ${p} ≥ ${RAIL_T[p]}`, () => {
      const n = scenic.spots.filter((s) => s.province === p).length;
      assert.ok(n >= RAIL_T[p], `${p} 仅 ${n} 条，目标 ${RAIL_T[p]}`);
    });
  }
});

describe('sixProvFill 公路主库', () => {
  it('每条均有 id/name/lng/lat', () => {
    for (const s of road.spots) {
      assert.ok(s.id, 'missing id');
      assert.ok(s.name, 'missing name');
      assert.ok(typeof s.lng === 'number', `${s.id}: lng not number`);
      assert.ok(typeof s.lat === 'number', `${s.id}: lat not number`);
    }
  });

  for (const p of SIX) {
    it(`公路 ${p} ≥ ${ROAD_T[p]}`, () => {
      const n = road.spots.filter((s) => s.province === p).length;
      assert.ok(n >= ROAD_T[p], `${p} 仅 ${n} 条，目标 ${ROAD_T[p]}`);
    });
  }
});