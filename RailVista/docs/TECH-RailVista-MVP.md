# RailVista 技术实现方案（MVP）

| 项 | 内容 |
|----|------|
| 文档版本 | v1.0 |
| 状态 | 已确认 |
| 对应需求 | `docs/PRD-RailVista.md` v0.1 |
| 产品名 | RailVista |
| 日期 | 2026-09-09 |

---

## 1. 文档目的与范围

本文定义 **MVP（PRD M1–M12）** 的技术架构、模块划分、接口、数据模型、部署与迁移路径，供开发直接落地。

**包含：** 选站查车、经停与 OD 截取、示意折线地图、GPS+时刻表定位、预置风景、双端 Web、云服务器部署。

**不包含（明确不做）：** 购票/余票 UI、账号登录、数据库、中转、AI 风景、OSM 真实钢轨线、商业时刻表付费 API。

---

## 2. 已确认决策摘要

| 议题 | 结论 |
|------|------|
| 车次数据 | 自建 BFF 代理 12306 公开查询接口 + 内存缓存；Z8991 预置兜底 |
| 前端 | Vite + Vue 3 + TypeScript + Pinia |
| 后端 | Hono + Node.js（`@hono/node-server`） |
| 车站坐标 | 静态打包 `stations-geo.json` |
| 铁路线形 | 经停站依次连线（示意线） |
| 风景 | 预置 JSON（至少 Z8991）；无数据不阻断 |
| 部署 | 自有云服务器：Nginx + HTTPS + PM2 |
| 后续扩展 | 预留登录/DB 边界；MVP 不上库 |

---

## 3. 总体架构

```text
┌─────────────────────────────────────────────────────────┐
│  Browser (HTTPS, Mobile + Desktop)                      │
│  Vue 3 SPA: 选车页 / 地图页                              │
│  高德 JS API 2.0 · Geolocation · localStorage           │
└──────────────────────────┬──────────────────────────────┘
                           │ /api/*
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Nginx (TLS 终止 · 静态资源 · 反代)                       │
│  /        → apps/web/dist                               │
│  /api/*   → 127.0.0.1:3000                              │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Hono BFF (PM2)                                         │
│  · 车站联想（基于 station_name 缓存）                     │
│  · 站站车次列表（12306 leftTicket）                      │
│  · 经停时刻（12306 queryByTrainNo）                      │
│  · 预置风景读取                                          │
│  · 内存 TTL 缓存 · 限流 · CORS                           │
└──────────────────────────┬──────────────────────────────┘
                           ▼
              kyfw.12306.cn 公开查询接口
              （无登录、无购票）
```

**原则：**

1. 浏览器 **不直连** 12306（跨域、Cookie、风控）。
2. 前端密钥：高德 Key / securityJsCode 仍按现项目方式配置；生产建议后续改为 Nginx 代理安全密钥（非 MVP 阻塞项）。
3. 定位、偏移、校准等 **纯前端计算**，弱网下已加载的行程仍可跑时刻表模式。

---

## 4. 技术栈明细

### 4.1 前端 `apps/web`

| 技术 | 版本策略 | 用途 |
|------|----------|------|
| Vite 6/7/8（锁定当前稳定版） | 构建与开发服务器 | |
| Vue 3 + `<script setup>` | UI 与页面状态 | |
| TypeScript | 类型安全 | |
| Vue Router | `/` 选车、`/trip` 地图 | |
| Pinia | 当前行程、图层、偏好 | |
| 高德 JS API 2.0 | 地图、Marker、Polyline、定位展示 | |
| 原生 Geolocation / 高德 Geolocation 插件 | GPS（与现逻辑等价即可） | |

不引入 Element Plus / Ant Design 等重型 UI 库；表单与列表用语义化 HTML + 少量 CSS。

### 4.2 后端 `apps/api`

