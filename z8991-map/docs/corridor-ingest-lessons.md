# 精品走廊入库：历史问题与解决方案（精度门禁）

> 用途：批量补入库（见 `corridor-coverage-gap.md`）时，**先读本文**，确保新线达到沪昆 / 兰新 / 厦深 / 青藏同级观感。  
> 来源：`rail-geometry-quality-playbook.md` · `corridor-calibration-log.md` · `TECH-rail-geometry-quality.md` · `rail-route-invariants.mdc` · 各走廊 `note`  
> 金标准走廊：`hukun`（含虹桥进路）、`lanxin`、`xiashen`、`jinghu`、`qingzang`  
>
> **已写入 Cursor 规则（改走廊时自动带上）：** `.cursor/rules/rail-corridor-ingest.mdc`（流水线 + 踩坑摘要）· `.cursor/rules/rail-route-invariants.mdc`（硬约束入口）

---

## 0. 一句话标准

新线入库必须同时满足：

1. `node scripts/verify-corridor-geometry.mjs --strict` → **PASS**（无 heavy/medium，站距门禁过）  
2. 目视：OD 贴站、枢纽无 Y/V 短岔、无飞线、无错平行线  
3. 车次类正确：G/D/C ↔ 高铁走廊；K/T/Z ↔ 普速走廊  

达不到 → **不得**写入正式 `data/presets/corridors/`（或标 `note` 暂缓并保留备份）。

---

## 1. 问题 → 解决方案对照表

