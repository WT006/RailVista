/**
 * 本地 HSR/普速 graph → OD 走廊折线（供 CLI / via-legs 复用，避免重复加载 graph）。
 */
export function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function dist(a, b) {
  return Math.hypot(a.lng - b.lng, a.lat - b.lat);
}

function wayLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += haversine(points[i - 1], points[i]);
  return sum;
}

function simplify(points, minKm = 0.45) {
  if (!points.length) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (haversine(out.at(-1), points[i]) >= minKm) out.push(points[i]);
  }
  const last = points.at(-1);
  if (dist(out.at(-1), last) > 0.0001) out.push(last);
  return out;
}

function chordDistKm(p, a, b) {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy || 1e-12;
  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return haversine(p, { lng: a.lng + dx * t, lat: a.lat + dy * t });
}

/**
 * @param {object} g - parsed china-hsr.graph / china-rail.graph
 * @param {{ from:{lng,lat}, to:{lng,lat}, connectTol?:number, bridgeMax?:number, log?:(...args)=>void }} opts
 * @returns {{ coords:[number,number][], km:number, method:string, preferred:string|null, dijkstraKm:number }}
 */
export function buildCorridorFromGraph(g, opts) {
  const from = opts.from;
  const to = opts.to;
  const CONNECT_TOL = opts.connectTol ?? 0.05;
  const log = opts.log || (() => {});

  const odKm = haversine(from, to) || 1;
  const maxLat = Math.min(220, Math.max(30, odKm * 0.22));
  const pad = Math.max(0.2, Math.min(1.2, odKm / 350));
  const minLng = Math.min(from.lng, to.lng) - pad;
  const maxLng = Math.max(from.lng, to.lng) + pad;
  const minLat = Math.min(from.lat, to.lat) - pad;
  const maxLatB = Math.max(from.lat, to.lat) + pad;

  const wayList = [];
  for (const w of g.ways || []) {
    const points = (w.points || [])
      .map((p) => (Array.isArray(p) ? { lng: p[0], lat: p[1] } : { lng: p.lng, lat: p.lat }))
      .filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat));
    if (points.length < 2) continue;
    let bbMinLng = Infinity,
      bbMinLat = Infinity,
      bbMaxLng = -Infinity,
      bbMaxLat = -Infinity;
    for (const p of points) {
      bbMinLng = Math.min(bbMinLng, p.lng);
      bbMinLat = Math.min(bbMinLat, p.lat);
      bbMaxLng = Math.max(bbMaxLng, p.lng);
      bbMaxLat = Math.max(bbMaxLat, p.lat);
    }
    if (bbMaxLng < minLng || bbMinLng > maxLng || bbMaxLat < minLat || bbMinLat > maxLatB) continue;
    const mid = points[Math.floor(points.length / 2)];
    if (chordDistKm(mid, from, to) > maxLat) continue;
    wayList.push({ id: w.id, name: w.name, points });
  }
  log('candidate ways', wayList.length, 'odKm', odKm.toFixed(1));

  const nameCount = new Map();
  for (const w of wayList) {
    if (!w.name) continue;
    const nearFrom = w.points.some((p) => dist(p, from) < 0.35);
    const nearTo = w.points.some((p) => dist(p, to) < 0.35);
    if (nearFrom || nearTo) {
      const cur = nameCount.get(w.name) || { a: 0, b: 0 };
      if (nearFrom) cur.a += 1;
      if (nearTo) cur.b += 1;
      nameCount.set(w.name, cur);
    }
  }
  let preferred = null;
  let bestScore = 0;
  if (opts.preferName) {
    preferred = opts.preferName;
    bestScore = 99;
  } else if (!opts.noPrefer) {
    for (const [name, c] of nameCount) {
      if (c.a > 0 && c.b > 0) {
        const s = c.a + c.b;
        if (s > bestScore) {
          bestScore = s;
          preferred = name;
        }
      }
    }
  }
  let pool = wayList;
  if (preferred && bestScore >= 4) {
    const named = wayList.filter((w) => w.name === preferred);
    if (named.length >= 8) {
      log('prefer', preferred, named.length);
      pool = named;
    } else if (opts.preferName) {
      log('prefer forced but thin', preferred, named.length);
      pool = named.length ? named : wayList;
    }
  }

  function nearestWay(target, activePool = pool) {
    let best = null;
    activePool.forEach((w, idx) => {
      w.points.forEach((p, pi) => {
        const d = dist(p, target);
        if (!best || d < best.d)
          best = { way: idx, d, atHead: pi === 0, atTail: pi === w.points.length - 1 };
      });
    });
    return best;
  }

  const start = nearestWay(from);
  const end = nearestWay(to);
  if (!start || !end) {
    throw new Error(`cannot locate OD on ways snapF=${start?.d} snapT=${end?.d}`);
  }
  log('snap from', start.d.toFixed(4), 'to', end.d.toFixed(4));

  function runDijkstra(activePool, startInfo, endInfo, connectTol) {
    const adj = activePool.map(() => ({ head: [], tail: [] }));
    for (let i = 0; i < activePool.length; i++) {
      for (let j = 0; j < activePool.length; j++) {
        if (i === j) continue;
        const a = activePool[i];
        const b = activePool[j];
        const aH = a.points[0],
          aT = a.points.at(-1);
        const bH = b.points[0],
          bT = b.points.at(-1);
        if (dist(aT, bH) < connectTol) adj[i].tail.push({ j, enter: 'head', reverse: false });
        if (dist(aT, bT) < connectTol) adj[i].tail.push({ j, enter: 'tail', reverse: true });
        if (dist(aH, bT) < connectTol) adj[i].head.push({ j, enter: 'tail', reverse: true });
        if (dist(aH, bH) < connectTol) adj[i].head.push({ j, enter: 'head', reverse: false });
      }
    }
    const key = (wayIdx, exitEnd) => `${wayIdx}:${exitEnd}`;
    const distMap = new Map();
    const prevMap = new Map();
    const queue = [
      { wayIdx: startInfo.way, exitEnd: 'tail', cost: 0, reversed: false },
      { wayIdx: startInfo.way, exitEnd: 'head', cost: 0, reversed: true },
    ];
    for (const s of queue) {
      distMap.set(key(s.wayIdx, s.exitEnd), 0);
      prevMap.set(key(s.wayIdx, s.exitEnd), { ...s, prev: null });
    }
    while (queue.length) {
      queue.sort((a, b) => a.cost - b.cost);
      const cur = queue.shift();
      const ck = key(cur.wayIdx, cur.exitEnd);
      if (cur.cost > (distMap.get(ck) ?? Infinity)) continue;
      const exitNode = cur.exitEnd === 'tail' ? 'tail' : 'head';
      for (const edge of adj[cur.wayIdx][exitNode]) {
        const w = activePool[edge.j];
        const addCost = wayLength(w.points);
        const nextExit = edge.enter === 'head' ? 'tail' : 'head';
        const nk = key(edge.j, nextExit);
        const nc = cur.cost + addCost;
        if (nc < (distMap.get(nk) ?? Infinity)) {
          distMap.set(nk, nc);
          const state = {
            wayIdx: edge.j,
            exitEnd: nextExit,
            cost: nc,
            reversed: edge.reverse,
            prev: prevMap.get(ck),
          };
          prevMap.set(nk, state);
          queue.push(state);
        }
      }
    }
    let best = null;
    for (const exitEnd of ['head', 'tail']) {
      const c = distMap.get(key(endInfo.way, exitEnd));
      if (c !== undefined && (!best || c < best.cost)) {
        best = { cost: c, state: prevMap.get(key(endInfo.way, exitEnd)) };
      }
    }
    if (!best) return null;
    const pathWays = [];
    let st = best.state;
    while (st && st.prev !== undefined) {
      pathWays.unshift({ wayIdx: st.wayIdx, reversed: st.reversed });
      st = st.prev;
    }
    pathWays.unshift({ wayIdx: startInfo.way, reversed: st?.reversed ?? false });
    let out = [];
    pathWays.forEach(({ wayIdx, reversed }, i) => {
      let pts = reversed ? [...activePool[wayIdx].points].reverse() : activePool[wayIdx].points;
      if (i > 0) pts = pts.slice(1);
      out = out.concat(pts);
    });
    return { line: out, cost: best.cost };
  }

  let line = [];
  let method = 'dijkstra';
  let dijkstraKm = 0;
  let routed = runDijkstra(pool, start, end, CONNECT_TOL);
  if (!routed && pool !== wayList) {
    log('prefer dijkstra miss → retry prefer with raised tol');
    routed = runDijkstra(pool, start, end, Math.max(CONNECT_TOL, 0.15));
  }
  // Prefer can "succeed" while end snap is far from OD (cross-line legs). Treat as miss.
  const preferEndWeak =
    pool !== wayList && end.d > Math.max(CONNECT_TOL, 0.08);
  if ((preferEndWeak || !routed) && pool !== wayList && wayList.length <= 12000) {
    log(
      preferEndWeak
        ? `prefer end snap weak ${end.d.toFixed(3)} → full pool`
        : 'prefer still miss → retry full pool',
    );
    preferred = preferEndWeak ? null : preferred;
    const start2 = nearestWay(from, wayList);
    const end2 = nearestWay(to, wayList);
    routed = runDijkstra(wayList, start2, end2, Math.max(CONNECT_TOL, 0.08));
    if (routed) method = 'dijkstra-full';
  } else if (!routed && pool !== wayList) {
    log(`skip full-pool retry (candidates=${wayList.length})`);
  }

  if (routed) {
    line = routed.line;
    dijkstraKm = routed.cost;
  } else {
    log('dijkstra miss → greedy stitch');
    method = 'greedy';
    const segs = wayList.map((w) => ({ pts: w.points, used: false }));
    let startIdx = -1,
      startRev = false,
      bestD = Infinity;
    for (let i = 0; i < segs.length; i++) {
      const d0 = dist(from, segs[i].pts[0]);
      const d1 = dist(from, segs[i].pts.at(-1));
      if (d0 < bestD) {
        bestD = d0;
        startIdx = i;
        startRev = false;
      }
      if (d1 < bestD) {
        bestD = d1;
        startIdx = i;
        startRev = true;
      }
    }
    if (startIdx < 0) throw new Error('greedy: no start');
    line = startRev ? [...segs[startIdx].pts].reverse() : [...segs[startIdx].pts];
    segs[startIdx].used = true;
    const bridgeMax =
      opts.bridgeMax ?? (odKm > 300 ? 0.06 : odKm > 120 ? 0.05 : 0.04);
    for (let guard = 0; guard < 8000; guard++) {
      const tail = line.at(-1);
      if (haversine(tail, to) < 2) break;
      let best = null;
      for (let i = 0; i < segs.length; i++) {
        if (segs[i].used) continue;
        for (const rev of [false, true]) {
          const pts = rev ? [...segs[i].pts].reverse() : segs[i].pts;
          const dJoin = dist(tail, pts[0]);
          if (dJoin > bridgeMax) continue;
          const tip = pts.at(-1);
          const gain = haversine(tail, to) - haversine(tip, to);
          if (gain < -3) continue;
          const lateral = chordDistKm(tip, from, to);
          const score = dJoin * 80 - gain * 12 + lateral * 2;
          if (!best || score < best.score) best = { i, pts, score };
        }
      }
      if (!best) break;
      segs[best.i].used = true;
      line = line.concat(best.pts.slice(1));
    }
    if (haversine(line.at(-1), to) > 25) {
      throw new Error(`greedy incomplete remain ${haversine(line.at(-1), to).toFixed(1)}`);
    }
  }

  const simplified = simplify(line, 0.45);
  let km = 0;
  for (let i = 1; i < simplified.length; i++) km += haversine(simplified[i - 1], simplified[i]);
  const coords = simplified.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
  return { coords, km, method, preferred, dijkstraKm };
}
