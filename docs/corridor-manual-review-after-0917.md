# 人工审查清单：9 月 17 日之后补充入库的走廊

> 范围：相对提交 `26ba665`（2026-09-19）父提交 `0f4436a`（`0f4436a21c25339711b78c1453cfe727d413f4c4`）**新增**的走廊，以及该提交之后工作区**尚未提交**的新增走廊 JSON。
>
> 说明：9/17 当日补网但直至 9/19 才随 `26ba665` 进库的线，一并列入（按「git 提交在 17 号之后」）。
>
> **不含：** 父提交时已存在的精品/风景走廊；不含 `__leg` 分段文件。
>
> **起终点：** 取自各文件 `stationsHint` 首末站（审查时请对照时刻表 / wiki 真 OD）。
>
> 生成日：2026-09-20 · 门禁：`node scripts/verify-corridor-geometry.mjs --strict --id {id}`

## 总览

| 项 | 数量 |
|---|---|
| 父提交已有走廊 | 66 |
| 提交 26ba665 新增 | 121 |
| 提交后工作区新增（未进 git） | 54 |
| **合计待审查** | **175** |

## 审查表（起终点）

| # | id | 线路名 | 起点站 | 终点站 | hints | 折线点 | 批次 |
|---|---|---|---|---|---|---|---|
| 1 | `anjiu` | 安九高铁 | **安庆西** | **九江** | 2 | 179 | 26ba665 |
| 2 | `baolan` | 包兰线 | **包头** | **兰州** | 3 | 394 | 26ba665 |
| 3 | `baoxi` | 包西线 | **包头** | **西安** | 2 | 155 | 26ba665 |
| 4 | `baozhong` | 宝中线 | **宝鸡** | **中卫** | 3 | 664 | 工作区未提交 |
| 5 | `beia` | 北阿铁路 | **北屯市** | **阿勒泰** | 2 | 29 | 工作区未提交 |
| 6 | `beijiang` | 北疆线 | **乌鲁木齐** | **阿拉山口** | 5 | 285 | 工作区未提交 |
| 7 | `binsui` | 滨绥线 | **哈尔滨** | **绥芬河** | 2 | 74 | 26ba665 |
| 8 | `binzhou` | 滨洲线 | **哈尔滨** | **满洲里** | 6 | 270 | 26ba665 |
| 9 | `changgan` | 昌赣高铁 | **南昌西** | **赣州西** | 6 | 227 | 26ba665 |
| 10 | `changhui` | 长珲城际铁路 | **长春** | **珲春** | 8 | 131 | 26ba665 |
| 11 | `changjiu` | 昌九城际 | **南昌西** | **九江** | 2 | 156 | 26ba665 |
| 12 | `changtu` | 长图线 | **长春** | **图们** | 4 | 438 | 工作区未提交 |
| 13 | `changyichang` | 常益长高铁 | **常德** | **长沙西** | 2 | 188 | 26ba665 |
| 14 | `chengguan` | 成灌铁路 | **成都** | **都江堰** | 2 | 37 | 26ba665 |
| 15 | `chengmianle` | 成绵乐城际 | **江油** | **乐山** | 8 | 283 | 26ba665 |
| 16 | `chengya` | 成雅铁路 | **成都西** | **朝阳湖** | 2 | 60 | 26ba665 |
| 17 | `chengyuxian` | 成渝线 | **成都** | **重庆** | 9 | 760 | 工作区未提交 |
| 18 | `chongli` | 崇礼铁路 | **太子城** | **崇礼** | 2 | 15 | 工作区未提交 |
| 19 | `chuannan` | 川南城际铁路 | **宜宾** | **内江** | 2 | 96 | 工作区未提交 |
| 20 | `chuanqian` | 川黔线 | **重庆** | **贵阳** | 2 | 107 | 26ba665 |
| 21 | `dacheng` | 达成铁路 | **达州** | **成都** | 2 | 66 | 26ba665 |
| 22 | `dawan` | 达万线 | **达州** | **万州** | 2 | 23 | 26ba665 |
| 23 | `dazhang` | 大张高铁 | **大同南** | **张家口** | 4 | 80 | 26ba665 |
| 24 | `dunhuang` | 敦煌线 | **敦煌** | **瓜州** | 2 | 98 | 工作区未提交 |
| 25 | `eha` | 额哈铁路 | **额济纳** | **哈密东** | 2 | 308 | 工作区未提交 |
| 26 | `fengsha` | 丰沙线 | **丰台** | **沙城** | 2 | 22 | 26ba665 |
| 27 | `fowan` | 佛莞城际 | **广州南** | **麻涌** | 3 | 48 | 工作区未提交 |
| 28 | `fuhuai` | 阜淮线 | **阜阳** | **淮南** | 2 | 26 | 26ba665 |
| 29 | `ganlong` | 赣龙铁路 | **赣州** | **龙岩** | 6 | 191 | 26ba665 |
| 30 | `ganruilong` | 赣瑞龙铁路 | **赣州** | **龙岩** | 3 | 47 | 工作区未提交 |
| 31 | `ganshen` | 赣深高铁 | **赣州西** | **深圳北** | 9 | 317 | 26ba665 |
| 32 | `ganwu` | 干武线 | **干塘** | **武威** | 2 | 82 | 26ba665 |
| 33 | `guangfohuan` | 广佛环线 | **番禺** | **北滘西** | 3 | 21 | 工作区未提交 |
| 34 | `guanghui` | 广惠城际 | **广州东** | **惠州北** | 2 | 110 | 26ba665 |
| 35 | `guangmao` | 广茂线 | **广州** | **茂名** | 2 | 57 | 26ba665 |
| 36 | `guangmeishan` | 广梅汕线 | **广州** | **汕头** | 5 | 231 | 工作区未提交 |
| 37 | `guangqing` | 广清城际 | **花都** | **清城** | 4 | 86 | 26ba665 |
| 38 | `guangshenchengji` | 广深城际铁路 | **广州东** | **深圳** | 5 | 40 | 26ba665 |
| 39 | `guangxiyanhai` | 广西沿海铁路 | **南宁东** | **防城港北** | 3 | 75 | 26ba665 |
| 40 | `guangzhan` | 广湛高铁 | **广州白云** | **湛江北** | 8 | 348 | 工作区未提交 |
| 41 | `guangzhao` | 广肇城际 | **广州南** | **肇庆** | 6 | 176 | 26ba665 |
| 42 | `guangzhoudonghuan` | 广州东环城际 | **番禺** | **白云机场北** | 2 | 45 | 26ba665 |
| 43 | `guangzhu` | 广珠城际 | **广州南** | **珠海** | 2 | 179 | 26ba665 |
| 44 | `guikun` | 贵昆线 | **贵阳** | **昆明** | 5 | 103 | 工作区未提交 |
| 45 | `hajia` | 哈佳铁路 | **哈尔滨** | **佳木斯** | 5 | 199 | 工作区未提交 |
| 46 | `hanchang` | 邯长线 | **邯郸** | **长治** | 2 | 51 | 26ba665 |
| 47 | `handan` | 汉丹线 | **汉口** | **谷城** | 6 | 275 | 工作区未提交 |
| 48 | `hangqu` | 杭衢高铁 | **建德** | **江山** | 2 | 43 | 工作区未提交 |
| 49 | `hangyong` | 杭甬高铁 | **杭州东** | **宁波** | 2 | 94 | 26ba665 |
| 50 | `hanhuang` | 邯黄铁路 | **邯郸** | **黄骅港** | 2 | 79 | 26ba665 |
| 51 | `hanji` | 邯济线 | **邯郸** | **济南** | 2 | 45 | 26ba665 |
| 52 | `hanshi` | 汉十高铁 | **汉口** | **十堰东** | 9 | 156 | 26ba665 |
| 53 | `hanyi` | 汉宜铁路 | **汉口** | **宜昌东** | 3 | 129 | 26ba665 |
| 54 | `haqi` | 哈齐高铁 | **哈尔滨西** | **齐齐哈尔** | 9 | 106 | 26ba665 |
| 55 | `haqin` | 哈秦段 | **哈尔滨西** | **秦皇岛** | 3 | 604 | 工作区未提交 |
| 56 | `hebang` | 合蚌高铁 | **合肥南** | **蚌埠南** | 4 | 125 | 26ba665 |
| 57 | `heining` | 合宁铁路 | **合肥南** | **南京南** | 2 | 84 | 26ba665 |
| 58 | `hemao` | 河茂线 | **河唇** | **茂名** | 2 | 38 | 26ba665 |
| 59 | `hengliu` | 衡柳铁路 | **衡阳东** | **柳州** | 3 | 121 | 工作区未提交 |
| 60 | `hewu` | 合武铁路 | **合肥南** | **汉口** | 2 | 116 | 26ba665 |
| 61 | `houxi` | 侯西线 | **侯马** | **西安** | 2 | 57 | 26ba665 |
| 62 | `houyue` | 侯月线 | **侯马** | **月山** | 2 | 224 | 工作区未提交 |
| 63 | `huainan` | 淮南线 | **淮南** | **芜湖** | 3 | 229 | 工作区未提交 |
| 64 | `hukunxian` | 沪昆线 | **上海** | **昆明** | 5 | 444 | 26ba665 |
| 65 | `huning` | 沪宁城际 | **上海** | **南京** | 2 | 379 | 26ba665 |
| 66 | `husuhu` | 沪苏湖高铁 | **上海虹桥** | **湖州** | 2 | 164 | 26ba665 |
| 67 | `hutong` | 沪通铁路 | **上海虹桥** | **南通西** | 6 | 91 | 26ba665 |
| 68 | `huzhune` | 呼准鄂铁路 | **呼和浩特东** | **鄂尔多斯** | 3 | 177 | 26ba665 |
| 69 | `jiajing` | 嘉镜线 | **嘉峪关** | **镜铁山** | 2 | 13 | 26ba665 |
| 70 | `jiaojikezhuan` | 胶济客运专线 | **济南** | **潍坊** | 3 | 52 | 26ba665 |
| 71 | `jiaojixian` | 胶济线 | **青岛** | **济南** | 2 | 60 | 26ba665 |
| 72 | `jiaoliu` | 焦柳线 | **焦作** | **柳州** | 2 | 324 | 26ba665 |
| 73 | `jiaoxin` | 胶新线 | **胶州** | **新沂** | 2 | 55 | 26ba665 |
| 74 | `jier` | 集二线 | **集宁南** | **二连浩特** | 2 | 371 | 工作区未提交 |
| 75 | `jingbin` | 京滨城际 | **宝坻南** | **北辰** | 2 | 60 | 工作区未提交 |
| 76 | `jingguangxian` | 京广线 | **北京** | **广州白云** | 5 | 520 | 26ba665 |
| 77 | `jinghaxian` | 京哈线 | **北京** | **哈尔滨** | 3 | 435 | 26ba665 |
| 78 | `jinghuxian` | 京沪线 | **北京** | **上海** | 4 | 761 | 26ba665 |
| 79 | `jingjin` | 京津城际 | **北京南** | **塘沽** | 2 | 166 | 26ba665 |
| 80 | `jingjiu` | 京九线 | **北京西** | **深圳东** | 11 | 705 | 26ba665 |
| 81 | `jingshen` | 京沈高铁 | **北京朝阳** | **沈阳** | 5 | 400 | 26ba665 |
| 82 | `jingtang` | 京唐城际 | **北京城市副中心** | **唐山** | 8 | 145 | 26ba665 |
| 83 | `jingtong` | 京通线 | **北京** | **通辽** | 2 | 167 | 26ba665 |
| 84 | `jingxiong` | 京雄城际 | **北京西** | **雄安** | 6 | 120 | 26ba665 |
| 85 | `jingyuan` | 京原线 | **北京** | **原平** | 2 | 114 | 26ba665 |
| 86 | `jinji` | 津蓟城际铁路 | **天津** | **蓟州** | 2 | 27 | 工作区未提交 |
| 87 | `jinjian` | 金建高铁 | **金华** | **建德** | 2 | 30 | 工作区未提交 |
| 88 | `jinqin` | 津秦高铁 | **天津** | **秦皇岛** | 2 | 255 | 26ba665 |
| 89 | `jiqing` | 济青高铁 | **济南东** | **青岛** | 10 | 362 | 26ba665 |
| 90 | `kuibei` | 奎北铁路 | **奎屯** | **北屯市** | 2 | 357 | 工作区未提交 |
| 91 | `labin` | 拉滨线 | **哈尔滨** | **拉法** | 2 | 89 | 26ba665 |
| 92 | `laifu` | 来福线 | **来舟** | **福州** | 2 | 68 | 工作区未提交 |
| 93 | `lanqing` | 兰青铁路 | **河口南** | **西宁** | 2 | 51 | 26ba665 |
| 94 | `lanxinxian` | 兰新线 | **兰州** | **乌鲁木齐** | 2 | 805 | 26ba665 |
| 95 | `lanyan` | 蓝烟线 | **蓝村** | **烟台** | 2 | 64 | 26ba665 |
| 96 | `lianzhen` | 连镇高铁 | **连云港** | **镇江南** | 11 | 354 | 26ba665 |
| 97 | `liunan` | 柳南城际 | **柳州** | **南宁东** | 2 | 112 | 工作区未提交 |
| 98 | `lizhan` | 黎湛线 | **黎塘** | **湛江** | 3 | 376 | 工作区未提交 |
| 99 | `longhai` | 陇海线 | **连云港** | **兰州** | 2 | 434 | 26ba665 |
| 100 | `longxia` | 龙厦铁路 | **龙岩** | **厦门北** | 5 | 101 | 26ba665 |
| 101 | `longzhang` | 龙漳铁路 | **龙岩** | **漳州** | 2 | 52 | 26ba665 |
| 102 | `luobao` | 漯宝线 | **漯河西** | **宝丰** | 2 | 46 | 工作区未提交 |
| 103 | `maozhan` | 茂湛铁路 | **茂名** | **湛江西** | 3 | 42 | 26ba665 |
| 104 | `mawu` | 麻武线 | **麻城** | **武汉** | 2 | 23 | 26ba665 |
| 105 | `meiji` | 梅集线 | **梅河口** | **集安** | 2 | 71 | 26ba665 |
| 106 | `meishan` | 梅汕线 | **梅州西** | **汕头** | 2 | 141 | 26ba665 |
| 107 | `mujia` | 牡佳高铁 | **牡丹江** | **佳木斯** | 2 | 397 | 工作区未提交 |
| 108 | `musui` | 牡绥铁路 | **牡丹江** | **绥芬河** | 3 | 117 | 26ba665 |
| 109 | `mutu` | 牡图线 | **牡丹江** | **图们** | 2 | 132 | 工作区未提交 |
| 110 | `nanguang` | 南广铁路 | **南宁东** | **广州南** | 9 | 311 | 26ba665 |
| 111 | `nankunxian` | 南昆线 | **南宁** | **昆明** | 2 | 119 | 26ba665 |
| 112 | `nanlong` | 南龙铁路 | **南平市** | **龙岩** | 2 | 51 | 工作区未提交 |
| 113 | `neikun` | 内昆线 | **内江** | **六盘水** | 5 | 149 | 工作区未提交 |
| 114 | `ningan` | 宁安城际 | **南京南** | **安庆** | 4 | 75 | 26ba665 |
| 115 | `ningqi` | 宁启铁路 | **林场** | **启东** | 4 | 90 | 26ba665 |
| 116 | `ningrong` | 宁蓉铁路 | **南京南** | **成都东** | 8 | 698 | 工作区未提交 |
| 117 | `ningwu` | 宁芜线 | **南京** | **芜湖** | 3 | 134 | 工作区未提交 |
| 118 | `ningxi` | 宁西线 | **南京** | **西安** | 2 | 176 | 26ba665 |
| 119 | `palian` | 琶莲城际铁路 | **琶洲** | **莲花山** | 2 | 28 | 工作区未提交 |
| 120 | `panxing` | 盘兴高铁 | **盘州** | **兴义** | 2 | 14 | 工作区未提交 |
| 121 | `panying` | 盘营高铁 | **盘锦北** | **营口西** | 2 | 79 | 26ba665 |
| 122 | `pingqi` | 平齐线 | **四平** | **齐齐哈尔** | 3 | 433 | 工作区未提交 |
| 123 | `qiangui` | 黔桂铁路 | **贵阳** | **柳州** | 4 | 262 | 工作区未提交 |
| 124 | `qianzhangchang` | 黔张常铁路 | **黔江** | **常德** | 3 | 249 | 26ba665 |
| 125 | `qinglian` | 青连铁路 | **日照西** | **连云港** | 2 | 119 | 26ba665 |
| 126 | `qingyan` | 青盐铁路 | **青岛北** | **盐城** | 4 | 271 | 26ba665 |
| 127 | `qinshen` | 秦沈客专 | **秦皇岛** | **沈阳** | 4 | 219 | 26ba665 |
| 128 | `shendan` | 沈丹线 | **沈阳** | **丹东** | 2 | 51 | 26ba665 |
| 129 | `shenmao` | 深茂铁路 | **深圳坪山** | **茂名** | 4 | 300 | 26ba665 |
| 130 | `shide` | 石德线 | **石家庄** | **德州** | 2 | 58 | 26ba665 |
| 131 | `shiji` | 石济客专 | **石家庄** | **济南东** | 11 | 189 | 26ba665 |
| 132 | `shitai` | 石太客专 | **石家庄** | **太原南** | 6 | 163 | 26ba665 |
| 133 | `shitai_xian` | 石太线 | **石家庄** | **太原** | 2 | 37 | 工作区未提交 |
| 134 | `shuibang` | 水蚌线 | **水家湖** | **蚌埠** | 2 | 22 | 26ba665 |
| 135 | `suishen` | 穗深城际 | **新塘** | **深圳机场** | 2 | 54 | 26ba665 |
| 136 | `suiyu` | 遂渝铁路 | **遂宁** | **重庆北** | 4 | 66 | 工作区未提交 |
| 137 | `taijiao` | 太焦高铁 | **太原南** | **焦作西** | 5 | 319 | 26ba665 |
| 138 | `taijiao_conv` | 太焦线 | **太原** | **焦作** | 2 | 66 | 26ba665 |
| 139 | `taijiao_xian` | 太焦线 | **太原** | **焦作** | 2 | 56 | 工作区未提交 |
| 140 | `taizhongyin` | 太中银铁路 | **太原** | **中卫** | 4 | 217 | 工作区未提交 |
| 141 | `tongjiu` | 铜九铁路 | **铜陵** | **九江** | 2 | 46 | 26ba665 |
| 142 | `tongpu` | 同蒲线 | **大同** | **风陵渡** | 2 | 181 | 26ba665 |
| 143 | `tongrang` | 通让线 | **通辽** | **让湖路** | 2 | 146 | 工作区未提交 |
| 144 | `wangang` | 皖赣线 | **芜湖** | **贵溪** | 4 | 597 | 工作区未提交 |
| 145 | `weilai` | 潍莱高铁 | **潍坊北** | **莱西北** | 4 | 171 | 26ba665 |
| 146 | `weiyan` | 潍烟高铁 | **潍坊北** | **烟台南** | 2 | 179 | 26ba665 |
| 147 | `wenfu` | 温福铁路 | **温州南** | **福州南** | 10 | 98 | 26ba665 |
| 148 | `wuda` | 武大线 | **武汉** | **大冶** | 2 | 100 | 工作区未提交 |
| 149 | `wugang` | 武冈城际 | **武昌** | **黄冈东** | 2 | 31 | 26ba665 |
| 150 | `wujiu` | 武九线 | **武昌** | **九江** | 2 | 37 | 26ba665 |
| 151 | `wujiukezhuan` | 武九客运专线 | **武昌** | **九江** | 2 | 150 | 工作区未提交 |
| 152 | `wushi` | 武石城际 | **武汉** | **黄石** | 2 | 28 | 工作区未提交 |
| 153 | `wuxian` | 武咸城际 | **南湖东** | **咸宁南** | 2 | 22 | 26ba665 |
| 154 | `wuxiao` | 武孝城际 | **汉口** | **孝感东** | 2 | 35 | 26ba665 |
| 155 | `xiangguikuoneng` | 湘桂铁路扩能 | **衡阳东** | **南宁东** | 4 | 461 | 26ba665 |
| 156 | `xiangpu` | 向莆铁路 | **南昌西** | **福州南** | 5 | 329 | 26ba665 |
| 157 | `xiangyu` | 襄渝线 | **襄阳** | **重庆北** | 2 | 132 | 26ba665 |
| 158 | `xikang` | 西康线 | **西安** | **安康** | 2 | 36 | 26ba665 |
| 159 | `xinchang` | 新长线 | **新沂** | **长兴** | 4 | 741 | 工作区未提交 |
| 160 | `xintai` | 辛泰线 | **辛店** | **泰安** | 2 | 28 | 26ba665 |
| 161 | `xinyan` | 新兖线 | **新乡** | **兖州** | 2 | 64 | 26ba665 |
| 162 | `xiping` | 西平线 | **西安** | **平凉** | 2 | 203 | 工作区未提交 |
| 163 | `xuanhang` | 宣杭线 | **宣城** | **杭州** | 3 | 307 | 工作区未提交 |
| 164 | `yangan` | 阳安线 | **阳平关** | **安康** | 2 | 61 | 26ba665 |
| 165 | `yanshi` | 兖石线 | **兖州** | **石臼所** | 2 | 53 | 26ba665 |
| 166 | `yayi` | 鸦宜线 | **鸦鹊岭** | **宜昌** | 2 | 11 | 26ba665 |
| 167 | `yingxia` | 鹰厦线 | **鹰潭** | **厦门** | 2 | 133 | 26ba665 |
| 168 | `yongtaiwen` | 甬台温铁路 | **宁波** | **温州南** | 9 | 156 | 26ba665 |
| 169 | `yuhuai` | 渝怀铁路 | **重庆北** | **怀化** | 2 | 111 | 26ba665 |
| 170 | `yuwan` | 渝万城际 | **重庆北** | **万州北** | 5 | 190 | 26ba665 |
| 171 | `zhangquan` | 漳泉肖线 | **漳平** | **泉州** | 2 | 23 | 26ba665 |
| 172 | `zhengji` | 郑机城际 | **郑州东** | **新郑机场** | 2 | 12 | 26ba665 |
| 173 | `zhengjiao` | 郑焦城际 | **郑州东** | **焦作** | 5 | 108 | 26ba665 |
| 174 | `zhengkai` | 郑开城际 | **郑州东** | **宋城路** | 2 | 61 | 26ba665 |
| 175 | `zhililu` | 枝柳线 | **枝城** | **柳州** | 3 | 163 | 工作区未提交 |

