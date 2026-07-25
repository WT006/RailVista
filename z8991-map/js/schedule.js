(function () {
  const STORAGE_KEY = 'z8991_departure';
  const CALIBRATION_STORAGE_KEY = 'z8991_station_calibration';
  const TRAIN_MARKER_KEY = 'z8991_show_train_marker';
  const LAYER_VISIBILITY_KEY = 'z8991_layer_visibility';
  const CALIBRATE_WINDOW_MS = 45 * 60 * 1000;
  const DEFAULT_LAYER_VISIBILITY = {
    rail: true,
    station: true,
    spot: true,
    train: true,
    gps: true,
  };

  function shiftDate(value, offsetMs) {
    const date = value instanceof Date ? value : new Date(value);
    return new Date(date.getTime() + offsetMs);
  }

  function getDepartureIso(data, config, searchParams) {
    const params = searchParams || new URLSearchParams(window.location.search);
    let stored = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      /* private mode */
    }
    return params.get('departure') || stored || config?.DEPARTURE || data.stations[0].at;
  }

  /**
   * 解析发车/到达。修改发车时间会将 data.js 中全部站时刻与风景点时刻整体平移相同偏移。
   * 优先级：URL ?departure= > localStorage > config.js > data.js 默认
   */
  function resolveSchedule(data, config, searchParams) {
    const params = searchParams || new URLSearchParams(window.location.search);
    const cfg = config || {};
    const baseDeparture = new Date(data.stations[0].at);
    const baseArrival = new Date(data.stations[data.stations.length - 1].at);

    const departureValue = getDepartureIso(data, cfg, params);
    const departure = new Date(departureValue);
    const offsetMs = departure.getTime() - baseDeparture.getTime();

    const arrivalValue = params.get('arrival') || cfg.ARRIVAL || null;
    const arrival = arrivalValue ? new Date(arrivalValue) : shiftDate(baseArrival, offsetMs);

    return { departure, arrival, offsetMs, baseDeparture, baseArrival };
  }

  function toDatetimeLocalValue(isoOrDate) {
    const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    const s = date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
    return s.slice(0, 16).replace(' ', 'T');
  }

  function fromDatetimeLocalValue(value) {
    if (!value) return null;
    return `${value}:00+08:00`;
  }

  function setDepartureIso(iso) {
    localStorage.setItem(STORAGE_KEY, iso);
  }

  function clearDeparture() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function readCalibration() {
    try {
      const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed.offsetMs !== 'number' || !parsed.stationName) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeCalibration(record) {
    try {
      localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(record));
    } catch (_) {
      /* private mode */
    }
    return record;
  }

  function clearCalibration() {
    try {
      localStorage.removeItem(CALIBRATION_STORAGE_KEY);
    } catch (_) {
      /* private mode */
    }
  }

  /** 中间经停站（不含始发西宁、终到拉萨） */
  function getCalibratableStations(stations) {
    return stations.filter((s) => s.type === 'stop');
  }

  function getStationAnchorTime(station, shifted) {
    if (station.type !== 'stop' || !station.arrive) return null;
    return shifted(station.arrive);
  }

  function computeCalibrationOffset(now, anchorTime) {
    return now.getTime() - anchorTime.getTime();
  }

  /** 将真实时间映射回图定时刻轴，后续进度与 ETA 均基于此 */
  function effectiveScheduleDate(now, calibration) {
    if (!calibration || typeof calibration.offsetMs !== 'number') {
      return now instanceof Date ? now : new Date(now);
    }
    const base = now instanceof Date ? now : new Date(now);
    return new Date(base.getTime() - calibration.offsetMs);
  }

  function formatOffsetLabel(offsetMs) {
    const min = Math.round(offsetMs / 60000);
    if (min === 0) return '准点';
    if (min > 0) return `晚点 ${min} 分钟`;
    return `早点 ${Math.abs(min)} 分钟`;
  }

  function isNearScheduledArrival(now, station, shifted, windowMs = CALIBRATE_WINDOW_MS) {
    const anchor = getStationAnchorTime(station, shifted);
    if (!anchor) return false;
    return Math.abs(now.getTime() - anchor.getTime()) <= windowMs;
  }

  function buildCalibrationPreview(station, now, shifted, stations, currentCalibration) {
    const anchorTime = getStationAnchorTime(station, shifted);
    if (!anchorTime) {
      return { ok: false, reason: '该站不支持校准' };
    }
    const offsetMs = computeCalibrationOffset(now, anchorTime);
    const deltaMin = Math.round(offsetMs / 60000);
    let backward = false;
    if (currentCalibration) {
      const lastIdx = stations.findIndex((s) => s.name === currentCalibration.stationName);
      const newIdx = stations.findIndex((s) => s.name === station.name);
      backward = lastIdx >= 0 && newIdx >= 0 && newIdx < lastIdx;
    }
    return {
      ok: true,
      offsetMs,
      deltaMin,
      anchorTime,
      backward,
      shiftLabel: deltaMin >= 0 ? '延后' : '提前',
      shiftMin: Math.abs(deltaMin),
    };
  }

  function calibrateAtStation(station, now, shifted) {
    const anchorTime = getStationAnchorTime(station, shifted);
    if (!anchorTime) return null;
    return writeCalibration({
      stationName: station.name,
      offsetMs: computeCalibrationOffset(now, anchorTime),
      calibratedAt: now.toISOString(),
      anchorIso: anchorTime.toISOString(),
    });
  }

  function showToast(el, message, durationMs = 2800) {
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      el.hidden = true;
    }, durationMs);
  }

  function bindStationCalibration({
    data,
    shifted,
    getNow,
    getCalibration,
    onApply,
    onClear,
    elements,
  }) {
    const {
      toggle,
      panel,
      list,
      status,
      clearBtn,
      dialog,
      dialogText,
      dialogConfirm,
      dialogCancel,
      toast,
    } = elements;
    if (!list || !dialog) return { refresh: () => {} };

    const backdrop = dialog.querySelector('.schedule-dialog__backdrop');
    let pendingStation = null;

    const closeDialog = () => {
      pendingStation = null;
      dialog.hidden = true;
    };

    const renderList = () => {
      const cal = getCalibration();
      const now = getNow();
      list.innerHTML = '';
      getCalibratableStations(data.stations).forEach((station) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'calibrate-station-btn';
        btn.textContent = station.name;
        if (cal?.stationName === station.name) btn.classList.add('is-active');
        if (isNearScheduledArrival(now, station, shifted)) btn.classList.add('is-near');
        btn.addEventListener('click', () => {
          pendingStation = station;
          const preview = buildCalibrationPreview(
            station,
            now,
            shifted,
            data.stations,
            cal
          );
          if (!preview.ok) {
            showToast(toast, preview.reason || '无法校准');
            return;
          }
          const backwardNote = preview.backward
            ? `\n\n注意：当前已按「${cal.stationName}」校准，改到更早的站会覆盖后续估算。`
            : '';
          dialogText.textContent =
            `确认您现在在「${station.name}」？\n` +
            `图定到点 ${formatTime(preview.anchorTime)}，当前 ${formatTime(now)}（${formatOffsetLabel(preview.offsetMs)}）。\n` +
            `确认后，后续风景点与进度估算将整体${preview.shiftLabel} ${preview.shiftMin} 分钟。${backwardNote}`;
          dialog.hidden = false;
        });
        list.appendChild(btn);
      });
    };

    const updateStatus = () => {
      const cal = getCalibration();
      if (status) {
        status.textContent = cal
          ? `已校准·${cal.stationName}（${formatOffsetLabel(cal.offsetMs)}）`
          : '未校准';
      }
      if (toggle) {
        toggle.classList.toggle('is-active', !!cal);
        toggle.title = cal
          ? `站点校准：${cal.stationName}（${formatOffsetLabel(cal.offsetMs)}）`
          : '站点校准';
      }
      if (clearBtn) clearBtn.hidden = !cal;
    };

    const closePanel = () => {
      if (!panel) return;
      panel.hidden = true;
      toggle?.setAttribute('aria-expanded', 'false');
    };

    const refresh = () => {
      updateStatus();
      if (panel && !panel.hidden) renderList();
    };

    toggle?.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) refresh();
    });

    document.addEventListener('click', (event) => {
      if (!panel || panel.hidden) return;
      if (panel.contains(event.target) || toggle?.contains(event.target)) return;
      closePanel();
    });

    clearBtn?.addEventListener('click', () => {
      clearCalibration();
      onClear?.();
      refresh();
      showToast(toast, '已清除站点校准');
    });

    dialogCancel?.addEventListener('click', closeDialog);
    backdrop?.addEventListener('click', closeDialog);

    dialogConfirm?.addEventListener('click', () => {
      if (!pendingStation) return;
      const record = calibrateAtStation(pendingStation, getNow(), shifted);
      closeDialog();
      if (record) {
        onApply?.(record);
        closePanel();
        refresh();
        showToast(toast, `已按「${record.stationName}」校准，后续估算已${formatOffsetLabel(record.offsetMs)}`);
      }
    });

    refresh();
    return { refresh, openConfirmForStation: (station) => {
      pendingStation = station;
      const preview = buildCalibrationPreview(
        station,
        getNow(),
        shifted,
        data.stations,
        getCalibration()
      );
      if (!preview.ok) {
        showToast(toast, preview.reason || '无法校准');
        return;
      }
      dialogText.textContent =
        `确认您现在在「${station.name}」？\n` +
        `图定到点 ${formatTime(preview.anchorTime)}，当前 ${formatTime(getNow())}（${formatOffsetLabel(preview.offsetMs)}）。\n` +
        `确认后，后续风景点与进度估算将整体${preview.shiftLabel} ${preview.shiftMin} 分钟。`;
      dialog.hidden = false;
    } };
  }

  function isShowTrainMarker() {
    return isLayerVisible('train');
  }

  function setShowTrainMarker(show) {
    setLayerVisible('train', show);
  }

  function readStoredLayers() {
    try {
      const raw = localStorage.getItem(LAYER_VISIBILITY_KEY);
      if (raw) {
        return { ...DEFAULT_LAYER_VISIBILITY, ...JSON.parse(raw) };
      }
      const legacyTrain = localStorage.getItem(TRAIN_MARKER_KEY);
      if (legacyTrain !== null) {
        return { ...DEFAULT_LAYER_VISIBILITY, train: legacyTrain !== '0' };
      }
    } catch (_) {
      /* private mode / invalid JSON */
    }
    return { ...DEFAULT_LAYER_VISIBILITY };
  }

  function getLayerVisibility() {
    return readStoredLayers();
  }

  function setLayerVisible(layer, show) {
    const next = { ...readStoredLayers(), [layer]: !!show };
    try {
      localStorage.setItem(LAYER_VISIBILITY_KEY, JSON.stringify(next));
    } catch (_) {
      /* private mode */
    }
    return next;
  }

  function isLayerVisible(layer) {
    return readStoredLayers()[layer] !== false;
  }

  function formatDepartBadge(date) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(date).map((part) => [part.type, part.value])
    );
    return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
  }

  function formatDepartLong(date) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(date).map((part) => [part.type, part.value])
    );
    return `${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}`;
  }

  function formatTime(date) {
    return date.toLocaleTimeString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function formatSpotTimeLabel(spot, shiftedStart) {
    const start = shiftedStart instanceof Date ? shiftedStart : new Date(shiftedStart);
    const m = spot.timeLabel && spot.timeLabel.match(/(\d{1,2}:\d{2})\s*[～~]\s*(\d{1,2}:\d{2})/);
    if (!m) return formatTime(start);
    const [sh, sm] = m[1].split(':').map(Number);
    const [eh, em] = m[2].split(':').map(Number);
    let durMin = (eh * 60 + em) - (sh * 60 + sm);
    if (durMin < 0) durMin += 24 * 60;
    const end = new Date(start.getTime() + durMin * 60000);
    return `${formatTime(start)}～${formatTime(end)}`;
  }

  function formatStationSchedule(station, shifted) {
    if (station.type === 'depart') {
      return `开点 ${formatTime(shifted(station.at))} · 始发`;
    }
    if (station.type === 'arrive') {
      return `到点 ${formatTime(shifted(station.at))} · 终到`;
    }
    const arr = formatTime(shifted(station.arrive));
    const dep = formatTime(shifted(station.depart));
    return `到 ${arr} · 开 ${dep}`;
  }

  function updateDepartBadge(departure) {
    const btn = document.getElementById('depart-btn');
    if (btn) btn.textContent = formatDepartBadge(departure);
  }

  function bindDepartureEditor({ data, config, getSchedule, onApply }) {
    const btn = document.getElementById('depart-btn');
    const dialog = document.getElementById('schedule-dialog');
    if (!btn || !dialog) return;

    const input = document.getElementById('departure-input');
    const saveBtn = document.getElementById('departure-save');
    const cancelBtn = document.getElementById('departure-cancel');
    const resetBtn = document.getElementById('departure-reset');
    const backdrop = dialog.querySelector('.schedule-dialog__backdrop');

    const openDialog = () => {
      const current = getSchedule();
      if (input) input.value = toDatetimeLocalValue(current.departure);
      dialog.hidden = false;
    };

    const closeDialog = () => {
      dialog.hidden = true;
    };

    btn.addEventListener('click', openDialog);
    cancelBtn?.addEventListener('click', closeDialog);
    backdrop?.addEventListener('click', closeDialog);

    resetBtn?.addEventListener('click', () => {
      clearDeparture();
      clearCalibration();
      onApply(resolveSchedule(data, config));
      closeDialog();
    });

    saveBtn?.addEventListener('click', () => {
      const iso = fromDatetimeLocalValue(input?.value);
      if (!iso || Number.isNaN(new Date(iso).getTime())) return;
      setDepartureIso(iso);
      clearCalibration();
      const nextConfig = { ...(config || {}), DEPARTURE: iso };
      onApply(resolveSchedule(data, nextConfig));
      closeDialog();
    });
  }

  window.Z8991Schedule = {
    STORAGE_KEY,
    CALIBRATION_STORAGE_KEY,
    CALIBRATE_WINDOW_MS,
    shiftDate,
    getDepartureIso,
    resolveSchedule,
    setDepartureIso,
    clearDeparture,
    readCalibration,
    writeCalibration,
    clearCalibration,
    getCalibratableStations,
    getStationAnchorTime,
    computeCalibrationOffset,
    effectiveScheduleDate,
    formatOffsetLabel,
    isNearScheduledArrival,
    buildCalibrationPreview,
    calibrateAtStation,
    showToast,
    bindStationCalibration,
    isShowTrainMarker,
    setShowTrainMarker,
    getLayerVisibility,
    setLayerVisible,
    isLayerVisible,
    toDatetimeLocalValue,
    fromDatetimeLocalValue,
    formatDepartBadge,
    formatDepartLong,
    formatTime,
    formatSpotTimeLabel,
    formatStationSchedule,
    updateDepartBadge,
    bindDepartureEditor,
    TRAIN_MARKER_KEY,
    LAYER_VISIBILITY_KEY,
    DEFAULT_LAYER_VISIBILITY,
  };
})();
