# 铁路窗景坐标：选点策略与校验改点方案

> 用途：解决「入库景点打点不准」——明确该钉地物本体还是可靠轨，以及用什么服务验证、纠正。  
> 更新：2026-09-14  
> 相关：`docs/scenic-spots-spec.md`（字段与匹配）、`docs/scenic-railway-lines.md`（沿途看点命名习惯）、`scripts/build-scenic-spots-curated.mjs`（策展源）

---

## 0. 产品约定（硬规则）

**地图钉 = 景点确切位置，不是「预计能看到的位置」。**  
远眺（`distant`）与窗外（`window`）**同一打点语义**：都钉地物本体。

| 情况 | 坐标怎么取 |
|---|---|
| 具名点状/景区（古城、山峰、莫高窟、华山…） | 钉**本体真值**；用 `distant`/`maxDistKm` 保证匹配，**禁止**钉高铁站或臆测望点 |
| 大面积（湖、盆地、平原、戈壁、花海、山脉麓…） | 在**本体范围内**取点，可**适当靠近铁路线**（近岸/近缘/穿越带） |
| 穿行工程（盐桥、跨海桥） | 钉结构/轨面；`on_track` |
| 火车根本看不到 / 站距百公里级 | **不入库**，不要造望点 |

匹配与展示分工：

- `lng/lat` → 地图钉（用户认知）
- `visibility` + `maxDistKm` → 是否命中当前行程折线
- 简介可写「站在北侧 / 可远眺」，**不要**把站坐标写成景点坐标

常见偏点原因：

| 误用 | 后果 |
|---|---|
| 把高铁站 / 轨旁望点当成景点 | 平遥钉在平遥古城站、华山钉在华山北站 → 与底图标签冲突 |
| 大面积直接用湖心/行政质心且不靠轨 | 离轨过远被过滤，或进度钉错段 |
| 粗坐标、GCJ-02 未转 WGS84 | 飞点或系统性偏移 |
| 名称带「方向」却只钉望点、不给本体 | 用户以为景在轨道上 |

---

## 1. 从风景线文档提炼的选点策略

来源：`docs/scenic-railway-lines.md` 各线「沿途看点」写法 + 上表硬规则。

### 1.1 命名与可见性（文档习惯 → 库字段）

| 文档用语 | 含义 | 入库策略 |
|---|---|---|
| `…方向` / `…方向远眺` | 车上看得到本体方位 | 钉**本体**（若可见）；`distant` + 够用 `maxDistKm`；名称可保留「方向」或改为景名 |
| `站距景区 xx km` / `转汽车` | 多数看不见 | **不入库**或待审；禁止用景区中心冒充窗景 |
| `铁路从…上通过` / `跨…大桥` | 车在地物上 | `on_track`；钉桥隧/穿城真值 |
| `沿…北岸/南缘穿行` | 大面积贴线廊道 | 在水体/地貌**靠铁路一侧**取点（属「适当靠近铁路线」） |
| `万亩…` / `无人区` / `戈壁` / `盆地` / `平原` | 广域 | 本体范围内靠轨代表点；可放宽 `maxDistKm` |

文档反例：

- **九寨沟**（站距约 100 km）→ 不收为窗景，勿钉景区中心充数  
- **平遥古城 / 华山** → 钉古城/山体，不钉平遥古城站 / 华山北站  
- **青海湖等大湖** → 钉靠铁路一侧湖岸或近岸水域，勿钉湖心也不要钉车站  

### 1.2 地物类型 → 存什么坐标

| 类型 | 库内 `lng/lat` | 禁止 |
|---|---|---|
| 具名地标 / 山峰 / 古城 / 景区 | 本体真值（Wikidata/OSM/权威坐标） | 车站、望点 |
| 大湖 / 盐湖 / 湿地 | 靠铁路一侧的岸线或近岸点 | 湖心（除非湖心本就近轨） |
| 江河段 / 峡谷 / 海岸 | 该段水体或谷地真值，可略靠轨 | 整市行政中心 |
| 盆地 / 平原 / 戈壁 / 花海 / 山麓 | 穿越带或近缘代表点（适当靠轨） | 为匹配硬吸附到站房 |
| 远眺雪山 / 丹霞等 | **峰/景区真值** + `distant` | 轨道投影点冒充山名 |
| 轨上工程 | 结构中心或轨面 | 游客中心 |

