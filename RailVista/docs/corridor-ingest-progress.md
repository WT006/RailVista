# 走廊入库进度（已入库 / 待入库）

> **维护入口：** 入库或暂缓后跑 `node scripts/gen-corridor-ingest-progress.mjs` 重生成本文。  
> 对照缺口全表：[`corridor-coverage-gap.md`](./corridor-coverage-gap.md) · 校准日志：[`corridor-calibration-log.md`](./corridor-calibration-log.md)  
> 更新日：2026-09-19

## 总览

| 项 | 数量 |
|---|---|
| 磁盘已有走廊 JSON | **187** |
| 文档待覆盖条目（gap CSV） | 164 |
| 其中已映射入库 | **109** |
| 仍待入库 | **0** |
| 暂缓 | **55** |

### 按优先级

| 优先级 | 已入库 | 待入库 | 暂缓 | 合计 |
|---|---|---|---|---|
| P0 | 62 | 0 | 9 | 71 |
| P1 | 30 | 0 | 33 | 63 |
| P2 | 15 | 0 | 9 | 24 |
| P3 | 2 | 0 | 4 | 6 |

### 状态说明

| 状态 | 含义 |
|---|---|
| 已入库 | `data/presets/corridors/{id}.json` 存在，且已映射到文档线路名 |
| 待入库 | 文档有、库中尚无对应走廊，且未标暂缓 |
| 暂缓 | 源空/OSM 不稳/需 PBF 普速图等，暂不硬抽 |

---

## 文档缺口进度（P0–P3）

