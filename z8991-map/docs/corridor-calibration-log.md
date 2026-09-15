# 走廊校准日志

按 `docs/rail-geometry-quality-playbook.md` / TECH 一期执行。只记做过的线。

门禁：`node scripts/verify-corridor-geometry.mjs` / `--strict` → 应 PASS

---

## 已处理（一期）

| 项 | 动作 |
|----|------|
| 全库清洗 / OD 进路 / 断口桥 / 飞点 | 见前期批次（hukun…lalin 等） |
| heruo / lanyu / lalin / dunge__leg6 | 若羌坐标、重庆进路、拉萨进路、退役占位腿 |
| shenjia | 补 `stationsHint=[敦化,长白山]` + OD snap |
| maxJump>8 | `densify-corridor-jumps.mjs` 显式加密 + note（禁静默 fillJumps） |
| stations-geo 飞点 | scrub / 强制投影（川青、湘黔、渝利等） |
| verify | 增加 stationsHint 投影门禁；`--strict` 含站距 |
| clean | 默认关闭 `fillJumps`（需 `--fill-jumps`） |

脚本：`patch-corridor-od-approaches.mjs` · `densify-corridor-jumps.mjs` · `scrub-corridor-station-flyers.mjs` · `build-corridor-from-osm-bbox.mjs`

---

## 一期验收

```bash
node scripts/verify-corridor-geometry.mjs
node scripts/verify-corridor-geometry.mjs --strict
```

预期：`ok=全部`、`light/medium/heavy=0`、`stationFail=0` → PASS。

（2026-09-14 收尾后：safe spike 清除后 light 亦清零。）

---

## 二期（务实落地 · 2026-09-14）

| 项 | 动作 |
|----|------|
| soft-fail | `segmentsOk===0` → `partial/station`，可重试 |
| 本地分轨 | `china-hsr.graph` / `china-rail.graph`；`RAIL_OVERPASS=0` 可关 OSM |
| 建图 | `node scripts/build-rail-graph.mjs`（`--pbf` 可选） |
| 匹配 | G/D/C↔高铁走廊；K/T/Z↔普速走廊（Z164→qingzang；K599 拒 jingguang） |
| 热门 cache | `trainCode+站序指纹` → `data/cache/precise/` |
| 渝贵终点 | `贵阳东`≈`贵阳北`：末端贴合放行 + hints；避免 OSM 锯齿首段 |

详见 `docs/TECH-rail-geometry-quality.md` §5.2、`docs/demo-phase2-precise-ux.html`。
