# RailVista 变更说明（CHANGELOG）

> 本文件位于仓库根目录，是**唯一的变更记录入口**。
> 所有版本历史、改动内容与版本号都在这里维护。

**当前版本：`0.6.3`**（2026-10-03）

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

## [0.6.3] — 2026-10-03

**全国地图侧栏修复与增强 + 公路详情页侧栏重做**（分支 `heyworldchannel-20261002`）。

### M1 地图"一直加载、统计全 0"的真正根因（v0.6.2 判断有误，这里更正）

- v0.6.2 把这个现象归因为"开发态 HMR 噪音"，**判断错了**。用户截图显示
  侧栏"铁路 0 · 公路 0""0 / 0 处""暂无统计"且底部一直显示
  「正在加载全国铁路与景点数据…」——是数据请求/渲染没完成。
- 真因：v0.6.1 把公路侧并进 `/api/atlas/overview`，响应体从 ~200KB 涨到 **4.39MB**
  （624 铁路景点 + 1.2 万公路景点 + 244 条公路折线）。浏览器要解析这 4MB JSON，
  再把 1.2 万个点交给 AMap MarkerCluster，主线程长时间阻塞，侧栏卡在初始态。
- 处置：**接口拆分 + 按需加载**
  - `GET /api/atlas/overview` 恢复只返回铁路（走廊 + 624 景点），
    `meta` 仍带 `roadSpotCount` / `roadMigratedExcluded` 等轻量计数，
    侧栏能显示「铁路 624 · 公路 12087」而不必等公路明细；
  - 新增 `GET /api/atlas/road` 返回 `roadCorridors` + `roadSpots`（3.8MB）；
  - 前端新增 `loadRoad()`：切到「公路/全部」来源、打开公路图层、或进入
    `/drive/atlas` 时才拉；默认「全部」来源走 `requestIdleCallback` 后台预取
    （不阻塞首屏），避免用户看到统计只有铁路而以为数据缺失。
  - 体积实测：overview 4.39MB → **1.09MB（-75%）**。

### M2 侧栏补齐三类筛选与榜单（需求方点名要的）

- **景点统计**：三张关键数字卡（当前筛选景点 / 铁路景点 / 公路景点）+ 一条
  flex-grow 占比条（鸿蒙展示类：数据可视化用进度/占比表达，不堆数字）；
- **省份筛选**：可点选胶囊 + 各省景点数（按数量降序）。为此在 API 层透出
  `province` / `score` / `tier` 三个字段 —— 铁路侧 192/624 有省份（如实透传，
  不补假数据），公路侧 1.2 万条已全量补齐；
- **铁路景点榜 Top10**：铁路数据源没有评分字段，按「被几条铁路线路收录」排序，
  并在卡片下方**如实标注排序依据**（不假装是评分榜）；
- **公路景点榜 Top10**：按观赏评分排序，带 A/B/C 分级徽标；
- 两个榜单条目**可点**，点击后地图平移放大并弹出信息窗（`focusSpot`）；
- 维度筛选与省份筛选可叠加，「清空筛选」同时清两者。

### M3 公路详情页侧栏重做（分段"意义是什么都不能点开"的正解）

- **分段**：旧实现按 120km 固定窗口等分，标题写成「第 N 段 · X—Y km」——
  范围与标题重复、无地名、无信息量、不可点，等于纯占位。
  改为**按沿线景点实际分布聚合**：同样 120km 窗口，但只列**有景点**的段，
  每段显示「序号 + 里程范围 + 景点密度进度条 + 数量」，点击即筛选该段景点
  （再点取消），标题联动为「第 N 段 · X—Y km 的 M 处景点」；段数上限 24 兜底。
- **沿线景点**：从裸行改为可点条目 —— 里程徽标 K + 景点名 + **分类中文标签**
  （新增 20 类中英映射，如 `viewpoint.observation-deck → 观景台`）+ A/B/C 分级；
  点击后地图上出现脉冲定位环并平滑滚动到地图。
- 分级色改用 `ROAD_COLORS`（等级色板）而非硬编码，tier A/B/C 三档可区分。

### 验证

- 三包类型检查通过；单测 181 例通过。
- 真浏览器（headless Edge + CDP）：
  - `/atlas`：9 个侧栏区块齐全；默认「全部」idle 预取公路后统计显示
    12087；点「公路」触发 `/atlas/road`；省份胶囊 27 个（广东 1876 / 四川 1127 …）；
    点「广东」→ 12087 收窄到 1876；两个景点榜各 10 条可点；
  - `/drive/road/G318`：24 个分段（仅含有景点的段）、12 条景点（K 值 8 个唯一，
    不再全部相同）、点第 3 段 → 标题变「第 3 段 · 240—360 km 的 3 处景点」
    且列表只剩该段 3 条、点景点 → 地图定位环出现。

### 遗留

- 公路景点中约 990 条只有英文名（OSM 上无中文名），沿程里会看到
  "4500m Pass Lookout" 这类名称，后续可在归一化阶段补译。

---

## [0.6.2] — 2026-10-03

**自驾板块六项体验修复（对齐鸿蒙 UX 设计规范）**（分支 `heyworldchannel-20261002`）。
规范依据：沉浸光感（immersivelight-0000002612101053）、色彩、布局基础、动效等
doccenter-ux-design 文档（经 HarmonyOS 开发者知识库 MCP 检索核对原文）。

### P1 自驾卡片透明度对齐铁路「车上风景」页

- 实测两页卡片 computed style **完全一致**（同一个 .rv-card：
  `rgba(19,24,32,0.62)` + `blur(26px) saturate(1.5)`）——观感差异来自背景：
  自驾页背景是构建期渲染的全国路网位图（亮线密集）+ 星点，比铁路页
  "淡轮廓 + 稀疏星点"亮得多，同样透明度透出更多背景内容，显得卡片过透、文字发飘。
- 处置：仅在 `.drive-page` 作用域内把 `--surface-1`（0.62→0.78）与
  `--surface-2`（0.55→0.70）调实一档，铁路页不受影响。
- 验证：铁路页卡片 bg `rgba(19,24,32,0.62)`、自驾页 `rgba(19,24,32,0.78)`。

### P2 沉浸光感去黄，回归鸿蒙规范

- 现象：自驾板块的沉浸光感（指针高光 + 公路星点）此前被改成琥珀黄
  （`rgba(255,184,77,…)`）。
- 规范：沉浸光感应"轻盈通透、环境光沿边缘柔和流转、随深浅色模式自动适配"，
  光效应为中性-主题色，不应整体染成单一色相。
- 处置：`AppBackdrop.vue` 的星点内外色与 `.app-backdrop__glow` 全部回归
  中性亮芯（229,242,255）+ 主题蓝外晕（77,159,255），铁路/公路两种模式同色
  （此前 warm 分支删而不改签名，保留参数位并注明）。
