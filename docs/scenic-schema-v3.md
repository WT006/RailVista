# 铁路沿线景点数据结构 v3（字段定义）

> 版本：v3 ｜ 日期：2026-09-26
> 兼容：v3 是 v2（`docs/scenic-spots-spec.md` §3.2）的**纯扩展**——v2 全部字段保留且语义不变，v2 老数据可直接被 v3 读取器消费。
> 落盘：`data/presets/scenic-spots.json`（主库，唯一真源）；策展源 `scripts/build-scenic-spots-curated.mjs`；暂存区 `data/presets/scenic-spots.staging.json`（未过审，不参与展示）。

---

## 0. 为什么需要 v3

当前库 414 条实测分布：

| 用户要求 | v2 现状 | 差距 |
|---|---|---|
| 六维分类 | `category` 只有 7 个粗值，**`other` 占 189 条（45.6%）** | 无分类体系 |
| 所属线路 | **无字段** | 完全缺失 |
| 里程区间 | **无字段** | 完全缺失 |
| 左侧/右侧 | 有 `side` 枚举，**0 条填充** | 全空 |
| 最佳观赏时段 | 只有 `nightOnly`（3 条） | 几乎全空 |
| 可核验来源 | `source` 仅为 `"curated"`/`"preset"` 字符串，**无 URL / 无外部 ID** | 不可核验 |

v3 补齐上述全部，并向下兼容。

---

## 1. 顶层文件结构

```json
{
  "version": 3,
  "updated": "2026-09-26",
  "note": "v3：六维分类 + 线路归属 + 左右侧 + 时段 + 可核验来源；v2 字段语义不变",
  "spots": [ /* ScenicSpotV3[] */ ],
  "staging": false
}
```

`data/presets/scenic-spots.staging.json` 结构相同，但 `staging: true`，**不参与 `loadScenicSpots()`**。

---

## 2. 字段总表

### 2.1 标识与几何（v2 保留，必填）

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `id` | ✅ | string | 全局唯一英文短横线，如 `qinghai-lake`。禁止纯数字 |
| `name` | ✅ | string | 展示名。大面积景可带限定语，如 `察尔汗盐湖（万丈盐桥）` |
| `lng` | ✅ | number | WGS84 经度（**与走廊/站点同体系，禁止 GCJ-02 直写**） |
| `lat` | ✅ | number | WGS84 纬度 |
| `intro` | ✅ | string | 40~90 字。必须写清「车上看什么 + 在哪一段 + 何种视角」，见 §5 模板 |

### 2.2 可见性（v2 保留 + v3 扩展）

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `visibility` | ✅ | enum | `on_track`（列车从其上/其内穿过，默认 3 km）／`window`（车窗可见，默认 8 km）／`distant`（远眺，默认 35 km）。**语义与 v2 完全一致** |
| `maxDistKm` | ⬜ | number | 覆盖默认阈值；只调它，**不挪坐标** |
| `viewScale` | ⬜ | enum | `near`（车窗近景，<2 km）／`mid`（中景 2~15 km）／`far`（远景 >15 km）。与 `visibility` 正交：近景/远景都要覆盖 |
| `viewMinutes` | ⬜ | number | 可持续观赏时长（分钟），用于排序"值得抬头"的优先级。长隧/短桥应显著小 |

### 2.3 分类体系（v3 新增，核心）

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `dimensions` | ✅ | string[] | **六维主维度**，1~2 个，取值见 §3：`geo` / `nature` / `culture` / `history` / `construct` / `architecture` |
| `category` | ✅ | string | v2 保留枚举（后端排序/图标仍用），由 `subtype` 自动映射，见 §3.5 |
| `subtype` | ✅ | string | 细类型，受控词表，见 §3（如 `snow_mountain`、`solar_thermal`） |
| `tags` | ⬜ | string[] | 自由补充标签（`油菜花`、`藏羚羊`、`世界遗产`、`夜景`、`季节性`…），用于检索与筛选 |

### 2.4 线路归属与里程（v3 新增）

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `lines` | ✅ | object[] | 所属线路数组（一条景可属多线）。单元素结构见下表 |

