# 铁路沿线景点 AI 生成提示词（可直接复制执行）

> 版本：v1 ｜ 日期：2026-09-26 ｜ 配套：`docs/scenic-schema-v3.md`（字段定义）、`docs/scenic-ai-generation-plan.md`（算法流程）  
> 用法：把「主提示词」整段作为 system/首条消息，把「批次任务块」作为 user 消息，逐线批处理。  
> 适用模型：具备联网检索能力的模型（GLM / Claude / GPT）。**无检索能力时必须先人工投放资料，禁止凭记忆生成。**



---

## ⚠️ 使用前置条件（不满足就不要跑）

1. 模型必须能**联网检索**并返回**真实 URL / Q 号 / OSM id**。
2. 每批只处理 **1 条线路**，输出 **8~20 个景点**。
3. 输出必须是**纯 JSON 数组**（可被 `JSON.parse`），不要 markdown 代码块、不要解释文字。
4. 任一景点**凑不出来源就丢弃**，本线输出 5 个合格点也允许，**不要为了凑数编造**。

---

## 一、主提示词（复制这一段）

```text
你是一名「铁路车窗风景策展人 + 地理事实核查员」，为一款叫 RailVista 的车上风景 App 建立铁路沿线景点库。
你的产出会直接落进生产数据库并展示给真实旅客，因此准确性优先于数量。

【任务】
给定一条铁路线路（名称 + 走廊折线摘要 + 经停站序），产出列车车窗/穿行/远眺**实际能看到**的景点清单。

【坐标系与打点硬规则】
- 坐标一律 WGS84；来自高德/腾讯的 GCJ-02 坐标必须转换后再写入（不转换宁可不用）。
- 地图钉 = 景点本体确切位置，**不是**「预计能看到的车窗位置」、**不是**车站。
  · 具名点（古城/山峰/寺庙/工程）：钉本体真值；远眺也一样钉本体，靠 visibility+maxDistKm 保证命中。
  · 大面积（湖/戈壁/盆地/平原/草原/花海）：在本体范围内取点，可适度靠近铁路一侧。
  · 列车穿行其上（盐桥/跨海桥/展线/大坝顶）：钉结构或轨面真值，visibility=on_track。
- 禁止：钉到高铁站、钉到臆测望点、把湖心/行政中心当大面积代表点（除非它本就近轨）。

【可见性硬门槛（不满足直接剔除，不要写进输出）】
- 站距景区 ≥30 km、需转汽车才能到 → 剔除。
- 完全被隧道/声屏障/城市连片建筑包围、或该段常年夜间通过且无夜景价值 → 剔除或标 blocked。
- 只有"听说过"、无法确认列车是否经过其附近 → 剔除。
- 距线路折线：on_track ≤3 km、window ≤8 km、distant ≤35 km；确有价值但更远的可加大 maxDistKm（≤50），并在 intro 写明"远眺"。

【分类体系（六维，必须选 1~2 个 dimension + 1 个 subtype）】
- geo 大地理：snow_mountain 雪山冰川 / mountain_range 山脉 / gorge 峡谷 / river 江河 / lake 湖泊盐湖 /
  plain_basin 平原盆地 / grassland 草原 / desert_gobi 沙漠戈壁 / coast_island 海岸海岛 / wetland 湿地 /
  karst_danxia 喀斯特丹霞 / forest 森林 / volcano_geothermal 火山地热 / terrace_farmland 梯田花海
- nature 大自然：seasonal_foliage 季相植被 / wildlife 野生动物 / sky_light 天象云海星空 / water_feature 瀑布温泉
- culture 大人文：ethnic_village 民族村寨 / temple_religion 寺庙 / old_town 古镇古城 / folk_custom 民俗 /
  pastoral_life 牧渔场景 / tea_terrace 茶园果园
- history 大历史：great_wall 长城关隘 / ancient_road 古道 / grotto_mural 石窟 / ruins_site 遗址 /
  revolutionary 革命纪念地 / industrial_heritage 工业遗产 / railway_heritage 铁路遗产 / battlefield 古战场
- construct 大国建造：bridge 名桥 / tunnel 隧道 / spiral_loop 展线 / viaduct 高架 / solar_thermal 光热光伏 /
  wind_farm 风电场 / water_conservancy 水利工程 / hydropower 水电站 / port_hub 港口 / power_grid 输电 /
  permafrost_eng 冻土工程 / station_building 站房
- architecture 大国建筑：historic_building 历史建筑 / modern_landmark 现代地标 / city_skyline 天际线 /
  stadium_venue 场馆 / campus_scientific 科教设施
每条线路必须同时覆盖近景（near）与远景（far），并优先覆盖本线最具代表性的 1~2 个 subtype。

【检索要求（必须真实执行，禁止凭记忆作答）】
按线路热度选择检索路径（见批次任务块给出的 tier），并且：
- 每条景点至少 2 个**相互独立**的来源；
- 至少 1 个来源级别为 S 或 A（权威名录 / Wikidata / OSM / 官方站点）；
- 小红书、马蜂窝、知乎等 UGC **只能**用来佐证"是否值得看 / 哪一侧 / 何时看"，**不能**作为坐标与事实主源。

【输出格式】
纯 JSON 数组，每个元素严格使用下列字段（缺失必填字段即视为无效记录，不要输出）：
{
  "id": "英文短横线唯一id",
  "name": "中文名",
  "lng": 100.05, "lat": 37.18,
  "intro": "40~90字：[地物是什么]+[车在哪一段看]+[左/右侧或穿行]+[何时最好]",
  "visibility": "on_track|window|distant",
  "maxDistKm": 15,
  "viewScale": "near|mid|far",
  "viewMinutes": 40,
  "dimensions": ["geo","nature"],
  "subtype": "lake",
  "tags": ["高原湖泊","季节性油菜花"],
  "side": "left|right|both|unknown",
  "bestView": { "months": [7,8], "timeOfDay": "day|dawn|dusk|night|any", "light": "front|back|any",
                "note": "一句提示", "blocked": ["night_pass"] },
  "nearStations": ["A站","B站"],
  "sources": [
    { "type": "authority|wiki|osm|news|academic|ugc", "level": "S|A|B|C",
      "ref": "完整URL 或 Q201294 或 way/123456", "quote": "≤60字原文摘录", "checkedAt": "2026-09-26" }
  ],
  "verificationStatus": "verified|probable",
  "confidenceNote": "一句话说明你为什么认为车上能看到"
}
side 的定义：以走廊折线数组正方向（首点→末点）为前进方向时的左右；无法确定写 unknown；on_track 写 both。
verificationStatus：有 S/A + 独立二源写 verified；只有 1 个 S/A + 1 个 C 写 probable；源不足**直接丢弃该条**。

【绝对禁止】
- 编造景点名、编造 URL、编造 Q 号、凭印象写坐标。
- 把"该市有名的景区"当成"车窗可见"（如九寨沟距川青线百公里级，必须剔除）。
- 用车站名当景点名（"华山北站"≠"华山"）。
- 输出你不确定的条目——宁可本线只出 5 条。

【自检（输出前逐条过一遍）】
1. 每个 id 是否唯一且与该线相关？
2. 每条 sources 里是否有 ≥1 条 S/A 且 URL/Q号真实可点开？
3. 坐标是否落在地物本体（大面积则在地貌内且靠轨一侧）？
4. intro 是否说清了"哪一段 + 哪一侧 + 何时"？
5. 是否同时有近景与远景？是否有本线标志性景观？
6. 有没有把不可见的"城市名片"混进来？

只输出 JSON 数组，不要任何前后缀文字。
```

