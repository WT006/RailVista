# RailVista 变更说明（CHANGELOG）

> 本文件位于仓库根目录，是**唯一的变更记录入口**。
> 所有版本历史、改动内容与版本号都在这里维护。

**当前版本：`0.4.2`**（2026-10-01）

版本号的唯一来源是 `packages/shared/src/version.ts` 的 `APP_VERSION` 常量，
前端首页（"选择行程"页顶部徽标）直接读取该常量渲染，因此**界面版本号与本文件始终一致**。

---

## 版本规则（务必遵守）

1. **任何一次改动（功能、修复、重构、数据/文档调整）都必须同步更新本文件**，在顶部追加或补全对应版本的变更条目；不允许出现"改了代码但不记 changelog"的情况。
2. 版本号采用 **SemVer 三段式 `MAJOR.MINOR.PATCH`**，粒度较细：
   - `PATCH`（修订号）：小迭代、缺陷修复、字段微调、样式改动等向后兼容改动。**日常迭代默认递增修订号**；
   - `MINOR`（次版本号）：新增能力模块、对外接口新增可选字段、数据 schema 扩展等向下兼容的较大变更；
   - `MAJOR`（主版本号）：破坏性变更（接口签名变更、数据格式不兼容、默认行为改变）。
3. 递增版本号时必须**同时**改动三处，保持一致：
   - `packages/shared/src/version.ts` 的 `APP_VERSION`（界面显示用）
   - 本文件的「当前版本」标记与新增条目标题
   - `package.json` / `apps/*/package.json` / `packages/*/package.json` 的 `version` 字段
4. 变更条目建议包含：改动动机 → 涉及文件 → 行为变化 → 验证方式 → 已知限制/回滚方式。
5. 若一次改动同时影响需求文档（如 `docs/scenic-supplement-20260928.md`），在条目中注明对应章节，便于回溯。
6. 目前仍处于 `0.x` 阶段，允许在 `MINOR` 中做少量不兼容调整，但必须在本文件显式说明。

---

## [0.4.2] — 2026-10-01

**景点补充批次 20261001 入库 + 纪念票模板设计资产**（分支 `heyworldchannel-20261001`）。

### 1. 景点扩充批次（49 条策展源，已并入主库 432→624）

- 策展源 `data/presets/scenic-spots-supplement-20261001.json`（v3 六维，含 lineHints/真实来源）；暂存副本 `data/presets/_scenic-staging-20261001.json` 一并入库留档。
- 经 `scripts/build-scenic-spots-curated.mjs` v3 门禁净新增并入 `data/presets/scenic-spots.json`；`data/stations-geo.json` 运行时 geocode 同步。
- 报告：`docs/scenic-supplement-20261001.md`（走廊覆盖度实测、东北/江浙沪/福建逐线核查、并行会话防冲突去重见 §8.1）。
- 附用户导出清单：`RailVista-全国铁路景点总清单-20261001.docx`。

### 2. 纪念票模板设计资产（万里路书衍生）

- `铁路纪念票模板设计.png` / `自驾纪念票模板设计.png` / `年度纪念票模板设计.png`、原型 `万里路书-纪念票模板原型.html`、规划指令 `万里路书-纪念票-AI代码生成规划指令.md`（均暂存仓库根，后续可整理进 assets/）。

### 3. 工程卫生

- `.gitignore` 增加 `~$*`（Office 锁文件不入库）。

### 已知限制

- API 单测存在 **9 个 v0.4.0 起的历史遗留失败**（scenicSpots 京沪稀疏阈值未随数据扩充更新 + corridors 匹配 5 例语义断言失败），与本批次数据无关（stash 归因验证过），待后续专项修复。

---

## [0.4.1] — 2026-10-01

### feat(drive): 权威名录全量化 + 几何扩容（0.4.0 交付清单的落地项）

**权威名录全量（验收 #6 补完）**：新增 `scripts/fetch-plan-2022.mjs`，从国务院《国家公路网规划》(2022)
官方 PDF（gov.cn，附件 1/2 路线方案表）解析出**普通国道 301 条 + 国家高速 278 条**全量名录
（编号/起讫点/控制点，含 47 纵线 G229-G248、182 联络线 G501-G701、6 地区环线、12 都市圈环线、
30 城市绕城环线），落 `data/roads/authoritative/plan-2022-{national,expressway}.json`。
`build-road-index.mjs` 重构为以规划表为主数据源，内置种子降级为 META 表（116 条经典线的
线名/官方里程/途经省）。解析器处理了 PDF 提取的三类粘连：起讫点+控制点连写（起点名重复定位拆分）、
环线/连接线无横线（标记词截断）、城市绕城段序号+编号+名称连写（预切分 + 两行式名称）。

**串接过串修复**：`chainWays` 增加 `maxKm` 官方里程封顶（×1.6），G227 由 2613km 修至 550km
（官方 341km，仍标 partial 但量级归位）；拼接同样受上限约束，超限段诚实留给 orphan。

**几何扩容**：第二批 19 条经典线实抓（G104-G111 放射线、G204-G210/G307/G309/G314/G319/G324/G326），
L1 几何 14 → **33 条**；RVRT 拓扑重建为 **40,448 节点 / 44,710 边（1.75MB）**；地图图层 33 条折线。
G314 曾被 Overpass 限流，冷却后补抓成功。

**其它**：`scripts/e2e-drive.mjs` 由 tmp 入库（PRD §12 验收的 curl 等价物，退出码可作 CI 门禁）；
编号键盘候选按数字升序（PRD §4.2「G3 → G30 → G318」）；G318 起讫点解析修复（上海→聂拉木）。

**验证**：`node scripts/validate-road-keys.mjs` 301+278+12 全过；`node scripts/e2e-drive.mjs` 全部通过
（stats 301/301 · 278/278 · 挂几何 33 · 拓扑 40,448 节点）；`pnpm build` 全仓通过（gzip 147.9KB）；
390 视口探针无溢出无折行、公路网 33 线渲染。质检：ok 1（G317 偏差 5%）/ partial 6 / broken 26 /
缺几何 558——多数几何为部分段（OSM ref 标注不全），coverage-gap.csv 如实记录。

---

## [0.4.0] — 2026-10-01

### feat(drive): 万里路书 v2 · 全国公路旅游网（PRD-万里路书-全国公路旅游网-20261001）

**动机**：v1 把「12 条精品线」当模块主体、只做单条预置路线，被需求方否决。v2 与铁路版同构：
全国公路网 + 路线搜索 + 任意 OD 的沿程景点，12 条线降为排行榜榜单之一。

**主功能（与铁路一一对应）**：

- **A 全国公路网**：L0 索引（`data/roads/index/`，国道 75/301 + 高速 55/278 + 省道 12 的高置信种子）、
  L1 几何（`data/roads/geom/`，Overpass 实抓 14 条旗舰线：G318/G109/G315/G217/G227/G312/G213/G214/G317/G219/G331/G316/G320/G212）、
  L2 拓扑（`data/roads/china-road-topo.bin`，RVRT 格式沿用铁路 RVTP，30,584 节点 / 36,744 边，含等级系数与跨线边）。
- **B 公路搜索**：`suggestPlaces` 四类索引（地名 / 公路编号 / 景点 / 服务区），降级链 高德 → Nominatim → 点地图选点；
  前端「公路编号键盘」（G/S/X/Y/C + 数字 + 省芯片，对标车次前缀键盘）。
- **C 任意 OD → 沿程景点**：双引擎规划（高德 v5 GCJ-02→WGS84 + 本地干线 A* 兜底 + direct 降级）；
  `filterSpotsAlongRoad` 沿程匹配器（0.05° 网格索引，缓冲分档 roadside 0.3 / detour5 3 / detour20 12 / distant 35 km，
  detourKm = distKm×2−0.3）；C3 实时态（v1 雷达车速带规则原样复用，嵌入沿程页）。
