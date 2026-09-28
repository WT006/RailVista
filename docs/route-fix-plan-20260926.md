# RailVista 路线拟合问题修复方案（2026-09-26）

> 审查对象：commit `b8a9239`（"National rail coverage: P0+P1+P2 implementation"，GLM 于 09-25 23:13 提交）
> 方法：通读本次提交全部 22 个文件 diff + 用本地数据对 6 个用户案例逐一实测定位（脚本只读，未改任何代码）
> 本文所有结论均带 file:line 证据，可直接按步骤执行。

---

## 〇、总判断（先读这里）

**昨晚的 P1 交付有一处严重回归，必须最先修：**

`railGeometryJob.ts:369-394` 新增的 `findWholeTripLocalPath`（`localRails.ts:625-662`）**不是全图寻路**——它只用起终两个站的坐标，沿两点直线撒 48 个采样点，然后调用**同一个老贪心** `stitchLocalOd`。三个致命缺陷：

1. **完全无视中间经停站**。只要贪心拼出任何一条线，就把全部槽位标成 `ok: true, reason: 'local:whole'`，`segmentsOk = segmentsTotal`，前端显示"精确"。
2. **没有任何质量门禁**：不校验路径是否经过经停站、不校验长度比、不校验横向偏离。
3. **`job.source = 'osm'` 是伪造的**（它根本没访问 OSM）。

用户案例 1（T270 喀什→西安"未经过西宁等应经由的节点"）就是这个函数制造的：T270 经停表里有西宁（兰新高铁通道），但整趟贪心沿"喀什→西安"直线采样窗把青海境内的青藏线/兰新线 ways 捞进候选池，拼出一条绕开西宁的线，然后标记为 24/24 全部精确。**截图里青海省境内的孤立黄点（西宁站）脱离蓝线，就是直接证据。**

这比"失败"更糟——它把"走错线"伪装成"成功"，并且会写进磁盘缓存长期回放。

**其余案例归因（实测数据见 §一）：**

| 案例 | 根因编号 |
|---|---|
| 1. T270 喀什→西安 不过西宁、节点缺失 | **C1**（伪全图寻路） |
| 2. G7316 黄山北→扬州东 拟合偏差明显 | **C2**（无自动升级，初始为站序示意线） |
| 3. G3838 吉安西→北京西 需手动点击 | **C2** + **C4**（南昌西缺坐标削弱走廊链） |
| 4. C8902 西安东→延安 拟合差 | **C2** + **C5**（包西走廊 hint 仅 2 条）+ C6 |
| 5. G3351 延安→南宁东 贵阳东→河池西缺口 | **C3**（贵南高速线轨网缺贵阳北段）+ C5（延安端无走廊） |
| 6. Z267 呼和浩特→上海 22/24 | **C7**（枢纽段贪心/Overpass 失败 + 无自动重试） |

---

## 一、实测证据（本机跑通，全部可复现）

### E1 贵南高速线轨网缺北段（案例 5 的根因）

对 `china-hsr.graph` 中 name 含"贵南"的 841 段 ways 统计：

| 项 | 值 |
|---|---|
| 折线纬度范围 | **lat [22.84, 26.47]** |
| 贵阳北 (26.622) 距该折线 | **33.9 km** |
| 贵阳东 (26.668) 距该折线 | **31.4 km** |
| 河池西 / 荔波 / 南宁东 距该折线 | 0.0 / 0.0 / 0.3 km |

→ 轨网里贵南高速线北端只到 26.47（约龙里北），**缺贵阳北—龙里北联络段（约 20 km）**。段级寻路时"贵阳东→河池西"的起点 snap 上限 20 km 够不到轨网 → 该段失败 → 14/15。
→ 而 `corridors/guinan.json` 走廊折线是**完整的**（其北端点距沪昆高铁走廊 0.1 km、距成贵 0.0 km）。**走廊有、轨网没有**——典型的"graph 数据落后于 corridor"。

### E2 关键站坐标实测（stations-geo.json，现为 1252 条 / 3388 站 = 37%）

- 缺失关键站：**南昌西**（G3838 京九走廊链上的必经枢纽）。
- 已有：西安东、延安、贵阳东、河池西、黄山北、扬州东、吉安西 等。

