# RailVista 时间预估（ETA）算法改造方案

> 目标：基于 12306 时刻表 + 铁路几何 + 手机上不可靠的 GPS，精确估算「列车何时经过每一个沿途景点」。
> 状态：**方案阶段，未改代码**。本文给出数学模型、参数、伪代码与分阶段落地清单。
> 日期：2026-09-25
> 读者：开发（实现）、产品（确认口径）

---

## 0. 一句话结论

现有代码**没有景点级时间预估能力**，且**列车进度本身就是错的**。

- 景点时刻只在 Z8991 演示预置里有（硬编码 `at` 字段）；12306 真实车次的 414 条景点**全部无时刻**，界面退化成「下一站」。
- 进度用的是**站序号比例** `i/(n-1)`，不是**里程比例**。青藏线 Z8991 实测：格尔木的真实里程进度是 **44.3%**，程序算成 **14.3%**，差 **30 个百分点 ≈ 634 km ≈ 2.3～4.6 小时**。

改造核心是三件事：**把站序换成里程**、**用运动学曲线替代线性插值**、**用卡尔曼滤波 + 延误场替代固定权重融合**。

---

## 1. 现状盘点（代码级事实）

### 1.1 数据流

```
12306 /otn/czxx/queryByTrainNo
   → cr12306.ts: attachAbsoluteTimes()   # HH:mm + 日期 + 跨天 → 绝对 ISO
   → Stop[] { arriveTime, departTime, arrive, depart, at, dayOffset }
                                                    │
railGeometry /jobs + corridors                      │
   → 折线 coords [lng,lat][]  (OSM / 精品走廊 / 站点示意线)
   → matchScenicSpotsForRailway() → ScenicSpot[] { progressKm, distKm }
                                                    │
                          ┌─────────────────────────┴─────────────────┐
                          ▼                                           ▼
         progress.ts: scheduleProgress()             progress.ts: resolveProgress()
         时刻表 → progress ∈ [0,1]                    GPS 投影 (0.65) + 时刻表 (0.35)
                          │                                           │
                          └──────────────► pointAtProgress() ─────────┘
                                          → 列车标记 / locationInfo
                          └──────────────► getUpcoming() → 「即将到达」
```

### 1.2 关键文件

| 文件 | 职责 | 现状 |
|---|---|---|
| `packages/shared/src/schedule/progress.ts` | 进度 + 投影 + 「即将到达」 | **问题集中地** |
| `packages/shared/src/schedule/scenic.ts` | 景点沿线过滤、算 `progressKm` | 只算空间，不算时间 |
| `packages/shared/src/schedule/index.ts` | 时刻平移、校准 offset | 全局平移，无恢复模型 |
| `apps/web/src/composables/useGeolocation.ts` | GPS 采样 | 原始透传，无平滑/野值剔除 |
| `apps/web/src/pages/TripMap.vue` | 每秒 tick、渲染 | 直接吃 `resolveProgress` |
| `apps/api/src/services/cr12306.ts` | 12306 抓取 | 已有绝对 ISO、跨天；`stopover_time` 解析了但未用 |
| `apps/api/src/services/corridors.ts` | G/D → 高铁走廊，K/T/Z → 普速走廊 | 已有车型分类逻辑，可复用 |

### 1.3 实测证据：站序 vs 里程（Z8991 青藏线）

用 `data/presets/z8991.json` + `z8991-railway.json`（2342 点，折线总里程 2114 km）实算：

| 站名 | 图定时刻 | 站序进度 `i/(n-1)` | **真实里程进度** | 绝对偏差 |
|---|---|---|---|---|
| 西宁 | 22:00 | 0.000 | 0.000 | 0 |
| 格尔木 | 04:03 | 0.143 | **0.443** | **+30.0 pp（634 km）** |
| 不冻泉 | 06:51 | 0.286 | 0.527 | +24.2 pp |
| 沱沱河 | 09:46 | 0.429 | 0.636 | +20.7 pp |
| 雁石坪 | 10:59 | 0.571 | 0.682 | +11.0 pp |
| 安多 | 13:16 | 0.714 | 0.778 | +6.3 pp |
| 那曲 | 14:38 | 0.857 | 0.848 | −1.0 pp |
| 拉萨 | 18:28 | 1.000 | 1.000 | 0 |

**推论**：列车抵达格尔木的瞬间，进度条显示 14.3%（折线上 302 km 处），实际在 936 km 处。位置误差 634 km；按该段平均 137 km/h 折算，**相当于把列车画到了 4.6 小时之前的位置**，区间中点误差约 2.3 小时。

京沪等站距均匀的高铁线误差较小（站序比例 ≈ 里程比例），但**普速车（大区间 + 小站密集）全线是这个量级**，正是我们要服务的场景。

---

## 2. 缺陷清单（按严重度）

