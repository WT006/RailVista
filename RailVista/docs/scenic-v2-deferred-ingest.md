# V2 景点暂缓入库清单（待补走廊 / 待核真）

> 日期：2026-09-18  
> 来源：《铁路沿线景点全国审查与补充清单_V2_20260918》必补候选中，本轮**未入库**条目  
> 已入库：+38 新点、精化 3 条（库总量 414，见 `data/presets/scenic-spots.json`）  
> 规范：`docs/scenic-spots-spec.md` §3.3、`docs/scenic-spots-location-verify.md`（**地图钉 = 本体真值，不准不入库**）

---

## 0. 下次入库门禁（照抄）

1. 具名点：Nominatim / Wikidata 真值 + 区域框，拒异地命中  
2. 跨海 / 桥隧 `on_track`：种子或真值距对应走廊 **≤ ~5 km** 才允许吸附轨面；否则只钉核真坐标、勿 snap  
3. 缺走廊：可先钉准坐标，但须在表中注明「匹配待走廊」；或等走廊入库后再收  
4. 改 `scripts/build-scenic-spots-curated.mjs` 后执行 `node scripts/build-scenic-spots-curated.mjs`  
5. 禁止把 V2「约」坐标未经第二源校验直接写入

---

## 1. 暂缓明细

| 建议 id | 名称 | V2 种子坐标 (WGS84) | 建议 visibility | 阻塞原因 | 解锁条件 | 备注 |
|---|---|---|---|---|---|---|
| `taolaizhao-songhua-bridges` | 陶赖昭松花江双桥 | 126.250, 44.950 | window | 距 `jinghaxian` ~14 km，snap 会偏钉 | 补全京哈普速陶赖昭跨江段几何；或拿到桥位 OSM 节点后钉本体 | 查询：`陶赖昭 松花江大桥` |
| `jiaozhou-bay-rail-bridge` | 跨胶州湾铁路桥 | 120.320, 36.190 | on_track | 库内无过湾精确轨；Nominatim 无铁路桥命中 | 补青岛北—红岛跨湾轨到 `qingrong`/`jiqing` 等；影像校中跨点 | 公路胶州湾大桥勿误用 |
| `penglai-coast` | 蓬莱滨海段 | 120.780, 37.780 | window | 潍烟走廊未入库；距青荣 ~63 km | 入库潍烟高铁走廊后再靠轨取点 | 可先核「蓬莱站」真值 |
| `yangbajing-duilong-triple` | 羊八井—堆龙峡谷三线并行 | 90.880, 29.870 | on_track | 种子距 `qingzang` ~13.5 km | 精化青藏羊八井—堆龙段折线后 ≤5 km 再 snap | V2 专项①核验点 |
| `baili-wind-zone-tunnel` | 百里风区地上隧道段 | 92.400, 42.180 | on_track | 种子距兰新 ~97 km，坐标不可信 | 用开通报道/OSM 防风明洞中心重钉后再验 | 勿用当前种子 |
| `shandan-machang-rail` | 山丹马场站段 | 101.080, 38.095 | window | 站名检索无命中；距兰新 ~9.8 km 边缘 | Nominatim/官方站坐标命中 + 靠轨 | 季节性雪山草原 |
| `shandan-ming-great-wall` | 汉明长城遗迹（山丹段） | 100.500, 38.800 | window | 无可靠同名真值（长城遗迹易错配） | OSM `historic=citywalls` 山丹段节点 + 距轨校验 | 禁止钉车站 |
| `alashankou-gateway` | 阿拉山口口岸国门 | 82.580, 45.165 | window | 国门检索无近邻真值 | 核国门/界碑 WGS84；北疆走廊覆盖后再验距轨 | 可先只收「口岸方向」distant |
| `ebihu-south-shore` | 艾比湖南岸段 | 82.550, 44.860 | window | 北疆走廊未覆盖；曾误吸附 `nanjiang` 已否决 | 入库精河—阿拉山口走廊；湖岸靠轨取点 | 湖体真值可再查 Wikidata |
| `wuerhe-devil-city` | 乌尔禾魔鬼城 | 85.681, 46.060（V2）；Nominatim ~85.761, 46.114 | distant | 奎北线未入库，无法校验车窗走行 | 入库奎北/`kuibei` 走廊；`maxDistKm` 约 15–20 | 真值大致可用，缺走行校验 |
| `karamay-oil-pumpjacks` | 克拉玛依油田磕头机群 | 84.890, 45.560 | window | 检索真值漂移到错误区域 | 人工影像在奎北克拉玛依段两侧重钉 | 勿用错误命中 |
| `taizicheng-ice-town` | 太子城冰雪小镇 | 115.285, 40.955 | window | Nominatim 命中偏离走廊 ~41 km | 用太子城站/小镇官方坐标复核 | 崇礼支线几何可能不足 |
| `danjiangkou-reservoir-bridge` | 丹江口水库特大桥段 | 111.550, 32.450 | on_track | 汉十走廊未覆盖该库段（种子距现有线很远） | 补 `hanyi` 丹江口库区桥段几何 | |
| `yanjin-one-line-city` | 盐津一线城市 | 104.085, 28.105 | window | 内昆走廊未入库 | 入库内昆/`neikun` 后再验 | 与豆沙关同线，豆沙关坐标已入库 |
| `mengdingshan-tea` | 蒙顶山茶园 | 103.063, 30.062 | window | 成雅走廊未覆盖 | 入库成雅线；Nominatim「蒙顶山」 | |
| `ziyang-hanjiang` | 紫阳汉江 | 108.535, 32.518 | on_track | 襄渝走廊未覆盖紫阳段 | 入库襄渝紫阳站桥段；站建于桥上 | |
| `badaling-wall-guangou` | 八达岭长城墙体（关沟车窗） | 116.024, 40.359 | window | 与已有 `badaling-great-wall` 近邻重复 | 若需区分 S2 地面墙体 vs 站域，改名/合并 intro 即可，不必新建 | 已有点 116.005, 40.360 |