- **D 排行榜**：统一榜单模型（政策 12 线 / 中国国家地理最美公路 / 其他聚合 / 分省榜，
  条目 = roadKeys 引用 + 精选，点入复用主功能沿程页）。
- **E 路书降级保留**：`/drive/roadbook/:routeId`，入口收窄到次级导航抽屉；青甘环线打样数据保留并复制到 `data/roads/routes/`。

**页面与路由**（PRD §2.1）：`/drive`（地图 + OD + 键盘，榜单第二屏）、`/drive/trip`（沿程页）、
`/drive/road/:code`、`/drive/atlas`（复用全国地图 + 公路图层开关）、`/drive/rankings[/:boardId]`、
`/drive/roadbook/:routeId`；旧 `/drive/:id` 与 `/drive/:id/nav` 重定向兼容；`DriveNav.vue` 独立页移除（改造为 `DriveLivePanel` 组件）。

**API**（PRD §5.5）：`/api/drive/suggest` `/road/:key` `/route` `/along` `/network/stats` `/network/overview` `/board[/:id]`；
v0.3.0 的 `/routes` `/routes/:id` `/stats` 保留。新增服务：`roadNetwork` `roadIndex` `roadsideSpots` `roadRouting` `roadTopology` `driveBoards`。

**数据**：`data/roads/roadside-spots.json` 1,035 条起步集（铁路侧 624 景点迁移 + Tier C 手工种子 89 + OSM 观景点 355）；
`places-geo.json` 216 个地名锚点（运行时 geocode 回写）；`facilities.json` 服务区种子；
`scripts/`：`lib/overpass.mjs`（共享抓取库）、`build-road-index` `fetch-road-geometry` `build-road-topology`
`build-roadside-spots` `verify-road-network` `validate-road-keys`。

**视觉**：`ROAD_COLORS` 单一色板驱动编号徽标 / 地图线色 / 沿程标记三处（PRD §11.2）；三档响应式 390/768/1440。

**诚实边界**（写进 UI 与数据）：OSM 众包估算、非导航依据；国道/高速名录为高置信子集非全量 301/278；
省道 unverified；多数已抓几何为部分段（verify-road-network 报告偏差）；景点库目标 3 万当前 1,035。

**验证**：`pnpm --filter @railvista/shared test`（174 用例全绿，新增 alongRoute/spotGrid 21 例）；
`pnpm build` 全仓通过；`/api/drive/*` 端到端 curl 见交付报告。

---

## [0.3.1] — 2026-10-01

**自驾导航整合进主程序**（PATCH，修复 v0.3.0 的整合遗漏）。

### 1. 问题

- v0.3.0 的 `AppNavLinks` 只在 3 个 drive 页面里手动注入 `#nav` slot，主程序首页 `SelectTrip.vue` 用的是自闭合 `<AppTopBar />`——**首页看不到自驾入口**；
- 且顶栏导航在移动端（<600px）被 `display:none`——手机竖屏完全无法进入自驾模块。

### 2. 修复

- `AppTopBar.vue`：导航改为**默认内容**（`<slot name="nav"><AppNavLinks /></slot>`），所有使用顶栏的页面自动获得全站导航，页面仍可用具名 slot 覆盖；首页零改动即获得入口；
- 移动端不再隐藏导航：缩小品牌与导航间距（`gap: var(--space-2)`），紧凑排列「行程 / 自驾 / 全国地图」；
- 3 个 drive 页面移除手动注入（改为 `<AppTopBar />`），避免与默认内容重复。

### 3. 验证

- `drive-probe` 实测首页 390 / 768 / 1440 三断点：`navLinks = [行程(/), 自驾(/drive), 全国地图(/atlas)]`，`overflowX=false`，无折行；
- 截图 `tmp/ui/home-full-390.png`：移动端顶栏可见三链接，当前项带光感滑块；
- `vue-tsc` 0 错误、`pnpm build` 通过（gzip 136.9KB，增量可忽略）。

---

## [0.3.0] — 2026-10-01

**万里路书 · 精品自驾公路（MINOR，新增能力模块）**（分支 `heyworldchannel-20261001`）。

对标交通运输部《精品自驾旅游公路实施方案》（交公路发〔2026〕100号），新增并列于铁路工具的自驾模块，本版以**青甘环线 G315 柴达木段（水上雅丹）为真实 OSM 数据打样**，打通「路书 + 小确幸雷达 + 轨迹记录」闭环。

### 1. 新增能力

- **共享逻辑层**（`packages/shared/src/drive/*`，零框架依赖，Web/鸿蒙共用）：
  - `geo.ts`：Haversine、折线投影（里程桩/偏离距离/切向角）、行驶方向判定、左右侧判定（叉积）、Douglas-Peucker 简化
  - `radar.ts`：小确幸雷达——车速感知（>80 只推「值得减速」、<40 只推「可以停车」、40~80 都推）、前瞻距离随车速伸缩、错过检测
  - `trackSampler.ts`：轨迹关键点采样（起点/途经/停留/打卡/章节/终点，只存关键点省电省流量）
- **数据基座**：`scripts/build-drive-route.mjs` 按 OSM `ref` 抓取国道（多实例故障转移 + 缓存）→ 端点最近邻双向成链 → DP 简化 → 生成线路 JSON + `_index.json`
- **后端**：`/api/drive/routes`、`/api/drive/routes/:id`、`/api/drive/stats`（列表只读 `_index.json`）
- **前端**：新增 `/drive`（线路大厅）、`/drive/:routeId`（路书翻阅）、`/drive/:routeId/nav`（伴随雷达）三页；`AppTopBar` 新增 `nav` slot + `AppNavLinks` 导航链接组

### 2. 涉及文件

- 共享：`packages/shared/src/types.ts`（追加 DriveRoute/RoadbookChapter/DriveHighlight/RoadStory/RoadAlert/DriveTrack/RadarResult 等）、`drive/*`、`index.ts`
- 后端：`apps/api/src/services/driveRoutes.ts`、`routes/drive.ts`、`index.ts`
- 前端：`apps/web/src/pages/Drive{Home,Roadbook,Nav}.vue`、`components/AppNavLinks.vue`、`components/AppTopBar.vue`、`composables/useDriveRadar.ts`、`useTrackRecorder.ts`、`data/highlightColors.ts`、`styles/drive.css`、`api/client.ts`、`router/index.ts`
- 数据：`data/presets/drive-routes/*`、`data/cache/drive/*`

### 3. 验证方式

- 单测：`packages/shared` 新增 `drive/radar.test.ts` + `drive/trackSampler.test.ts`（投影/方向/左右侧/雷达车速规则/采样阈值），总计 153 用例全绿
- 构建：`pnpm build` 全仓通过；`vue-tsc --noEmit` 0 错误
- 数据：`node scripts/build-drive-route.mjs` 抓取真实 G315（水上雅丹段）成链 151.6km、3 章节、3 小确幸贴线 <5.3km

### 4. 已知限制

- OSM 国道 `ref` 标签不连续（几十~上百公里缺口），本版聚焦 G315 连续段打样；全线成链需阶段 B 断点补全（见 `docs/PRD-万里路书-精品自驾公路-20261001.md` §5.6）
- 里程与小确幸坐标待官方线路表发布后校准；鸿蒙端（M6）尚未实现
- 回滚：`git revert` 本提交即可，无破坏性变更

---

## [0.2.6] — 2026-09-29