| 状态 | 优先级 | 类型 | 线路 | 走廊 id | 备注 |
|---|---|---|---|---|---|
| 已入库 | P0 | 高速铁路 | 安九高铁 | `anjiu` | anjiu |
| 已入库 | P0 | 普速铁路 | 包兰线 | `baolan` | baolan |
| 已入库 | P1 | 普速铁路 | 滨绥线 | `binsui` | binsui |
| 已入库 | P0 | 普速铁路 | 滨洲线 | `binzhou` | binzhou |
| 已入库 | P0 | 高速铁路 | 昌赣高铁 | `changgan` | changgan |
| 已入库 | P0 | 高速铁路 | 昌九城际 | `changjiu` | changjiu |
| 已入库 | P0 | 高速铁路 | 常益长高铁 | `changyichang` | changyichang |
| 已入库 | P3 | 城际铁路 | 成灌铁路 | `chengguan` | chengguan |
| 已入库 | P1 | 城际铁路 | 成绵乐城际铁路 | `chengmianle` | chengmianle |
| 已入库 | P2 | 城际铁路 | 成雅铁路 | `chengya` | chengya |
| 已入库 | P1 | 普速铁路 | 川黔线 | `chuanqian` | chuanqian |
| 已入库 | P1 | 快速铁路 | 达成铁路 | `dacheng` | dacheng |
| 已入库 | P1 | 普速铁路 | 达万线 | `dawan` | dawan |
| 已入库 | P0 | 高速铁路 | 大张高铁 | `dazhang` | dazhang |
| 已入库 | P1 | 普速铁路 | 阜淮线 | `fuhuai` | fuhuai |
| 已入库 | P1 | 普速铁路 | 干武线 | `ganwu` | ganwu |
| 已入库 | P0 | 高速铁路 | 赣龙铁路 | `ganlong` | ganlong |
| 已入库 | P0 | 高速铁路 | 赣深高铁 | `ganshen` | ganshen |
| 已入库 | P2 | 城际铁路 | 广惠城际铁路 | `guanghui` | guanghui |
| 已入库 | P1 | 普速铁路 | 广茂线 | `guangmao` | guangmao |
| 已入库 | P2 | 城际铁路 | 广清城际铁路 | `guangqing` | guangqing |
| 已入库 | P1 | 城际铁路 | 广深城际铁路 | `guangshenchengji` | guangshenchengji |
| 已入库 | P0 | 高速铁路 | 广西沿海铁路 | `guangxiyanhai` | guangxiyanhai |
| 已入库 | P2 | 城际铁路 | 广肇城际铁路 | `guangzhao` | guangzhao |
| 已入库 | P2 | 城际铁路 | 广州东环城际铁路 | `guangzhoudonghuan` | guangzhoudonghuan |
| 已入库 | P1 | 城际铁路 | 广珠城际铁路 | `guangzhu` | guangzhu |
| 已入库 | P0 | 高速铁路 | 哈齐高铁 | `haqi` | haqi |
| 已入库 | P1 | 快速铁路 | 邯黄铁路 | `hanhuang` | hanhuang |
| 已入库 | P1 | 城际铁路 | 汉十高铁 | `hanshi` | hanshi |
| 已入库 | P0 | 高速铁路 | 汉宜铁路 | `hanyi` | hanyi |
| 已入库 | P0 | 高速铁路 | 杭甬高铁 | `hangyong` | hangyong |
| 已入库 | P0 | 高速铁路 | 合蚌高铁 | `hebang` | hebang |
| 已入库 | P2 | 城际铁路 | 合杭城际 | `shanghehang` | shanghehang |
| 已入库 | P0 | 高速铁路 | 合宁铁路 | `heining` | heining |
| 已入库 | P0 | 高速铁路 | 合武铁路 | `hewu` | hewu |
| 已入库 | P1 | 普速铁路 | 河茂线 | `hemao` | hemao |
| 已入库 | P1 | 普速铁路 | 侯西线 | `houxi` | houxi |
| 已入库 | P0 | 高速铁路 | 呼张高铁 | `zhanghu` | zhanghu |
| 已入库 | P0 | 高速铁路 | 呼准鄂铁路 | `huzhune` | huzhune |
| 已入库 | P0 | 普速铁路 | 沪昆线 | `hukunxian` | hukunxian |
| 已入库 | P0 | 高速铁路 | 沪宁城际 | `huning` | huning |
| 已入库 | P0 | 高速铁路 | 沪苏湖高铁 | `husuhu` | husuhu |
| 已入库 | P0 | 快速铁路 | 沪通铁路 | `hutong` | hutong |
| 已入库 | P0 | 高速铁路 | 济青高铁 | `jiqing` | jiqing |
| 已入库 | P1 | 普速铁路 | 嘉镜线 | `jiajing` | jiajing |
| 已入库 | P1 | 城际铁路 | 胶济客运专线 | `jiaojikezhuan` | jiaojikezhuan |
| 已入库 | P0 | 普速铁路 | 焦柳线 | `jiaoliu` | jiaoliu |
| 已入库 | P0 | 高速铁路 | 津秦高铁 | `jinqin` | jinqin |
| 已入库 | P0 | 普速铁路 | 京广线 | `jingguangxian` | jingguangxian |
| 已入库 | P0 | 普速铁路 | 京哈线 | `jinghaxian` | jinghaxian |
| 已入库 | P0 | 普速铁路 | 京沪线 | `jinghuxian` | jinghuxian |
| 已入库 | P0 | 高速铁路 | 京津城际 | `jingjin` | jingjin |
| 已入库 | P0 | 普速铁路 | 京九线 | `jingjiu` | jingjiu |
| 已入库 | P0 | 高速铁路 | 京沈高铁 | `jingshen` | jingshen |
| 已入库 | P2 | 城际铁路 | 京唐城际铁路 | `jingtang` | jingtang |
| 已入库 | P1 | 普速铁路 | 京通线 | `jingtong` | jingtong |
| 已入库 | P2 | 城际铁路 | 京雄城际铁路 | `jingxiong` | jingxiong |
| 已入库 | P1 | 普速铁路 | 京原线 | `jingyuan` | jingyuan |
| 已入库 | P1 | 普速铁路 | 拉滨线 | `labin` | labin |
| 已入库 | P0 | 快速铁路 | 兰青铁路 | `lanqing` | lanqing |
| 已入库 | P0 | 普速铁路 | 兰新线 | `lanxinxian` | lanxinxian |
| 已入库 | P1 | 普速铁路 | 蓝烟线 | `lanyan` | lanyan |
| 已入库 | P0 | 高速铁路 | 连镇高铁 | `lianzhen` | lianzhen |
| 已入库 | P0 | 高速铁路 | 龙厦铁路 | `longxia` | longxia |
| 已入库 | P2 | 城际铁路 | 龙漳铁路 | `longzhang` | longzhang |
| 已入库 | P0 | 普速铁路 | 陇海线 | `longhai` | longhai |
| 已入库 | P2 | 城际铁路 | 鲁南高铁 | `rilan` | rilan |
| 已入库 | P0 | 高速铁路 | 茂湛铁路 | `maozhan` | maozhan |
| 已入库 | P0 | 高速铁路 | 牡绥铁路 | `musui` | musui |
| 已入库 | P0 | 高速铁路 | 南广铁路 | `nanguang` | nanguang |
| 已入库 | P1 | 普速铁路 | 南昆线 | `nankunxian` | nankunxian |
| 已入库 | P1 | 城际铁路 | 宁安城际铁路 | `ningan` | ningan |
| 已入库 | P0 | 快速铁路 | 宁启铁路 | `ningqi` | ningqi |
| 已入库 | P0 | 普速铁路 | 宁西线 | `ningxi` | ningxi |
| 已入库 | P0 | 高速铁路 | 盘营高铁 | `panying` | panying |
| 已入库 | P0 | 高速铁路 | 黔张常铁路 | `qianzhangchang` | qianzhangchang |
| 已入库 | P0 | 高速铁路 | 秦沈客专 | `qinshen` | qinshen |
| 已入库 | P0 | 高速铁路 | 青连铁路 | `qinglian` | qinglian |
| 已入库 | P0 | 高速铁路 | 青盐铁路 | `qingyan` | qingyan |
| 已入库 | P0 | 高速铁路 | 深茂铁路 | `shenmao` | shenmao |
| 已入库 | P1 | 普速铁路 | 沈丹线 | `shendan` | shendan |
| 已入库 | P1 | 普速铁路 | 石德线 | `shide` | shide |
| 已入库 | P0 | 高速铁路 | 石济客专 | `shiji` | shiji |
| 已入库 | P0 | 高速铁路 | 石太客专 | `shitai` | shitai |
| 已入库 | P3 | 城际铁路 | 穗深城际铁路 | `suishen` | suishen |
| 已入库 | P0 | 高速铁路 | 太焦高铁 | `taijiao` | taijiao |
| 已入库 | P0 | 普速铁路 | 同蒲线 | `tongpu` | tongpu |
| 已入库 | P1 | 快速铁路 | 铜九铁路 | `tongjiu` | tongjiu |
| 已入库 | P2 | 城际铁路 | 潍莱高铁 | `weilai` | weilai |
| 已入库 | P0 | 高速铁路 | 潍烟高铁 | `weiyan` | weiyan |
| 已入库 | P0 | 高速铁路 | 温福铁路 | `wenfu` | wenfu |
| 已入库 | P2 | 城际铁路 | 武冈城际 | `wugang` | wugang |
| 已入库 | P2 | 城际铁路 | 武咸城际 | `wuxian` | wuxian |
| 已入库 | P2 | 城际铁路 | 武孝城际 | `wuxiao` | wuxiao |
| 已入库 | P1 | 普速铁路 | 西康线 | `xikang` | xikang |
| 已入库 | P0 | 快速铁路 | 湘桂铁路 | `xiangguikuoneng` | xiangguikuoneng |
| 已入库 | P0 | 高速铁路 | 湘桂铁路扩能 | `xiangguikuoneng` | xiangguikuoneng |
| 已入库 | P0 | 普速铁路 | 襄渝线 | `xiangyu` | xiangyu |
| 已入库 | P0 | 高速铁路 | 向莆铁路 | `xiangpu` | xiangpu |
| 已入库 | P1 | 普速铁路 | 阳安线 | `yangan` | yangan |
| 已入库 | P0 | 普速铁路 | 鹰厦线 | `yingxia` | yingxia |
| 已入库 | P0 | 高速铁路 | 甬台温铁路 | `yongtaiwen` | yongtaiwen |
| 已入库 | P0 | 快速铁路 | 渝怀铁路 | `yuhuai` | yuhuai |
| 已入库 | P0 | 高速铁路 | 渝万城际 | `yuwan` | yuwan |
| 已入库 | P1 | 普速铁路 | 漳泉肖线 | `zhangquan` | zhangquan |
| 已入库 | P1 | 城际铁路 | 长珲城际 | `changhui` | changhui |
| 已入库 | P2 | 城际铁路 | 郑机城际 | `zhengji` | zhengji |
| 已入库 | P0 | 高速铁路 | 郑焦城际 | `zhengjiao` | zhengjiao |
| 已入库 | P1 | 城际铁路 | 郑开城际 | `zhengkai` | zhengkai |
| 暂缓 | P0 | 高速铁路 | 包西铁路扩能 | — | D：hsr 空 |
| 暂缓 | P1 | 普速铁路 | 宝中线 | — | C：中段 snap 失败，待 OSM |
| 暂缓 | P1 | 快速铁路 | 北阿铁路 | — | C：geometry heavy/回退，待 OSM |
| 暂缓 | P1 | 普速铁路 | 北疆线 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P3 | 城际铁路 | 成蒲铁路 | — | D：hsr 无名（成雅含成蒲至朝阳湖） |
| 暂缓 | P1 | 普速铁路 | 成渝线 | — | C：命名 ways 枢纽 Dijkstra 不通，待 OSM |
| 暂缓 | P2 | 城际铁路 | 崇礼铁路 | — | D：本地 graph Dijkstra 不通 |
| 暂缓 | P2 | 城际铁路 | 川南城际铁路 | — | D：hsr 仅连接线 ~2km |
| 暂缓 | P1 | 普速铁路 | 敦煌线 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P1 | 快速铁路 | 额哈铁路 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P2 | 城际铁路 | 佛莞城际铁路 | — | D：hsr/graph 无名 |
| 暂缓 | P1 | 快速铁路 | 赣瑞龙铁路 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P3 | 城际铁路 | 广佛环线 | — | D：仅见西环碎片 |
| 暂缓 | P1 | 普速铁路 | 广梅汕线 | — | C：仅梅汕段可过门禁（meishan），全线待 OSM |
| 暂缓 | P0 | 高速铁路 | 广湛高铁 | — | D：待确认 |
| 暂缓 | P1 | 普速铁路 | 贵昆线 | — | C：graph 几乎无名，待 OSM |
| 暂缓 | P2 | 城际铁路 | 哈佳铁路 | — | D：hsr/graph 无名 |
| 暂缓 | P0 | 高速铁路 | 哈秦段 | — | D：与 jingha 重叠待切片策略 |
| 暂缓 | P1 | 普速铁路 | 汉丹线 | — | C：中段缝隙 >80km，禁 densify 飞线，待 OSM |
| 暂缓 | P0 | 高速铁路 | 杭衢高铁 | — | D：待确认 |
| 暂缓 | P1 | 快速铁路 | 衡柳铁路 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P1 | 普速铁路 | 淮南线 | — | C：不到真芜湖（保护锚），待 OSM |
| 暂缓 | P1 | 普速铁路 | 集二线 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P2 | 城际铁路 | 金建高铁 | — | D：本地 graph Dijkstra 不通 |
| 暂缓 | P3 | 城际铁路 | 津蓟城际铁路 | — | D：hsr/graph 无名 |
| 暂缓 | P2 | 城际铁路 | 京滨城际铁路 | — | D：hsr/graph 不完整，Dijkstra 不通 |
| 暂缓 | P1 | 快速铁路 | 奎北铁路 | — | C：中段 ways 不连通，待 OSM |
| 暂缓 | P1 | 普速铁路 | 来福线 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P1 | 普速铁路 | 黎湛线 | — | C：Dijkstra 不通，待 OSM |
| 暂缓 | P1 | 快速铁路 | 柳南城际 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P0 | 普速铁路 | 陇海—兰新线 | — | C：与陇海/兰新分建，不另建超长合并线 |
| 暂缓 | P1 | 普速铁路 | 漯宝线 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P2 | 城际铁路 | 牡佳高铁 | — | D：hsr/graph 无名 |
| 暂缓 | P1 | 普速铁路 | 牡图线 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P2 | 城际铁路 | 南龙铁路 | — | D：graph 拼出 medium（jump~16km） |
| 暂缓 | P1 | 普速铁路 | 内昆线 | — | C：graph 无名，待 OSM |
| 暂缓 | P0 | 快速铁路 | 宁蓉铁路 | — | C：graph 无名，待 OSM |
| 暂缓 | P1 | 普速铁路 | 宁芜线 | — | C：末段接芜湖后 medium，待 OSM 整线 |
| 暂缓 | P3 | 城际铁路 | 琶莲城际铁路 | — | D：graph 拼出 medium |
| 暂缓 | P0 | 高速铁路 | 盘兴高铁 | — | D：待确认 |
| 暂缓 | P1 | 普速铁路 | 平齐线 | — | C：命名 ways 不连通，待 OSM |
| 暂缓 | P1 | 快速铁路 | 黔桂铁路 | — | C：中段缝隙 >90km，待 OSM |
| 暂缓 | P1 | 快速铁路 | 遂渝铁路 | — | C：graph 无名，待 OSM |
| 暂缓 | P0 | 高速铁路 | 太中银铁路 | — | D：hsr 空 |
| 暂缓 | P1 | 普速铁路 | 通让线 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P0 | 普速铁路 | 同蒲—太焦—焦柳线 | — | C：组合线，同蒲已入库；太焦高铁另有 taijiao |
| 暂缓 | P1 | 普速铁路 | 皖赣线 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P1 | 普速铁路 | 武大线 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P1 | 快速铁路 | 武九客运专线 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P2 | 城际铁路 | 武石城际 | — | D：hsr/graph 无名 |
| 暂缓 | P1 | 普速铁路 | 西平线 | — | C：源断口 densify>20km 拒收，待 OSM |
| 暂缓 | P1 | 普速铁路 | 新长线 | — | C：需 china-rail PBF / 普速 OSM |
| 暂缓 | P1 | 普速铁路 | 宣杭线 | — | C：命名 ways 不连通，待 OSM |
| 暂缓 | P1 | 普速铁路 | 长图线 | — | C：中段缝隙大，待 OSM |
| 暂缓 | P1 | 普速铁路 | 枝柳线 | — | C：需 china-rail PBF / 普速 OSM |

