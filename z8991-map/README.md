# RailVista

铁路旅客的车上沿途风景与行程定位伴侣（MVP）。

## 本地开发

前置：Node.js ≥ 20（推荐 22）、pnpm 9。

```bash
pnpm install
pnpm --filter @railvista/shared build
pnpm dev
```

- 前端：http://localhost:5173  
- API：http://localhost:3000/api/health  

复制 `apps/web/.env.example` 为 `apps/web/.env`，填入高德 Web Key / 安全密钥。

演示入口：首页「演示：Z8991 青藏线」（不依赖 12306）。

任意车次进入地图前，会请求 `/api/rail-geometry` 从 OpenStreetMap 匹配真实铁路线；失败则回退站点示意折线。API 需能访问 Overpass，并建议配置 `apps/api/.env` 中的 `AMAP_KEY` 用于补全车站坐标。

## 目录

```
apps/web      Vue 3 SPA
apps/api      Hono BFF（12306 查询代理）
packages/shared  类型与日程/进度引擎
data/         车站坐标与预置风景
deploy/       Nginx / PM2 样例
docs/         PRD / 技术方案
```

原静态单页保留在仓库根目录（`index.html`、`js/` 等），可逐步迁入 `legacy/`。

## 构建与部署

```bash
pnpm -r build
# web → apps/web/dist
# api → apps/api/dist
```

参见 `deploy/nginx.railvista.conf.example` 与 `deploy/ecosystem.config.cjs`。