**前缀键盘中文名单行修复 + 空输入高亮修正**（分支 `feat/ui-rebuild-20260928`）。

### 1. 中文名强制单行

- **问题**：窄屏下键内「字母块 + 中文名 + 英文名」同行 flex 排列，空间不足时中文名（flex 子项）被压缩折行成两行。
- **修复**：`.code-prefix__name strong` 加 `flex-shrink: 0` + `white-space: nowrap`（中文名绝不换行、绝不压缩），空间不足由英文名（`flex: 0 1 auto` + ellipsis）截断让位。
- **验证**：UI 探针在 390×844（3 列）与 1440×900 下实测 10 个键中文名高度均 14px 单行。

### 2. 空输入不高亮任何键

- **问题**：`aria-pressed` 用 `(codeQuery[0] || '').toUpperCase() === p.key` 判定，输入为空时 `'' === ''` 恒真，导致「普速」键被误高亮。
- **修复**：新增 `activePrefixKey` 计算属性——仅当输入非空时才命中（空输入返回 null）；模板改用它判定。
- **涉及**：`apps/web/src/pages/SelectTrip.vue`、`apps/web/src/styles/base.css`。

---

## [0.2.5] — 2026-09-28

**车次前缀专属色 + 键盘排版优化**（分支 `feat/ui-rebuild-20260928`）。

### 1. 每类车次一个专属颜色（前缀键盘 ↔ 车次列表对应）

- 新增 `TRAIN_COLORS` 色板：G 高铁蓝 `#4d9fff` / D 动车青绿 `#35c2a5` / C 城际青蓝 `#7fb4d8` / Z 直达紫 `#9d8cf0` / T 特快橙 `#e0915a` / K 快速黄绿 `#74bd89` / L 临客灰蓝 `#8a97a8` / S 市郊天蓝 `#6aa9f0` / Y 旅游品红 `#e5769f` / 纯数字普速灰 `#a3aebd`。
- **前缀键盘**：字母色块改为 `color-mix(var(--prefix-color) 16%)` 底 + `--prefix-color` 字色，每键一色。
- **车次列表**：`train-card` 增加 `--train-color`（由 `trainColor(trainCode)` 计算），左侧 3px 色条与车次号文字同步染对应色，与键盘字母**同色对应**；无变量时回退旧分组语义（hsr 蓝 / intercity 青 / 其余灰）。
- **涉及**：`apps/web/src/pages/SelectTrip.vue`（`TRAIN_COLORS` / `trainColor` + 模板内联变量）、`apps/web/src/styles/base.css`（`.code-prefix__letter` / `.train-card::before` / `.train-card__code`）。

### 2. 键盘排版优化

- Z 中文名「直达特快」→「直达」（更简洁）；键帽更紧凑整齐：网格列宽 88→96px、键高 44→42px、字母色块 26→22px、英文名改 10px 并改为「中文名 + 英文名」基线同行排列（`flex` + `baseline`），视觉上更小更齐。

### 验证

- `vue-tsc --noEmit` 通过；UI 探针实测 10 个前缀键 `--prefix-color` 各不相同且与色板一致；`pnpm build` 通过。

---

## [0.2.4] — 2026-09-28

**车次号前缀键盘**（分支 `feat/ui-rebuild-20260928`）。

### 1. 新增车次类型前缀快捷键盘

- **需求**：车次号首字母类型多（G/D/C/Z/T/K/L/S/Y），还有无字母的纯数字普速车，用户不一定记得全；输入前给出可点选的类型键盘。
- **实现**：「或按车次号直达」输入框下方新增一排前缀胶囊（auto-fill 网格，窄屏 3 列 / 宽屏更多列），每键包含**字母色块 + 中文名 + 英文名**：
  - G 高铁 High-speed / D 动车 EMU / C 城际 Intercity（蓝/青色块，与车次卡类型色一致）
  - Z 直达特快 Direct / T 特快 Express / K 快速 Fast / L 临客 Temp / `#` 普速 Regular（中性色块）
  - S 市郊 Suburban / Y 旅游 Tourist
- **交互**：点击即**替换车次号首字母并保留已输数字**（输 `8991` 点 G → `G8991`，再点 Z → `Z8991`，点 `#` → `8991`）；当前输入首字母对应的键以 `aria-pressed` 高亮。
- **涉及**：`apps/web/src/pages/SelectTrip.vue`（`codePrefixes` / `applyPrefix` + 模板）、`apps/web/src/styles/base.css`（`.code-prefix*`）。

### 验证

- `vue-tsc --noEmit` 通过；UI 探针实测 10 个键渲染齐全（中英文标注正确）、三步替换交互（8991→G8991→Z8991→8991）全部符合预期；竖屏截图确认窄列下无英文截断。

---

## [0.2.3] — 2026-09-28

**导航栏融入页面 + 品牌标识加大**（分支 `feat/ui-rebuild-20260928`）。

### 1. 品牌标识加大

- 顶栏 Logo 高度 28px → **34px**，在 48/56/64 三档栏高内均有足够余量；删去基线光学校正（Logo 改为垂直居中对齐，不再依赖 baseline nudge）。
- **涉及**：`apps/web/src/components/AppTopBar.vue`。

### 2. 导航条与主页面融为一体

- **去掉底部描边**：不再有横贯全宽的分隔线。
- **背景更淡**：渐变玻璃由 0.82→0.34 改为 0.5 → 0.24 → **0（底部完全透明）**，模糊降到 10px——顶栏像悬浮在页面/地图之上，而非一块独立的条。
- **滚动反馈改为"轻托底"**：滚过 8px 后仅加深到 0.66→0（依旧无硬边框），保证 Logo 可辨的同时不破坏融合感。
- **版本徽标弱化**：去掉边框盒，改为弱化小字（`--text-3` + 75% 不透明度），减少导航条的"框"感；同步清理已无引用的 `.appbar__tagline` 样式与 560px 断点。
- **涉及**：`apps/web/src/components/AppTopBar.vue`。

### 验证

- `vue-tsc --noEmit` 通过；UI 探针桌面（1440×900）与竖屏（390×844）截图复核：Logo 清晰放大、顶栏无边框且与背景地图自然融合。

---

## [0.2.2] — 2026-09-28

**背景地图铺满 + 玻璃透明度再降 + 渐变顶栏 + 输入框/动效优化**（鸿蒙展示类设计规范，分支 `feat/ui-rebuild-20260928`）。

### 1. 背景中国地图铺满全屏（竖屏/横屏一致）

- **需求**：地图不再"锚定在卡片下方一角"，而是任何屏幕比例下都铺满整个视口。
- **方案**：`.backdrop__stage` 改为覆盖式缩放——宽 `120vmax` 中心锚定视口中部，宽高均 ≥ 视口，溢出被 `overflow:hidden` 裁掉；极窄竖屏（`max-aspect-ratio: 3/4`）用 `150vw` 兜底、短视口横屏用 `150vh` 保证纵向铺满；遮罩改为 `ellipse 100% at 50%`、55% 后渐隐，四角柔和淡出。
- **涉及**：`apps/web/src/components/ChinaBackdropMap.vue`。

### 2. 卡片透明度再降低（鸿蒙沉浸光感玻璃）

- 表面 L1–L3 alpha：0.78/0.72/0.82 → **0.62/0.55/0.66**；sunken 0.85→0.68、scrim 0.72→0.6；描边全线再降（hairline .045→.04、default .07→.06、strong .11→.10、accent .32→.28）。
- 玻璃参数同步加强：`--glass-blur` 20→26px、`--glass-saturate` 1.35→1.5、tile 档 12→16px，保证更透的同时内容对比度不塌。
- **涉及**：`apps/web/src/styles/tokens.css`。

