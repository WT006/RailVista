# 铁路沿线景点：AI 生成 / 审查 / 优化 全流程方案

> 日期：2026-09-26 ｜ 版本 v1
> 配套交付物：
> - `docs/scenic-schema-v3.md` —— **景点数据结构 v3 字段定义**（六维分类、线路归属、左右侧、时段、来源）
> - `docs/prompts/scenic-spots-generate.md` —— **可直接复制使用的 AI 生成提示词**（含关键词模板与 few-shot）
> - 本文 —— 分类体系、可观赏性约束、检索策略、算法流程、真实性保障、存量 414 条审查修正流程
>
> 所有现状数字均为本机实测（脚本只读，未改动任何数据文件）。

---

## 0. 现状盘点（先看清楚要补多少）

### 0.1 资产清单

| 文件 | 内容 | 规模 |
|---|---|---|
| `data/presets/scenic-spots.json` | 主库（唯一真源） | **414 条** |
| `scripts/build-scenic-spots-curated.mjs` | 策展源（`spot({...})` 数组）→ 重生 JSON | 唯一写入口 |
| `data/presets/_scenic-wikidata-truths.json` | Wikidata 真值缓存 | 388 条（含 Q 号与坐标） |
| `data/presets/scenic-spot-calibration-patches.json` | 坐标校准补丁 | 327 条 |
| `scripts/calibrate-scenic-spot-locations.mjs` | 真值校准（--fetch/--write） | 已实现 |
| `scripts/fix-scenic-off-rail.mjs` | 离轨侧向修正 | 已实现 |
| `packages/shared/src/schedule/scenic.ts` | `filterSpotsAlongRailway`：按行程折线过滤 + 按 `progressKm` 排序 | 已实现 |
| `docs/scenic-v2-deferred-ingest.md` | 暂缓入库清单 | 20 条（缺走廊 / 缺真值） |

### 0.2 现有字段实测分布（问题所在）

| 字段 | 现状 | 缺口 |
|---|---|---|
| `category` | `other` **189（45.6%）**、mountain 77、engineering 41、gorge 39、lake 30、desert 21、grassland 17 | 无分类体系 |
| `visibility` | window 244 / distant 138 / on_track 32 | 尚可，但缺"近景/远景"维度 |
| `source` | `curated` 396 / `preset` 18 | **无 URL、无外部 ID，不可核验** |
| `side` | **0 条填充** | 全空 |
| `nightOnly` | 3 条 | 几乎无时段信息 |
| 所属线路 / 里程区间 | **无字段** | 完全缺失 |

### 0.3 覆盖率实测（248 条走廊 × 414 景点，按各自 `maxDistKm` 判定命中）

| 分档 | 走廊数 | 占比 |
|---|---|---|
| 景点 ≥8（达标） | **29** | 11.7% |
| 景点 1~7（偏少） | **157** | 63.3% |
| 景点 0（完全空白） | **62** | **25.0%**，合计 **14,186 km** |

**主要干线严重欠配**：京九线 2344 km 仅 6 个、京广高铁 2108 km 仅 7 个、京广线 2042 km 仅 6 个、兰新线 1816 km 仅 6 个、京沪线 1431 km 仅 7 个、宁西线 1098 km 仅 2 个。

**另有 18 个"孤儿景点"**（库里有、但从未命中任何走廊）：纳木错（远观）、人字桥、果子沟大桥、赛里木湖（远眺）、那拉提草原、元阳哈尼梯田、徐闻北港火车轮渡、金沙江大桥、怒江特大桥、北部湾西湾跨海……
→ 这 18 条正是"走廊几何缺失/精度不足"造成的，与 `docs/scenic-v2-deferred-ingest.md` §2.1 的走廊缺口一一对应。**补走廊与补景点必须并行。**

### 0.4 结论

不是"从零建库"，而是：**① 62 条空白线补点（14,186 km）→ ② 157 条偏少线补到 8~20 → ③ 414 条存量补分类/线路/左右侧/时段/来源 → ④ 18 个孤儿点随走廊补齐解冻。**

