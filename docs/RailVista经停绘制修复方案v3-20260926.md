# RailVista 经停绘制缺陷 · 根因定位与修复方案（v3）

> 生成时间：2026-09-26 · 基线：commit `a7891e3`（S1-S8 全部已提交之后）
> 依据：在 commit a7891e3 上启动 API 实测 8 个车次（复刻前端真实行为：查 12306 全经停 → POST 全经停 job → 对返回 coords/stops 做逐站投影诊断）
> 执行者注意：本方案所有结论均有一手实测数据支撑，实测脚本与输出见 `rv_audit/case6_test.mjs`、`case2_test.mjs`、`case6_out.md`、`case2_out.md`。

---

## 0. 实测证据总表（先看这个）

| 车次 | 实际执行路径 | server 是否丢站 | 最差站投影 | 最大相邻点跳变 | 结论 |
|---|---|---|---|---|---|
| K512 广州白云→杭州南 | 走廊短路：精品路网（湛海+广茂+京广+沪昆） | 否 | 金华 51.7km / 海口 40km / 韶关东 31.6km | **110.8km** | 几何不走京广广韶段（英德/韶关东/乐昌整段被跳过） |
| K149 上海松江→南宁 | 走廊短路：精品路网（沪昆+京广+湘桂） | 否 | 井冈山 **112.1km** / 吉安 76.9km / 茶陵南 75.5km | 67.5km | 该走吉衡线，被拼成京广方向大绕行；茶陵南/攸县南/安仁/衡阳 4 站挤在同一投影点 |
| C650 鄂尔多斯→呼和浩特 | 走廊短路：精品走廊（呼准鄂） | 否 | 东胜东 17.1km | 7.7km | 走廊折线不经过东胜东站坐标 |
| K1117 包头→北京丰台 | 走廊短路：精品路网（包西+太中银+石太+京广） | 否 | 阳泉北 25.2km / 榆林 23.3km | 7.9km | 走廊折线偏移 |
| G7274 芜湖→上海 | 走廊短路：精品路网（宁安城际+**沪宁沿江高铁**） | 否 | 苏州 **43.9km** / 镇江 37.1km / 上海 34.8km | 6.1km | **串线**：G7274 走京沪高铁沪宁段，拼线用了沪宁沿江高铁（南线） |
| K771 呼和浩特→福州 | **S3 拓扑引擎**（唯一走对路的） | **是：西峡无坐标被剔除** | 其余 26 站全部 **0.0km** | 15.4km | 拓扑质量碾压走廊拼线；首次计算 >300s（超时后二测命中缓存 5s） |

**三个决定性事实：**
1. server 从不丢"有坐标"的站；用户看到的"漏站"= **折线几何偏离站坐标 9~112km**（站标画在真实位置，线不过站 → 视觉漏站）。
2. 用户报的案例中，**没有任何一个走到 S3 拓扑引擎**——全部在 `runJob` 步骤 1 的走廊/路网短路就返回了。
3. 唯一走到拓扑的 K771，25/25 段全成功、26 站投影全部 0.0km——**S3 引擎就是正确答案，但它几乎没机会执行**。

---

## 1. 根因分类（对照：数据源缺失 / 站点排序 / 连线插值 / 代码逻辑）

### 1.1 代码逻辑缺陷（主凶，优先修）

**A. 执行优先级倒置：走廊短路截胡拓扑引擎**
- 位置：`apps/api/src/services/railGeometryJob.ts` → `runJob()`
- 步骤 1（L343-388）：`matchCorridor` → `sliceCorridorForStops` → 命中即 `finishJob` 返回；再 `matchCorridorNetwork` → 命中即返回。
- 步骤 1b（L394 起）：S3 拓扑 `topoRouteStops` —— **只有走廊/路网都失败才执行**。
- 后果：246 条精品走廊覆盖的 OD，S3 引擎零生效。本轮 8 案例中 5 条走捷径、1 条超时后才走拓扑。