- 验证：glow computed background 为
  `radial-gradient(460px, rgba(229,242,255,0.13), rgba(77,159,255,0.06) 42%, …)`，
  全站已无 `255,184,77` 光效（roadColors.ts 的 #ffb84d 是公路等级**信息编码色**，
  与 AtlasMap 来源筛选色同属数据可视化用色，按规范保留）。

### P3 底部图例与上方组件的间距

- 现象：DriveHome 底部「普通国道 / 国家高速 / 已挂几何」统计区与上方
  搜索+速览区紧贴。
- 根因：`main.rv-shell` 不是 gap 布局，区块间距靠各区块自身 margin 撑开，
  而 `.drive-home-main` 没有 margin-bottom。
- 处置：`.drive-home-main` 增加 `margin-bottom: var(--space-5)`。
- 验证：实测两区块间距 24px。

### P4 公路网 / 全国地图加载加固

- 排查：在干净环境实测 `/atlas`、`/drive/atlas`、`/drive/road/G318` 的加载时序
  （1s 间隔采样 8 次）——数据稳定加载、无 URL 跳变、无 console 报错；
  代码里也没有自动跳转逻辑（跳转全部绑定在点击事件上）。
  观察到的"页面闪现"与本会话**持续保存文件触发 Vite HMR 全量刷新**时间吻合，
  判断主要是开发态噪音；但排查中发现两个真实缺陷，一并修复：
- 缺陷一：`loadAmap()` **没有超时**——高德 script 被网络环境静默拦截
  （代理/广告拦截插件/企业网关）时 onload/onerror 都不触发，Promise 永久 pending，
  表现为"可选要素一直不加载"。加 12s 硬超时并移除未加载成功的 script。
- 缺陷二：地图/数据错误态只有一行死文本，用户没有任何恢复手段。
  新增 `reloadAll()`（重载数据 + 视地图是否存在决定重建或仅重渲图层），
  错误态容器加「重新加载」按钮。

### P5 顶栏切换时的模糊闪变

- 现象：每次路由切换，顶部条出现"奇怪的模糊变化"。
- 根因：AppTopBar 此前渲染在**每个页面内部**，页面转场的
  `page-enter/leave`（translateY ±6~10px + opacity）让 sticky 顶栏跟随页面容器
  移动——transform 会改变 backdrop-filter 的采样区域，且滚动容器的 sticky
  定位在 transform 期间重算，叠加成模糊"波动"。
- 处置：
  - AppTopBar 提升到 `App.vue`（与 AppBackdrop 同一层级，跨路由唯一实例），
    8 个页面的 `<AppTopBar />` 挂载点与 import 全部移除（先确认无任何页面给它传 slot）；
  - 全屏地图类页面（`/atlas`、`/drive/atlas`、`/route/*`）自带顶部控件，
    通过 `showTopBar` 计算属性跳过主顶栏；
  - `.appbar` 背景加深/变浅补 `transition`（沉浸光感规范："标题栏随页面滑动
    从透明到模糊平滑过渡"，此前 is-scrolled 翻转是无过渡的瞬间替换）。
- 验证：`/drive` 顶栏实例数 = 1（原每页一个），`/atlas` = 0（自有顶条正常）；
  7 个路由遍历无横向溢出、版本徽标可见。

### P6 公路详情页布局重构（鸿蒙布局/排版/动效）

- 重构 `DriveRoad.vue` header 与提示区：
  - 编号徽章（等级色描边 + 微发光）与「等级 · 名称 / 起讫标题」左对齐成行，
    替代原先"小字行 + 巨标题 + 内联 margin 的 meta 串"的堆叠；
  - meta 从一串裸 `<span>` 改为**事实卡栅格**（`<dl>` + dt/dd：收录里程 /
    几何精度 / 连通情况 / 途经省份 / 沿线景点），`auto-fit minmax(148px,1fr)`；
  - 散落的 `drive-empty rv-card` + 内联 `padding:16px` 提示条统一为
    `.drive-road-note` 组件（左侧 3px 语义色条 + 玻璃底，`data-grade` 区分
    warn/danger/info）。
- 动效（克制，符合鸿蒙动效规范）：`drive-road-rise`（位移 10px + 淡入）应用于
  hero / 事实卡（逐个 30ms 递进）/ note；`prefers-reduced-motion` 下全部关闭。
- 验证：G318 详情页实测 hero ✓、徽章"G318" ✓、5 张事实卡 ✓、note ✓、
  地图与侧栏双卡 ✓；1440/390 断点无溢出、中文名 0 折行。

### 验证汇总

- 三包类型检查通过；单测 174 例通过。
- 真浏览器（headless Edge + CDP）遍历 7 个路由：无横向溢出、版本 v0.6.2、
  背景模式正确、glow 已去黄、顶栏单实例、详情页新结构完整。

---

## [0.6.1] — 2026-10-03

**需求方反馈的 4 个缺陷修复 + 公路景点批量扩充 + 全国地图双源融合**（分支 `heyworldchannel-20261002`）。

承接 v0.6.0 的全等级路网底座，本轮修的是**体验层与数据归属**问题。

### F1 版本号徽标消失（回归）

- 现象：顶栏看不到版本号，改了 `version.ts` 界面上毫无反应。
- 根因：徽标在 `ba6d8d6`「走廊全屏地图页」那次提交里被整块删掉，此后
  `appVersionInfo` / `APP_VERSION` **全仓没有任何消费方**（`git log -S` 确认）。
- 处置：恢复 `AppTopBar.vue` 的 `.appbar__version` 徽标（含悬浮摘要 tooltip，
  `max-width: 420px` 时隐藏），重新消费 `@railvista/shared` 的版本常量。

### F2 进入页面时背景地图"跳一下"（回归）

- 现象：点「自驾」或「行程」进来，背景地图会跳一下。
- 根因（两条，均已修）：
  1. **路由切换时页面级背景被销毁重建** —— 铁路页挂 `ChinaBackdropMap`、自驾 6 页挂
     `DriveBackdropMap`，两套实现早已分叉，路由一切换背景就没了再出现；
  2. **路网内容被瞬间替换** —— 采样实测（50ms 间隔）显示舞台几何全程恒定
     （`1728px / x=-149`），变化的是 canvas 的 `opacity`（0.24 → 0.456）与内容：
     路网懒加载块就绪后整张折线一次性画进同一张 canvas，与 opacity 变化叠加成"双跳"。