| # | 位置 | 缺陷 | 影响 |
|---|---|---|---|
| **P0-1** | `progress.ts:242-243` | `a = idxA/(stops.length-1)`，用**站序号**当进度，忽略站间实际里程 | 如上，最大 30 pp / 634 km 位置误差；所有下游（景点 ETA、"当前区间"文案）全部失真 |
| **P0-2** | `progress.ts:345,368` | `getUpcoming` 只认 `spot.at`；而 `data/presets/scenic-spots.json` 414 条 **0 条有 `at`** | 12306 车次**完全没有景点时刻**，退化为"下一站" |
| **P0-3** | `progress.ts:312` | `projected.progress * 0.65 + scheduleP * 0.35`：固定权重，且两者**量纲不同**（几何里程比例 vs 站序比例） | 数学上不成立；GPS 极准和极差时权重一样 |
| **P1-1** | `progress.ts:297` | GPS 判弱条件 `ageMs > 120000 \|\| accuracy > 800` | accuracy 800 m（WiFi/基站定位）被视为可用，直接污染进度 |
| **P1-2** | `progress.ts:305` | 偏离判据 `distKm > 8` (km) | 太松。示意线场景 8 km 内仍可能是平行线/错误投影 |
| **P1-3** | `useGeolocation.ts` | 未使用 `coords.speed` / `heading`；无平滑、无野值剔除、无丢星检测 | 隧道/城市峡谷抖动，列车标记跳变 |
| **P1-4** | `index.ts:53-57` `effectiveScheduleDate` | 校准 = **全局平移**一个 `offsetMs` | 不建模延误的**累积与赶点恢复**。普速长途尤失真：前段晚 30 min，到终点往往只晚 10 min |
| **P2-1** | `geocode.ts:366` | 高德兜底坐标是 **GCJ-02**，走廊/OSM 折线与 `stations-geo.json` 是 **WGS-84** | 未做转换时存在 300～600 m 系统偏移，直接影响投影里程 |
| **P2-2** | `progress.ts` 无速度约束 | 融合结果可倒退、可超物理速度 | 观感与逻辑双错 |
| **P2-3** | `cr12306.ts:196` | `stopover_time` 已解析但未使用 | 白白丢掉"站停时长"这个强信号（技术停车 vs 客运营业站） |
| **P2-4** | 站停期间仍做 GPS 融合 | 停站时 GPS 位置不变但噪声仍在，会被当成"慢速行驶" | 停站期间进度抖动 |

---

## 3. 数学模型

### 3.0 符号表

| 符号 | 含义 | 单位 |
|---|---|---|
| `P = (p_0..p_N)` | 行程折线（OD 切片后） | lng/lat |
| `L` | 折线总里程 | m |
| `S_i` | 第 i 个经停站的**里程坐标**，`S_0=0, S_m=L`，单调不减 | m |
| `A_i / D_i` | 图定到达 / 出发绝对时刻 | s |
| `W_i = D_i − A_i` | 图定站停 | s |
| `ΔS_k = S_{k+1} − S_k` | 区间 k 里程 | m |
| `ΔT_k = A_{k+1} − D_k` | 区间 k 图定运行时分 | s |
| `s_j` | 景点 j 的里程坐标 | m |
| `r_j` | 景点 j 到折线的垂距 | m |
| `δ(s)` | 里程 s 处的**延误** | s |

### 3.1 层一：几何基准 —— 建立统一里程轴

所有时间计算都在**一维里程轴**上做，先把站和景点都投上去。

```
1) 折线累积里程：cum[0]=0, cum[i]=cum[i-1]+haversine(p_{i-1}, p_i)
2) 站点投影：S_i = projectToRailway(P, station_i).progress * L
3) 景点投影：s_j = projectToRailway(P, spot_j).progress * L,  r_j = .distKm
4) 单调化（关键）：对 S_i 做保序回归（PAVA / isotonic regression）
   —— 复线、枢纽引线、折返段会让投影顺序错乱（例如某站投到前一站之前）
   约束：0 = S_0 ≤ S_1 ≤ ... ≤ S_m = L
   权重取各站垂距的倒数（贴合的站更可信）
5) 首末端点硬钉：S_0 := 0, S_m := L（避免首末站投影垂距大导致区间被砍短）
```

> 注：Z8991 预置里西宁站垂距 12.9 km，说明折线起点没对齐车站 —— 端点硬钉就是为此。

**几何质量分级**（决定后续误差参数）：

| 来源 | `railwaySource` | 里程误差 `σ_geo` |
|---|---|---|
| OSM 真实轨道 / 精品走廊 | `precise` / `corridor` | 150 m |
| 本地轨网 | `local` | 300 m |
| 跨站补缝 | `soft` | 500 m |
| 站点示意折线 | `station` | `0.12 × ΔS_k`（弦长低估山区曲线约 10~30%） |

### 3.2 层二：图定里程—时间曲线（离线可算，不依赖 GPS）

这是**本次改造的核心**：把「每个站的到开时刻」变成一条连续的 `时间 = f(里程)` 曲线。

#### 3.2.1 区间运动学反演

已知区间 k 的 `ΔS_k`（几何）和 `ΔT_k`（时刻表）。列车在区间内不是匀速：出站加速 → 巡航 → 进站减速。我们**用时刻表反推巡航速度**，再用运动学形状分配区间内每一米的时间。

设有效加速度 `a⁺`、有效减速度 `a⁻`（见 §4 车型表），记

```
β = (1/a⁺ + 1/a⁻) / 2                    [s²/m]
```

梯形速度曲线的总时间（巡航速度 v）：

```
T(v) = ΔS/v + β·v                        （推导：v/a⁺ + (ΔS − v²/2a⁺ − v²/2a⁻)/v + v/a⁻）
```

`T(v)` 在 `v* = sqrt(ΔS/β)` 处取最小，`T_min = 2·sqrt(ΔS·β)`。物理分支是 `v ≤ v*`（巡航越快越省时，直到最优速度；再快反而因加减速距离占比过大变慢）。