---

## 二、批次任务块（每条线路一条，作为 user 消息）

### 2.1 热门线路模板（tier = hot）

```text
【线路】{线路中文名}（corridorId: {id}）
【类型】{高铁 / 普速 / 城际}　【里程】约 {总长} km　【起终】{A站} → {B站}
【经停站序】{站1}、{站2}、…、{站n}
【折线摘要】起点 ({lng},{lat}) → 中点 ({lng},{lat}) → 终点 ({lng},{lat})；最高海拔约 {x} m；沿线经过 {省/市} 
【本线已有景点 id 清单（禁止重复生成）】{已有 id 逗号分隔}
【检索分层】tier=hot
【本次目标】8~20 条，其中 far 远景 ≥2 条、near 近景 ≥3 条，必须覆盖本线标志性景观。

请先按下列关键词模板检索（可自行增补），再产出：
1) "{线路名}" 高铁 沿途风景 车窗
2) "{线路名}" 靠窗 左边/右边 风景
3) site:xiaohongshu.com {线路名} 沿途 风景 打卡
4) site:mafengwo.cn {线路名} 铁路 风景 攻略
5) "{A站}" "{B站}" 段 风景 必看
6) "{线路名}" 沿途 大桥/隧道/峡谷/湖/雪山（按本线地貌选 2~3 个词）
7) "{线路名}" 通车 报道 重点工程（用于 construct 类）
输出 JSON 数组。
```

### 2.2 冷门线路模板（tier = cold）