### E3 走廊 hints 稀疏（案例 4 的根因之一）

| 走廊 | hints 数 | 后果 |
|---|---|---|
| 包西线 baoxi.json | **2** | C8902 西安东→延安同步路径 T1 miss |
| 陇海线 longhai.json | **2**（连云港/兰州） | 东陇海段车次 T1 miss |
| 太焦线 taijiao_conv/xian | **2** | 同类问题 |
| 兰新线 lanxinxian.json | 12，但**只到乌鲁木齐** | 喀什距兰新线走廊 1066 km → T270 首端无法归属任何走廊 |

### E4 轨网本身覆盖是好的（别再怀疑数据）

- 包西**高速线**（hsr 图）314 段，范围 lng[108.95,109.48] lat[34.22,36.56]，**西安东距 0.1 km、延安距 0.0 km** → C8902 的轨完全在图里，失败在算法与流程，不在数据。
- 贵南高速线 841 段（除北段缺失外覆盖完整）。

### E5 前端确认无自动升级

- `tripStore.ts:375` `upgradePrecise()` 唯一调用点是 `TripMap.vue` 的按钮回调 `onUpgradePrecise()`（TripMap.vue:728）。
- 进入行程页时只做 `hydrateFromSnapshot`（tripStore.ts:278），示意线快照或新行程**永远不会自动创建 job**。
- `tripStore.ts:43` `CLIENT_PRECISE_TIMEOUT_MS = 55_000` 仍在：服务端预算 `max(120s, 10s×段数)`，24 段 = 240 s，前端 55 s 就截断——长车次即使点了按钮也经常拿不到完整结果，且截断结果会落 IndexedDB。

### E6 `local:whole` shortcut 的调用顺序

`runJob` 中顺序为：T0 热门缓存 → T1 单走廊 → T2 走廊网络 → **1b 整趟贪心 shortcut（新）** → 逐段 → 补缝 → 整趟 Overpass。
即：只要 T1/T2 都 miss（全国大多数车次），整趟贪心就有机会"一次成功"并把逐段逻辑全部短路掉。**这正是"10 个里 8 个有问题"变成"10 个里 8 个走错但显示精确"的机制。**

---

## 二、问题清单

> 严重度：🔴 必须立即修 / 🟠 本迭代必须 / 🟡 应修

### C1 🔴 伪"全图寻路"把走错线标记为全部精确
- **位置**：`apps/api/src/services/railGeometryJob.ts:369-394`（调用与结果短路）、`apps/api/src/services/localRails.ts:625-662`（实现）
- **现象**：T270 喀什→西安等车次路线绕开经停站（西宁孤点脱离线）；前端显示"精确/24 段全通"但几何错误。
- **根因**：① 只喂起终两点，不经停站约束；② 成功即全槽位 `ok:true`，无中间站/长度比/横向偏离校验；③ `job.source = 'osm'` 伪造；④ 只查单图（preferHs 一票决定 hsr 或 rail），跨图失败。
- **影响范围**：所有 T1/T2 miss 后进入 job 的车次（即全国大多数车次）。
- **严重度**：🔴（新引入回归 + 污染磁盘缓存 `data/cache/precise/`）

### C2 🔴 前端无自动精准升级
- **位置**：`apps/web/src/stores/tripStore.ts`（hydrateFromSnapshot:278、upgradePrecise:375）、`apps/web/src/pages/TripMap.vue`（onUpgradePrecise:728、showPreciseAction:106）
- **现象**：G7316、G3838、C8902 初始都是站序示意线，需手动点"获取精确路线"。
- **根因**：无自动触发逻辑；且 `CLIENT_PRECISE_TIMEOUT_MS=55s`（tripStore.ts:43）远小于服务端预算，长线即使手动也常截断。
- **影响范围**：全部未命中走廊的车次（首次进入行程的默认体验）。
- **严重度**：🔴（用户明确要求"自动获取精准路线"）