**反解巡航速度**（令 `T(v) = ΔT_k`）：

```
β·v² − ΔT·v + ΔS = 0
判别式 D = ΔT² − 4βΔS

若 D ≥ 0：  v = (ΔT − sqrt(D)) / (2β)        ← 取小根（≤ v*，物理分支）
            并要求 v ≤ v_cap（线路/车型最高速）；若 v > v_cap，
            说明图定比技术速度慢（有冗余），应以 v_cap 重算并记入 slack
若 D < 0：  图定比技术极限还快 → 数据或几何异常，降级为匀速 v = ΔS/ΔT，并告警
```

**区间内时间—里程正函数**（从 `D_k` 起算，里程偏移 `x = s − S_k ∈ [0, ΔS]`）：

```
s_acc = v²/(2a⁺),   t_acc = v/a⁺
s_dec = v²/(2a⁻),   t_dec = v/a⁻

τ(x) = ┌ sqrt(2x / a⁺)                              x ≤ s_acc
       │ t_acc + (x − s_acc)/v                      s_acc < x ≤ ΔS − s_dec
       └ ΔT − sqrt(2(ΔS − x) / a⁻)                  x > ΔS − s_dec
```

`τ(x)` 单调、连续、`τ(0)=0`、`τ(ΔS)=ΔT`，可直接求逆。

**图定过景时刻**：

```
k = 满足 S_k ≤ s_j ≤ S_{k+1} 的区间
T_plan(s_j) = D_k + τ_k(s_j − S_k)          （若 s_j 恰在区间端点，取 A_k 或 D_k 语义）
```

**为什么比线性插值好**：线性插值假设匀速。高铁 350 km/h 出站后约 8 km、2.5 min 才到速，进站前同理 —— 靠近车站的景点（很多"穿行/贴线"类景点就在进出站段）误差可达 1～3 min；普速机车加减速更慢，误差 2～5 min。远离车站的景点两者差别小，所以这项修正的收益集中在**车站附近景点**，属于"锦上添花但必须做"。

#### 3.2.2 灵敏度说明

运动学参数（`a⁺/a⁻`）的**精度不敏感**：`ΔT_k` 是已知的，运动学只决定区间内**时间怎么分**，不影响两端。把 `a±` 从 0.3 改到 0.5，区间中点时刻变化 < 30 s。所以参数给个合理档位即可，不必逐线标定。

真正敏感的是 **`ΔS_k` 的准确性**（几何质量）。示意线在山区会低估里程 → 景点在区间内的相对位置偏移。这是 §3.1 中 `σ_geo` 要显式建模的原因。

### 3.3 层三：实时延误场 `δ(s)`（取代全局平移）

#### 3.3.1 观测锚点

每个锚点是 `(u_q, δ_q)`：在里程 `u_q` 处、实测通过时刻 `t_q`，延误

```
δ_q = t_q − T_plan(u_q)
```

锚点来源（按可信度）：

| 来源 | 可信度 | 说明 |
|---|---|---|
| 用户手动"我在 X 站" | 高 | 现有 `CalibrationRecord`，保留 |
| **自动停站检测**（推荐新增） | 高 | `v̂ < 2 m/s` 持续 ≥45 s 且距某站 <1.2 km → 判定进站，自动落锚 |
| GPS 连续匹配 | 中 | 卡尔曼滤波输出即隐式锚点 |
| 12306 正晚点接口（若后续接入） | 高 | 直接给出当前晚点 |

#### 3.3.2 冗余时分与赶点恢复

列车晚点后会利用图定冗余赶点。**可赶回的时间受剩余冗余上限约束**：

```
区间 k 的技术最小运行时分（跑 v_cap）：
  若 ΔS ≥ β·v_cap²:   T_min,k = ΔS/v_cap + β·v_cap
  否则:               T_min,k = 2·sqrt(ΔS·β)

冗余 Slack_k = max(0, ΔT_k − T_min,k)
剩余冗余 R(a→b) = Σ_{区间 k 完全落在 [a,b] 内} Slack_k
```

#### 3.3.3 延误外推（对未来任意里程 s）

```
设最后一个锚点为 (u, δ_u)，图定剩余时长 ΔT_plan = T_plan(s) − T_plan(u)

δ(s) = clamp( δ_u − R(u→s) + μ · ΔT_plan ,  δ_floor ,  δ_cap )
```

- `μ`：单位图定时间的**期望新增延误**（min/h），见 §4。普速为正且大（会继续累积），高铁接近 0。
- `δ_floor`：下界。高铁可取 `−5 min`（最多抢回 5 分钟），普速取 `0`（基本不会提前）。
- `δ_cap`：上界，防止离谱外推。建议 `min(δ_u + 0.5·ΔT_plan, 180 min)`。
- **锚点之间的插值**：里程线性插值 `δ(s) = δ_q + (δ_{q+1} − δ_q)·(s − u_q)/(u_{q+1} − u_q)`。

#### 3.3.4 非计划停车（普速的会让/待避）

单线铁路、低等级车被高等级车越行时会**在非车站处停车 3～15 min**，图定里没有。处理方式：

```
状态机检测到 v̂ ≈ 0 且位置不在任何站 1.2 km 内，持续 > 60 s
  → 判定"非计划停车"，立即在 u = ŝ 处落一个锚点：
     δ_new = δ_u + 已停时长（每次 tick 累加）
  → 关键：停车损失的时间**不可追回**，因此该锚点的 δ 不参与"恢复"折扣
     （等价于把该段 slack 提前消耗掉）
```