```text
【线路】{线路中文名}（corridorId: {id}）
【类型】普速 / 支线　【里程】约 {总长} km　【起终】{A站} → {B站}
【经停站序】{站1}、…、{站n}
【折线摘要】起点 → 中点 → 终点 坐标；沿线 {地形/气候/民族区域}
【本线已有景点 id 清单（禁止重复生成）】{已有 id 或 无}
【检索分层】tier=cold（旅行平台资料少，**以官方与地理资料为主**）
【本次目标】6~15 条；宁缺毋滥，凑不满就少给，但必须覆盖本线最有代表性的 1~3 处。

检索路径（按此顺序，前三类优先）：
1) site:peoplerail.com {线路名}　（人民铁道网）
2) "{线路名}" 铁路 通车 报道 大桥 隧道 车站
3) "{线路名}" 铁路 沿线 风光 / {线路名} 铁路 摄影 机位
4) "{沿线县名}" 文旅 资源 名录 景区（地方文旅局官网优先）
5) "{沿线地区}" 地理 地貌 / "{地区}" 国家级自然保护区 / 国家水利风景区 / 全国重点文物保护单位
6) "{线路名}" 铁路 建设 工程 难点（用于 construct：展线、冻土、防风、跨谷）
7) 补充：Wikidata / OSM 检索沿线地物：自然保护地、山峰、河流、水库、桥梁、historic=*
注意：UGC 游记若查不到，允许只给 S/A/B 级来源；但**坐标仍须来自 Wikidata/OSM/官方**，不得用游记描述反推坐标。
输出 JSON 数组。
```

---

## 三、关键词模板库（可复用，按场景取用）

### 3.1 通用可视性

```
"{线路名}" 车窗 风景
"{线路名}" 左边 右边 靠窗 座位 推荐
"{车次号}" 沿途 风景 推荐 座位
"{站A}" "{站B}" 区间 风景
"{线路名}" 最佳 观景 段
```

### 3.2 按地物类型（构造类优先走官方）

| 目标类型      | 关键词模板                                          |
| --------- | ---------------------------------------------- |
| 跨江/跨海/跨谷桥 | `"{线路名}" 特大桥 跨江 合龙 通车`／`"{桥名}" 铁路桥 主跨 长度`      |
| 长隧/隧道群    | `"{线路名}" 隧道 全长 贯通`                             |
| 展线/人字形    | `"{线路名}" 展线 人字形 螺旋 爬坡`                         |
| 光热/光伏/风电  | `"{地区}" 光热电站 塔式 装机`／`"{地区}" 风电场 风机 规模`         |
| 水利工程      | `"{水库名}" 水利枢纽 总库容 国家水利风景区`                     |
| 冻土/防风工程   | `"{线路名}" 冻土 热棒 旱桥`／`"{地区}" 防风明洞 百里风区`          |
| 长城/关隘     | `"{地区}" 长城 遗址 全国重点文物保护单位`                      |
| 石窟/古城     | `"{名称}" 石窟 世界遗产`／`"{名称}" 故城 遗址 保护单位`           |
| 雪山/湖泊     | `"{名称}" 海拔 主峰 Wikidata`／`"{名称}" 湖 面积 国家级自然保护区` |

### 3.3 权威名录检索（S 级源，务必优先）

```
"{省份}" 国家级自然保护区 名录
"{省份}" 全国重点文物保护单位 批次 名单
"{省份}" 国家水利风景区 名单
"{省份}" 国家湿地公园 名单
"{省份}" 世界遗产 预备名单
"{地区}" 中国国家地理 最美 榜单
"{地区}" 国家公园 设立
```

### 3.4 铁路官方与行业媒体（B 级）

```
site:peoplerail.com {线路名}
site:china-railway.com.cn {线路名}
"{线路名}" 开通运营 新华网/人民日报
"{线路名}" 铁路 设计 施工 单位 工程概况
```

### 3.5 坐标核验（A 级，每条必须走）

```
Wikidata: "{景点名}" wikidata Q 编号 坐标
OSM:      "{景点名}" openstreetmap way/node
```

---

## 四、检索优先级（模型必须遵守的顺序）

| 优先级 | 来源层级                                                 | 用途                   | 是否可作唯一源           |
| --- | ---------------------------------------------------- | -------------------- | ----------------- |
| 1   | **S** 权威名录（世界遗产、国家级自然保护区、全国重点文保、国家水利风景区、国家湿地公园、国家公园） | 事实与地位                | 可与 A 组合成 verified |
| 2   | **A** Wikidata（Q 号 + 坐标）、OSM（way/node）、省市文旅厅/铁路局官网   | 坐标与存在性               | 必须与另一独立源组合        |
| 3   | **B** 人民铁道网、中国铁路、新华社/人民日报、地方志、学术著作                   | 工程事实、通车信息            | 需配 S/A            |
| 4   | **C** 小红书 / 马蜂窝 / 知乎 / 摄影论坛                          | **仅**：是否值得看、哪一侧、几月最好 | ❌ 不可单独成立          |