| # | 现象（踩过的坑） | 根因 | 正确做法 | 禁止 |
|---|------------------|------|----------|------|
| 1 | 尖刺多、门禁 **heavy**（沪昆 sharp=72、兰新=43） | 源轨网噪声 / 未清洗 | 先 `clean-corridors.mjs --write --id {id}`，再 verify | 先裸重抽当「修复」 |
| 2 | 裸重抽沪昆后更差（sharp 72→**266**，maxJump **41km**） | hsr 重抽放大毛刺 | 有旧线则 **clean 优先**；必须重抽则抽完立刻 clean+verify，失败回滚备份 | 裸 extract 直接提交 |
| 3 | 兰新里程 ~1837→**~17494 km**、折返两千次 | OSM relation **member-order** | `build-corridor-from-osm-relation.mjs` **必须** `--from lng,lat --to lng,lat` Dijkstra | 按 member 顺序拼线 |
| 4 | Windows 中文线名乱码、提取失败 | `shell:true` / 控制台编码 | `spawnSync(process.execPath, args)` **勿** `shell:true`；或 `chcp 65001` | PowerShell 直接塞中文 argv 且开 shell |
| 5 | 杭州东 / 南昌西 / 贵阳 **Y/V 短岔** | 贴枢纽后原路折返再大跳 | `clean-corridors` 的 `removeHubRetraces` | 全局「见 140° 就删」（曾砍虹桥，出现 **21km 缺口**） |
| 6 | 沪昆蓝线起点在闵行，虹桥站脱节 ~9–12km | hsr 东端不在虹桥 | `patch-hukun-hongqiao-approach.mjs`：软桥 Dijkstra 接站（≤0.45km 缝） | 直线连接虹桥↔折线起点（穿城） |
| 7 | OD 端不贴站（敦白/沈佳/拉林/渝贵等） | 折线端点偏离站坐标 | `patch-corridor-od-approaches.mjs`；必要时 OD snap + note | 忽略端点距离 |
| 8 | maxJump>8 像「修好了」其实是假的 | `fillJumps` 直线加密掩盖断口 | **默认关闭** fillJumps；真断口用桥接 + `note`；源跳用 `densify-corridor-jumps.mjs` 并写明 | 静默 fillJumps 冒充连续 |
| 9 | 银兰末端距兰州西 / 徐兰 **~36km** | 源数据通道断口 | `patch-yinlan-lanzhou-bridge` 类显式桥接，`note` 写清 | 大跨直线飞线 |
| 10 | 蓝线「绕开」千岛湖 / 潜江飞江苏 | **stations-geo 飞点**，不是走廊错 | scrub + 区域锚点；对照 wiki/OSM 真站位；走廊距真站&lt;1km 则修站不改站序 | 按 lat/lng 重排站序「修交叉」 |
| 11 | K 车走高铁、跳过青铜峡 / 安阳↔安阳东 | 高铁走廊套到普速车 | 分库：HSR 只给 G/D/C；普速另建 OSM 走廊 | 京沪线复用 `jinghu` 高铁几何 |
| 11b | Z509 兰州→乌鲁木齐蓝线绕开西宁（河西） | Z 强制 `conventional` → 命中 `lanxinxian`；真车走 `lanxin` 高铁 | `stopsEvidenceHsrOverride`：孤点中间站或 ≥2 方位高铁中间站时允许 HSR | 一律禁止 Z 走高铁、或把兰新线改经西宁 |
| 12 | 方位站误命中（杭州南 vs 杭州东） | 同词干不同方位当贴合 | 冲突站 **不算** fit；hints 写对「东/西/南/北」 | 混用平行站名 |
| 13 | 反向 OD 巨跳 / 折返 | 单向折线未 reverse | `slicePolylineByOd`：from 进度&gt;to 必须 reverse | 只存单向、反向硬切片 |
| 14 | 等分 progress 撒站坐标 | seed 算法偷懒 | 锚站投影再插值：`seed-missing-stations-geo` / `seed-corridor-stations-geo` | 整线等分 progress |
| 15 | 跨站 bridge 跳站 | 中间站离桥接线太远 | `bridge:skip`：via &gt;~12km **拒绝**补缝，保留示意段 | 强行跨站飞线 |
| 16 | 超长干线 prefer 锁死坏路径 | 命名 prefer 过强 | prefer 失败 → `allowPrefer: false` 回退 | 京港等 prefer 一次定死 |
| 17 | Overpass 504 / 精确升级常失败 | 依赖公网 | 走廊命中优先；本地 `china-hsr.graph` / `china-rail.graph`；`RAIL_OVERPASS=0` 可关 | 精品主几何指望 Overpass |
| 18 | 改规则后仍显示旧线 | 缓存 / 未热载 | 改 JSON 后重启 API 或等 mtime；改拼线规则 **bump** `railseg:vN`（现 `v8`） | 只改数据不 bump 缓存 |
| 19 | via-legs 每段 spawn 重载 graph | 进程隔离 | `build-local-corridor-core` 同进程复用；osm-bbox 本地优先 | 每 leg 重新 JSON.parse 33万 ways |
| 20 | G/D 失败再打普速 Overpass | 慢且易贴错线 | `preferHs` 只打 HS；整趟也不扩普速 | 用普速「凑完整度」 |
| 19 | 锚点风景线（phase6/7）偏示意 | 无 OSM 真轨 | 有 relation 则升 Dijkstra；暂无则锚点 + note「待 OSM」 | 把锚点线当已达金标准 |
| 20 | 兰渝等「几何仍偏长」 | OSM 脏 / 未洗透 | clean → verify → 目视；救不了再 bbox/站链重拼 | 带 medium/heavy 入库 |
| 21 | 敦白终点站错位 | 假 OD snap / 错站 | 对照 wiki/OSM 站位修正 terminus + note | 盲信第一次 snap |
| 22 | 渝贵终点贵阳东≈贵阳北 | 枢纽多站 | hints 含两端；末端贴合放行策略（见 calibration 二期） | 强行只认一个站名导致锯齿 |
| 23 | G/D 测「宁波→温州南 / 石家庄→济南东」只有站间直线、「偏离铁路较远」；走廊 JSON 其实已在 | `isHsrCorridor`：OSM 入库 `source=osm`，名称是「甬台温**铁路** / 石济**客专** / 南广**铁路**」不含「高铁\|高速\|城际」→ 被当成普速；G/D 的 `filterKind=hsr` **整条跳过** | ① 名称含 `客专\|客运专线` 亦算高铁；② 客运专线 id 写入 `KNOWN_HSR_CORRIDOR_IDS`；③ 入库冒烟必须用 **真实 G/D 车次** 点开地图确认命中本走廊 | 只 verify 几何、不测 G/D 命中就当入库完成 |
| 24 | 蓝线绕开**安图西**（长珲行程，站在南边孤点） | `stations-geo` 被 `corridor:dunbai` seed 错钉到敦白南线（偏 ~58km）；安图西是**长珲**站 | 钉回 `changhui`/wiki + 区域锚点；`dunbai` hints **勿挂**长珲专用站；`verify` 报 `SEED`/`midFar` | 共线名站跨走廊复用 snap |
| 25 | D2206 沪通蓝线两端悬空（虹桥/南通西） | `hutong` OSM 名过滤抽线两端不到站；`attachOdApproaches` 只补 ≤8km | via-legs / OD patch 至门禁；`stationsHint` 用真实 OD（虹桥→南通西）；`--strict` 拦 OD&gt;5 | 裸 bbox 入库、指望运行时自动连站 |
| 26 | 汉十蓝线在**襄阳东**北冲再折回成 V；站标偏北 | `stations-geo` 被 `corridor:zhengyu` 钉到郑渝**北段**（~32.26°N），真站在**东津**（wiki ~32.016°N / 112.29°E，偏 ~27km）；旧名「襄阳东」=今襄州（普速）易混；重建脚本用「最近轨点 / 北瞄 cut」且覆盖 wiki | ① 对照 wiki 钉东津 + `STATION_REGION_ANCHORS`；② 走廊走**武西过站**，禁止郑渝北段 spur；③ `source:wiki` **禁止**被 `corridor:*` 静默覆盖；④ 中间站 V 尖刺 → **先查站坐标** | 以为 seed 贴合郑渝（&lt;12km）就对；用北段最近点当站房 |