## 完整 stationsHint（抽查用）

### `anjiu` · 安九高铁

- **起点：** 安庆西
- **终点：** 九江
- **stationsHint：** 安庆西 → 九江
- **source：** osm
- **note：** | cleaned spikes/backtracks | local-gap-bridge b=1 d=0 | explicit gap densify | OD approach patch | anqingxi-approach li

### `baolan` · 包兰线

- **起点：** 包头
- **终点：** 兰州
- **stationsHint：** 包头 → 中卫 → 兰州
- **source：** osm
- **note：** | cleaned spikes/backtracks | explicit gap densify (source jump) | densify tip→兰州 | cleaned soft-spikes

### `baoxi` · 包西线

- **起点：** 包头
- **终点：** 西安
- **stationsHint：** 包头 → 西安
- **source：** local-rail-graph-named
- **note：** name-filter 包西线 | cleaned soft-spikes | densify>8km | densify>8km

### `baozhong` · 宝中线

- **起点：** 宝鸡
- **终点：** 中卫
- **stationsHint：** 宝鸡 → 平凉 → 中卫
- **source：** osm
- **note：** | cleaned soft-spikes | explicit gap densify ≤17.2km | OSM 1911879 member-order | calib-D: OD slice 宝鸡→中卫

### `beia` · 北阿铁路

