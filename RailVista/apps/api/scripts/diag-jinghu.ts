import { loadLocalHsrRails, queryLocalWaysAlong, stitchLocalOd } from '../src/services/localRails.ts';

const from = { lng: 116.3789, lat: 39.8651 };
const to = { lng: 121.316, lat: 31.194 };
loadLocalHsrRails();

const samples = [];
const n = 17;
for (let i = 0; i <= n; i++) {
  const t = i / n;
  samples.push({
    lng: from.lng + (to.lng - from.lng) * t,
    lat: from.lat + (to.lat - from.lat) * t,
  });
}
const ways = queryLocalWaysAlong(samples, { padDeg: 0.26 });
console.log('ways', ways.length);
const line = stitchLocalOd(from, to, ways);
console.log('result', line ? line.length : null);

// monkey: call internals by re-reading - instead log via patched copy
// Check start proximity to jinghu
const names = new Map();
for (const w of ways) names.set(w.name || '?', (names.get(w.name || '?') || 0) + 1);
console.log(
  'top names',
  [...names.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12),
);

let nearFrom = 0;
for (const w of ways) {
  const d0 = Math.hypot(w.points[0].lng - from.lng, w.points[0].lat - from.lat);
  const d1 = Math.hypot(w.points[w.points.length - 1].lng - from.lng, w.points[w.points.length - 1].lat - from.lat);
  if (Math.min(d0, d1) < 0.22) nearFrom++;
}
console.log('ways near from', nearFrom);