- 处置：
  - 新增 `components/AppBackdrop.vue` 挂到 `App.vue`，**跨路由唯一实例**，
    按 `route.path` 自动切 `rail` / `road` 两种模式；
  - 路网独立成一层 canvas（`.app-backdrop__layer--net`），就绪后走 CSS 过渡淡入，
    星点层 opacity 恒定，不再有"亮度跳变 + 内容瞬替"的双跳；
  - 页面底色末层由 `var(--surface-0)` 改为 `transparent`（`.rv-page` / `.drive-page`），
    底色上移到 `body` 兜底，否则不透明页面底会把 App 级背景整块盖住；
  - 移除 7 处页面级背景挂载与 `DriveBackdropMap.vue`、`driveRoadNetwork.ts`（v0.6.0 已改位图方案）。
- 验证：`MutationObserver` 全程监听，SPA 路由来回切换（`/` ↔ `/drive`）期间
  背景舞台几何**只有 1 种取值**，即完全不再重建。

### F3 公路网的景点是铁路的景点（数据归属错误）

- 现象：自驾页背景与公路地图上出现的景点是铁路景点。
- 根因：`data/roads/roadside-spots.json` 共 1035 条，其中 **624 条（60%）是早期从
  `data/presets/scenic-spots.json` 迁移来的**（`source` 形如 `migrated:curated` /
  `migrated:ai_reviewed`），坐标贴铁路走廊。叠加两个放大因素：
  - `scripts/build-drive-backdrop.mjs` 的过滤条件写成 `source.includes('rail')`，
    而迁移条的 source 一个都不含 `rail` —— **过滤完全失效**，624 个铁路点一直画在公路背景上；
  - `/drive/atlas` 只是把 `AtlasMap` 的 `roadLayerOn` 默认打开，景点/Top10/排行榜
    **全部仍来自 `/api/atlas/overview` 的铁路数据**，标题还硬编码「铁路景点地图」，
    公路侧等于零。
- 处置：过滤条件改为**前缀匹配** `startsWith('migrated')`（已生成产物复核：
  背景星点 1200 个全部来自公路原生景点，624 条迁移条已排除）；
  迁移条**不删数据**，在全国地图里作为铁路景点展示。

### F4 全国地图双源融合（/atlas 单页）

- `/api/atlas/overview` 新增 `roadCorridors`（编号公路，抽稀折线）与 `roadSpots`
  （公路原生景点，已排除迁移条），`meta` 增加 `roadCorridorCount` / `roadSpotCount` /
  `roadMigratedExcluded`；公路侧按「文件指纹 + 10 分钟」独立缓存。
- `AtlasMap.vue` 新增**景点来源筛选**（全部 / 铁路 / 公路，冷蓝=铁路、琥珀=公路），
  标题随之切换；新增**编号公路沿线景点 Top10**（`focusRoad` 高亮 + fitView，
  与铁路走廊同一套交互）与**公路榜单**快捷入口；`/drive/atlas` 默认落在「公路」来源。
- 顺带：公路图层开关改为直接复用 `roadCorridors`，不再重复请求 `/drive/network/overview`；
  维度筛选计数分母由写死的 `spots.length` 改为 `spotsByOrigin.length`。

### F5 公路景点批量扩充：411 → 12104 条

- 新增 `scripts/harvest-roadside-spots.mjs`：复用 `scripts/lib/overpass.mjs` 的多端点
  failover 与 34 省分片，批量抓取全国旅游/自然/史迹类 POI，每省独立磁盘缓存、断点续抓。
- 质量控制（三轮实测调参后才达标）：
  - **类别黑名单**：剔除 `artwork` / `memorial` / `tomb` / `place_of_worship` 与
    `theme_park` —— 首轮把 `artwork` 等算进去时，北京+海南两省就产出 8872 条，
    绝大多数是城市雕塑、纪念碑、村庙；`theme_park` 更抓到乐园**内部单个设施**
    （"狮门娱乐天地""晶彩奇航""七个小矮人矿山车"）；
  - **设施名正则**再滤一遍游乐园设施与景区内店铺/餐饮/停车/充电站；
  - **取名优先级** `name:zh` → `name` → `name:en`：原先优先 `name`，导致沿程景点
    显示成 "Kalinchowk Temple" 这类外国地名（1066 条）；
  - **国境过滤**：`lng∈[73.4,135.1] / lat∈[17.8,53.6]`，剔除 G318 延伸段带进来的尼泊尔、印度点位；
  - **距离分档**：按到最近已绘公路的距离落 `roadside/detour5/detour20/distant`（>35km 不入库）；
  - **密度抑制**（同 0.01° 格保留前 2）+ **分类配额**（`nature.mountain` 单独限 2500，
    否则首轮它独占 13495 条 / 64%，地图被无名小山淹没）。
- 成果：`roadside-spots.json` 1035 → **12728** 条（公路原生 411 → **12104**，29 倍）；
  `province` 字段从 0 补到 11696 条；最终分类分布均衡
  （viewpoint.landmark 2796 / nature.mountain 2560 / viewpoint.observation-deck 2508 /
  culture.heritage 1627 / …），`visibility` 分布 roadside 2286 / detour5 6490 /
  detour20 2517 / distant 811。
- 沿程匹配实测无性能退化：`/api/drive/along?road=G318` 返回 200 个景点、45 个章节，
  首次 443ms、命中缓存后 8ms。

### F6 `/api/atlas/overview` 构建耗时 42s → 1.5s

- 根因：`getRoadGeometry()` **每调用一次**都遍历 `data/roads/geom` 全部文件做
  `statSync` 算 mtime 指纹；地图一次聚合取 200+ 条路 × 448 个文件 ≈ 9 万次同步 stat。
- 处置：mtime 采样加 5s 节流（几何是构建期产物，变化以分钟计，最多晚 5s 生效）。
- 同时公路图层数由 200 收敛到 250 上限（覆盖全部真实有几何的干线），缓存 10 分钟。

### 顺带修掉的一个既有数据不一致（未修数据，仅记录）

- `data/roads/index/*.json` 里 `hasGeom: true` 的条目共 **15107** 条，
  但 `data/roads/geom/` 实际只有 **448** 个几何文件（缺 14675）。
  后果：按 `hasGeom` 过滤会选出大量没有几何的条目，`buildNetworkOverview` 里被
  `if (!g) continue` 静默跳过 —— `/atlas` 传 limit 60 时只得到 29 条公路。
  本轮改为在 `buildRoadLayer` 里以「几何文件是否存在」为准，并把 limit 提到 250
  （实测拿到 244 条）。**索引标记本身仍需用 `pnpm roads:index` 重建才能修正**。

### 验证