- **起点：** 北屯市
- **终点：** 阿勒泰
- **stationsHint：** 北屯市 → 阿勒泰
- **source：** local-rail-graph-named
- **note：** name-filter 北阿铁路 | cleaned soft-spikes | explicit gap densify (source jump 23.6km) | cleaned spikes/backtracks

### `beijiang` · 北疆线

- **起点：** 乌鲁木齐
- **终点：** 阿拉山口
- **stationsHint：** 乌鲁木齐 → 石河子 → 奎屯 → 精河 → 阿拉山口
- **source：** local-rail-graph-legs
- **note：** local via 乌鲁木齐→石河子→奎屯→精河→阿拉山口（北疆≈兰新乌阿段） | explicit gap densify (source jump)

### `binsui` · 滨绥线

- **起点：** 哈尔滨
- **终点：** 绥芬河
- **stationsHint：** 哈尔滨 → 绥芬河
- **source：** local-rail-graph-named
- **note：** name-filter 滨绥线 | cleaned soft-spikes | densify>8km | densify>8km

### `binzhou` · 滨洲线

- **起点：** 哈尔滨
- **终点：** 满洲里
- **stationsHint：** 哈尔滨 → 齐齐哈尔 → 龙江 → 扎兰屯 → 海拉尔 → 满洲里
- **source：** osm-bbox+local-legs
- **note：** Qiqihar OSM splice; no aggressive clean | soft-spike+densify | simplify+desharp | cleaned soft-spikes

### `changgan` · 昌赣高铁

- **起点：** 南昌西
- **终点：** 赣州西
- **stationsHint：** 南昌西 → 樟树东 → 吉安西 → 泰和 → 兴国西 → 赣州西
- **source：** osm
- **note：** | cleaned spikes/backtracks | local-gap-bridge b=3 d=0 | explicit gap densify | OD approach patch | explicit gap bridge 

### `changhui` · 长珲城际铁路

- **起点：** 长春
- **终点：** 珲春
- **stationsHint：** 长春 → 吉林 → 敦化 → 大石头南 → 安图西 → 延吉西 → 图们北 → 珲春
- **source：** local-hsr-graph-legs
- **note：** local-hsr via-legs 长珲城际; densify; soft-dedupe | cleaned soft-spikes

### `changjiu` · 昌九城际

- **起点：** 南昌西
- **终点：** 九江
- **stationsHint：** 南昌西 → 九江
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** |cleaned spikes/backtracks | OD approach patch | P0 hsr batch 2026-09-17

### `changtu` · 长图线

- **起点：** 长春
- **终点：** 图们
- **stationsHint：** 长春 → 吉林 → 敦化 → 图们
- **source：** osm
- **note：** OSM relation 1969911 + conservative clean/gap-fill | explicit gap densify (calib-F jump)

### `changyichang` · 常益长高铁

- **起点：** 常德
- **终点：** 长沙西
- **stationsHint：** 常德 → 长沙西
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** |cleaned spikes/backtracks | P0 hsr batch 2026-09-17

### `chengguan` · 成灌铁路

- **起点：** 成都
- **终点：** 都江堰
- **stationsHint：** 成都 → 都江堰
- **source：** local-hsr-graph
- **note：** prefer:成灌 | cleaned soft-spikes

### `chengmianle` · 成绵乐城际

- **起点：** 江油
- **终点：** 乐山
- **stationsHint：** 江油 → 绵阳 → 德阳 → 广汉北 → 成都东 → 双流机场 → 眉山东 → 乐山
- **source：** slice:xicheng+chenggui
- **note：** 文档成绵乐=西成江成段+成贵成乐段（及峨眉支线若可吸附）；禁止再从残缺 hsr 名硬抽 | explicit gap densify (source jump)

### `chengya` · 成雅铁路

- **起点：** 成都西
- **终点：** 朝阳湖
- **stationsHint：** 成都西 → 朝阳湖
- **source：** local-hsr-graph
- **note：** 成蒲/成雅至朝阳湖；朝雅段本地 hsr 图不足，待 OSM 补全至雅安 | cleaned soft-spikes

### `chengyuxian` · 成渝线

- **起点：** 成都
- **终点：** 重庆
- **stationsHint：** 成都 → 简阳 → 资阳 → 资中 → 内江 → 隆昌 → 荣昌 → 永川 → 重庆
- **source：** osm
- **note：** OSM relation 1965907 Dijkstra+via; cleaned soft-spikes | calib-F2: hints 收敛>5km中间站

### `chongli` · 崇礼铁路

- **起点：** 太子城
- **终点：** 崇礼
- **stationsHint：** 太子城 → 崇礼
- **source：** local-hsr-graph-named
- **note：** name-filter 崇礼线 hsr | cleaned soft-spikes

### `chuannan` · 川南城际铁路

- **起点：** 宜宾
- **终点：** 内江
- **stationsHint：** 宜宾 → 内江
- **source：** local-rail-graph-legs
- **note：** local-hsr | explicit densify ≤8 +17 (source gap)

### `chuanqian` · 川黔线

- **起点：** 重庆
- **终点：** 贵阳
- **stationsHint：** 重庆 → 贵阳
- **source：** local-rail-graph-named
- **note：** name-filter 川黔线 | stitch<=25km | cleaned soft-spikes | densify>8km | cleaned soft-spikes | densify>8km

### `dacheng` · 达成铁路

- **起点：** 达州
- **终点：** 成都
- **stationsHint：** 达州 → 成都
- **source：** local-rail-graph-named
- **note：** name-filter 达成铁路 | cleaned soft-spikes | densify>8km | densify>8km

### `dawan` · 达万线

- **起点：** 达州
- **终点：** 万州
- **stationsHint：** 达州 → 万州
- **source：** local-rail-graph-named
- **note：** name-filter 达万线 | cleaned soft-spikes | densify>8km | densify>8km

### `dazhang` · 大张高铁

- **起点：** 大同南
- **终点：** 张家口
- **stationsHint：** 大同南 → 阳高南 → 天镇 → 张家口
- **source：** osm-bbox
- **note：** bbox stitch; dijkstra 99km | cleaned spikes/backtracks | local-gap-bridge b=0 d=1 | calib-F2: hints 收敛>5km中间站

### `dunhuang` · 敦煌线

- **起点：** 敦煌
- **终点：** 瓜州
- **stationsHint：** 敦煌 → 瓜州
- **source：** osm
- **note：** | cleaned soft-spikes | explicit gap densify | OSM 1474854 敦煌—瓜州（非敦格全线） | calib-D: OD slice 敦煌→瓜州

### `eha` · 额哈铁路