### 3. 顶部导航栏改渐变半透明（鸿蒙展示类规范）

- 由单色 rgba + color-mix 改为**纵向渐变玻璃**：顶部 0.82 → 中部 0.55 → 底部 0.34，模糊/饱和提升到全局 `--glass-blur/--glass-saturate` 档；新增 `.is-scrolled` 滚动态（滚过 8px 后加深为 0.92→0.5），内容从栏下穿过时保持可读。
- **涉及**：`apps/web/src/components/AppTopBar.vue`（含滚动监听）。

### 4. 输入文本框优化

- 输入框/下拉获得玻璃质感（tile 档 backdrop-filter）；新增占位符色（`--text-3`）；焦点态由"实线描边"升级为"强调描边 + 外发光"（`0 0 0 3px accent-soft` + 16px 蓝色柔光）；过渡补齐 box-shadow。
- **涉及**：`apps/web/src/styles/base.css`（`.select-form input` / `.od-panel select`）。

### 5. 组件入场动效统一（鸿蒙展示类：强调缓动 + 级联错峰）

- 新增 `rv-card-in` 关键帧（上浮 14px + 0.99 缩放 + 强调缓动），所有 `.rv-card` 统一入场；栅格主栏卡片按 DOM 序 20/70/120/170ms 级联、侧栏 100ms，避免整屏同帧弹出；`prefers-reduced-motion` 下仍全局禁用动画。
- **涉及**：`apps/web/src/styles/base.css`。

### HarmonyOS Developer Knowledge MCP

- `~/.workbuddy/mcp.json` 已注册 `harmonyos_developer_knowledge`（http, connect-api.cloud.huawei.com）；本环境直接对端点完成 MCP `initialize` 握手验证（返回 `DeveloperCommunity` v1.0.0，工具 `searchDocuments` / `getDocumentsById` 就绪），连接正常。

### 验证

- `vue-tsc --noEmit` 通过；UI 探针三断点（1440×900 / 390×844 / 844×390）截图复核：地图铺满、玻璃通透、渐变顶栏、输入框质感全部生效。

---

## [0.2.1] — 2026-09-28

**按车次号直达查询 + 最近访问折叠收纳**（分支 `feat/ui-rebuild-20260928`）。

### 1. 新功能：按车次号搜索

- **动机**：用户已知车次时，OD 两步查询多余；直接输车次号进时刻表再选上下车站更快。
- **后端**：新增 `GET /api/trains/by-code?code=Z8991&date=2026-10-20`，数据源为 12306 公开搜索服务（`search.12306.cn/search/v1/train/search`，无需 kyfw 会话）；返回行即全程经停序列（含内部 `train_no`），解析规则与 `getStops` 一致（`----`→null、首末站类型、本地坐标补全、`attachAbsoluteTimes`）；带缓存 + 负缓存（`bycode:` 键）；车次号格式校验（`BAD_CODE`）与未查到（`NOT_FOUND` → 404）分级。
- **前端**：查询表单底部新增次级入口「或按车次号直达」（细分隔线 + 单行输入 + 查时刻按钮，复用同一乘车日期字段）；回车/点击后跳过 OD 查询直接进「确认上下车站」，默认上下车站为始发/终到，OD 输入框同步为首末站（保证「重新发车」与预设轨道匹配链路一致）。
- **涉及**：`apps/api/src/services/cr12306.ts`（`queryByCode`/`fetchByCode`）、`apps/api/src/routes/trains.ts`（`/by-code`）、`apps/web/src/api/client.ts`（`searchTrainByCode`）、`apps/web/src/pages/SelectTrip.vue`（`searchByCode` + 模板）、`apps/web/src/styles/base.css`（`.code-search`）。
- **已知限制**：车次号需按乘车日存在且为公开车次号（如 Z8991/G87），不支持站内模糊匹配。

### 2. 最近访问折叠收纳（推翻 0.2.0 反馈轮的"竖屏前置"方案）

- **需求变更**：用户明确"把最近访问折叠起来到查询直达车次下面"——0.2.0 反馈轮把竖屏最近访问用 `order:-1` 提到了表单之上，本版按新需求回退该方案（删除竖屏 order 覆盖），改为：**模块固定在查询表单下方，默认收起**，标题行即开关（44px 热区 + 数量徽标 + 箭头旋转指示），点击展开行程列表。
- **涉及**：`apps/web/src/pages/SelectTrip.vue`（折叠模板 + `recentOpen`）、`apps/web/src/styles/base.css`（`.recent-list__toggle/__count/__chevron/__body`，删除竖屏 order 块）。

### 验证

- `vue-tsc --noEmit` 通过；`pnpm build` 通过。
- `curl /api/trains/by-code?code=Z8991&date=...` 实测返回全程经停（含 trainNo）；UI 探针复核三断点布局与折叠交互。

---

## [0.2.0] — 2026-09-28

**主界面 UI 整体重构**（对应《docs/UI整体重构设计方案-20260928.md》全量实施，分支 `feat/ui-rebuild-20260928`）。

设计规范来源：HarmonyOS 官方设计规范（宇宙蓝主色 / 雪域灰表面 / 4·8·16·20·32 圆角档位 / 8vp 间距网格 / 200·250·300ms 转场分档）。

**数据文件零改动**：`data/**` 未触碰（背景地图的资源由构建期脚本从高德行政区划接口一次性生成）。

### 1. 修复：滚动链（P0）

- **根因**：`styles/map.css` 给 `html, body` 全局加了 `height:100% + overflow:hidden`（地图页需要），而 `base.css` 首行 `@import './map.css'` 使该锁污染所有页面 → `document.scrollingElement`（恒为 html）被锁死，键盘滚动（PageDown/Space/Home/End）全部失效；此前鼠标滚轮能用，纯靠 `body:has(.select-page){overflow:auto}` 歪打正着。
- **修复**：锁收回到按页路由（`html:has(.trip-page)` / `html:has(.atlas-page)`），选行程页与线路详情页回归「文档流 + document 单一滚动容器」。
- **验证**：`scripts/ui-probe.mjs`（CDP 真实输入事件）五档断点全部通过：滚轮 +646~1500、键盘 PageDown +682~1453；`/trip` `/atlas` 仍全屏锁定不回归。
- **涉及**：`apps/web/src/styles/map.css`、`base.css`。

### 2. 设计令牌重写（tokens.css）

- 配色转向鸿蒙风格中性灰蓝：表面四级雪域灰（`#0b0e14 → #222b38`）+ 宇宙蓝主色（`#4d9fff`）；语义色统一降饱和（30–60%）；清理全部硬编码冷蓝（`#07101c`/`#152033`/`rgba(14,165,233)` 等）。
- 圆角对齐 HarmonyOS 官方档位（4/8/16/20/32），层级正相关（弹窗 > 按钮 > 卡片 > 列表行）；修复「卡片 16 > 按钮 10」的反向层级。
- 间距收敛到 8px 基线；模块标题统一为单一字号档（17px）；动效时长改 200/250/300 分档。
- 保留兼容别名（`--bg-base` → `--surface-0` 等）一个版本，未参与本轮重构的地图页组件平滑过渡。
- **连带修复**：`TripMap.vue` 轨道线曾硬编码旧品牌金，而图例用 `var(--accent)`，主题变色后两者会脱节——改为运行时读令牌（`--rail` / `--accent-hover`），图例与线路永久同色。

### 3. 栅格与响应式（base.css 重写）