这是普速场景精度的主要来源之一。

### 3.4 层四：GPS / 时刻表融合（一维卡尔曼滤波，取代 0.65/0.35）

#### 3.4.1 为什么不是固定权重

固定权重是"无信息的折中"。正确做法是**按方差加权**：谁更可信谁权重大。GPS 在开阔高铁上沿轨道误差折合时间可能只有几秒，此时应该几乎全信 GPS；隧道里连续 10 分钟无信号，应该几乎全信时刻表。

#### 3.4.2 状态与方程

状态 `x = [s, v]ᵀ`（里程 m，速度 m/s），协方差 `P`（2×2）。

**预测**（每 `Δt` 秒）：

```
F = [[1, Δt], [0, 1]]
s⁻ = s + v·Δt
v⁻ = v + κ·(v_plan(s) − v)·Δt        # κ≈0.05，弱回归到图定速度（均值回复）
P⁻ = F·P·Fᵀ + Q
Q = q · [[Δt⁴/4, Δt³/2], [Δt³/2, Δt²]]      # q = 加速度过程噪声方差
```

- `q` 取 `(0.15 m/s²)²` 量级；**无 GPS 时放大 3～5 倍**（承认模型不确定度增长）。
- `v_plan(s)` 由 §3.2 的曲线求导得到（`v = ds/dt`），天然含进出站减速。

**观测**（GPS 到达时）：

```
z = projectToRailway(gps).progress · L          # 沿轨道里程观测
R = σ_s²
σ_s² = σ_acc² + σ_geo² + σ_proj²
  σ_acc  = max(accuracy_m, 15)                  # 手机 GPS 15~60；WiFi/基站 500~3000
  σ_geo  = 见 §3.1 几何质量表
  σ_proj = 折线曲率导致的投影误差（简化：并入 σ_geo）

K = P⁻·Hᵀ / (H·P⁻·Hᵀ + R),   H = [1, 0]
x = x⁻ + K·(z − H·x⁻)
P = (I − K·H)·P⁻
s = max(s, s_prev)                              # 单调约束：列车不会倒退
```

> 上述更新等价于：
> `ŝ = (R·s_plan + P_ss·z) / (P_ss + R)`，`σ² = P_ss·R/(P_ss + R)`
> —— 即"按方差加权"，正是 §2 中 P0-3 要的正确形式。

#### 3.4.3 野值剔除（三重门）

```
1) 垂距门：r_gps > D_max → 丢弃
     D_max = clamp(3·accuracy_m + 500, 800, 5000)  [m]
     （示意线场景再 ×1.5；> 5 km 一律丢，现有代码 8 km 太松）

2) 新息门：|z − s⁻| > 3·sqrt(P⁻[0][0] + R) → 软拒绝（R ×= 10 后再更新）

3) 物理门：隐含速度 |z − s_prev| / Δt > 1.3·v_cap → 丢弃
            或 implied v < 0（倒退）→ 丢弃
```

#### 3.4.4 GPS 不可用时的处理（隧道 / 山区）

```
无观测时长 t_gap：
  - 只做预测步，q 放大 → P 自然膨胀（不确定性诚实增长）
  - 速度向 v_plan 回归的 κ 提高（0.05 → 0.15）：长时间没信号就信时刻表
  - 界面显式标注「隧道/无信号 · 按时刻表推算」，并把 ETA 置信度降为"低"
恢复信号时：
  - 首个观测用放宽的新息门（6σ），允许大跳变一次性收敛
  - 若跳变 > 20 km，判为"基站定位漂移"，拒绝并再等一个采样
```

#### 3.4.5 短时速度外推通道（应对"刚过某点"的近程预测）

对未来 20～30 min 内的近程预测，实测速度比图定更准：

```
t(s) = t_obs + ∫_u^s dx / v_eff(x)
v_eff(x) = w·v̂_gps + (1 − w)·v_plan(x),   w = exp(−ΔT_plan / τ),  τ ≈ 25 min
```

即：**近程信实测速度，远程回归图定**（均值回复）。与 §3.3 的延误场并联，取两者加权：

```
T_final(s) = T_plan(s) + [ w·δ_speed(s) + (1 − w)·δ_field(s) ],  w = exp(−ΔT_plan/τ)
```

### 3.5 层五：输出 —— 带置信度的 ETA

每个景点输出：

```ts
interface SpotEta {
  spotId: string;
  km: number;                 // 里程坐标
  etaPlanIso: string;         // 图定时刻
  etaIso: string;             // 实时修正后时刻
  sigmaMin: number;           // 1σ 置信半宽（分钟）
  confidence: 'high' | 'mid' | 'low';
  basis: 'schedule' | 'gps' | 'calibrated' | 'mixed';
  passed: boolean;
  night: boolean;             // 结合当地日出日落实时算，而非仅用 nightOnly 静态标记
}
```

**σ 的合成**：

```
σ_eta² = σ_plan² + σ_geo_t² + σ_gap²
  σ_plan  = 图定本身的不可信度：σ_0 + γ·√(|now − t_anchor|)
            （高铁 σ_0=1.0 min, γ=0.35 min/√h；普速 σ_0=3.0 min, γ=1.2 min/√h）
  σ_geo_t = σ_geo / v̂      （几何误差折合时间）
  σ_gap   = 无 GPS 时长 × 0.15（隧道惩罚）
```