### C3 🟠 贵南高速线轨网缺贵阳北段
- **位置**：`data/rails/china-hsr.graph`（贵南高速线 ways 北端 26.47）
- **现象**：G3351 延安→南宁东 14/15，贵阳东→河池西缺口。
- **根因**：graph 构建时的 OSM 数据缺该段（或 tags-filter 漏了联络线）；段级 snap 上限 20 km 无法从贵阳东/贵阳北够到轨网；T2 走廊网络因延安端无任何走廊命中而 miss，走廊的完整几何用不上。
- **影响范围**：所有经贵南高铁的车次（贵阳↔南宁方向）。
- **严重度**：🟠

### C4 🟠 站坐标覆盖 37%（1252/3388），枢纽站缺失
- **位置**：`data/stations-geo.json`
- **现象**：南昌西缺失 → G3838 京九走廊切片与拟合校验被削弱（"南昌"在 hints 而"南昌西"触发方位冲突逻辑，corridors.ts:163/305）；其它缺站车次静默丢站 → 跳站合并 → 段变长失败。
- **根因**：GLM 上次只做了 116 条"离线部分回填"（1116→1232→现为 1252），没有批量数据源；`patrol-data.mjs --strict` 门禁阈值已设 99% 但从未跑过/从未拦截交付（当前 37%）。
- **严重度**：🟠

### C5 🟠 走廊 hints 稀疏且不含实际经停枢纽
- **位置**：`data/presets/corridors/baoxi.json`（2 条）、`longhai.json`（2 条）、`taijiao_*.json`（2 条）等约 128 条 hint<4 的走廊
- **现象**：C8902、T270 等在同步路径 T1 就 miss，直接示意线。
- **根因**：hints 靠手工维护（`scripts/expand-corridor-hints.mjs` 的 CANDIDATES 表只覆盖少数线），没有自动扩充。
- **严重度**：🟠

### C6 🟡 C 字头车匹配矛盾（遗留未修）
- **位置**：`apps/api/src/services/osmRailway.ts:410`（`isHighspeedTrain` 含 C）vs `corridors.ts:420`（C → filterKind 'all'）
- **现象**：跑普速线的 C 车在段级只查 hsr 图 + Overpass 只查 `highspeed=yes` → 必败；C8902 恰好走包西高速线所以数据层能救，但跑普速的 C 车仍会失败。
- **严重度**：🟡

### C7 🟡 枢纽段逐段失败且需手动"重试缺口"
- **位置**：`railGeometryJob.ts`（bridgeFailedSegments / tryWholeTripFallback）、`TripMap.vue`（重试缺口按钮）
- **现象**：Z267 22/24，剩余 2 段需手动重试。
- **根因**：段失败原因未分类（数据缺/贪心迷路/门禁拒），无自动重试；部分失败属 Overpass 偶发超时，重试即可成功。
- **严重度**：🟡

### C8 🟡 同步路径无逐段能力（遗留）
- **位置**：`routes/railGeometry.ts`（POST / 的 mode='preset' 分支）
- **现象**：首次进入行程只有 T1/T2 两级，miss 即示意线。
- **说明**：C2 修好后此问题被掩盖（job 自动跑），不必单独大改；S3 完成后可在同步路径增加一次"拓扑快速寻路"（见 S6 可选项）。
- **严重度**：🟡

---

## 三、改造步骤（按优先级与依赖排序）

> 每步独立可交付。S1、S2 无依赖可并行；S3 依赖 S1（先止血再换引擎）；S4/S5 独立；S6/S7 依赖 S3/S5。

### S1（P0）给 `local:whole` 加质量门禁，修 source 伪造

**改什么**：`apps/api/src/services/railGeometryJob.ts:369-394`

1. `wholePath` 拿到后、写槽位前，增加校验，任一不过就放弃 shortcut（`return null` 语义，落到逐段流程）：
   - **中间站覆盖**：`job.stops` 中每个有坐标的站（除首末）到 wholePath 的最小距离 ≤ `Math.max(10, spanKm * 0.02)` km（如喀什→西安 spanKm≈2900 → 阈值 58 km；西宁距贪心线必然超限）。逐站用现成的点到折线投影（`packages/shared` 的 `projectToRailway`）。
   - **长度比**：wholePath 总里程 / 站序折线里程 ≤ 2.0。
   - **进度单调**：每个经停站沿 wholePath 的投影进度随站序非递减（容差 0.05）。
