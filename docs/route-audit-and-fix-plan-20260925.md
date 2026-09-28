# RailVista 路线问题审查与修复方案

> 审计日期：2026-09-25 · 审计方式：只读代码审查 + 走廊数据静态审计（未改动任何代码）
> 本文档写给下一个负责改代码的 AI（华为云码道 GLM）。**动手前必读** `.cursor/rules/rail-route-invariants.mdc`、`docs/corridor-ingest-lessons.md`、`docs/rail-geometry-quality-playbook.md`。
> 涉及几何/走廊改动的产出必须过 `node scripts/verify-corridor-geometry.mjs --strict` 门禁；改拼线规则后必须 bump `railseg:vN` 缓存键。

---

## 0. 一句话结论

**程序管线本身是健全的，问题集中在「数据」：站坐标只覆盖 32%、走廊 hints 太稀疏、四类关键走廊缺失、同城异站规则误杀真实经停站。** 按本文档 P0→P2 顺序修，9 个报告车次可全部解决，且能把"找出所有问题"变成可持续的自动审计。

---

## 1. 三个系统性根因（按影响面排序）

### R1（最严重）：站坐标库只覆盖 32%，缺失的站被静默丢弃

- **证据**：`data/station_name.cache.json` 有 **3388** 个站（12306 官方站名表），但 `data/stations-geo.json` 只有 **1089** 个。**缺 2372 个站坐标**。
  - 已确认缺失的知名站：**鹰潭北、弋阳、襄州**、北京东、重庆东、上海西、南昌东、石家庄东、长沙西、成都南、哈尔滨北、阳新……
- **代码后果**（这是"没过某站"的直接机制）：
  - `apps/api/src/routes/railGeometry.ts` L50-60 `resolveStops()`：`enrichStopsCoords` 之后 `.filter((s) => s.lng != null && s.lat != null)` —— **geocode 失败的站直接从行程里消失**；
  - `apps/api/src/services/railGeometryJob.ts` L607-609 `createRailGeometryJob` 同样过滤 `Number.isFinite` 的站；
  - geocode 链（`geocode.ts`）：stations-geo 本地 → cache → Nominatim(6s 超时) → AMAP。网络不稳或 `matchesStationRegion` 区域校验不过 → 返回 null → 站被丢。
- **对应现象**：
  - G1692「没过弋阳」：弋阳缺坐标 → 被过滤 → 站标消失（鹰潭北同样缺，靠走廊 hint 端点投影兜底才保住起点）；
  - K553「没过两个站」：链路本身通（jinghaxian∩hajia 共享哈尔滨），**就是两个经停站缺坐标被过滤**。

### R2：走廊 stationsHint 太稀疏 → 网络枢纽图断裂（拼线失败）

`corridorNetwork.ts` 的多段拼接靠**共享 hint 枢纽**建边（`sharedHubs`，L126-133）。hints 少于实际站点时，物理上共站的走廊连不上：

| 走廊 | hints | 缺的关键枢纽 | 后果 |
|---|---|---|---|
| jingguangxian(京广线) | 5 个：北京、石家庄、郑州、长沙、广州白云 | **株洲**（京广↔沪昆物理共站） | ∩hukunxian 无边 → **K512 广州白云→杭州南无法拼线** |
| hukunxian(沪昆线) | 5 个：上海、杭州西、株洲、怀化、昆明 | **杭州西≠杭州南**（12306 车次终到杭州南） | 即使拼上，终点站也不认（见 R3） |
| lizhan(黎湛线) | 3 个：黎塘、玉林、湛江 | **河唇**（河茂线起点就是黎湛线的河唇站） | hemao∩lizhan 无边 → Z501 去海南链断 |
| lanxinxian(兰新线) | 2 个：兰州、乌鲁木齐 | 吐鲁番、哈密、嘉峪关等全部 | 兰新线普速基本不可用 |
| jinghaxian(京哈线) | 3 个：北京、长春、哈尔滨 | 沈阳北、四平等 | 靠 40km 贴线兜底勉强可用 |

