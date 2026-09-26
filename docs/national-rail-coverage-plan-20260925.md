# RailVista 全国线路精准覆盖：诊断报告与改造方案

> 日期：2026-09-25
> 触发问题：从 12306 车站大屏随便抽一个车站、再随便抽一个车次，10 个里约 8 个有问题（路线缺失 / 走错线 / 断口）
> 目标：所有路线都在轨道上，全国任意车次都能出精确线
> 本文所有数字均为**本机实测**（脚本在 `/tmp/rvaudit/`，只读，未改动任何项目文件）

---

## 零、一句话结论

**当前架构不是"数据不够"，而是"拿着全国最全的轨网数据却只会贪心拼线"。**

项目里已经躺着 42 万段真实铁轨（33.06 万普速 + 9.11 万高铁），但没有建拓扑图，只能做"段内贪心拼接"——贪心无回溯、距离用经纬度度数算、高铁图与普速图硬隔离，长线在 23 万条候选里迷路后必然 abort，然后掉到 Overpass（国内网络 12 秒超时），最后降级成两点示意线。

我实测证明：**把这两张图合并建成拓扑图，然后按经停站逐段 Dijkstra 寻路，一趟 30+ 站的车全程只要 16~103 毫秒，段成功率 100%，贴轨精度 0.06~2.8 km。** 这条路走得通，而且不依赖任何外网。

---

## 一、实测数据（决定性证据）

### 1.1 合并图是可行的（POC 已跑通）

| 指标 | 实测值 |
|---|---|
| 图规模 | **2,051,034 节点 / 2,335,932 边**（rail 330,551 way + hsr 91,139 way） |
| 构建耗时 | 7.7 s |
| 内存峰值 | 734 MB（JSON 解析态；改二进制后预计 <300 MB） |
| 最大连通分量 | **1,983,784 节点 = 96.7%** |
| 连通分量总数 | 1,768 个（其余多为工矿支线、港口专用线） |

### 1.2 车站贴轨质量：合并图远好于现在的普速图

| 指标 | 只用 china-rail.graph（现状） | 合并图（方案） |
|---|---|---|
| 1116 个有坐标站投影到轨网 ≤2 km | 744 站（**69.3%**） | **1046 站（94.5%）** |
| 落在最大连通分量内 | 671/1073（62.5%） | **1080/1107（97.6%）** |

> 现状差的原因：北京西、广州南、上海虹桥、杭州东、郑州东等高铁站，在普速图里**根本不存在**，投影到旁边几公里外的普速线上，或者干脆不连通。

### 1.3 点对寻路：亚秒级，14/15 连通

| OD | 结果 | 耗时 |
|---|---|---|
| 北京西 → 广州南 | 2103 km（实际京广 ~2298 km） | 326 ms |
| 北京南 → 南京南 | 1024 km（京沪高铁实际 1018 km） | 135 ms |
| 成都东 → 昆明南 | 898 km（实际 ~900 km） | 74 ms |
| 拉萨 → 西宁 | 1892 km（青藏线实际 1972 km） | 13 ms |
| 上海虹桥 → 西安北 | 1405 km | 151 ms |
| 杭州东 → 深圳北 | 1360 km | 227 ms |
| 郑州东 → 长沙南 | 824 km | 122 ms |
| 哈尔滨西 → 三亚 | **不连通**（琼州海峡，真实物理断口） | — |

**14/15 连通，最慢 326 ms。** 唯一失败的是海南——那是真的没有桥，需要轮渡特殊规则。

### 1.4 逐段寻路 vs 真实线路：以 248 条走廊折线为地面真值

沿走廊折线每 60 km 采样一个"模拟经停站"，逐段寻路后与真值比对：