| 技术 | 用途 |
|------|------|
| Node.js ≥ 20 | 运行时 |
| Hono + `@hono/node-server` | HTTP API |
| TypeScript | 与前端共享类型（见 packages） |
| 内存 Map + TTL | 查询缓存 |
| PM2 | 进程守护 |

### 4.3 共享 `packages/shared`（MVP 建议建立）

- `Trip` / `Stop` / `ScenicSpot` / `TrainSummary` 等 DTO 类型
- 进度插值、时刻偏移等 **与 UI 无关** 的纯函数（可从现 `schedule.js` 抽离）

若工期紧，MVP 第一周可先在 `web`/`api` 各维护一份类型，第二周再抽 shared；**推荐开局即建 shared**，避免双份漂移。

### 4.4 基础设施

- Nginx + Let’s Encrypt（或已有证书）
- 云服务器单机即可
- 日志：PM2 文件日志 + Nginx access

---

## 5. 仓库与目录结构

建议在现仓库旁演进为 monorepo（可用 npm workspaces / pnpm workspace）：

```text
railvista/   # 或继续使用 z8991-map 根目录改造
├── apps/
│   ├── web/                 # Vue SPA
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   │   ├── SelectTrip.vue
│   │   │   │   └── TripMap.vue
│   │   │   ├── components/  # 底栏、图例、站点详情、偏移弹层等
│   │   │   ├── composables/ # useGeolocation, useScheduleTick
│   │   │   ├── map/         # AMap 封装：折线、标记、图层
│   │   │   ├── stores/      # tripStore, prefsStore
│   │   │   ├── api/         # fetch 封装
│   │   │   └── styles/
│   │   ├── index.html
│   │   └── vite.config.ts
│   └── api/                 # Hono BFF
│       ├── src/
│       │   ├── index.ts
│       │   ├── routes/
│       │   │   ├── stations.ts
│       │   │   ├── trains.ts
│       │   │   └── presets.ts
│       │   ├── services/
│       │   │   ├── cr12306.ts      # 会话、列表、经停
│       │   │   ├── stationIndex.ts # 站名/拼音索引
│       │   │   └── cache.ts
│       │   └── middleware/
│       └── package.json
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── types.ts
│       │   └── schedule/    # 偏移、校准、进度插值
│       └── package.json
├── data/
│   ├── stations-geo.json    # telecode/name → lng,lat
│   ├── station_name.cache.json  # 可选：12306 站表本地缓存
│   └── presets/
│       └── z8991.json       # 站点+风景演示包
├── deploy/
│   ├── nginx.railvista.conf.example
│   └── ecosystem.config.cjs # PM2
├── docs/
│   ├── PRD-RailVista.md
│   └── TECH-RailVista-MVP.md  # 本文档
└── package.json             # workspaces
```

现有 `js/app.js`、`js/schedule.js`、`js/data.js`、`js/railway-line.js` 作为 **迁移源**，MVP 完成后可归档到 `legacy/`，避免双轨维护。

---

## 6. 核心领域模型

### 6.1 类型（逻辑）

```ts
/** 车站（查询/地图共用） */
interface StationRef {
  name: string;
  telecode: string;      // 三字码，如 VNP
  lng?: number;
  lat?: number;
}

/** 车次列表项（站站查询结果） */
interface TrainSummary {
  trainCode: string;     // 展示车次，如 Z8991
  trainNo: string;       // 12306 内部编号，经停查询必填
  from: StationRef;
  to: StationRef;
  departTime: string;    // HH:mm
  arriveTime: string;
  duration: string;      // HH:mm
  date: string;          // YYYY-MM-DD（用户查询日）
}

/** 经停站 */
interface Stop {
  seq: number;
  name: string;
  telecode?: string;
  arriveTime: string | null;  // 始发可为 null
  departTime: string | null;  // 终到可为 null
  dayOffset?: number;         // 跨天 +0/+1/...
  lng?: number;
  lat?: number;
}

/** 用户截取后的行程（进度 0–1 的基准） */
interface UserSegment {
  trainCode: string;
  trainNo: string;
  date: string;
  fromName: string;
  toName: string;
  stops: Stop[];              // 已截取子序列
  baseDepartureIso: string;   // 区间首站计划发车（含日期）
  baseArrivalIso: string;
}

interface ScenicSpot {
  id: string;
  name: string;
  lng: number;
  lat: number;
  intro?: string;
  timeLabel?: string;
  at?: string;                // 建议观景开始 ISO
  side?: 'left' | 'right' | 'both' | 'unknown';
  nightOnly?: boolean;
  source: 'preset';
  trainCode?: string;         // 关联预置包
}
```

