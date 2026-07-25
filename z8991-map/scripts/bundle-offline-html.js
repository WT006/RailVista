const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const style = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const offlineCss = fs.readFileSync(path.join(root, 'css/offline.css'), 'utf8')
  .replace(/@import url\('style.css'\);\s*/, '');
const css = `${style}\n${offlineCss}`;
const dataJs = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
const railwayJs = fs.readFileSync(path.join(root, 'js/railway-line.js'), 'utf8');
const scheduleJs = fs.readFileSync(path.join(root, 'js/schedule.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'js/offline-app.js'), 'utf8');

const scheduleDialogHtml = `
  <div class="schedule-dialog" id="schedule-dialog" hidden>
    <div class="schedule-dialog__backdrop"></div>
    <div class="schedule-dialog__card" role="dialog" aria-labelledby="schedule-dialog-title">
      <h2 id="schedule-dialog-title">设置发车时间</h2>
      <p class="schedule-dialog__hint">修改西宁开点后，时刻表估算与风景点计划时间将整体顺延或提前。设置保存在本机浏览器。</p>
      <label class="schedule-dialog__field">
        <span>西宁开点（北京时间）</span>
        <input type="datetime-local" id="departure-input" />
      </label>
      <div class="schedule-dialog__actions">
        <button type="button" id="departure-reset">恢复默认</button>
        <button type="button" id="departure-cancel">取消</button>
        <button type="button" id="departure-save" class="primary">保存</button>
      </div>
    </div>
  </div>`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="format-detection" content="telephone=no" />
  <meta name="theme-color" content="#0f172a" />
  <title>Z8991 离线地图</title>
  <style>
${css}
  </style>
</head>
<body>
  <div class="map-shell" id="map-shell">
    <svg id="route-svg" aria-label="Z8991 路线图"></svg>
  </div>

  <header class="top-bar">
    <div class="status-card">
      <div class="status-row status-row--primary">
        <span class="train-badge">Z8991</span>
        <span class="route-text">西宁 → 拉萨</span>
        <button type="button" class="depart-text" id="depart-btn" title="点击修改发车时间">8/11 22:00</button>
        <span class="offline-badge">离线</span>
        <time class="clock" id="clock-chip">--</time>
      </div>
      <div class="status-row status-row--secondary">
        <span id="progress-chip">进度 <strong>0%</strong></span>
        <span class="status-divider" aria-hidden="true">·</span>
        <span id="mode-chip">定位 <strong>--</strong></span>
      </div>
    </div>
  </header>

  <button type="button" class="locate-btn" id="locate-btn" aria-label="定位到当前位置">定位</button>
  <button type="button" class="legend-toggle" id="legend-toggle" aria-expanded="false">图例</button>

  <div class="legend" id="legend">
    <div><i class="rail"></i>青藏铁路</div>
    <div><i class="station"></i>经停站</div>
    <div><i class="spot"></i>风景 1–18</div>
    <div><i class="train"></i>列车估算位置</div>
  </div>

  <footer class="bottom-panel">
    <section class="location-card">
      <div class="location-card__head">
        <h2>当前位置</h2>
        <span class="location-mode" id="location-mode">时刻表</span>
      </div>
      <div class="location-segment" id="location-segment">定位中…</div>
      <div class="location-meta" id="location-meta"></div>
    </section>
    <div class="panel-divider" aria-hidden="true"></div>
    <section class="upcoming-card">
      <div class="bottom-panel__head">
        <h2 id="next-title">即将到达</h2>
        <span class="bottom-panel__progress-text" id="bottom-progress-text">0%</span>
      </div>
      <div class="next-name" id="next-name">加载中…</div>
      <div class="meta" id="next-meta"></div>
    </section>
    <div class="progress" aria-hidden="true"><span id="progress-bar"></span></div>
  </footer>

  <p class="offline-hint">单文件离线版 · 点击顶部发车时间可修改 · 加 ?progress=35 可模拟进度</p>
${scheduleDialogHtml}

  <script>
${dataJs}
  </script>
  <script>
${railwayJs}
  </script>
  <script>
${scheduleJs}
  </script>
  <script>
${appJs}
  </script>
</body>
</html>
`;

fs.writeFileSync(path.join(root, 'offline.html'), html);
console.log(`written offline.html (${(html.length / 1024).toFixed(1)} KB)`);