**B. 走廊短路没有任何"过站质量门禁"**
- 位置：`apps/api/src/services/corridorNetwork.ts` → `validateNetworkCoords()`（L739-786）
- 现有阈值全面过松，实测全部放行：

| 校验项 | 现值 | 实测放行的坏结果 |
|---|---|---|
| OD 贴近 | ≤45km | K512 海口起点偏 40km ✅放行 |
| 经停贴线 `corridorFitsStops(45)` | **55% 的站 ≤45km 即通过** | G7274 的 8 个偏离站全部 ≤45km，100%"合格"✅；K149 十几个偏离站 ✅ |
| 相邻点跳变 `maxAdjacentJumpKm` | ≤**280km**（BRIDGE_MAX_KM） | K512 的 110.8km 跳变 ✅放行 |
| 相对示意线偏离 | ≤**140km**（MAX_SCHEMATIC_DEV_KM） | K149 井冈山 112km ✅放行 |
| 进度单调 `stopsProgressMostlyMonotonic` | 回退 ≤0.04，**且投影 >45km 的站直接 `continue` 跳过** | K149：吉安/井冈山/茶陵南这些偏 50-112km 的站**免检**；茶陵南→攸县南→安仁→衡阳 idx 挤在同一位置 ✅放行 |

- S1 的 `validateWholeTripPath` 门禁只挂在老贪心分支（L452-482），走廊/路网分支（L343-388）裸奔。

**C. 走廊切片不锚定车站坐标**
- 位置：`corridorNetwork.ts` → `sliceBetween()`/`matchCorridorNetwork` 拼线段（L992-1007）
- `slicePolylineByOd(走廊折线, 站A坐标, 站B坐标)` 按**投影进度**切片：站坐标距走廊 >投影容差时，切片起点/终点是走廊上的最近投影点，**不是站坐标本身** → 站标必然悬空。拓扑引擎的 `routeStops` 是"段折线=[站A,...路径,站B]"构造性锚定，走廊切片没有等价物。

**D. 无坐标站被静默剔除 → 真漏站**
- 位置：`apps/api/src/routes/railGeometry.ts` → `resolveStops()`（L60-62）`filter(s => s.lng != null && s.lat != null)`
- K771 的"西峡"因此从 job stops 中消失 → 拓扑不经过 → 前端 `TripMap.vue` 站标渲染（只画 `s.lng != null`）也不画 → 实体漏站。
- `unresolvedStops` 虽已回传，但前端无醒目提示，用户只看到"少了一个站"。

### 1.2 数据源缺失（真实存在，但只占次要份额）

| 缺口 | 证据 | 影响 |
|---|---|---|
| `stations-geo.json` 覆盖 1294/3388 = **38%** | 西峡 geocode 失败（K771） | 无坐标站被剔除，真漏站 |
| 湛海线走廊缺海口段（轮渡/过海段） | K512 起点（海口）投影 40km | 起点悬空 |
| 呼准鄂走廊缺东胜东 | C650 投影 17.1km | 站标悬空 |
| 京广线走廊缺英德—韶关东—乐昌段 | K512 跳变 110.8km，三站投影 28-32km | 整段跳线 |
| 走廊图缺吉衡铁路（吉安—衡阳） | K149 被迫用京广拼，井冈山偏 112km | 大绕行 |
| 沪宁地区走廊歧义：京沪高铁沪宁段 vs 沪宁沿江高铁 | G7274 串线，苏州偏 43.9km | 串线绕行 |

### 1.3 连线/插值算法问题

- 走廊拼线的接缝逻辑（`transfers` + `appendUnique`）允许段间跳接 ≤280km（本意为跨江/跨线换乘），但**段内**投影跳变也适用同一阈值 → K512 广韶段被当"接缝"放行。
- 切片按投影进度：平行线、枢纽多线并场处投影点漂移 → K149 四站同 idx 的"顺序错乱"假象（12306 顺序本身正确保留，无需排序修复，修复目标让几何服从站序）。

### 1.4 站点排序问题