---

## 1. 景点分类体系（六维）

完整受控词表见 `docs/scenic-schema-v3.md` §3。此处给出体系设计与覆盖要求。

### 1.1 六维定义

| 维度 | 回答的问题 | 代表类型 |
|---|---|---|
| **大地理 `geo`** | 车窗外是什么地貌与空间格局 | 雪山冰川、山脉、峡谷、江河、湖泊盐湖、平原盆地、草原、沙漠戈壁、海岸海岛、湿地、喀斯特丹霞、森林、火山地热、梯田花海 |
| **大自然 `nature`** | 有什么生命与天象变化 | 季相植被（油菜花/胡杨/红叶）、野生动物（藏羚羊/丹顶鹤）、天象（云海/日出/星空/雾凇）、瀑布温泉 |
| **大人文 `culture`** | 有什么活态的人文生活 | 民族村寨、寺庙宗教、古镇古城、民俗节庆、牧渔场景、茶园果园 |
| **大历史 `history`** | 有什么历史层积 | 长城关隘、古道驿路、石窟壁画、古城遗址、革命纪念地、工业遗产、**铁路遗产**（人字桥、中东铁路老桥、百年老站）、古战场 |
| **大国建造 `construct`** | 有什么人造工程奇观 | **历史名桥与跨江跨海桥**、隧道与防风明洞、**展线与人字形**、高墩高架、**光热/光伏电站**、风电场、**水利工程**（三峡/丹江口/都江堰/坎儿井/红旗渠）、水电站、港口、特高压、冻土工程、站房 |
| **大国建筑 `architecture`** | 有什么可远望的建筑地标 | 历史建筑（应县木塔/布达拉宫/悬空寺）、现代地标（东方明珠/广州塔）、城市天际线、场馆、科教设施（FAST/卫星发射中心） |

用户点名类型全部落地：雪山→`geo/snow_mountain`、河流→`geo/river`、平原→`geo/plain_basin`、历史名桥→`history/railway_heritage` 或 `construct/bridge`、光热电站→`construct/solar_thermal`、水利工程→`construct/water_conservancy`。

### 1.2 近景 / 远景兼顾

`visibility` 只表达"距离档"，再叠加 `viewScale`（`near` <2 km / `mid` 2~15 km / `far` >15 km）。**每条线路的合格清单必须同时满足：**

- `near` 近景 ≥3 条（车窗里看得清细节：桥、湖岸、花海、站台、展线）
- `far` 远景 ≥2 条（天际线级别：雪山、山脉、大湖、丹霞、城市轮廓）
- 单线总数 8~20（冷门线可 6~15）

### 1.3 覆盖度验收

- 每条走廊：景点数 ≥8（长干线 1000 km 以上 ≥12）；
- 六维中至少命中 2 个维度（纯自然线可为 `geo`+`nature`，工程密集线可为 `construct`+`history`）；
- `other` 类归零（v3 的 subtype 词表必须能覆盖全部存量点）。

---

## 2. 可观赏性约束（硬门槛）

### 2.1 必标四项

每条景点必须给出：

1. **所属线路** `lines[].corridorId` —— 对应 `data/presets/corridors/*.json` 的 id；一条景可属多线。
2. **大致里程区间** `lines[].alongKmFrom/To` —— 沿该走廊折线自首点起算的累计公里；同时给 `nearStations`（最近两个经停站），便于人工核对与 UI 显示"约在 A—B 之间"。
3. **左侧 / 右侧** `side` —— 见 §2.3 的方向约定与运行时重算。
4. **最佳观赏时段** `bestView` —— 月份、时段（day/dawn/dusk/night/any）、光照、阻塞因素。

### 2.2 剔除规则（命中任一即不入库）