- **对应现象**：K512（京广→沪昆在株洲断）、Z501 北京西→海口/三亚（hemao∩lizhan 断 + 见 R4）。
- **已验证可通**的链路（无需修）：hukun∩hefu=上饶、hefu∩fuxia=福州、fuxia∩xiashen=厦门北（G1692 网络链路通）；chenggui∩hukun=贵阳北（G2837 链路通）；jinghaxian∩hajia=哈尔滨（K553 链路通）。

### R3：「同城异站冲突」规则误杀真实经停站 + 网络让位死锁

`corridors.ts` `endpointsBelong`（L235-249）：OD 站与走廊 hints 存在"同词干不同方位"冲突时（如珠海北 vs hint「珠海」），**仅当贴走廊末端 ≤12km 才放行**。但很多真实车站就在走廊**中段**：

| 车次 | OD 站 | 走廊 | 冲突对象 | 距末端 | 结果 |
|---|---|---|---|---|---|
| C7601 广州南→珠海北 | 珠海北 | guangzhu(广珠城际, hints=广州南、珠海) | 珠海 | 20.5km | 单走廊拒 → 网络见起终同走廊 `return null`（corridorNetwork.ts L663）→ **无精准路线** |
| 吐鲁番北→喀什 | 吐鲁番北 | nanjiang(南疆线, hints=吐鲁番…喀什) | 吐鲁番 | ~17km | 同型 → **无精准路线** |
| K512 …→杭州南 | 杭州南 | hukunxian(hints=…杭州西…) | 杭州西 | ~180km | 同型 → 终点不被认 |

**死锁机制**：`matchCorridorNetwork` L663「起终落在同一走廊：交给单走廊逻辑」→ 单走廊又因冲突拒收 → 双双返回 null。这三个车次是**同一个 bug 的三个实例**。

### R4：走廊数据缺口与低质（核实清单）

**缺失走廊**（磁盘 243 条中确认不存在）：
- `zhanhai` 湛海线（湛江→海安→轮渡→海口）——**所有普速进海南的车（Z501/Z503 等）必然断链**，这是北京西→海口/三亚的最终断点；
- `guangshen` 广深线（广州—常平—深圳）——京九线（末端深圳东）↔广州东向的连接缺口，jingjiu 末端距常平仅 13km，但没有广深线就连不到 guangmao；
- `shenji` 沈吉线、`suijia` 绥佳线、`binbei` 滨北线——东北普速补网（K553 若走沈吉则直接无走廊；走京哈+哈佳则只差坐标问题）。

**低质走廊**：
- `xiangyu` 襄渝线：**132 点覆盖 ~899km（≈6.8km/点）**，折线末端距重庆西站 6.5km 未接入（hints 写「重庆北」，车次终到「重庆西」）→ **T237「重庆段有问题」**；
- `guangmao` 广茂线 57 点、`hemao` 河茂线 38 点（海南通道主干，过稀）；
- `hainandong` hints 缺「美兰」「文昌」。

### R5：50 秒墙钟 → 长途车降级示意线（长尾来源）

`railGeometryJob.ts` L55：`RAIL_JOB_MAX_MS` 默认 **50 秒**。长途 K/T/Z 十几个经停 → 每段 buildSegmentGeometry（本地 graph + Overpass 回退 + 6s geocode 超时）→ 超时后未完成段按示意失败占位 → `partial` + 示意线。用户说"还有很多很多"，多数长尾属于这一类。

### R6：待运行时复现（2 个）

- **C7871 海口东→万宁**：hainandong 走廊几何从海口东到三亚是连续折线，slice 后**必然经过美兰**；美兰坐标存在于 stations-geo。需运行时确认：①12306 C7871 经停是否含美兰；②前端**换乘段**是否强制用示意线渲染（用户是在多段行程里看这段）。
- **G2837 成都东→昆明**：chenggui∩hukun 共享贵阳北、hukun 末端=昆明南，**静态链路完全通，理论上应成功**。需运行时确认：①实际终到站名（昆明 vs 昆明南，若终到「昆明」则触发 R3 同型冲突——昆明站距 hukun 末端(昆明南)约 15km>12km）；②API 日志是否 job 超时。