### 6.2 OD 截取规则

1. 拉取 **全程** 经停 `stopsAll`。
2. 用户确认上车站 `from`、下车站 `to`（默认等于查询 OD；允许改为经停中任意前后站）。
3. 找到索引 `iFrom < iTo`，取 `stops = stopsAll.slice(iFrom, iTo + 1)`。
4. 进度 `0` = 上车站发车时刻，`1` = 下车站到达时刻；中间站按时刻线性插值到折线弧长（与现 Z8991 策略一致：先按时刻得进度，再映射到折线）。
5. 风景过滤：落在该区间时间窗内，或地理上投影进度落在 `(0,1)` 内（预置包实现时二选一，**推荐时间窗优先，无时间则用站序区间**）。

### 6.3 示意折线

```text
polyline = segment.stops
  .filter(s => s.lng != null && s.lat != null)
  .map(s => [s.lng, s.lat])
```

- 少于 2 个有效坐标：地图可展示，但禁用折线投影，**强制时刻表模式**并提示「部分车站缺少坐标」。
- UI 文案标注「示意线（站点连线），非真实轨道」。

### 6.4 定位融合（迁移现网逻辑）

从现 `app.js` / `schedule.js` 迁入 `packages/shared` + `composables`：

| 能力 | 行为 |
|------|------|
| 发车偏移 | 整体平移区间内站时刻与风景 `at`；`localStorage` key 含 `trainCode+date+from+to` |
| 站点校准 | 用户确认当前站后偏移后续 ETA；45 分钟临近窗高亮（沿用） |
| GPS 融合 | GPS 新鲜、精度与距线距离合格时，与时刻表进度加权融合（沿用 65/35 等参数，可配置常量） |
| 即将到达 | 优先下一风景，否则下一站/终点 |
| 图层 | rail / station / spot / train / gps，本地持久化 |

---

## 7. 后端 API 设计

Base path：`/api`。统一响应：

```json
{ "ok": true, "data": { } }
{ "ok": false, "error": { "code": "UPSTREAM_FAIL", "message": "..." } }
```

### 7.1 `GET /api/health`

探活。

### 7.2 `GET /api/stations/suggest?q=`

- 基于缓存的 12306 `station_name` 索引（站名 / 拼音 / 简拼）。
- 返回最多 20 条 `{ name, telecode, city? }`。
- 站表启动时拉取并落盘 `data/station_name.cache.json`，定期（如 7 天）刷新。

### 7.3 `GET /api/trains`

| 参数 | 说明 |
|------|------|
| `from` | 站名或 telecode |
| `to` | 站名或 telecode |
| `date` | `YYYY-MM-DD`，限今日起约 15 天内（与 12306 开售窗口一致） |

**上游：**

1. 解析为 telecode。  
2. `GET .../otn/leftTicket/init` 建立会话 Cookie。  
3. `GET .../otn/leftTicket/queryO`（失败则轮换 `queryG` / `queryA` / `queryZ` 等，依据响应或 `c_url`）。  
4. 解析 `|` 分隔字段 → `TrainSummary[]`。  
5. **丢弃余票字段不返回给前端**（PRD：不做余票主功能；减少误导）。