| 规则 | 判据 |
|---|---|
| 站距过远 | 景点距线路折线 > `distant` 上限（35 km，特殊 ≤50）且无远眺价值 |
| 需转乘 | 公开资料写明"距火车站 xx km / 需转汽车" → 直接剔除（九寨沟型） |
| 常年不可见 | 该段基本夜间通过且无夜景价值 → 剔除，或保留并标 `blocked: ["night_pass"]` |
| 物理遮挡 | 长隧道进出段、声屏障、城市连片建筑遮挡且无高视角 → 剔除或降级 |
| 仅为城市名片 | 与铁路视角无关的商业体/商圈 → 剔除 |
| 站景混淆 | 名为景点实为车站（"华山北站"≠"华山"）→ 改名钉本体，否则剔除 |
| 不可核验 | 凑不出 S/A 级来源 → 进 staging，不进主库 |

### 2.3 左右侧：存储与运行时

- **库内静态值**：`side` 定义为**以 `lines[0]` 走廊折线数组正方向（首点→末点）为前进方向**时的左右；`sideRefDirection` 固定写 `"line_forward"`。
- **运行时必须重算**（上行/下行左右相反）：在 `filterSpotsAlongRailway` 内用当前行程折线在投影点的切向量 `d` 与偏移向量 `v` 做叉积 `cross = d.lng*v.lat − d.lat*v.lng`：
  - `cross > 0` → `left`；`< 0` → `right`；
  - 垂距 < 0.15 km 或近直角 → `both`；`on_track` 恒为 `both`。
- **不一致处理**：库内静态值与运行时计算不一致 → 记入审查日志（可能是走廊折线方向反转，或 AI 侧别判断错误），不阻塞展示。

### 2.4 里程与左右侧由脚本自动回填

AI 只负责给候选点与侧别初判；`alongKm*` / `distKm` / 运行时 `side` 一律由脚本 `compute-spot-lines-and-sides.mjs` 计算，避免模型手算里程出错。

---

## 3. 检索策略

### 3.1 线路分层（决定走哪条检索路径）

| tier | 判据 | 检索主路径 |
|---|---|---|
| **hot 热门** | 高铁/城际干线、旅游热线、`scenic-railway-lines.md` 已列风景线、旅行平台资料丰富 | 小红书 / 马蜂窝 / 携程游记 + 官方与百科交叉核验 |
| **cold 冷门** | 普速支线、工矿线、东北地区非热门线、旅行平台资料稀少的线 | 人民铁道网 / 中国铁路 / 地方文旅局 / 地理志与名录 / Wikidata·OSM |

判定方法：先跑 hot 的三条关键词，若有效结果 <3 条 → 自动切 cold 路径。

### 3.2 检索优先级（强制顺序）

| 优先级 | 层级 | 典型来源 | 能否作唯一源 |
|---|---|---|---|
| 1 | **S** 权威名录 | 世界遗产、国家级自然保护区、全国重点文物保护单位、国家水利风景区、国家湿地公园、国家公园、央企/政府工程公告 | 与 A 组合 → `verified` |
| 2 | **A** 百科与开放数据 | Wikidata（Q 号+坐标）、维基百科、OSM（way/node）、省市文旅厅与铁路局官网 | 必须配独立二源 |
| 3 | **B** 官方媒体与行业 | 人民铁道网、中国铁路、新华社/人民日报、地方志、学术地理著作 | 需配 S/A |
| 4 | **C** 旅行 UGC | 小红书、马蜂窝、知乎、摄影机位帖 | ❌ **仅**佐证"值得看 / 哪一侧 / 几月"，不得作坐标与事实主源 |

### 3.3 可复用关键词模板（详见提示词文件 §3）

**通用可视性**
```
"{线路名}" 车窗 风景
"{线路名}" 靠窗 左边/右边 座位 推荐
"{站A}" "{站B}" 区间 风景
```

**热门（hot）**
```
site:xiaohongshu.com {线路名} 沿途 风景 打卡
site:mafengwo.cn {线路名} 铁路 风景 攻略
"{线路名}" 高铁 沿途 必看 段
```