### 1.3 与走廊匹配的硬约束

- 点到关联走廊：`distKm ≤ (maxDistKm ?? DEFAULT[visibility])`  
  默认：`on_track` 3 / `window` 8 / `distant` 35（km）。
- 真值偏远但确可见 → **加大 `maxDistKm`**，不挪钉。
- 多走廊共享：至少一条走廊合格，且进度落在合理站段。

### 1.4 实现注意

策展脚本里的 `snapQingzangToRailway` 会把部分青藏点吸到轨上——**与「具名远眺钉本体」冲突**。后续应改为：

- 具名山峰/圣湖：**禁止** snap，只调 `maxDistKm`
- 广域戈壁/无人区：允许在本体范围内向走廊靠拢（或保留靠轨代表点）

---

## 2. 外部服务选型（精度优先）

原则：**主源与走廊同为 WGS84/OSM 体系**；国内图商作中文名消歧与争议复核，**必须 GCJ-02 → WGS84** 后再与库内坐标比较。

### 2.1 推荐组合（混合）

| 优先级 | 服务 | 用途 | 精度/注意 |
|---|---|---|---|
| **P0** | **Wikidata** `P625`（SPARQL）+ 中文标签 | 具名山峰、湖泊、遗产、工程的本体真值 | 面状代表点若是湖心 → 再取靠轨岸点 |
| **P0** | **OSM Overpass** | `name`/`name:zh` + 标签取节点/面 | 大面积优先「相对走廊最近边界」 |
| **P1** | **Nominatim**（`countrycodes=cn`） | 名称 → 候选 | 限流 + User-Agent |
| **P1** | **高德 Place**（可选） | 中文召回 | 转 WGS84 后再用 |
| **P2** | 维基 / 文旅稿 + 人工 | 西部稀疏区 | 记 `verifyNote` |

### 2.2 Wikidata 示例

```sparql
SELECT ?item ?itemLabel ?coord WHERE {
  ?item rdfs:label "青海湖"@zh.
  ?item wdt:P625 ?coord.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "zh,en". }
}
```

高德结果必须 GCJ-02 → WGS84 后再与库比较。

### 2.3 校验报告字段（建议）

| 字段 | 含义 |
|---|---|
| `featureLng/Lat` | 权威本体真值 |
| `lng/lat` | 入库展示点（真值，或大面积靠轨后的点） |
| `verifySource` | `wikidata` / `osm` / `amap` / `manual` |
| `verifyStatus` | `ok` / `pull_toward_rail` / `mismatch` / `ambiguous` / `reject_invisible` |

---

## 3. 校验流水线（建议脚本：`verify-scenic-spot-locations.mjs`）

```
1. 关联走廊，算 distKm / progressKm
2. 本地门禁：far_from_rail / coarse_coord / out_of_bounds
3. 外部真值：Wikidata / OSM / Nominatim（可选高德）
4. 判定
   - 具名点：展示点应≈真值；若钉在车站 → mismatch
   - 大面积：允许展示点在真值与走廊之间靠轨一侧
   - 过远不可见 → reject，不造望点
5. 改策展源 → 重生 scenic-spots.json → 行程回归
```

### 3.1 判定阈值（经验）

| 检查 | 建议 |
|---|---|
| 具名点 vs 真值 | 偏差 > ~2–3 km 且更靠近车站 → 必改回真值 |
| 大面积靠轨 | 仍须落在地物语义范围内；不要吸到站房 |
| `window`/`on_track` 离轨 | 超默认阈值 → 升 `distant` 或加大 `maxDistKm`，或靠轨微调 |
| 同名歧义 | 与错误候选更近 → `wrong_homonym` |

### 3.2 改点写入规范

1. 只改 `scripts/build-scenic-spots-curated.mjs`，再重生 JSON。  
2. 简介写清方位关系，不暗示「钉在望点」。  
3. 具名点改完后对照底图标签；大面积点对照「是否还在该地貌里」。