- 三包类型检查（shared build / api tsc / web vue-tsc）全部通过；单测 174 例通过。
- 真浏览器（headless Edge + CDP）：
  - `/atlas`：标题「铁路 + 公路景点地图」、来源筛选 3 项、维度筛选 7 类、
    `12728 / 12728 处`、铁路线 Top10 + 编号公路 Top10（G5 京昆 365 / G4 京港澳 349 …）+
    公路榜单 4 个 + 铁路排行榜 67 条，无 console 报错；
  - `/drive/atlas`：标题「公路景点地图」、`12537→12104 / 12104 处`、公路图层默认开；
  - `/drive`、`/drive/trip`、`/drive/rankings`、`/drive/road/G318`：无横向溢出、
    背景 3 层 canvas 且 `is-net-ready`、模式 `road`、图例 4 项、干线 chips 12 个、
    中文名 0 折行、版本徽标可见；
  - SPA 路由来回切换期间背景舞台几何恒定（见 F2）。

### 已知限制

- **`pnpm build` 在本机无法执行**：esbuild 原生进程被安全策略拒绝文件读取
  （`winapi error #5`，0.25.12 与 0.28.2 均如此，连仓库根目录的临时文件也读不了）；
  `node` 自身读写正常、`apps/api` 的 tsc 构建正常。属环境问题，与本轮改动无关。
- 公路景点仍有 990 条只有英文名（OSM 上确实无中文名），后续可在归一化阶段补译。
- 公路几何覆盖仍偏低：`/atlas` 的公路图层来自已挂几何的 244 条干线，
  省道及以下虽有编号与连通性但未全部出几何（v0.6.0 已把路网底座备好，待 `roads:geom` 继续装配）。

---

## [0.6.0] — 2026-10-03