**冷门（cold）**
```
site:peoplerail.com {线路名}
"{线路名}" 铁路 通车 报道 大桥 隧道 车站
"{沿线县名}" 文旅 资源 名录 景区
"{沿线地区}" 国家级自然保护区 / 全国重点文物保护单位 / 国家水利风景区
"{线路名}" 铁路 建设 工程 难点        ← 展线、冻土、防风、跨谷等 construct 类
```

**按地物类型**（构造类走官方）
```
"{桥名}" 铁路桥 主跨 长度 合龙
"{线路名}" 隧道 全长 贯通
"{线路名}" 展线 人字形 螺旋 爬坡
"{地区}" 光热电站 塔式 装机    "{地区}" 风电场 风机 规模
"{水库名}" 水利枢纽 总库容 国家水利风景区
"{线路名}" 冻土 热棒 旱桥      "{地区}" 防风明洞 百里风区
"{地区}" 长城 遗址 全国重点文物保护单位
"{名称}" 石窟 世界遗产         "{名称}" 故城 遗址 保护单位
```

**坐标核验（每条必走）**
```
"{景点名}" wikidata Q 编号 坐标
"{景点名}" openstreetmap way/node
```

---

## 4. 算法流程（六步）

```
① 线路遍历 → ② 候选点生成 → ③ 多源交叉验证 → ④ 去重与冲突消解
                                                    ↓
                                    ⑤ 可见性与真实性审核 → ⑥ 入库与回归
```

### ① 线路遍历（Traverse）

- **输入**：`data/presets/corridors/*.json`（248 条）+ `scenic-spots.json` 当前命中统计。
- **处理**：
  1. 跳过 `island: true` 的孤岛走廊（几何未接入主干，先补走廊）；
  2. 计算每条走廊当前景点数与里程；
  3. 排序优先级：
     - **P0**：62 条零景点走廊（14,186 km），按里程降序；
     - **P1**：157 条 <8 的走廊，按"缺口数 × 里程"降序（京九、京广、京沪、兰新优先）；
     - **P2**：已达标的 29 条，只做质量复查与季节性补充；
     - **P3**：18 个孤儿景点对应的走廊缺口（与 `scenic-v2-deferred-ingest.md` §2.1 合并排期）。
- **输出**：`tmp/scenic/queue.json`（`[{corridorId, name, tier, km, currentCount, target}]`）。
- **判定**：目标数 = `clamp(round(km/150), 8, 20)`，冷门线上限放宽到 6。

### ② 候选点生成（Generate）

- **输入**：单条走廊的 `{name, stationsHint, 折线摘要(起/中/终 + 高程带), 沿线省市, 本线已有景点 id}`。
- **处理**（三路并进）：
  1. **AI 检索生成**：用 `docs/prompts/scenic-spots-generate.md` 的主提示词 + 对应 tier 任务块；
  2. **地理叠加自动提名**（不依赖 AI，防漏）：把走廊折线做 35 km 缓冲，与下列公开名录/数据做空间连接——OSM `natural=peak/water/glacier/wood`、`historic=*`、`man_made=bridge/dam/windmill/solar`、`tourism=viewpoint`；Wikidata 半径查询；国家级自然保护地/文保/水利风景区名录；
  3. **站名启发**：以 `stationsHint` 各站为圆心检索当地"必看 / 地标 / 国家级"地物。
- **输出**：`tmp/scenic/{corridorId}.candidates.json`（可能 30~60 个，含来源）。
- **判定**：候选不带来源 → 当场丢弃；明显重复（与已有 id 同名/同义）→ 标记 `dup_candidate`。

### ③ 多源交叉验证（Cross-verify）

- **输入**：候选点 + 其 sources。
- **处理**：
  1. **事实核验**：名称、类别、地位是否在 S/A 源中存在；
  2. **坐标核验**：Wikidata Q 号坐标 / OSM node-way 坐标 / 官方坐标；与 AI 给坐标偏差 >2 km（具名点）或不在地貌范围内（大面积点）→ 以真值覆盖并记 `coord_adjusted`；
  3. **GCJ-02 检查**：来自国内图商的坐标必须转 WGS84；
  4. **同名错配守卫**：沿用现有脚本规则——真值位移 >80 km（粗坐标 >120 km）视为错配，拒绝采用。