`lines[i]`：

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `corridorId` | ✅ | string | 对应 `data/presets/corridors/*.json` 的 `id`（如 `qingzang`）；无走廊时用 `"z8991-railway"` 等预置资产 id |
| `alongKmFrom` | ✅ | number | 沿该走廊折线**从数组首点起算**的累计公里（投影进度 × 走廊总长），保留 1 位小数 |
| `alongKmTo` | ⬜ | number | 段状景观（如峡谷段、展线）的结束里程；点状景观省略 |
| `nearStations` | ⬜ | string[] | 最近的两个经停站名（去"站"字），如 `["格尔木","不冻泉"]`。用于人工核对与 UI 提示"约在 A—B 之间" |
| `distKm` | ✅ | number | 景点到该走廊折线的垂直距离（km），1 位小数 |

> `lines` 由脚本 `compute-spot-lines-and-sides.mjs` 自动计算回填，**AI 只需给候选，不手填里程**。

### 2.5 观赏方位与时段（v3 新增）

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `side` | ✅ | enum | `left` / `right` / `both` / `unknown`。**定义：以 `lines[0].corridorId` 折线数组正方向为前进方向时的左右** |
| `sideRefDirection` | ✅ | enum | 固定 `"line_forward"`（即上一条的方向约定）。运行时见 §4 |
| `bestView` | ✅ | object | 见下表 |

`bestView`：

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `months` | ⬜ | number[] | 推荐月份 1~12；空数组 = 全年 |
| `timeOfDay` | ✅ | enum | `day` / `dawn` / `dusk` / `night` / `any` |
| `light` | ⬜ | enum | `front`（顺光）/ `back`（逆光剪影亦佳）/ `any` |
| `note` | ⬜ | string | 一句提示，如「7 月油菜花期最佳」「冬季日落早，17:30 后仅剩剪影」 |
| `blocked` | ⬜ | string[] | 影响观看的因素：`night_pass`（该段常为夜间通过）/ `tunnel`（进出长隧）/ `sound_barrier`（声屏障）/ `urban`（城市连片建筑遮挡） |

> `nightOnly`（v2）保留，等价 `bestView.timeOfDay === 'night'`；v3 新数据请改用 `bestView`。

### 2.6 真实性来源（v3 新增，硬门槛）

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `sources` | ✅ | object[] | **至少 1 条 S/A 级源 + 1 条独立二次源**（见 §6）。单元素结构见下表 |
| `verification` | ✅ | object | `{ status, checkedAt, checkedBy, method }` |

`sources[i]`：

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `type` | ✅ | enum | `authority`（官方名录/政府/央企）／`wiki`（维基百科/Wikidata）／`osm`（OpenStreetMap）／`news`（官方媒体报道）／`academic`（志书/论文/地理著作）／`ugc`（小红书/马蜂窝等游记，**只可作第三源**） |
| `level` | ✅ | enum | `S`（权威名录：世界遗产、国家级自然保护区、全国重点文保、国家水利风景区…）／`A`（百科/OSM/官方站点）／`B`（官方媒体/铁路官方报道）／`C`（旅行 UGC） |
| `ref` | ✅ | string | 可核验标识：Wikidata 用 `Q201294`；OSM 用 `way/123456`；其余用**完整 URL** |
| `quote` | ⬜ | string | 原文摘录 ≤60 字（用于人工复核，尤其可见性描述） |
| `checkedAt` | ✅ | string | `YYYY-MM-DD` |

`verification.status`：

| 值 | 含义 | 是否进主库 |
|---|---|---|
| `verified` | ≥2 独立源，坐标有 Wikidata/OSM/官方真值，可见性有明确依据 | ✅ |
| `probable` | 1 个 S/A 源 + 1 个 B/C 源，坐标可信，可见性由地理推理得出 | ✅（UI 不打角标） |
| `unverified` | 源不足或坐标不可核 | ❌ **进 staging，不进主库** |
| `rejected` | 已判定不可见/不存在/编造 | ❌ 不入库，写入审查日志 |