**置信度分档**：`σ ≤ 3 min → 高`；`3 < σ ≤ 10 → 中`；`> 10 → 低`。

**展示文案**（TripMap 底部卡片 / 景点气泡）：

```
青海湖      15:42 ±4 分钟   [中]  · 依据：GPS 实测 + 时刻表
可可西里    17:20 ±12 分钟  [低]  · 依据：时刻表（无信号 8 分钟）
```

---

## 4. 车型参数表（高铁 vs 普速）

### 4.1 分类函数

复用 `corridors.ts` 已有的判定口径：

```ts
function classifyTrain(code?: string): TrainClass {
  const c = (code || '').trim().toUpperCase();
  if (/^G/.test(c)) return 'G';        // 高速动车组
  if (/^D/.test(c)) return 'D';        // 动车组
  if (/^C/.test(c)) return 'C';        // 城际
  if (/^Z/.test(c)) return 'Z';        // 直达特快
  if (/^T/.test(c)) return 'T';        // 特快
  if (/^K/.test(c)) return 'K';        // 快速
  return 'OTHER';                      // 普客 / 旅游 / 路用
}
```

### 4.2 参数表

| 类别 | 巡航上限 `v_cap` (km/h) | `a⁺` (m/s²) | `a⁻` (m/s²) | 典型站停 (min) | 图定冗余 | 赶点恢复上限 (min) | 新增延误 `μ` (min/h) | `σ_0` (min) | `γ` (min/√h) |
|---|---|---|---|---|---|---|---|---|---|
| **G** 高铁 | 310（350 线 340） | 0.30 | 0.45 | 1–3 | 5–8% | 8 | 0.4 | 1.0 | 0.35 |
| **D** 动车 | 250（部分 200） | 0.35 | 0.50 | 1–3 | 5–10% | 10 | 0.6 | 1.5 | 0.45 |
| **C** 城际 | 200 | 0.45 | 0.60 | 0.5–2 | 5% | 5 | 0.8 | 1.5 | 0.5 |
| **Z** 直特 | 160 | 0.18 | 0.25 | 3–8 | 3% | 5 | 1.5 | 2.5 | 0.8 |
| **T** 特快 | 140 | 0.16 | 0.22 | 3–8 | 3% | 5 | 2.0 | 3.0 | 1.0 |
| **K** 快速 | 120 | 0.14 | 0.20 | 3–10 | 2% | 3 | 3.0 | 3.5 | 1.2 |
| **OTHER** 普客 | 100 | 0.12 | 0.18 | 5–15 | 2% | 0 | 4.0 | 4.0 | 1.4 |

**特殊修正项**（叠加在上表之上）：

| 情形 | 修正 |
|---|---|
| 单线区段（青藏格拉段、成昆部分、焦柳等） | `μ` ×1.8，恢复上限 ×0.4 |
| 大面积山区 / 隧道密集 | `σ_geo` ×1.5，GPS 可用率按 60% 计 |
| 夜间 0:00–5:00（天窗前后、货车密集） | `μ` ×1.3 |
| 进出厂枢纽 30 km 内（限速、多信号） | `v_cap` ×0.6 |
| 车次实际走高铁但前缀是 Z（如 Z509 兰新高铁） | 由 `corridors.ts` 已有 `stopsEvidenceHsrOverride` 判定后，改用 G/D 档 |

### 4.3 高铁 vs 普速：建模差异的本质

| 维度 | 高速铁路 | 普速铁路 |
|---|---|---|
| 时刻表可靠性 | 高，晚点多为 0–10 min | 低，晚点常见 20–60 min，极端 2h+ |
| 延误演化 | 有冗余，**会赶点恢复** | 冗余小，`μ` 大，**持续累积** |
| 站间距离 | 100–300 km，运动学影响占比小 | 5–150 km 差异大，**里程轴改造收益最大** |
| 非计划停车 | 罕见 | **会让/待避/待令频繁**，必须单独建模 |
| GPS 可用性 | 高架开阔，但车厢金属屏蔽 + 350 km/h 导致丢星；城市段多径 | 山区隧道密集（成昆隧道率 40%+），长时无信号 |
| 主导误差源 | 几何误差 + 高速下投影抖动 | **延误累积** + 非计划停车 + 长隧道 |
| 算法侧重 | 信任图定 + GPS，运动学细化 | **延误场外推** + 状态机（停站/会让） + 隧道降级 |

---

## 5. 核心算法伪代码

### 5.1 构建里程轴

```ts
// packages/shared/src/schedule/mileage.ts（新）
export function buildMileageAxis(stops: Stop[], path: RailwayPoint[], lengthKm: number): number[] {
  const L = lengthKm * 1000;                       // m
  const raw = stops.map((s, i) => {
    if (i === 0) return 0;
    if (i === stops.length - 1) return L;
    if (s.lng == null || s.lat == null) return NaN;
    const p = projectToRailway(path, lengthKm, s.lng, s.lat);
    return p.progress * L;
  });
  // 1) 缺失值用邻居线性插值补齐（按图定时间比例更准：用 arrival 时间插值）
  fillByTimeInterpolation(raw, stops);
  // 2) PAVA 保序回归，权重 = 1/(垂距 + 200m)
  const mono = isotonicRegression(raw, weights);
  // 3) 端点硬钉
  mono[0] = 0; mono[mono.length - 1] = L;
  // 4) 零长区间保护：若 ΔS_k < 200 m，强制拉开到 200 m 并等比压缩后续
  return enforceMinSegment(mono, 200);
}
```

