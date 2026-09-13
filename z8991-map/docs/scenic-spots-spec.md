# 铁路沿线风景点：搜集格式、查询返回与实现约定

> 用途：约定「全局风景点库」如何搜集入库，以及用户打开具体车次后如何按行程折线动态展示景点。  
> 更新：2026-09-13  
> 相关：走廊清单见 `docs/scenic-railway-lines.md`；演示样例见 `data/presets/z8991.json` 的 `scenicSpots`。

---

## 1. 产品目标（已拍板）

| 项 | 约定 |
|---|---|
| 触发时机 | 用户打开**具体车次**后，展示该行程铁路线附近的景点 |
| 匹配几何 | 使用该车次解析出的**实际行程折线**（可跨多条走廊拼接 + OD 切片后），**不是**整条走廊全长 |
| 无数据 | 库中筛不到匹配点 → **不显示**景点层（不报错、不占位） |
| 展示内容 | **名称 + 简介 + 地图打点**；第一版**不要**过景时间（无 `timeLabel` / `at` 依赖） |
| 收集密度 | 单线大约 **8～20** 个；**关键/出名必收**，其余适量；宁缺毋滥 |
| 精度策略 | 策展 + 分档距离门禁；不做视线分析 / DEM / 隧道检测 |

---

## 2. 仓库落盘位置

| 路径 | 说明 |
|---|---|
| `data/presets/scenic-spots.json` | **唯一**全局风景库（第一版单文件，不按区域拆） |
| `scripts/build-scenic-spots-curated.mjs` | 策展数据源脚本；改点后运行以重生 JSON |
| （可选）飞书/表格 | 仅作搜集工作表；导入后以仓库 JSON 为准 |

**现状（2026-09-13 策展第四轮）：** 约 **327** 条。原则：只收核心/出名窗景，不为凑数灌点。空白走廊仅余郑阜等无明显窗景干线（保持 0 命中属预期）。

体量预期：风景线 × 每线十余点，远小于需拆文件的规模。超过约 500 点后再考虑分区。

---

## 3. 搜集入库格式（你需要提交的数据）

### 3.1 文件根结构

```json
{
  "version": 1,
  "updated": "2026-09-13",
  "spots": [ /* ScenicSpotInput[] */ ]
}
```

### 3.2 单条景点字段（搜集必填 / 选填）

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `id` | 是 | `string` | 全局唯一，稳定英文短横线，如 `qinghai-lake`。**禁止**用纯数字 id（避免与车次预设冲突难迁移） |
| `name` | 是 | `string` | 展示名，如 `青海湖`、`察尔汗盐湖（万丈盐桥）` |
| `lng` | 是 | `number` | 经度（WGS84，与现有走廊/站点一致） |
| `lat` | 是 | `number` | 纬度 |
| `intro` | 是 | `string` | 一两句：能看到什么、为何有名；可写清「远眺 / 穿行」 |
| `visibility` | 是 | 枚举 | 见下表 |
| `maxDistKm` | 否 | `number` | 点到**行程折线**的最大允许距离（km）。空则用 visibility 默认值 |
| `category` | 否 | 枚举 | `lake` \| `mountain` \| `gorge` \| `grassland` \| `desert` \| `engineering` \| `other` |
| `nightOnly` | 否 | `boolean` | `true` = 该段多为夜间经过；仅作角标提示，**不算时刻** |
| `side` | 否 | 枚举 | `left` \| `right` \| `both` \| `unknown`；第一版可不填，UI 不强调靠窗 |
| `source` | 否 | `string` | 默认入库写 `"curated"`；从 Z8991 迁移的可写 `"preset"` |

#### `visibility` 含义与默认半径

| 值 | 含义 | 默认 `maxDistKm` | 典型例子 |
|---|---|---|---|
| `on_track` | 列车从其上/其内穿过 | `3` | 万丈盐桥、风火山隧道一带 |
| `window` | 车窗可见的沿线景观 | `8` | 措那湖贴岸、峡谷段 |
| `distant` | 远眺，不要求贴窗 | `35` | 纳木错远观、格拉丹东远眺 |

个别点可手改 `maxDistKm`（例如某远眺只要 20）。

### 3.3 坐标选取规则（重要）

