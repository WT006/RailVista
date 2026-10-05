# 公路几何与沿程总览：复盘与入库标准

| 项 | 内容 |
|----|------|
| 日期 | 2026-10-05 |
| 触发线 | G101 京沈线（首条「搜索 → 地图展示」补几何样例） |
| 硬约束 | `.cursor/rules/road-route-invariants.mdc` |
| 对照金标准（总览观感） | G331 丹阿线：主链成带、总览干净、章节为「地名 — 地名」 |
| 相关文档 | `docs/AI交接报告-公路路网建设-20261001.md` · `docs/AI交接报告-全国路网完善-20261003.md` |

**新抓 / 补几何的国道必须按本文验收。** 搜得到但画不出、或总览碎成乱线，不算完成。

---

## 0. 产品口径（先分清两层）

| 层 | 是什么 | 完成标准 |
|---|---|---|
| **L0 索引** | `data/roads/index/*.json` 能搜到编号 | 名录在册即可 |
| **L1 几何** | `data/roads/geom/{key}.json` 能画线 | 磁盘有文件 + `/along?road=` 出折线 |
| **沿程页总览** | `/drive/trip?road=` 中间地图 | 像 G331：走廊感清晰，不是散点乱线 |

- **搜索在册 ≠ 可展示。** 索引 `hasGeom:true` 但磁盘无 `geom/*.json` → 点进去 404「几何待补」。
- **精品路书**（`data/presets/drive-routes/`）与单条 G 编号是另一套流水线，不混谈。

---

## 1. 本次踩坑 → 正例（G101）

### 1.1 几何只抓到「最长一段」

| ❌ | ✅ |
|---|---|
| Overpass 直抓后主链仅辽宁 ~367 km / 官方 909 km（40%），北京段进 orphan | 长线优先 `--provincial-tiling` 或 `pnpm roads:build`（PBF 全量装配）；总览要对齐官方走廊走向 |
| `chainAll` 只留最长主链，其余丢成虚线断段，总览像乱线 | 总览以**主链走廊感**为准；断段可虚线，但取景不能被飞点景点拉飞 |
| 端点声明「北京→沈阳」但起点离北京 411 km，仍当完整京沈线吹 | 必须标 `endpointsUnverified` + 诚实文案「已贯通 / 官方里程」 |

### 1.2 索引与磁盘不同步

| ❌ | ✅ |
|---|---|
| 全量 `build-road-index.mjs --merge`（无 `--from-net`）把省道 1.4 万条打回 12 条种子 | **单条补几何只 patch 该 key 的 index 字段**；全量重建必须 `--from-net --merge` |
| 索引写 `hasGeom:true` 但 `geom/` 无文件 | 以**磁盘 geom 文件**为准验收；patch 后 `hasGeom` / `lengthKm` / `bbox` / `precision` 与文件一致 |

### 1.3 「即将到达」空表、右侧却有景

| ❌ | ✅ |
|---|---|
| 死守前方 80 km；首景点在 K169 → 永远「暂无匹配」 | 窗口空时回退「下一处起」最近 N 个景点 |
| 景点匹配含 orphan 段（progressKm 可到 1000+），进度条跨度也并进去 | **进度条跨度只认主链/章节**；断段景点留在列表与回退「即将到达」 |

### 1.4 章节写成「第 3 段 · 240—360 km」

| ❌ | ✅ |
|---|---|
| `nodes` 空或只有错钉端点 → `buildChapters` 走 120 km 等分退化 | 抓完几何立刻 `fill-road-place-anchors.mjs --keys {Gxxx} --force` |
| 徽章「第 3/4 段」+ 标题再写一遍「第 3 段 · …」 | 标题必须是 **`地名 — 地名`**（与 G331「丹东 — 寺谷山」同口径）；徽章只留段号 |
| 末锚点停在站名前，末段 toKm 短于主链 | `buildChapters` 把末段 toKm 接到主链尽头 |

### 1.5 总览地图观感