- 引入 `.rv-shell` 单一页面容器 + 12 列栅格（`.rv-grid` / `.rv-col--main` 7 列 / `.rv-col--side` 5 列）：所有模块收进同一容器，左基线从「333/373/433 四条」收敛为**完全重合**（实测差值 0）。
- 断点矩阵：sm(<600) 单列 / md(≥600) 双栏 / lg(≥840) 双栏+主栏 sticky / xl(≥1200) 收窄 1120px；短视口横屏（`orientation:landscape and max-height:560px`）压缩顶栏、OD 输入框并排、首屏完整可见查询区（实测占用 380/390）。
- `min-width:0` + 栅格比例自适应，杜绝堆叠溢出（五档断点实测无横向溢出）。

### 4. 顶部导航栏 + Logo 重做

- 新增 `AppTopBar.vue`：sticky 吸顶毛玻璃；高度按断点 48/56/64；Logo 与版本徽标基线对齐（含光学校正）。
- `BrandLogo.vue` 按用户要求改为**直接使用官方品牌组合图**（`assets/heyworld-brand.png`，图形+中英文字标一体），不再自绘；顶栏移除冗余副标题。
- hero 移除 Logo 后高度 135px → 68px（桌面）/ 193px → 60px（竖屏）。

### 5. 背景中国地图（离线静态，零运行时请求）

- 新增 `scripts/build-china-backdrop.mjs`：构建期经 dev server 复用已配置的高德 key 抓取国界（含台湾省、南海诸岛、海南岛全部岛屿环），Douglas-Peucker 简化 + Web Mercator 投影，冻结为 `assets/china-outline.svg`（65KB / gzip 22KB，291 环）+ `data/chinaBackdrop.ts`（432 个全国铁路景点热力点，复用 `data/presets/scenic-spots.json`）。
- 新增 `ChinaBackdropMap.vue`：轮廓 `?raw` **内联进 JS 包**，运行时不发起任何网络请求、不依赖在线地图服务；Canvas 热力层（DPR 感知、空间分桶加速近邻查询）；指针移入径向高光跟随 + 附近景点光点亮起（rAF 合帧，仅写 CSS 变量）；整体不透明度约 8% 感知亮度配平，前景卡片为不透明表面，正文对比度不受影响。
- **合规**：数据源为高德（白名单服务商）；轮廓含台湾省、南海诸岛环（生成脚本输出明示需人工校核后提交）；无境外瓦片。
- **降级**：触屏（无 hover）与 `prefers-reduced-motion` 下只渲染静态底图。

### 6. DeepSeek 式悬停三件套

- 新增 `composables/usePointerSpotlight.ts`：事件委托 + rAF 合帧，把指针位置写入 `--mx/--my/--mx-line`。
- `.rv-card` / `.rv-tile` 悬停：跟随光晕（强度由 `--glow-radius` / `--glow-alpha` 令牌驱动）+ 顶部高光带横向流转 + 微缩放（`translateY(-2px) scale(1.006)` 弹性曲线）+ 描边渐显。
- 全部包在 `@media (hover:hover) and (pointer:fine)` 内，触屏无 hover 残留；`prefers-reduced-motion` 下禁用。

### 7. 排行榜模块对齐

- `RankingsSection.vue` 进 `.rv-col--side`，宽度/左基线由栅格决定；全部样式改语义令牌；修两处退化渐变（`linear-gradient(a,a)`）；Tab/关注行触控热区补齐到 44px（伪元素扩展，视觉尺寸不变）。

### 8. 首轮评审反馈修正（8 项）

1. **Logo**：改用官方品牌组合图直接渲染（见第 4 节）。
2. **横屏 hero 下方两模块美化**：榜单胶囊 Tab 由「折行 3–4 行」改为**单行横向滚动**（隐藏滚动条、胶囊不压缩）；「全国铁路景点地图」入口升级为渐变玻璃主入口（宇宙蓝→紫渐变 + 同心圆航线装饰 + 箭头胶囊 + 指针光晕）。
3. **竖屏没有「最近访问」**：实际有渲染但排在高表单之后被挤出首屏。竖屏（<600px）用 grid `order` 把条目顺序调为「当前行程 → 最近访问 → 查询表单」，高频的「继续上次行程」直接出现在标题下方（种子数据实测 top=140、首屏内）。
4. **沉浸光感升级为全局设置并增强**：`tokens.css` 新增 `--glass-blur/--glass-saturate/--glow-radius/--glow-alpha`（含 tile 档）令牌；一级卡片与二/三级条目（`.recent-card`/`.train-card`/`.rank-card`/`.rank-row`/`.atlas-entry`）统一「半透明表面 + 指针跟随光晕」，`usePointerSpotlight` 改为「最近匹配」命中条目本身；光晕半径 320px→460px、峰值透明度 0.07→0.13，并叠加宇宙蓝色第二层光晕。
5. **框体透明度降低**：表面 L1–L3 改半透明（`rgba(19,24,32,.78)` 等），卡片/条目加 `backdrop-filter` 玻璃模糊；描边不透明度整体下调（hairline .06→.045、default .1→.07、strong .16→.11、accent .42→.32）。
6. **背景中国地图更明显**：`--backdrop-map-opacity` 0.3→0.48，热力层系数 0.6→0.75，桌面舞台放大（52vw/620px→56vw/700px）；配合半透明玻璃卡片，地图从卡下透出。
7. **横屏日期面板被「最近访问」盖住**：两层修复——① 表单卡含打开面板（`.dtf--open` / 站名建议）时整卡提升 `z-index:30`（`.rv-card` 的 `isolation` 使相邻卡按 DOM 序绘制，必须整卡抬层）；② 短视口横屏面板改**向上弹出**并紧凑化日历（收起冗余「当前选择」条、日格 26px→20px），390px 高视口实测面板 top=6 / bottom=249 完整可见可交互。
8. 以上全部落在 `feat/ui-rebuild-20260928` 分支。

### 涉及文件清单

| 文件 | 类型 |
| --- | --- |
| `apps/web/src/styles/tokens.css` | 重写（设计令牌） |
| `apps/web/src/styles/base.css` | 重写（栅格+组件系统） |
| `apps/web/src/styles/map.css` | 修改（滚动锁按页收回） |
| `apps/web/src/pages/SelectTrip.vue` | 重构（双栏栅格） |
| `apps/web/src/pages/TripMap.vue` | 修改（轨道线读令牌） |
| `apps/web/src/components/AppTopBar.vue` | **新增** |
| `apps/web/src/components/ChinaBackdropMap.vue` | **新增** |
| `apps/web/src/components/BrandLogo.vue` | 重写（官方品牌图直出） |
| `apps/web/src/components/DarkDateTimeField.vue` | 修改（横屏面板上弹 + 紧凑日历） |
| `apps/web/src/components/rankings/RankingsSection.vue` | 修改（令牌对齐 + Tab 单行滚动 + 地图入口美化） |
| `apps/web/src/composables/usePointerSpotlight.ts` | **新增** |
| `apps/web/src/assets/china-outline.svg` | **新增**（构建期生成） |
| `apps/web/src/data/chinaBackdrop.ts` | **新增**（构建期生成） |
| `scripts/build-china-backdrop.mjs` | **新增**（构建工具） |
| `scripts/ui-probe.mjs` | **新增**（UI 回归探针） |
| `packages/shared/src/version.ts`、各 `package.json`、本文件 | 版本 0.2.0 |

### 验证

- `pnpm --filter @railvista/web exec vue-tsc --noEmit` 通过；`pnpm build` 全量通过（web 产物 128.7KB gzip，含内联地图与热力数据）。
- UI 探针五档断点（390×844 / 844×390 / 834×1112 / 1440×900 / 1920×1080）：滚动（滚轮+键盘）全部恢复；左基线差值 0；无横向溢出；横屏首屏完整可见查询区。
- 四路由回归：`/`（双栏+背景地图）、`/trip`（全屏锁定+轨道线换色后与图例一致）、`/route/:id`（文档流滚动）、`/atlas`（全屏锁定）。
- 基线数据与截图存于 `docs/ui-rebuild-20260928/`。