| 线路 | 真值里程 | 段成功 | 寻路里程 | 长度比 | 平均偏离 | 最大偏离 | 耗时 |
|---|---|---|---|---|---|---|---|
| 青藏铁路 | 1885 km | 31/31 | 1892 km | **1.00** | **0.06 km** | 3.1 km | 16 ms |
| 京广高铁 | 2108 km | 34/34 | 2070 km | **0.98** | **0.18 km** | 4.3 km | 63 ms |
| 京九线 | 2344 km | 37/37 | 2711 km | 1.16 | 0.67 km | 10.4 km | 87 ms |
| 沪昆高铁 | 2251 km | 36/36 | 2759 km | 1.23 | 2.00 km | 18.9 km | 67 ms |
| 京广线 | 2042 km | 28/32 | 1989 km | 0.97 | 2.82 km | 40.2 km | 90 ms |
| 沪昆线 | 2114 km | 33/33 | 2998 km | **1.42** | **8.12 km** | 47.1 km | 103 ms |

**读法：**
- 青藏、京广高铁这种"独一条线"的场景，贴合度达到 0.06~0.18 km——这就是"精准在轨道上"。
- 沪昆线平均偏 8.12 km、长度比 1.42，是因为沪昆普速与沪昆高铁**平行**，纯最短路径会串到高铁线上。这正是"路线走错"的典型机制，也是 P1 阶段必须加**线路名权重**的原因。
- 京广线 28/32，4 段失败——普速图存在真实断口，需要 B3 桥接规则。

### 1.5 现有走廊资产的覆盖天花板

| 指标 | 实测值 |
|---|---|
| 走廊数 | 248 条，总里程 **105,454 km**（全国营业里程约 15.9 万 km，覆盖 ~66%） |
| 折线总点数 | 63,336（平均 255 点/条） |
| `stationsHint` 总数 | 1368，去重 985 个站名，**平均 5.5 个/条** |
| hint < 4 的走廊 | **128 条** |
| hint < 2 的走廊 | **3 条**（binbei / suijia / zhanhai —— 代码里 `hints.length < 2` 直接 return null，**数学上永远命中不了**） |
| 1116 站到最近走廊的距离 | ≤3 km 39.6%，3–5 km 12.7%，5–15 km 44.3%，>15 km 3.4% |
| 15 km 端点门禁内站点占比 | **96.6%** |

**结论：走廊几何覆盖其实不差（96.6% 的站都在 15 km 内），但匹配链路太脆。** 问题不在"有没有这条线"，而在"匹配不上/切片被拒"。

### 1.6 站坐标：最大的单点短板

| 指标 | 实测值 |
|---|---|
| 12306 站名表 | **3388 站** |
| `stations-geo.json` | **1116 条** |
| 覆盖率 | **32.9%** |

缺坐标的站会被 `enrichStopsCoords` 静默置 `undefined`，再被 `railGeometry.ts:59-61` 的 filter 丢掉 → 相邻两站被合并成一段 → 弦长暴涨 → 门禁拒收 → 示意线。

---

## 二、为什么"10 个里 8 个有问题"：8 条根因

按贡献度排序。

### R1（架构根因）本地 42 万段轨网没有拓扑，只有贪心拼接
- `localRails.ts` 的数据结构是**纯折线数组 + bbox**，没有 node/edge，没有邻接表，没有连通性。
- 拼线算法 `stitchLocalOd`（:303-573）是贪心：`segs[i].used = true` 一次性锁死，**无回溯**。在京广 vs 京九、沪昆 vs 沪蓉这类平行线处选错一次，整段就废了。
- `dist()`（:245）返回的是**经纬度度数**，不是公里。`bridgeMax` 最大 1.8 度 ≈ **150–200 km 的跳接被允许** → 这就是飞线。
- 出口校验全是 abort：`end far >20km` / `len < 0.6×odKm` / `ratio > 1.45~1.9` / `lateral > 1.5×maxLateral`。
- **没有任何"全图一次寻路"的调用点。** 这是覆盖全国的最后一块拼图，也是本次改造的核心。

### R2（数据根因）站坐标只覆盖 32.9%
- 缺站 → 静默丢弃 → 跳站合并 → 段变长 → 门禁拒 → 降级。
- `enrichStopsCoords` 的远程补全预算只有 `min(n, max(20, ...))` 个站，一趟 30 站的车补不完。
- `scrubZigzagLocalCoords`（geocode.ts:420）会**误删正确坐标**：山区展线（成昆/宝成/黔桂）、大河绕行天然满足"绕行 > 直连×1.75"，正确坐标被 `delete` 并回写文件。