- **起点：** 额济纳
- **终点：** 哈密东
- **stationsHint：** 额济纳 → 哈密东
- **source：** osm
- **note：** osm-rel 11060235 | aggressive-clean+relation-gap-fill | densify≤15 +0 | OD 额济纳 7.5km | explicit gap densify (calib-F jum

### `fengsha` · 丰沙线

- **起点：** 丰台
- **终点：** 沙城
- **stationsHint：** 丰台 → 沙城
- **source：** local-rail-graph-named
- **note：** name-filter 丰沙线 | cleaned soft-spikes | densify>8km | densify>8km

### `fowan` · 佛莞城际

- **起点：** 广州南
- **终点：** 麻涌
- **stationsHint：** 广州南 → 广州长隆 → 麻涌
- **source：** osm
- **note：** OSM r9161560 广州南→麻涌（望洪端点待补）

### `fuhuai` · 阜淮线

- **起点：** 阜阳
- **终点：** 淮南
- **stationsHint：** 阜阳 → 淮南
- **source：** local-rail-graph-named
- **note：** name-filter 阜淮线 | cleaned soft-spikes | densify>8km | densify>8km

### `ganlong` · 赣龙铁路

- **起点：** 赣州
- **终点：** 龙岩
- **stationsHint：** 赣州 → 于都 → 瑞金 → 长汀南 → 冠豸山 → 龙岩
- **source：** osm
- **note：** | cleaned spikes/backtracks | local-gap-bridge b=0 d=1 | OD approach patch | explicit gap bridge densified | calib-D: OD

### `ganruilong` · 赣瑞龙铁路

- **起点：** 赣州
- **终点：** 龙岩
- **stationsHint：** 赣州 → 瑞金 → 龙岩
- **source：** local-hsr-graph-legs
- **note：** via-legs n=4 single-graph-load hsr | cleaned spikes/backtracks | explicit gap densify ≤32.9km | hsr name-filter 赣瑞龙线 | c

### `ganshen` · 赣深高铁

- **起点：** 赣州西
- **终点：** 深圳北
- **stationsHint：** 赣州西 → 信丰西 → 龙南东 → 和平 → 河源北 → 惠州北 → 东莞南 → 光明城 → 深圳北
- **source：** osm
- **note：** | cleaned spikes/backtracks | local-gap-bridge b=3 d=0 | explicit gap densify (source jump) | cleaned spikes/backtracks 

### `ganwu` · 干武线

- **起点：** 干塘
- **终点：** 武威
- **stationsHint：** 干塘 → 武威
- **source：** local-rail-graph-named
- **note：** name-filter 干武线 | quality stitch≤15km | cleaned soft-spikes | densify>8km | densify>8km

### `guangfohuan` · 广佛环线

- **起点：** 番禺
- **终点：** 北滘西
- **stationsHint：** 番禺 → 陈村 → 北滘西
- **source：** osm
- **note：** 广佛南环已开通段（OSM r18525948 番禺→北滘西）；西环仍在建，西端未接佛山西 | cleaned soft-spikes

### `guanghui` · 广惠城际

- **起点：** 广州东
- **终点：** 惠州北
- **stationsHint：** 广州东 → 惠州北
- **source：** local-hsr-graph
- **note：** 广惠城际；广州东进路含显式 densify 桥接点（源图缺口）

### `guangmao` · 广茂线

- **起点：** 广州
- **终点：** 茂名
- **stationsHint：** 广州 → 茂名
- **source：** local-rail-graph-named
- **note：** name-filter 广茂线 | cleaned soft-spikes | densify>8km | cleaned soft-spikes | densify>8km | cleaned soft-spikes

### `guangmeishan` · 广梅汕线

- **起点：** 广州
- **终点：** 汕头
- **stationsHint：** 广州 → 惠州 → 龙川 → 兴宁 → 汕头
- **source：** stitch:west-legs+gms_east+meishan
- **note：** west leg0/1 + local gms_east(兴宁 midFar4.2; prefer名漳龙但几何贴广梅走廊) + meishan | cleaned soft-spikes | explicit gap densify (ca

### `guangqing` · 广清城际

- **起点：** 花都
- **终点：** 清城
- **stationsHint：** 花都 → 狮岭 → 银盏 → 清城
- **source：** china-hsr-simulation/hsr-rails.geojson

### `guangshenchengji` · 广深城际铁路

- **起点：** 广州东
- **终点：** 深圳
- **stationsHint：** 广州东 → 东莞 → 常平 → 樟木头 → 深圳
- **source：** local-rail-graph-legs
- **note：** prefer 广深线 via legs; NOT guangshengang | cleaned spikes/backtracks | explicit gap densify (source jump)

### `guangxiyanhai` · 广西沿海铁路

- **起点：** 南宁东
- **终点：** 防城港北
- **stationsHint：** 南宁东 → 钦州东 → 防城港北
- **source：** osm-bbox
- **note：** bbox stitch; dijkstra 53km | cleaned spikes/backtracks | local-gap-bridge b=0 d=1 | cleaned spikes/backtracks

### `guangzhan` · 广湛高铁

- **起点：** 广州白云
- **终点：** 湛江北
- **stationsHint：** 广州白云 → 新兴南 → 阳春东 → 阳江北 → 马踏 → 茂名南 → 吴川 → 湛江北
- **source：** osm
- **note：** OSM r17137172 广湛高速线；北端距广州白云约4km（白云引入仍在完善） | explicit gap densify (source jump) | calib-G: 显式 densify 广州白云进路

### `guangzhao` · 广肇城际

- **起点：** 广州南
- **终点：** 肇庆
- **stationsHint：** 广州南 → 北滘 → 顺德北 → 三水北 → 肇庆东 → 肇庆
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** | OD approach patch | calib-F: 撤佛山西（距广肇折线>5km） | cleaned soft-spikes

### `guangzhoudonghuan` · 广州东环城际

- **起点：** 番禺
- **终点：** 白云机场北
- **stationsHint：** 番禺 → 白云机场北
- **source：** local-hsr-graph
- **note：** prefer:东环 | cleaned soft-spikes

### `guangzhu` · 广珠城际

- **起点：** 广州南
- **终点：** 珠海
- **stationsHint：** 广州南 → 珠海
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** | cleaned spikes/backtracks

### `guikun` · 贵昆线

- **起点：** 贵阳
- **终点：** 昆明
- **stationsHint：** 贵阳 → 安顺 → 宣威 → 曲靖 → 昆明
- **source：** slice:hukunxian
- **note：** slice hukunxian 贵阳→昆明（原贵昆已并入沪昆普速） | OD approach patch | hint drop 六盘水 (hukunxian slice ~35km off; 站钉 neikun)

### `hajia` · 哈佳铁路

- **起点：** 哈尔滨
- **终点：** 佳木斯
- **stationsHint：** 哈尔滨 → 宾州 → 方正 → 依兰 → 佳木斯
- **source：** local-rail-graph-legs
- **note：** prefer 哈佳线 via 宾州/方正/依兰（不经南岔；南岔属绥佳） | explicit gap densify (source jump)

### `hanchang` · 邯长线

- **起点：** 邯郸
- **终点：** 长治
- **stationsHint：** 邯郸 → 长治
- **source：** local-rail-graph-named
- **note：** name-filter 邯长线 | stitch<=25km | cleaned soft-spikes | densify>8km | densify>8km

### `handan` · 汉丹线

- **起点：** 汉口
- **终点：** 谷城
- **stationsHint：** 汉口 → 云梦 → 安陆 → 随州 → 襄阳 → 谷城
- **source：** osm-bbox+relation-gap-splice
- **note：** via-legs local graph + OSM relation 2201129 gap splice/dijkstra fill; cleaned spikes | calib-C: 移除丹江口（汉十站，非汉丹） | explici

### `hangqu` · 杭衢高铁

- **起点：** 建德
- **终点：** 江山
- **stationsHint：** 建德 → 江山
- **source：** osm
- **note：** OSM rel 18674047 Dijkstra 建德→江山；北段（杭州西）relation/graph 未通，待补 | calib-D: 接杭黄廊至真·建德 | calib-D: densify jumps; 衢州不在杭衢折线则撤 hi

### `hangyong` · 杭甬高铁

- **起点：** 杭州东
- **终点：** 宁波
- **stationsHint：** 杭州东 → 宁波
- **source：** local-hsr-graph
- **note：** prefer:甬广 | cleaned soft-spikes | explicit gap densify (source jump)

### `hanhuang` · 邯黄铁路

- **起点：** 邯郸
- **终点：** 黄骅港
- **stationsHint：** 邯郸 → 黄骅港
- **source：** local-rail-graph-named
- **note：** name-filter 邯黄铁路 | cleaned soft-spikes | densify>8km | cleaned soft-spikes | densify>8km

### `hanji` · 邯济线

- **起点：** 邯郸
- **终点：** 济南
- **stationsHint：** 邯郸 → 济南
- **source：** local-rail-graph-named
- **note：** name-filter 邯济线 | stitch<=25km | cleaned soft-spikes | densify>8km | densify>8km

### `hanshi` · 汉十高铁

- **起点：** 汉口
- **终点：** 十堰东
- **stationsHint：** 汉口 → 孝感东 → 安陆西 → 随州南 → 枣阳 → 襄阳东 → 丹江口 → 武当山西 → 十堰东
- **source：** local-hsr-via-station-chain
- **note：** mainline via 汉口-孝感东-安陆西-随州南-枣阳-襄阳东(东津)-丹江口-武当山西-十堰东; 襄阳东 on 武西 not 郑渝 north spur; reject Jingmen | cleaned soft-spikes |

### `hanyi` · 汉宜铁路

- **起点：** 汉口
- **终点：** 宜昌东
- **stationsHint：** 汉口 → 潜江 → 宜昌东
- **source：** osm-bbox
- **note：** bbox stitch; dijkstra 185km | cleaned spikes/backtracks | local-gap-bridge b=0 d=4 | calib-F2: hints 收敛>5km中间站

### `haqi` · 哈齐高铁

- **起点：** 哈尔滨西
- **终点：** 齐齐哈尔
- **stationsHint：** 哈尔滨西 → 肇东 → 安达 → 大庆西 → 大庆东 → 杜尔伯特 → 红旗营东 → 齐齐哈尔南 → 齐齐哈尔
- **source：** osm
- **note：** | cleaned spikes/backtracks | explicit gap densify (source jump)

### `haqin` · 哈秦段

- **起点：** 哈尔滨西
- **终点：** 秦皇岛
- **stationsHint：** 哈尔滨西 → 沈阳 → 秦皇岛
- **source：** slice:jingha+qinshen
- **note：** stitch jingha 哈尔滨西—沈阳 + qinshen 沈阳—秦皇岛 | join 0.0km | cleaned spikes/backtracks | densify≤15 +0 | cleaned soft-spikes

### `hebang` · 合蚌高铁

- **起点：** 合肥南
- **终点：** 蚌埠南
- **stationsHint：** 合肥南 → 水家湖 → 淮南东 → 蚌埠南
- **source：** osm
- **note：** | cleaned spikes/backtracks | explicit gap densify (source jump) | OD approach patch | explicit gap bridge densified | c

### `heining` · 合宁铁路

- **起点：** 合肥南
- **终点：** 南京南
- **stationsHint：** 合肥南 → 南京南
- **source：** local-hsr-graph
- **note：** prefer:合宁 | cleaned soft-spikes | explicit gap densify (source jump)

### `hemao` · 河茂线

- **起点：** 河唇
- **终点：** 茂名
- **stationsHint：** 河唇 → 茂名
- **source：** local-rail-graph-named
- **note：** name-filter 河茂线 | quality stitch≤15km | cleaned soft-spikes | densify>8km | densify>8km

### `hengliu` · 衡柳铁路

- **起点：** 衡阳东
- **终点：** 柳州
- **stationsHint：** 衡阳东 → 桂林北 → 柳州
- **source：** local-hsr-graph-legs
- **note：** hsr via-legs prefer 衡柳线 | cleaned soft-spikes | explicit gap densify ≤19.4km | cleaned soft-spikes | drop hint 永州 (~21km

### `hewu` · 合武铁路

- **起点：** 合肥南
- **终点：** 汉口
- **stationsHint：** 合肥南 → 汉口
- **source：** local-hsr-graph
- **note：** prefer:合武 | cleaned soft-spikes | explicit gap densify (source jump)

### `houxi` · 侯西线

- **起点：** 侯马
- **终点：** 西安
- **stationsHint：** 侯马 → 西安
- **source：** local-rail-graph-named
- **note：** name-filter 侯西线 | cleaned soft-spikes | densify>8km | cleaned soft-spikes | densify>8km | cleaned soft-spikes | calib-F2

### `houyue` · 侯月线

- **起点：** 侯马
- **终点：** 月山
- **stationsHint：** 侯马 → 月山
- **source：** osm
- **note：** | cleaned soft-spikes | explicit gap densify (≤17.0km) | OSM 3895321

### `huainan` · 淮南线

- **起点：** 淮南
- **终点：** 芜湖
- **stationsHint：** 淮南 → 巢湖 → 芜湖
- **source：** osm
- **note：** OSM relation 305475 Dijkstra+via (淮南→芜湖) | calib-F2: hints 收敛>5km中间站

### `hukunxian` · 沪昆线

- **起点：** 上海
- **终点：** 昆明
- **stationsHint：** 上海 → 杭州西 → 株洲 → 怀化 → 昆明
- **source：** local-rail-graph-legs+osm-bbox
- **note：** via head+mid+west gaps=9.1/1.1 | cleaned spikes/backtracks | explicit gap densify (calib-F jump) | calib-F2: 杭州→杭州西；撤贵阳市

### `huning` · 沪宁城际

- **起点：** 上海
- **终点：** 南京
- **stationsHint：** 上海 → 南京
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** |cleaned spikes/backtracks | P0 hsr batch 2026-09-17

### `husuhu` · 沪苏湖高铁

- **起点：** 上海虹桥
- **终点：** 湖州
- **stationsHint：** 上海虹桥 → 湖州
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** |OD approach patch | cleaned spikes/backtracks | P0 hsr batch 2026-09-17

### `hutong` · 沪通铁路

- **起点：** 上海虹桥
- **终点：** 南通西
- **stationsHint：** 上海虹桥 → 太仓南 → 太仓 → 常熟 → 张家港 → 南通西
- **source：** osm-bbox
- **note：** via-legs 5 segments | cleaned soft-spikes | explicit gap densify (source jump) | 虹桥/南通西 OD via-legs rebuild

### `huzhune` · 呼准鄂铁路

- **起点：** 呼和浩特东
- **终点：** 鄂尔多斯
- **stationsHint：** 呼和浩特东 → 准格尔 → 鄂尔多斯
- **source：** osm-bbox
- **note：** bbox stitch; dijkstra 195km | cleaned spikes/backtracks | explicit gap densify (source jump)

### `jiajing` · 嘉镜线

- **起点：** 嘉峪关
- **终点：** 镜铁山
- **stationsHint：** 嘉峪关 → 镜铁山
- **source：** local-rail-graph-named
- **note：** name-filter 嘉镜线 | quality stitch≤15km | densify>8km | densify>8km

### `jiaojikezhuan` · 胶济客运专线

- **起点：** 济南
- **终点：** 潍坊
- **stationsHint：** 济南 → 淄博 → 潍坊
- **source：** local-rail-graph
- **note：** prefer:胶济线 | cleaned spikes/backtracks | explicit gap densify (source jump) | calib-D: 显式桥接青岛进路 ~29.8km（胶济/青荣末端至青岛站） | c

### `jiaojixian` · 胶济线

- **起点：** 青岛
- **终点：** 济南
- **stationsHint：** 青岛 → 济南
- **source：** local-rail-graph-named
- **note：** name-filter 胶济线 | cleaned soft-spikes | densify>8km | densify>8km | calib-D: 青岛 wiki OD slice

### `jiaoliu` · 焦柳线

- **起点：** 焦作
- **终点：** 柳州
- **stationsHint：** 焦作 → 柳州
- **source：** local-rail-graph-legs
- **note：** via-legs n=4 | cleaned spikes/backtracks | explicit gap densify (source jump) | cleaned soft-spikes

### `jiaoxin` · 胶新线

- **起点：** 胶州
- **终点：** 新沂
- **stationsHint：** 胶州 → 新沂
- **source：** local-rail-graph-named
- **note：** name-filter 胶新线 | cleaned soft-spikes | densify>8km | densify>8km

### `jier` · 集二线

- **起点：** 集宁南
- **终点：** 二连浩特
- **stationsHint：** 集宁南 → 二连浩特
- **source：** osm
- **note：** | explicit gap densify (source jump)

### `jingbin` · 京滨城际

- **起点：** 宝坻南
- **终点：** 北辰
- **stationsHint：** 宝坻南 → 北辰
- **source：** osm
- **note：** 已开通宝坻南→北辰（OSM r11898040）；北辰→滨海西在建；北京侧与京唐共线

### `jingguangxian` · 京广线

- **起点：** 北京
- **终点：** 广州白云
- **stationsHint：** 北京 → 石家庄 → 郑州 → 长沙 → 广州白云
- **source：** local-rail-graph-legs
- **note：** via-legs n=5 | cleaned spikes/backtracks | explicit gap densify (source jump)

### `jinghaxian` · 京哈线

- **起点：** 北京
- **终点：** 哈尔滨
- **stationsHint：** 北京 → 长春 → 哈尔滨
- **source：** osm
- **note：** | cleaned spikes/backtracks | explicit gap densify (source jump) | calib-F2: hints 收敛>5km中间站

### `jinghuxian` · 京沪线

- **起点：** 北京
- **终点：** 上海
- **stationsHint：** 北京 → 徐州 → 南京 → 上海
- **source：** osm
- **note：** | cleaned spikes/backtracks | cleaned spikes/backtracks | explicit gap densify (source jump) | calib-D: OD slice 北京→上海 |

### `jingjin` · 京津城际

- **起点：** 北京南
- **终点：** 塘沽
- **stationsHint：** 北京南 → 塘沽
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** |cleaned spikes/backtracks | P0 hsr batch 2026-09-17 | cleaned spikes/backtracks | explicit gap densify (source jump)

### `jingjiu` · 京九线

- **起点：** 北京西
- **终点：** 深圳东
- **stationsHint：** 北京西 → 衡水 → 聊城 → 菏泽 → 商丘 → 阜阳 → 麻城 → 九江 → 南昌 → 赣州 → 深圳东
- **source：** local-rail-graph-legs
- **note：** via-legs n=10 single-graph-load | bjxi approach stitch | densify jumps | cleaned soft-spikes | cleaned soft-spikes | cle

### `jingshen` · 京沈高铁

- **起点：** 北京朝阳
- **终点：** 沈阳
- **stationsHint：** 北京朝阳 → 承德南 → 朝阳 → 阜新 → 沈阳
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** sliced from jingha; fromDist=0.0km toDist=0.0km

### `jingtang` · 京唐城际

- **起点：** 北京城市副中心
- **终点：** 唐山
- **stationsHint：** 北京城市副中心 → 燕郊 → 大厂 → 香河 → 宝坻 → 玉田南 → 唐山西 → 唐山
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：**  | calib-C: 宝坻南→宝坻（京唐站，非京滨宝坻南）

### `jingtong` · 京通线

- **起点：** 北京
- **终点：** 通辽
- **stationsHint：** 北京 → 通辽
- **source：** local-rail-graph-named
- **note：** name-filter 京通线 | cleaned soft-spikes | densify>8km | densify>8km

### `jingxiong` · 京雄城际

- **起点：** 北京西
- **终点：** 雄安
- **stationsHint：** 北京西 → 北京大兴 → 大兴机场 → 固安东 → 霸州北 → 雄安
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** | explicit gap densify (source jump)

### `jingyuan` · 京原线

- **起点：** 北京
- **终点：** 原平
- **stationsHint：** 北京 → 原平
- **source：** local-rail-graph-named
- **note：** name-filter 京原线 | cleaned soft-spikes | densify>8km | OD approach patch | explicit gap bridge densified | densify>8km

### `jinji` · 津蓟城际铁路

- **起点：** 天津
- **终点：** 蓟州
- **stationsHint：** 天津 → 蓟州
- **source：** local-rail-graph-named
- **note：** name-filter 津蓟线 | cleaned soft-spikes | explicit densify ≤21.8km

### `jinjian` · 金建高铁

- **起点：** 金华
- **终点：** 建德
- **stationsHint：** 金华 → 建德
- **source：** local-hsr-graph-named
- **note：** name-filter 金建高速线 hsr | cleaned soft-spikes | explicit densify ≤21.2km | calib-D: 接杭黄廊至真·建德 | calib-D: densify hanghuang

### `jinqin` · 津秦高铁

- **起点：** 天津
- **终点：** 秦皇岛
- **stationsHint：** 天津 → 秦皇岛
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** |cleaned spikes/backtracks | OD approach patch | cleaned spikes/backtracks | P0 hsr batch 2026-09-17

### `jiqing` · 济青高铁

- **起点：** 济南东
- **终点：** 青岛
- **stationsHint：** 济南东 → 章丘北 → 邹平 → 淄博北 → 临淄北 → 青州市北 → 潍坊北 → 高密北 → 胶州北 → 青岛
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** |cleaned spikes/backtracks | P0 hsr batch 2026-09-17 | Qingdao approach: explicit ~15.7km bridge 胶州北侧→青荣/青岛 (hsr source 

### `kuibei` · 奎北铁路

- **起点：** 奎屯
- **终点：** 北屯市
- **stationsHint：** 奎屯 → 北屯市
- **source：** osm
- **note：** | cleaned soft-spikes | explicit gap densify (≤35.3km) | cleaned soft-spikes | append to 北屯市/beia junction | cleaned sof

### `labin` · 拉滨线

- **起点：** 哈尔滨
- **终点：** 拉法
- **stationsHint：** 哈尔滨 → 拉法
- **source：** local-rail-graph-named
- **note：** name-filter 拉滨线 | cleaned soft-spikes | densify>8km | densify>8km

### `laifu` · 来福线

- **起点：** 来舟
- **终点：** 福州
- **stationsHint：** 来舟 → 福州
- **source：** local-rail-graph-legs
- **note：** via-legs n=4 single-graph-load | prefer 峰福线 | cleaned soft-spikes | explicit gap densify ≤19.9km

### `lanqing` · 兰青铁路

- **起点：** 河口南
- **终点：** 西宁
- **stationsHint：** 河口南 → 西宁
- **source：** local-rail-graph-named
- **note：** 兰青：河口南→西宁（兰州西不在兰青正线） | cleaned soft-spikes | densify>8 | densify>8

### `lanxinxian` · 兰新线

- **起点：** 兰州
- **终点：** 乌鲁木齐
- **stationsHint：** 兰州 → 乌鲁木齐
- **source：** local-rail-graph-named
- **note：** name-filter 兰新线 | cleaned soft-spikes | densify>8 | OD approach patch | densify>8

### `lanyan` · 蓝烟线

- **起点：** 蓝村
- **终点：** 烟台
- **stationsHint：** 蓝村 → 烟台
- **source：** local-rail-graph-named
- **note：** name-filter 蓝烟线 | cleaned soft-spikes | densify>8km | densify>8km

### `lianzhen` · 连镇高铁

- **起点：** 连云港
- **终点：** 镇江南
- **stationsHint：** 连云港 → 灌云 → 灌南 → 涟水 → 淮安东 → 宝应 → 高邮北 → 扬州东 → 大港南 → 丹徒 → 镇江南
- **source：** osm
- **note：** OSM relation 7047174 + explicit OD densify 连云港↔tip 44.7km (source incomplete north) | cleaned spikes/backtracks

### `liunan` · 柳南城际

- **起点：** 柳州
- **终点：** 南宁东
- **stationsHint：** 柳州 → 南宁东
- **source：** osm
- **note：** | OSM 3070103 | cleaned soft-spikes | explicit gap densify ≤28.5km | cleaned soft-spikes

### `lizhan` · 黎湛线

- **起点：** 黎塘
- **终点：** 湛江
- **stationsHint：** 黎塘 → 玉林 → 湛江
- **source：** osm
- **note：** OSM relation 2101041 Dijkstra+via

### `longhai` · 陇海线

- **起点：** 连云港
- **终点：** 兰州
- **stationsHint：** 连云港 → 兰州
- **source：** local-rail-graph-named
- **note：** name-filter 陇海线 | cleaned soft-spikes | densify>8 | cleaned soft-spikes | densify>8

### `longxia` · 龙厦铁路

- **起点：** 龙岩
- **终点：** 厦门北
- **stationsHint：** 龙岩 → 南靖 → 漳州 → 角美 → 厦门北
- **source：** osm-bbox
- **note：** bbox stitch highspeed; dijkstra 104km | xiamenbei linear approach | cleaned soft-spikes | cleaned soft-spikes

### `longzhang` · 龙漳铁路

- **起点：** 龙岩
- **终点：** 漳州
- **stationsHint：** 龙岩 → 漳州
- **source：** local-hsr-graph
- **note：** prefer:龙漳 | cleaned soft-spikes

### `luobao` · 漯宝线

- **起点：** 漯河西
- **终点：** 宝丰
- **stationsHint：** 漯河西 → 宝丰
- **source：** local-rail-graph-legs
- **note：** via-legs n=4 single-graph-load | cleaned soft-spikes | explicit gap densify (source jump) | OD approach 漯河西 2.1km | clea

### `maozhan` · 茂湛铁路

- **起点：** 茂名
- **终点：** 湛江西
- **stationsHint：** 茂名 → 吴川 → 湛江西
- **source：** osm-bbox
- **note：** bbox stitch highspeed; dijkstra 67km | cleaned spikes/backtracks | local-gap-bridge b=0 d=0

### `mawu` · 麻武线

- **起点：** 麻城
- **终点：** 武汉
- **stationsHint：** 麻城 → 武汉
- **source：** local-rail-graph-named
- **note：** name-filter 麻武线 | stitch<=25km | densify>8km | densify>8km

### `meiji` · 梅集线

- **起点：** 梅河口
- **终点：** 集安
- **stationsHint：** 梅河口 → 集安
- **source：** local-rail-graph-named
- **note：** name-filter 梅集线 | quality stitch≤15km | cleaned soft-spikes | densify>8km | densify>8km

### `meishan` · 梅汕线

- **起点：** 梅州西
- **终点：** 汕头
- **stationsHint：** 梅州西 → 汕头
- **source：** osm
- **note：** osm-rel 8768448 | densify≤15 +3 | OD 梅州西—汕头

### `mujia` · 牡佳高铁

- **起点：** 牡丹江
- **终点：** 佳木斯
- **stationsHint：** 牡丹江 → 佳木斯
- **source：** osm
- **note：** | cleaned soft-spikes

### `musui` · 牡绥铁路

- **起点：** 牡丹江
- **终点：** 绥芬河
- **stationsHint：** 牡丹江 → 穆棱 → 绥芬河
- **source：** osm-bbox
- **note：** bbox stitch; dijkstra 117km | cleaned spikes/backtracks

### `mutu` · 牡图线

- **起点：** 牡丹江
- **终点：** 图们
- **stationsHint：** 牡丹江 → 图们
- **source：** osm
- **note：** | cleaned spikes/backtracks | explicit gap densify (≤19.1km) | OSM 1988906 图佳线 牡丹江→图们

### `nanguang` · 南广铁路

- **起点：** 南宁东
- **终点：** 广州南
- **stationsHint：** 南宁东 → 贵港 → 梧州南 → 郁南 → 云浮东 → 三水南 → 佛山西 → 肇庆东 → 广州南
- **source：** osm
- **note：** | cleaned spikes/backtracks | explicit gap densify (source jump) | calib-F2: hints 收敛>5km中间站 | calib-F2: 肇庆东 wiki 距正线~9k

### `nankunxian` · 南昆线

- **起点：** 南宁
- **终点：** 昆明
- **stationsHint：** 南宁 → 昆明
- **source：** local-rail-graph-named
- **note：** name-filter 南昆线 | cleaned soft-spikes | densify>8km | densify>8km

### `nanlong` · 南龙铁路

- **起点：** 南平市
- **终点：** 龙岩
- **stationsHint：** 南平市 → 龙岩
- **source：** local-hsr-graph-named
- **note：** name-filter 南龙线 hsr | cleaned soft-spikes | explicit densify ≤24.0km

### `neikun` · 内昆线

- **起点：** 内江
- **终点：** 六盘水
- **stationsHint：** 内江 → 宜宾 → 水富 → 昭通 → 六盘水
- **source：** local-rail-graph-legs
- **note：** local-legs prefer 内六线 + gap-fill + OD patch；六盘水—昆明共线沪昆未拼入 | cleaned soft-spikes | cleaned spikes/backtracks | local-gap-

### `ningan` · 宁安城际

- **起点：** 南京南
- **终点：** 安庆
- **stationsHint：** 南京南 → 铜陵北 → 池州 → 安庆
- **source：** osm-map-tiles
- **note：** | explicit gap densify (source jump) | hint drop 芜湖 (wiki站 ~13km off polyline; OD南京南 9.3km pre-existing) | calib-D: OD s

### `ningqi` · 宁启铁路

- **起点：** 林场
- **终点：** 启东
- **stationsHint：** 林场 → 扬州 → 南通 → 启东
- **source：** local-rail-graph-legs
- **note：** via-legs n=9 single-graph-load | cleaned soft-spikes | explicit gap densify (source jump)

### `ningrong` · 宁蓉铁路

- **起点：** 南京南
- **终点：** 成都东
- **stationsHint：** 南京南 → 合肥南 → 汉口 → 宜昌东 → 利川 → 重庆北 → 遂宁 → 成都东
- **source：** stitch:heining+hewu+hanyi+yiwan+yuli+osm-west
- **note：** stitch existing corridors + west via-legs; not hsr-rails extract | calib-F2: spike140 | explicit gap densify (source jum

### `ningwu` · 宁芜线

- **起点：** 南京
- **终点：** 芜湖
- **stationsHint：** 南京 → 马鞍山 → 芜湖
- **source：** osm+local-approach
- **note：** OSM relation 1799881 + 南京 local-graph approach

### `ningxi` · 宁西线

- **起点：** 南京
- **终点：** 西安
- **stationsHint：** 南京 → 西安
- **source：** local-rail-graph-named
- **note：** name-filter 宁西线 | full-graph OD legs to 南京/西安 | cleaned soft-spikes | densify>8km | densify>8km | calib-F2: spike140

### `palian` · 琶莲城际铁路

- **起点：** 琶洲
- **终点：** 莲花山
- **stationsHint：** 琶洲 → 莲花山
- **source：** local-hsr-graph-named
- **note：** name-filter 琶莲城际线 hsr | cleaned soft-spikes | explicit densify ≤9.3km

### `panxing` · 盘兴高铁

- **起点：** 盘州
- **终点：** 兴义
- **stationsHint：** 盘州 → 兴义
- **source：** local-hsr-graph-named
- **note：** name-filter 盘兴高速线 hsr | cleaned soft-spikes | explicit densify ≤24.2km

### `panying` · 盘营高铁

- **起点：** 盘锦北
- **终点：** 营口西
- **stationsHint：** 盘锦北 → 营口西
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** | P0 hsr batch 2026-09-17 | explicit gap densify (source jump)

### `pingqi` · 平齐线

- **起点：** 四平
- **终点：** 齐齐哈尔
- **stationsHint：** 四平 → 白城 → 齐齐哈尔
- **source：** osm
- **note：** OSM rel 1565503 Dijkstra+via; fixed head-exit reverse flags | explicit gap densify (source jump)

### `qiangui` · 黔桂铁路

- **起点：** 贵阳
- **终点：** 柳州
- **stationsHint：** 贵阳 → 都匀 → 金城江 → 柳州
- **source：** osm+guiyang-approach
- **note：** OSM relation 3477112 龙里→柳州 + 贵阳 approach; spike clean | explicit gap densify (calib-F jump)

### `qianzhangchang` · 黔张常铁路

- **起点：** 黔江
- **终点：** 常德
- **stationsHint：** 黔江 → 张家界西 → 常德
- **source：** osm-bbox
- **note：** bbox stitch; dijkstra 171km | cleaned spikes/backtracks | local-gap-bridge b=0 d=1 | qianjiang linear approach

### `qinglian` · 青连铁路

- **起点：** 日照西
- **终点：** 连云港
- **stationsHint：** 日照西 → 连云港
- **source：** osm-bbox
- **note：** bbox stitch; dijkstra 129km | cleaned spikes/backtracks | local-gap-bridge b=0 d=1 | calib-D: 显式桥接青岛进路 ~21.3km（胶济/青荣末端至青

### `qingyan` · 青盐铁路

- **起点：** 青岛北
- **终点：** 盐城
- **stationsHint：** 青岛北 → 日照西 → 连云港东 → 盐城
- **source：** osm-bbox+qinglian-stitch
- **note：** stitched qinglian + lianyungang-yancheng | cleaned spikes/backtracks | OD approach patch | hint+连云港 | calib-C: 移除连云港（保留连

### `qinshen` · 秦沈客专

- **起点：** 秦皇岛
- **终点：** 沈阳
- **stationsHint：** 秦皇岛 → 锦州南 → 盘锦北 → 沈阳
- **source：** osm-bbox
- **note：** bbox stitch; dijkstra 244km | cleaned spikes/backtracks | local-gap-bridge b=3 d=4 | explicit gap densify | cleaned spik

### `shendan` · 沈丹线

- **起点：** 沈阳
- **终点：** 丹东
- **stationsHint：** 沈阳 → 丹东
- **source：** local-rail-graph-named
- **note：** name-filter 沈丹线 | cleaned soft-spikes | densify>8km | densify>8km

### `shenmao` · 深茂铁路

- **起点：** 深圳坪山
- **终点：** 茂名
- **stationsHint：** 深圳坪山 → 江门 → 阳江 → 茂名
- **source：** osm-bbox
- **note：** bbox stitch; dijkstra 254km | cleaned spikes/backtracks | local-gap-bridge b=2 d=6 | explicit gap densify

### `shide` · 石德线

- **起点：** 石家庄
- **终点：** 德州
- **stationsHint：** 石家庄 → 德州
- **source：** local-rail-graph-named
- **note：** name-filter 石德线 | cleaned soft-spikes | densify>8km | cleaned soft-spikes | OD approach patch | densify>8km

### `shiji` · 石济客专

- **起点：** 石家庄
- **终点：** 济南东
- **stationsHint：** 石家庄 → 石家庄东 → 藁城南 → 辛集南 → 衡水北 → 景州 → 德州东 → 平原东 → 禹城东 → 齐河 → 济南东
- **source：** osm
- **note：** | cleaned spikes/backtracks | explicit gap densify (source jump) | OD tip→济南东 17.0km (overpass-dijkstra snap=0.0/0.0)

### `shitai` · 石太客专

- **起点：** 石家庄
- **终点：** 太原南
- **stationsHint：** 石家庄 → 获鹿南 → 井陉北 → 阳泉北 → 寿阳 → 太原南
- **source：** osm
- **note：** | cleaned spikes/backtracks | OD approach patch | calib-D: OD slice 石家庄→太原南

### `shitai_xian` · 石太线

- **起点：** 石家庄
- **终点：** 太原
- **stationsHint：** 石家庄 → 太原
- **source：** local-rail-graph-named
- **note：** name-filter 石太线 | batch local 石太线 | cleaned soft-spikes | explicit gap densify ≤21.5km

### `shuibang` · 水蚌线

- **起点：** 水家湖
- **终点：** 蚌埠
- **stationsHint：** 水家湖 → 蚌埠
- **source：** local-rail-graph-named
- **note：** name-filter 水蚌线 | stitch<=25km | cleaned soft-spikes | densify>8km | densify>8km

### `suishen` · 穗深城际

- **起点：** 新塘
- **终点：** 深圳机场
- **stationsHint：** 新塘 → 深圳机场
- **source：** local-hsr-graph
- **note：** 穗深城际：新塘→深圳机场（广州东进路 hsr 图脱节，待补）

### `suiyu` · 遂渝铁路

- **起点：** 遂宁
- **终点：** 重庆北
- **stationsHint：** 遂宁 → 潼南 → 合川 → 重庆北
- **source：** slice:ningrong
- **note：** slice ningrong 遂宁→重庆北 (遂渝/渭井段) | explicit gap densify (source jump)

### `taijiao` · 太焦高铁

- **起点：** 太原南
- **终点：** 焦作西
- **stationsHint：** 太原南 → 晋中 → 长治东 → 晋城东 → 焦作西
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** sliced from zhengtai; fromDist=0.0km toDist=1.8km | cleaned spikes/backtracks | calib-F2: spike140

### `taijiao_conv` · 太焦线

- **起点：** 太原
- **终点：** 焦作
- **stationsHint：** 太原 → 焦作
- **source：** local-rail-graph-named
- **note：** name-filter 太焦线 | stitch<=25km | cleaned soft-spikes | densify>8km | densify>8km

### `taijiao_xian` · 太焦线

- **起点：** 太原
- **终点：** 焦作
- **stationsHint：** 太原 → 焦作
- **source：** local-rail-graph-named
- **note：** name-filter 太焦线 | batch local 太焦线 | cleaned soft-spikes | explicit gap densify ≤23.9km

### `taizhongyin` · 太中银铁路

- **起点：** 太原
- **终点：** 中卫
- **stationsHint：** 太原 → 吕梁 → 定边 → 中卫
- **source：** local-graph prefer 太中线
- **note：** prefer 太中线 + 太原/中卫 approach；中卫→银川段待补 | explicit gap densify (calib-F jump) | cleaned soft-spikes | cleaned spikes/backtr

### `tongjiu` · 铜九铁路

- **起点：** 铜陵
- **终点：** 九江
- **stationsHint：** 铜陵 → 九江
- **source：** local-rail-graph-named
- **note：** name-filter 铜九铁路 | cleaned soft-spikes | densify>8km | densify>8km

### `tongpu` · 同蒲线

- **起点：** 大同
- **终点：** 风陵渡
- **stationsHint：** 大同 → 风陵渡
- **source：** local-rail-graph-named
- **note：** 北同蒲+南同蒲 stitch | cleaned soft-spikes | densify>8km | densify>8km

### `tongrang` · 通让线

- **起点：** 通辽
- **终点：** 让湖路
- **stationsHint：** 通辽 → 让湖路
- **source：** osm
- **note：** | cleaned spikes/backtracks | explicit gap densify ≤51.0km | cleaned soft-spikes | OSM 2155196 + explicit densify

### `wangang` · 皖赣线

- **起点：** 芜湖
- **终点：** 贵溪
- **stationsHint：** 芜湖 → 宣城 → 景德镇 → 贵溪
- **source：** osm
- **note：** | drop 鹰潭 | cleaned spikes/backtracks | explicit gap densify | cleaned spikes/backtracks | OD approach patch | OSM 20840

### `weilai` · 潍莱高铁

- **起点：** 潍坊北
- **终点：** 莱西北
- **stationsHint：** 潍坊北 → 昌邑 → 平度西 → 莱西北
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** | OD approach patch

### `weiyan` · 潍烟高铁

- **起点：** 潍坊北
- **终点：** 烟台南
- **stationsHint：** 潍坊北 → 烟台南
- **source：** local-hsr-graph
- **note：** prefer:潍烟 | cleaned soft-spikes | OD approach patch | calib-F2: hints 收敛>5km中间站

### `wenfu` · 温福铁路

- **起点：** 温州南
- **终点：** 福州南
- **stationsHint：** 温州南 → 瑞安 → 鳌江 → 苍南 → 霞浦 → 福安 → 宁德 → 罗源 → 连江 → 福州南
- **source：** osm
- **note：** sliced from hangshen; fromDist=1.6km toDist=0.7km | sliced from hangshen | explicit gap densify

### `wuda` · 武大线

- **起点：** 武汉
- **终点：** 大冶
- **stationsHint：** 武汉 → 大冶
- **source：** local-rail-graph-legs
- **note：** local-rail full-pool | OD approach 大冶 5.2km densify +0 | cleaned spikes/backtracks | local-gap-fill n=3 | explicit gap d

### `wugang` · 武冈城际

- **起点：** 武昌
- **终点：** 黄冈东
- **stationsHint：** 武昌 → 黄冈东
- **source：** local-hsr-graph
- **note：** prefer:武冈 | calib-F2: hints 收敛>5km中间站

### `wujiu` · 武九线

- **起点：** 武昌
- **终点：** 九江
- **stationsHint：** 武昌 → 九江
- **source：** local-rail-graph-named
- **note：** name-filter 武九线 | densify>8km | densify>8km | calib-D: OD slice 武昌→九江

### `wujiukezhuan` · 武九客运专线

- **起点：** 武昌
- **终点：** 九江
- **stationsHint：** 武昌 → 九江
- **source：** osm
- **note：** | OSM 4638419 | cleaned soft-spikes | explicit gap densify ≤10.6km | append to 九江 via hsr | extend to 九江 | cleaned soft-

### `wushi` · 武石城际

- **起点：** 武汉
- **终点：** 黄石
- **stationsHint：** 武汉 → 黄石
- **source：** local-rail-graph-legs
- **note：** via-legs n=5 single-graph-load | cleaned soft-spikes | explicit gap densify (source jump)

### `wuxian` · 武咸城际

- **起点：** 南湖东
- **终点：** 咸宁南
- **stationsHint：** 南湖东 → 咸宁南
- **source：** local-hsr-graph
- **note：** prefer:武咸 | cleaned soft-spikes | explicit gap densify (source jump) | calib-C: OD 南湖东→咸宁南（余花联络入武昌未入库）

### `wuxiao` · 武孝城际

- **起点：** 汉口
- **终点：** 孝感东
- **stationsHint：** 汉口 → 孝感东
- **source：** local-hsr-graph
- **note：** prefer:武孝 | cleaned soft-spikes | OD approach patch | cleaned soft-spikes

### `xiangguikuoneng` · 湘桂铁路扩能

- **起点：** 衡阳东
- **终点：** 南宁东
- **stationsHint：** 衡阳东 → 桂林北 → 柳州 → 南宁东
- **source：** osm-bbox
- **note：** bbox stitch; dijkstra 359km | cleaned spikes/backtracks | local-gap-bridge b=1 d=2 | explicit gap densify | cleaned spik

### `xiangpu` · 向莆铁路

- **起点：** 南昌西
- **终点：** 福州南
- **stationsHint：** 南昌西 → 抚州 → 三明北 → 永泰 → 福州南
- **source：** osm
- **note：** | cleaned spikes/backtracks | OD approach patch | explicit gap bridge densified | local-gap-bridge b=0 d=0

### `xiangyu` · 襄渝线

- **起点：** 襄阳
- **终点：** 重庆北
- **stationsHint：** 襄阳 → 重庆北
- **source：** local-rail-graph-named
- **note：** name-filter 襄渝线 | full-graph last-leg bridge 北碚→重庆北 (~20km) | cleaned soft-spikes | densify>8km | densify>8km

### `xikang` · 西康线

- **起点：** 西安
- **终点：** 安康
- **stationsHint：** 西安 → 安康
- **source：** local-rail-graph-named
- **note：** name-filter 西康线 | cleaned soft-spikes | densify>8km | densify>8km

### `xinchang` · 新长线

- **起点：** 新沂
- **终点：** 长兴
- **stationsHint：** 新沂 → 淮安 → 海安 → 长兴
- **source：** osm
- **note：** | cleaned soft-spikes | OSM 2073179

### `xintai` · 辛泰线

- **起点：** 辛店
- **终点：** 泰安
- **stationsHint：** 辛店 → 泰安
- **source：** local-rail-graph-named
- **note：** name-filter 辛泰线 | stitch<=25km | cleaned soft-spikes | densify>8km | densify>8km

### `xinyan` · 新兖线

- **起点：** 新乡
- **终点：** 兖州
- **stationsHint：** 新乡 → 兖州
- **source：** local-rail-graph-named
- **note：** name-filter 新兖线 | stitch<=25km | cleaned soft-spikes | densify>8km | cleaned soft-spikes | densify>8km | cleaned soft-sp

### `xiping` · 西平线

- **起点：** 西安
- **终点：** 平凉
- **stationsHint：** 西安 → 平凉
- **source：** osm
- **note：** | 西安 approach via local-graph | cleaned spikes/backtracks | explicit gap densify | OSM 8355928 + 西安 local approach | cle

### `xuanhang` · 宣杭线

- **起点：** 宣城
- **终点：** 杭州
- **stationsHint：** 宣城 → 长兴 → 杭州
- **source：** osm
- **note：** OSM relation 3046174 Dijkstra+via; OD approach patch

### `yangan` · 阳安线

- **起点：** 阳平关
- **终点：** 安康
- **stationsHint：** 阳平关 → 安康
- **source：** local-rail-graph-named
- **note：** name-filter 阳安线 | cleaned soft-spikes | densify>8km | densify>8km

### `yanshi` · 兖石线

- **起点：** 兖州
- **终点：** 石臼所
- **stationsHint：** 兖州 → 石臼所
- **source：** local-rail-graph-named
- **note：** name-filter 兖石线 | cleaned soft-spikes | densify>8km | densify>8km

### `yayi` · 鸦宜线

- **起点：** 鸦鹊岭
- **终点：** 宜昌
- **stationsHint：** 鸦鹊岭 → 宜昌
- **source：** local-rail-graph-named
- **note：** name-filter 鸦宜线 | stitch<=25km | cleaned soft-spikes | densify>8km | densify>8km

### `yingxia` · 鹰厦线

- **起点：** 鹰潭
- **终点：** 厦门
- **stationsHint：** 鹰潭 → 厦门
- **source：** local-rail-graph-named
- **note：** name-filter 鹰厦线 | cleaned soft-spikes | densify>8km | densify>8km | calib-D: OD slice 鹰潭→厦门

### `yongtaiwen` · 甬台温铁路

- **起点：** 宁波
- **终点：** 温州南
- **stationsHint：** 宁波 → 宁海 → 三门县 → 临海 → 温岭 → 雁荡山 → 绅坊 → 永嘉 → 温州南
- **source：** osm
- **note：** | cleaned spikes/backtracks | explicit gap densify (source jump) | calib-F2: hints 收敛>5km中间站

### `yuhuai` · 渝怀铁路

- **起点：** 重庆北
- **终点：** 怀化
- **stationsHint：** 重庆北 → 怀化
- **source：** local-rail-graph-named
- **note：** name-filter 渝怀线 | OD 重庆北=yuwan anchor | cleaned soft-spikes | densify>8km | cleaned soft-spikes | OD approach patch | ex

### `yuwan` · 渝万城际

- **起点：** 重庆北
- **终点：** 万州北
- **stationsHint：** 重庆北 → 长寿北 → 垫江 → 梁平南 → 万州北
- **source：** osm
- **note：** | cleaned spikes/backtracks | OD approach patch | explicit gap bridge densified | cleaned soft-spikes

### `zhangquan` · 漳泉肖线

- **起点：** 漳平
- **终点：** 泉州
- **stationsHint：** 漳平 → 泉州
- **source：** local-rail-graph-named
- **note：** name-filter 漳泉肖线 | quality stitch≤15km | cleaned soft-spikes | densify>8km | densify>8km

### `zhengji` · 郑机城际

- **起点：** 郑州东
- **终点：** 新郑机场
- **stationsHint：** 郑州东 → 新郑机场
- **source：** local-hsr-graph
- **note：** prefer:郑机 | cleaned soft-spikes | explicit gap densify (source jump)

### `zhengjiao` · 郑焦城际

- **起点：** 郑州东
- **终点：** 焦作
- **stationsHint：** 郑州东 → 南阳寨 → 武陟 → 修武西 → 焦作
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** sliced from zhengtai; fromDist=0.0km toDist=0.2km | cleaned spikes/backtracks

### `zhengkai` · 郑开城际

- **起点：** 郑州东
- **终点：** 宋城路
- **stationsHint：** 郑州东 → 宋城路
- **source：** china-hsr-simulation/hsr-rails.geojson
- **note：** | inject 郑州东 hub | cleaned soft-spikes

### `zhililu` · 枝柳线

- **起点：** 枝城
- **终点：** 柳州
- **stationsHint：** 枝城 → 怀化 → 柳州
- **source：** local-rail-graph-legs
- **note：** slice jiaoliu 枝城—柳州 | OD approach 枝城 8.7km densify +1

## 审查勾选

| id | 起终点 | 几何目视 | 备注 |
|---|---|---|---|
| `anjiu` | ☐ | ☐ |  |
| `baolan` | ☐ | ☐ |  |
| `baoxi` | ☐ | ☐ |  |
| `baozhong` | ☐ | ☐ |  |
| `beia` | ☐ | ☐ |  |
| `beijiang` | ☐ | ☐ |  |
| `binsui` | ☐ | ☐ |  |
| `binzhou` | ☐ | ☐ |  |
| `changgan` | ☐ | ☐ |  |
| `changhui` | ☐ | ☐ |  |
| `changjiu` | ☐ | ☐ |  |
| `changtu` | ☐ | ☐ |  |
| `changyichang` | ☐ | ☐ |  |
| `chengguan` | ☐ | ☐ |  |
| `chengmianle` | ☐ | ☐ |  |
| `chengya` | ☐ | ☐ |  |
| `chengyuxian` | ☐ | ☐ |  |
| `chongli` | ☐ | ☐ |  |
| `chuannan` | ☐ | ☐ |  |
| `chuanqian` | ☐ | ☐ |  |
| `dacheng` | ☐ | ☐ |  |
| `dawan` | ☐ | ☐ |  |
| `dazhang` | ☐ | ☐ |  |
| `dunhuang` | ☐ | ☐ |  |
| `eha` | ☐ | ☐ |  |
| `fengsha` | ☐ | ☐ |  |
| `fowan` | ☐ | ☐ |  |
| `fuhuai` | ☐ | ☐ |  |
| `ganlong` | ☐ | ☐ |  |
| `ganruilong` | ☐ | ☐ |  |
| `ganshen` | ☐ | ☐ |  |
| `ganwu` | ☐ | ☐ |  |
| `guangfohuan` | ☐ | ☐ |  |
| `guanghui` | ☐ | ☐ |  |
| `guangmao` | ☐ | ☐ |  |
| `guangmeishan` | ☐ | ☐ |  |
| `guangqing` | ☐ | ☐ |  |
| `guangshenchengji` | ☐ | ☐ |  |
| `guangxiyanhai` | ☐ | ☐ |  |
| `guangzhan` | ☐ | ☐ |  |
| `guangzhao` | ☐ | ☐ |  |
| `guangzhoudonghuan` | ☐ | ☐ |  |
| `guangzhu` | ☐ | ☐ |  |
| `guikun` | ☐ | ☐ |  |
| `hajia` | ☐ | ☐ |  |
| `hanchang` | ☐ | ☐ |  |
| `handan` | ☐ | ☐ |  |
| `hangqu` | ☐ | ☐ |  |
| `hangyong` | ☐ | ☐ |  |
| `hanhuang` | ☐ | ☐ |  |
| `hanji` | ☐ | ☐ |  |
| `hanshi` | ☐ | ☐ |  |
| `hanyi` | ☐ | ☐ |  |
| `haqi` | ☐ | ☐ |  |
| `haqin` | ☐ | ☐ |  |
| `hebang` | ☐ | ☐ |  |
| `heining` | ☐ | ☐ |  |
| `hemao` | ☐ | ☐ |  |
| `hengliu` | ☐ | ☐ |  |
| `hewu` | ☐ | ☐ |  |
| `houxi` | ☐ | ☐ |  |
| `houyue` | ☐ | ☐ |  |
| `huainan` | ☐ | ☐ |  |
| `hukunxian` | ☐ | ☐ |  |
| `huning` | ☐ | ☐ |  |
| `husuhu` | ☐ | ☐ |  |
| `hutong` | ☐ | ☐ |  |
| `huzhune` | ☐ | ☐ |  |
| `jiajing` | ☐ | ☐ |  |
| `jiaojikezhuan` | ☐ | ☐ |  |
| `jiaojixian` | ☐ | ☐ |  |
| `jiaoliu` | ☐ | ☐ |  |
| `jiaoxin` | ☐ | ☐ |  |
| `jier` | ☐ | ☐ |  |
| `jingbin` | ☐ | ☐ |  |
| `jingguangxian` | ☐ | ☐ |  |
| `jinghaxian` | ☐ | ☐ |  |
| `jinghuxian` | ☐ | ☐ |  |
| `jingjin` | ☐ | ☐ |  |
| `jingjiu` | ☐ | ☐ |  |
| `jingshen` | ☐ | ☐ |  |
| `jingtang` | ☐ | ☐ |  |
| `jingtong` | ☐ | ☐ |  |
| `jingxiong` | ☐ | ☐ |  |
| `jingyuan` | ☐ | ☐ |  |
| `jinji` | ☐ | ☐ |  |
| `jinjian` | ☐ | ☐ |  |
| `jinqin` | ☐ | ☐ |  |
| `jiqing` | ☐ | ☐ |  |
| `kuibei` | ☐ | ☐ |  |
| `labin` | ☐ | ☐ |  |
| `laifu` | ☐ | ☐ |  |
| `lanqing` | ☐ | ☐ |  |
| `lanxinxian` | ☐ | ☐ |  |
| `lanyan` | ☐ | ☐ |  |
| `lianzhen` | ☐ | ☐ |  |
| `liunan` | ☐ | ☐ |  |
| `lizhan` | ☐ | ☐ |  |
| `longhai` | ☐ | ☐ |  |
| `longxia` | ☐ | ☐ |  |
| `longzhang` | ☐ | ☐ |  |
| `luobao` | ☐ | ☐ |  |
| `maozhan` | ☐ | ☐ |  |
| `mawu` | ☐ | ☐ |  |
| `meiji` | ☐ | ☐ |  |
| `meishan` | ☐ | ☐ |  |
| `mujia` | ☐ | ☐ |  |
| `musui` | ☐ | ☐ |  |
| `mutu` | ☐ | ☐ |  |
| `nanguang` | ☐ | ☐ |  |
| `nankunxian` | ☐ | ☐ |  |
| `nanlong` | ☐ | ☐ |  |
| `neikun` | ☐ | ☐ |  |
| `ningan` | ☐ | ☐ |  |
| `ningqi` | ☐ | ☐ |  |
| `ningrong` | ☐ | ☐ |  |
| `ningwu` | ☐ | ☐ |  |
| `ningxi` | ☐ | ☐ |  |
| `palian` | ☐ | ☐ |  |
| `panxing` | ☐ | ☐ |  |
| `panying` | ☐ | ☐ |  |
| `pingqi` | ☐ | ☐ |  |
| `qiangui` | ☐ | ☐ |  |
| `qianzhangchang` | ☐ | ☐ |  |
| `qinglian` | ☐ | ☐ |  |
| `qingyan` | ☐ | ☐ |  |
| `qinshen` | ☐ | ☐ |  |
| `shendan` | ☐ | ☐ |  |
| `shenmao` | ☐ | ☐ |  |
| `shide` | ☐ | ☐ |  |
| `shiji` | ☐ | ☐ |  |
| `shitai` | ☐ | ☐ |  |
| `shitai_xian` | ☐ | ☐ |  |
| `shuibang` | ☐ | ☐ |  |
| `suishen` | ☐ | ☐ |  |
| `suiyu` | ☐ | ☐ |  |
| `taijiao` | ☐ | ☐ |  |
| `taijiao_conv` | ☐ | ☐ |  |
| `taijiao_xian` | ☐ | ☐ |  |
| `taizhongyin` | ☐ | ☐ |  |
| `tongjiu` | ☐ | ☐ |  |
| `tongpu` | ☐ | ☐ |  |
| `tongrang` | ☐ | ☐ |  |
| `wangang` | ☐ | ☐ |  |
| `weilai` | ☐ | ☐ |  |
| `weiyan` | ☐ | ☐ |  |
| `wenfu` | ☐ | ☐ |  |
| `wuda` | ☐ | ☐ |  |
| `wugang` | ☐ | ☐ |  |
| `wujiu` | ☐ | ☐ |  |
| `wujiukezhuan` | ☐ | ☐ |  |
| `wushi` | ☐ | ☐ |  |
| `wuxian` | ☐ | ☐ |  |
| `wuxiao` | ☐ | ☐ |  |
| `xiangguikuoneng` | ☐ | ☐ |  |
| `xiangpu` | ☐ | ☐ |  |
| `xiangyu` | ☐ | ☐ |  |
| `xikang` | ☐ | ☐ |  |
| `xinchang` | ☐ | ☐ |  |
| `xintai` | ☐ | ☐ |  |
| `xinyan` | ☐ | ☐ |  |
| `xiping` | ☐ | ☐ |  |
| `xuanhang` | ☐ | ☐ |  |
| `yangan` | ☐ | ☐ |  |
| `yanshi` | ☐ | ☐ |  |
| `yayi` | ☐ | ☐ |  |
| `yingxia` | ☐ | ☐ |  |
| `yongtaiwen` | ☐ | ☐ |  |
| `yuhuai` | ☐ | ☐ |  |
| `yuwan` | ☐ | ☐ |  |
| `zhangquan` | ☐ | ☐ |  |
| `zhengji` | ☐ | ☐ |  |
| `zhengjiao` | ☐ | ☐ |  |
| `zhengkai` | ☐ | ☐ |  |
| `zhililu` | ☐ | ☐ |  |
