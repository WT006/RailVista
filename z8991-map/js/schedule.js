(function () {
  const STORAGE_KEY = 'z8991_departure';

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
      onApply(resolveSchedule(data, config));
      closeDialog();
    });

    saveBtn?.addEventListener('click', () => {
      const iso = fromDatetimeLocalValue(input?.value);
      if (!iso || Number.isNaN(new Date(iso).getTime())) return;
      setDepartureIso(iso);
      const nextConfig = { ...(config || {}), DEPARTURE: iso };
      onApply(resolveSchedule(data, nextConfig));
      closeDialog();
    });
  }

  window.Z8991Schedule = {
    STORAGE_KEY,
    shiftDate,
    getDepartureIso,
    resolveSchedule,
    setDepartureIso,
    clearDeparture,
    toDatetimeLocalValue,
    fromDatetimeLocalValue,
    formatDepartBadge,
    formatDepartLong,
    formatTime,
    formatSpotTimeLabel,
    formatStationSchedule,
    updateDepartBadge,
    bindDepartureEditor,
  };
})();