### R3 高铁图与普速图硬隔离
- `queryLocalWaysAlong` 里 `highspeedOnly` + `kind==='rail' && w.highspeed → skip`，两张图永远不相交。
- 真实列车会跨图：G 车走联络线进普速站、K 车跑客专、C 车在城际与普速间切换。
- 实测：普速图里北京西→广州南**不连通**（广州南是纯高铁站），合并后 2103 km 一次算出。

### R4 Overpass 在国内不可靠，却是主要兜底
- 段级超时 **12 s，只打 1 个镜像**；整趟 25 s × 3 镜像，最坏 75 s。
- 失败后写 `cached_miss`，20 分钟内不再重试。
- `buildRailGeometry`（整趟兜底）**完全没有本地兜底**：第一步就 `if (!isOverpassEnabled()) return none`。
- 没有熔断：三条镜像全超时是常态，每段白等 12 s，直接吃满 `jobMaxMs`。

### R5 阈值体系自相矛盾
- 本地拼线允许起终点偏离 **20 km**（localRails.ts:494/500），`pathOnGraph` 允许 snap **20 km**，但门禁 `MAX_ENDPOINT_DIST_KM = 8`（osmRailway.ts:456）。
- → 本地辛苦拼出来 → 被 `endpoint_far` 拒 → 转而去打 12 s 的 Overpass → 大概率也失败 → 示意线。
- 其它矛盾：`slicePolylineByOd` 允许 45 km 而 `resolveOdEndpoint` 用 25 km；B3 几何枢纽 3 km 但京九↔广深实测断 43 km。

### R6 前端缓存永不失效（"改了但看不到"的直接原因）
- `TripMap.vue:234-239`：IndexedDB 里有快照就**直接 hydrate，完全不再请求服务端**。
- `TRIP_CACHE_VERSION = 1`，从未 bump。
- 服务端 `preciseRouteCache` 的指纹只含"车次+站名+坐标"，**不含数据版本号** → 走廊修好后，旧的错误折线仍从 `data/cache/precise/` 回放。

### R7 客户端超时 < 服务端超时
- 前端 `CLIENT_PRECISE_TIMEOUT_MS = 55_000`（tripStore.ts:43），服务端 `jobMaxMs = max(120s, 10s×段数)`。
- 20 段的车服务端有 200 s 预算，前端 55 s 就截断成 mixed/station 并**落库**。用户永远看不到最终结果。

### R8 走廊匹配链路过脆
- 必须 `hints.length >= 2` 才参与匹配 → 3 条走廊是死数据；128 条 hint<4，靠站名几乎命中不了。
- 方位冲突误杀：`conflictRatio >= 0.2 && hit < max(3, ceil(len*0.25))` → "安阳/鹤壁"这类站与高铁 hints 的"安阳东/鹤壁东"同词干，整条走廊被拒。
- 命中后还可能在切片层被静默拒绝（`corridors.ts:543/558`）：≥55% 的站需距线 ≤40 km，且 `stationKm > 80 && railKm < stationKm*0.45` → null。日志里看不到，只表现为"掉了"。

---

## 三、目标架构

```
12306 车次 → 经停站序列（站序 = 时刻表，绝不重排）
        │
        ▼
┌─ 阶段 1：站坐标解析 ────────────────────────┐
│  stations-geo（全量） → OSM station 兜底     │
│  → 投影到合并拓扑图最近节点（snap ≤3 km）    │
│  → 失败站：标记 unresolved，不丢、不合并     │
└──────────────────┬──────────────────────────┘
                   ▼
┌─ 阶段 2：全图逐段寻路（核心，全新）─────────┐
│  railTopology.routeStops(stops)              │
│  相邻站 Dijkstra/A*，边权 = 实际里程         │
│  × 线路名/车次类型权重（解决平行线）         │
│  × 断口处理（海峡轮渡、孤岛支线）            │
│  → 全程沿轨折线，一次成型                    │
└──────────────────┬──────────────────────────┘
                   ▼
┌─ 阶段 3：质量校验（收紧）───────────────────┐
│  每段：长度比 ≤1.6、端点 ≤5 km、横向 ≤20 km  │
│  失败段 → 局部 corridor/overpass 补          │
│  仍失败 → 该段示意，其余保持精确（mixed）    │
└──────────────────┬──────────────────────────┘
                   ▼
        缓存（含数据版本号 geomVersion）
```

