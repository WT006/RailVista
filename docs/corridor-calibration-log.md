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

详见 `docs/TECH-rail-geometry-quality.md` §5.2。

---

## P0 高铁补网（2026-09-17）

| 项 | 动作 |
|----|------|
| A 批脚本 | `scripts/build-phase-p0-hsr.mjs`（extract → clean） |
| A 已入库 | `jingjin` `huning` `husuhu` `jiqing` `changyichang` `changjiu` `panying` `jinqin` |
| B 批脚本 | `scripts/build-phase-p0-osm.mjs`（OSM relation + Dijkstra OD） |
| B 已入库 | `shitai` `shiji` `hebang` `nanguang` `yuwan` `yongtaiwen` `lianzhen` `haqi` |
| OD/断口 | shiji→济南东 Overpass 桥；lianzhen 北端显式 densify ~45km；其余 densify-jumps / commit-clean |
| 验证 | 本批 16 条新线站距/几何过门禁；全库 `--strict` 仍被旧债 `lalin` medium + `yugui` OD 拖红 |
| 分类暂缓 | C 普速需 PBF；D 见 `corridor-coverage-gap.md` P0 进度 |
| **运行时坑 #23** | OSM 名「铁路/客专」未进 `isHsrCorridor` → G/D 跳过走廊、站间直线+「偏离铁路较远」。已修：`客专` 正则 + `KNOWN_HSR_CORRIDOR_IDS`。本批受害：`yongtaiwen` `shiji` `shitai` `nanguang`；顺带白名单 `xiangpu` `ganlong`。连镇截图经停走徐连+京沪则是**车次路由**问题，非本坑 |

自动补丁日志（节选）：

| 时间 | id | 动作 | 说明 |
|------|-----|------|------|
| 2026-09-17 09:59 | changjiu | od-approach | 南昌西进路 |
| 2026-09-17 10:00 | husuhu | od-approach-clean | 虹桥+湖州，clean 后 ok |
| 2026-09-17 10:00 | jinqin | od-approach-clean | 天津+秦皇岛，clean 后 light |
| 2026-09-17 | jiqing | Qingdao approach | 胶州北侧→青岛显式桥 ~15.7km + 青荣贴站；`patch-jiqing-qingdao-approach.mjs` |

