(function () {
  const config = window.Z8991_CONFIG || {};
  const data = window.Z8991_DATA || {};
  const scheduleApi = window.Z8991Schedule;

  let scheduleState = scheduleApi.resolveSchedule(data, config);
  let departure = scheduleState.departure;
  let arrival = scheduleState.arrival;
  let offsetMs = scheduleState.offsetMs;
  const shifted = (value) => scheduleApi.shiftDate(value, offsetMs);

  let map;
  let railwayPath = [];
  let railwayLength = 0;
  let trainMarker;
  let gpsMarker;
  let railLine;
  let spotMarkers = [];
  let stationMarkers = [];
  let gpsAvailable = false;
  let lastGpsAt = 0;
  let lastGps = null;
  let lastTrainPoint = null;
  let stationDistances = [];
  let currentProgress = 0;
  let lastMode = '时刻表估算';
  let isCompact = false;
  let layerVisibility = scheduleApi.getLayerVisibility();

  const els = {
    mode: document.getElementById('mode-chip'),
    clock: document.getElementById('clock-chip'),
    progressChip: document.getElementById('progress-chip'),
    bottomProgress: document.getElementById('bottom-progress-text'),
    nextTitle: document.getElementById('next-title'),
    nextName: document.getElementById('next-name'),
    nextMeta: document.getElementById('next-meta'),
    progressBar: document.getElementById('progress-bar'),
    errorOverlay: document.getElementById('error-overlay'),
    errorText: document.getElementById('error-text'),
    legend: document.getElementById('legend'),
    legendToggle: document.getElementById('legend-toggle'),
    locateBtn: document.getElementById('locate-btn'),
    locationSegment: document.getElementById('location-segment'),
    locationMeta: document.getElementById('location-meta'),
    locationMode: document.getElementById('location-mode'),
  };

  function applySchedule(next) {
    scheduleState = next;
    departure = next.departure;
    arrival = next.arrival;
    offsetMs = next.offsetMs;
    scheduleApi.updateDepartBadge(departure);
    tick(lastGps && gpsAvailable ? lastGps : null);
  }

  function isMobileLayout() {
    return window.matchMedia('(max-width: 640px)').matches;
  }

  function getSpotTimeLabel(spot) {
    return scheduleApi.formatSpotTimeLabel(spot, shifted(spot.at));
  }

  function shortModeLabel(mode) {
    if (!isCompact) return mode;
    return mode
      .replace('时刻表估算（GPS 信号弱）', '时刻表（GPS弱）')
      .replace('时刻表估算（偏离铁路较远）', '时刻表（偏离）')
      .replace('时刻表估算', '时刻表')
      .replace('GPS + 时刻表', 'GPS');
  }

  function updateOverlayMetrics(refit = false) {
    const topBar = document.querySelector('.top-bar');
    const bottomPanel = document.querySelector('.bottom-panel');
    const top = Math.ceil(topBar?.getBoundingClientRect().height || 72) + 16;
    const bottom = Math.ceil(bottomPanel?.getBoundingClientRect().height || 118) + 12;
    document.documentElement.style.setProperty('--top-overlay', `${top}px`);
    document.documentElement.style.setProperty('--bottom-overlay', `${bottom}px`);
    if (map) {
      map.resize();
      if (refit) map.setFitView(null, false, getMapPadding());
    }
  }

  function observeOverlayResize() {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updateOverlayMetrics(false));
    const topBar = document.querySelector('.top-bar');
    const bottomPanel = document.querySelector('.bottom-panel');
    if (topBar) observer.observe(topBar);
    if (bottomPanel) observer.observe(bottomPanel);
  }

  function getMapPadding() {
    const side = isCompact ? 20 : 48;
    const top = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--top-overlay'), 10) || 72;
    const bottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bottom-overlay'), 10) || 118;
    return [top, side, bottom, side];
  }

  function bindLocateButton() {
    if (!els.locateBtn) return;
    els.locateBtn.addEventListener('click', () => {
      if (!map || !lastTrainPoint) return;
      map.panTo([lastTrainPoint.lng, lastTrainPoint.lat]);
      if (map.getZoom() < 7) map.setZoom(7);
    });
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

  function getQueryParams() {
    return new URLSearchParams(window.location.search);
  }

  function getSimulatedProgress() {
    const raw = getQueryParams().get('progress') ?? getQueryParams().get('simulate');
    if (raw == null) return null;
    const value = Number(raw);
    if (Number.isNaN(value)) return null;
    return value > 1 ? value / 100 : value;
  }

  /** 测试用：?mockNow=2026-08-11T22:05:00+08:00 模拟当前时间（不影响 ?progress=） */
  function getNow() {
    const mock = getQueryParams().get('mockNow');
    if (mock) {
      const parsed = new Date(mock);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  }

  function getCurrentLocationInfo(progress, mode) {
    const traveledKm = progress * railwayLength;
    const remainKm = Math.max(0, railwayLength - traveledKm);
    const pct = Math.round(progress * 100);

    if (progress <= 0) {
      let meta = `${scheduleApi.formatDepartLong(departure)} 发车前 · 全程约 ${Math.round(railwayLength)} 公里`;
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
        isSchedule: mode.includes('时刻表'),
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
      isSchedule: mode.includes('时刻表'),
    };
  }

  function updateLocationUi(progress, mode) {
    const info = getCurrentLocationInfo(progress, mode);
    if (els.locationSegment) els.locationSegment.textContent = info.segment;
    if (els.locationMeta) els.locationMeta.textContent = info.meta;
    if (els.locationMode) {
      els.locationMode.textContent = info.modeLabel;
      els.locationMode.classList.toggle('is-schedule', info.isSchedule);
    }
  }

  function moveGpsMarker(gps) {
    if (!map) return;
    const stale = !gpsAvailable || Date.now() - lastGpsAt > 120000;
    if (!gps || stale || !layerVisibility.gps) {
      if (gpsMarker) gpsMarker.hide();
      return;
    }

    if (!gpsMarker) {
      gpsMarker = new AMap.Marker({
        position: [gps.lng, gps.lat],
        content: '<div class="gps-marker"></div>',
        anchor: 'center',
        zIndex: 190,
        title: '手机 GPS 位置',
      });
      gpsMarker.on('click', () => {
        const proj = projectToRailway(lastGps.lng, lastGps.lat);
        const info = new AMap.InfoWindow({
          content: `<div style="padding:4px 2px;font-size:13px;line-height:1.5;">
            <strong>手机 GPS 位置</strong><br/>
            <span style="color:#64748b;">精度 ±${Math.round(lastGps.accuracy)} 米</span><br/>
            <span style="color:#64748b;">距铁路约 ${proj.distKm.toFixed(1)} 公里</span>
          </div>`,
          offset: new AMap.Pixel(0, -16),
        });
        info.open(map, gpsMarker.getPosition());
      });
      map.add(gpsMarker);
    } else {
      gpsMarker.setPosition([gps.lng, gps.lat]);
      gpsMarker.show();
    }
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
  }

  function showError(message) {
    els.errorText.innerHTML = message;
    els.errorOverlay.classList.add('show');
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

  function getRailwayCoords() {
    const precise = window.Z8991_RAILWAY;
    if (precise && precise.length > 2) return precise;
    return data.railway || [];
  }

  function buildRailwayMetrics() {
    railwayPath = getRailwayCoords().map(([lng, lat], index) => ({
      lng,
      lat,
      index,
      distFromStart: 0,
    }));

    railwayLength = 0;
    for (let i = 1; i < railwayPath.length; i += 1) {
      const seg = haversineKm(railwayPath[i - 1], railwayPath[i]);
      railwayLength += seg;
      railwayPath[i].distFromStart = railwayLength;
    }
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
      if (distKm < best.distKm) {
        best = { distKm, progress, point };
      }
    }
    return best;
  }

  function scheduleProgress(now) {
    const timeline = [];
    data.stations.forEach((s) => {
      if (s.at) timeline.push({ at: shifted(s.at), name: s.name });
      if (s.arrive) timeline.push({ at: shifted(s.arrive), name: s.name + '（到）' });
      if (s.depart) timeline.push({ at: shifted(s.depart), name: s.name + '（开）' });
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

  function resolveProgress(now, gps) {
    const simulated = getSimulatedProgress();
    if (simulated != null) {
      return { progress: Math.max(0, Math.min(1, simulated)), mode: '模拟进度' };
    }

    const scheduleP = scheduleProgress(now);
    if (!gps) {
      return { progress: scheduleP, mode: '时刻表估算' };
    }

    const ageMs = now.getTime() - gps.timestamp;
    if (ageMs > 120000 || gps.accuracy > 800) {
      return { progress: scheduleP, mode: '时刻表估算（GPS 信号弱）' };
    }

    const projected = projectToRailway(gps.lng, gps.lat);
    if (projected.distKm > 8) {
      return { progress: scheduleP, mode: '时刻表估算（偏离铁路较远）' };
    }

    const blended = projected.progress * 0.65 + scheduleP * 0.35;
    return { progress: blended, mode: 'GPS + 时刻表' };
  }

  function formatClock(now) {
    if (isCompact) {
      return now.toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }
    return now.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
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
    const spots = [...data.scenicSpots].sort((a, b) => shifted(a.at) - shifted(b.at));
    const upcomingByTime = spots.find((s) => shifted(s.at) >= now);
    if (upcomingByTime) {
      return {
        spot: upcomingByTime,
        reason: formatEta(shifted(upcomingByTime.at)),
      };
    }

    const currentPoint = pointAtProgress(progress);
    let best = null;
    spots.forEach((spot) => {
      const dist = haversineKm(currentPoint, spot);
      if (dist > 0.5 && dist < 80) {
        if (!best || dist < best.dist) best = { spot, dist };
      }
    });
    if (best) {
      return {
        spot: best.spot,
        reason: `距当前位置约 ${best.dist.toFixed(0)} 公里`,
      };
    }

    return {
      spot: { name: '拉萨', timeLabel: `${scheduleApi.formatTime(arrival)} 到达`, intro: '青藏铁路南端终点，天路旅程的标志性终点。' },
      reason: '行程即将结束',
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
    const timeLabel = spot.at ? getSpotTimeLabel(spot) : spot.timeLabel;
    els.nextTitle.textContent = progress >= 1 ? '已到达' : '即将到达';
    els.nextName.textContent = spot.name;
    const shortMeta = `${timeLabel ? `计划 ${timeLabel} · ` : ''}${reason}`;
    els.nextMeta.textContent = isCompact || !spot.intro
      ? shortMeta
      : `${shortMeta} · ${spot.intro}`;
    updateLocationUi(progress, mode);
  }

  function applyLayerVisibility() {
    if (railLine) {
      if (layerVisibility.rail) railLine.show();
      else railLine.hide();
    }
    spotMarkers.forEach((marker) => {
      if (layerVisibility.spot) marker.show();
      else marker.hide();
    });
    stationMarkers.forEach((marker) => {
      if (layerVisibility.station) marker.show();
      else marker.hide();
    });
    if (trainMarker) {
      if (layerVisibility.train) trainMarker.show();
      else trainMarker.hide();
    }
    if (gpsMarker) {
      const gpsActive = gpsAvailable && lastGps && Date.now() - lastGpsAt <= 120000;
      if (layerVisibility.gps && gpsActive) gpsMarker.show();
      else gpsMarker.hide();
    }
    els.legend?.querySelectorAll('[data-layer]').forEach((btn) => {
      const layer = btn.dataset.layer;
      if (!layer) return;
      btn.setAttribute('aria-pressed', layerVisibility[layer] ? 'true' : 'false');
    });
  }

  function bindLayerToggles() {
    if (!els.legend) return;
    els.legend.querySelectorAll('[data-layer]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const layer = btn.dataset.layer;
        if (!layer) return;
        layerVisibility = scheduleApi.setLayerVisible(layer, !layerVisibility[layer]);
        applyLayerVisibility();
        map?.clearInfoWindow();
      });
    });
  }

  function moveTrainMarker(point) {
    if (!trainMarker) return;
    trainMarker.setPosition([point.lng, point.lat]);
  }

  function tick(gps) {
    const now = getNow();
    if (gps) lastGps = gps;
    const { progress, mode } = resolveProgress(now, gps);
    lastMode = mode;
    const point = pointAtProgress(progress);
    lastTrainPoint = point;
    moveTrainMarker(point);
    moveGpsMarker(gpsAvailable && lastGps ? lastGps : null);
    updateUi(now, progress, mode);
  }

  function initMap() {
    isCompact = isMobileLayout();
    map = new AMap.Map('map', {
      zoom: 5,
      center: [92.5, 34.5],
      viewMode: '2D',
      mapStyle: 'amap://styles/grey',
      dragEnable: true,
      zoomEnable: true,
      doubleClickZoom: true,
      touchZoom: true,
    });

    const coords = getRailwayCoords();
    railLine = new AMap.Polyline({
      path: coords.map(([lng, lat]) => [lng, lat]),
      strokeColor: '#38bdf8',
      strokeWeight: isCompact ? 4 : 5,
      strokeOpacity: 0.85,
      lineJoin: 'round',
    });
    map.add(railLine);

    spotMarkers = [];
    data.scenicSpots.forEach((spot) => {
      const marker = new AMap.Marker({
        position: [spot.lng, spot.lat],
        title: spot.name,
        anchor: 'bottom-center',
        content: `<div class="spot-marker${isCompact ? ' spot-marker--compact' : ''}">${spot.id}</div>`,
      });
      marker.on('click', () => {
        const info = new AMap.InfoWindow({
          content: `<div style="max-width:min(280px,78vw);padding:6px 4px;font-size:14px;line-height:1.5;color:#334155;">
            <strong style="color:#111827;font-size:15px;">${spot.name}</strong><br/>
            <span style="color:#0369a1;font-weight:600;">${getSpotTimeLabel(spot)}</span><br/>
            <span style="color:#64748b;">${spot.intro}</span>
          </div>`,
          offset: new AMap.Pixel(0, -28),
        });
        info.open(map, marker.getPosition());
      });
      map.add(marker);
      spotMarkers.push(marker);
    });

    stationMarkers = [];
    data.stations.forEach((s) => {
      const scheduleText = scheduleApi.formatStationSchedule(s, shifted);

      const marker = new AMap.Marker({
        position: [s.lng, s.lat],
        title: s.name,
        content: `<div class="station-marker${isCompact ? ' station-marker--compact' : ''}"><span class="station-dot"></span><span class="station-label">${s.name}</span></div>`,
        anchor: 'center',
        zIndex: 150,
      });
      marker.on('click', () => {
        const introLine = s.intro
          ? `<br/><span style="color:#64748b;">${s.intro}</span>`
          : '';
        const info = new AMap.InfoWindow({
          content: `<div style="max-width:min(260px,78vw);padding:6px 4px;font-size:14px;line-height:1.5;color:#334155;">
            <strong style="color:#111827;font-size:15px;">${s.name}</strong><br/>
            <span style="color:#0369a1;font-weight:600;">${scheduleText}</span>${introLine}
          </div>`,
          offset: new AMap.Pixel(0, -20),
        });
        info.open(map, marker.getPosition());
      });
      map.add(marker);
      stationMarkers.push(marker);
    });

    trainMarker = new AMap.Marker({
      position: getRailwayCoords()[0],
      content: `<div class="train-marker-wrap"><div class="train-marker${isCompact ? ' train-marker--compact' : ''}"></div><span class="train-marker-label">${isCompact ? '列车' : '列车位置'}</span></div>`,
      anchor: 'center',
      zIndex: 200,
      title: '列车估算位置',
    });
    trainMarker.on('click', () => {
      const loc = getCurrentLocationInfo(currentProgress, lastMode);
      const info = new AMap.InfoWindow({
        content: `<div style="max-width:min(280px,78vw);padding:6px 4px;font-size:14px;line-height:1.55;">
          <strong>列车估算位置</strong><br/>
          <span style="color:#334155;">${loc.segment}</span><br/>
          <span style="color:#64748b;">${loc.meta}</span><br/>
          <span style="color:#64748b;font-size:12px;">定位：${lastMode} · 绿点=铁路上估算，蓝点=手机 GPS</span>
        </div>`,
        offset: new AMap.Pixel(0, -24),
      });
      info.open(map, trainMarker.getPosition());
    });
    map.add(trainMarker);
    applyLayerVisibility();
    updateOverlayMetrics(true);
    observeOverlayResize();
  }

  function startGeolocation() {
    const TICK_MS = 1000;
    setInterval(() => tick(null), TICK_MS);
    tick(null);

    if (!navigator.geolocation) return;

    navigator.geolocation.watchPosition(
      (pos) => {
        gpsAvailable = true;
        lastGpsAt = Date.now();
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
  }

  function boot() {
    if (!config.AMAP_KEY || config.AMAP_KEY === 'YOUR_AMAP_KEY_HERE') {
      showError(
        '请先在 <code>config.js</code> 中填入高德 Web Key。<br><br>复制 <code>config.example.js</code>，在 <a href="https://lbs.amap.com/" target="_blank" rel="noopener">高德开放平台</a> 申请 JS API Key 后粘贴到 <code>AMAP_KEY</code>。'
      );
      return;
    }

    if (config.AMAP_SECURITY_CODE) {
      window._AMapSecurityConfig = { securityJsCode: config.AMAP_SECURITY_CODE };
    }

    buildRailwayMetrics();
    buildStationDistances();
    bindLegendToggle();
    bindLayerToggles();
    bindLocateButton();
    scheduleApi.updateDepartBadge(departure);
    scheduleApi.bindDepartureEditor({
      data,
      config,
      getSchedule: () => scheduleState,
      onApply: applySchedule,
    });

    window.addEventListener('resize', () => {
      const nextCompact = isMobileLayout();
      if (nextCompact !== isCompact && map) {
        location.reload();
        return;
      }
      updateOverlayMetrics();
    });
    window.addEventListener('orientationchange', () => {
      setTimeout(() => updateOverlayMetrics(true), 150);
    });

    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.AMAP_KEY)}`;
    script.onload = () => {
      initMap();
      startGeolocation();
      tick(null);
    };
    script.onerror = () => {
      showError('高德地图脚本加载失败，请检查 Key、域名白名单和网络。');
    };
    document.head.appendChild(script);
  }

  boot();
})();