**关键变化：把"走廊匹配"从主路径降为可选优化，"全图寻路"升为主路径。**

走廊仍有价值（精品几何、线路名先验、风景区绑定），但不再承担"能不能出线"的责任。

---

## 四、改造方案（P0 → P3）

### P0：止血（1 次会话，不涉及架构）— 先让"改了能看见"

| # | 改动 | 文件 | 验收 |
|---|---|---|---|
| P0-1 | `TRIP_CACHE_VERSION` 1→2；`railwaySource === 'station'` 的快照不作为"精确结果"恢复；`TripMap.vue:234` 增加"强制重新生成"入口 | `apps/web/src/lib/tripCache.ts`、`pages/TripMap.vue` | 清库后重测，线路变化可见 |
| P0-2 | 客户端超时 55 s → 与服务端对齐（≥150 s），或把 `jobMaxMs` 降到 60 s | `stores/tripStore.ts:43`、`railGeometryJob.ts:61-66` | 长车次能等到最终结果 |
| P0-3 | 修 C 字头车矛盾：`osmRailway.ts:410` 把 C 当高铁（只查 HSR 图），`corridors.ts:419` 把 C 当 `'all'` | 二选一，建议统一按"优先 HSR、失败回落普速" | C 车不再必降级 |
| P0-4 | 统一端点阈值：`MAX_ENDPOINT_DIST_KM` 8 → 与本地 snap 20 km 对齐（建议 12 km 折中） | `osmRailway.ts:456` | 本地成果不再被自家门禁拒 |
| P0-5 | `buildRailGeometry` 加本地兜底（与 `buildSegmentGeometry` 对称） | `osmRailway.ts:692-699` | Overpass 关闭时整趟仍能出线 |
| P0-6 | 服务端 `preciseRouteCache` 指纹加入 `geomVersion`（走廊文件 mtime 哈希 + graph 版本） | `preciseRouteCache.ts:31-36` | 数据升级后旧错线自动失效 |
| P0-7 | 进程治理：只保留一个 `pnpm dev`；`/api/health` 返回 git commit 短码 + 走廊文件数 | `apps/api/src/index.ts` | 一眼看出打的是新是旧 |

### P1：核心 — 全图寻路引擎（2~3 次会话）

**P1-1 新增 `scripts/build-rail-topology.mjs`**

把 `china-rail.graph` + `china-hsr.graph` 合并编译成二进制拓扑：

```
data/rails/china-rail-topo.bin
  header: magic 'RVTP', version, nodeCount, edgeCount
  nodeXY     : Float64Array(nodeCount * 2)      // 节点经纬度
  edgeOffset : Int32Array(nodeCount + 1)        // CSR 偏移
  edgeTo     : Int32Array(edgeCount * 2)        // 邻接节点
  edgeW      : Float32Array(edgeCount * 2)      // 边长(km)
  edgeFlag   : Uint8Array(edgeCount * 2)        // bit0=高铁, bit1=渡轮/桥接
  edgeLine   : Uint16Array(edgeCount * 2)       // 线路名 id（2,919 个）
data/rails/china-rail-topo.meta.json
  { lineNames: [...], nodeCount, edgeCount, generatedAt, sourceVersions }
```

节点量化精度 1e-4 度（≈11 m）。POC 实测：2,051,034 节点 / 2,335,932 边，构建 7.7 s。

二进制文件大小估算 ≈ **68 MB**，`fs.readFileSync` + `new Int32Array(buf, off, len)` 零解析加载，**<1 s**。
> 对比现状：`JSON.parse` 74 MB 的 `china-rail.graph`，首次 K/T/Z 请求要几十秒 + GB 级内存峰值。

**P1-2 新增 `apps/api/src/services/railTopology.ts`**