| 2026-09-17 10:58:08 | shitai | od-approach | start light 1.53km; end +7pts 2.8km→太原南 mode=bbox-all |
| 2026-09-17 10:58:12 | hebang | od-approach-reject | medium->medium bt 0->16; start +47pts 31.4km→合肥南 mode=single-gap-bridge gap=4.2; end light 3.38km |
| 2026-09-17 10:58:51 | hebang | densify-jumps | jump 21.5→5.7 +4pts medium→ok |
| 2026-09-17 10:58:51 | jingjin | densify-jumps | jump 8.1→6.4 +1pts ok→ok |
| 2026-09-17 10:58:51 | panying | densify-jumps | jump 8.2→7.7 +1pts ok→ok |
| 2026-09-17 10:58:51 | shiji | densify-jumps | jump 25.5→7.0 +15pts medium→ok |
| 2026-09-17 10:58:52 | hebang | od-approach-clean | ok->ok bt 0->0; start +47pts 31.4km→合肥南 mode=single-gap-bridge gap=4.2; end light 3.38km |
| 2026-09-17 11:36:23 | yuwan | od-approach | start +6pts 12.3km→重庆北 mode=single-gap-bridge gap=9.7; end ok 0.06km |
| 2026-09-17 11:36:31 | nanguang | densify-jumps | jump 38.6→7.9 +17pts medium→ok |
| 2026-09-17 11:36:31 | yongtaiwen | densify-jumps | jump 19.5→7.4 +4pts medium→ok |
| 2026-09-17 11:47:13 | lianzhen | od-approach | start FAIL 44.7km off-graph s=0.1 t=22.2; end +99pts 78.7km→镇江南 mode=single-gap-bridge gap=19.1 |
| 2026-09-17 11:47:15 | haqi | densify-jumps | jump 57.2→7.8 +23pts heavy→ok |
| 2026-09-17 11:50:48 | lianzhen | od-approach | start FAIL 44.7km off-graph s=0.1 t=22.2; end +99pts 78.7km→镇江南 mode=single-gap-bridge gap=19.1 |
| 2026-09-17 12:35:38 | xiangpu | od-approach | start +14pts 6.0km→南昌西 mode=bbox-all; end +10pts 17.4km→福州南 mode=single-gap-bridge gap=13.5 |
| 2026-09-17 12:37:01 | ganshen | od-approach | start light 0.86km; end +11pts 5.9km→深圳北 mode=bbox-bridge1.5 |
| 2026-09-17 12:37:02 | anjiu | od-approach | start FAIL 14.3km off-graph s=14.2 t=0.0; end +45pts 30.9km→九江 mode=bbox-bridge2.5 |
| 2026-09-17 12:37:02 | changgan | od-approach-reject | heavy->heavy bt 0->0; start +11pts 5.4km→南昌西 mode=bbox-all; end light 0.86km |
| 2026-09-17 12:37:02 | ganlong | od-approach | start +20pts 17.5km→赣州 mode=single-gap-bridge gap=7.5; end light 1.67km |
| 2026-09-17 12:40:40 | changgan | od-approach | start +44pts 29.2km→南昌西 mode=single-gap-bridge gap=4.7; end light 0.86km |
| 2026-09-17 14:07:24 | qingyan | od-approach | start +45pts 23.9km→青岛北 mode=bbox-bridge2.5; end ok 0.02km |
| 2026-09-17 14:52:48 | huzhune | densify-jumps | jump 10.2→7.7 +3pts light→ok |
| 2026-09-18 11:20:46 | binzhou | densify-jumps | jump 96.6→7.9 +85pts heavy→ok |
| 2026-09-18 11:21:01 | baolan | densify-jumps | jump 13.1→7.8 +20pts light→ok |
| 2026-09-18 11:21:02 | jinghaxian | densify-jumps | jump 14.8→8.0 +22pts light→ok |
| 2026-09-18 11:21:55 | jingguangxian | densify-jumps | jump 14.5→7.9 +120pts light→ok |
| 2026-09-18 11:21:55 | jinghuxian | densify-jumps | jump 13.3→7.6 +20pts light→ok |
| 2026-09-18 11:38:27 | jiaoliu | densify-jumps | jump 13.0→7.8 +46pts light→ok |
| 2026-09-18 11:39:06 | jingguangxian | densify-jumps | jump 14.5→7.9 +125pts light→ok |
| 2026-09-18 12:27:05 | binzhou | densify-jumps | jump 14.5→7.7 +17pts light→ok |
| 2026-09-18 13:27:41 | changhui | od-approach-reject | light->medium bt 0->24; start +21pts 11.0km→长春 mode=named; end light 2.46km |
| 2026-09-19 05:27:03 | hutong | od-approach-dry | start WOULD +path 22.2km→上海 (was 22.3); end WOULD +path 38.2km→南通 (was 24.1) |
| 2026-09-19 05:38:20 | hutong | densify-jumps | jump 23.2→6.2 +7pts medium→ok |
| 2026-09-19 05:38:20 | ningan | densify-jumps | jump 126.1→5.9 +32pts heavy→ok |
| 2026-09-19 05:56:16 | guangzhao | od-approach | start +65pts 31.9km→广州南 mode=bbox-bridge1; end light 1.29km |
| 2026-09-19 05:56:21 | jingbin | od-approach-reject | ok->medium bt 0->14; start FAIL 74.0km gap-bridge 72.9>50; end +57pts 68.1km→滨海西 mode=single-gap-bridge gap=34.4 |
| 2026-09-19 05:56:23 | weilai | od-approach | start +18pts 9.2km→潍坊北 mode=bbox-bridge1; end +10pts 5.9km→莱西北 mode=bbox-all |
| 2026-09-19 05:56:24 | wugang | od-approach-reject | ok->heavy bt 0->49; start +14pts 30.0km→武汉 mode=single-gap-bridge gap=22.8; end +28pts 16.6km→黄冈东 mode=bbox-bridge2.5 |
| 2026-09-19 05:56:26 | wuxiao | od-approach-reject | ok->heavy bt 0->50; start light 2.26km; end +29pts 19.7km→孝感东 mode=bbox-bridge1 |
| 2026-09-19 05:56:27 | zhengji | od-approach-reject | light->medium bt 0->30; start light 0.58km; end +18pts 11.1km→新郑机场 mode=bbox-bridge1 |
| 2026-09-19 05:56:33 | guangzhoudonghuan | od-approach-reject | ok->medium bt 0->16; start ok 0.00km; end +86pts 64.0km→番禺 mode=single-gap-bridge gap=22.7 |
| 2026-09-19 05:57:05 | wuxiao | od-approach | start light 1.09km; end +12pts 10.3km→孝感东 mode=bbox-bridge2.5 |
| 2026-09-19 05:57:10 | suishen | od-approach-reject | medium->medium bt 10->10; start FAIL 6.2km off-graph s=13.9 t=15.6; end +9pts 7.3km→深圳机场 mode=named |
| 2026-09-19 05:57:19 | suishen | od-approach | start ok 0.00km; end +9pts 7.3km→深圳机场 mode=named |
| 2026-09-19 06:00:32 | guanghui | od-approach | skip missing-geo 广州东/惠州北 |
| 2026-09-19 06:01:57 | jingxiong | densify-jumps | jump 8.6→5.1 +1pts ok→ok |
| 2026-09-19 06:01:57 | wuxian | densify-jumps | jump 11.1→6.6 +1pts light→ok |
| 2026-09-19 06:01:57 | zhengji | densify-jumps | jump 13.2→5.5 +2pts light→ok |
| 2026-09-19 06:08:13 | weiyan | od-approach | start light 0.54km; end +2pts 0.5km→烟台 mode=bbox-all |
| 2026-09-19 06:08:14 | hangyong | densify-jumps | jump 15.9→7.4 +5pts medium→ok |
| 2026-09-19 06:08:15 | heining | densify-jumps | jump 9.0→7.0 +2pts ok→ok |
| 2026-09-19 06:08:17 | hewu | densify-jumps | jump 16.9→6.7 +9pts medium→ok |
| 2026-09-19 06:08:53 | lanxinxian | od-approach-reject | heavy->heavy bt 60->73; start +25pts 12.5km→兰州 mode=bbox-all; end light 1.44km |
| 2026-09-19 06:12:40 | yingxia | od-approach-reject | heavy->heavy bt 57->60; start light 1.48km; end +12pts 6.4km→厦门 mode=bbox-all |
| 2026-09-19 06:13:13 | lanqing | densify-jumps | jump 10.6→5.3 +1pts light→ok |
| 2026-09-19 06:19:55 | lanxinxian | od-approach | start +25pts 12.5km→兰州 mode=bbox-all; end light 1.44km |
| 2026-09-19 06:31:08 | yuhuai | od-approach | start +3pts 10.2km→重庆北 mode=single-gap-bridge gap=9.7; end ok 0.00km |
| 2026-09-19 06:34:10 | shide | od-approach | start +10pts 6.5km→石家庄 mode=bbox-all; end ok 0.47km |
| 2026-09-19 06:34:14 | jingyuan | od-approach | start +38pts 25.2km→北京 mode=bbox-bridge1.5; end +7pts 12.2km→原平 mode=single-gap-bridge gap=8.3 |
| 2026-09-19 06:34:18 | xuanhang | od-approach-reject | medium->medium bt 26->26; start +14pts 10.1km→宣城 mode=bbox-bridge2.5; end +30pts 13.0km→杭州 mode=bbox-all |
| 2026-09-19 06:37:31 | ningwu | od-approach-reject | ok->medium bt 1->17; start ok 0.37km; end +11pts 5.9km→芜湖 mode=bbox-all |
| 2026-09-19 07:13:26 | ningwu | od-approach-reject | medium->medium bt 11->27; start ok 0.37km; end +11pts 5.9km→芜湖 mode=bbox-all |
| 2026-09-19 14:04:39 | handan | od-approach | skip missing-geo 汉口/丹江口 |
| 2026-09-19 14:07:24 | handan | od-approach | skip missing-geo 汉口/丹江口 |
| 2026-09-19 14:18:09 | handan | od-approach | skip missing-geo 汉口/丹江口 |
| 2026-09-19 14:40:18 | xuanhang | od-approach | start +14pts 10.1km→宣城 mode=bbox-bridge2.5; end +30pts 13.0km→杭州 mode=bbox-all |
| 2026-09-19 14:41:46 | qiangui | od-approach-reject | heavy->heavy bt 42->38; start +8pts 36.1km→贵阳 mode=single-gap-bridge gap=34.1; end ok 0.08km |
| 2026-09-19 15:19:21 | suiyu | densify-jumps | jump 9.1→6.9 +1pts ok→ok |
| 2026-09-19 15:19:22 | neikun | od-approach | start +4pts 6.6km→内江 mode=single-gap-bridge gap=4.1; end light 1.02km |
| 2026-09-19 15:19:32 | guikun | od-approach | start +3pts 0.2km→贵阳 mode=bbox-all; end ok 0.12km |
| 2026-09-20 01:57:32 | baozhong | od-approach | start FAIL 12.9km off-graph s=4.7 t=11.1; end +18pts 21.0km→中卫 mode=single-gap-bridge gap=10.1 |
| 2026-09-20 02:00:25 | wangang | od-approach-reject | heavy->heavy bt 36->38; start +17pts 9.9km→芜湖 mode=bbox-all; end light 0.73km |
| 2026-09-20 02:02:32 | wangang | od-approach | start +17pts 9.9km→芜湖 mode=bbox-all; end ok 0.00km |
| 2026-09-20 02:46:36 | luobao | densify-jumps | jump 22.7→5.7 +10pts medium→ok |
| 2026-09-20 02:47:16 | luobao | densify-jumps | jump 22.7→5.7 +8pts medium→ok |
| 2026-09-20 02:50:03 | ningqi | densify-jumps | jump 21.8→5.6 +43pts medium→ok |
| 2026-09-20 02:54:44 | wushi | densify-jumps | jump 20.3→5.3 +13pts medium→ok |
| 2026-09-20 02:54:44 | wushi | od-approach | skip missing-geo 武昌/黄石 |
| 2026-09-20 02:55:44 | wushi | densify-jumps | jump 19.8→5.3 +12pts medium→ok |
| 2026-09-20 02:55:44 | wushi | od-approach | skip missing-geo 武昌/黄石 |

