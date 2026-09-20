# 走廊 / 站坐标校准计划（入库后质量债）

> **背景：** 文档缺口已清零（`gapDone=164 / pending=0 / defer=0`）。全库 `verify --strict` 仍有质量债，本文件为分批校准路线图。  
> **对照：** [playbook](./rail-geometry-quality-playbook.md) · [踩坑](./corridor-ingest-lessons.md) · [硬约束](../.cursor/rules/rail-route-invariants.mdc) · [校准日志](./corridor-calibration-log.md)  
> **基线日：** 2026-09-20 · 门禁命令：`node scripts/verify-corridor-geometry.mjs --strict`

## 0. 基线快照

| 项 | 数量 |
|---|---|
| 磁盘走廊 | 243 |
| `ok` / `light` | 180 / 59 |
| `medium`（几何） | **2**（`changhui` · `jingjiu`） |
| `stationFail` | **33** |
| `seedFail` | **2**（大石头南 · 安图西 → `dunbai`） |

**原则（不可破）：**

1. 站序只认时刻表，禁止按 lat/lng 重排。
2. 蓝线「绕站 / V 尖刺」→ **先查 stations-geo**，再查走廊几何。
3. `corridor:{id}` seed 只能钉宿主；跨走廊错钉优先 scrub。
4. `source:wiki` 禁止被重建脚本静默覆盖。
5. 过不了 `--strict` 的改动不得当正式修复；真断口 bridge+note，禁静默 fillJumps。
6. 高铁走廊勿给 K/T/Z；方位冲突站（安阳 vs 安阳东）不算贴合。

**单线流水线：**

```bash
# 诊断
node scripts/verify-corridor-geometry.mjs --strict --id {id}

# 常见修复（按需，勿裸重抽）
node scripts/clean-corridors.mjs --write --id {id}
node scripts/patch-corridor-od-approaches.mjs --write --id {id}
# 站飞点：对照 wiki/OSM → 改 stations-geo + 区域锚点；必要时 scrub
# 真断口：显式 densify/bridge + note

node scripts/verify-corridor-geometry.mjs --strict --id {id}   # 必须 PASS
```

---

## 1. 分批路线（按危害排序）

### 批次 A — 跨走廊错钉 / seedFail（优先）

| id / 站 | 现象 | 假设根因 | 动作 |
|---|---|---|---|
| `changhui` + 安图西 | midFar 安图西 ~58 km；seed→`dunbai` | 长珲站被钉到敦白 | scrub 安图西→`changhui`/`wiki`；清 dunbai hints |
| `dunbai` + 大石头南 | seed-off-host 18.5 km | 敦白错挂长珲站 | 大石头南改钉 changhui；dunbai 只留敦白站 |
| `changhui` geom | medium sharp=8 | 可能被错站牵出折返 | 站修完再 clean |

**验收：** `seedFail=0`；`changhui`/`dunbai` midFar 无安图西/大石头南。

### 批次 B — midFar ≥ 50 km（严重飞点或错廊）

| id | worst（基线） | 优先查 |
|---|---|---|
| `hangchang` | 上饶 117 · 衢州 86 · 鹰潭北 63 · 金华 55 · 义乌 42 | 走廊是否只含杭长段、站是否钉到沪昆/其它廊 |
| `yinxi` | 平凉 75 · 吴忠 61 · 灵武 22 | hints 是否混入银兰/包兰站；银西几何是否缺段 |
| `nanguang` | 肇庆东 68 · 三水南 27 | 站飞点 vs 南广未走肇庆东 |
| `guangzhao` | 肇庆东 65 · 佛山西 6.7 | 同区；广肇切片/hints |
| `anjiu` | 池州 53 | 池州是否不该在 anjiu hints；或站飞点 |

**验收：** 上述线 midFar>12 = 0；OD&lt;5。

### 批次 C — 已知枢纽错钉 / 改名旧站

| id | 站 | 备注 |
|---|---|---|
| `hanshi` | 襄阳东 ~23 · 丹江口东 ~12 | 襄阳东=东津（郑渝∩武西），禁钉郑渝北段；保留 wiki |
| `jingha` | 沈阳北 ~27 | 查 seed / 京哈高铁 vs 普速 |
| `jingtang` | 宝坻南 ~15 | 与京滨共线站；对照刚修的宝坻南坐标 |
| `rilan` | 曲阜东 ~28 | 鲁南 vs 站坐标 |
| `qingyan` | 连云港 ~33 | 方位：连云港 vs 连云港东 |
| `zhengtai` | 太谷西 ~16 | 郑太中间站 |
| `yongtaiwen` | 临海 ~16 | |
| `hanghuang` | 建德 ~15 | 对照千岛湖飞点先例 |
| `hangwen` | 义乌 ~20 | 与 hangchang 义乌一并查 |
| `fuxia` | 泉州 ~19 | |
| `wuxian` | 武昌 ~12 | |

### 批次 D — OD 端脱节（&gt;5 km，虹桥级目标 &lt;0.5）

