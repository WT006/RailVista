# RailVista 变更说明（CHANGELOG）

> 本文件位于仓库根目录，是**唯一的变更记录入口**。
> 所有版本历史、改动内容与版本号都在这里维护。

**当前版本：`0.1.1`**（2026-09-28）

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
