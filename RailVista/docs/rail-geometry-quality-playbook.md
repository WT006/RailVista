# 铁路线几何质量：会话复盘与复跑手册

| 项 | 内容 |
|----|------|
| 日期 | 2026-09-14 |
| 目的 | 新窗口按本文执行，得到与当前工作区相同的沪昆/兰新/厦深展示效果 |
| 方案全文 | [`TECH-rail-geometry-quality.md`](./TECH-rail-geometry-quality.md) |
| 硬约束 | `.cursor/rules/rail-route-invariants.mdc` · `.cursor/rules/rail-corridor-ingest.mdc` |
| 踩坑全文（批量入库必读） | [`corridor-ingest-lessons.md`](./corridor-ingest-lessons.md) |
| 全国缺口清单 | [`corridor-coverage-gap.md`](./corridor-coverage-gap.md) |

**优先读本文 + `corridor-ingest-lessons.md` 再改走廊。** 不要先裸重抽 OSM / hsr。

---

## 0. 当前工作区「已达到的效果」（金标准）

不要用 `--restore` 除非你要重做实验。仓库里这三份 JSON **已经是目视验收后的状态**：

| 走廊 | OD（stationsHint / 折线端） | 本会话修了什么 |
|------|------------------------------|----------------|
| `hukun` 沪昆高铁 | **上海虹桥 → 昆明南** | 清尖刺 + 去枢纽 U 形短岔 + **虹桥进路** |
| `lanxin` 兰新高铁 | **兰州西 → 乌鲁木齐** | 仅 `clean-corridors` 去尖刺 |
| `xiashen` 厦深铁路 | **厦门北 → 深圳北** | 仅 `clean-corridors` 去尖刺 |

对照线（未当问题线修）：`jinghu`（北京南→上海虹桥）、`qingzang`（西宁→拉萨一带）。

验收命令（应 PASS，无 heavy/medium）：

```bash
node scripts/verify-corridor-geometry.mjs
```

期望：`SUMMARY ... medium=0 heavy=0` → `PASS`。

沪昆开头：折线第 0 点应贴近 `stations-geo` 的「上海虹桥」（约 `121.3165, 31.194`，距离 &lt; 0.5 km）。

改完走廊后：**重启 API**（或等目录 mtime 热载），浏览器硬刷新再看图。

---

## 1. 新窗口最小复跑（与现在一致）

工作区已有修补后的 JSON 时：

1. `git status` 确认 `data/presets/corridors/hukun.json`（及 lanxin/xiashen）未被还原。
2. 启动 API + Web，选沪昆系 G 车（上海虹桥→昆明南方向）、兰新 G、厦深沿线。
3. 检查：虹桥蓝线接到站；杭州东 / 南昌西 / 贵阳附近无 Y/V 短岔。

若有人跑过 `--restore`、或要从清洗前备份重做：

```bash
# 1) 可选：回到 2026-09-14 清洗前备份（会丢掉虹桥进路）
node scripts/demo-corridor-rebuild.mjs --restore

# 2) 一键：全库清洗（含枢纽折返）+ 沪昆虹桥进路 + 写报告 + 门禁
node scripts/demo-corridor-rebuild.mjs
```

单独补虹桥（幂等，已接上则 skip）：

```bash
node scripts/patch-hukun-hongqiao-approach.mjs
node scripts/clean-corridors.mjs --write --id hukun
```

依赖文件：`data/presets/corridors/_hsr-rails.geojson` 必须存在。

---

## 2. 本会话遇到的问题（按发生顺序）

### 2.1 全库门禁 heavy（清库前）

- `hukun` sharp=72、`lanxin` sharp=43 → **heavy**；`xiashen` sharp=23 → **medium**。
- 默认 `verify-corridor-geometry` 仅 heavy 失败。
- **处理：** `node scripts/clean-corridors.mjs --write`（去尖刺/凸起/折返）。不要先重抽源。

### 2.2 Windows 中文参数乱码

- PowerShell/`cmd` 调 `extract-corridor-from-hsr.mjs "沪昆高速线|…"` 会把名称弄成乱码，命令直接失败。
- **处理：** `spawnSync(process.execPath, args)` **不要** `shell: true`；或 `chcp 65001` 后再试。

### 2.3 裸重抽比清洗更差（已回滚，禁止当默认）