---

## 2. 九个车次逐一诊断表

| # | 车次 | 现象 | 根因 | 修复动作 |
|---|---|---|---|---|
| 1 | K512 广州白云→杭州南 | 无精准路线 | R2(京广缺株洲枢纽) + R3(杭州西≠杭州南) | A2 补 hints + B3 几何枢纽 + B1 |
| 2 | C7871 海口东→万宁 | 没过美兰 | R6 待复现（几何应过美兰） | C1 复现脚本确认；A2 顺手补 hainandong hints |
| 3 | T237 襄阳→重庆西 | 重庆段有问题 | R4(xiangyu 稀疏 132 点+末端距重庆西 6.5km 未接站) | A4 重制 xiangyu；A1 补襄州 |
| 4 | G1692 鹰潭北→厦门北 | 没过弋阳 | R1(弋阳/鹰潭北缺坐标被过滤；网络链路本身通) | A1 补坐标（最高优先） |
| 5 | Z501 北京西→海口 | 无精准路线 | R4(zhanhai 不存在) + R2(hemao∩lizhan 缺河唇、京九↔广州缺广深线) | A3 新建 zhanhai/guangshen + A2/B3 |
| 6 | 北京西→三亚 | 无精准路线 | 同 #5（hainanxi 走廊存在，断点相同） | 同 #5 |
| 7 | K553 沈阳北→佳木斯 | 没过两个站 | R1(两个经停缺坐标被过滤；jinghaxian∩hajia 链路通) | A1；若实际走沈吉则 A3 补 shenji |
| 8 | 吐鲁番北→喀什 | 无精准路线 | R3(吐鲁番北 vs「吐鲁番」冲突+距端点 17km 拒+网络让位死锁) | B1+B2 |
| 9 | C7601 广州南→珠海北 | 无精准路线 | R3(珠海北 vs「珠海」冲突+距末端 20.5km 拒+网络让位死锁) | B1+B2 |
| 10 | G2837 成都东→昆明 | 无精准路线 | R6 待复现（链路静态通；疑似终到站名冲突或超时） | C1 复现确认后归类 |

---

## 3. 修复方案

### A. 数据修复（不改代码，P0，预计解决 60% 问题）

**A1. 批量补全 stations-geo.json（最高优先级）**
- 写 `scripts/seed-stations-geo-full.mjs`：遍历 `data/station_name.cache.json` 全部 3388 站，对缺失的 2372 站依次：AMAP `place/text`（项目已有 `AMAP_KEY`，`geocode.ts` L367 有现成请求写法）→ Nominatim 兜底 → 校验 `isPlausibleCnRailPoint` + `matchesStationRegion` → 写回 `stations-geo.json`。
- 要求：断点续跑（跳过已有 key）、限速（Nominatim ≤1 req/s）、失败清单落盘 `docs/stations-geo-missing-<date>.md` 供人工复核。
- 项目已有 `seed-missing-stations-geo.mjs` / `audit-stations-geo.mjs` 可在此基础上强化。
- **验收**：`鹰潭北、弋阳、襄州、沈阳东、石家庄东` 等抽查站全部有坐标且贴所属走廊 ≤2km。

**A2. 自动扩充走廊 stationsHint**
- 原则：hints 是「这条线实际停靠的代表性车站」集合。对每条走廊：取 OSM relation 沿线车站 + 12306 经停反推（该线上有车次停靠的站）合并去重，扩到 **≥15 个**，必须覆盖跨线枢纽（株洲、河唇、向塘、广州、常平、吐鲁番、沈阳北、四平…）。
- 优先级最高：jingguangxian、hukunxian、lizhan(补河唇)、lanxinxian、jinghaxian、hainandong(补美兰/文昌)、guangzhu(补珠海北/明珠/顺德)。
- 改完跑 `verify-corridor-geometry.mjs --strict` 确认无回归。

