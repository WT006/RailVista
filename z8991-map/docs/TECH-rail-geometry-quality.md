# 铁路线几何质量提升技术方案

| 项 | 内容 |
|----|------|
| 文档版本 | v1.1 |
| 状态 | 已确认方向，分期落地；一期沪昆/兰新/厦深已落地补丁 |
| 日期 | 2026-09-14 |
| 相关 | [`rail-geometry-quality-playbook.md`](./rail-geometry-quality-playbook.md) · `rail-route-invariants.mdc` · `rail-corridor-ingest.mdc` · `scenic-railway-lines.md` |

**新窗口先读 playbook**（踩坑、虹桥进路、禁止裸重抽、复跑命令），再改走廊。

---

## 1. 目标

| 目标 | 验收标准 |
|------|----------|
| **已入库精品线拟合尽可能好** | 无飞线、无折返尖刺、不错贴平行线；`verify-corridor-geometry --strict` 全过；站→折线多数 &lt;2 km、OD &lt;5 km |
| **点击精确升级：稳定可用** | 外网差也不硬失败；热门线接近 Z8991 演示；冷门允许「部分精确 + 示意补段」 |

**不做：** 追求任意冷门车 100% 贴轨；不以天地图 1:100 万 / 1:25 万或高德火车通勤规划作为精品主几何。

---

## 2. 问题诊断（现状）

### 2.1 为什么 Z8991 好、其它线差

- Z8991：人工预置整条折线（`data/presets/z8991-railway.json`）。
- 其它车：依赖「走廊命中」或「站间实时 Overpass 寻路」。
- 公网 Overpass 超时/限流 → 精确 job 常失败或只剩示意。
- 部分已入库走廊（如 `hukun`/`lanxin`）几何门禁已为 **heavy**（尖刺多），清洗脚本的直线 densify 还会掩盖真断口。

### 2.2 精确升级链路（改造前）

```text
走廊命中 → 本地 hsr-rails（仅 G/D/C）→ 公网 Overpass → 示意 / failed
```

后半段脆弱，是「点了获取不到 / 效果差」的主因。

### 2.3 额外逻辑缺口

- 非 G/D/C **禁止匹配任何走廊**，导致已入库普速风景走廊（青藏、宝成等）点精确时用不上。
- 本地轨网只有 `_hsr-rails.geojson`，普速无离线主路径。

---

## 3. 数据源评估与选型

| 来源 | 精度/现势 | 按站序贴轨 | 决策 |
|------|-----------|------------|------|
| **Geofabrik China PBF → 离线轨网图** | 钢轨级，持续更新 | ✅ | **精确升级主源** |
| **OSM `route=railway` relation** | 干线命名清晰 | ✅ | **精品走廊重建首选** |
| **`_hsr-rails.geojson` / china-hsr-simulation** | 高铁较好 | ✅ 仅 G/D/C | **高铁走廊继续用** |
| HDX HOT China railways | 同 OSM 打包 | ✅ | 构建输入备选 |
| webmap / 天地图 LRRL（1:100万、1:25万） | 示意、现势偏旧 | ❌ | **不用作精品几何** |
| 高德跨城 `railway.polyline` | 站间近似 | 弱 | 仅末级实验兜底 |
| 12306 | 无线形 | ❌ | 只供站序 |

**选型一句话：** 精品线用 OSM relation + hsr-rails 重建并门禁；点击精确用离线全国轨网，公网 Overpass 降为可选兜底。