- **不存在**。12306 经停顺序全链路正确保留（`tripStore` → job → 返回 stops 顺序一致）。"乱序"均为几何投影堆叠的视觉假象，修几何即可。

### 1.5 审计工具缺陷（绿灯假象的来源）

- `scripts/audit-routes.mjs` → `auditTrainViaJob` **只传起终 2 站**（`[{from},{to}]`），不查 12306 经停：
  - 2 站 OD 的走廊命中率高、投影偏差小 → audit 全绿；
  - 而前端真实行为是全经停提交 → 走廊匹配路径完全不同 → 偏差爆发。
- 这解释了"每轮修完 audit 通过、用户一测还是烂"。

---

## 2. 为什么反复修改仍未收敛（架构层答案）

1. **修的代码没被执行**。S3 拓扑引擎（S3/S6/S7 投入最大的部分）被走廊短路截胡，生产流量根本到不了。改引擎参数、调 env 开关对命中精品路网的 OD 无效。
2. **门禁体系只覆盖了一条支路**。S1 门禁（validateWholeTripPath）只护"老贪心"分支；走廊/路网短路分支无门禁，且其内部校验阈值（45km/55%/280km/140km）定位是"拦灾难性错误"，而用户可感知的漏站阈值是 **8-10km**。
3. **审计工具与真实行为脱节**（2 站 vs 全经停），每轮验收都是绿灯假象，形成"修了→验过→没修好"循环。
4. **数据层无自检机制**。走廊缺段缺站（湛海/呼准鄂/京广广韶/吉衡）靠用户截图逐条打补丁（S4 贵南就是这样），没有"hints 站与折线互检"的批量体检，缺多少永远不知道。
5. **两套引擎质量天差地别但同权重竞争**。实测：拓扑 26 站投影全 0.0km vs 走廊拼线动辄 40-112km——优先级却是走廊在前。

---

## 3. 修复后的目标行为规则（写进代码注释与验收）

1. **经停顺序**：以 12306 经停序列为唯一顺序源；job 返回 stops 的顺序、数量必须与 12306 一致（unresolvedStops 除外，且必须显式回传）。
2. **相邻站连线**：每段折线必须"站坐标锚定"——段起点=站 A 坐标、段终点=站 B 坐标，中间沿真实轨道数据。拓扑 `routeStops` 已实现；走廊切片补齐同样语义（见 P0-3）。
3. **折返判定**：任一有坐标站相对前一站的投影进度回退（按投影 idx 计），**回退超过该站与前站折线里程的 10%（且 >3km 折线长度）即判折返**，该结果拒绝。
4. **分级阈值**（替换现有灾难级阈值）：

| 指标 | 普速 K/T/Z | 高铁 G/D/C |
|---|---|---|
| 经停站投影距离（站级门禁） | ≤10km | ≤6km |
| OD 起终点投影 | ≤12km | ≤8km |
| 段内相邻点跳变 | ≤60km | ≤40km |
| 段间接缝跳变（仅限标注 transferHubs 处） | ≤120km | ≤80km |
| 折线里程 / 站间弦长和 | 1.0 ~ 1.7 | 1.0 ~ 1.5 |

---

## 4. 修复项清单（文件 / 函数 / 变量 / 思路）

### P0-1 走廊/路网短路加"站级门禁"（一处改动，全局生效，最先做）

