import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRailGeometryJob, getRailGeometryJob } from './railGeometryJob.js';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('railGeometryJob soft-fail', () => {
  it('segmentsOk===0 finishes as partial (not failed) when Overpass off', async () => {
    const prev = process.env.RAIL_OVERPASS;
    process.env.RAIL_OVERPASS = '0';
    try {
      // 偏远假坐标，本地图/走廊均不应命中
      const snap = createRailGeometryJob({
        clientKey: `test-soft-${Date.now()}`,
        trainCode: 'K9999',
        stops: [
          { name: '虚构甲', lng: 10.1, lat: 10.1 },
          { name: '虚构乙', lng: 10.2, lat: 10.2 },
        ],
      });
      let job = snap;
      for (let i = 0; i < 40; i++) {
        await sleep(50);
        const cur = getRailGeometryJob(job.jobId);
        if (!cur) break;
        job = cur;
        if (job.status !== 'queued' && job.status !== 'running') break;
      }
      assert.notEqual(job.status, 'failed');
      assert.equal(job.status, 'partial');
      assert.equal(job.segmentsOk, 0);
      assert.equal(job.qualityTier, 'station');
      assert.match(job.message, /示意|重试/);
    } finally {
      if (prev == null) delete process.env.RAIL_OVERPASS;
      else process.env.RAIL_OVERPASS = prev;
    }
  });

  it('finishes within deadline instead of hanging forever', async () => {
    const prevOp = process.env.RAIL_OVERPASS;
    const prevMax = process.env.RAIL_JOB_MAX_MS;
    process.env.RAIL_OVERPASS = '0';
    process.env.RAIL_JOB_MAX_MS = '800';
    try {
      // 需重新读模块常量：JOB_MAX_MS 在 import 时已固定，改用假坐标快速路径即可
      const snap = createRailGeometryJob({
        clientKey: `test-deadline-${Date.now()}`,
        trainCode: 'G1554',
        stops: [
          { name: '广州南', lng: 113.269, lat: 22.989 },
          { name: '长沙南', lng: 113.066, lat: 28.151 },
          { name: '武汉', lng: 114.317, lat: 30.607 },
          { name: '南京南', lng: 118.799, lat: 31.969 },
        ],
      });
      let job = snap;
      const t0 = Date.now();
      for (let i = 0; i < 80; i++) {
        await sleep(100);
        const cur = getRailGeometryJob(job.jobId);
        if (!cur) break;
        job = cur;
        if (job.status !== 'queued' && job.status !== 'running') break;
      }
      const elapsed = Date.now() - t0;
      assert.ok(
        job.status === 'done' || job.status === 'partial',
        `expected terminal status, got ${job.status}`,
      );
      // Overpass 关闭时本地/走廊应较快结束；若仍 running 则超时逻辑有问题
      assert.ok(elapsed < 15_000, `job took too long: ${elapsed}ms`);
      assert.notEqual(job.status, 'running');
    } finally {
      if (prevOp == null) delete process.env.RAIL_OVERPASS;
      else process.env.RAIL_OVERPASS = prevOp;
      if (prevMax == null) delete process.env.RAIL_JOB_MAX_MS;
      else process.env.RAIL_JOB_MAX_MS = prevMax;
    }
  });
});

describe('railGeometryJob OD supersede', () => {
  it('different OD does not reuse in-flight job for same client', () => {
    const prev = process.env.RAIL_OVERPASS;
    process.env.RAIL_OVERPASS = '0';
    const clientKey = `test-od-race-${Date.now()}`;
    try {
      const first = createRailGeometryJob({
        clientKey,
        trainCode: 'G1001',
        stops: [
          { name: '广州南', lng: 10.1, lat: 10.1 },
          { name: '南京南', lng: 10.9, lat: 10.9 },
        ],
      });

      const second = createRailGeometryJob({
        clientKey,
        trainCode: 'G2002',
        stops: [
          { name: '重庆西', lng: 20.1, lat: 20.1 },
          { name: '贵阳北', lng: 20.9, lat: 20.9 },
        ],
      });

      assert.notEqual(second.jobId, first.jobId);
      assert.equal(second.trainCode, 'G2002');
      assert.equal(second.stops?.[0]?.name, '重庆西');
      assert.equal(second.stops?.[second.stops.length - 1]?.name, '贵阳北');

      const abandoned = getRailGeometryJob(first.jobId);
      assert.ok(abandoned);
      assert.equal(abandoned!.status, 'failed');
      assert.match(abandoned!.message, /取消|切换/);

      // 若第二趟仍在跑，同 OD 应幂等复用
      const same = createRailGeometryJob({
        clientKey,
        trainCode: 'G2002',
        stops: [
          { name: '重庆西', lng: 20.1, lat: 20.1 },
          { name: '贵阳北', lng: 20.9, lat: 20.9 },
        ],
      });
      const live = getRailGeometryJob(second.jobId);
      if (live && (live.status === 'queued' || live.status === 'running')) {
        assert.equal(same.jobId, second.jobId);
      } else {
        assert.equal(same.stops?.[0]?.name, '重庆西');
        assert.notEqual(same.jobId, first.jobId);
      }
    } finally {
      if (prev == null) delete process.env.RAIL_OVERPASS;
      else process.env.RAIL_OVERPASS = prev;
    }
  });

  it('different clientKeys do not cancel each other under shared NAT', () => {
    const prev = process.env.RAIL_OVERPASS;
    process.env.RAIL_OVERPASS = '0';
    const t = Date.now();
    try {
      const a = createRailGeometryJob({
        clientKey: `cid:user-a-${t}`,
        trainCode: 'G1001',
        stops: [
          { name: '广州南', lng: 10.1, lat: 10.1 },
          { name: '南京南', lng: 10.9, lat: 10.9 },
        ],
      });
      const b = createRailGeometryJob({
        clientKey: `cid:user-b-${t}`,
        trainCode: 'G2002',
        stops: [
          { name: '重庆西', lng: 20.1, lat: 20.1 },
          { name: '贵阳北', lng: 20.9, lat: 20.9 },
        ],
      });
      assert.notEqual(a.jobId, b.jobId);
      const stillA = getRailGeometryJob(a.jobId);
      assert.ok(stillA);
      assert.notEqual(stillA!.status, 'failed');
      assert.equal(/取消|切换/.test(stillA!.message || ''), false);
    } finally {
      if (prev == null) delete process.env.RAIL_OVERPASS;
      else process.env.RAIL_OVERPASS = prev;
    }
  });
});