- **输出**：`tmp/scenic/{corridorId}.verified.json`，每条附 `verificationStatus`（`verified` / `probable` / `unverified`）。
- **判定**：`unverified` → 不入主库，转 staging。

### ④ 去重与冲突消解（Dedupe）

- **输入**：本线通过验证的点 + 全库已有 414 条。
- **判据**（命中任一即合并/拒绝）：
  1. 同名或同义（`id` 归一化后相同）→ 合并，保留先入库者，把新线的 `lines[]` 追加进去；
  2. 距离 <500 m 且同类 → 合并（保留信息更全的一条）；
  3. 父子关系（"××景区" vs "××峰"）→ 保留更具体者，另一个 `status: deprecated`；
  4. 站景同名（"沱沱河站" vs "沱沱河（长江正源）"）→ 允许并存，但 `subtype` 必须不同、`intro` 必须区分；
  5. 跨线共享（如长江被多条线看到）→ **不合并**，各自在 `lines[]` 增加一条记录（里程不同）。
- **输出**：`tmp/scenic/{corridorId}.final.json` + `dup-log.json`。

### ⑤ 可见性与真实性审核（Audit）

- **输入**：去重后的点 + 走廊折线。
- **机器门禁**（脚本执行）：
  1. **距轨门禁**：`distKm ≤ maxDistKm ?? {on_track:3, window:8, distant:35}`；超限且确有价值 → 升 `distant` 并加大 `maxDistKm`（≤50），**禁止挪坐标**；
  2. **打点语义**：具名点不得落在车站 500 m 内（除非该站本身是历史建筑）；大面积点须落在地貌范围内；
  3. **里程与侧别回填**：脚本算 `alongKm*` / `distKm` / 运行时 `side`；
  4. **夜间与遮挡**：结合车次时刻（如能取到）标注 `blocked`，现阶段以"该线多数车次是否夜行"粗判；
  5. **来源完整性**：`sources` 必须有 ≥1 条 S/A + ≥1 条独立二源；`ref` 必须是 URL / Q 号 / OSM id 之一。
- **人工/AI 二审**：抽 20% 检查 intro 是否写清"哪一段 + 哪一侧 + 何时"，以及是否真的值得抬头看。
- **输出**：`tmp/scenic/{corridorId}.audit.json`（含 `pass` / `reject` / `staging` 三类）。

### ⑥ 入库（Ingest）

1. `pass` 的转成 `spot({...})` 写入 `scripts/build-scenic-spots-curated.mjs`（**唯一写入口**）；
2. `node scripts/build-scenic-spots-curated.mjs` 重生 `scenic-spots.json`（自动应用 327 条校准补丁）；
3. `node scripts/calibrate-scenic-spot-locations.mjs --write` 重算真值；
4. `node scripts/fix-scenic-off-rail.mjs --write` 修正离轨点；
5. `staging` 的写入 `data/presets/scenic-spots.staging.json`（`staging: true`，不参与 `loadScenicSpots()`），等待补源；
6. **回归**：重跑覆盖率统计（目标：零景点走廊 62 → ≤10，达标走廊 29 → ≥200），并抽查 3 个车次确认景点按里程顺序出现、左右侧与运行时一致。

---

## 5. 真实性保障

### 5.1 三条硬规则

1. **每条景点 ≥1 个 S/A 级源 + ≥1 个独立二次源**；两条源存在搬运关系视为一条。
2. **坐标必须来自 Wikidata / OSM / 官方**，误差：具名点 ≤2 km；大面积点在语义范围内。游记描述不得反推坐标。
3. **无法验证 → 删除或标记待确认，严禁编造**：`verification.status ∈ {verified, probable}` 才进主库；`unverified` 进 staging；`rejected` 写审查日志不入库。

### 5.2 提示词层的防编造约束（已写入提示词文件）