2. 拒绝时打日志：`[rail-job] whole-trip rejected: stop 西宁 off path 87km`（方便排查）。
3. `job.source = 'osm'` 改为 `'local'`：需同步把 `apps/web/src/api/client.ts:25/52` 的 source 联合类型扩展 `'local'`，前端 UI 将 `local` 与 `osm` 同等展示为"精确"（`TripMap.vue` 的 railwaySource 判断处）。
4. **清污**：删除 `data/cache/precise/` 中 `reason` 含 `local:whole` 的缓存条目（写一段 `scripts/scrub-whole-trip-cache.mjs`，遍历 JSON 检查 message/segments reason），并在 `preciseRouteCache.ts` 的读取校验中拒绝 `qualityTier==='local'` 且无中间站校验版本号的旧条目——最简单的做法：`CACHE_TTL_PRECISE_HOT_SEC` 的内存键 `precise-hot:v3:` bump 到 `v4:`，磁盘指纹加入 `geomVersion` 常量并 bump。

**为什么**：当前它正在制造"走错线但 24/24 精确"的假结果并落缓存，比示意线更糟；这是用户案例 1 的直接原因。

**预期效果**：T270 类车次不再出现绕开经停站的假精确；要么贴线，要么自动回退逐段流程。

**验收**：
```bash
node scripts/scrub-whole-trip-cache.mjs   # 输出清理条目数
# 起服务后跑 audit（见 §四 R1 清单），T270 断言：
#   每个经停站到最终折线距离 ≤ 15km；不存在 reason 含 local:whole 且未过校验的槽位
```

### S2（P0）前端自动精准升级 + 超时对齐

**改什么**：`apps/web/src/stores/tripStore.ts`、`apps/web/src/pages/TripMap.vue`

1. tripStore 增加 `const autoUpgradeTried = ref<string>('')`（存 trip key）。
2. `hydrateFromSnapshot` 末尾与"选车进入行程"的入口处（`enterTrip`/设置 segment 后的公共路径）加：
   ```ts
   const key = `${trainCode}|${date}|${fromName}|${toName}`;
   if (autoUpgradeTried.value !== key
       && (railwaySource.value === 'station' || canUpgradePrecise.value)
       && !(snap && snap.preciseStatus === 'done')) {
     autoUpgradeTried.value = key;
     void upgradePrecise();
   }
   ```
3. `upgradePrecise` 完成后若 `status === 'partial'` 且 `segmentsOk < segmentsTotal`，延迟 3 s 自动调用一次 `retryFailedOnly`（tripStore.ts:397-404 已支持）；仍 partial 则停，保留手动按钮。
4. `CLIENT_PRECISE_TIMEOUT_MS` 55_000 → **180_000**；超时后**不要**把结果落 IndexedDB 为"最终结果"（超时快照的 `preciseStatus` 标记为 `'timeout'`，下次进入该行程时视为可自动重试）。
5. UI：自动升级期间状态条显示"正在生成精准路线…"（复用现有 preciseLoading 态）；失败/超时才显示按钮文案"重新获取精准路线"。
6. 防循环：同一 trip key 会话内自动尝试 ≤2 次（初次 + partial 重试），失败后依赖用户手动。

**为什么**：用户明确要求"自动获取精准路线，尽量避免依赖用户手动操作"；且 55 s 截断使长线永远拿不到服务端最终结果。

**预期效果**：进入任何车次 → 自动出现"正在生成精准路线…" → 数秒到数十秒后自动变为精确线；G7316/G3838/C8902 不再需要点击。

**验收**：清空 IndexedDB 后依次进入 G7316、G3838、C8902 行程页，不点击任何按钮，30~180 s 内 railwaySource 变为非 station；刷新页面后快照为精确态。

### S3（P1）真·全图拓扑寻路（替换贪心，本方案核心）

**改什么**：新增 2 个文件 + 改 2 个文件。