### 5.2 构建图定里程—时间曲线

```ts
// packages/shared/src/schedule/kinematics.ts（新）
export interface SegProfile { v: number; sAcc: number; sDec: number; tAcc: number; tDec: number; }

export function solveSegment(dS: number, dT: number, prof: TrainProfile): SegProfile {
  const beta = (1 / prof.aAcc + 1 / prof.aDec) / 2;      // s²/m
  const disc = dT * dT - 4 * beta * dS;
  if (disc >= 0) {
    let v = (dT - Math.sqrt(disc)) / (2 * beta);          // 小根 = 物理分支
    v = Math.min(v, prof.vCap);
    return trapezoid(dS, dT, v, prof);
  }
  return uniform(dS, dT);                                 // 降级 + 告警
}

/** 区间内 里程偏移 x → 耗时 τ（秒），单调连续 */
export function tauAt(seg: SegProfile, dS: number, dT: number, prof: TrainProfile, x: number): number {
  if (x <= seg.sAcc) return Math.sqrt((2 * x) / prof.aAcc);
  if (x >= dS - seg.sDec) return dT - Math.sqrt((2 * (dS - x)) / prof.aDec);
  return seg.tAcc + (x - seg.sAcc) / seg.v;
}
```

```ts
// packages/shared/src/schedule/scheduleCurve.ts（新）
export interface ScheduleCurve {
  /** 里程 → 图定绝对时刻（ms） */
  timeAtKm(km: number): number;
  /** 图定绝对时刻 → 里程 */
  kmAtTime(t: number): number;
  /** 里程 → 图定瞬时速度（m/s） */
  speedAtKm(km: number): number;
  segSlack: number[];   // 各区间冗余（秒）
}
```

### 5.3 景点 ETA 主流程

```ts
// packages/shared/src/schedule/spotEta.ts（新）
export function estimateSpotEtas(p: {
  curve: ScheduleCurve;
  delays: DelayField;          // 来自锚点 + 恢复模型
  fusion: FusionState;         // 卡尔曼输出：ŝ, v̂, σ_s
  spots: ScenicSpot[];         // 含 km
  now: number;
  prof: TrainProfile;
}): SpotEta[] {
  return p.spots.map((sp) => {
    const tPlan = p.curve.timeAtKm(sp.km);
    const dTPlanH = (tPlan - p.curve.timeAtKm(p.fusion.s)) / 3600;

    // 通道 A：延误场外推
    const dField = p.delays.deltaAt(sp.km);

    // 通道 B：实测速度外推（近程有效）
    const w = Math.exp(-Math.abs(dTPlanH) / TAU_H);      // TAU_H = 0.42 h ≈ 25 min
    const tSpeed = p.fusion.t + (sp.km - p.fusion.s) / Math.max(p.fusion.v, 1);
    const dSpeed = tSpeed - tPlan;

    const delta = w * dSpeed + (1 - w) * dField;
    const eta = tPlan + delta;

    // 置信度
    const sigmaMin = Math.sqrt(
      p.prof.sigma0 ** 2 + p.prof.gamma ** 2 * Math.abs(dTPlanH)
      + (p.geoSigma / Math.max(p.fusion.v, 5) / 60) ** 2
      + (p.fusion.gapSec / 60 * 0.15) ** 2
    );

    return { spotId: sp.id, km: sp.km, etaPlanIso: iso(tPlan), etaIso: iso(eta),
             sigmaMin: round1(sigmaMin), confidence: band(sigmaMin),
             basis: p.fusion.basis, passed: sp.km < p.fusion.s };
  });
}
```

### 5.4 融合状态机

```ts
// apps/web/src/composables/useTrainTracker.ts（新）
type Mode = 'RUNNING' | 'DWELL' | 'UNPLANNED_STOP' | 'NO_SIGNAL';

onTick(dt, gpsSample | null) {
  // 1) 预测
  predict(dt, gpsSample ? Q_NORMAL : Q_DEGRADED);

  // 2) 有 GPS → 三重门 → 更新
  if (gpsSample && passGates(gpsSample)) update(projKm(gpsSample), R(gpsSample));

  // 3) 状态机
  const near = nearestStationKm(state.s);
  if (state.v < 2 && dwellTimer > 45 && Math.abs(state.s - near) < 1200) {
    mode = 'DWELL';
    addAnchor(near, now - curve.timeAtKm(near));       // 自动校准
  } else if (state.v < 2 && stopTimer > 60) {
    mode = 'UNPLANNED_STOP';                            // 会让 / 待避
    addAnchor(state.s, elapsed, { recoverable: false });
  } else if (gpsGap > 90) {
    mode = 'NO_SIGNAL';
  } else mode = 'RUNNING';

  // 4) 单调约束
  state.s = Math.max(state.s, lastS);
}
```

---

## 6. 评测方案（怎么证明"更准"）

### 6.1 指标

| 指标 | 定义 | 目标 |
|---|---|---|
| **MAE** | `mean(|eta − 实际|)` | 高铁 ≤ 3 min；普速 ≤ 8 min |
| **RMSE** | 平方均值根 | — |
| **P50 / P90** | 误差分位数 | 高铁 P90 ≤ 6 min；普速 P90 ≤ 20 min |
| **覆盖率** | 实际落在 `eta ± σ` 内的比例 | ≈ 68%（1σ 校准是否诚实） |
| **区间判定准确率** | "当前在 A→B 区间"是否正确 | ≥ 98%（现算法需先修 P0-1） |
| **跳变率** | 列车标记单帧位移 > 3 km 的次数/小时 | ≤ 1 |