**全国公路网「全等级覆盖 + 精准化落地」**（分支 \`heyworldchannel-20261002\`）。
方案见 \`docs/方案-全国公路网全等级覆盖与精准化落地-20261002.md\`。
一句话：把「按编号去 Overpass 逐条捞线」换成「**一次拿全国 OSM 分省提取物（PBF）→ 本地建全等级路网 → 从这张网派生一切**」。

### 诊断：不是覆盖率低，是范式错

- 旧管道以「编号」为检索键查 Overpass，但 OSM 中 **89.3% 的路段没有 ref 标签**（全国实测：9,101,780 条 highway way 中带编号仅 956,942 条），按编号必然漏段；
- 旧装配用「端点最近邻 + 5km 容差」贪心拼链，主链是**碰巧串起来的**（G318 主链落在西藏、"上海"贴在错的端点上），拼不上的段丢进 segments 后与主链空间不相交；
- 旧渲染把折线打进前端静态块，**33 条线 = 153KB**，全国 1.5 万条编号公路 + 790 万条可通行道路无法承载。

### 新增：全国路网数据流水线（8 个脚本）

| 脚本 | 作用 |
|---|---|
| \`scripts/lib/osm-pbf.mjs\` | 零依赖流式 PBF 解析（BlobHeader/Blob/PrimitiveBlock/DenseNodes/Ways） |
| \`scripts/lib/road-ref.mjs\` | 编号清洗与等级判定（G/E/S/X/Y/C，与 §3.2 主键规则一致） |
| \`scripts/fetch-china-pbf.mjs\` | 31 省 PBF 下载（断点续传 + md5 校验 + 体积比对） |
| \`scripts/build-road-census.mjs\` | 全国路网普查（各等级 way 数 / ref 覆盖率 / 编号值） |
| \`scripts/build-road-ways.mjs\` | PBF → \`data/roads/net/{prov}.rvwn\` 全等级要素库（两遍扫描，内存可控） |
| \`scripts/lib/rvwn.mjs\` | RVWN 二进制格式读写（way 记录 + 节点下标 + 坐标池，节点用 OSM node id） |
| \`scripts/lib/road-assemble.mjs\` | 几何装配：连通分量 + 直行优先 + 平行对向车道识别 + 折返剔除 |
| \`scripts/build-road-geom.mjs\` | 逐编号装配几何 → \`data/roads/geom/{key}.json\`（含精度分级） |
| \`scripts/build-drive-network-raster.mjs\` | 全路网离线渲染 → \`apps/web/public/drive-network.png\` |
| \`scripts/verify-road-network.mjs\` | 质检门禁：覆盖率 / 里程偏差 / 精度分布 / 跳点 / 完整性 |

命令：\`pnpm roads:fetch\` → \`roads:census\` → \`roads:ways\` → \`roads:geom\` → \`roads:index\` → \`roads:verify\` → \`roads:raster\`（或一键 \`pnpm roads:build\`）。

### 全国实测基数（2026-10-03，31 省片）

- 可通行道路 **7,944,551 条 way / 93,670,047 节点 / 105,727,777 个 way 点引用**（要素库 2.49GB）；
- 编号实体 **15,183 条**：高速 E / 国道 G / 省道 S / 县道 X / 乡道 Y / 村道 C 全部入册；
- 关键发现：**物理路网在 OSM 里基本是全的，缺的是"编号"**。旧实现只画 33 条线，是因为按编号查 —— 无编号的路一条都进不来。

### 几何装配（替换旧贪心）

- **连通性只认 OSM 共享 node id**，不用距离猜：一个编号有几段就如实输出几段，绝不硬拼（G318 不再出现"主链在西藏"）；
- **直行优先**：度 ≥3 的交叉口按来向夹角最小选下一段，避免拐进支线；
- **平行对向车道识别**：双向分隔式道路（上下行各一条 oneway）按"长度比 + 双向最近距离中位数"判定，里程只计一条 —— G98 海南环岛高速由 1226km（2×）修正为 **613.2km vs 官方 613km（偏差 0%）**；
- **折返剔除**：走链中沿对向车道折回的段落按 oneway 段识别并剔除（山区回头弯是双向路，绝不参与判定）；
- **精度分级** A（≤10%）/ B（≤25%）/ C（更大或官方里程未知），用于如实标注与门禁；
- **端点与途经点命名**只用 30km 内的地名锚点，绝不把官方起讫点硬贴到错的端点上。

### API 与前端

- \`/drive/network/overview\` 默认只回干线（高速+国道），支持 \`?classes=\`/\`?limit=\`/\`?points=\` —— 不再把 1.5 万条几何推给浏览器；
- \`/drive/network/stats\` 新增 \`coverageByClass\`（按等级的覆盖与 A/B/C 精度分布），首页文案由写死的"85~95%"改为**实测值**；
- \`/drive/road/:key\` 与单条公路页：里程改用**去重后里程** \`totalKm\`；视野改为覆盖**全部分量**（原先只按主链算视野，东部线段会被裁掉）；
- 自驾页背景改为**构建期离线渲染的全路网位图** \`drive-network.png\`（零依赖 PNG 编码器 + Xiaolin Wu 抗锯齿线 + 2× 超采样），指针高光改为位图径向遮罩点亮；移除 153KB 的矢量路网懒加载块。

### 已知边界（如实标注）

- 村道 C### 的"编号"没有全国公开名录（OSM 中仅 1,291 条 way 带 C 编号），因此**村道提供物理几何与连通性，不承诺编号完整**；
- 部分国道因 OSM 未贯通而存在多个连通分量（页面如实显示断点数与最大断口）；
- 里程为 OSM 众包估算值，不作为导航依据。

### 验证

- \`pnpm --filter @railvista/shared exec tsc --noEmit\` / \`api\` / \`web\` 三包类型检查通过；
- 装配算法自检 6 项（共享节点成链 / 不连通分段 / 十字路口直行 / 平行重复剔除 / 闭环 / 断点标注）全绿；
- 要素库长度自检：海南 48,480 条 way 的长度与几何重算**误差 <0.5m**；
- \`node scripts/verify-road-network.mjs\` 输出按等级覆盖与精度分布（见 \`data/roads/reports/quality-*.json\`）。


## [0.5.4] — 2026-10-02

**自驾页背景重做：全国公路网光带背景 + 首屏改为搜索主导**（分支 `heyworldchannel-20261002`）。

对应诊断报告 §三「视觉与交互」的第 1、3 项（背景统一为公路网风格 / 沉浸光感全局化）。
用户诉求原文：「把自驾页的背景设计成非常好看的那种感觉……设计成这个全国公路网这种就比较好。
要参考那个行程页的，就是铁路的景点那种地图的这个规格设计。」

### B1 新增 `<DriveBackdropMap>`：全国公路网光带背景（6 个自驾页统一接入）

- 动机：v0.4.0 起自驾 6 个页面**没有背景层**，而铁路行程页（`SelectTrip.vue`）自始就有
  `<ChinaBackdropMap>`。用户明确要求按铁路行程页的地图规格设计，且要体现"全国公路网"。
- 规格对齐（逐项与 `ChinaBackdropMap.vue` 一致，便于后续合并同一套背景抽象）：
  - 投影与 viewBox：复用 `CHINA_OUTLINE_VIEWBOX`（1000×971）与 `china-outline.svg`（`?raw` 内联，
    运行时零网络请求、无密钥依赖）；
  - 铺满策略：`position: fixed; inset: 0` + `width: 120vmax` + `aspect-ratio: 1000/971`
    + `translate(-50%,-50%)`，竖屏 `150vw`、横屏矮屏 `150vh` 三档；
  - 边缘 `mask-image` 径向渐隐、整体不透明度走 `--backdrop-map-opacity`（0.48）、
    整层 `pointer-events: none`、触屏与 `prefers-reduced-motion` 下只渲染静态底图。
- 公路版专属观感（与铁路版的差异点）：
  - 路网按「外发光宽带（5.5× 线宽、低透明）+ 高亮细芯（0.85× 线宽）」**两遍描线**，
    叠加处用 `globalCompositeOperation = 'lighter'` 自然变亮 → 形成"路网光带"而不是一团亮斑；
  - 线色取 `ROAD_COLORS` 单一色板（与编号徽标、沿程标记同源，不硬编码）；
  - 景点星点改**琥珀色**（`rgb(255,184,77)`）与铁路版冷蓝星点区分；
  - 指针不仅点亮光圈内景点，还会让**穿过光圈的公路段**加亮（包围盒粗筛 + 60 单位空间分桶），
    形成"探照灯扫过路网"的效果。
- 体积纪律（沿用"懒加载禁止进主 bundle"约束）：
  - `scripts/build-drive-backdrop.mjs`（新增）构建期产出两个文件：
    `apps/web/src/data/driveBackdrop.ts`（主模块，含 viewBox 常量、解包函数、1035 个星点）
    与 `apps/web/src/data/driveRoadNetwork.ts`（33 条公路折线，`ROAD_NETWORK_CHUNK` 动态 import）；
  - 折线做**弧长重采样**（`SAMPLE_UNITS = 4`，单路上限 420 点）并压成扁平整数数组；
  - 实测：主模块 24.9 KB（gzip 7.9 KB），懒加载块 153.6 KB（gzip 46 KB），首屏不阻塞，
    路网到达后 canvas 才淡入（`is-net-ready`），视觉上是"路网逐渐点亮"。
  - **关键正确性细节**：折线取 `points ∪ segments` 的并集 —— G318 真实的上海段（121°E）
    只存在于 `segments` 里，若只取主链（91–103°E）会直接丢掉华东整段。
- 接入：6 个自驾页（`DriveHome` / `DriveTrip` / `DriveRoad` / `DriveRankings` / `DriveBoard` /
  `DriveRoadbook`）在 `.drive-page` 首子节点挂 `<DriveBackdropMap />`。

### B1-b 移除首屏重复的前景路网卡（`DriveHome`）

- 现象：`DriveHome` 首屏左侧原有一张 46vh 的 `.drive-netmap` SVG 卡，画的正是同一份
  `/drive/network/overview` 折线，并带 `fill: var(--fill-subtle)` 的深色中国轮廓填充。
  背景层上线后两者重复，且深色填充轮廓在背景上渲染成一块与地图无关的"斑块"。
- 处置：删除该卡，改为 `aside.drive-netpanel「全国公路网」`——**等级图例（4 条，取 `ROAD_COLORS`）
  + 干线直达 chips（按已绘里程取前 12 条，点击进 `/drive/road/:key`）**，
  既保留"点路线进单条公路"的入口，又不与背景抢注意力。
- 首屏栅格：≥840px 由 `7fr 5fr`（地图在左）改为 `8fr 5fr`（**搜索在左且更宽**），
  落实验收项「DriveHome 首屏搜索框权重必须 > 榜单入口」；移动端顺序不变（搜索仍在最上）。
- 措辞诚实化：chips 的里程明确标注为「已绘几何长度（估算），非官方里程」——
  因为 `build-road-index.mjs:241` 会用几何长度覆盖索引里的 `lengthKm`，
  按这个数字排序并不等于"公路实际长度排序"（例：G318 已绘 1954 km / 官方 5476 km，覆盖率 36%）。

### 验证

- `vue-tsc --noEmit`（web）+ `tsc --noEmit`（api）+ shared 构建：全部通过。
- 单测 174 例全通过（含 drive 雷达/采样 2 文件）。
- 真实浏览器（headless Edge + CDP）实测 `scripts/drive-probe.mjs`：
  - `/drive` 1440×900 与 390×844：无横向溢出（scrollW == clientW）、
    背景 canvas 1 个且 `is-net-ready`、图例 4 项、干线 chips 12 个、中文名 0 折行；
  - `/drive/trip`、`/drive/rankings`、`/drive/road/G318` 1440×900：同样无溢出、背景就绪。
- 轮廓层等价性验证：单独渲染 `.drive-backdrop__outline` 与铁路页 `.backdrop` 的轮廓层，
  两者逐像素同形（同一份 `china-outline.svg`，291 环、bbox 0,0–1000,971 铺满 viewBox），
  即背景观感差异只来自新增的路网层，未改动铁路侧任何行为。

### 已知限制 / 下一步

- **`pnpm build` 在本机环境无法执行**：esbuild 原生进程（`@esbuild/win32-x64` 0.25.12 与 0.28.2
  两个版本均试过）在本机被安全策略拦住文件读取，报 `winapi error #5 (ACCESS_DENIED)`，
  连对仓库根目录的临时文件亦如此；`node` 自身读写正常，`apps/api` 的 `tsc` 构建正常。
  属环境问题、与本轮改动无关（本轮只动模板 / 样式 / 前端脚本，且 `vue-tsc` 已通过）。
  提交前如需产物验证，请在放行 esbuild 文件的终端重跑 `pnpm build`。