| 地物类型 | 应存的坐标 | 禁止 |
|---|---|---|
| 点状（山口、地标、工程点） | 地物本身或铁路旁最近观景点 | — |
| 面状/线状（大湖、无人区、草原、峡谷） | **铁路旁最佳观景参考点**（贴线一侧） | 官方景区中心 / 湖心（易离铁路过远被滤掉） |
| 远眺 | 列车上大致能望见时的位置，`visibility=distant` | 把目标山峰/湖心坐标硬塞成 window |

不确定能否从火车看到 → 不入库，或标入工作表「待审」列，**不要**进正式 `spots`。

### 3.4 收录标准

**必收：** 公开资料常提的「坐火车必看」、标志性地貌、著名工程奇迹。  
**可收：** 有辨识度，且 `intro` 能写清「车上看什么」。  
**不收：** 城市商场/与铁路无关景区、说不清可见性的点、与已有 `id` 重复的同义点。

站名与景名可并存（如「沱沱河」站 vs 「沱沱河（长江正源）」景），用不同 `id` + `category` 区分。

### 3.5 搜集样例（单条）

```json
{
  "id": "qinghai-lake",
  "name": "青海湖",
  "lng": 100.274005,
  "lat": 36.619181,
  "intro": "中国最大的内陆咸水湖，铁路沿湖北岸一带穿行，可饱览碧湖、草原与雪山同框的高原盛景。",
  "visibility": "window",
  "category": "lake",
  "nightOnly": true,
  "source": "curated"
}
```

### 3.6 从 Z8991 迁移注意

`data/presets/z8991.json` 内既有 `scenicSpots`：

- **保留：** `name` / `lng` / `lat` / `intro` / `nightOnly`
- **改写：** 赋予稳定英文 `id`；补 `visibility`（按简介判断）；`source` 可用 `"preset"`
- **去掉（总库不依赖）：** `trainCode`、`at`、`timeLabel`（第一版展示不需要时间）
- 车次演示仍可暂时保留旧字段；全局库以本规格为准，打开任意车次走「折线过滤」路径

---

## 4. 查询返回格式（打开车次后 API / 前端使用）

### 4.1 请求语义

- **输入：** 当前车次已生成的行程折线 `railway: [lng, lat][]`（实际行程，含拼接与 OD 切片）
- **过程：** 对 `scenic-spots.json` 中每点计算到折线的最短距离与沿线进度；`distKm <= maxDistKm(点)` 则命中
- **排序：** 按沿线进度升序（与行车方向一致）
- **空结果：** 返回空数组 `[]`，前端不渲染景点

> 第一版可不单独开 HTTP；也可由行程接口一并带上 `scenicSpots`。若开独立接口，建议：`GET`/`POST` 带折线或 `tripId`，响应体如下。

### 4.2 响应根结构

```json
{
  "scenicSpots": [ /* ScenicSpotView[] */ ]
}
```

无命中：

```json
{
  "scenicSpots": []
}
```

### 4.3 单条返回字段（`ScenicSpotView`）

| 字段 | 必有 | 类型 | 说明 |
|---|---|---|---|
| `id` | 是 | `string` | 同库内 id |
| `name` | 是 | `string` | 展示名 |
| `lng` | 是 | `number` | 地图打点 |
| `lat` | 是 | `number` | 地图打点 |
| `intro` | 是 | `string` | 简介 |
| `visibility` | 是 | 枚举 | `window` \| `distant` \| `on_track`；UI 可显示小标签「窗外 / 远眺 / 穿行」 |
| `category` | 否 | `string` | 分类，可选用于图标 |
| `nightOnly` | 否 | `boolean` | 角标「夜间」；**不**表示具体钟点 |
| `distKm` | 是 | `number` | 点到本行程折线的最短距离（km），便于调试与后续调参 |
| `progressKm` | 是 | `number` | 投影点距行程折线起点的累计公里，用于排序与列表顺序 |
| `side` | 否 | 枚举 | 有则返回；无则省略 |
| `source` | 是 | `string` | 如 `curated` / `preset` |

### 4.4 返回样例