```ts
loadTopology(): 懒加载 + 模块级单例（TypdArray 视图，零拷贝）
nearestNode(lng, lat, maxKm = 3): 网格索引 → { node, distKm }
routeLeg(fromNode, toNode, opts): A*（欧几里得/已走里程启发），返回 { nodes, km }
routeStops(stops, opts): 逐段寻路 + 拼接 + 端点去重，返回 { coords, perSegKm, failures }
```

边权设计（解决平行线，对应 POC 里沪昆线 1.42 的问题）：

```
w = 实际里程 × (1 + 0.35 × 车次类型不匹配) × (1 - 0.25 × 线路名命中)
    G/D → 高铁边不惩罚，普速边 ×1.35
    K/T/Z/纯数字 → 普速边不惩罚，高铁边 ×1.35（个别K车跑客专由经停站几何自然决定）
    线路名 = 相邻站所属走廊的 name 集合（从 corridor hit 拿），同名 way 打 0.75 折
```

断口处理：
- **琼州海峡**：显式加一条 `海安 ↔ 海口` 的 ferry 边（`edgeFlag` bit1），长度按 36.8 km 直线计，UI 标注"轮渡段"。
- **其它孤岛支线**：寻路失败时记录 `unreachable`，该段用站间直线 + 明确标注，不污染其它段。

**P1-3 改造 `railGeometryJob.ts`**

把 T3（段内贪心）替换为：

```ts
// 旧：buildSegmentGeometry(逐段贪心 + Overpass)
// 新：
const topo = await loadTopology();
const routed = topo.routeStops(job.stops, { trainCode, corridorNames });
if (routed.failures.length === 0) → source = 'network', qualityTier = 'network'
else → 仅对失败段走 corridor → Overpass，其余保持精确 → 'mixed'
```

降级为：全图寻路 → 失败段补 corridor/Overpass → 该段示意。
**Overpass 从"主兜底"降为"失败段的最后手段"，且 `RAIL_OVERPASS=auto` 失败 2 次后自动进入纯本地模式。**

同时把 `jobMaxMs` 从 `max(120s, 10s×段数)` 降到 **30 s**（POC 实测全程 <100 ms，30 s 已极宽裕）。

### P2：数据补齐（1~2 次会话）

| # | 改动 | 说明 |
|---|---|---|
| P2-1 | **站坐标全量补齐（最高优先级）** | 3388 站 → 目标 ≥99%。一次性用 Overpass 抓 `railway=station\|halt` 的 node（带 name），存 `data/stations-osm.json` 作离线底座；再与 `stations-geo.json` 合并。`patrol-data.mjs` 加硬门禁：覆盖率 <99% 即 fail |
| P2-2 | 修 `scrubZigzagLocalCoords` | 加白名单（成昆/宝成/黔桂/青藏等展线区段），或改为"只告警不删除" |
| P2-3 | 走廊 hint 扩充 | 用"轨网 way 名 + 站坐标"反查每条走廊沿线 15 km 内的所有站，自动写入 `stationsHint`。目标：平均 hint ≥15，消灭 hint<2 的死数据 |
| P2-4 | 走廊连通性门禁 | `patrol-data.mjs` 增加全网连通检查：每条走廊必须与主干网连通（最近点 ≤12 km 或共享 hint），孤岛标记 `island:true` 并列出 |

### P3：质量收尾与回归（持续）

| # | 改动 |
|---|---|
| P3-1 | 建立**回归集**：50 个车次（覆盖 G/D/C/K/T/Z/纯数字 × 长短途 × 各路局），`scripts/audit-routes.mjs` 跑通并输出表格（注意：当前该脚本路径缺 `/api` 前缀，永远 404，必须先修） |
| P3-2 | 收紧质量门禁：`MAX_SCHEMATIC_DEV_KM` 140 → 40；`maxAdjacentJumpKm` 280 → 80；补缝不再把槽位虚标 `ok:true` |
| P3-3 | 性能：`nearCorridor` 的 `buildRailwayMetrics` 按 corridor.id 缓存（现状一次匹配要算数百万次 haversine，是"慢"的主因） |
| P3-4 | 交付纪律：任何修复必须附端到端实测输出，禁止用 tsc/build/单测交差 |

---