- 沉浸光感仍是"零散组件"级别（仅首屏 hero + 卡片）；全局化留给 Sprint 2。
- `.drive-page` 与 `.rv-page` 的背景声明目前**逐字重复**（两份完全相同的 radial-gradient + surface-0），
  待 Sprint 2B 背景层统一时合并。

---

## [0.5.3] — 2026-10-02

**自驾板块 Sprint 1 止损：修P0 缺陷 + 数据诚实化**（分支 `heyworldchannel-20261002`）。

诊断报告见 `docs/自驾板块-问题诊断与优化方案-20261002.md`。本轮只做「已经写了但没生效」和「会整页崩」的止损，不做视觉重做。

### A1 沿程景点永久不可见（P0，已浏览器实测验证）

- 动机：`useScrollReveal` 在 `onMounted` 里 `querySelectorAll`，但此时模板走 loading 骨架屏分支、`.drive-spot` 尚未渲染 → 抓到空集合后提前 return → IntersectionObserver 从未注册 → 而 `drive.css` 的初始态是 `opacity: 0`，导致**自驾最核心的卖点功能完全不可见且无任何报错**。`useRoadDraw` 同源同病（路线描边动画也从不播放）。
- 涉及文件：`apps/web/src/composables/useScrollReveal.ts`（改为「MutationObserver 监听子树 + 惰性建立 IntersectionObserver」，并返回 `rescan()`；无IntersectionObserver 时直接全部显示）；`apps/web/src/composables/useRoadDraw.ts`（`onMounted` 一次性取值 → `watch(pathRef, { flush: 'post' })`）；`apps/web/src/pages/DriveTrip.vue`（`load()` 的 `finally` 里 `nextTick(rescanReveal)`）；`apps/web/src/styles/drive.css`（新增 CSS animation 兜底，1.2s 内无条件推到终态 opacity:1 —— 即使 JS 失效内容也一定可见）。
- 行为变化：G318 沿程页 42 张景点卡实测 `minOpacity: 1`、不可见 0 张（修复前全部`opacity: 0`）；路线描边动画恢复播放。
- 验证：headless Edge 注入脚本实测 42/42 可见；单测 174 通过。

### A2 「设为起点/终点」永远取候选第 1 项（P0）

- 动机：`setRoadAsConstraint` 恒取 `roadCandidates[0]`，忽略用户点选的那一项；候选按编号升序，导致「设为起点」永远设成编号最小的公路，公路编号筛选实际不可用。
- 涉及文件：`apps/web/src/pages/DriveHome.vue`（新增 `selectedRoadHit`、候选项改为单选并加 `is-picked` 态、未点选时按钮禁用并显示提示、候选集变化时清空失效选中项、回车改为用选中项）。
- 行为变化：实测输入 G3 出现 8 条候选 → 点选第 4 项 G303 → 「设为起点」后起点框为 **G303**（修复前为 G3）。
-样式：`drive.css` 新增 `.road-kbd__candidate.is-picked` / `.is-picked` 光标提示 / `.road-kbd__hint`。

### A3 拓扑二进制 reserved 字段读取偏移（P0，附实测结论修正）

- 动机：写端`build-road-topology.mjs:198` 写 offset 16，读端 `roadTopology.ts:111` 读 offset 20 → `nodeFlag` 永不加载 → snap 选中小分量孤立节点。
- 涉及文件：`apps/api/src/services/roadTopology.ts`（改读 offset 16，并保留 offset 20 兼容分支）；`scripts/build-road-topology.mjs`（注释锁定偏移约定）。
- **实测结论修正（重要）**：修复后 `nodeFlag` 正常加载（31,300 节点，与 meta 的 `mainCompNodes` 完全一致），但 **OD 成功率并未提升**（1406 组前后均为 0.8%）。真正瓶颈是图碎裂：连通分量 1,237 个、最大分量仅占全图 17.2%、**主分量 bbox 仅 lng[84.8,109.1]/lat[25.3,40.3]（青藏东部）**，华东/华南/华北均不在主分量内。诊断报告初版预测「1% → 30~50%」有误，已在报告中更正。
- 连带：`routeEngineNote('direct')` 改为如实说明「本地路网仅覆盖青藏部分干线，跨省规划暂不可用（不代表真实路线）」。

### B3 单条公路页 / 榜单「看沿程景点」整页失败（P0）

- 动机：三个原因叠加 —— ① `Promise.all` 原子失败（558/591 条路 `hasGeom:false` 时 `getDriveAlong` 返 404 → 整页红字，而非「景点为空」）；② 限流 120次/分无 drive 桶；③ `/drive/network/overview` 每次请求同步 `JSON.parse` 约 5.72MB 阻塞事件循环；④ 高德失败静默无日志。
- 涉及文件：`apps/web/src/pages/DriveRoad.vue`（`Promise.allSettled` 独立降级 + 景点区独立重试按钮 + `entryView` 合成条目防模板解引用 null）；`apps/web/src/pages/DriveBoard.vue`（`alongHref` 校验 `from !== to`，相同则禁用跳转显示「暂无 OD 数据」——原先22/33 个条目会退化成同省 `from===to` 的空路线）；`apps/api/src/services/roadNetwork.ts`（overview 按 `updated` 进程级缓存、几何 LRU 24→64、**新增几何 mtime 指纹失效**，此前重跑抓取脚本后API 仍返回旧对象）。
- 行为变化：几何失败仍展示索引信息 + 占位说明；景点失败只影响景点区并可单独重试。

### B3-2 沿程匹配性能

- `apps/api/src/routes/drive.ts`：先抽稀到 600 点再匹配（原先在未抽稀的全量折线上跑）。G318 实测 4673 点 614ms → 600 点 80ms（**7.7×**），景点数不变（42 → 42）。
- `COVERAGE_NOTES` 修正：原文声称「县道 20~40%，乡道村道 <10%（仅名称）」，实测县/乡/村道索引为 **0 条**，已改为如实披露。
- `networkStats()` 新增 `quality` 字段，读 `coverage-gap.csv` 得出 `noGeometry 558 / broken 23 / suspectGap 10`（此前前端拿不到「这条几何是坏的」信号）。