```json
{
  "scenicSpots": [
    {
      "id": "qinghai-lake",
      "name": "青海湖",
      "lng": 100.274005,
      "lat": 36.619181,
      "intro": "中国最大的内陆咸水湖，铁路沿湖北岸一带穿行，可饱览碧湖、草原与雪山同框的高原盛景。",
      "visibility": "window",
      "category": "lake",
      "nightOnly": true,
      "distKm": 2.4,
      "progressKm": 86.5,
      "source": "curated"
    },
    {
      "id": "tanggula-pass",
      "name": "唐古拉山口",
      "lng": 91.920087,
      "lat": 32.86254,
      "intro": "海拔约 5072 米，青藏铁路全线海拔最高点一带。",
      "visibility": "on_track",
      "category": "mountain",
      "distKm": 0.3,
      "progressKm": 1420.1,
      "source": "curated"
    }
  ]
}
```

### 4.5 第一版明确不返回 / 不依赖

- `timeLabel`、`at`、预计过景时刻  
- `trainCode`（景点不绑定单一车次）  
- 未命中时的占位文案或「附近推荐」

（有时刻表后若要做「约 HH:MM / 两站之间」，属第二期，另开约定。）

---

## 5. 匹配与展示规则（实现约束）

1. **折线来源：** 打开车次后的实际行程几何（走廊匹配/路网拼接 → OD `slicePolylineByOd` 之后）。  
2. **距离：** 点到折线各线段的最短大圆距离（haversine 即可）。  
3. **阈值：** `distKm <= (spot.maxDistKm ?? DEFAULT[visibility])`。  
4. **排序：** `progressKm` 升序。  
5. **UI：** 地图点 + 列表（名称、简介、visibility 标签；`nightOnly` 可选角标）。  
6. **图层：** 与现有 `spot` 图层开关兼容；无数据则图层为空。

### 5.1 已实现挂载（2026-09-13）

| 层级 | 位置 | 行为 |
|---|---|---|
| 共享过滤 | `@railvista/shared` → `filterSpotsAlongRailway` | 阈值 + 沿线排序 |
| API 库加载 | `apps/api/src/services/scenicSpots.ts` | 读 `scenic-spots.json`（mtime 热更） |
| 挂载行程 | `POST /api/rail-geometry` 与 `/jobs` 快照 | 响应带 `scenicSpots` |
| 进入行程 | `SelectTrip.enterTrip` / 演示 | 使用几何接口返回的景点 |
| Store | `tripStore.setTrip` / `applyPreciseCoords` | 按最终折线再筛；精确升级后重匹配 |
| 地图 | `TripMap` 风景图层 | 名称 + 简介；标签「窗外/远眺/穿行」 |

重生库：`node scripts/build-scenic-spots-curated.mjs`（青藏点会自动投影到 `z8991-railway`）。

---

## 6. 入库质检清单（提交前自检）

- [ ] `id` 全局唯一、英文短横线、可长期稳定引用  
- [ ] `name` / `intro` / `lng` / `lat` / `visibility` 齐全  
- [ ] 坐标为中国境内合理范围；面状景观点为**贴线观景参考点**  
- [ ] 单线关键出名点已覆盖，总数约 8～20，无灌水 POI  
- [ ] 同义重复已合并（保留一个 id）  
- [ ] 远眺类已标 `distant`，穿行类已标 `on_track`  
- [ ] 未写入 `trainCode` / `at` / `timeLabel` 作为总库必填项  

建议后续脚本（实现阶段）：对库内点相对已知风景走廊折线算一遍距离，过大且非 `distant` 的给出 warning。

---

## 7. 与走廊文档的关系

- `docs/scenic-railway-lines.md`：管**哪条铁路**入库（走廊几何）。  
- **本文档**：管**沿线看什么**（风景点库 + 打开车次后的动态过滤）。  
- 走廊 JSON（`data/presets/corridors/*.json`）**不**内嵌风景列表，避免多线共享景点重复维护。

---

## 8. 决策记录（问答结论）

| 问题 | 结论 |
|---|---|
| 何时展示 | 打开具体车次 |
| 用哪段几何 | A：实际行程折线（可跨廊拼接） |
| 库文件形态 | 单个 `scenic-spots.json` |
| 要不要时间 | 不要；只要名称 + 简介 + 地图 |
| 收集范围 | 关键出名必收，其余适量 |
| 单线数量 | 约 8～20，偏精选 |
| 无匹配 | 不显示 |