1. **`scripts/build-rail-topology.mjs`**（新增）
   - 读 `china-rail.graph` + `china-hsr.graph`，节点按 1e-4 度（≈11 m）量化合并；
   - 输出二进制 CSR（原型已验证：**2,051,034 节点 / 2,335,932 边 / 构建 7.7 s**）：
     ```
     data/rails/china-rail-topo.bin   ≈ 68 MB
       header: magic 'RVTP', version, nodeCount, edgeCount
       nodeXY:     Float64Array(nodeCount*2)
       edgeOffset: Int32Array(nodeCount+1)
       edgeTo:     Int32Array(edgeCount*2)
       edgeW:      Float32Array(edgeCount*2)   // 实际里程 km
       edgeFlag:   Uint8Array(edgeCount*2)     // bit0=高铁 bit1=轮渡
       edgeLine:   Uint16Array(edgeCount*2)    // 线路名 id
     data/rails/china-rail-topo.meta.json
       { lineNames: [...2919+ 个线路名], nodeCount, edgeCount, sourceVersions, generatedAt }
     ```
   - **显式加轮渡边**：海安(南)↔海口 固定 37 km，`edgeFlag bit1=1`，解决琼州海峡断口（哈尔滨西→三亚不连通的唯一原因）。
2. **`apps/api/src/services/railTopology.ts`**（新增）
   - `loadTopology()`：`readFileSync` + TypedArray 视图，零 JSON.parse，目标加载 <1 s、常驻内存 <150 MB（对比现状 JSON.parse 74 MB 图的几十秒卡顿 + GB 级峰值）；模块级单例。
   - `nearestNode(lng, lat, maxKm=3)`：0.02 度网格索引。
   - `routeLeg(fromNode, toNode, opts)`：Dijkstra + 二叉堆（POC 实测单段 13~326 ms）。
   - `routeStops(stops, opts)`：**按经停站顺序逐段寻路 + 拼接 + 相邻段端点去重**，返回 `{ coords, segResults, failures }`。逐段而非整趟，天然保证"每个经停站都在线上"。
   - **边权（解决平行线串线）**：
     ```
     w = 里程 × (1 + 0.35×车型不匹配) × (1 − 0.25×线路名命中)
     G/D/C-高速 → 高铁边不罚、普速边 ×1.35
     K/T/Z/数字 → 普速边不罚、高铁边 ×1.35
     线路名命中 = way 的 lineName ∈ 相邻站所属走廊的 name/sourceNames 集合
     ```
     （POC 实测不加权时沪昆线长度比 1.42 / 偏离 8.12 km，加权即修复。）
   - `opts.highspeed` 按 `isHighspeedTrain` 初始化，但**逐段允许混跑**（罚分制，不硬隔离）——顺带修复 C6 的跨图问题。
3. **`apps/api/src/services/railGeometryJob.ts`**
   - 将 1b 的 `findWholeTripLocalPath(odFrom, odTo)` **替换**为：
     ```ts
     const routed = railTopology.routeStops(job.stops, { trainCode: job.trainCode });
     // routed.failures 为空的段 → ok:true, reason:'topo'
     // 有 failures → 仅失败段走老路径（corridor 切片 → Overpass），其余段保持精确
     ```
   - `findWholeTripLocalPath` 保留但只作为 `RAIL_TOPOLOGY=0` 时的回退（且经 S1 门禁）。
   - 开关：`RAIL_TOPOLOGY`（默认 1）；拓扑文件缺失/寻路抛错时自动回退老逻辑并打 WARN。
4. **`scripts/verify-topology-routing.mjs`**（新增）：内置 50 组 OD（含本方案 6 个案例的相邻站段），输出连通率/耗时/里程表。

**为什么**：C1/C3/C7/C8 的共同根因是"没有拓扑、贪心无回溯"。POC 已证明：合并图 96.7% 连通、15 组真实 OD 14 组连通、逐段寻路对青藏/京广高铁偏离 0.06~0.18 km、全程 <110 ms。

**预期效果**：全国任意车次按站序逐段出贴轨线；贵南缺口段在轨网补齐前也能靠"逐段寻路 + 失败段走廊兜底"显著改善；Z267 类枢纽缺口由全图连通性自然消解。