## DEFER 清零（2026-09-20）

| id | 说明 |
|----|------|
| `guangzhan` | OSM r17137172；`--strict` PASS |
| `jingbin` | 已开通宝坻南→北辰（r11898040）；北辰→滨海西在建 |
| `fowan` | OSM r9161560 广州南→麻涌；`--strict` PASS |
| `guangfohuan` | 南环开通段 番禺→北滘西；西环在建未接佛山西 |
| 陇海—兰新 / 同蒲—太焦—焦柳 | 组合名映射 `longhai` / `tongpu`（分干线已入库） |

进度：`gapDone=164 pending=0 defer=0`（`gen-corridor-ingest-progress.mjs`）

## 校准债分批（2026-09-20）

计划全文：[`corridor-calibration-plan.md`](./corridor-calibration-plan.md)

| 批次 | 结果 |
|---|---|
| A | 安图西/大石头南/长白山→wiki；`changhui`/`dunbai` PASS；seedFail 2→0 |
| B | hangchang hints→杭黄昌；yinxi 撤平凉/灵武北；肇庆东/三水南 wiki；anjiu 撤池州+OD；yinlan 暂撤灵武北/河东机场 |
| C | 襄阳东/丹江口 wiki；建德 hanghuang-stitch（hangqu/jinjian）；太谷西/临海/泉州/南京南/林芝/青岛等 |
| D | baozhong/dunhuang OD slice；jitong 化德→通辽（集宁端未贴合）；jinghuxian 撤济南；qingrong→青岛北、qinglian→日照西、jiaojikezhuan→潍坊；jiqing 青岛进路；hangqu 撤衢州+densify |
| E | `jingjiu` `clean --write`→light；jinjian densify |