### 6.2 真值来源（三档，从易到难）

1. **仿真回放（立即可做）**：复用现有 `?mockNow=` 与 `?progress=` 钩子，构造时间轴；注入合成 GPS（丢星率、accuracy 分布、晚点曲线），跑新旧算法对比。**零成本，先把 P0-1 的 634 km 误差量化出来。**
2. **众包标注（中期）**：地图上每个景点气泡加「已到 / 未到」按钮 + 「我现在在这儿」；用户点一下就产生一条真值 `(spotId, 实际时刻)`。存本地 + 可选匿名上报。
3. **志愿轨迹上传（后期）**：用户授权后上传一趟完整 GPS 轨迹（含 accuracy、时间戳），离线重放评估。这是最有价值的资产。

### 6.3 基准车次集（覆盖两种铁路 + 各种几何质量）

| 车次 | 类型 | 几何来源 | 覆盖的问题 |
|---|---|---|---|
| Z8991 西宁→拉萨 | 普速 Z | 精品预置 | 站距极不均匀（P0-1 重灾区）、高原长区间 |
| G1 京沪 | 高铁 G | 精品走廊 | 站距均匀（验证不退化）、高速、枢纽进出 |
| 某 K 车 京广 | 普速 K | 站点示意线 | 小站密集 + 示意线几何误差 + 会让 |
| 某 D 车 成渝/山区 | 动车 D | OSM | 隧道密集、GPS 断续 |
| Z509（走兰新高铁） | Z 车走高铁 | 走廊覆写 | 车型分类例外分支 |

### 6.4 仿真噪声参数（注入用）

```
GPS 采样间隔：1 s（开阔） / 5~30 s（弱信号）
accuracy 分布：lognormal，开阔 μ=25 m；城市 μ=120 m；WiFi 兜底 μ=800 m（占 8%）
丢星：山区/隧道 每 5~15 min 断 30~180 s；平原 <2%
晚点注入：普速 起始 N(0,8) min，每小时 +N(3,3) min（累积），随机非计划停车 0.4 次/h × N(6,3) min
          高铁 起始 N(0,4) min，每小时 +N(0.4,1) min，恢复 30%
```

---

## 7. 落地路线图（不改代码 → 分阶段改）

### Phase 0 — 修正确性（1～2 天，收益最大）

| # | 改动 | 文件 |
|---|---|---|
| 0.1 | 新增 `buildMileageAxis()`：站投影里程 + PAVA 单调化 + 端点硬钉 | `shared/src/schedule/mileage.ts`（新） |
| 0.2 | `scheduleProgress` 改用**里程比例**插值替代站序比例 | `shared/src/schedule/progress.ts` |
| 0.3 | `resolveProgress` 的 `projected.progress` 与 `scheduleP` 统一到里程域（消除量纲混用） | 同上 |
| 0.4 | GPS 门限收紧：`accuracy > 300` 判弱；垂距门改为自适应 `clamp(3·acc+500, 800, 5000)` | 同上 |
| 0.5 | `useGeolocation` 补采 `coords.speed` / `heading`，加 30 点环形缓冲 | `apps/web/src/composables/useGeolocation.ts` |
| 0.6 | **坐标系核查**：确认 `stations-geo.json` 与折线同为 WGS-84；高德 GCJ-02 兜底必须转换 | `apps/api/src/services/geocode.ts` |
| 0.7 | 单元测试：Z8991 里程轴、单调性、端点 | `packages/shared/src/schedule/mileage.test.ts`（新） |

**验收**：Z8991 格尔木处进度从 14.3% → 44.3%；仿真区间判定准确率 ≥ 98%。

### Phase 1 — 景点图定时刻（2～3 天，本次核心诉求）

| # | 改动 | 文件 |
|---|---|---|
| 1.1 | `classifyTrain()` + `TrainProfile` 参数表 | `shared/src/schedule/trainProfile.ts`（新） |
| 1.2 | `solveSegment()` / `tauAt()` 运动学反演 | `shared/src/schedule/kinematics.ts`（新） |
| 1.3 | `buildScheduleCurve()`：里程 ⇄ 时间双向函数 + `segSlack` | `shared/src/schedule/scheduleCurve.ts`（新） |
| 1.4 | `estimateSpotEtas()`（先只做图定，δ=0） | `shared/src/schedule/spotEta.ts`（新） |
| 1.5 | `filterSpotsAlongRailway` 输出保留 `progressKm`（已有），`scenicSpots` 增加 `etaPlanIso` | `shared/src/schedule/scenic.ts` |
| 1.6 | `getUpcoming` 改为：有 `etaIso` 用之，无则回退下一站（不再只看 `spot.at`） | `shared/src/schedule/progress.ts` |
| 1.7 | 景点气泡 / 底部卡片展示「预计 HH:mm」 | `apps/web/src/pages/TripMap.vue` |
| 1.8 | 使用 `stopover_time` 校验站停、识别技术停车 | `apps/api/src/services/cr12306.ts` |

**验收**：任意 12306 车次打开后，每个景点都有图定预计时刻；Z8991 与预置 `at` 对比误差 < 3 min。

### Phase 2 — 实时融合与延误场（3～5 天）