---

## 2. 按阻塞类型归类（方便排期）

### 2.1 先补走廊再收（优先）

| 走廊缺口 | 相关暂缓点 |
|---|---|
| 京哈普速陶赖昭跨江段 | 陶赖昭松花江双桥 |
| 青岛北—红岛跨胶州湾轨 | 跨胶州湾铁路桥 |
| 潍烟高铁 | 蓬莱滨海段 |
| 北疆（精河—阿拉山口） | 艾比湖南岸、阿拉山口国门 |
| 奎北铁路 | 乌尔禾魔鬼城、克拉玛依磕头机 |
| 汉十丹江口库区桥 | 丹江口水库特大桥段 |
| 内昆铁路 | 盐津一线城市（豆沙关已收） |
| 成雅铁路 | 蒙顶山茶园 |
| 襄渝紫阳段 | 紫阳汉江 |
| 京张崇礼支线精化 | 太子城冰雪小镇 |

### 2.2 先核真坐标再收（走廊或已有）

| 点 | 动作 |
|---|---|
| 百里风区地上隧道 | 废弃 V2 种子；查防风明洞中心 |
| 山丹马场站段 / 汉明长城山丹段 | 站坐标 / OSM 长城节点 |
| 羊八井—堆龙三线并行 | 精化青藏折线或人工钉并行段中点 |
| 克拉玛依磕头机 | 人工影像重钉，禁错配真值 |

### 2.3 产品决策（可不新建）

- **八达岭关沟墙体**：与 `badaling-great-wall` 合并文案即可  

---

## 3. 建议入库草稿字段（复制用）

解锁后按此骨架写入 `build-scenic-spots-curated.mjs`（坐标须替换为核真值）：

```js
spot({
  id: 'taolaizhao-songhua-bridges',
  name: '陶赖昭松花江双桥',
  lng: /* 核真 */,
  lat: /* 核真 */,
  visibility: 'window',
  category: 'engineering',
  maxDistKm: 8,
  intro: '扶余陶赖昭镇北，京哈线与中东铁路老桥并列跨松花江，高铁紧邻并行，两桥同框百年对照。',
}),
```

其余名称 / intro 可参考《铁路沿线景点全国审查与补充清单_V2_20260918》正文。

---

## 4. 相关路径

| 路径 | 说明 |
|---|---|
| `docs/scenic-v2-deferred-ingest.md` | 本文（暂缓清单唯一入口） |
| `scripts/build-scenic-spots-curated.mjs` | 策展源；解锁后改这里再重生 |
| `data/presets/scenic-spots.json` | 当前全局风景库（414） |
| `docs/scenic-spots-location-verify.md` | 坐标门禁 |