**缓存：** key = `trains:{from}:{to}:{date}`，TTL 建议 **10–30 分钟**。

### 7.4 `GET /api/trains/stops`

| 参数 | 说明 |
|------|------|
| `trainNo` | 内部编号（列表接口返回） |
| `trainCode` | 展示车次（日志/预置匹配） |
| `from` / `to` | telecode（与 12306 经停接口一致） |
| `date` | 出发日期 |

**上游：** `GET .../otn/czxx/queryByTrainNo?train_no&from_station_telecode&to_station_telecode&depart_date`

合并 `stations-geo.json` 补全 `lng/lat`。

**缓存：** key = `stops:{trainNo}:{date}:{from}:{to}`，TTL **1–6 小时**。

### 7.5 `GET /api/presets/:id`

例：`/api/presets/z8991` → 返回演示用 stations + scenicSpots（可含已校正坐标与文案）。

选车流程中：若 `trainCode` 命中预置映射，地图页额外请求本接口合并风景。

### 7.6 限流与安全

- 单 IP 简易限流（如 30 req/min）。
- 仅允许本站 Origin（CORS 白名单配置化）。
- 不转发 12306 Cookie 到浏览器。
- 不记录精确 GPS（GPS 仅存浏览器）。

---

## 8. 12306 接入要点（可行性依据）

公开资料与开源实现（TrainClaw、Uni-CLI 12306 adapter、社区 MCP 等，2025–2026）表明：

| 步骤 | 端点（示意） | 说明 |
|------|----------------|------|
| 会话 | `/otn/leftTicket/init` | 获取 Cookie |
| 列表 | `/otn/leftTicket/queryO` 等 | 参数：`train_date, from_station, to_station, purpose_codes=ADULT` |
| 经停 | `/otn/czxx/queryByTrainNo` | 需列表中的内部 `train_no` |

**实现约束：**

1. 服务端需带合法 `Referer` / `User-Agent`，维护 Cookie 罐。  
2. 接口路径名会轮换 → **多 URL 回退**。  
3. 可能 IP 风控 → 缓存降压 + 预置兜底 + 友好错误文案。  
4. 仅用于查询演示，文档声明非官方授权；量增后可替换为商用 API 而不改前端契约（BFF 适配器模式）。

**适配器接口（代码层）：**

```ts
interface TrainDataSource {
  searchTrains(from: string, to: string, date: string): Promise<TrainSummary[]>;
  getStops(query: StopsQuery): Promise<Stop[]>;
}
// 默认实现：Cr12306Source
// 预留：CommercialApiSource
```

---

## 9. 前端页面与交互

### 9.1 路由

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | SelectTrip | 出发站、到达站、日期、查询、车次列表 |
| `/trip` | TripMap | 查询参数或 Pinia 注入当前 `UserSegment` |

深链示例：`/trip?trainCode=Z8991&date=2026-08-11&from=西宁&to=拉萨`（无状态时回退请求 stops）。

### 9.2 SelectTrip

1. 站名输入 → debounce → `/api/stations/suggest`。  
2. 日期选择（默认明天或今天）。  
3. 查询 → 列表展示车次号、时刻、历时（**不展示余票**）。  
4. 点击车次 → 拉经停 → 可选微调上下车站 → 进入 `/trip`。  
5. 入口提供「演示：Z8991 青藏线」一键加载预置（上游失败时的主演示路径）。

### 9.3 TripMap

复刻并泛化现 Z8991 UI：

- 全屏地图 + 顶栏状态（模式 / 时钟 / 进度）
- 底栏：当前位置摘要、「即将到达」
- 图例图层开关、定位按钮、改发车时间、站点校准
- 桌面：底栏可改为右侧栏或加宽底栏；`matchMedia` 适配（M12）
- 出行前：不授权 GPS 时仅时刻表模式（M11）

### 9.4 高德集成

依据官方 JS API 2.0 文档：