### 已知限制

- `assets/china-outline.svg` 的边界画法生成后需一次人工校核（台湾省/南海诸岛/藏南/钓鱼岛）方可发布——本次已核对轮廓含台湾岛、海南岛与南海诸岛环，发布前建议再走一次人工确认。
- `tokens.css` 兼容别名将在下一版本移除，届时未迁移的地图页组件需改用语义令牌。

---

## [0.1.3] — 2026-09-28

本次同时落地两项需求（对应两份需求文档）：

- 《精准路线生成-性能加速与景点刷新修复及UI改版报告-20260927.md》→ 下面第 1、2 部分
- 《RailVista主页改版_AI生成指令_20260927.md》→ 下面第 3 部分

**数据文件零改动**：`git status` 不出现 `data/` 变更，`data/presets/**`、`data/rails/**`、
`data/stations-geo.json` 均未触碰。

---

### 需求一 A：精准路线生成性能加速

改动动机：整程 Overpass 串行试镜像最长约 75s、段结果只在内存里（重启即失）、
每次轮询都重算一次景点匹配（14ms~183ms/次，随点数增长）阻塞事件循环。

| 项 | 改动 | 涉及文件 |
| --- | --- | --- |
| F1 | Overpass 改为**多镜像并发竞速**：单请求 10s 超时、整程总预算 12s、镜像错峰 1.2s 发车，首个非空结果即胜出并 abort 其余；全失败且曾拿到空结果时返回空而非报错 | `apps/api/src/services/osmRailway.ts`（新增 `raceOverpass` / `overpassHost` / `sleep`） |
| F1 | way 抓取由「串行 + 每段 sleep 200ms」改为**有界并发池**（默认 3） | 同上（新增 `runPool`） |
| F2 | 段几何**落盘缓存** `data/cache/railseg/`（已 gitignore）：命中/负结果分别持久化，负结果按原因分级 TTL（超时/网络/5xx 45s，其余 20min），避免瞬时故障被长时间缓存 | 新增 `apps/api/src/services/segmentCache.ts` |
| F2 | 空闲**热门 OD 预热**（默认仅本地库、不访问公共 Overpass、不写负缓存） | 新增 `apps/api/src/services/segmentPrewarm.ts`，`apps/api/src/index.ts` 注册 |
| F3 | `snapshot()` 的景点匹配按 job **记忆化**（折线签名不变则复用，含耗时统计），消除轮询期的重复计算 | `apps/api/src/services/railGeometryJob.ts`（`SpotMemo` / `coordsSignature` / `jobScenicSpots`） |
| F4 | Overpass 查询 **in-flight 去重**（sha1(query+镜像数) 为键），并发同查询只发一次网络请求 | `apps/api/src/services/osmRailway.ts` |
| 附带 | `buildAdj` 由 O(W²) 两两比对改为**空间网格分桶**（3×3 邻域，语义与连边结果不变）；`acceptSegmentGeometry` 去掉 `Math.min(...arr)` 展开（大数组有爆栈风险） | 同上 |

### 需求一 B：景点刷新修复（刷新结果稳定、交互无异常）

| 缺陷 | 根因 | 修复 |
| --- | --- | --- |
| B1 折线刷新了、景点标记不刷新 | `TripMap.vue` 景点标记只在 `initMap()` 里构建一次，没有 watch | 抽出 `buildSpotMarker()` / `rebuildSpotMarkers()`，并新增对 `trip.scenicSpots`（id+side+progress 签名）的 watch；`onPreciseRefresh()` 统一在刷新后重建标记 |
| B2 景点只会越刷越少 | `tripStore.applyPreciseCoords()` 拿**旧的**景点集去过滤**新的**折线 | 新增 `spotLibrary`（景点全集累积，按 id 合并，后写覆盖）：应用精准坐标时从**全集重算**，景点既能增加也能减少；确实只能走降级路径时置 `spotsStale=true` 并在面板提示 |
| U1 精度状态只有一个拥挤的小按钮 | 旧 `.status-actions` 按钮承载了全部状态 | 新增 `apps/web/src/components/PreciseRoutePanel.vue`：`idle/queued/running/bridging/done/partial/failed/offline` 状态机 + 已耗时（>8s 视为慢）+ 进度条 + 数据来源 + 完成后折叠为一行摘要 + **进行中可取消** |

取消链路端到端打通：面板 ✕ → `tripStore.cancelPrecise()` → `api.abandonRailGeometryJob()`
→ `POST /api/rail-geometry/jobs/:id/abandon` → `abandonRailGeometryJob()`。

### 需求二：主页排行榜改造 + 线路详情页 + 全国铁路景点地图

- 新增 `apps/web/src/data/beautifulRailings.ts`：4 个榜单（世界旅游轨道大会票选 / 新华网专题 /
  国铁官媒 / 编辑精选），逐条核对 `corridorId`；`null` 表示仓库暂无该线路几何。
  **关于「按搜索量排名」**：前端拿不到真实全网搜索量，**不伪造热度**，本期用 localStorage
  「我的关注」本机点击计数 + `Ranking.rankingType` 扩展位，后续接真实统计只需替换 `readFocusCounts`。
- 新增 `apps/web/src/components/rankings/RankingsSection.vue` 并挂到主页（`SelectTrip.vue`，
  仅在无查询结果时展示）：胶囊 Tab（200ms 淡入/位移）、前三名金/银/铜大卡、第 4 名起紧凑列表行、
  无线路条目弱化且不跳转、来源脚注外链。
- 新增 `apps/web/src/pages/RouteDetail.vue`（`/route/:corridorId`，支持 `?from=&to=`）：
  头部（起讫徽章 / 里程 / 通车年 / 所属榜单徽章）→ 高德静态小地图（走廊折线 + `fitView`，
  from/to 走「最近顶点投影 + 索引区间」粗略切片，**仅展示、不落盘**）→ 景点按六维分组（按 alongKm 排序）
  → 「进入实时地图」（回首页预填 OD）/ 青藏线额外「Z8991 演示」按钮。
- 新增 `apps/web/src/pages/AtlasMap.vue`（`/atlas`）+ `apps/api/src/routes/atlas.ts`（**只读聚合**，
  照抄 `presets.ts` 的 readFileSync 模式，不改任何数据文件）：
  - `GET /api/atlas/overview`：248 条走廊（折线等距抽稀 ≤300 点）+ 432 处景点 + 归属统计，60s 缓存；
  - `GET /api/atlas/corridor/:id`：单条完整折线 + 沿线景点（含沿线里程/离距）。
  - 图层：L1 全量铁路网（细银灰、只响应 click）→ L2 景点 MarkerCluster 聚合（按六维着色，图例在侧栏）
    → L3 AMap HeatMap 可开关 → L4 选中走廊加粗高亮 + fitView、点景点弹 InfoWindow。
  - 侧栏可折叠：搜索（线路/景点）、六维多选筛选、沿线景点最多 Top10、排行榜快捷入口。
  - 插件（MarkerCluster / HeatMap）加载失败自动降级为普通 Marker 并隐藏热力开关。
- 新增 `apps/web/src/data/spotDimensions.ts`：六维展示元数据（颜色/短标签），两个页面共用。
- 改 `apps/web/src/router/index.ts`：新增 `/route/:corridorId`、`/atlas` 两条路由。
- 改 `apps/web/src/pages/SelectTrip.vue`：`onMounted` 读取 `?from=&to=` 预填 OD（零回归，仅赋值）、
  `?demo=z8991` 触发既有演示链路。