**门禁收尾：** `node scripts/verify-corridor-geometry.mjs --strict` → **PASS**  
`ok=185 light=56 medium=0 heavy=0 stationFail=0 seedFail=0`

### F 批 light 收敛（2026-09-20）

| 动作 | 说明 |
|---|---|
| densify jump-only | `densify-corridor-jumps --write` + 手工 densify jump>8（changtu/hukunxian/…） |
| soft clean | 热点/高尖刺：baolan/xulan→ok；jingjiu/yuhuai/… 降 sharp |
| **坑** | `--aggressive` 把 light 挖成 heavy（大跳 30–300km）；已在 `clean-corridors` 增加 jump/tier 恶化拒绝 |
| 恢复 | `fill-corridor-local-gaps` 补 guangmeishan/neikun/taizhongyin/wuda；jier densify；guangmeishan 撤梅州西 hint |
| 结果 | light **56→48**，ok **185→193**；`--strict` 仍 PASS |

后续：剩余 ~48 条多为 sharp=1～2 真弯/双线锯齿，不宜再 aggressive；站距 2–5km 可按客运热点继续 wiki 精校。

### F2 / G 收尾（2026-09-20）

| 动作 | 说明 |
|---|---|
| soft clean 全 light | + spike140 安全尖刺；light **48→28**，ok **193→213** |
| hints | 武汉→武昌、长兴→长兴南、烟台→烟台南、咸阳北→咸阳西、杭州→杭州西；撤错挂中间站 |
| 成渝 | densify→重庆西；拒用重庆北顶替 |
| 郑太 | 太谷西属大西，hints 改太谷东；太谷西挂回 daxi |
| 集二 | OSM r1108769 Dijkstra 重抽 集宁南→二连 |
| G | guangzhan 广州白云 densify 进路（~4.3→0） |
| 余债 | light=28（真弯）；nanguang 肇庆东 wiki 距正线~9km（<12） |