参考实现：现有 `localRails.ts` / `build-corridor-from-osm-relation.mjs`；社区工具如 [osm-rail-graph](https://github.com/HelloJowet/osm-rail-graph)、OSRD `osm_to_railjson` 可作图构建参考。

---

## 4. 目标架构

```text
时刻表站序 + stations-geo
        │
        ▼
┌─ Tier A 精品走廊 / 路网拼接 ─────────────────┐
│  G/D/C → HSR 走廊；K/T/Z → 普速风景走廊      │
│  几何：OSM relation / hsr-rails + 门禁       │
└──────────────────────┬───────────────────────┘
                       │ miss
                       ▼
┌─ Tier B 离线全国轨网（Geofabrik 滤 railway）─┐
│  高铁 profile / 普速 profile 分图或分权       │
│  按站序 hop 寻路 + 跨站桥接守卫               │
└──────────────────────┬───────────────────────┘
                       │ miss / 质检拒
                       ▼
┌─ Tier C 部分精确 + 示意补段 ─────────────────┐
│  永不「获取失败」；可重试缺口；写缓存         │
└──────────────────────────────────────────────┘
成功结果 → rail-cache 持久化（trainCode + 站序指纹）
```

硬约束（不变）：

1. 站序 = 时刻表，禁止按 lat/lng 重排。  
2. 高铁走廊 / 本地高铁轨 ≠ 普速车。  
3. `slicePolylineByOd`：from 进度 &gt; to 时必须 reverse。  
4. `bridge:skip`：中间站距桥接线过远则拒绝补缝。  
5. 改拼线规则后 bump 缓存键（如 `railseg:vN` / `railgraph:v1`）。

---

## 5. 分期落地

### 一期：已入库精品线清库（优先）

**做什么**

1. 对 heavy/medium 走廊按优先级重抽：  
   - 高铁：`extract-corridor-from-hsr.mjs` 或 OSM relation（门禁更优者入库）。  
   - 普速：`build-corridor-from-osm-relation.mjs`。  
   - phase6–7 锚点线：升到 relation / osm-bbox 真轨。  
2. 加强 `verify-corridor-geometry.mjs`：  
   - 保留尖刺 / 折返 / maxJump。  
   - **新增：** `stationsHint` 投影距离门禁。  
   - 入库与 CI 使用 `--strict`（medium 也不过）。  
3. `clean-corridors.mjs`：`fillJumps` 默认只报警，禁止静默直线 densify 写回冒充修好。  
4. 断口用显式桥接走廊 + `note`（银兰→兰州西模式）。  
5. 走廊修完后 scrub / seed `stations-geo`，避免飞点拖垮拟合。

**先修榜：** `hukun`、`lanxin`；`lanyu` 毛刺；phase6–7 锚点线。

**交付：** `node scripts/verify-corridor-geometry.mjs --strict` 全绿；抽查热门风景线无飞线/折返/错平行线。

### 二期：精确升级稳定可用（改底层）

> **2026-09 务实交付：** 不以全量 Geofabrik 阻塞。默认用 `_hsr-rails.geojson` + 普速走廊生成 `data/rails/*`；`--pbf` 可选（需 osmium）。

1. **离线轨网资产**  
   - 脚本：`scripts/build-rail-graph.mjs`  
   - 默认产出：`data/rails/china-hsr.graph`、`china-rail.graph`（+ geojson 兜底）  
   - 可选：`--pbf tmp/china-latest.osm.pbf`（osmium tags-filter）  
2. **改 `buildSegmentGeometry` / `railGeometryJob`**  
   - 顺序：本地 HSR 图（G/D/C）或本地普速图（K/T/Z）→（可选）Overpass（`RAIL_OVERPASS=0` 可关）  
   - 保留质量门与桥接守卫；缓存键 `railseg:v7` / `rail:v7`  
3. **匹配逻辑**  
   - G/D → 仅高铁走廊 + HSR 图  
   - C → 高铁 + 普速客运走廊（丽香等）  
   - K/T/Z → 仅普速走廊（非仿真/非「高铁|高速」名）+ 普速图  
   - 禁止 K/T/Z 套高铁  
4. **产品语义**  
   - `segmentsOk===0` → `partial` + `station`（不硬 `failed`），可重试  
   - 热门：`trainCode + 站序指纹` → `data/cache/precise/` + 内存 TTL  

**交付：** 弱网可升级；热门 G 车走廊/本地优先；普速不套高铁。

### 三期：热门接近演示 + 冷门可接受

1. 风景线 / 高查询车次：走廊优先 + 预跑 cache。  
2. 冷门允许 `mixed`，UI 标明「部分轨道 + 示意」。  
3. 回归集：反向 OD、K 拒高铁、桥接拒远站、沪昆/兰新/青藏/Z8991 → CI。

---

## 6. 关键模块与文件

| 路径 | 职责 |
|------|------|
| `data/presets/corridors/*` | 精品走廊几何 |
| `data/presets/corridors/_hsr-rails.geojson` | 本地高铁轨库 |
| `data/rails/`（新建） | 离线全国轨网 |
| `scripts/verify-corridor-geometry.mjs` | 几何门禁 |
| `scripts/clean-corridors.mjs` | 清洗（限制 densify 写回） |
| `scripts/extract-corridor-from-hsr.mjs` | 高铁走廊提取 |
| `scripts/build-corridor-from-osm-relation.mjs` | OSM relation 建走廊 |
| `scripts/build-rail-graph.mjs`（新建） | PBF → 图 |
| `apps/api/src/services/corridors.ts` | 走廊匹配（含普速放开） |
| `apps/api/src/services/corridorNetwork.ts` | 多走廊拼接 |
| `apps/api/src/services/localRails.ts` | 本地轨网寻路 |
| `apps/api/src/services/osmRailway.ts` | 段几何 / Overpass 降级 |
| `apps/api/src/services/railGeometryJob.ts` | 精确升级 job |

---

## 7. 建议节奏

| 周次 | 产出 |
|------|------|
| W1 | strict 门禁 + 修 hukun/lanxin + 锚点升级清单 |
| W2–W3 | Geofabrik → 离线图；精确 job 切本地主路径；失败降级 |
| W4 | 普速走廊匹配放开；热门 cache；回归集 |
| 持续 | 风景线 relation 重建 + 热门预热 |

---

## 8. Demo 验证与本会话补丁

完整复盘（问题、禁令、复跑）：[`rail-geometry-quality-playbook.md`](./rail-geometry-quality-playbook.md)。

一期最小可验证：**不要**先裸重抽 OSM member-order / 无清洗的 hsr 重抽。

```bash
node scripts/demo-corridor-rebuild.mjs
node scripts/verify-corridor-geometry.mjs
```

`demo-corridor-rebuild.mjs` 现会：备份 → `clean-corridors --write`（含枢纽 U 形短岔）→ `patch-hukun-hongqiao-approach.mjs` → 门禁 → 写 `docs/demo-corridor-rebuild-report.md`。

`--restore` 只恢复清洗前备份，**不会**保留虹桥进路；restore 后必须再跑一遍 demo（或单独跑虹桥脚本）。

**实测摘要（2026-09-14）：** 清洗后沪昆/兰新/厦深 heavy·medium 清零；目视修了沪昆杭州东/南昌西/贵阳短岔与虹桥脱节。裸重抽曾恶化几何，已回滚。

---

## 9. 成功判据（总验收）

1. **已入库：** `--strict` 全过；目视无飞线/折返；平行站不错贴。  
2. **热门精确：** 体验接近 Z8991。  
3. **点击精确：** 不白屏；冷门最多「部分精确 + 示意」。