**本批（P0 A+B）审计（2026-09-17）：**

| id | 名称 | 修复前 isHsr | 说明 |
|----|------|-------------|------|
| `yongtaiwen` | 甬台温铁路 | ❌ | 与截图一致，已修 |
| `shiji` | 石济客专 | ❌ | 与截图一致，已修 |
| `shitai` | 石太客专 | ❌ | 同病，已修 |
| `nanguang` | 南广铁路 | ❌ | 同病，已修 |
| `hebang` `yuwan` `lianzhen` `haqi` | 名含高铁/城际 | ✅ | 无此问题 |
| A 批 8 条 | hsr-rails source | ✅ | source 已识别 |

库内另有同病（非本批 16，已一并白名单）：`xiangpu` 向莆铁路、`ganlong` 赣龙铁路。  
仍标普速（名称「…铁路」、供 K 等或风景锚点）：宝成/成昆/青藏/拉林/丽香等——**若日后有大量 G/D 经停，须再评估是否进白名单**。

---

## 2. 标准入库流水线（新线必须走完）

```text
1. 备份（若覆盖已有 id）
2. 分类：高铁 → extract-corridor-from-hsr 或 OSM relation
         普速 → OSM relation / osm-bbox（禁止 hsr）
3. OSM 必须 --from/--to Dijkstra；hsr 必须正确 --axis / --reverse
4. stationsHint：真实 OD 端点 + 正确方位后缀
5. clean-corridors --write --id {id}
6. 若 OD 脱节 → patch-corridor-od-approaches（枢纽进路可仿虹桥补丁）
7. 若真断口 → 桥接脚本 + note（禁止静默 fillJumps）
8. verify-corridor-geometry --strict（不过则回滚）
   - 拦：heavy/medium、OD&gt;5、hint 站&gt;12（midFar）、corridor:id seed 离宿主&gt;12
9. seed-missing-stations-geo + scrub-corridor-station-flyers（抽查飞点；**禁止跨走廊 snap**）
10. 运行时冒烟：
    - G/D 车应命中本高铁走廊
    - K/T/Z 不得命中本高铁走廊
    - 反向 OD 切片无巨跳
    - 中间站落在蓝线上（无孤点）
11. 目视枢纽：首末站、大站（东/西/南/北）无短岔、无脱节
12. 重启 API / 硬刷新地图
```