---

## 4. 人工抽检清单

1. 打开库内坐标：是否落在**景名标签/山体/古城**上，而不是高铁站。  
2. 远眺点是否仍是本体（华山→山，不是华山北站）。  
3. 大面积点是否在地貌内且合理靠轨。  
4. 打开经停该线的车次：能否命中、进度是否在正确站段。

优先抽检：名称含站名却不是车站的点、`distant` 山峰、一位小数广域点、曾 snap 到走廊的点。

---

## 5. 落地命令与产物（已实现）

```bash
# 外部真值（需能访问 Wikidata / Nominatim）
node scripts/calibrate-scenic-spot-locations.mjs --fetch --write

# 仅用已有真值缓存重算 patches（推荐日常）
node scripts/calibrate-scenic-spot-locations.mjs --write

# 从策展源重生（会应用 patches + 青藏广域靠轨）
node scripts/build-scenic-spots-curated.mjs
```

| 文件 | 说明 |
|---|---|
| `data/presets/_scenic-wikidata-truths.json` | 外部真值缓存（可用 `build-scenic-wikidata-truths.mjs` 重生；同名错配由脚本守卫拒绝） |
| `data/presets/scenic-spot-calibration-patches.json` | 校准补丁（build 时应用到策展结果；持久产物） |

校准脚本干跑时可能在 `data/presets/` 写出 `_scenic-calibration-*.json` 等临时报告，**勿入库**（已 gitignore）。

**同名错配守卫：** 真值相对策展旧点位移 &gt; ~80 km（粗坐标 ~120 km）则忽略；并要求真值离关联走廊合理。  
**青藏：** 具名山峰/圣湖禁止吸轨；仅广域点可向走廊插值靠拢。

| 阶段 | 状态 |
|---|---|
| A 约定 | 已写入本文 + spec §3.3 |
| B 门禁脚本 | `calibrate-scenic-spot-locations.mjs` |
| C 具名回真 | 已跑；坏同名已过滤 |
| D 大面积靠轨 | 已跑 |
| E 青藏 snap 收紧 | `build-scenic-spots-curated.mjs` 已改 |

人工仍须抽检：`reject_or_manual` / `keep_bad_truth_rejected` 列表见 report。

离轨修正（2026-09-15）：`node scripts/fix-scenic-off-rail.mjs --write` → 日志 `docs/scenic-off-rail-fix-log.md`（非 `on_track` 且离轨 &lt; 0.8 km 的侧向挪开；已准点不动）。

---

## 6. 反例 → 正例

```
❌ 平遥古城 = 平遥古城站
✅ 平遥古城 = 古城墙/县城本体；distant + maxDistKm

❌ 华山 = 华山北站贴线望点
✅ 华山 = 风景区主峰一带；distant + maxDistKm

❌ 青海湖 = 臆测「车窗最佳像素点」且远离湖体
✅ 青海湖 = 靠铁路北岸的湖体/岸线点（大面积适当靠轨）

❌ 九寨沟景区中心硬塞进川青窗景
✅ 站距过远看不见 → 不入库
```

---

## 7. 与现有文档/代码的关系

| 资产 | 职责 |
|---|---|
| `scenic-railway-lines.md` | 哪条线、沿途看什么 |
| `scenic-spots-spec.md` | 字段、匹配、§3.3 打点硬规则 |
| **本文** | 策略细则、校验服务、改点流程 |
| `build-scenic-spots-curated.mjs` | 策展源 |
| `filterSpotsAlongRailway` | 按行程过滤（不负责改库内坐标） |

---

## 8. 决策摘要

| 项 | 结论 |
|---|---|
| 远眺 / 窗外打点 | **都钉景点确切位置** |
| 大面积 | 本体范围内**适当靠近铁路** |
| 匹配 | `visibility` + `maxDistKm`，不靠挪望点 |
| 看不见 | 不入库 |
| 校验主源 | Wikidata + OSM；高德转 WGS84 复核 |
| 写入 | 改策展脚本 → 重生 JSON |