**验收**：
```bash
node scripts/build-rail-topology.mjs      # 2.05M 节点 / 2.34M 边，<30s，bin<100MB
node scripts/verify-topology-routing.mjs  # 连通率 ≥95%，单段 <500ms
# 案例回归：§四 R1 全部 10 车次
```

### S4（P1）贵南高速线轨网补段（配合 S3）

**改什么**：数据侧。
1. 定位缺段：贵阳北—龙里北（lat 26.47 以北，约 20 km）。
2. 用 `scripts/fetch-corridor-osm-api.mjs` / `build-corridor-from-osm-relation.mjs` 抓贵南高铁 OSM relation 的贵阳段，或直接重跑 `build-rail-graph.mjs --pbf`（用新版 Geofabrik 中国 PBF，顺带更新全网现势性）；确认新建 ways 的 name 命名为"贵南高速线"以参与线路名加权。
3. 若走 rebuild：`scripts/rebuild-corridor.mjs`（GLM 上次新增）已有从本地图重建走廊的能力，先补 graph 再重建 `guinan.json` 走廊并跑 `verify-corridor-geometry.mjs --strict`。

**为什么**：E1 证明是数据缺口；S3 的逐段寻路同样需要这段轨才连通。

**预期效果**：贵阳北/贵阳东距贵南 ways ≤2 km；G3351 出 15/15。

**验收**：重跑 E1 统计脚本断言距离；G3351 端到端 15/15。

### S5（P1）站坐标全量补齐（先到 ≥95%）

**改什么**：
1. 新增 `scripts/fetch-stations-osm.mjs`：Overpass 按 bbox 分块一次性抓中国境内 `node["railway"~"^(station|halt)$"]["name"]`（约 1~2 万节点），存 `data/stations-osm.json`（含 name/lng/lat/zone）。超时 60 s/块、3 镜像轮转、失败重试 2 次——**这是一次性离线动作，不进运行时**。
2. 新增 `scripts/merge-stations-geo.mjs`：以 12306 的 3388 站名（`data/station_name.cache.json`）为主表，用 normalize（去"站"后缀、去东南西北方位变体 + 手工别名表）匹配 OSM 站名，合并进 `stations-geo.json`；**已有人工校准条目不覆盖**（给现有条目加 `verified:true` 标记，merge 跳过）。
3. 立即手工补 **南昌西**（114.79, 28.53 附近，务必用 OSM/高德核对）——它是 G3838 走廊链的卡点。
4. `patrol-data.mjs --strict` 纳入交付流程：本次起任何 corridor/graph/stations-geo 交付必须附 `--strict` 输出（当前 37% 也能跑，报 WARN 不阻塞，直到 S5 完成后阈值自然达标）。

**为什么**：缺站被静默过滤是"路线缺失"的持续来源；南昌西一个站就能卡死京九走廊链。

**预期效果**：覆盖率 37% → ≥95%；`enrichStopsCoords` 远程兜底调用大幅减少（更快更稳）。

**验收**：`node scripts/patrol-data.mjs --strict` 输出覆盖率 ≥95%（临时用 `PATROL_COVERAGE_THRESHOLD=0.95` 跑）；audit 中 G3838 命中京九走廊或 topo 逐段全通。

### S6（P2）走廊 hints 自动扩充

**改什么**：`scripts/expand-corridor-hints.mjs` 增加 `--auto` 模式：
- 对每条走廊，取 stations-geo 中距折线 ≤12 km 的站，按沿折线投影站序排序，取"实际停靠/枢纽级"站（间隔 ≥30 km 或换乘枢纽），自动并入 `stationsHint`（去重、上限 30 条）。
- 人工表 CANDIDATES 优先级高于自动结果。
- 跑 `--auto --write` 后执行 `verify-corridor-geometry.mjs --strict` 与 `patrol-data.mjs --strict`。

**为什么**：C5。248 条走廊平均 5.5 条 hints，包西/陇海/太焦仅 2 条，同步路径 T1 大面积 miss。

**预期效果**：包西线 hints ≥8（含西安东、延安、榆林…）；T1 命中率显著上升；C 车案例 4 的同步路径即出走廊级。

**验收**：`hint<4 的走廊数从 128 → ≤20`；C8902 同步路径（不点按钮）返回 source 非 station。