批量脚本注意：子进程 **不要** `shell: true`（坑 #4）。

---

## 3. 数值门禁（与金标准一致）

| 检查 | 通过阈值 |
|------|----------|
| `verify` tier | 无 heavy；入库争取无 medium（`--strict`） |
| 站→折线 | 多数 &lt; **2 km**；**任一 hint &gt; 12 km → 失败**（midFar） |
| OD 端→折线 | &lt; **5 km**（虹桥级应 &lt; **0.5 km**） |
| `corridor:{id}` seed | 须贴合宿主折线 &lt; **12 km**（跨走廊错钉 → SEED 失败）；**仍须 wiki 抽查枢纽/改名站**（同走廊错公里 SEED 拦不住） |
| maxJump | 宜 &lt; **8 km**；超过必须 bridge+note 或显式 densify+note |
| 折角 | 避免 ≥**150°** 尖刺；枢纽短岔靠 `removeHubRetraces` |
| bridge via | 中间站距桥接线 &gt; ~**12 km** → 拒绝补缝 |

验收命令：

```bash
node scripts/verify-corridor-geometry.mjs
node scripts/verify-corridor-geometry.mjs --strict
# 问题线演示复跑（可选）
node scripts/demo-corridor-rebuild.mjs
```

期望：`SUMMARY ... medium=0 heavy=0`，`--strict` 下 `stationFail=0`。

---

## 4. 目视回归清单（每条新线至少做）

对标沪昆会话验收：

1. **起点**：蓝线从 `stationsHint[0]` 站标出发，不要从邻镇「悬空」开始  
2. **终点**：同样贴 `stationsHint[last]`  
3. **大枢纽**：无西北/东南悬空支岔（沪昆曾查：杭州东、南昌西、贵阳）  
4. **平行线**：本线不要贴到邻线（杭黄 vs 合福、京沪 vs 京沪普速）  
5. **车次**：用一趟真实 G（或 K）打开地图，确认命中的是本走廊而非错误走廊  

---

## 5. 相关脚本速查

| 脚本 | 何时用 |
|------|--------|
| `extract-corridor-from-hsr.mjs` | 高铁有 hsr-rails 线名 |
| `build-corridor-from-osm-relation.mjs` | 有 relation；**必带** `--from/--to` |
| `build-corridor-from-osm-bbox.mjs` | 无干净 relation |
| `clean-corridors.mjs` | 每条必跑 |
| `verify-corridor-geometry.mjs` | 每条必跑，入库用 `--strict` |
| `patch-hukun-hongqiao-approach.mjs` | 沪昆虹桥；其它枢纽可仿此模式 |
| `patch-corridor-od-approaches.mjs` | OD 进路 |
| `densify-corridor-jumps.mjs` | 源跳显式加密 + note |
| `scrub-corridor-station-flyers.mjs` | 站飞点 |
| `seed-missing-stations-geo.mjs` | 补站坐标（锚点投影） |
| `demo-corridor-rebuild.mjs` | 金标准线一键复跑 |
| `build-rail-graph.mjs` | 精确升级离线兜底（非走廊本身） |

---

## 6. 对「164 条待入库」的执行含义

- **精度目标** = 本文金标准，不是「有 JSON 就算入库」。  
- 源数据空/过短（历史上商合杭、石太、包银、甬广等）→ **暂缓**，不要硬抽脏线。  
- 平行普速（京沪线等）必须 **单独 OSM 走廊**，禁止复用 `jinghu` 等高铁。  
- 每批建议：≤10–15 条 → clean → `--strict` → 目视 3 个枢纽 → 再下一批。  

复跑与细节仍以 [`rail-geometry-quality-playbook.md`](./rail-geometry-quality-playbook.md) 为准。