### B2-1 公路几何诚实化（G318 问题的直接修复）

- 动机：G318 声明「上海 → 聂拉木 5476km」，实际落盘主链是西藏林芝→四川甘孜 1954km，`nodes[0].name="上海"` 相距 **6709km**。全部 33 条中 **26 条端点不可信**。根因是抓取脚本无条件写入端点名、且 `points`与 `segments` 互不相交、顺序未按空间重排。
- 涉及文件：`scripts/fetch-road-geometry.mjs`（新增 `verifyEndpoints()`，端点地名与几何首/末点距离 >50km 则不写标注并标记 `endpointsUnverified`；里程偏差 >50% 写入 `lengthDeviation`）；`apps/api/src/services/roadNetwork.ts`（新增 `officialLengthKm()` —— **`build-road-index.mjs:241` 会用几何长度覆盖索引 `lengthKm`，直接用它算覆盖率会得到假性 100%**）；`apps/api/src/routes/drive.ts`（`/road/:key` 带出 `connectedKm`/`nominalKm`/`coveragePct`/`endpointsUnverified`；`/along` 的 C2 模式 engineNote 改为如实展示已贯通占比）；`apps/web/src/pages/DriveRoad.vue`（端点不可信时标题改为「全线走向（端点待核）」、分段不再用假端点命名、展示覆盖率）；`packages/shared/src/types.ts`（`RoadGeometry` 新增三个可选字段，向后兼容）。
- 数据回填：33 个几何文件补写 `endpointsUnverified`/`lengthDeviation`（改前已备份至 Temp）。
- 行为变化：G318 页面标题从「G318上海 — 聂拉木」变为「G318　全线走向（端点待核）」，并显示「已贯通 1953.5 km / 官方 5476 km（36%）」。实测覆盖率：G312 10%、G104 13%、G331 15%、G318 36%、G109 41%、G317 95%、G227 161%。

### A4/A5/A7 输入与信息架构

- OD 联想 `suggestSeq` 由**单计数器**改为**每字段独立**（原逻辑下在起点输入后立刻在终点输入，起点响应会被当迟到响应丢弃 → 起点下拉永不弹出）；新增 250ms 防抖。
- `pickHit` 保留结构化 `{kind,id,name,lng,lat}`（原只存 name，公路编号与地名被压成同一字符串）；提交时按 `kind` 分流：任一端为公路 → 跳单条公路页而非点对点。
- OD 联想限定 `kind='place'`，公路编号不再混入；占位符「例如 上海 或 G318」→「城市 / 区县，如 上海」。
- 后端错误文案去掉不存在的「直接点地图选点」，改为提示可用路径。
- `geocodeFallback` 由串行 12s 改为 `Promise.any` 并行（超时 6s→3.5s）+ 24h 结果缓存。

### V1/V3 兼容性与层级

- `base.css`：`.station-suggest` 的 `color-mix()` 背景加不透明回退双声明（旧WebView 不支持时整条声明失效 → 下拉完全透明 → 文字重叠）。
- `drive.css`：8 处 `backdrop-filter` 补 `-webkit-` 前缀（iOS Safari/部分 WebView玻璃完全失效）。
- 新增 `.drive-od.has-suggest-open`（联想展开时把 OD 卡片提到兄弟卡片之上）—— `.rv-card` 自带 `isolation:isolate`，子元素 z-index 只在卡内有效，压不过兄弟卡片。

### 验证与已知限制

- 单测 174 通过 / 0 失败；`vue-tsc` 与 `tsc` 三包零错误。
- headless Edge 实测：A1 景点 42/42 可见、A2 编号点选正确、`/drive` 与 `/drive/road/G318` 移动端 390px 无横向溢出。
- **未解决**：OD 跨省规划仍不可用（A3 的图碎裂属N4 阶段数据建设，需按几何交叉点缝合 33 条路）；公路几何 `points`/`segments` 顺序错乱需重跑抓取；景点库 1035 条（目标 3万）；县/乡/村道名录仍为 0 条。
- 回滚：本次改动集中在上述文件，`data/roads/geom/*.json` 可从 Temp 备份还原。

## [0.5.2] — 2026-10-02

**修复：自驾首页 OD 起终点输入框未套用全站输入样式**（分支 `heyworldchannel-20261002`）。

- 动机：DriveHome 的 OD 表单类名为 `.drive-od`，未命中 `base.css` 中 `.select-form input` 的共享输入样式，回退成浏览器默认白底输入框，与铁路「按站查询」观感割裂。
- 涉及文件：`apps/web/src/styles/base.css`（将 `.drive-od .station-field` 及其 input 纳入 label/输入框/hover/focus/placeholder 共享选择器）；`apps/web/src/pages/DriveHome.vue`（起点占位符精简为「例如 上海 或 G318」，对齐鸿蒙文本框规范"提示文本精简直接"）。
- 行为变化：起点/终点输入框获得与铁路页一致的暗色玻璃质感、聚焦外发光与占位符弱化；其余页面不受影响。
- 验证：`scripts/drive-probe.mjs` 桌面 1440 / 移动 390 双断点截图，无横向溢出，输入框样式与铁路页一致。
- 回滚：还原上述两文件即可。

## [0.5.1] — 2026-10-02

**自驾模块 UI 优化**（分支 `heyworldchannel-20261001`，P1-P7 七阶段，对应 `.codeartsdoer/specs/drive_ui_optimize/`）。

### P1 基础清理：硬编码色值清零 + 字号对齐

- `drive.css`：`#d97706` → `var(--warning)`（gap-note）；`.drive-block-title` 字号 `--fs-meta` → `--fs-h2`；`.drive-boards__title` 字号 `--fs-h3` → `--fs-h2`。
- `DriveRoad.vue`：引入 `ROAD_COLORS` + 新增 `tierColor()` 函数，替换内联 hex 三元。

### P2 composable 挂载：指针光晕全量覆盖

- 6 个自驾页面（DriveHome/DriveRoad/DriveTrip/DriveBoard/DriveRankings/DriveRoadbook）均挂载 `usePointerSpotlight()`。
- `DriveRoadbook.vue` 补齐 `DriveSubNav` import + 模板 `<DriveSubNav />`。

### P3 卡片三件套：悬停光影/微缩放/渐显反馈/入场动画