| # | 改动 | 文件 |
|---|---|---|
| 2.1 | 一维卡尔曼 `[s, v]` + 三重野值门 + 单调约束 | `shared/src/schedule/fusion.ts`（新） |
| 2.2 | 延误场 `DelayField`：锚点、冗余 slack、恢复外推、非计划停车 | `shared/src/schedule/delayField.ts`（新） |
| 2.3 | 状态机 `RUNNING/DWELL/UNPLANNED_STOP/NO_SIGNAL` + 自动停站校准 | `apps/web/src/composables/useTrainTracker.ts`（新） |
| 2.4 | 双通道外推（延误场 + 实测速度），`w = exp(−ΔT/τ)` | `shared/src/schedule/spotEta.ts` |
| 2.5 | 几何质量 `σ_geo` 由 `railwaySource` / `qualityTier` 传入 | `apps/api/src/routes/railGeometry.ts` → 前端 store |
| 2.6 | 校准改为"落锚点"而非全局平移（保留旧字段兼容） | `shared/src/schedule/index.ts`、`prefsStore.ts` |
| 2.7 | 融合/运动学/延误场的单元测试（含合成噪声） | 对应 `*.test.ts` |

**验收**：仿真下 MAE 高铁 ≤ 3 min、普速 ≤ 8 min；跳变率 ≤ 1/h。

### Phase 3 — 置信度与数据闭环（2～3 天）

| # | 改动 |
|---|---|
| 3.1 | ETA 展示 `HH:mm ±N 分钟` + 置信度角标 + 依据来源 |
| 3.2 | 日出日落计算，动态标注"夜间经过"（替代静态 `nightOnly`） |
| 3.3 | 景点气泡「已到 / 未到」众包标注按钮 + 本地真值日志 |
| 3.4 | 仿真评测脚本 `scripts/eval-eta.mjs`，输出 MAE/P50/P90 报告 |
| 3.5 | （可选）接入 12306 正晚点接口作为高可信锚点 |

---

## 8. 风险与未决问题

| # | 问题 | 建议 |
|---|---|---|
| R1 | **`ΔS_k` 来自折线几何，不是真实铁路里程**。示意线（站点连线）在山区可低估 10–30%，直接污染景点在区间内的相对位置 | 短期：用 `σ_geo` 显式建模、放宽置信度。中期：引入官方「客运运价里程表」的**站间里程**作为真值，做分段比例校正（可建 `data/rails/segment-mileage.json`）。这是**精度天花板所在** |
| R2 | **里程轴与真实里程不同源**时，§3.2 反推出的 `v` 会不合理（如 K 车算出 400 km/h） | 加**合理性哨兵**：`v > 1.4·v_cap` 或 `v < 0.35·v_min` → 标记该区间几何可疑，降级为匀速 + 计入 `σ_geo` 放大 |
| R3 | 折返 / 环线 / 并行线（复线上下行相距 10–50 m，2D 投影无法区分）会让 `S_i` 错乱 | PAVA 单调化 + 端点硬钉可兜住大部分；极端情况（如枢纽内折返）建议直接降级为"仅时刻表"模式并提示 |
| R4 | 浏览器 GPS 在高铁车厢内实测可用性未知 | Phase 0 先做**采样埋点**（accuracy 分布、丢星率、车速相关性），用真实数据反哺 §4 参数 |
| R5 | 坐标系混用（GCJ-02 / WGS-84）可能存在 300–600 m 系统偏移 | Phase 0.6 必须核查清楚；若确认混用，加统一转换层 |
| R6 | `nightOnly` 是静态标记，与实际通过时刻可能矛盾 | Phase 3.2 改为按 ETA 实时算日出日落 |
| R7 | 众包真值可能稀疏 | 先用仿真（Phase 0/1 验收）+ 内部实测，众包作为长期校准源 |
| R8 | 12306 反爬 / 接口变动 | 已有 `QUERY_PATHS` 多路径回退；建议给 `getStops` 结果加长 TTL 缓存并落盘，接口挂了也能用历史时刻表 |

---

## 9. 附：现有代码需要删除/替换的函数签名

```ts
// 现有（将被替换）
scheduleProgress(params): number          // 站序比例 → 改为基于 mileage 的 kmAtTime()
resolveProgress(params): ProgressResult   // 固定权重 → 改为方差融合，返回 { km, v, sigma, mode }
getUpcoming(params): {...}                // 依赖 spot.at → 改为基于 SpotEta[]

// 保留兼容
projectToRailway / pointAtProgress / buildRailwayMetrics / haversineKm   // 基础几何，不变
resolveSchedule / shiftDate / effectiveScheduleDate                      // 语义微调（校准改锚点）
filterSpotsAlongRailway                                                  // 扩展输出 km + eta
```

---

## 10. 建议的下一步

1. **立刻**：跑一次 §6.1 的仿真，把 P0-1 的 634 km 误差写成可复现的失败用例（Phase 0 的验收基线）。
2. **Phase 0** 先上（不改 UI、不改数据格式，纯内部精度修正），风险最低、收益最大。
3. **Phase 1** 是用户诉求主体（"根据到站时间预估景点到达时间"），需产品确认展示口径：`HH:mm` 还是 `HH:mm ±N`？是否显示"依据"？
4. **Phase 2** 之前先做 R4 采样埋点，用真实 GPS 数据标定 `σ_acc` 与丢星率，避免参数拍脑袋。
