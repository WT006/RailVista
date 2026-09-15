# 走廊清库 Demo 报告

生成时间：2026-09-14

对照：[`TECH-rail-geometry-quality.md`](./TECH-rail-geometry-quality.md) · **完整复盘与复跑** → [`rail-geometry-quality-playbook.md`](./rail-geometry-quality-playbook.md)

本会话动作：`clean-corridors --write`（含 `removeHubRetraces`）+ `patch-hukun-hongqiao-approach.mjs`。

备份：`tmp/corridor-demo-backup/`。`--restore` 会丢掉虹桥进路，restore 后须再跑 `node scripts/demo-corridor-rebuild.mjs`。

## 前后对比（清洗，不含虹桥补点）

| 走廊 | 阶段 | tier | sharp≥150° | backtracks | maxJump(km) | 点数 | 里程(km) |
|------|------|------|------------|------------|-------------|------|----------|
| 沪昆高铁 (hukun) | before | **heavy** | 72 | 0 | 12.91 | 1969 | 2454.1 |
| | after clean | **light** | 3→0（再去短岔） | 0 | 12.91 | ~1765–1784 | ~2240–2258 |
| 兰新高铁 (lanxin) | before | **heavy** | 43 | 0 | 13.72 | 1342 | 1837.2 |
| | after | **light** | 0 | 0 | 13.72 | 1303 | 1780.8 |
| 厦深铁路 (xiashen) | before | **medium** | 23 | 0 | 10.09 | 437 | 535.3 |
| | after | **light** | 0 | 0 | 10.09 | 418 | 514.6 |
| 京沪高铁（对照） | — | light | 1 | 0 | 11.8 | 1015 | 1299.6 |
| 青藏铁路（对照） | — | ok/light | 0 | 0 | ~10 | ~2198 | ~1873 |

全库：`medium=0 heavy=0` → **PASS**。

沪昆虹桥进路后：起点应为 `stations-geo`「上海虹桥」，总点数约 +20。

## 实验结论

1. 清洗可去掉沪昆/兰新/厦深的 heavy·medium 尖刺。
2. 裸 hsr/OSM member-order 重抽会恶化，已回滚。
3. 目视仍须修：枢纽 U 形短岔（杭州东/南昌西/贵阳）、走廊起点不在虹桥。

## 复跑（与当前地图一致）

```bash
# 工作区 JSON 已是金标准时：直接开图，不要 restore

# 从清洗前备份重做：
node scripts/demo-corridor-rebuild.mjs --restore
node scripts/demo-corridor-rebuild.mjs
node scripts/verify-corridor-geometry.mjs
```
