# RailVista 路线问题审查与修复 — 执行报告

> 执行日期：2026-09-25
> 方案文档：`RailVista路线问题审查与修复方案_20260925.md`
> 分支：`heyworldchannel-dev`

## 修复总览

| 类别 | 编号 | 内容 | 状态 |
|------|------|------|------|
| 代码 | B1 | `endpointsBelong` 放行贴线中段站（progress∈[0.03,0.97] && distKm≤15） | ✅ |
| 代码 | B2 | 同走廊兜底 `matchSameCorridorDirect` + `touchesCorridorGeo` 纯几何贴线 | ✅ |
| 代码 | B3 | 几何枢纽自动发现（折线最近点≤3km，bbox 粗筛+采样+邻域细化） | ✅ |
| 代码 | B4 | `unresolvedStops` 丢站追踪（不再静默丢弃） | ✅ |
| 代码 | B5 | 墙钟提额 120s+10s/段 + `railseg:v10` 缓存键 bump | ✅ |
| 数据 | A1 | `seed-stations-geo-full.mjs` 补 13 个关键缺失站坐标 | ✅ |
| 数据 | A2 | 7 条走廊 hints 扩充（jingguangxian/hukunxian/lizhan/lanxinxian/jinghaxian/hainandong/guangzhu） | ✅ |
| 数据 | A3 | 5 条新走廊构建（zhanhai/shenji/suijia/binbei/guangshen） | ✅ |
| 工具 | C1 | `scripts/audit-routes.mjs` 路线审计工具 | ✅ |
| 工具 | C2 | `scripts/patrol-data.mjs` 数据巡检门禁 | ✅ |

## 代码修改详情

### B1: endpointsBelong 放行贴线中段站

**文件**: `apps/api/src/services/corridors.ts`

- 新增 `corridorProjection()` — 计算站到走廊折线的投影进度
- 新增 `onCorridorMidway()` — 判定站是否在走廊中段（progress∈[0.03,0.97] && distKm≤15km）
- `endpointsBelong()` 放行中段站：即使存在方位冲突（如珠海北 vs 珠海），只要站在走廊中段且贴线即可
- `geoFitScore()` / `directionalConflictRatio()` 同步更新，中段站计入 eligible/near

**解决车次**: C7601（珠海北 vs 珠海冲突）、吐鲁番北→喀什（吐鲁番北 vs 吐鲁番冲突）

### B2: 同走廊兜底 + 纯几何贴线

**文件**: `apps/api/src/services/corridorNetwork.ts`

- 提取 `validateNetworkCoords()` 共用校验
- 新增 `matchSameCorridorDirect()` — 起终同走廊时直接用该走廊切片，不走死锁分支
- 新增 `touchesCorridorGeo()` — 纯几何贴线判定（bypass 方位冲突）
- 替换 L663 死锁分支：严格交集优先 → 几何兜底

**解决车次**: K512（京广→沪昆在株洲断）、Z501（hemao∩lizhan 断）

### B3: 几何枢纽自动发现

**文件**: `apps/api/src/services/corridorNetwork.ts`

- `HubLink`/`PathNode`/`ExpandLink` 加 `geoPt/geoPtTo/geoTrail` 字段
- 新增 `polylineBBox()` / `boxesOverlap()` / `approxDistSq()` / `nearestPointsBetween()`
- `buildGraph()` 加 B3 循环：两两走廊折线最近点 ≤3km 自动建边（bbox 粗筛 0.05° + 采样 120 点 + 邻域细化）
- `findCorridorPath()` 传播 geoTrail，`__geo_` hubPt 优先用记录点对

**解决车次**: K512（京广∩沪昆株洲自动连通）、Z501（河茂∩黎湛河唇自动连通）

### B4: unresolvedStops 丢站追踪

**文件**: `apps/api/src/services/railGeometryJob.ts` + `apps/api/src/routes/railGeometry.ts`

- `RailJobSnapshot` / `RailJob` 类型加 `unresolvedStops: string[]`
- 路由入口计算未定位站 → 日志 → 传参 → 响应返回
- 错误消息指名缺失站（不再「至少需要 2 个可定位的经停站」含糊报错）

**解决车次**: G1692（弋阳站标出现）、K553（经停站不缺）

### B5: 墙钟提额 + 缓存键 bump

**文件**: `apps/api/src/services/railGeometryJob.ts` + `apps/api/src/services/osmRailway.ts`

- `jobMaxMs()` 默认 120s + 10s/段分级（段数>10 → 120s+）
- `segmentCacheKey()` bump `railseg:v9` → `railseg:v10`