- `AMap.Map` + `AMap.Polyline` 画示意线  
- `AMap.Marker` 站点 / 风景 / 列车 / GPS  
- 加载前设置 `window._AMapSecurityConfig.securityJsCode`  
- Key 与域名白名单包含云服务器域名  

配置：`apps/web/.env.production` 中 `VITE_AMAP_KEY` 等（勿提交密钥到公开仓库；用服务器环境文件）。

---

## 10. 静态数据

### 10.1 `data/stations-geo.json`

```json
{
  "VNP": { "name": "北京南", "lng": 116.37, "lat": 39.86 },
  "西宁": { "telecode": "XNO", "lng": 101.81, "lat": 36.64 }
}
```

- 构建脚本：合并 12306 站表与开源/自有坐标集；缺省站允许缺失。  
- 坐标系与高德一致（GCJ-02）；若源为 WGS84，入库前转换。

### 10.2 `data/presets/z8991.json`

从现 `js/data.js` 导出：meta、stations、scenicSpots。  
MVP 可用预置包的站坐标覆盖动态经停中同名站，保证演示质量。

---

## 11. 从 z8991-map 的迁移映射

| 现文件/能力 | 目标 |
|-------------|------|
| `js/schedule.js` 偏移/校准/图层 | `packages/shared/schedule` + `prefsStore` |
| `js/app.js` 进度/GPS 融合/即将到达/标记 | `composables` + `map/*` |
| `js/data.js` | `data/presets/z8991.json` |
| `js/railway-line.js` | **MVP 不加载**；归档供 v2 OSM |
| `index.html` UI 结构 | `TripMap.vue` + CSS |
| `config.js` | 环境变量 + 可选运行时 config |

迁移顺序建议：

1. 抽 shared 日程引擎 + 单测（可用现有 `?simulate=` / `?progress=` 思路做开发开关）。  
2. 搭 api 12306 适配器 + 缓存。  
3. 选车页打通。  
4. 地图页移植。  
5. 预置 Z8991 回归验收（对照 PRD §9）。

---

## 12. 部署方案（云服务器）

### 12.1 构建

```bash
# 示例
pnpm -r build
# web → apps/web/dist
# api → apps/api/dist
```

### 12.2 PM2（`deploy/ecosystem.config.cjs`）

- 进程名：`railvista-api`  
- script：`apps/api/dist/index.js`  
- env：`PORT=3000`、`CORS_ORIGIN=https://your.domain`  

### 12.3 Nginx 示意