### 2.7 生命周期（v3 新增）

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `source` | ✅ | string | v2 保留：`preset`（Z8991 迁移）/ `curated`（策展）/ `ai_generated`（v3 AI 生成）/ `ai_reviewed`（AI 审查修正后） |
| `reviewedAt` | ⬜ | string | 最近一次人工/AI 审查日期 |
| `reviewRound` | ⬜ | string | 审查批次号，如 `2026-09-v3-batch1` |
| `status` | ⬜ | enum | `active`（默认）／`deprecated`（保留 id 但不再展示，待合并） |

---

## 3. 六维分类体系（受控词表）

### 3.1 `geo` 大地理（地貌与空间格局）

| subtype | 中文 | 典型 | 远景/近景 |
|---|---|---|---|
| `snow_mountain` | 雪山冰川 | 格拉丹东、玉龙雪山、博格达 | 多 far |
| `mountain_range` | 山脉山岳 | 秦岭、太行山、横断山 | far/mid |
| `gorge` | 峡谷河谷 | 虎跳峡、大渡河峡谷、怒江峡谷 | near/mid |
| `river` | 江河 | 黄河、长江、汉江、松花江 | near |
| `lake` | 湖泊盐湖 | 青海湖、措那湖、洞庭湖 | near/mid |
| `plain_basin` | 平原盆地 | 华北平原、柴达木盆地、成都平原 | far |
| `grassland` | 草原草甸 | 呼伦贝尔、那曲高寒草原 | mid/far |
| `desert_gobi` | 沙漠戈壁 | 塔克拉玛干、柴达木戈壁、巴丹吉林 | far |
| `coast_island` | 海岸海岛 | 胶州湾、海南东环海岸、渤海湾 | near |
| `wetland` | 湿地沼泽 | 扎龙、若尔盖、黄河三角洲 | mid |
| `karst_danxia` | 喀斯特丹霞 | 桂林峰林、张掖丹霞、云南石林 | mid/far |
| `forest` | 森林林海 | 大兴安岭、长白山、西双版纳 | mid |
| `volcano_geothermal` | 火山地热 | 腾冲、五大连池、羊八井 | far |
| `terrace_farmland` | 梯田农田花海 | 哈尼梯田、油菜花海、稻田画 | near/mid |

### 3.2 `nature` 大自然（生态、季相、天象）

| subtype | 说明 |
|---|---|
| `seasonal_foliage` | 季相植被（油菜花 7 月、胡杨 10 月、红叶、杜鹃、薰衣草） |
| `wildlife` | 野生动物栖息地（藏羚羊、丹顶鹤、普氏原羚、野象谷） |
| `sky_light` | 天象光照（日出日落、云海、雾凇、星空、银河、佛光） |
| `water_feature` | 瀑布温泉泉群 |

### 3.3 `culture` 大人文（活态人文）

| subtype | 说明 |
|---|---|
| `ethnic_village` | 民族村寨（侗寨、苗寨、藏寨、傣寨） |
| `temple_religion` | 寺庙宗教（布达拉宫、塔尔寺、普陀山、麦加…国内为主） |
| `old_town` | 古镇古城（平遥、丽江、凤凰、阆中） |
| `folk_custom` | 民俗节庆（那达慕、泼水节、晒佛节） |
| `pastoral_life` | 牧区/渔村生活场景 |
| `tea_terrace` | 茶园果园（蒙顶山、普洱茶山、葡萄沟） |

### 3.4 `history` 大历史（历史遗存）

| subtype | 说明 |
|---|---|
| `great_wall` | 长城关隘（八达岭、嘉峪关、山丹汉明长城、镇北台） |
| `ancient_road` | 古道驿路（丝绸之路、茶马古道、秦直道） |
| `grotto_mural` | 石窟壁画（莫高窟、云冈、龙门、麦积山） |
| `ruins_site` | 古城遗址（交河故城、高昌故城、楼兰、统万城） |
| `revolutionary` | 革命纪念地（井冈山、延安宝塔山、遵义） |
| `industrial_heritage` | 工业遗产（中东铁路老桥、个旧锡矿、抚顺煤矿） |
| `railway_heritage` | 铁路遗产（百年老站、蒸汽机车、窄轨遗迹、滇越铁路人字桥） |
| `battlefield` | 古战场遗址 |

### 3.5 `construct` 大国建造（工程与设施）

