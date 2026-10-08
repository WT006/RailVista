# 六省景点补全记录（2026-10-05）

## 背景

AtlasMap 省份筛选反馈六省景点偏少：安徽 1、湖北 4、天津 4、宁夏 5、青海 18、贵州 90。
根因：铁路主库 432 条旧数据无 `province` 字段；公路库宁夏/天津为 0 条。

## 变更概要

| 侧 | 操作 | 条目 | 产物 |
|---|---|---|---|
| 铁路 | 六省批次生成 | 60 候选 → 51 入库 | `scenic-spots-supplement-20261005.json` |
| 铁路 | province 回填 | 312 条补齐 | `scenic-spots.json` 811 条 |
| 公路 | 六省增量入库 | 200 候选 → 185 新增 | `roadside-spots.json` 12818 条 |

## 达标结果

| 省份 | 铁路目标 | 铁路实际 | 公路目标 | 公路实际 |
|---|---|---|---|---|
| 安徽 | ≥10 | 19 | ≥50 | 51 |
| 湖北 | ≥12 | 25 | ≥50 | 51 |
| 天津 | ≥8 | 11 | ≥30 | 30 |
| 宁夏 | ≥8 | 20 | ≥40 | 41 |
| 青海 | ≥15 | 28 | ≥40 | 43 |
| 贵州 | ≥12 | 23 | ≥100 | 101 |

## 脚本

| 脚本 | 用途 |
|---|---|
| `scripts/build-scenic-sixprov-batch-20261005.mjs` | 铁路六省批次生成（60 候选，投影自检） |
| `scripts/fill-scenic-province.mjs` | 铁路 province 回填（四级判定链：tags→bbox→走廊→市县） |
| `scripts/build-scenic-spots-curated.mjs` | 合并入库（20261005 块） |
| `scripts/build-roadside-sixprov-batch-20261005.mjs` | 公路六省增量入库（三级去重） |
| `scripts/verify-sixprov-fill.mjs` | 九项校验 + 十二项门禁（21 PASS） |

## 数据规范

- 铁路 category 禁止 `other`，映射至 v3 六维（mountain/lake/gorge/grassland/desert/engineering）
- intro 四要素：区段标识 + 视角方位 + 时段 + 景观描述，40~90 码点
- sources ≥1 条 S/A 级（wiki）+ 独立二次源（OSM）
- 三级去重：ID / 名称归一化 / 500m 近邻
- enrichV3Spots 走廊投影校验：距轨 ≤ maxDistKm，maxDistKm ≤ 50
- 安徽候选避开 jinghu corridorId

## 回归

- shared 包：214 pass / 0 fail（新增 14 条数据断言）
- API 包：66 pass / 9 fail（与基线一致，Jinghu ≤5 断言为既有失败，非本批次引入）
- web 构建：vue-tsc + vite build ✓

## 备份

- `data/presets/scenic-spots.pre-provfill-20261006.json`（province 回填前）
- `data/roads/roadside-spots.pre-sixprov-20261005.json`（公路增量前）