### 验证

| 项 | 结果 |
| --- | --- |
| `pnpm --filter @railvista/shared build` | 通过 |
| `pnpm --filter @railvista/api build` | 通过 |
| `pnpm --filter @railvista/web build`（含 `vue-tsc --noEmit`） | 通过（仅既有 chunk 提示） |
| `pnpm test`（shared） | 25/25 通过 |
| api 单测（本次改动涉及的 4 个文件：osmRailway / railGeometryJob / preciseRouteCache / wholeTripGate） | 17/17 通过 |
| api 单测（corridors / scenicSpots） | 46 pass / 9 fail，**与改动前 HEAD 完全一致**（既有失败，未回归） |
| `node scripts/verify-corridor-geometry.mjs --strict` | `geom=0 (heavy+medium) seed=0` 通过；29 条 station hint 告警为既有数据问题（本次未改 `data/`），与 HEAD 一致 |
| `curl /api/atlas/overview` | `ok:true`，`corridorCount=248`、`spotCount=432`、`buildMs=89` |
| `curl /api/atlas/corridor/qingzang` | `ok:true`，2205 点折线、17 处景点含青海湖（186.8km）/察尔汗盐湖（675.4km） |
| `curl /api/atlas/corridor/not-exist-xxx` | `{"ok":false,"code":"NOT_FOUND"}`，前端走友好空态 |

### 已知限制 / 回滚

- 段缓存与负缓存落在 `data/cache/railseg/`（gitignore），删除该目录即回到纯内存行为。
- 热门预热默认 `RAIL_SEG_PREWARM_NETWORK=0`（只用本地库，不访问公共 Overpass）；
  设 `RAIL_SEG_PREWARM_DELAY_MS=-1` 可完全关闭预热。
- 景点↔线路归属：数据里有 `lines[].corridorId` 的以数据为准（`matchKind='line'`），
  其余按沿线距离推算（`matchKind='geo'`），页面上有「距离推算」标记，不是伪造的权威归属。
- 回滚：整体 revert 本 commit 即可，无数据迁移、无 schema 变更。

---

## [0.1.2] — 2026-09-27

修正 0.1.1 中两处**表达错误**（用户反馈）。

### 1. 地图标记不再按左右分色，改为统一配色

0.1.1 把地图上的景点点按左/右/两侧涂成蓝/橙/灰三色，实际效果是在地图上铺开一片
含义难辨的多色点阵，且颜色承载不了足够信息。现改为**统一使用景点色**：
左/右/两侧在地图上一视同仁，方位信息仅在点开详情后以徽标（`列车左侧` / `列车右侧` /
`两侧均可`）展示。唯一例外是虚线空心样式，代表「方位待人工复核」——它表达的是
数据质量问题，不是方位本身。

### 2. 「两侧均可」不再一律标为低置信度（本次反馈的核心问题）

0.1.1 把所有 `both` 一律打了 `low` 置信度并涂成灰色，导致一大片本来清晰的景点
看起来"不可信"。这是概念混淆：**`both` 是一个正常的、确定的方位结论，不等于「没把握」**。

修正后 `side`（方位结论）与 `confidence`（可信度）彻底解耦：

| 情形 | 0.1.1（错） | 0.1.2（修正后） |
| --- | --- | --- |
| 贴线通过（垂距 ≤0.3 km） | `both` + low + 灰 | **`both` + high** |
| 延展型景观（跨度 >10 km，河流/山脉/平原段落） | `both` + low + 灰 | **`both` + high** |
| 投影落到走廊端点外 | `both` + low + 灰 | **`unknown` + low + 需复核** |
| 常规左/右 | high | high |
| 几何与数据侧不一致（多为反向行驶） | low | **high**（仅记录原因，见下） |

配套修正：

- 「两侧均可但垂距 >8 km 降级为待确认」这条规则**删除**——看得清看不清是**可见性**
  问题（已由 `visibility` / `distKm` 表达），与**方位**的可信度是两件事，不该混为一谈。
- 「几何与数据侧冲突即降级为 low」**删除**——反向行驶本就会让几何结果与按走廊正方向
  存储的 `side` 相反，属正常现象；据此降级会把反向车次上的所有景点一律染成低置信度，
  制造大面积假告警。现仅在 `reason` 中记录「多为反向行驶，可核对」。
- `both` 徽标配色由灰色改为**青绿正向色**，与左（蓝）/ 右（橙）同等"可信"。

### 真实数据验证（248 走廊 × 432 景点，命中 819 次）

修正前后对照：

| 类别 | 0.1.1 | 0.1.2 |
| --- | --- | --- |
| `left/high` | 416 | **416** |
| `right/high` | 257 | **257** |
| `both/high` | 0 | **47** |
| `both/low` | 146 ❌ | **0** ✅ |
| `unknown/low`（真判断不了） | 0 | **99** |

即：原先 146 个被误标为「低置信度」的两侧景点中，47 个恢复为正常的 `both/high`，
99 个正确归入真正判断不了的 `unknown/low`（投影落在走廊覆盖范围外）。
包西线正/反向 11 条景点：左右互换一致率 11/11，且反向侧全部为 `high`（此前 8 条被误标 low）。

### 修改的文件

`packages/shared/src/schedule/spotSide.ts`（判定顺序与置信度语义重写）、
`packages/shared/src/spotSide.test.ts`（断言更新 + 新增回归保护用例）、
`apps/web/src/components/SideBadge.vue`（删除 bothButFar 降级、both 改青绿）、
`apps/web/src/pages/TripMap.vue`（标记不再分色、图例文案）、
`apps/web/src/styles/map.css`（删除左右/两侧着色，仅保留 unknown 虚线）、
`packages/shared/src/version.ts` 与四个 `package.json`（0.1.1 → 0.1.2）、`CHANGELOG.md`。

---

## [0.1.1] — 2026-09-28

### 改动动机

依据需求文档 `docs/scenic-supplement-20260928.md` 的 **§3（左右侧判定算法）** 与 **§4（UI 展示方案）**，
把"景点在列车左侧还是右侧"从**数据里写死的静态字段**，升级为**按本次车次实际行进方向实时计算**的能力，
并补齐资质荣誉标签的展示。此前 `data/presets/scenic-spots.json` 的 432 条景点中 421 条缺少 `side`，
即使少数带 `side` 的条目，也只在其所属走廊的"正方向"下成立，反向车次会左右颠倒。

### 算法实现（`packages/shared/src/schedule/spotSide.ts`，新增）

严格按需求 §3.1~§3.6 实现：

| 步骤 | 实现要点 |
| --- | --- |
| 1. 最近投影 | 遍历折线每一段求点到线段最近投影，取垂距最小者 |
| 2. 局部公里平面 | 纬度 `Ky = 110.574 km/°`，经度 `Kx = 111.320 × cos(latRef) km/°` |
| 3. 叉积定侧 | `cross = d.x × v.y − d.y × v.x`，`>0` 为左、`<0` 为右 |
| 4. 退化处理 | 垂距 ≤0.3 km、延展型景观（里程跨度 >10 km）、投影落到线路端点外 → `both` + 低置信度 + 需复核 |
| 5. 方向换算 | `sideRefDirection` 基准 → 本次车次方向；仅接受调用方显式传入的 `reversed`（未传视为同向） |

**关键陷阱（需求 §3.4）已在代码头注释中固化**：若直接对经纬度做叉积，`cross` 量纲是 `rad²`，
再与 km 阈值比较会导致**所有景点被误判为 `both`**。本实现统一换算到局部 ENU 公里平面，
并满足几何自检式 `|cross| / |d| == distKm`（已写成单元测试断言）。