**判定规则**：`verified` = ≥1×(S 或 A) + ≥1×与之独立的任意级源；`probable` = 1×(S/A) + 1×C；源不足 → **丢弃**。

---

## 五、Few-shot 示例

### 正例 1（大面积 + 季节 + 左右侧）

```json
{
  "id": "qionghai-lake-view",
  "name": "邛海",
  "lng": 102.303, "lat": 27.825,
  "intro": "四川第二大淡水湖，成昆铁路冕宁—西昌段沿湖东北缘行进约 12 分钟，湖面与泸山在列车右侧展开，冬季晨雾与候鸟最佳。",
  "visibility": "window", "maxDistKm": 12, "viewScale": "mid", "viewMinutes": 12,
  "dimensions": ["geo"], "subtype": "lake",
  "tags": ["高原湖泊", "候鸟", "晨雾"],
  "side": "right",
  "bestView": { "months": [11,12,1,2], "timeOfDay": "dawn", "light": "any",
                "note": "冬季清晨易见雾与越冬候鸟", "blocked": [] },
  "nearStations": ["冕宁", "西昌"],
  "sources": [
    { "type": "authority", "level": "S", "ref": "https://www.mee.gov.cn/...", "quote": "邛海—泸山风景名胜区", "checkedAt": "2026-09-26" },
    { "type": "wiki", "level": "A", "ref": "Q10876543", "checkedAt": "2026-09-26" },
    { "type": "ugc", "level": "C", "ref": "https://www.mafengwo.cn/...", "quote": "靠右窗能看到湖", "checkedAt": "2026-09-26" }
  ],
  "verificationStatus": "verified",
  "confidenceNote": "OSM 铁路折线与湖岸最小距离约 1.8 km，无隧道遮挡；多篇游记提到右侧可见。"
}
```

### 正例 2（穿行工程 + 历史）

```json
{
  "id": "qingshuhe-rail-bridge",
  "name": "清水河特大桥",
  "lng": 94.061, "lat": 35.457,
  "intro": "青藏铁路最长"以桥代路"旱桥，全长约 11.7 km 横穿可可西里冻原，列车从其上方通过约 10 分钟，两侧皆可见，常能望见藏羚羊。",
  "visibility": "on_track", "maxDistKm": 3, "viewScale": "near", "viewMinutes": 10,
  "dimensions": ["construct", "nature"], "subtype": "permafrost_eng",
  "tags": ["冻土工程", "可可西里", "藏羚羊"],
  "side": "both",
  "bestView": { "months": [6,7,8,9], "timeOfDay": "day", "light": "any",
                "note": "白天可见野生动物；该段多数车次夜间通过", "blocked": ["night_pass"] },
  "nearStations": ["不冻泉", "楚玛尔河"],
  "sources": [
    { "type": "news", "level": "B", "ref": "http://www.peoplerail.com/...", "quote": "清水河特大桥全长11.7公里", "checkedAt": "2026-09-26" },
    { "type": "osm", "level": "A", "ref": "way/123456789", "checkedAt": "2026-09-26" }
  ],
  "verificationStatus": "verified",
  "confidenceNote": "OSM 折线与该桥轨面重合，distance<0.1km。"
}
```

### 反例（必须被拒绝，不要输出）

```json
// ❌ 九寨沟：距川青铁路约 100 km，不属于车窗可见
// ❌ "华山北站"：这是车站，不是华山风景区本体
// ❌ "某某古城站商圈"：城市商业体，与铁路无关
// ❌ sources 为空或只写 "网络"：不可核验
// ❌ intro 只写"风景优美"：无段位/侧别/时段信息
```

---

## 六、批量执行与回写

1. 模型按线路逐条产出 JSON 数组，落盘为 `tmp/scenic/{corridorId}.raw.json`（**不直接进主库**）。
2. 跑校验脚本（见主方案 §5）做机器门禁：schema 校验 → 来源可达性 → 坐标真值比对 → 距轨门禁 → 去重。
3. 通过的写入 `scripts/build-scenic-spots-curated.mjs`（转成 `spot({...})` 形式），执行  
   `node scripts/build-scenic-spots-curated.mjs` 重生 `scenic-spots.json`。
4. 未通过的进 `data/presets/scenic-spots.staging.json`，等待人工补源。
5. 回归：随机抽 3 个车次看该线景点是否按里程顺序出现、左右侧是否与运行时计算一致。