### S7（P2）段级走廊切片兜底 + partial 自动重试闭环

**改什么**：
1. `osmRailway.ts` `buildSegmentGeometry`：本地贪心/topo 失败后、打 Overpass 前，插入"走廊切片"尝试——若该段两端站可归属同一条走廊（复用 `matchCorridor` 的 endpointsBelong 逻辑，阈值放宽到 20 km），用 `slicePolylineByOd` 从走廊折线切出该段，过 `acceptSegmentGeometry` 门禁后返回 `reason:'corridor-slice'`。**先走廊后 Overpass**，弱网不再硬依赖公网。
2. 前端 partial 自动重试已在 S2.3 覆盖；服务端 `retryFailedOnly` 对 `topo` 失败段自动改走 corridor-slice/Overpass。

**为什么**：Z267 22/24 类缺口的最后兜底；贵南缺口在 S4 完成前的过渡方案。

**验收**：人为 `RAIL_TOPOLOGY=0 RAIL_OVERPASS=0` 环境下跑 K512：segmentsOk/total ≥ 0.9（证明纯本地链路成立）。

---

## 四、验证方式（回归测试点与验收标准）

### R1 端到端车次回归集（修好 `audit-routes.mjs` 后内置）

`scripts/audit-routes.mjs` 增加以下 10 个车次（本次全部案例 + 上次已修复防退化的 3 个），起服务后运行：

| # | 车次 | 区间 | 断言 |
|---|---|---|---|
| 1 | T270 | 喀什→西安 | **每个经停站（含西宁）到最终折线 ≤15 km**；segmentsOk=total |
| 2 | G7316 | 黄山北→扬州东 | source ≠ station；segmentsOk/total ≥ 0.9 |
| 3 | G3838 | 吉安西→北京西 | source ≠ station；全程在轨（无 >80 km 直线跳接） |
| 4 | C8902 | 西安东→延安 | qualityTier ≥ local；偏离包西高速线 ≤5 km |
| 5 | G3351 | 延安→南宁东 | **15/15**（贵阳东→河池西段 ok） |
| 6 | Z267 | 呼和浩特→上海 | **24/24** |
| 7 | C7601 | 广州南→珠海北 | corridor 级 ≤1s（防退化） |
| 8 | K512 | 广州白云→杭州南 | 27/27（防退化） |
| 9 | Z201 | 北京西→三亚 | ≥12/13 且含轮渡示意段、耗时 ≤60s |
| 10 | 随机抽签 | 12306 大屏随机 1 站 × 1 车 | source ≠ station（自动升级生效） |

**统一断言模板**（每车次）：`segmentsOk === segmentsTotal`（或 ≥N-1）、`qualityTier ∈ {corridor, network, local}`、无 `reason === 'job_timeout'`、每个经停站投影距折线 ≤15 km、折线总里程 / 站序折线里程 ≤ 1.6。

### R2 单元/数据门禁

```bash
pnpm -r test                                    # 现有单测全绿（railGeometryJob.test.ts 需补 local:whole 门禁用例）
node scripts/verify-corridor-geometry.mjs --strict   # 走廊几何全过
node scripts/patrol-data.mjs --strict           # S5 后覆盖率 ≥95→99%
node scripts/build-rail-topology.mjs            # 幂等，产物字节数稳定
node scripts/verify-topology-routing.mjs        # 50 组 OD 连通率 ≥95%
```

### R3 手工抽签（对应你的使用方式）

连续 10 次：12306 车站大屏随机站 → 随机车次 → 进入行程页**不做任何点击**。
标准：10/10 自动出线；≥9 次视觉贴轨无飞线；≤1 次 partial（且有明确的缺口段 reason）。

### R4 缓存污染检查

```bash
node scripts/scrub-whole-trip-cache.mjs --dry-run   # 应为 0 条 local:whole 旧缓存
```

---

## 五、风险提示与回滚