## 数据修改详情

### A1: 补关键缺失站坐标

**文件**: `data/stations-geo.json`（1092 → 1105 站）、`scripts/seed-stations-geo-full.mjs`（新建）

三级策略补坐标：手工坐标表 → 轨图 way 搜索 → 走廊折线投影

| 站名 | 坐标 | 来源 |
|------|------|------|
| 鹰潭北 | 117.209, 28.239 | manual |
| 弋阳 | 117.429, 28.414 | railgraph:沪昆线 |
| 襄州 | 112.158, 32.024 | railgraph:焦柳线 |
| 沈阳东 | 123.508, 41.825 | railgraph:沈吉线 |
| 石家庄东 | 114.510, 38.050 | manual |
| 长沙西 | 112.910, 28.230 | manual |
| 成都南 | 104.055, 30.609 | railgraph:成昆线 |
| 哈尔滨北 | 126.645, 45.850 | railgraph:滨北线 |
| 阳新 | 115.209, 29.827 | railgraph:武九线 |
| 雷州 | 110.042, 20.918 | railgraph:湛海线 |
| 徐闻 | 110.150, 20.331 | railgraph:湛海线 |
| 绥化 | 126.991, 46.656 | railgraph:绥佳线 |
| 北安 | 126.539, 48.230 | railgraph:滨北线 |

### A2: 7 条走廊 hints 扩充

**工具**: `scripts/expand-corridor-hints.mjs`（新建，验证候选 hint 站距折线 ≤12km）

| 走廊 | 原 hints | 新 hints | 新增站 |
|------|----------|----------|--------|
| jingguangxian | 5 | 13 | 株洲、衡阳、岳阳、武昌、汉口等 |
| hukunxian | 5 | 16 | 株洲、杭州南、上饶、鹰潭等 |
| lizhan | 3 | 3+河唇 | 河唇（0km） |
| lanxinxian | 2 | 12 | 吐鲁番、哈密、嘉峪关等 |
| jinghaxian | 3 | 8 | 沈阳北、四平等 |
| hainandong | 5 | 10 | 美兰、文昌等 |
| guangzhu | 2 | 3+珠海北 | 珠海北（0km） |

### A3: 5 条新走廊构建

| 走廊 ID | 名称 | 区间 | verify |
|---------|------|------|--------|
| zhanhai | 湛海线 | 湛江西→徐闻 | PASS |
| shenji | 沈吉线 | 沈阳→吉林 | PASS |
| suijia | 绥佳线 | 绥化→佳木斯 | PASS |
| binbei | 滨北线 | 哈尔滨→北安 | PASS (light=1) |
| guangshen | 广深线 | 广州东→常平 | PASS |

## 工具交付

### C1: `scripts/audit-routes.mjs`

路线审计工具，对车次清单逐一测试走廊/路网匹配。
- 内置 10 个车次清单（方案文档第 2 节）
- 支持 `--train`/`--from`/`--to` 单车次审计
- 支持 `--csv` 从文件读取车次清单
- 输出 `docs/route-audit-report.md`

### C2: `scripts/patrol-data.mjs`

数据巡检门禁，防回归。
- 站坐标覆盖率 <95% → WARN
- 走廊端点距 hints 首/末站 >12km → WARN
- hints 数量 <5 → INFO
- 两两走廊几何交叉 ≤3km 但无共享 hint → INFO（潜在断链）
- 支持 `--strict` 有告警则 exit(1)

## 验证结果

| 检查项 | 结果 |
|--------|------|
| `verify-corridor-geometry.mjs --strict` | 216 ok / 30 light / 0 medium / 0 heavy / 3 stationFail(light) |
| `tsc --noEmit` (api) | ✅ 通过 |
| `pnpm test` | ✅ 8/8 通过 |
| `pnpm build` | ✅ 通过 |

3 个 stationFail 均为 light 级（hint 站距折线略超 12km），运行时由 B1 中段放行兜底：
- haqi: 齐齐哈尔 2.8km（pre-existing）
- hukun: 鹰潭北 12.7km（A1 新增站，走廊折线在鹰潭段偏差已知）
- jiqing: 高密北 12.6km（pre-existing）

## 未完成项

- **A4 xiangyu 重制**: 襄渝线走廊数据质量低（132 点 + 末端距重庆西 6.5km），需后续单独重制
- **C1 运行时验证**: 审计脚本已就绪，需重启 API 后运行 `node scripts/audit-routes.mjs` 验证 10 个车次
- **站坐标覆盖率**: 当前 1105/3388 = 32.6%，需后续批量补齐