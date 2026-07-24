# Z8991 进藏沿途地图

在地图上展示 Z8991 西宁→拉萨沿途 18 个风景点、青藏铁路 OSM 真实轨道线，并支持 **GPS + 时刻表混合定位** 与底部「即将到达」提示。

数据来源：[飞书多维表格](https://my.feishu.cn/base/YZaLbPNuJaF8O0s25W4c6hgCnDh)

## 1. 配置高德 Key

1. 打开 [高德开放平台](https://lbs.amap.com/) → 应用管理 → 创建应用 → 添加 **Web 端 (JS API)** Key
2. 复制配置：

```bash
copy config.example.js config.js
```

3. 编辑 `config.js`，填入：

```js
AMAP_KEY: '你的Key',
AMAP_SECURITY_CODE: '你的安全密钥', // 2021年后新建 Key 通常需要
```

4. 在 Key 的「域名白名单」中加入你实际访问的域名，例如：
   - 本地测试：`localhost`
   - GitHub Pages：`你的用户名.github.io`
   - 云服务器：`你的域名`

## 2. 本地预览

```bash
cd z8991-map
npx serve . -p 8080
```

浏览器打开 `http://localhost:8080`。

> 手机 GPS 需要 **HTTPS**。本地仅适合电脑预览；车上请用下面部署方式。

## 2b. 离线版（无需联网）

若不想配置高德 Key、或想在无网络环境直接打开，使用 **`offline.html`**：

- 双击打开，或通过本地服务器访问：`http://localhost:8080/offline.html`
- **单文件版**：`offline.html` 已内联全部 CSS/JS（约 94KB），可单独发给手机打开，无需其他文件
- 重新打包：修改 `css/` 或 `js/` 后运行 `node scripts/bundle-offline-html.js`
- **不需要** `config.js`，不加载任何在线地图 API
- 用 SVG 绘制铁路线、站点、风景点和当前位置（ schematic 示意图，无真实地图底图）
- 支持双指缩放 / 拖拽平移；右下角「定位」按钮可跳到当前位置
- 本地预览进度：在 URL 加 `?progress=35` 模拟 35% 行程（例如 `offline.html?progress=35`）

需要复制的文件：`offline.html`、`css/`、`js/data.js`、`js/railway-line.js`、`js/offline-app.js`（整个 `z8991-map` 文件夹最省事）。

## 3. 部署（二选一）

### 方式 A：GitHub Pages（推荐，最简单）

1. 将 `z8991-map` 推送到 GitHub 仓库
2. 仓库 Settings → Pages → Source 选 `main` 分支 `/z8991-map` 或根目录
3. 访问 `https://<用户名>.github.io/<仓库名>/`
4. 高德白名单添加 `*.github.io` 或完整域名

### 方式 B：云服务器 Nginx

把目录上传到服务器，例如 `/var/www/z8991-map`，Nginx 配置：

```nginx
server {
    listen 443 ssl;
    server_name your.domain.com;
    root /var/www/z8991-map;
    index index.html;
    location / {
        try_files $uri $uri/ =404;
    }
}
```

配置 HTTPS 证书（Let's Encrypt 等），高德白名单添加 `your.domain.com`。

## 4. 车上使用

1. 手机浏览器打开 HTTPS 页面
2. 允许「位置信息」权限
3. 页面会：
   - 用 GPS 定位并投影到铁路线附近
   - GPS 弱/丢失时，按 **8月11日 22:00 发车** 时刻表估算位置
   - 底部显示「即将到达 xxx」

## 说明

- **在线版**（`index.html`）依赖高德地图，必须联网并配置 Key
- **离线版**（`offline.html`）纯前端静态页，无地图底图，可断网使用
- 铁路线来自 OpenStreetMap [青藏铁路 relation:152884](https://www.openstreetmap.org/relation/152884)（约 2342 个轨道点，非景点直连）
- 火车内 GPS 可能不准或丢信号，时刻表估算是重要兜底
- 景点坐标来自飞书表格，更新表格后需重新导出 `js/data.js`
- 若 OSM 铁路数据更新，可运行 `node scripts/build-railway.js` 重新生成 `js/railway-line.js`