| 步骤 | 风险 | 缓解 | 回滚 |
|---|---|---|---|
| S1 | 部分车次从"done(伪精确)"退回 partial，表面指标变差 | 发布说明中明确"旧 done 中约 X% 为假精确"；S2 自动升级会让 partial 很快补齐 | 还原 railGeometryJob.ts 中 shortcut 段（单 commit 独立，可 `git revert`） |
| S1 | 中间站阈值过松/过紧 | 阈值用 `max(10, spanKm*0.02)` 并打日志观测一周再收紧；阈值入 env `WHOLETRIP_STOP_TOL_KM` | env 设为 0 禁用 shortcut |
| S2 | 自动升级放大 API 负载（每进入一次行程一个 job） | 每 trip key 会话内 ≤2 次自动尝试；命中 IndexedDB 精确快照不触发；服务端限流 36/min 与 job 队列 8+24 已有；队列满静默降级为按钮 | `RAIL_AUTO_UPGRADE=0`（前端读 /api/health 的 feature flags 或构建期 env） |
| S2 | 180s 超时期间用户误以为卡死 | 状态条明确"正在生成精准路线 (剩余段 n/m)" | 超时改回 55s 一行改动 |
| S3 | 拓扑加载内存（<150 MB）与冷启动延迟 | 二进制零解析 <1 s；懒加载（首个 job 才 load）；`RAIL_TOPOLOGY=0` 一键回退老链路 | bin 保留，代码开关回退 |
| S3 | 边权罚分不当导致"绕远正确线"（该走高铁走了普速） | 权重全部入 env（TYPE_PENALTY/LINE_BONUS），verify-topology-routing 输出逐段线路名分布供人工抽查 | 权重调 1.0/0 即恢复纯最短路 |
| S4/S5 | 重跑 build-rail-graph 会整体替换轨网，其它线可能受 OSM 数据现势性影响 | 重跑后全量执行 verify-corridor-geometry --strict + R1 回归集；graph 产物进 git LFS 或保留旧版备份 | 保留旧 `china-*.graph` 副本，`git checkout` 回滚数据文件 |
| S5 | OSM 站名与 12306 站名对不齐导致错坐标 | merge 只在"站名 normalize 唯一匹配 + 距既有走廊/轨网 ≤5 km"时写入；`verified` 条目不覆盖；写后跑 audit 异常站清单 | stations-geo.json 进 git，直接 revert |
| S7 | 走廊切片兜底可能引入"贴走廊不贴该段实际线"（平行段） | 仅当段两端站距该走廊 ≤20 km 且过 acceptSegmentGeometry 门禁；reason='corridor-slice' 单独标记便于统计 | 门禁阈值收紧或移除该兜底分支 |

**通用回滚原则**：每个 S 步骤独立 commit；`RAIL_TOPOLOGY / RAIL_AUTO_UPGRADE / RAIL_OVERPASS` 三个 env 开关均可单独关闭新能力回到 `b8a9239` 行为；数据文件（graph/topo/stations-geo/corridors）与代码分开提交，数据可单独回滚。

---

## 六、执行顺序与依赖图

```
S1（止血门禁）──┐
S2（自动升级）──┼─→ 立即可见的体验修复
S5（站坐标）───┘     （南昌西手工条目当天生效）
S3（拓扑寻路）──→ 依赖 S1 完成（先禁伪精确，再换真引擎）
S4（贵南补段）──→ 独立，与 S3 并行
S6（hints 扩充）─→ 依赖 S5（有站坐标才能自动算 hints）
S7（走廊切片兜底）→ 依赖 S3（作为失败段兜底）
```

**预计工作量**：S1+S2 半天；S3 两天（原型已验证，剩工程化）；S4 半天；S5 一天；S6+S7 一天。

---

## 附：本次实测脚本与关键数据存档

- 案例定位：`/tmp/rvaudit/case1.mjs`（站/走廊/轨网覆盖）、`/tmp/rvaudit/case2.mjs`（投影距离与连通性）
- 拓扑寻路原型：`/tmp/rvaudit/poc2~5.mjs`（205 万节点建图、15 组 OD、6 条真线精度对照）
- 关键数字：贵南高速线 lat[22.84,26.47]；贵阳东距贵南折线 31.4 km；包西高速线覆盖西安东 0.1 km / 延安 0.0 km；stations-geo 1252/3388（37%）