---

## 库内全部走廊（187）

| id | 名称 | OD hints | 点数 | source |
|---|---|---|---|---|
| `anjiu` | 安九高铁 | 安庆西→九江 | 181 | osm |
| `baocheng` | 宝成铁路 | 宝鸡→成都 | 729 | osm |
| `baolan` | 包兰线 | 包头→兰州 | 395 | osm |
| `baoxi` | 包西线 | 包头→西安 | 155 | local-rail-graph-named |
| `binsui` | 滨绥线 | 哈尔滨→绥芬河 | 74 | local-rail-graph-named |
| `binzhou` | 滨洲线 | 哈尔滨→满洲里 | 279 | osm-bbox+local-legs |
| `changgan` | 昌赣高铁 | 南昌西→赣州西 | 244 | osm |
| `changhui` | 长珲城际铁路 | 长春→珲春 | 147 | local-hsr-graph-legs |
| `changjiu` | 昌九城际 | 南昌西→九江 | 156 | china-hsr-simulation/hsr-rails.geojson |
| `changyichang` | 常益长高铁 | 常德→长沙西 | 188 | china-hsr-simulation/hsr-rails.geojson |
| `chengguan` | 成灌铁路 | 成都→都江堰 | 37 | local-hsr-graph |
| `chenggui` | 成贵高铁 | 成都东→贵阳北 | 627 | osm+guiyangbei-end |
| `chengkun` | 成昆铁路 | 成都→昆明 | 1006 | osm |
| `chengmianle` | 成绵乐城际 | 江油→乐山 | 283 | slice:xicheng+chenggui |
| `chengya` | 成雅铁路 | 成都西→朝阳湖 | 62 | local-hsr-graph |
| `chengyu` | 成渝高铁 | 成都东→重庆北 | 132 | china-hsr-simulation/hsr-rails.geojson |
| `chihuang` | 池黄高铁 | 池州→黄山北 | 80 | china-hsr-simulation/hsr-rails.geojson |
| `chuanqian` | 川黔线 | 重庆→贵阳 | 107 | local-rail-graph-named |
| `chuanqing` | 川青铁路 | 成都东→黄胜关 | 282 | osm-bbox |
| `dacheng` | 达成铁路 | 达州→成都 | 66 | local-rail-graph-named |
| `dawan` | 达万线 | 达州→万州 | 23 | local-rail-graph-named |
| `daxi` | 大西高铁 | 大同南→西安北 | 783 | china-hsr-simulation/hsr-rails.geojson |
| `dazhang` | 大张高铁 | 大同南→张家口 | 80 | osm-bbox |
| `diandong` | 滇越铁路云南段 | 昆明北→河口 | 485 | osm |
| `dunbai` | 敦白高铁 | 敦化→长白山 | 129 | china-hsr-simulation/hsr-rails.geojson |
| `dunge` | 敦格铁路 | 敦煌→格尔木 | 389 | anchors |
| `fengsha` | 丰沙线 | 丰台→沙城 | 22 | local-rail-graph-named |
| `fuhuai` | 阜淮线 | 阜阳→淮南 | 26 | local-rail-graph-named |
| `fuping` | 福平铁路 | 福州→平潭 | 74 | osm |
| `fuxia` | 福厦高铁 | 福州南→厦门 | 293 | china-hsr-simulation/hsr-rails.geojson |
| `ganlong` | 赣龙铁路 | 赣州→龙岩 | 210 | osm |
| `ganshen` | 赣深高铁 | 赣州西→深圳北 | 317 | osm |
| `ganwu` | 干武线 | 干塘→武威 | 82 | local-rail-graph-named |
| `geku` | 格库铁路 | 格尔木→库尔勒 | 678 | anchors |
| `guanghui` | 广惠城际 | 广州东→惠州北 | 110 | local-hsr-graph |
| `guangmao` | 广茂线 | 广州→茂名 | 62 | local-rail-graph-named |
| `guangqing` | 广清城际 | 花都→清城 | 86 | china-hsr-simulation/hsr-rails.geojson |
| `guangshenchengji` | 广深城际铁路 | 广州东→深圳 | 40 | local-rail-graph-legs |
| `guangshengang` | 广深港高铁 | 广州南→香港西九龙 | 146 | china-hsr-simulation/hsr-rails.geojson |
| `guangxiyanhai` | 广西沿海铁路 | 南宁东→防城港北 | 75 | osm-bbox |
| `guangzhao` | 广肇城际 | 广州南→肇庆 | 177 | china-hsr-simulation/hsr-rails.geojson |
| `guangzhoudonghuan` | 广州东环城际 | 番禺→白云机场北 | 45 | local-hsr-graph |
| `guangzhu` | 广珠城际 | 广州南→珠海 | 179 | china-hsr-simulation/hsr-rails.geojson |
| `guiguang` | 贵广高铁 | 贵阳北→广州南 | 608 | china-hsr-simulation/hsr-rails.geojson |
| `guinan` | 贵南高铁 | 贵阳北→南宁东 | 298 | china-hsr-simulation/hsr-rails.geojson |
| `haida` | 沈大高铁 | 沈阳→大连 | 389 | china-hsr-simulation/hsr-rails.geojson |
| `hainandong` | 海南东环高铁 | 海口→三亚 | 257 | osm |
| `hainanxi` | 海南西环高铁 | 海口→三亚 | 213 | china-hsr-simulation/hsr-rails.geojson+ledong-br |
| `hamu` | 哈牡高铁 | 哈尔滨→牡丹江 | 227 | osm |
| `hanchang` | 邯长线 | 邯郸→长治 | 51 | local-rail-graph-named |
| `hangchang` | 杭昌高铁 | 杭州东→南昌西 | 564 | china-hsr-simulation/hsr-rails.geojson |
| `hanghuang` | 杭黄高铁 | 杭州东→黄山北 | 197 | station-chain-rebuild |
| `hangtai` | 杭台高铁 | 杭州东→温岭 | 212 | china-hsr-simulation/hsr-rails.geojson |
| `hangwen` | 杭温高铁 | 杭州西→温州南 | 175 | china-hsr-simulation/hsr-rails.geojson |
| `hangyong` | 杭甬高铁 | 杭州东→宁波 | 94 | local-hsr-graph |
| `hanhuang` | 邯黄铁路 | 邯郸→黄骅港 | 79 | local-rail-graph-named |
| `hanji` | 邯济线 | 邯郸→济南 | 45 | local-rail-graph-named |
| `hanshi` | 汉十高铁 | 汉口→十堰东 | 160 | local-hsr-via-station-chain |
| `hanyi` | 汉宜铁路 | 汉口→宜昌东 | 129 | osm-bbox |
| `haqi` | 哈齐高铁 | 哈尔滨西→齐齐哈尔 | 106 | osm |
| `hebang` | 合蚌高铁 | 合肥南→蚌埠南 | 125 | osm |
| `hefu` | 合福高铁 | 合肥南→福州南 | 531 | china-hsr-simulation/hsr-rails.geojson |
| `heining` | 合宁铁路 | 合肥南→南京南 | 84 | local-hsr-graph |
| `hemao` | 河茂线 | 河唇→茂名 | 38 | local-rail-graph-named |
| `heruo` | 和若铁路 | 和田→若羌 | 662 | osm |
| `hewu` | 合武铁路 | 合肥南→汉口 | 116 | local-hsr-graph |
| `houxi` | 侯西线 | 侯马→西安 | 70 | local-rail-graph-named |
| `huhang` | 沪杭高铁 | 上海虹桥→杭州东 | 236 | china-hsr-simulation/hsr-rails.geojson#slice-fro |
| `hukun` | 沪昆高铁 | 上海虹桥→昆明南 | 1805 | china-hsr-simulation/hsr-rails.geojson |
| `hukunxian` | 沪昆线 | 上海→昆明 | 363 | local-rail-graph-legs+osm-bbox |
| `huning` | 沪宁城际 | 上海→南京 | 379 | china-hsr-simulation/hsr-rails.geojson |
| `huningyanjiang` | 沪宁沿江高铁 | 太仓→南京南 | 252 | china-hsr-simulation/hsr-rails.geojson |
| `husuhu` | 沪苏湖高铁 | 上海虹桥→湖州 | 164 | china-hsr-simulation/hsr-rails.geojson |
| `hutong` | 沪通铁路 | 上海虹桥→南通西 | 91 | osm-bbox |
| `huzhune` | 呼准鄂铁路 | 呼和浩特东→鄂尔多斯 | 177 | osm-bbox |
| `jiajing` | 嘉镜线 | 嘉峪关→镜铁山 | 13 | local-rail-graph-named |
| `jiaojikezhuan` | 胶济客运专线 | 济南→青岛 | 82 | local-rail-graph |
| `jiaojixian` | 胶济线 | 青岛→济南 | 59 | local-rail-graph-named |
| `jiaoliu` | 焦柳线 | 焦作→柳州 | 326 | local-rail-graph-legs |
| `jiaoxin` | 胶新线 | 胶州→新沂 | 55 | local-rail-graph-named |
| `jingguang` | 京广高铁 | 北京西→广州南 | 1548 | china-hsr-simulation/hsr-rails.geojson |
| `jingguangxian` | 京广线 | 北京→广州白云 | 520 | local-rail-graph-legs |
| `jingha` | 京哈高铁 | 北京朝阳→哈尔滨西 | 790 | china-hsr-simulation/hsr-rails.geojson |
| `jinghaxian` | 京哈线 | 北京→哈尔滨 | 435 | osm |
| `jinghu` | 京沪高铁 | 北京南→上海虹桥 | 1022 | china-hsr-simulation/hsr-rails.geojson |
| `jinghuxian` | 京沪线 | 北京→上海 | 760 | osm |
| `jingjin` | 京津城际 | 北京南→塘沽 | 166 | china-hsr-simulation/hsr-rails.geojson |
| `jingjiu` | 京九线 | 北京西→深圳东 | 755 | local-rail-graph-legs |
| `jingshen` | 京沈高铁 | 北京朝阳→沈阳 | 400 | china-hsr-simulation/hsr-rails.geojson |
| `jingtang` | 京唐城际 | 北京城市副中心→唐山 | 145 | china-hsr-simulation/hsr-rails.geojson |
| `jingtong` | 京通线 | 北京→通辽 | 167 | local-rail-graph-named |
| `jingxiong` | 京雄城际 | 北京西→雄安 | 120 | china-hsr-simulation/hsr-rails.geojson |
| `jingyuan` | 京原线 | 北京→原平 | 114 | local-rail-graph-named |
| `jingzhang` | 京张高铁 | 北京北→张家口 | 110 | osm-bbox |
| `jinqin` | 津秦高铁 | 天津→秦皇岛 | 255 | china-hsr-simulation/hsr-rails.geojson |
| `jiqing` | 济青高铁 | 济南东→青岛 | 367 | china-hsr-simulation/hsr-rails.geojson |
| `jitong` | 集通铁路 | 集宁→通辽 | 776 | osm |
| `kunli` | 滇藏铁路大丽段 | 昆明→丽江 | 274 | anchors |
| `labin` | 拉滨线 | 哈尔滨→拉法 | 89 | local-rail-graph-named |
| `lalin` | 拉林铁路 | 拉萨→林芝 | 246 | osm+lari-approach |
| `lanqing` | 兰青铁路 | 河口南→西宁 | 51 | local-rail-graph-named |
| `lanxin` | 兰新高铁 | 兰州西→乌鲁木齐 | 1320 | osm |
| `lanxinxian` | 兰新线 | 兰州→乌鲁木齐 | 805 | local-rail-graph-named |
| `lanyan` | 蓝烟线 | 蓝村→烟台 | 64 | local-rail-graph-named |
| `lanyu` | 兰渝铁路 | 兰州→重庆北 | 426 | osm |
| `lari` | 拉日铁路 | 拉萨→日喀则 | 159 | osm |
| `lianzhen` | 连镇高铁 | 连云港→镇江南 | 354 | osm |
| `linha` | 临哈铁路 | 呼和浩特→额济纳 | 527 | osm-bbox |
| `lixiang` | 丽香铁路 | 丽江→香格里拉 | 83 | osm+anchors |
| `longhai` | 陇海线 | 连云港→兰州 | 434 | local-rail-graph-named |
| `longxia` | 龙厦铁路 | 龙岩→厦门北 | 108 | osm-bbox |
| `longzhang` | 龙漳铁路 | 龙岩→漳州 | 52 | local-hsr-graph |
| `maozhan` | 茂湛铁路 | 茂名→湛江西 | 42 | osm-bbox |
| `mawu` | 麻武线 | 麻城→武汉 | 23 | local-rail-graph-named |
| `meiji` | 梅集线 | 梅河口→集安 | 71 | local-rail-graph-named |
| `meishan` | 梅汕线 | 梅州→汕头 | 28 | local-rail-graph-named |
| `musui` | 牡绥铁路 | 牡丹江→绥芬河 | 117 | osm-bbox |
| `nanguang` | 南广铁路 | 南宁东→广州南 | 311 | osm |
| `nanjiang` | 南疆铁路 | 吐鲁番→喀什 | 1001 | osm |
| `nankun` | 南昆高铁 | 南宁东→昆明南 | 473 | china-hsr-simulation/hsr-rails.geojson |
| `nankunxian` | 南昆线 | 南宁→昆明 | 119 | local-rail-graph-named |
| `ningan` | 宁安城际 | 南京南→安庆 | 73 | osm-map-tiles |
| `ninghang` | 宁杭高铁 | 南京南→杭州东 | 269 | china-hsr-simulation/hsr-rails.geojson |
| `ningqi` | 宁启铁路 | 林场→南通 | 46 | local-rail-graph-named |
| `ningxi` | 宁西线 | 南京→西安 | 181 | local-rail-graph-named |
| `panying` | 盘营高铁 | 盘锦北→营口西 | 79 | china-hsr-simulation/hsr-rails.geojson |
| `qianzhangchang` | 黔张常铁路 | 黔江→常德 | 249 | osm-bbox |
| `qinglian` | 青连铁路 | 青岛→连云港 | 191 | osm-bbox |
| `qingrong` | 青荣城际 | 青岛→荣成 | 276 | china-hsr-simulation/hsr-rails.geojson |
| `qingyan` | 青盐铁路 | 青岛北→盐城 | 273 | osm-bbox+qinglian-stitch |
| `qingzang` | 青藏铁路 | 西宁→拉萨 | 2205 | osm |
| `qinshen` | 秦沈客专 | 秦皇岛→沈阳 | 232 | osm-bbox |
| `rilan` | 日兰高铁 | 日照西→兰考南 | 471 | china-hsr-simulation/hsr-rails.geojson |
| `shanghehang` | 商合杭高铁 | 阜阳西→杭州东 | 580 | china-hsr-simulation/hsr-rails.geojson |
| `shendan` | 沈丹线 | 沈阳→丹东 | 51 | local-rail-graph-named |
| `shenjia` | 沈佳高速线 | 敦化→长白山 | 110 | china-hsr-simulation/hsr-rails.geojson |
| `shenmao` | 深茂铁路 | 深圳坪山→茂名 | 300 | osm-bbox |
| `shide` | 石德线 | 石家庄→德州 | 58 | local-rail-graph-named |
| `shiji` | 石济客专 | 石家庄→济南东 | 189 | osm |
| `shitai` | 石太客专 | 石家庄→太原南 | 162 | osm |
| `shuibang` | 水蚌线 | 水家湖→蚌埠 | 22 | local-rail-graph-named |
| `suishen` | 穗深城际 | 新塘→深圳机场 | 54 | local-hsr-graph |
| `taijiao` | 太焦高铁 | 太原南→焦作西 | 325 | china-hsr-simulation/hsr-rails.geojson |
| `taijiao_conv` | 太焦线 | 太原→焦作 | 66 | local-rail-graph-named |
| `tongjiu` | 铜九铁路 | 铜陵→九江 | 46 | local-rail-graph-named |
| `tongpu` | 同蒲线 | 大同→风陵渡 | 181 | local-rail-graph-named |
| `weilai` | 潍莱高铁 | 潍坊北→莱西北 | 171 | china-hsr-simulation/hsr-rails.geojson |
| `weiyan` | 潍烟高铁 | 潍坊北→烟台 | 179 | local-hsr-graph |
| `wenfu` | 温福铁路 | 温州南→福州南 | 98 | osm |
| `wugang` | 武冈城际 | 武汉→黄冈东 | 31 | local-hsr-graph |
| `wujiu` | 武九线 | 武昌→九江 | 37 | local-rail-graph-named |
| `wuxian` | 武咸城际 | 武昌→咸宁南 | 23 | local-hsr-graph |
| `wuxiao` | 武孝城际 | 汉口→孝感东 | 36 | local-hsr-graph |
| `xiangguikuoneng` | 湘桂铁路扩能 | 衡阳东→南宁东 | 467 | osm-bbox |
| `xiangpu` | 向莆铁路 | 南昌西→福州南 | 329 | osm |
| `xiangqian` | 湘黔铁路 | 株洲→贵阳 | 431 | osm-bbox |
| `xiangyu` | 襄渝线 | 襄阳→重庆北 | 132 | local-rail-graph-named |
| `xiashen` | 厦深铁路 | 厦门北→深圳北 | 412 | osm |
| `xicheng` | 西成高铁 | 西安北→成都东 | 538 | china-hsr-simulation/hsr-rails.geojson |
| `xikang` | 西康线 | 西安→安康 | 36 | local-rail-graph-named |
| `xintai` | 辛泰线 | 辛店→泰安 | 28 | local-rail-graph-named |
| `xinyan` | 新兖线 | 新乡→兖州 | 68 | local-rail-graph-named |
| `xulan` | 徐兰高铁 | 徐州东→兰州西 | 1099 | china-hsr-simulation/hsr-rails.geojson |
| `xulian` | 徐连高铁 | 徐州东→连云港东 | 180 | china-hsr-simulation/hsr-rails.geojson |
| `yangan` | 阳安线 | 阳平关→安康 | 61 | local-rail-graph-named |
| `yanshi` | 兖石线 | 兖州→石臼所 | 53 | local-rail-graph-named |
| `yantong` | 盐通高铁 | 盐城→南通 | 201 | china-hsr-simulation/hsr-rails.geojson |
| `yayi` | 鸦宜线 | 鸦鹊岭→宜昌 | 11 | local-rail-graph-named |
| `yingxia` | 鹰厦线 | 鹰潭→厦门 | 137 | local-rail-graph-named |
| `yinlan` | 银兰高铁 | 银川→兰州西 | 295 | station-chain+yinlan-xulan-bridge |
| `yinxi` | 银西高铁 | 银川→西安北 | 521 | china-hsr-simulation/hsr-rails.geojson |
| `yiwan` | 宜万铁路 | 宜昌东→万州 | 177 | osm-bbox |
| `yongtaiwen` | 甬台温铁路 | 宁波→温州南 | 156 | osm |
| `yugui` | 渝贵铁路 | 重庆西→贵阳东 | 402 | osm+guiyangbei-end |
| `yuhuai` | 渝怀铁路 | 重庆北→怀化 | 127 | local-rail-graph-named |
| `yuli` | 渝利铁路 | 重庆北→利川 | 163 | osm-bbox |
| `yuwan` | 渝万城际 | 重庆北→万州北 | 192 | osm |
| `zhanghu` | 张呼高铁 | 张家口→呼和浩特东 | 158 | osm-bbox |
| `zhangjihuai` | 张吉怀高铁 | 张家界西→怀化南 | 191 | china-hsr-simulation/hsr-rails.geojson |
| `zhangquan` | 漳泉肖线 | 漳平→泉州 | 23 | local-rail-graph-named |
| `zhengfu` | 郑阜高铁 | 郑州东→阜阳西 | 344 | china-hsr-simulation/hsr-rails.geojson |
| `zhengji` | 郑机城际 | 郑州东→新郑机场 | 12 | local-hsr-graph |
| `zhengjiao` | 郑焦城际 | 郑州东→焦作 | 108 | china-hsr-simulation/hsr-rails.geojson |
| `zhengkai` | 郑开城际 | 郑州东→宋城路 | 62 | china-hsr-simulation/hsr-rails.geojson |
| `zhengtai` | 郑太高铁 | 郑州东→太原南 | 462 | china-hsr-simulation/hsr-rails.geojson |
| `zhengyu` | 郑渝高铁 | 郑州东→重庆北 | 873 | china-hsr-simulation/hsr-rails.geojson |
| `zhonglao` | 中老铁路国内段 | 昆明南→磨憨 | 242 | osm-bbox |

---

## 维护约定

1. 新线过 `verify --strict`（或仅旧债失败）并写入 `corridors/` 后，把文档名→id 补进 `scripts/gen-corridor-ingest-progress.mjs` 的 `NAME_TO_ID`（若自动匹配不到）。
2. 明确暂缓的写入 `DEFER`。
3. 重跑本脚本；必要时同步改 `corridor-coverage-gap.md` 进度摘要。
