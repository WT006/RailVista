import { buildLocalSegment } from '../src/services/localRails.ts';
import { createRailGeometryJob, getRailGeometryJob } from '../src/services/railGeometryJob.ts';

const long = buildLocalSegment(
  { lng: 116.3789, lat: 39.8651 },
  { lng: 121.316, lat: 31.194 },
);
console.log('京沪', long ? { pts: long.length, ok: true } : { ok: false });

const job = createRailGeometryJob({
  stops: [
    { lng: 116.2953417, lat: 39.8499954 },
    { lng: 117.2105, lat: 39.1356 },
  ],
  trainCode: 'G123',
  clientKey: 'qa',
});
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 100));
  const s = getRailGeometryJob(job.jobId)!;
  if (s.status === 'done' || s.status === 'failed' || s.status === 'partial') {
    console.log('job', s.status, 'ok', s.segmentsOk, 'pts', s.coords.length, s.message);
    if (s.status === 'failed') process.exitCode = 1;
    break;
  }
}