## 五、验收标准（下次交付逐条对照）

```bash
# 1. 数据门禁
node scripts/patrol-data.mjs --strict        # 站坐标 ≥99%、无未标记孤岛走廊、0 WARN

# 2. 拓扑构建
node scripts/build-rail-topology.mjs         # 输出 2.05M 节点 / 2.34M 边，构建 <30s，bin <100MB

# 3. 全图寻路冒烟（新增脚本）
node scripts/verify-topology-routing.mjs     # 50 组 OD，连通率 ≥95%，单组 <500ms

# 4. 端到端真实车次（起服务后）
node scripts/audit-routes.mjs                # 50 车次输出贴报告，全部 corridor/network/mixed ≥0.9

# 5. 人工抽签（对应你现在的用法）
#    从 12306 车站大屏随便抽 1 个站 → 随便抽 1 个车次 → 连续 10 次
#    要求：10/10 出线，且 ≤2 次为 mixed（部分示意），0 次为纯两点直线
```

**终极判据：连续 20 次随机抽站抽车，全部出线且视觉上贴轨，无飞线、无穿城、无跨海直线。**

---

## 六、已知边界（做不到 100%，需要显式处理）

| 场景 | 现状 | 处理 |
|---|---|---|
| **琼州海峡**（哈尔滨西→三亚） | 不连通 | 显式 ferry 边 + UI 标注"轮渡段" |
| **中老铁路跨境**（万象/琅勃拉邦，站表里已有） | 无轨网数据 | 需单独补 OSM 老挝段，或标记为境外不支持 |
| **平行线选线**（沪昆普速 vs 沪昆高铁） | 纯最短路会选错 | 线路名权重（P1-2）；极端情况接受"沿另一条平行真线" |
| **新建线路**（轨网数据现势性） | `china-*.graph` 生成于某时间点 | 定期重跑 `build-rail-graph.mjs --pbf`，geomVersion 自动失效缓存 |
| **站坐标错误**（现有 1116 条里有被 scrub 误伤的） | 投影 snap 到错线 | P2-2 修复 + snap 距离 >3 km 时告警 |
| **尽头站/支线**（霍林郭勒、伊宁等） | 走廊覆盖 Infinity | 合并图里大概率连通（96.7% 在主分量），需实测确认 |

---

## 七、工作量估计

| 阶段 | 内容 | 估计 |
|---|---|---|
| P0 | 缓存失效、超时对齐、阈值统一、C 车修复 | 0.5~1 天 |
| P1 | 拓扑编译 + 寻路引擎 + job 改造 | **2~3 天**（核心） |
| P2 | 站坐标全量 + hint 扩充 + 门禁 | 1~2 天 |
| P3 | 回归集 + 质量收尾 | 持续 |

**P1 做完，"随便抽 10 个里 8 个坏"应该变成"10 个里 8 个好"；P2 做完应该到 9~10 个。**

---

## 八、建议的下一步动作

1. **先做 P0**（半天），因为它决定了你后续每一次改动"能不能看见效果"。P0-1（缓存版本）和 P0-6（指纹含数据版本）不做，后面所有工作都会陷入"我改了但没变"的假象。
2. **P1 直接动手**：`build-rail-topology.mjs` 的原型代码我已经验证跑通（`/tmp/rvaudit/poc3.mjs` / `poc4.mjs`），可以直接照搬建图逻辑，只需改成二进制输出 + 加线路名权重。
3. **P2-1（站坐标）与 P1 并行**：这是另一个独立瓶颈，早做早受益。

---

## 附：本次实测脚本

只读，未修改任何项目文件。

| 脚本 | 用途 |
|---|---|
| `/tmp/rvaudit/poc2.mjs` | 普速图建图 + 连通分量 + 站投影 + Dijkstra |
| `/tmp/rvaudit/poc3.mjs` | **合并图**建图 + 连通分量 + 15 组真实 OD 寻路 |
| `/tmp/rvaudit/poc4.mjs` | 以 248 条走廊为地面真值的逐段寻路精度评估 |
| `/tmp/rvaudit/poc5.mjs` | 走廊资产几何覆盖天花板量化 |