- 明确"禁止编造景点名/URL/Q 号/凭印象坐标"；
- 强制输出 `sources[].ref` 与 `confidenceNote`（你凭什么认为车上能看到）；
- 明确"宁可本线只出 5 条"；
- 给出正反示例（九寨沟剔除、华山北站 ≠ 华山）。

### 5.3 脚本层的机器门禁（建议新增）

| 脚本 | 检查 |
|---|---|
| `scripts/verify-scenic-sources.mjs` | `sources` 字段完整性；`ref` 格式（URL / `Q\d+` / `way|node/\d+`）；"网络"/"百度"等无效来源直接判失败；URL 可达性抽检（HEAD 请求，失败仅告警） |
| `scripts/verify-scenic-geometry.mjs` | 距轨门禁、打点语义（车站 500 m 内检查）、地貌包含性抽样 |
| `scripts/compute-spot-lines-and-sides.mjs` | 自动回填 `lines[]`（corridorId / alongKm / distKm / nearStations）与运行时 `side` |
| `scripts/scenic-coverage-report.mjs` | 走廊 × 景点覆盖矩阵，输出零景点与偏少走廊清单，作为每轮验收依据 |

`node scripts/verify-scenic-sources.mjs --strict` 出现任何无效来源即非零退出，可接入交付门禁。

### 5.4 人工抽检清单（每批必做）

1. 随机 10 条点开坐标：是否落在地物本体而非车站；
2. 随机 10 条点开 `sources[0].ref`：是否真实且内容匹配；
3. 打开 3 个经停该线的车次：景点是否按里程顺序出现、数量是否合理；
4. 检查本批是否同时有 near 与 far、是否覆盖本线标志景观。

---

## 6. 存量 414 条的批量审查修正流程

> 目标：把现有 414 条升级到 v3（补分类、线路、里程、左右侧、时段、来源），同时修掉坐标与可见性问题。
> 原则：**先机器批量，后 AI 补缺，最后人工抽样**；每阶段可单独回滚（每阶段一个 commit）。

### Stage A｜坐标与可见性复核（复用现有脚本，先做）

```bash
node scripts/calibrate-scenic-spot-locations.mjs --fetch --write   # 联网刷新 Wikidata 真值（388 条已有缓存，--write 可离线重算）
node scripts/fix-scenic-off-rail.mjs --write                        # 离轨 <0.8km 的侧向挪开
node scripts/build-scenic-spots-curated.mjs                         # 应用 327 条 patches 重生
```
- 输出：更新 `_scenic-wikidata-truths.json` 与 `scenic-spot-calibration-patches.json`。
- 验收：`node scripts/scenic-coverage-report.mjs` 与修正前对比，孤儿点数量不增加。

### Stage B｜线路归属与里程自动回填（新脚本，纯计算，零风险）

```bash
node scripts/compute-spot-lines-and-sides.mjs --write
```
- 对 414 条 × 248 走廊计算 `distKm` 与投影进度，凡 `distKm ≤ maxDistKm` 即写入 `lines[]`；
- 对无走廊命中的 18 个孤儿点，输出 `orphans.json`（与 `scenic-v2-deferred-ingest.md` 合并排期，随走廊补齐后解冻）；
- `nearStations` 从最近走廊的 `stationsHint` 按投影位置取最近两个。
- 验收：每条景点至少 1 条 `lines`；孤儿点清单条数 ≤18 且原因明确。

### Stage C｜六维分类回填（AI 批量 + 人工复核）

1. 导出待分类表：`node scripts/scenic-audit-classify.mjs --export` → `tmp/scenic/classify-todo.csv`（189 条 `other` 优先，其次全量）；
2. 用提示词文件的**分类专用模式**（同一主提示词，任务块改为"只输出 id / dimensions / subtype / tags，不改动坐标与其他字段"）批量回填；
3. 回写 `build-scenic-spots-curated.mjs`，重生 JSON；
4. 人工复核 20%：`other` 归零、分类与 intro 语义一致。
- 验收：`other` 计数 → 0；六维均有分布；每维 ≥5 条（否则说明该维度词表不适配，需补 subtype）。