| 操作 | 后果 |
|------|------|
| `extract-corridor-from-hsr` 沪昆、不清洗 | sharp 72→**266**，maxJump→**41 km** |
| OSM relation `1043244` **member-order** 建兰新 | 里程 ~1837→**~17494 km**，折返 2000+ |

Overpass 还经常 504 / fetch failed。

**处理：** 正式重建必须 `--from lng,lat --to lng,lat` Dijkstra，写完立刻跑门禁；失败则恢复备份。**禁止**默认 member-order 写回。

### 2.4 沪昆三处 Y/V 短岔（杭州东、南昌西、贵阳）

- 折线贴枢纽后 **原路折返数点**，再 **>3.5 km 大跳** 接回主线。
- 门禁未必判 heavy（转角被清洗掉一部分后仍像支岔）。
- **处理：** `clean-corridors.mjs` 的 `removeHubRetraces`（折点≥160° + 随后靠近折点 + 短窗内大跳则删折返段）。
- **禁止**全局「见 140° 就删」：虹桥附近曾误删，出现 **21 km 缺口**。

### 2.5 沪昆开头没连上（上海虹桥）

- 源 `hsr-rails` 按东→西抽线时，东端落在闵行一带 `~121.36, 31.10`，距虹桥站 **~9–12 km**。
- 地图：黄标「上海虹桥」与绿标「列车」（蓝线起点）脱节。
- `huhang` 同一起点，不能当进路补丁。
- **处理：** `scripts/patch-hukun-hongqiao-approach.mjs`  
  在沪昆/京沪/沪苏湖/虹桥相关 ways 上软桥（≤0.45 km）Dijkstra，把虹桥站坐标接到原折线起点（约 12 km、约 23 点）。
- 图不连通时必须软桥；不要把虹桥站和折线直线连（会穿城）。

### 2.6 其它产品/架构问题（本会话未改代码，方案仍有效）

见 TECH 文：精确升级依赖公网 Overpass 易失败；K/T/Z 匹配不到已入库普速走廊；本地只有 `_hsr-rails`。二期再做离线轨网，不要用天地图 1:100 万当精品主几何。

---

## 3. 脚本与文件清单

| 路径 | 作用 |
|------|------|
| `scripts/clean-corridors.mjs` | 去尖刺/凸起/折返 + **枢纽 U 形短岔** |
| `scripts/patch-hukun-hongqiao-approach.mjs` | 沪昆补虹桥进路（幂等） |
| `scripts/demo-corridor-rebuild.mjs` | 备份 → 清洗 → 虹桥补丁 → 门禁 → 写报告 |
| `scripts/verify-corridor-geometry.mjs` | 尖刺/折返/maxJump 门禁 |
| `scripts/extract-corridor-from-hsr.mjs` | 从 `_hsr-rails` 抽干线（须 axis；抽完必清洗） |
| `scripts/build-corridor-from-osm-relation.mjs` | OSM relation；**必须** `--from/--to` |
| `tmp/corridor-demo-backup/*.json` | 清洗前备份（restore 会丢掉虹桥补丁，需再跑 demo） |
| `docs/demo-corridor-rebuild-report.md` | 数字前后对比（demo 会覆盖表格） |

---

## 4. 新窗口改走廊时的检查表

1. 先备份要改的 `data/presets/corridors/{id}.json`。
2. 不先裸重抽；先 `clean-corridors --write --id {id}`。
3. 目视枢纽（虹桥、杭州东、南昌西、贵阳北、兰州西等）：无短岔、无站线脱节。
4. 起点距 `stationsHint[0]` 对应 `stations-geo` 应 &lt; 2 km（OD 端 &lt; 5 km 更好）。
5. `verify-corridor-geometry` 不得 heavy；入库争取 `--strict`。
6. `fillJumps` 直线加密不能当「断口已修」；真断口用桥接走廊 + `note`。
7. 改 JSON 后重启 API，bump 精确缓存键若改了拼线规则。
8. 高铁走廊只给 G/D/C；普速勿套沪昆/京广等高铁几何。

---

## 5. 目视回归（沪昆必看）

1. **上海虹桥**：蓝线从站标出发，不要从闵行「列车」处才开始。
2. **杭州东**：主线过站，西北侧不要悬空支岔。
3. **南昌西**：过赣江后不要 Y 形死岔。
4. **贵阳（金关/观山湖一带）**：不要北向主线 + 西南死岔断开。
5. 兰新 / 厦深：抽查兰州西、乌鲁木齐、厦门北、深圳北贴站。