```nginx
server {
  listen 443 ssl;
  server_name your.domain.com;
  # ssl_certificate ...;

  root /var/www/railvista/apps/web/dist;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:3000/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

### 12.4 运维检查清单

- [ ] HTTPS 有效（手机 GPS）  
- [ ] 高德 Key 域名白名单  
- [ ] 防火墙仅 80/443  
- [ ] PM2 开机自启  
- [ ] 磁盘日志轮转  

---

## 13. 环境与配置

| 变量 | 位置 | 说明 |
|------|------|------|
| `VITE_AMAP_KEY` | web | 高德 Key |
| `VITE_AMAP_SECURITY` | web | 安全密钥（MVP 可明文；知悉风险） |
| `VITE_API_BASE` | web | 默认 `/api` |
| `PORT` | api | 默认 3000 |
| `CORS_ORIGIN` | api | 前端源 |
| `CACHE_TTL_TRAINS_SEC` | api | 列表缓存 |
| `CACHE_TTL_STOPS_SEC` | api | 经停缓存 |

---

## 14. 扩展预留（非 MVP 实现）

| 未来能力 | 预留点 |
|----------|--------|
| 用户登录 | `apps/api` 增加 `/auth/*`；Pinia `userStore`；JWT Cookie |
| 数据库 | 引入 Drizzle/Prisma + SQLite/PostgreSQL；收藏行程表 |
| 商用时刻表 | 实现 `TrainDataSource` 第二适配器，配置切换 |
| OSM 真线 | 新服务 `GET /api/rail-geometry`；地图层替换 polyline |
| AI 风景 | 异步任务接口；结果写入用户本地或 DB |

MVP **禁止**提前实现上述功能，仅保持边界清晰。

---

## 15. 测试与验收

### 15.1 开发自测

- API：固定 OD（如 北京南→上海虹桥）列表非空；任选一列车经停 ≥ 2 站。  
- 缓存命中时上游请求不增加（日志可观测）。  
- 上游失败时演示入口仍可进 Z8991 地图。  

### 15.2 对照 PRD 验收（必须全过）

1. 有数据时可选站选日列直达车并进地图。  
2. 中间站 OD 截取后进度/站点/风景仅反映区间。  
3. 无 GPS 时刻表模式可用；有 GPS 模式标识变化。  
4. 发车偏移、站点校准刷新后仍在（同行程 key）。  
5. Z8991 风景可见可点详情。  
6. 无风景车次不阻断。  
7. 手机与桌面主流程可完成。  
8. 无购票/登录/中转入口。

### 15.3 建议自动化（可选）

- `shared/schedule` 纯函数单测（插值、偏移、截取）。  
- API 对 12306 的集成测试默认 skip（CI 无外网/易风控），本地手动跑。

---

## 16. 里程碑（工程）

| 阶段 | 交付 | 预估工作量（参考） |
|------|------|-------------------|
| E0 | monorepo 脚手架、Nginx/PM2 样例、shared 日程引擎抽出 | 2–3 天 |
| E1 | 12306 适配器 + stations suggest + trains/stops + 缓存 | 3–4 天 |
| E2 | SelectTrip 页打通 | 1–2 天 |
| E3 | TripMap 移植定位/图层/校准/即将到达 + 示意折线 | 4–5 天 |
| E4 | stations-geo 打包、Z8991 预置、双端样式、云服务器部署验收 | 2–3 天 |

合计约 **2–3 周**（单人，含联调与风控折腾缓冲）。

---

## 17. 风险与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| 12306 限流/改版 | 高 | 多 endpoint、缓存、预置演示、适配器可替换 |
| 部分站无坐标 | 中 | 缺省跳过点；演示线用预置坐标 |
| 高德密钥暴露 | 中 | 域名白名单；后续 Nginx 代理 securityJsCode |
| Vue 重写回归偏差 | 中 | 以 Z8991 场景做视觉/行为对照清单 |
| 云服务器出境/地区网络访问 12306 | 中 | 服务器须能稳定访问 `kyfw.12306.cn`（国内机房更佳） |

---

## 18. 开放问题（实现期再定，不阻塞开干）

1. 包管理器：pnpm vs npm workspaces（推荐 pnpm）。  
2. `stations-geo.json` 具体数据源文件与许可证（实现时选定一份可维护来源）。  
3. 是否在地图 UI 显示「数据来自公开时刻查询，仅供参考」小字（建议加）。  

---

## 19. 参考资料

- 高德地图 JS API 2.0：准备与安全密钥、Marker、Polyline、Geolocation（Context7 / lbs.amap.com，文档更新至 2025）  
- Cloudflare Workers CORS/Cache 模式（本方案改用自建 Node，思路可借鉴缓存）  
- Vite + Vue-TS 官方模板  
- Hono Node.js 部署 + Nginx 反代 + PM2  
- 12306 查询流程公开资料：`leftTicket/init` → `leftTicket/query*` → `czxx/queryByTrainNo`  
- 开源参考（逻辑参考，非依赖）：TrainClaw、社区 12306 MCP/adapter  

---

## 20. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-09-09 | 初版方案经确认后成文：免费 12306 BFF、Vue3、Hono、云服务器、静态车站坐标 |

---

**文档结束。** 开发启动前请再确认第 18 节开放问题偏好；其余可按第 16 节里程碑开工。