- **文件**：`apps/api/src/services/corridorNetwork.ts`
- **改动**：
  1. `validateNetworkCoords()` 重写：
     - 新增常量 `VIA_STRICT_KM = 10`、`VIA_HSR_KM = 6`、`OD_STRICT_KM = 12`、`OD_HSR_KM = 8`（按 `isHighspeedTrain(trainCode)` 分级，trainCode 需透传进来——当前签名没有，从 `matchCorridorNetwork` 的 opts 补传）；
     - `corridorFitsStops(coords, stops, 45)` 替换为**逐站硬校验**：每个有坐标站投影 ≤ 对应 VIA 阈值，**一个超即 fail**（删除 55% 比例逻辑——那是 touch 判定的语义，不该用在质量门禁）；
     - `maxAdjacentJumpKm` 拆两级：段内 ≤60km；接缝（transfers 位置前后 1 点）≤120km。实现：拼线时记录每个接缝在 coords 中的下标，校验时跳过这些下标的跳变检查、单独用接缝阈值；
     - `stopsProgressMostlyMonotonic`：删除 `if (proj.distKm > maxKm) continue`——投影超阈值的站先判 fail（因为逐站硬校验已拦），单调检查必须覆盖全部站；
     - OD 阈值 45 → 12/8。
  2. `matchCorridorNetwork` 的两处 `validateNetworkCoords` 调用（L832、L1008）透传 `trainCode`。
- **文件**：`apps/api/src/services/railGeometryJob.ts`
- **改动**：`runJob` 步骤 1 的 `sliceCorridorForStops` 成功分支（L348）与 `matchCorridorNetwork` 成功分支（L365）在 `finishJob` 前，各自增加同一站级门禁校验（单走廊分支当前完全没有校验，直接用 P0-1 的逐站校验函数，抽成 `corridorNetwork.ts` 导出的 `validateStopsOnCoords(coords, stops, trainCode): {ok, worstStop, worstKm}`）。
- **预期效果**：K512/K149/C650/K1117/G7274 的现有拼线结果全部被拒 → 落入 1b 拓扑 → 按实测 K771 的质量（全站投影 0.0km）修复用户报的全部漏站/绕行/串线。

### P0-2 调整 runJob 优先级：拓扑优先，走廊降为兜底

- **文件**：`apps/api/src/services/railGeometryJob.ts`
- **改动**：把 1b 拓扑块（L394-449）整体移到步骤 1 走廊块**之前**：
  - 拓扑全成功 → done（现状逻辑不变）；
  - 拓扑部分成功 → 成功段写槽位（现状），失败段**先尝试走廊切片**（把原步骤 1 的 matchCorridor/Network 结果按段取用），走廊也没有 → 逐段 OSM；
  - 拓扑整体失败/抛错/未启用 → 保持现状顺序（走廊 → 老贪心 → 逐段）。
- **理由**：实测拓扑质量碾压走廊；走廊数据缺口（湛海/京广广韶）只有拓扑能补。走廊在拓扑部分失败时作为兜底仍有价值（它的走廊折线是 OSM 真实数据）。
- **注意**：`loadTopology()` 首次加载耗时（冷启动 ~40-60s 内存索引）——`loadTopology` 已有模块级缓存，确认只在进程首次 job 时发生一次即可；`/api/health` 不受影响。

### P0-3 走廊切片首尾锚定站坐标

- **文件**：`apps/api/src/services/corridorNetwork.ts`
- **改动**：`matchCorridorNetwork` 拼线循环（L992-1007）与 `matchSameCorridorDirect`（L823）：当站有坐标时，切片结果强制改造为 `[站坐标, ...slice中间点(去掉首尾投影点), 站坐标]`（即 `resolveStopPoint` 返回的真实站坐标替换切片首尾）。若站坐标到切片首点的距离 >VIA 阈值，说明走廊与站根本不搭，让 P0-1 门禁去拒。
- **效果**：即使将来保留走廊结果，站标也必然压线。

### P0-4 无坐标站：兜底 + 提示，不再静默消失

- **文件**：`apps/api/src/routes/railGeometry.ts`（`resolveStops`）、`apps/api/src/services/stationEnrich.ts`（enrichStopsCoords 所在文件）
- **改动**：
  1. enrich 失败的站，追加两级兜底：(a) `loadCorridors()` 的 `stationsHint` 精确名匹配取 `hubPointOnCorridor` 坐标；(b) `matchCorridorNetwork.getGraph` 里走廊图节点坐标。仍失败才进 unresolved。
  2. 前端 `apps/web/src/pages/TripMap.vue` 站标渲染处（L526-556）：对 `unresolvedStops` 中的站渲染一个"灰色空心圈 + tooltip『坐标待补』"的占位 marker（用前后站中点偏移或仅列表面板提示），杜绝"凭空消失"。