**A3. 新建缺失走廊**（按 P0 门禁：过 `verify --strict` 才能入库）
1. `zhanhai` 湛海线（湛江→雷州→海安）——解锁全部普速进海南车；海安→海口琼州海峡轮渡段允许由 network `bridge` 示意补缝（现有 BRIDGE_MAX_KM=280 足够，海安—海口约 25km）。
2. `guangshen` 广深线（广州—常平—深圳东）——解锁京九↔广州方向。
3. `shenji` 沈吉线、`suijia` 绥佳线、`binbei` 滨北线——东北普速网。
4. 来源：OSM（普速禁 hsr 源），命名遵守「X线」规则，id 不含 `__`。

**A4. 重制低质走廊**
- `xiangyu`：高密度重抓全线（目标 ≥400 点），末端接入重庆西站（与重庆枢纽联络段），hints 补十堰、安康、紫阳、万源、达州、重庆西。
- `guangmao`/`hemao`：同标准加密。

### B. 代码修复（GLM 改代码，P1）

**B1. `corridors.ts` `endpointsBelong` 放行"贴线中段站"**
- 现状：方位冲突分支仅 `nearCorridorTerminus(≤12km) && nearCorridor(≤15km)` 放行。
- 改法：冲突站若 `nearCorridor(≤15km)` 且投影进度落在走廊**中段**（progress ∈ [0.03, 0.97]），同样放行（中段站不可能是"平行线误套"——平行站不会贴线 15km 内）。珠海北/吐鲁番北/杭州南三个案例立好。
- 注意保持安阳/安阳东类平行普速站仍被拒（它们贴线距离远）。

**B2. `corridorNetwork.ts` L663 解除让位死锁**
- 现状：`if (startIds.some((id) => endIds.has(id))) return null;`
- 改法：起终同走廊时不直接 null——先允许单走廊重试（B1 修好后多数能成）；若单走廊仍失败，允许网络把该走廊作为唯一链路、以「近端贴线点」为 OD 切入点拼线（等效把 OD 投影到走廊再 slice）。
- 保守方案（如担心回归）：仅当 `matchCorridor` 返回 null 时才走这条路。

**B3. `sharedHubs` 增加几何枢纽自动发现**
- 现状：仅 hint 名匹配建边。
- 改法：hints 无交集时，若两走廊折线最近点对距离 ≤3km，自动建边（hub 用 `__geo_` 合成枢纽，transferKm=实际距离）。即使 A2 没做完，京广∩沪昆(株洲)、河茂∩黎湛(河唇)也能自动连通。
- 性能：243 条走廊两两最近点计算可离线预生成一张 `hub-geo.json` 缓存表（构建脚本生成，运行时只读），避免每次请求 O(n²) 重算。

**B4. `resolveStops` 停止静默丢站**
- `railGeometry.ts` L60 与 `railGeometryJob.ts` L607：无坐标站保留 `{name}` 参与 job（示意线段仍可连接），站标渲染时跳过坐标即可；
- OD 站（首末站）缺坐标时：先查 stations-geo → 查走廊 hint 投影兜底 → 都失败再报错（明确 message），**不允许静默丢弃导致"没过某站"**。

**B5. 墙钟与预生成**
- `RAIL_JOB_MAX_MS` 提到 120s（或按 segmentsTotal 分级：段数>10 → 120s）；
- 新增离线预生成：对 12306 热门长途（尤其 K/T/Z 干线）批量跑 job 结果写入 `preciseRouteCache`（已有 hot-cache 通道，`railGeometryJob.ts` L277 直接命中）；预生成任务可复用 C1 审计脚本遍历执行。

### C. 自动审计工具（把"找出所有问题"常态化，P2）