| subtype | 说明 | 典型 |
|---|---|---|
| `bridge` | 跨江跨海跨谷大桥（**含历史名桥**） | 武汉长江大桥、南京长江大桥、钱塘江大桥、北盘江大桥、平潭海峡公铁大桥、鸭子池大桥 |
| `tunnel` | 长隧/隧道群/防风明洞 | 乌鞘岭、秦岭终南山、新关角、百里风区明洞 |
| `spiral_loop` | 展线/人字形/螺旋展线 | 京张青龙桥人字形、成昆螺旋展线、宝成秦岭展线 |
| `viaduct` | 高墩高架/长大桥群 | 贵南高架群、沪杭甬高架 |
| `solar_thermal` | 光热/光伏电站 | 敦煌首航光热、格尔木光伏、青海塔式光热 |
| `wind_farm` | 风电场 | 达坂城、张北、沿海滩涂风电场 |
| `water_conservancy` | 水利工程（水库/枢纽/灌区/调水） | 三峡、丹江口、小浪底、都江堰、坎儿井、红旗渠、南水北调穿黄 |
| `hydropower` | 水电站 | 白鹤滩、乌东德、龙羊峡、刘家峡 |
| `port_hub` | 港口枢纽/铁水联运 | 宁波舟山港、青岛港、北部湾港 |
| `power_grid` | 特高压/输电走廊 | 西电东送走廊、换流站 |
| `permafrost_eng` | 冻土/特殊路基工程 | 青藏冻土路基、热棒、旱桥 |
| `station_building` | 车站建筑（作为建筑/工程观看） | 老站楼、特大枢纽站场 |

### 3.6 `architecture` 大国建筑（建筑与地标）

| subtype | 说明 |
|---|---|
| `historic_building` | 历史建筑（应县木塔、布达拉宫、悬空寺、岳阳楼、黄鹤楼） |
| `modern_landmark` | 现代地标（东方明珠、广州塔、中国尊、天津之眼、深圳平安） |
| `city_skyline` | 城市天际线（列车进站/穿城时可见） |
| `stadium_venue` | 大型场馆（鸟巢、水立方、大运中心） |
| `campus_scientific` | 科教/科研设施（FAST 天眼、酒泉卫星发射中心远眺） |

### 3.7 `subtype → category` 映射（保证 v2 兼容）

| category（v2） | 归入的 subtype |
|---|---|
| `mountain` | `snow_mountain` `mountain_range` `karst_danxia` `volcano_geothermal` |
| `lake` | `lake` `wetland` |
| `gorge` | `gorge` `river` `water_feature` |
| `grassland` | `grassland` `plain_basin` `terrace_farmland` `seasonal_foliage` |
| `desert` | `desert_gobi` |
| `engineering` | `bridge` `tunnel` `spiral_loop` `viaduct` `solar_thermal` `wind_farm` `water_conservancy` `hydropower` `port_hub` `power_grid` `permafrost_eng` |
| `other` | `old_town` `temple_religion` `ethnic_village` `great_wall` `grotto_mural` `ruins_site` `historic_building` `modern_landmark` `city_skyline` `coast_island` `forest` `wildlife` `sky_light` … |

> 迁移后 `other` 应从 189 条降到 **0**（六维体系必须能覆盖全部；实在不落地的走 `culture/other_folk` 并补 tag）。

---

## 4. `side` 的运行时解析（重要）

库内 `side` 是**静态参考值**（相对走廊折线正方向）。但同一条线上行/下行左右相反，因此**运行时必须重算**：

```
resolveSpotSide(spot, railway /* 当前行程折线，方向 = 起点→终点 */):
  proj  = projectToRailway(railway, spot)          // 得到投影点与切向量 d
  v     = spot - proj                               // 景点相对轨道的偏移向量
  cross = d.lng * v.lat - d.lat * v.lng             // 平面叉积（近似，纬度不需 cos 修正即可判符号）
  return cross > 0 ? 'left' : 'right'               // 阈值带 ±0.15 km 死区 → 'both'
```

- 死区（|垂距| < 0.15 km 或投影点处折线近直角）→ `both`。
- `on_track` 景点（列车从其上方通过）→ 固定 `both`。
- 库内静态 `side` 与运行时算出的不一致 → 记入审查日志（可能是走廊方向反转或 AI 判错）。