| id | od（基线） | 动作倾向 |
|---|---|---|
| `fuping` | 42 / 0 | 起点进路 patch 或切 OD |
| `jitong` | 33 / 0.1 | 集宁端 |
| `jiaojixian` | 29 / 0.8 | 青岛端 |
| `ganlong` | 21 / 2.1 | |
| `baocheng` | 17 / 0 | 宝鸡端 |
| `wujiu` | 11.9 / 0.8 | |
| `ningan` | 9.3 / 0.1 | 南京南 |
| `dunge` | 9.2 / 0 | 敦煌 |
| `yugui` | 1.6 / **8.4** | 贵阳北末端 |
| `lalin` | 0 / **8.7** | 林芝 |
| `dunbai` / `shenjia` | 0 / **7.1** | 长白山 |
| `yingxia` | 1.5 / **7.1** | 厦门 |

优先：`patch-corridor-od-approaches` → 失败则 via-legs / 显式 bridge+note。

### 批次 E — 几何 medium（尖刺 / 折返）

| id | 现象 | 动作 |
|---|---|---|
| `changhui` | sharp=8 | 批次 A 站修后 `clean --write` |
| `jingjiu` | sharp=6 bt=21 jump=7.9 · 2386 km | 分段 clean；忌全局猛删弯；必要时 densify+note |

### 批次 F — light 债（后置）

59 条 `light`：多数站距 2–5 km 或轻微尖刺。在 A–E 清零后再按「客运热点走廊」抽扫，不阻塞门禁绿。

### 批次 G — 本批入库尾巴（开通后再动）

| id | 状态 |
|---|---|
| `jingbin` | 仅宝坻南→北辰；北辰→滨海西开通后延长 |
| `guangfohuan` | 仅南环番禺→北滘西；西环开通后接佛山西 |
| `guangzhan` | 北端距广州白云 ~4 km；白云引入完善后 patch |

建设中/规划中 33 条：不开通不入库（见 `corridor-coverage-gap.md`）。

---

## 2. 批次执行节奏

| 顺序 | 批次 | 目标 |
|---|---|---|
| 1 | **A** | seedFail→0；长珲/敦白错钉消失 |
| 2 | **B** | midFar≥50 清零 |
| 3 | **C** | 枢纽错钉 / 改名站 |
| 4 | **D** | OD&gt;5 → &lt;5（枢纽力争 &lt;0.5） |
| 5 | **E** | medium→0 |
| 6 | **F** | light 可选收敛 |
| — | **G** | 等开通 |

每批结束更新：

1. 本文件「进度」表  
2. `docs/corridor-calibration-log.md` 追加行  
3. 复跑 `node scripts/verify-corridor-geometry.mjs --strict`，记录 SUMMARY

---

## 3. 进度

| 批次 | 状态 | 更新日期 | 备注 |
|---|---|---|---|
| A 错钉/seed | **完成** | 2026-09-20 | 安图西/大石头南/长白山→wiki；changhui PASS；seedFail 2→0 |
| B midFar≥50 | **完成** | 2026-09-20 | hangchang hints 改杭黄昌；yinxi 撤平凉/灵武北；肇庆东/三水南 wiki；anjiu 撤池州+OD slice |
| C 枢纽错钉 | **完成** | 2026-09-20 | 襄阳东/丹江口、宝坻、曲阜东、沈阳北、建德 stitch、太谷西/临海/泉州/南京南等 |
| D OD 脱节 | **完成** | 2026-09-20 | baozhong/dunhuang OD slice；jitong 化德→通辽；青岛系改钉青岛北/日照西或 jiqing 官方进路；hangqu 撤衢州+densify |
| E geom medium | **完成** | 2026-09-20 | `jingjiu` clean→light；hangqu/jinjian densify |
| F light | **完成（务实）** | 2026-09-20 | 48→**28**；站距>5 仅余肇庆东~9km（枢纽偏置）；禁 aggressive |
| G 开通尾巴 | **部分** | 2026-09-20 | guangzhan 白云 densify 进路；jingbin/guangfohuan 仍等开通 |

**门禁进度（相对基线）：**

| 指标 | 基线 | 当前（2026-09-20 F2） |
|---|---|---|
| seedFail | 2 | **0** |
| stationFail | 33 | **0** |
| medium | 2 | **0** |
| heavy | 0 | 0 |
| light | 59 | **28** |
| `--strict` | FAIL | **PASS**（ok=213 light=28） |

**门禁目标：** `medium=0 heavy=0 stationFail=0 seedFail=0` → 全库 `--strict` PASS。✅ 已达成。

**F 剩余 28 条 light：** 均为 sharp=1～4 真弯/双线锯齿，soft clean 已饱和；再 aggressive 会挖断（已踩坑）。接受为几何噪声，不阻塞门禁。

**G 未开通：** `jingbin` 北辰→滨海西；`guangfohuan` 西环→佛山西。

---

## 4. 站坐标持续审计（2026-09-20 起）

门禁 `verify --strict` 过了仍可能有「同廊错公里 / 同名飞点」。用：

```bash
node scripts/audit-stations-geo.mjs --min-severity soft
node scripts/audit-stations-geo.mjs --fetch          # Overpass 对照 hard 嫌疑
node scripts/patch-stations-geo-from-audit.mjs --write  # 已核对批次写入
```

本轮已修：郑阜反序 seed、海南西环、飞点站、新乡南/新余北/宜昌北等；审计 hard=0，soft 仅肇庆东枢纽偏置（可接受）。