### Stage D｜左右侧与最佳时段（脚本算侧别 + AI 补时段）

1. 侧别由 Stage B 脚本一并算出（运行时叉积，基于 `lines[0]` 折线正方向），AI 给的侧别仅作交叉校验，不一致进日志；
2. 时段用 AI 批量补：任务块为"只输出 id / bestView / nightOnly 是否保留"；
3. 夜间判定：结合线路常见车次时刻粗判，标 `blocked: ["night_pass"]`（青藏线等已有 3 条 `nightOnly` 直接映射 `timeOfDay: night`）。
- 验收：`side` 填充率 100%（允许 `unknown` ≤10%）；`bestView` 填充率 100%。

### Stage E｜来源补全与真实性定级（最耗时，分批做）

1. 先把 388 条 Wikidata 真值挂上（脚本自动匹配 `spotId` → `sources` 追加 `{type:'wiki', level:'A', ref:'Qxxxx'}`），这一步零人工；
2. 剩余按"知名度 + 所属线路优先级"分批，每批 50 条，用提示词文件的**补源模式**检索 S/A 级来源；
3. **补不上的处理**（严格执行）：
   - 若该点属"公开资料常提的标志景观"（如知名大桥/雪山/湖泊）→ 标 `verification.status: 'unverified'` 移入 `scenic-spots.staging.json`，**主库移除**，等人工补源；
   - 若属可有可无的点 → 直接删除；
   - 删除/移出的 id 记入 `deprecated-ids.json`，避免后续重复生成。
- 验收：`node scripts/verify-scenic-sources.mjs --strict` 零失败；主库 100% 带 ≥1 条 S/A 源。

### Stage F｜补齐空白与偏少线路（新增景点，回到 §4 主流程）

按 §4 的队列顺序执行：P0 零景点 62 条 → P1 偏少 157 条 → P2 复查 29 条。
- 每批 5~8 条线，跑完整六步流程；
- 验收（每批）：该批走廊景点数 ≥8；覆盖率报告更新；随机 3 车次回归。

### Stage G｜孤儿点解冻（依赖走廊补齐）

与 `docs/scenic-v2-deferred-ingest.md` §2.1 的走廊缺口（奎北、北疆、京哈陶赖昭、胶州湾、潍烟、汉十丹江口、内昆、成雅、襄渝紫阳、京张崇礼）合并排期：
**补一条走廊 → 解冻对应孤儿点 → 走 §4 ⑤ 审核 → 入库。**

### 排期建议

| 阶段 | 内容 | 人力 |
|---|---|---|
| A+B | 坐标复核 + 线路/里程/侧别自动回填 | 0.5 天（脚本） |
| C | 分类回填 | 1 天（AI）+ 0.5 天（人工） |
| D | 时段补全 | 0.5 天 |
| E | 来源补全与定级（分批） | 2~3 天 |
| F | 62 条空白 + 157 条偏少补点 | 持续，每批 1~2 天 |
| G | 孤儿点随走廊解冻 | 随走廊进度 |

---

## 7. 交付物索引

| 交付物 | 路径 | 用途 |
|---|---|---|
| 数据结构 v3 字段定义 | `docs/scenic-schema-v3.md` | 入库格式、六维词表、来源分级、运行时侧别算法 |
| AI 生成提示词（可直接使用） | `docs/prompts/scenic-spots-generate.md` | 主提示词 + 冷/热门任务块 + 关键词模板 + few-shot |
| 全流程方案（本文） | `docs/scenic-ai-generation-plan.md` | 分类体系、约束、检索、算法六步、真实性、存量审查 |
| 建议新增脚本 | `compute-spot-lines-and-sides.mjs`、`verify-scenic-sources.mjs`、`scenic-audit-classify.mjs`、`scenic-coverage-report.mjs` | 机器门禁与自动回填 |
| 现有暂缓清单 | `docs/scenic-v2-deferred-ingest.md` | 20 条待走廊/待核真，与 Stage G 对接 |