- **根治**（见 P1-6）：stations-geo 38% → 95%。

### P1-5 audit-routes.mjs 改为"全经停 + 站级断言"（防回归的关键，必须与 P0 同轮做）

- **文件**：`scripts/audit-routes.mjs`
- **改动**：
  1. `auditTrainViaJob`：先调 `/api/trains/stops` 取全经停，POST job 用**全经停**（与前端一致），保留 `--two-station` 参数仅作诊断对照；
  2. 断言集（对每个车次，全部通过才算 PASS）：
     - `stops.length === 12306经停数` 且 `unresolvedStops.length === 0`；
     - 每站投影 ≤10km（K/T/Z）/ ≤6km（G/D/C）；
     - 站投影 idx 严格单调递增；
     - 折线相邻点跳变 ≤60km（接缝处 ≤120km）；
     - `segmentsOk === segmentsTotal` 且 `status === 'done'`。
  3. DEFAULT_TRAINS 固定加入本轮 6 个案例（K512/K149/C650/K1117/K771/G7274）+ 原有 10 车次；
  4. 输出 JSON 明细（每站投影 km）到 `--csv`，方便回归对比。

### P1-6 数据层补齐与体检机制

1. **stations-geo 扩量**（`scripts/` 下已有 S5 工具链）：用 12306 车站站名全量表（约 3300+ 站）跑一遍 geocode（AMAP_KEY 已配置），38% → 目标 95%；本次实测缺"西峡"，扩量后自然修复。产物仍走 `verified` 字段标记。
2. **走廊体检脚本**（新增 `scripts/audit-corridors.mjs`）：对 246 条走廊，把其 `stationsHint` 中有坐标的站投影到走廊折线，输出投影 >10km 的站清单 → 即"走廊缺口报告"。已知会命中：湛海线-海口、呼准鄂-东胜东、京广-英德/韶关东/乐昌。修法统一：从 OSM 拉对应缺段折线**追加进走廊 railway**（参照 S4 贵南补段的提交方式）。
3. **吉衡铁路**：新建走廊（吉安—泰和—井冈山—茶陵南—衡阳方向，按 OSM railway=rail 线路提取），解决 K149 类经井冈山方向的普速车。
4. **沪宁歧义**：京沪高铁沪宁段与沪宁沿江高铁的 `stationsHint` 互相补全对方主站（镇江/丹阳/常州/无锡/苏州/昆山南 vs 常州北/江阴/太仓），`matchCorridor` 的 hints 精确匹配会自然选对；配合 P0-1 门禁双保险。

### P2-7 拓扑长线性能（K771 类 >300s 的问题）

- **现象**：27 站首次拓扑计算 >300s（K771 首测超时，结果在 330s 墙钟内完成并已缓存）。
- **文件**：`apps/api/src/services/railTopology.ts`
- **思路**（按性价比排序）：
  1. `routeStops` 相邻段 A* 共享：段 i 的搜索结果缓存中间展开节点，段 i+1 起点已在上段 closed 集内时增量扩展；
  2. `hScale=0.9` 超过可采纳界（1-LINE_BONUS=0.75）导致次优路径——在 P0-2 拓扑优先后，把 `RAIL_TOPO_H_SCALE` 默认降到 0.75（牺牲速度换最优），或实现双向 A*；
  3. 客户端 `CLIENT_PRECISE_TIMEOUT_MS`（180s）与服务端 `jobMaxMs`（segmentsTotal×10s，27 段=270s）不对齐：客户端 180s 先放弃。改客户端长线（段数>15）放宽到 300s，与 `jobMaxMs` 同源计算（前端已知 segmentsTotal）。
- **验收**：K771 冷缓存首次计算 ≤180s，或客户端在其完成前不放弃。