| ❌ | ✅ |
|---|---|
| 只画主链、景点挂在 orphan → 点飞线外 | 主链实线 + 未贯通段虚线一并画 |
| 取景 bbox 把离线景点一并吸入 → meet 后主链被压成一团乱线 | **取景只跟路线几何（主链+段）**；景点点数量上限抽稀 |
| 进度条把 orphan 里程并进 span → 章节挤在左侧一条细缝 | span = `max(章节末, 主链 cumKm)`，勿并 spotSpan / orphanSpan |

---

## 2. 单条公路入库流水线（之后每条都按这个做）

```bash
# ① 抓几何（长线务必分省；短线可 --ref）
node scripts/fetch-road-geometry.mjs --ref G101 --provincial-tiling

# ② 地名锚点（章节「A — B」的前提；无锚点禁止当验收通过）
node scripts/fill-road-place-anchors.mjs --keys G101 --force

# ③ 同步索引（单条只 patch；禁止无 --from-net 的全量 --merge）
#    至少更新：hasGeom / lengthKm / bbox / precision / componentCount / status

# ④ 质检
node scripts/verify-road-network.mjs   # 可加针对该 key 的检查

# ⑤ 冒烟（浏览器硬刷新）
#    /drive → 编号键盘搜 G101 → /drive/trip?road=G101
```

可选全量底盘（本地有 31 省 PBF 时）：

```bash
pnpm roads:build   # ways → geom → index --from-net --merge → verify → raster
```

---

## 3. 验收清单（门禁）

对每条新补的 `Gxxx` / `省:Sxxx`：

1. **磁盘** `data/roads/geom/{key}.json` 存在，`points.length ≥ 2`
2. **诚实里程**：响应/UI 写清「已贯通 X km / 官方 Y km（Z%）」；`endpointsUnverified` 时不得伪装起讫贴合
3. **章节**：`/api/drive/along?road=` 的 `chapters[].title` 形如 `地名 — 地名`，**禁止**验收时仍是 `第 N 段 · a—b km`
4. **即将到达**：进度 0 时若有下游景点，不得空表（允许「下一处起」回退）
5. **总览图**：主链实线可辨走廊走向；虚线=未贯通；取景不被飞点拉飞；观感对齐 G331 级「一条带子」而非碎线团
6. **进度条**：章节段与填充对齐，不出现「章节全挤在左 1/3」
7. **索引**：该 key 的 `hasGeom` 与磁盘一致；未误伤 `provincial.json` 全量

---

## 4. 前端总览图纪律（`DriveTrip.vue`）

- 画：主链 `drive-trip-map__route` + orphan `drive-trip-map__segment`（虚线）
- 取景：只吸收 **coords + segments**；景点最多辅助、勿主导 bbox
- 多段时 `preserveAspectRatio="xMidYMid meet"`，避免 `slice` 裁掉边段
- 底部诚实注记：`engineNote` +「虚线 = 未贯通段（N 段 · 最大断口 X km）」
- 进度 `spanKm = max(chapterSpan, chainKm)`，**禁止**并入 orphan / 最远景点 progressKm

---

## 5. 推荐补线优先级（搜索→展示）

在旗舰 33 条之外，按「可搜可画」继续补：

1. 东三省放射：G101（样例）、G102、G201–G203  
2. 海南环岛：G223 / G224 / G225  
3. 沿边：G228  
4. 其余经典国道 → 高速（当前磁盘高速 geom = 0）

每批：抓几何 → 锚点 → patch 索引 → 冒烟 → 对照本文 §3。

---

## 6. 与铁路侧的对照

| 铁路 | 公路 |
|---|---|
| 走廊 `verify --strict` | `verify-road-network` + 本文 §3 |
| 站序=时刻表 | 编号主键=权威名录；几何=OSM 众包，必须诚实标注 |
| wiki 站不可被静默改钉 | 端点地名不可信 → `endpointsUnverified`，禁止假贴合 |
| 总览忌飞线/尖刺 | 总览忌「最长链冒充全线」+ 飞点拉飞取景 |