**C1. `scripts/audit-routes.mjs`（核心交付物）**
- 输入：车次清单 CSV（车次、出发站、到达站）——初始清单即本文档第 2 节 10 行 + 用户后续补充；
- 流程：调 `cr12306` 拉真实经停 → `enrichStopsCoords` → 依次跑 `matchCorridor` → `matchCorridorNetwork` → 逐段 `buildSegmentGeometry` → 记录每步结果；
- 输出 `docs/route-audit-report.md` + CSV：车次 / qualityTier / 命中走廊 / 失败环节 / 被过滤站 / 根因分类（R1-R5）。
- 复现命令示例：`node scripts/audit-routes.mjs --train K512 --from 广州白云 --to 杭州南 --verbose`（先跑 C7871 和 G2837 两个待复现项）。
- 审计起点代码已备好（`rv_audit/audit_v2.mjs`、`audit_v3.mjs`：走廊端点距离/共享枢纽/坐标覆盖检查，可直接拷进 `scripts/` 改造）。

**C2. 数据巡检门禁（防回归）**
- 12306 站表 vs stations-geo 差集 >5% → 报警；
- 每条走廊：端点距其 hints 首/末站 >12km → 报警（端点没接进站）；hints 数量 <5 → 报警；
- 两两走廊几何交叉点 ≤3km 但无边、且无 hint 枢纽 → 报警（潜在断链）；
- 建议以 npm script 形式接入，改数据后必须跑。

---

## 4. 执行顺序与验收标准

**顺序**：A1（1-2 天，解决 G1692/K553 类全部站标丢失）→ B1+B2（珠海北/吐鲁番北/杭州南立好）→ A2+B3（K512/Z501 链路通）→ A3（海南/东北普速）→ A4（xiangyu 重制）→ B4/B5 → C1/C2。

**验收（逐条可测）**：
1. 表格 #1-#10 全部呈现 `qualityTier ∈ {corridor, network}`，消息含「精品走廊/精品路网」；
2. G1692 弋阳站标出现；K553 经停站与 12306 一致不缺站；C7601 折线沿广珠城际至珠海北；吐鲁番北→喀什沿南疆线；
3. Z501 北京西→海口全程 corridor/network 拼接（湛海轮渡段允许 bridge 示意）；
4. `node scripts/verify-corridor-geometry.mjs --strict` 全 PASS；新增走廊含于其中；
5. C1 全量车次清单审计无 R1/R3 类失败；
6. **不回归**：对已正常线路（如京沪 G 系列、沪昆 G 系列）抽 20 条对比改前改后 qualityTier 不降级；
7. 全程遵守 invariants.mdc：站序只认 12306、K/T/Z 不套高铁走廊、改规则后 bump `railseg:vN`。

**明确禁止**（写给下一个 AI）：
- 不要按坐标重排站序；
- 不要为了让 K/T/Z 命中而放宽 isHsrCorridor——用 A2/A3 补普速走廊；
- 不要把 hints 扩充成"可能经过"的站——只收实际停靠/枢纽；
- 不要跳过 verify --strict 直接写入走廊。

---

## 附：本次审计关键数据存档

- 走廊库：243 条（高铁类 109 / 普速类 134），位于 `data/presets/corridors/`；
- 站坐标：1089/3388（32%），缺 2372；抽查缺失：鹰潭北、弋阳、襄州、北京东、重庆东、上海西、南昌东、石家庄东、长沙西、成都南、哈尔滨北；
- 走廊端点抽查（距声明端点站）：xiangyu→重庆西 6.5km(未接站)、guangzhu→珠海 0.9km(OK)、hainandong→海口东 0.1km(OK)、nanjiang→喀什 0.1km(OK)、chenggui→贵阳北 0.0km(OK)、hukun→昆明南 0.0km(OK)、jingjiu→北京西 0.0km(OK)；
- 共享枢纽抽查：hukun∩hefu=上饶 ✓、hefu∩fuxia=福州 ✓、fuxia∩xiashen=厦门北 ✓、chenggui∩hukun=贵阳北 ✓、jinghaxian∩hajia=哈尔滨 ✓；jingguangxian∩hukunxian ✗、hemao∩lizhan ✗、jingjiu∩guangmao ✗、jingha(高铁)∩hajia ✗（普速版可通）；
- 12306 站名表缓存 7 天自动刷新（stationIndex.ts），3388 站可用作补全底表。