实现位置建议：`packages/shared/src/schedule/scenic.ts` 增加 `resolveSpotSide()`，在 `filterSpotsAlongRailway` 内为每条命中景点写入运行时 `side`（覆盖库内值），保持 `ScenicSpotView` 字段不变。

---

## 5. `intro` 写作模板（强制）

```
[地物是什么] + [车在哪一段看] + [以什么视角/左右侧] + [何时最好]
```

示例：

- ✅ `中国最大内陆咸水湖，青藏铁路沿湖北岸穿行约 40 分钟，湖面在列车右侧铺开，7—8 月油菜花期与雪山同框最佳。`
- ✅ `京张铁路青龙桥段"人"字形展线，列车在此折返爬坡，左侧车窗可见百年老站与詹天佑铜像，全天可看，秋色最佳。`
- ❌ `风景优美，值得一去。`（无可见性信息）
- ❌ `距火车站 30 公里，需转乘汽车。`（不可见 → 不入库）

---

## 6. 来源分级与最低要求

| 级别 | 典型来源 | 用途 |
|---|---|---|
| **S** | 世界遗产名录、国家级自然保护区、全国重点文物保护单位、国家水利风景区、国家湿地公园、中国国家地理榜单、国家公园名录、央企/政府工程公告 | 事实与地位的主源 |
| **A** | Wikidata（含 Q 号）、维基百科、OSM（way/node 号）、省市文旅厅官网、铁路局/国铁集团官网 | 坐标与事实 |
| **B** | 人民铁道网、中国铁路、新华社/人民日报报道、地方志书、学术地理著作 | 工程事实、通车报道 |
| **C** | 小红书/马蜂窝/知乎游记、摄影机位帖 | **仅作"是否值得看、何时看、哪一侧"的佐证，不得作为坐标与事实主源** |

**入库门槛（硬）**：`sources` 中必须 ≥1 条 `level ∈ {S, A}`（提供事实/坐标）**且** ≥1 条与之**独立**的第二源。两条源指向同一文本（如搬运关系）视为一条。

---

## 7. 完整示例（v3）

```json
{
  "id": "qinghai-lake",
  "name": "青海湖",
  "lng": 100.05,
  "lat": 37.18,
  "intro": "中国最大内陆咸水湖，青藏铁路沿湖北岸穿行约 40 分钟，湖面在列车右侧铺开，7—8 月湖畔油菜花期与雪山同框最佳。",
  "visibility": "window",
  "maxDistKm": 15,
  "viewScale": "mid",
  "viewMinutes": 40,
  "dimensions": ["geo", "nature"],
  "category": "lake",
  "subtype": "lake",
  "tags": ["高原湖泊", "国家级自然保护区", "季节性油菜花"],
  "lines": [
    {
      "corridorId": "qingzang",
      "alongKmFrom": 138.4,
      "alongKmTo": 178.9,
      "nearStations": ["湟源", "海晏"],
      "distKm": 2.4
    }
  ],
  "side": "right",
  "sideRefDirection": "line_forward",
  "bestView": {
    "months": [6, 7, 8, 9],
    "timeOfDay": "day",
    "light": "any",
    "note": "7—8 月油菜花期；夜间通过该段只能听讲解",
    "blocked": ["night_pass"]
  },
  "sources": [
    { "type": "authority", "level": "S", "ref": "https://www.mee.gov.cn/...", "quote": "青海湖国家级自然保护区", "checkedAt": "2026-09-26" },
    { "type": "wiki", "level": "A", "ref": "Q201294", "checkedAt": "2026-09-26" },
    { "type": "ugc", "level": "C", "ref": "https://www.xiaohongshu.com/...", "quote": "右侧靠窗可见湖面", "checkedAt": "2026-09-26" }
  ],
  "verification": { "status": "verified", "checkedAt": "2026-09-26", "checkedBy": "ai+batch1", "method": "wikidata+osm+ugc-cross" },
  "source": "ai_reviewed",
  "reviewedAt": "2026-09-26",
  "reviewRound": "2026-09-v3-batch1"
}
```