### P2-8 随机抽样审计模式（对齐用户的审差方式）

- `scripts/audit-routes.mjs` 增加 `--random N`：随机取 N 个车站大屏 → 每屏随机车次 → 全经停 job + 站级断言。让"用户怎么查，audit 就怎么查"。

---

## 5. 修复实施顺序与依赖

```
P0-1 门禁重写（corridorNetwork.ts + railGeometryJob.ts 调用点）
   ↓ 立即
P0-2 拓扑优先（railGeometryJob.ts runJob 重排）      ← 两者同轮提交，P0-1 单独上会大量 job 落入拓扑而拓扑未被优先，长线会更慢
   ↓
P0-3 切片锚定（corridorNetwork.ts）
P0-4 无坐标兜底 + 前端占位（railGeometry.ts / stationEnrich / TripMap.vue）
P1-5 audit 全经停化 + 断言（scripts/audit-routes.mjs） ← 与 P0 同轮，作为验收工具
   ↓
P1-6 数据补齐（stations-geo 扩量、走廊体检脚本、吉衡走廊、沪宁 hints、湛海/呼准鄂/京广缺段）
   ↓
P2-7 拓扑性能、P2-8 随机审计
```

**最小可交付里程碑**：P0-1 + P0-2 + P1-5 三项完成即可消除本轮用户报告的全部 7 个案例（依据：K771 实测证明拓扑可全站投影 0.0km）。

---

## 6. 自查清单（每轮修复后逐条跑）

### 自动断言（audit-routes.mjs 全经停模式，P1-5 落地后）
1. `node scripts/audit-routes.mjs --csv out.csv` → 16 车次全 PASS；
2. 每车次：`stops 数 === 12306 经停数`、`unresolvedStops = []`、`segmentsOk === segmentsTotal`、`status === 'done'`；
3. 每站投影 ≤10/6km（分车型）；站投影 idx 严格单调；相邻点跳变 ≤60/40km；
4. 折线里程 / 站间弦长和 ∈ [1.0, 1.7]（普速）/ [1.0, 1.5]（高铁）。

### 手工抽检（模拟用户审差）
5. 从本轮 6 案例复测：K512 地图上英德/韶关东/乐昌/衡阳/金华必须压线；K149 吉安/井冈山/茶陵南压线且无绕行大弯；G7274 镇江/无锡/苏州压线且走京沪正线不绕江北；C650 过东胜东；K1117 过鄂尔多斯；K771 过西安/渭南无折返且西峡站标出现（P1-6 扩量后）；
6. 12306 随机抽 2 个车站大屏 × 各 2 车次，目检站标全部压线、无折返圈。

### 回归保护
7. `git grep -n "corridorFitsStops"`：确认 45km/55% 语义只存在于走廊 touch 判定（nearCorridor），不出现在任何质量门禁路径；
8. `git grep -n "BRIDGE_MAX_KM"`：确认 280km 仅用于 transfers 接缝与 S7 跨站补缝语义，段内跳变阈值独立为 60/40km；
9. audit 无 `--two-station` 默认路径残留（默认必须全经停）；
10. 走廊体检脚本（P1-6-2）产出缺口报告，纳入每周例行，缺口清零前走廊结果只能作为拓扑兜底而非首选。

---

## 附录：本轮实测产物

- 诊断脚本：`rv_audit/case6_test.mjs`（6 案例）、`rv_audit/case2_test.mjs`（K771/K149 补测）
- 原始输出：`rv_audit/case6_out.md`、`rv_audit/case2_out.md`
- 复测方法：启动 API（PORT=3001）→ 脚本自动查 12306 经停 → POST 全经停 job → 轮询 → 逐站投影诊断（haversine 简化投影，与 `projectToRailway` 口径一致量级）
- 注意：本机 PowerShell 的 `Invoke-RestMethod` 受系统代理影响访问 127.0.0.1 会假性超时，回环探测一律用 `curl.exe --noproxy "*"`（排查 API 时的环境坑，非产品缺陷）。