- `drive.css` 追加约 100 行：自定义卡片类（`.drive-route-card`/`.drive-stat`/`.drive-board-card`/`.drive-chapter`/`.drive-highlight`/`.drive-spot`）的 `::after` 径向光晕 + `::before` 高光带 + `:hover` 三件套 + `transition` + `rv-card-in` 入场动画 + `:nth-child` 错峰延迟 + `.drive-spot` 玻璃材质 + `prefers-reduced-motion` 降级。

### P4 按钮四态：按压/聚焦/悬停/默认

- `drive.css` 追加约 40 行：自定义按钮类（`.drive-trip-tab`/`.road-kbd__chip`/`.road-kbd__prefix`/`.road-kbd__digit`）的 `:active:not(:disabled)` 按压态 + `:focus-visible` 聚焦环 + `transition`。

### P5 路线绘制与滚动揭示

- 新建 `useScrollReveal.ts`（IntersectionObserver 滚动揭示）+ `useRoadDraw.ts`（SVG `stroke-dasharray`/`stroke-dashoffset` 绘制动画）。
- `DriveRoad.vue`/`DriveTrip.vue`：挂载 composable + `routePathRef` + 模板 `<path ref="routePathRef">` + `.drive-spot` 追加 `drive-scroll-reveal` 类。

### P6 Transition 过渡

- `drive.css` 追加 Transition 过渡类：`.drive-trip-panel-*`（三入口切换 600ms）+ `.drive-spot-expand-*`（景点展开 250ms）+ `.drive-subnav-menu-*`（路书菜单 250ms 弹性）。
- `DriveTrip.vue`：`<Transition name="drive-trip-panel">` 包裹 DriveLivePanel + `<Transition name="drive-spot-expand">` 包裹景点展开内容。
- `DriveSubNav.vue`：`<Transition name="drive-subnav-menu">` 包裹路书菜单。

### P7 骨架屏 + 错误态 + 章节条 tooltip + 响应式断点重写

- `drive.css`：`@keyframes drive-skeleton-pulse` + `.drive-skeleton`/`.drive-skeleton__line` 类 + `.drive-empty--error` 错误态修饰类 + `.drive-chapterbar__seg::after` tooltip + `prefers-reduced-motion` 降级。
- 响应式断点重写：`max-width` 降序 → `min-width` 升序（600px/840px/1200px），mobile-first 与 `tokens.css` 方向一致。
- `DriveRoad.vue`/`DriveTrip.vue`/`DriveBoard.vue`：加载态用骨架屏替代文本。
- 5 个自驾页面错误态追加 `.drive-empty--error` 修饰类。
- `DriveTrip.vue`：章节条段追加 `data-title` 属性绑定。

### 验证

- 类型检查（shared + api + web）全部通过。
- 174 单测全绿，构建通过。
- `tokens.css`/`base.css`/`api/client.ts` 未修改（只读引用约束）。
- `drive.css` 无硬编码 hex 色值，3 处 `prefers-reduced-motion` 降级规则。

---

## [0.5.0] — 2026-10-02

**公路路网多段几何 + 段间断点标注**（分支 `heyworldchannel-20261001`，P0 公路路网建设）。

### 1. 多段几何存储（RoadGeometry.segments + gapAnnotations）

- `packages/shared/src/types.ts`：`RoadGeometry` 新增可选字段 `segments?: RoadPoint[][]`（orphan 链）+ `gapAnnotations?: GapAnnotation[]`（断点标注）；新增 `GapStatus` 类型 + `GapAnnotation` 接口（atKm/gapKm/fromSeg/toSeg/status）。
- `RoadRoute` 同步扩展 `segments?` + `gapAnnotations?`，向后兼容（旧数据无字段时按单段处理）。

### 2. 几何抓取改造（chainAll 保留 orphan 链 + 段间断点标注）

- `scripts/lib/overpass.mjs`：新增 `computeGapAnnotations`（主链末点 ↔ segment 首点 Haversine，>200km 标 suspect）+ `fetchConnectingWaysAround`；`fetchWaysForRef` 新增 `officialKm` 参数，长线(>1000km) relation 优先。
- `scripts/fetch-road-geometry.mjs`：`chainAll` 返回 `{main, segments, gapAnnotations, orphans}`（**修复：之前 orphan 链被丢弃**）；`fetchOne` 写入 segments 到几何文件；新增 `sleep`/`runBatched` 限流分批 + `--provincial-tiling`/`--batch` 参数。
- 33 条已抓线重跑成功（零网络成本，缓存命中），segments 全部填充。G318 实测 6202km（主链+71段，偏差 13% vs 之前 1954km 偏差 64%）。

### 3. 省级分片抓取（province-bbox）

- `scripts/lib/province-bbox.mjs`（**新建**）：34 省 bbox + `mergeProvincialWays` 去重。
- `scripts/lib/overpass.mjs`：新增 `fetchWaysByProvincialTiling` 分片抓取（长线按省分片，合并去重）。

### 4. 拓扑重建（segments 段建边）

- `scripts/build-road-topology.mjs`：抽 `buildEdges` 函数，对 `g.points` + `g.segments` 都建边。
- 拓扑重建效果：节点 40,448→182,007（4.5x），边 44,710→206,609（4.6x），主分量 17,919→31,300（1.75x）。

### 5. 质检报告（8 列 CSV + 段间断点检测）

- `scripts/verify-road-network.mjs`：**重写**，8 列 CSV（key,ref,officialKm,measuredKm,deviation,status,segmentCount,gapCount）+ 段间断点检测 + suspect_gap 状态。

### 6. 服务层 + API + 前端全链路

- `apps/api/src/services/roadNetwork.ts`：新增 `getRoadGeometryFull`（含 segments + gapAnnotations + 统计）；`roadNetworkOverview` 扩展返回 segments + gapCount。
- `apps/api/src/services/roadRouting.ts`：`planRoadRoute` 改造，用 `getRoadGeometryFull`，返回 segments/gapAnnotations/engineNote（含「部分段，N 处未贯通」）。
- `apps/api/src/routes/drive.ts`：`/road/:key` 响应加 segments/gapAnnotations/segmentCount/gapCount；`/along` engineNote 含段间断点提示。
- `apps/web/src/pages/DriveRoad.vue`：SVG 渲染 segments 虚线（opacity 0.45）+ 「⚠ N 处未贯通（合计约 X km）」标注 UI。
- `apps/web/src/styles/drive.css`：新增 `.drive-trip-map__gap-note` 样式。

### 验证

- 174 单测全绿；apps/api + apps/web 类型检查通过。
- G318 端到端：主链 1953.5km + 71 段 orphan，gapAnnotations 71 条（54 suspect >200km，17 normal），maxGap 3313.5km。

### 已知限制

- 546 条公路几何待抓取（依赖 Overpass 网络可达性，P6 批量抓取任务）。
- 段间断点距离为 Haversine 直线距离，非实际道路距离。

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