**验收：** `--strict` PASS · `ok=213 light=28 medium=0 stationFail=0 seedFail=0`

### 锁边实测回归（2026-09-20 晚）

截图：`5801` 乌→阿、`D6983` 哈→齐南、`G7461` 连云港→苍南 — 站间直线 +「偏离铁路较远」。

| 根因 | 修复 |
|---|---|
| 运行中 `apps/api/dist` **过旧**：非 G/D/C 直接 `matchCorridor→null`，普速全退站间弦 | `npm run build`；源码已按 conventional/hsr 分流 |
| `G7461` 路网经停桥接 `上海虹桥→宁波`（≤280km）跳过沪杭 | `corridorNetwork`：禁止跨「孤儿中间站」桥接；`MAX_HOPS` 5→8 |
| 缓存 | `railseg`/`rail` → **v9** |
| 站 | `双河市` 投影北疆线；`haqi` densify→齐齐哈尔南 |

匹配冒烟（源码）：
- `5801` → `beijiang`
- `D6983`（哈尔滨）→ `haqi`
- `G7461` → `lianzhen→jinghu→huhang→hangyong→yongtaiwen→wenfu`

**须重启 API**（`npm run dev` / 重启 `node dist`）后再锁边验证。
| 2026-09-20 05:33:07 | beijiang | densify-jumps | jump 8.9→7.9 +1pts ok→ok |
| 2026-09-20 05:33:07 | guangzhan | densify-jumps | jump 8.2→7.5 +1pts ok→ok |
| 2026-09-20 05:33:07 | hajia | densify-jumps | jump 9.0→7.8 +2pts ok→ok |
| 2026-09-20 05:33:07 | linha | densify-jumps | jump 12.0→8.0 +16pts light→ok |
| 2026-09-20 05:33:07 | ningan | densify-jumps | jump 9.0→5.9 +1pts ok→ok |
| 2026-09-20 05:33:07 | pingqi | densify-jumps | jump 8.8→7.8 +1pts ok→ok |
| 2026-09-20 09:24:31 | jier | densify-jumps | jump 10.4→7.7 +1pts light→ok |
| 2026-09-20 09:24:31 | ningrong | densify-jumps | jump 9.1→7.9 +3pts ok→ok |
| 2026-09-20 09:43:28 | stations-geo | audit-fix | 许昌北 193.9km; 鄢陵南 150.2km; 扶沟南 103.9km; 西华 47.9km; 项城 52.9km; 沈丘北 88.6km; 界首南 141.2km; 临泉 181.0km; 棋子湾 45.7km; 金月湾 67.3km; 银滩 6.1km; 山阴南 1226.3km; 玉山南 165.0km; 海阳 454.2km; 鹤壁 122.6km; 宣威北 303.5km |
| 2026-09-20 | stations-geo | audit-pipeline | 新增 `audit-stations-geo.mjs`（进度倒挂/软飞点/锚点/方位对）；郑阜反序 seed 整段纠正；海南西环棋子湾/金月湾；山阴南/玉山南/海阳/鹤壁飞点；zhengfu hints 项城→淮阳南；hainanxi/jitong 站序；xiangqian hints 对齐客专（新化南/溆浦南）；区域锚点扩写 |
| 2026-09-20 09:58:47 | stations-geo | soft-leftover-fix | 新乡南/新余北/宜昌北 wiki |
