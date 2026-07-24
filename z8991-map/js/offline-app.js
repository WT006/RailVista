(function () {
  const data = window.Z8991_DATA || {};
  const departure = new Date(data.stations[0].at);
  const arrival = new Date(data.stations[data.stations.length - 1].at);

  let railwayPath = [];
  let railwayLength = 0;
  let stationDistances = [];
  let gpsAvailable = false;
  let lastGpsAt = 0;
  let lastGps = null;
  let lastTrainPoint = null;
  let lastMode = '时刻表估算';
  let currentProgress = 0;
  let isCompact = false;

  let svg;
  let viewport;
  let trainEl;
  let gpsEl;
  let mapPopupEl = null;
  let mapPopupAnchor = null;
  let suppressMapClick = false;
  let viewBox = { x: 0, y: 0, w: 1000, h: 700 };
  let baseViewBox = null;
  let projectFn = null;

  const els = {
    mode: document.getElementById('mode-chip'),
    clock: document.getElementById('clock-chip'),
    progressChip: document.getElementById('progress-chip'),
    bottomProgress: document.getElementById('bottom-progress-text'),
    nextTitle: document.getElementById('next-title'),
    nextName: document.getElementById('next-name'),
    nextMeta: document.getElementById('next-meta'),
    progressBar: document.getElementById('progress-bar'),
    legend: document.getElementById('legend'),
    legendToggle: document.getElementById('legend-toggle'),
    locateBtn: document.getElementById('locate-btn'),
    locationSegment: document.getElementById('location-segment'),
    locationMeta: document.getElementById('location-meta'),
    locationMode: document.getElementById('location-mode'),
  };

  function isMobileLayout() {
    return window.matchMedia('(max-width: 640px)').matches;
  }

  function shortModeLabel(mode) {
    if (!isCompact) return mode;
    return mode
      .replace('时刻表估算（GPS 信号弱）', '时刻表（GPS弱）')
      .replace('时刻表估算（偏离铁路较远）', '时刻表（偏离）')
      .replace('时刻表估算', '时刻表')
      .replace('GPS + 时刻表', 'GPS');
  }

  function getRailwayCoords() {
    const precise = window.Z8991_RAILWAY;
    if (precise && precise.length > 2) return precise;
    return data.railway || [];
  }

  function haversineKm(a, b) {
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

  function buildRailwayMetrics() {
    railwayPath = getRailwayCoords().map(([lng, lat], index) => ({
      lng, lat, index, distFromStart: 0,
    }));
    railwayLength = 0;
    for (let i = 1; i < railwayPath.length; i += 1) {
      railwayLength += haversineKm(railwayPath[i - 1], railwayPath[i]);
      railwayPath[i].distFromStart = railwayLength;
    }
  }

  function buildStationDistances() {
    stationDistances = data.stations.map((station) => {
      const projected = projectToRailway(station.lng, station.lat);
      return {
        ...station,
        progress: projected.progress,
        distKm: projected.progress * railwayLength,
      };
    });
  }

  function interpolatePoint(a, b, t) {
    return {
      lng: a.lng + (b.lng - a.lng) * t,
      lat: a.lat + (b.lat - a.lat) * t,
    };
  }

  function pointAtProgress(progress) {
    const clamped = Math.max(0, Math.min(1, progress));
    const target = clamped * railwayLength;
    for (let i = 1; i < railwayPath.length; i += 1) {
      if (railwayPath[i].distFromStart >= target) {
        const prev = railwayPath[i - 1];
        const curr = railwayPath[i];
        const segLen = curr.distFromStart - prev.distFromStart || 1;
        const t = (target - prev.distFromStart) / segLen;
        return interpolatePoint(prev, curr, t);
      }
    }
    const last = railwayPath[railwayPath.length - 1];
    return { lng: last.lng, lat: last.lat };
  }

  function projectToRailway(lng, lat) {
    let best = { distKm: Infinity, progress: 0, point: railwayPath[0] };
    for (let i = 1; i < railwayPath.length; i += 1) {
      const a = railwayPath[i - 1];
      const b = railwayPath[i];
      const segLen = b.distFromStart - a.distFromStart || 1;
      const dx = b.lng - a.lng;
      const dy = b.lat - a.lat;
      const t = Math.max(
        0,
        Math.min(1, ((lng - a.lng) * dx + (lat - a.lat) * dy) / (dx * dx + dy * dy || 1))
      );
      const point = interpolatePoint(a, b, t);
      const distKm = haversineKm({ lng, lat }, point);
      const progress = (a.distFromStart + segLen * t) / railwayLength;
      if (distKm < best.distKm) best = { distKm, progress, point };
    }
    return best;
  }

  function scheduleProgress(now) {
    const timeline = [];
    data.stations.forEach((s) => {
      if (s.at) timeline.push({ at: new Date(s.at), name: s.name });
      if (s.arrive) timeline.push({ at: new Date(s.arrive), name: `${s.name}（到）` });
      if (s.depart) timeline.push({ at: new Date(s.depart), name: `${s.name}（开）` });
    });
    timeline.sort((a, b) => a.at - b.at);
    if (now <= departure) return 0;
    if (now >= arrival) return 1;

    for (let i = 0; i < timeline.length - 1; i += 1) {
      const cur = timeline[i];
      const next = timeline[i + 1];
      if (now >= cur.at && now <= next.at) {
        const span = next.at - cur.at || 1;
        const localT = (now - cur.at) / span;
        const idxA = data.stations.findIndex((s) => cur.name.startsWith(s.name));
        const idxB = data.stations.findIndex((s) => next.name.startsWith(s.name));
        const a = idxA >= 0 ? idxA / (data.stations.length - 1) : i / (timeline.length - 1);
        const b = idxB >= 0 ? idxB / (data.stations.length - 1) : (i + 1) / (timeline.length - 1);
        return a + (b - a) * localT;
      }
    }
    return (now - departure) / (arrival - departure);
  }

  function getSimulatedProgress() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('progress') ?? params.get('simulate');
    if (raw == null) return null;
    const value = Number(raw);
    if (Number.isNaN(value)) return null;
    return value > 1 ? value / 100 : value;
  }

  function resolveProgress(now, gps) {
    const simulated = getSimulatedProgress();
    if (simulated != null) {
      return { progress: Math.max(0, Math.min(1, simulated)), mode: '模拟进度' };
    }

    const scheduleP = scheduleProgress(now);
    if (!gps) return { progress: scheduleP, mode: '时刻表估算' };

    const ageMs = now.getTime() - gps.timestamp;
    if (ageMs > 120000 || gps.accuracy > 800) {
      return { progress: scheduleP, mode: '时刻表估算（GPS 信号弱）' };
    }

    const projected = projectToRailway(gps.lng, gps.lat);
    if (projected.distKm > 8) {
      return { progress: scheduleP, mode: '时刻表估算（偏离铁路较远）' };
    }

    return { progress: projected.progress * 0.65 + scheduleP * 0.35, mode: 'GPS + 时刻表' };
  }

  function formatClock(now) {
    const opts = {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    };
    if (isCompact) return now.toLocaleTimeString('zh-CN', opts);
    return now.toLocaleString('zh-CN', {
      ...opts,
      month: 'numeric',
      day: 'numeric',
    });
  }

  function formatEta(targetDate) {
    const diffMin = Math.round((targetDate - new Date()) / 60000);
    if (diffMin <= 0) return '即将经过或已通过';
    if (diffMin < 60) return `约 ${diffMin} 分钟后`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return `约 ${h} 小时 ${m} 分钟后`;
  }

  function getUpcomingSpot(now, progress) {
    const spots = [...data.scenicSpots].sort((a, b) => new Date(a.at) - new Date(b.at));
    const upcomingByTime = spots.find((s) => new Date(s.at) >= now);
    if (upcomingByTime) {
      return { spot: upcomingByTime, reason: formatEta(new Date(upcomingByTime.at)) };
    }

    const currentPoint = pointAtProgress(progress);
    let best = null;
    spots.forEach((spot) => {
      const dist = haversineKm(currentPoint, spot);
      if (dist > 0.5 && dist < 80 && (!best || dist < best.dist)) {
        best = { spot, dist };
      }
    });
    if (best) {
      return { spot: best.spot, reason: `距当前位置约 ${best.dist.toFixed(0)} 公里` };
    }

    return {
      spot: { name: '拉萨', timeLabel: '18:28 到达', address: '青藏铁路终点站' },
      reason: '行程即将结束',
    };
  }

  function getCurrentLocationInfo(progress, mode) {
    const traveledKm = progress * railwayLength;
    const remainKm = Math.max(0, railwayLength - traveledKm);
    const pct = Math.round(progress * 100);

    if (progress <= 0) {
      let meta = `8月11日 22:00 发车前 · 全程约 ${Math.round(railwayLength)} 公里`;
      if (lastGps && gpsAvailable) {
        const proj = projectToRailway(lastGps.lng, lastGps.lat);
        if (proj.distKm > 8) {
          meta += ` · 您的 GPS 距铁路约 ${Math.round(proj.distKm)} km（未在车上）`;
        } else {
          meta += ` · GPS 已在铁路附近`;
        }
      } else if (!gpsAvailable) {
        meta += ' · 未获取 GPS，按时刻表';
      }
      return {
        segment: '西宁站 · 尚未发车',
        meta,
        modeLabel: shortModeLabel(mode),
        isSchedule: mode.includes('时刻表') || mode.includes('模拟'),
      };
    }
    if (progress >= 1) {
      return {
        segment: '拉萨站 · 已到达',
        meta: `全程 ${Math.round(railwayLength)} 公里 · 进度 100%`,
        modeLabel: shortModeLabel(mode),
        isSchedule: mode.includes('时刻表') || mode.includes('模拟'),
      };
    }

    let from = stationDistances[0];
    let to = stationDistances[stationDistances.length - 1];
    for (let i = 0; i < stationDistances.length - 1; i += 1) {
      if (traveledKm >= stationDistances[i].distKm && traveledKm <= stationDistances[i + 1].distKm) {
        from = stationDistances[i];
        to = stationDistances[i + 1];
        break;
      }
    }

    const segSpan = Math.max(to.distKm - from.distKm, 1);
    const segPct = Math.round(((traveledKm - from.distKm) / segSpan) * 100);
    const gpsNote = lastGps && mode.includes('GPS')
      ? ` · GPS 精度 ±${Math.round(lastGps.accuracy)}m`
      : '';

    return {
      segment: `${from.name} → ${to.name}`,
      meta: `已行 ${Math.round(traveledKm)} km · 剩余 ${Math.round(remainKm)} km · 本段 ${segPct}%${gpsNote}`,
      modeLabel: shortModeLabel(mode),
      isSchedule: mode.includes('时刻表') || mode.includes('模拟'),
    };
  }

  function updateUi(now, progress, mode) {
    currentProgress = progress;
    const pct = Math.round(progress * 100);
    els.clock.textContent = formatClock(now);
    els.mode.innerHTML = isCompact
      ? `定位 <strong>${shortModeLabel(mode)}</strong>`
      : `定位模式：<strong>${mode}</strong>`;
    els.progressChip.innerHTML = isCompact
      ? `进度 <strong>${pct}%</strong>`
      : `全程进度：<strong>${pct}%</strong>`;
    if (els.bottomProgress) els.bottomProgress.textContent = `${pct}%`;
    els.progressBar.style.width = `${pct}%`;

    const { spot, reason } = getUpcomingSpot(now, progress);
    els.nextTitle.textContent = progress >= 1 ? '已到达' : '即将到达';
    els.nextName.textContent = spot.name;
    const shortMeta = `${spot.timeLabel ? `计划 ${spot.timeLabel} · ` : ''}${reason}`;
    els.nextMeta.textContent = isCompact || !spot.address ? shortMeta : `${shortMeta} · ${spot.address}`;

    const loc = getCurrentLocationInfo(progress, mode);
    if (els.locationSegment) els.locationSegment.textContent = loc.segment;
    if (els.locationMeta) els.locationMeta.textContent = loc.meta;
    if (els.locationMode) {
      els.locationMode.textContent = loc.modeLabel;
      els.locationMode.classList.toggle('is-schedule', loc.isSchedule);
    }
  }

  function computeBounds() {
    const points = [];
    getRailwayCoords().forEach(([lng, lat]) => points.push({ lng, lat }));
    data.stations.forEach((s) => points.push(s));
    data.scenicSpots.forEach((s) => points.push(s));

    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    points.forEach(({ lng, lat }) => {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    });

    const padLng = (maxLng - minLng) * 0.06 || 0.5;
    const padLat = (maxLat - minLat) * 0.08 || 0.5;
    return {
      minLng: minLng - padLng,
      maxLng: maxLng + padLng,
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
    };
  }

  function createProjector(bounds) {
    const width = 1000;
    const height = (1000 * (bounds.maxLat - bounds.minLat)) / (bounds.maxLng - bounds.minLng);
    return {
      width,
      height,
      project(lng, lat) {
        const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * width;
        const y = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * height;
        return { x, y };
      },
    };
  }

  function setViewBox(next) {
    viewBox = next;
    svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
    updateMapPopupPosition();
  }

  function formatStationSchedule(station) {
    if (station.type === 'depart') {
      return `开点 ${new Date(station.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} · 始发`;
    }
    if (station.type === 'arrive') {
      return `到点 ${new Date(station.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} · 终到`;
    }
    const arr = new Date(station.arrive).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    const dep = new Date(station.depart).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `到 ${arr} · 开 ${dep}`;
  }

  function ensureMapPopup() {
    if (mapPopupEl) return;
    const shell = document.getElementById('map-shell');
    mapPopupEl = document.createElement('div');
    mapPopupEl.className = 'map-popup';
    mapPopupEl.hidden = true;
    mapPopupEl.innerHTML = `
      <button type="button" class="map-popup__close" aria-label="关闭">×</button>
      <div class="map-popup__title"></div>
      <div class="map-popup__subtitle"></div>
      <div class="map-popup__detail"></div>
      <div class="map-popup__arrow" aria-hidden="true"></div>
    `;
    shell.appendChild(mapPopupEl);
    mapPopupEl.querySelector('.map-popup__close').addEventListener('click', (event) => {
      event.stopPropagation();
      closeMapPopup();
    });
    mapPopupEl.addEventListener('click', (event) => event.stopPropagation());
  }

  function svgPointToScreen(svgX, svgY) {
    const rect = svg.getBoundingClientRect();
    const relX = (svgX - viewBox.x) / viewBox.w;
    const relY = (svgY - viewBox.y) / viewBox.h;
    return {
      x: rect.left + relX * rect.width,
      y: rect.top + relY * rect.height,
    };
  }

  function updateMapPopupPosition() {
    if (!mapPopupEl || mapPopupEl.hidden || !mapPopupAnchor) return;
    const { svgX, svgY } = mapPopupAnchor;
    const { x, y } = svgPointToScreen(svgX, svgY);
    const shell = document.getElementById('map-shell');
    const shellRect = shell.getBoundingClientRect();
    mapPopupEl.style.left = `${x - shellRect.left}px`;
    mapPopupEl.style.top = `${y - shellRect.top}px`;
  }

  function openMapPopup({ svgX, svgY, title, subtitle, detail, kind = 'fixed' }) {
    ensureMapPopup();
    mapPopupAnchor = { svgX, svgY, kind };
    mapPopupEl.querySelector('.map-popup__title').textContent = title;
    mapPopupEl.querySelector('.map-popup__subtitle').textContent = subtitle || '';
    mapPopupEl.querySelector('.map-popup__detail').textContent = detail || '';
    mapPopupEl.hidden = false;
    updateMapPopupPosition();
  }

  function closeMapPopup() {
    if (mapPopupEl) mapPopupEl.hidden = true;
    mapPopupAnchor = null;
  }

  function bindMarkerClick(node, handler) {
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      if (suppressMapClick) {
        suppressMapClick = false;
        return;
      }
      handler();
    });
  }

  function cloneViewBox(v) {
    return { x: v.x, y: v.y, w: v.w, h: v.h };
  }

  function getOverlayInsets() {
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-overlay')) || 72;
    const bottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottom-overlay')) || 168;
    const shell = document.getElementById('map-shell');
    const rect = shell?.getBoundingClientRect() || { width: window.innerWidth, height: window.innerHeight };
    return { top, bottom, width: rect.width, height: rect.height };
  }

  function centerOnPoint(point, scale = 0.45) {
    if (!projectFn || !point) return;
    const { x, y } = projectFn.project(point.lng, point.lat);
    const insets = getOverlayInsets();
    const visibleRatio = Math.max(0.35, (insets.height - insets.top - insets.bottom) / insets.height);
    const w = baseViewBox.w * scale;
    const h = Math.max(w / (insets.width / (insets.height * visibleRatio)), baseViewBox.h * scale * 0.75);
    const yShift = ((insets.bottom - insets.top) / insets.height) * h * 0.22;
    setViewBox({ x: x - w / 2, y: y - h / 2 + yShift, w, h });
  }

  function fitRouteView(focusPoint) {
    if (!projectFn || !baseViewBox) return;
    updateOverlayMetrics();
    const insets = getOverlayInsets();
    const visibleH = Math.max(120, insets.height - insets.top - insets.bottom);
    const visibleW = insets.width;
    const pad = isCompact ? 1.12 : 1.06;
    let w = baseViewBox.w * pad;
    let h = baseViewBox.h * pad;
    const visibleAspect = visibleW / visibleH;
    const routeAspect = w / h;
    if (routeAspect > visibleAspect) {
      h = w / visibleAspect;
    } else {
      w = h * visibleAspect;
    }

    const point = focusPoint || { lng: 97, lat: 35 };
    const { x, y } = projectFn.project(point.lng, point.lat);
    const yShift = ((insets.bottom - insets.top) / insets.height) * h * 0.18;
    setViewBox({ x: x - w / 2, y: y - h / 2 + yShift, w, h });
  }

  function svgEl(name, attrs, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    if (text != null) el.textContent = text;
    return el;
  }

  function getSpotMarkerMinDist() {
    const markerRadius = isCompact ? 5.5 : 6.5;
    const visualDiameter = (markerRadius + 1.5) * 2;
    return visualDiameter * 2;
  }

  const OFFLINE_SPOT_CLUSTERS = [
    { ids: [4, 5, 6], angles: { 4: 210, 5: 330, 6: 90 } },
  ];

  function spreadDisplayPositions(items, minDist) {
    const nodes = items.map((item) => {
      const { x, y } = projectFn.project(item.lng, item.lat);
      return { item, x, y };
    });

    const minDistSq = minDist * minDist;
    for (let pass = 0; pass < 16; pass += 1) {
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const distSq = dx * dx + dy * dy;
          if (distSq >= minDistSq) continue;

          let dist = Math.sqrt(distSq);
          if (dist < 0.001) {
            const order = (a.item.id || 0) - (b.item.id || 0);
            dx = order <= 0 ? -1 : 1;
            dy = -0.35;
            dist = 1;
          }
          const overlap = (minDist - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
        }
      }
    }

    return new Map(nodes.map((node) => [node.item.id, { x: node.x, y: node.y }]));
  }

  function applyOfflineSpotClusters(positions) {
    OFFLINE_SPOT_CLUSTERS.forEach(({ ids, angles }) => {
      const cluster = data.scenicSpots.filter((spot) => ids.includes(spot.id));
      if (cluster.length !== ids.length) return;

      const centroid = cluster.reduce(
        (acc, spot) => {
          const point = projectFn.project(spot.lng, spot.lat);
          acc.x += point.x;
          acc.y += point.y;
          return acc;
        },
        { x: 0, y: 0 }
      );
      centroid.x /= cluster.length;
      centroid.y /= cluster.length;

      const radius = isCompact ? 26 : 30;
      cluster.forEach((spot) => {
        const rad = (angles[spot.id] * Math.PI) / 180;
        positions.set(spot.id, {
          x: centroid.x + Math.cos(rad) * radius,
          y: centroid.y + Math.sin(rad) * radius,
        });
      });
    });
  }

  function computeSpotDisplayPositions() {
    const clusteredIds = new Set(OFFLINE_SPOT_CLUSTERS.flatMap((cluster) => cluster.ids));
    const regularSpots = data.scenicSpots.filter((spot) => !clusteredIds.has(spot.id));
    const positions = spreadDisplayPositions(regularSpots, getSpotMarkerMinDist());

    data.scenicSpots.forEach((spot) => {
      if (!positions.has(spot.id)) {
        const point = projectFn.project(spot.lng, spot.lat);
        positions.set(spot.id, { x: point.x, y: point.y });
      }
    });

    applyOfflineSpotClusters(positions);
    return positions;
  }

  function renderMap() {
    const bounds = computeBounds();
    projectFn = createProjector(bounds);
    baseViewBox = { x: 0, y: 0, w: projectFn.width, h: projectFn.height };
    setViewBox(cloneViewBox(baseViewBox));

    svg.innerHTML = '';
    viewport = svgEl('g', { id: 'viewport' });

    const defs = svgEl('defs');
    defs.appendChild(svgEl('filter', { id: 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, null));
    const blur = svgEl('feGaussianBlur', { stdDeviation: '2.5', result: 'coloredBlur' });
    const merge = svgEl('feMerge');
    merge.appendChild(svgEl('feMergeNode', { in: 'coloredBlur' }));
    merge.appendChild(svgEl('feMergeNode', { in: 'SourceGraphic' }));
    defs.firstChild.appendChild(blur);
    defs.firstChild.appendChild(merge);
    svg.appendChild(defs);

    const grid = svgEl('g', { opacity: '0.12' });
    for (let i = 0; i <= 10; i += 1) {
      const x = (projectFn.width / 10) * i;
      grid.appendChild(svgEl('line', {
        x1: x, y1: 0, x2: x, y2: projectFn.height,
        stroke: '#64748b', 'stroke-width': '0.6',
      }));
    }
    for (let i = 0; i <= 8; i += 1) {
      const y = (projectFn.height / 8) * i;
      grid.appendChild(svgEl('line', {
        x1: 0, y1: y, x2: projectFn.width, y2: y,
        stroke: '#64748b', 'stroke-width': '0.6',
      }));
    }
    viewport.appendChild(grid);

    const railPoints = getRailwayCoords()
      .map(([lng, lat]) => projectFn.project(lng, lat))
      .map(({ x, y }) => `${x},${y}`)
      .join(' ');
    viewport.appendChild(svgEl('polyline', {
      points: railPoints,
      fill: 'none',
      stroke: '#38bdf8',
      'stroke-width': isCompact ? '2.2' : '2.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      opacity: '0.9',
    }));

    const spotPositions = computeSpotDisplayPositions();

    data.scenicSpots.forEach((spot) => {
      const { x, y } = spotPositions.get(spot.id);
      const g = svgEl('g', { class: 'spot-node', 'data-name': spot.name });
      if (isCompact) {
        g.appendChild(svgEl('circle', {
          cx: x, cy: y, r: 14, fill: 'transparent',
        }));
      }
      g.appendChild(svgEl('circle', {
        cx: x, cy: y, r: isCompact ? 5.5 : 6.5,
        fill: '#f97316', stroke: '#fff', 'stroke-width': '1.5',
        'pointer-events': 'none',
      }));
      g.appendChild(svgEl('text', {
        x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        fill: '#fff', 'font-size': isCompact ? '6' : '7', 'font-weight': '700',
        'pointer-events': 'none',
      }, String(spot.id)));
      const showSpot = () => {
        openMapPopup({
          svgX: x,
          svgY: y,
          title: spot.name,
          subtitle: spot.timeLabel,
          detail: spot.address,
        });
      };
      bindMarkerClick(g, showSpot);
      viewport.appendChild(g);
    });

    data.stations.forEach((station) => {
      const { x, y } = projectFn.project(station.lng, station.lat);
      const g = svgEl('g', { class: 'station-node' });
      if (isCompact) {
        g.appendChild(svgEl('circle', {
          cx: x, cy: y, r: 12, fill: 'transparent',
        }));
      }
      g.appendChild(svgEl('circle', {
        cx: x, cy: y, r: isCompact ? 4.5 : 5.5,
        fill: '#facc15', stroke: '#fff', 'stroke-width': '1.5',
        'pointer-events': 'none',
      }));
      if (!isCompact) {
        g.appendChild(svgEl('text', {
          x, y: y + 11, 'text-anchor': 'middle',
          fill: '#fef9c3', 'font-size': '8', 'font-weight': '600',
        }, station.name));
      }
      bindMarkerClick(g, () => {
        openMapPopup({
          svgX: x,
          svgY: y,
          title: station.name,
          subtitle: formatStationSchedule(station),
        });
      });
      viewport.appendChild(g);
    });

    gpsEl = svgEl('g', { id: 'gps-marker', display: 'none' });
    gpsEl.appendChild(svgEl('circle', {
      cx: 0, cy: 0, r: 5, fill: '#60a5fa', stroke: '#fff', 'stroke-width': '1.5',
    }));
    viewport.appendChild(gpsEl);

    trainEl = svgEl('g', { id: 'train-marker', filter: 'url(#glow)' });
    if (isCompact) {
      trainEl.appendChild(svgEl('circle', {
        cx: 0, cy: 0, r: 14, fill: 'transparent',
      }));
    }
    trainEl.appendChild(svgEl('circle', {
      cx: 0, cy: 0, r: isCompact ? 6 : 7,
      fill: '#22c55e', stroke: '#fff', 'stroke-width': '2',
    }));
    trainEl.appendChild(svgEl('circle', {
      cx: 0, cy: 0, r: isCompact ? 10 : 12,
      fill: 'none', stroke: '#22c55e', 'stroke-width': '1.2', opacity: '0.45',
    }));
    if (!isCompact) {
      trainEl.appendChild(svgEl('text', {
        x: 0, y: 16, 'text-anchor': 'middle',
        fill: '#dcfce7', 'font-size': '8', 'font-weight': '700',
      }, '列车位置'));
    }
    bindMarkerClick(trainEl, () => {
      const loc = getCurrentLocationInfo(currentProgress, lastMode);
      const { x, y } = projectFn.project(lastTrainPoint.lng, lastTrainPoint.lat);
      openMapPopup({
        svgX: x,
        svgY: y,
        kind: 'train',
        title: '列车估算位置',
        subtitle: loc.segment,
        detail: `${loc.meta} · 定位：${lastMode}`,
      });
    });
    viewport.appendChild(trainEl);

    svg.appendChild(viewport);
    bindPanZoom();
  }

  function moveMarkers(point, gps) {
    if (!projectFn || !trainEl) return;
    const { x, y } = projectFn.project(point.lng, point.lat);
    trainEl.setAttribute('transform', `translate(${x}, ${y})`);

    if (mapPopupAnchor?.kind === 'train') {
      mapPopupAnchor.svgX = x;
      mapPopupAnchor.svgY = y;
      updateMapPopupPosition();
    }

    if (gpsEl && gps && gpsAvailable && Date.now() - lastGpsAt <= 120000) {
      const gp = projectFn.project(gps.lng, gps.lat);
      gpsEl.setAttribute('transform', `translate(${gp.x}, ${gp.y})`);
      gpsEl.setAttribute('display', 'inline');
    } else if (gpsEl) {
      gpsEl.setAttribute('display', 'none');
    }
  }

  function tick(gps) {
    const now = new Date();
    if (gps) {
      lastGps = gps;
      gpsAvailable = true;
      lastGpsAt = Date.now();
    }
    const { progress, mode } = resolveProgress(now, gps);
    lastMode = mode;
    const point = pointAtProgress(progress);
    lastTrainPoint = point;
    moveMarkers(point, gpsAvailable ? lastGps : null);
    updateUi(now, progress, mode);
  }

  function bindPanZoom() {
    let dragging = false;
    let last = null;
    let pinch = null;
    let dragMoved = false;

    const clientToSvg = (clientX, clientY) => {
      const rect = svg.getBoundingClientRect();
      const relX = (clientX - rect.left) / rect.width;
      const relY = (clientY - rect.top) / rect.height;
      return {
        x: viewBox.x + relX * viewBox.w,
        y: viewBox.y + relY * viewBox.h,
      };
    };

    const onWheel = (event) => {
      event.preventDefault();
      const focus = clientToSvg(event.clientX, event.clientY);
      const factor = event.deltaY > 0 ? 1.12 : 0.88;
      const nextW = Math.max(baseViewBox.w * 0.12, Math.min(baseViewBox.w * 3, viewBox.w * factor));
      const nextH = Math.max(baseViewBox.h * 0.12, Math.min(baseViewBox.h * 3, viewBox.h * factor));
      const ratioX = (focus.x - viewBox.x) / viewBox.w;
      const ratioY = (focus.y - viewBox.y) / viewBox.h;
      setViewBox({
        x: focus.x - nextW * ratioX,
        y: focus.y - nextH * ratioY,
        w: nextW,
        h: nextH,
      });
    };

    const onPointerDown = (event) => {
      if (event.pointerType === 'touch' && event.isPrimary === false) return;
      const target = event.target;
      const onMarker = target.closest?.('.spot-node, .station-node, #train-marker, .map-popup');
      if (!onMarker) closeMapPopup();
      dragging = true;
      dragMoved = false;
      last = { x: event.clientX, y: event.clientY };
      svg.classList.add('is-dragging');
      if (svg.setPointerCapture) svg.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event) => {
      if (pinch) {
        const [a, b] = pinch.points;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const focus = clientToSvg(mid.x, mid.y);
        const scale = dist / pinch.dist;
        const nextW = Math.max(baseViewBox.w * 0.12, Math.min(baseViewBox.w * 3, pinch.view.w / scale));
        const nextH = Math.max(baseViewBox.h * 0.12, Math.min(baseViewBox.h * 3, pinch.view.h / scale));
        const ratioX = (focus.x - viewBox.x) / viewBox.w;
        const ratioY = (focus.y - viewBox.y) / viewBox.h;
        setViewBox({
          x: focus.x - nextW * ratioX,
          y: focus.y - nextH * ratioY,
          w: nextW,
          h: nextH,
        });
        return;
      }

      if (!dragging || !last) return;
      const dxPx = event.clientX - last.x;
      const dyPx = event.clientY - last.y;
      if (Math.abs(dxPx) > 4 || Math.abs(dyPx) > 4) dragMoved = true;
      const rect = svg.getBoundingClientRect();
      const dx = (dxPx / rect.width) * viewBox.w;
      const dy = (dyPx / rect.height) * viewBox.h;
      setViewBox({
        x: viewBox.x - dx,
        y: viewBox.y - dy,
        w: viewBox.w,
        h: viewBox.h,
      });
      last = { x: event.clientX, y: event.clientY };
    };

    const onPointerUp = (event) => {
      suppressMapClick = dragMoved;
      dragging = false;
      last = null;
      pinch = null;
      svg.classList.remove('is-dragging');
      try { if (svg.releasePointerCapture) svg.releasePointerCapture(event.pointerId); } catch (_) { /* noop */ }
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);

    svg.addEventListener('touchstart', (event) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        const [a, b] = [...event.touches];
        pinch = {
          dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          points: [{ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY }],
          view: cloneViewBox(viewBox),
        };
        dragging = false;
      }
    }, { passive: false });

    svg.addEventListener('touchmove', (event) => {
      if (event.touches.length === 2 && pinch) {
        event.preventDefault();
        const [a, b] = [...event.touches];
        pinch.points = [{ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY }];
      }
    }, { passive: false });

    svg.addEventListener('touchend', () => {
      if (pinch) pinch = null;
    });

    document.body.addEventListener('touchmove', (event) => {
      if (event.target === svg || svg.contains(event.target)) return;
      if (event.target.closest('.bottom-panel')) return;
    }, { passive: true });
  }

  function bindLegendToggle() {
    if (!els.legendToggle || !els.legend) return;
    els.legendToggle.addEventListener('click', () => {
      const open = els.legend.classList.toggle('is-open');
      els.legendToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', (event) => {
      if (!els.legend.classList.contains('is-open')) return;
      if (els.legend.contains(event.target) || els.legendToggle.contains(event.target)) return;
      els.legend.classList.remove('is-open');
      els.legendToggle.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('click', (event) => {
      if (!mapPopupEl || mapPopupEl.hidden) return;
      if (mapPopupEl.contains(event.target)) return;
      if (event.target.closest?.('.spot-node, .station-node, #train-marker')) return;
      closeMapPopup();
    });
  }

  function bindLocateButton() {
    if (!els.locateBtn) return;
    els.locateBtn.addEventListener('click', () => centerOnPoint(lastTrainPoint, 0.42));
  }

  function updateOverlayMetrics() {
    const topBar = document.querySelector('.top-bar');
    const bottomPanel = document.querySelector('.bottom-panel');
    const top = Math.ceil(topBar?.getBoundingClientRect().height || 72) + 16;
    const bottom = Math.ceil(bottomPanel?.getBoundingClientRect().height || 168) + 12;
    document.documentElement.style.setProperty('--top-overlay', `${top}px`);
    document.documentElement.style.setProperty('--bottom-overlay', `${bottom}px`);
  }

  function startGeolocation() {
    if (!navigator.geolocation) {
      setInterval(() => tick(null), 5000);
      tick(null);
      return;
    }

    navigator.geolocation.watchPosition(
      (pos) => {
        tick({
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
      },
      () => {
        gpsAvailable = false;
        els.mode.classList.add('warn');
        tick(null);
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );

    setInterval(() => {
      if (!gpsAvailable || Date.now() - lastGpsAt > 30000) tick(null);
    }, 5000);
  }

  function boot() {
    isCompact = isMobileLayout();
    svg = document.getElementById('route-svg');
    buildRailwayMetrics();
    buildStationDistances();
    renderMap();
    bindLegendToggle();
    bindLocateButton();
    updateOverlayMetrics();

    window.addEventListener('resize', () => {
      const nextCompact = isMobileLayout();
      if (nextCompact !== isCompact) {
        location.reload();
        return;
      }
      updateOverlayMetrics();
      fitRouteView(lastTrainPoint);
      updateMapPopupPosition();
    });

    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        updateOverlayMetrics();
        fitRouteView(lastTrainPoint);
        updateMapPopupPosition();
      }, 180);
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        updateOverlayMetrics();
        updateMapPopupPosition();
      });
    }

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateOverlayMetrics);
      const topBar = document.querySelector('.top-bar');
      const bottomPanel = document.querySelector('.bottom-panel');
      if (topBar) observer.observe(topBar);
      if (bottomPanel) observer.observe(bottomPanel);
    }

    startGeolocation();
    tick(null);
    fitRouteView(lastTrainPoint);
  }

  boot();
})();