**第二个陷阱（实现过程中由真实数据冒烟发现并修正）**：不得用「数据侧 `side` 与几何结果是否一致」
去反推是否需要翻面。那样会自我抵消——反向行驶时几何已翻面、与存储值不符，于是被判成"需翻转"又翻回来，
最终结果永远等于数据里的存储值，左右侧对行程方向完全失去敏感性。现策略为**几何优先**：
以「本次车次实际行进方向」的叉积结果为准；与数据侧冲突时只降级为 `low` 置信度并写入冲突原因，
交由人工复核，不强行翻面。修正前后对照（包西线正向/反向折线）：翻转一致率由 4/11 提升到 **11/11**。

### 新增能力清单

| 类别 | 内容 |
| --- | --- |
| 算法 | `projectSpotToLine()` 投影 + 叉积定侧；`flipSide()` / `applyDirection()` 左右互换；`isExtendedSpot()` 延展型识别；`resolveSpotSide()` 一体化求侧 |
| 类型 | `ScenicSpot` 新增 `honors`（资质荣誉标签）、`sideRuntime`、`sideConfidence`、`sideFlipped`、`sideNeedsReview`、`sideReason`、`alongKmFrom/To`、`matchedCorridorId`；`sideRefDirection` 由单一 `line_forward` 放宽为 `line_forward` / `up_direction` / `toward_xxx` |
| 字典 | `HONOR_LABELS`（20 种资质荣誉代码 → 中文标签）、`honorLabel()` / `honorLabels()` |
| UI 工具 | `SIDE_LABELS` / `SIDE_ARROWS` / `sideLabel()` / `sideArrow()`（← / → / ↔ / ?，文字+箭头而非仅靠颜色） |
| 邻近提示 | `approachWindow()` / `withinApproach()`，默认提前 5 km 进入、过境 2 km 后淡出 |
| 过滤接口 | `filterSpotsAlongRailway(spots, railway, options)` 第三参数新增 `{ reversed?, corridorId?, autoSide? }`；新增独立入口 `resolveSide(tripPolyline, spot, options)` |
| 前端组件 | `SideBadge.vue`（含列车截面半填充图形、翻转动画、低置信度虚线样式）、`SpotApproachCard.vue`（临近提示卡：名称/方位/最佳时段/距轨/资质/阻挡提示）、`AppVersionBadge.vue`（首页版本徽标） |
| 地图表达 | 景点标记按侧别着色（左蓝 / 右橙 / 两侧灰 / 待确认灰虚线空心），InfoWindow 增加方位标签、资质标签与低置信度标记；图例新增"车窗方位"分组 |

### 修改的文件

| 文件 | 改动 |
| --- | --- |
| `packages/shared/src/version.ts` | **新增**，版本号唯一来源（`APP_VERSION = '0.1.1'`） |
| `packages/shared/src/schedule/spotSide.ts` | **新增**，左右侧判定引擎 + 资质字典 + UI 文案 |
| `packages/shared/src/schedule/spotSide.test.ts` | **新增**，23 项断言（含量纲自检、反向翻转、三条退化规则、UI 文案、管线输出） |
| `packages/shared/src/types.ts` | 新增 `SpotRefDirection` / `SpotSideConfidence` 类型；`ScenicSpot` 扩展 `honors` 与运行时定侧字段 |
| `packages/shared/src/schedule/scenic.ts` | `filterSpotsAlongRailway` 走 km 平面投影并输出运行时方位；新增 `resolveSide()`；入参透传 `honors` |
| `packages/shared/src/index.ts` | 导出 `version.js` 与 `spotSide.js` |
| `packages/shared/package.json` | 版本 0.1.0 → 0.1.1；test 脚本纳入 `spotSide.test.ts` |
| `apps/api/src/services/scenicSpots.ts` | `matchScenicSpotsForRailway` 支持透传 `FilterSpotsOptions`（`reversed` / `corridorId` / `autoSide`） |
| `apps/web/src/components/SideBadge.vue` | **新增**，方位徽标 |
| `apps/web/src/components/SpotApproachCard.vue` | **新增**，临近提示卡 |
| `apps/web/src/components/AppVersionBadge.vue` | **新增**，首页版本号 |
| `apps/web/src/pages/TripMap.vue` | 接入方位着色、InfoWindow 方位/资质标签、图例方位分组、临近提示卡 |
| `apps/web/src/pages/SelectTrip.vue` | 首页 hero 区引入 `AppVersionBadge` |
| `apps/web/src/styles/map.css` | 新增侧别着色、InfoWindow 方位/资质标签、图例方位分组样式 |
| `apps/web/src/styles/base.css` | 首页版本徽标排布 |
| `package.json` / `apps/*/package.json` | 版本 0.1.0 → 0.1.1 |
| `CHANGELOG.md` | **新增**，本文件 |

### 验证方式

```bash
pnpm --filter @railvista/shared build     # 类型检查 + 构建通过
pnpm test                                 # 23 项断言全部通过
pnpm build                                # shared + api + web 全量构建
```

关键断言：

- `向东行驶时北侧 = left，南侧 = right`
- `同一景点，折线反向后左右互换`
- `几何优先于数据侧：反向行驶即使数据侧存在也必须翻面`（防止上文第二个陷阱回归）
- `|cross| / |d| == distKm`（量纲自检，容差 0.1 km）
- `贴线 / 延展型 / 端点外` 三种退化均产出 `both` + `low`
- `filterSpotsAlongRailway` 输出 `sideRuntime`，反向输入整体互换

真实数据冒烟（248 条走廊 × 432 条景点）：

- 命中 819 次，分布 左 416 / 右 257 / 两侧 146 / 待确认 0；低置信度 146、需人工复核 99
- 包西线 11 条 v3 景点正向/反向对照，左右互换一致率 11/11

### 已知限制 / 后续待办

1. 现网 432 条景点中仅 11 条具备完整 v3 字段，`alongKm*` 里程区间多数缺失，临近提示卡目前以 `progressKm`（沿本次行程折线）单点为窗口基准，未按 `alongKmFrom ~ alongKmTo` 展开；待 `docs/scenic-supplement-20260928.md` §7 的批量升级完成后再切换。
2. `reversed` 需调用方显式传入（当前全链路默认按"行程折线方向 == 存储基准方向"处理）；与数据侧冲突时会降级为低置信度，待走廊正方向 → 车次方向映射表补齐后可精确给定。
3. 数据文件中 `honors` 尚未批量写入，UI 目前无数据时自动隐藏资质行。
4. 回滚方式：本版本全部改动集中在新增文件与新增可选字段，`autoSide: false` 即可关闭自动定侧退回旧行为；删除 `SpotApproachCard` 挂载点即可恢复旧版底栏。

---

## [0.1.0] — 2026-09（基线）

首个可运行版本：pnpm 单仓三包结构（`apps/web` + `apps/api` + `packages/shared`），
行程选择 → 车次/经停 → 行程地图（进度估算、站点校准、精准路线 7 级降级链）→ 沿线景点，
以及此前的诊断与规划文档：

- `docs/national-rail-coverage-plan-20260925.md` — 全国路线覆盖问题诊断报告
- `docs/route-fix-plan-20260926.md` — 六个具体失败案例定位与改造步骤
- `docs/scenic-schema-v3.md` — 景点数据 v3 字段规范
- `docs/scenic-ai-generation-plan.md` — 景点补齐/审查的 AI 生成方案
- `docs/prompts/scenic-spots-generate.md` — 可直接使用 AI 生成提示词
- `docs/scenic-supplement-20260928.md` — 沿线景点补充清单（含左右侧算法与 UI 设计，本次实现的依据）
