# 景点离轨修正日志

> 日期：2026-09-15 ｜ 规则：非 `on_track` 禁止贴轨；已离轨 ≥ 0.8 km 不动；问题点侧向约 2.8 km 或改用可信真值。

## 摘要

- 扫描景点：388
- 本次修改：158
- 跳过：230（含 on_track / 已准 / 保护名单）
- 写入：是（scenic-spots.json + patches）

## 修改明细

| id | 名称 | 方法 | 走廊 | 原离轨km | 新离轨km | 新坐标 |
|---|---|---|---|---:|---:|---|
| qaidam-gobi | 柴达木盆地戈壁 | perp_offset | geku | 0.466 | 2.83 | 94.734547, 36.433383 |
| zang-southeast-forest | 藏东南林海湿地 | perp_offset | lalin | 0.263 | 2.8 | 93.491548, 29.201564 |
| nyingchi-peach-blossom | 林芝桃花谷方向 | perp_offset | lalin | 0 | 2.8 | 94.337842, 29.553837 |
| lalin-sangri-valley | 桑日—加查河谷 | perp_offset | lalin | 0.59 | 2.8 | 92.306227, 29.269103 |
| yarlung-valley-lari | 雅鲁藏布江河谷（拉日段） | perp_offset | lari | 0.565 | 2.81 | 90.71153, 29.332581 |
| sanxingdui-area | 三星堆方向 | perp_offset | chuanqing | 0.202 | 2.8 | 104.091025, 31.069476 |
| hexi-corridor-gobi | 河西走廊戈壁 | perp_offset | lanxin | 0.059 | 2.8 | 100.408804, 38.900324 |
| zhangye-danxia-distant | 张掖丹霞方向（远眺） | truth_then_offset | lanxin | 0.457 | 2.8 | 100.145999, 39.079794 |
| emerald-lake-distant | 翡翠湖方向（大柴旦） | perp_offset | dunge | 0 | 2.8 | 95.2, 37.875153 |
| pamir-kashgar-distant | 帕米尔方向（喀什） | perp_offset | nanjiang | 0.356 | 2.83 | 76.076539, 39.481852 |
| shangri-la-plateau | 香格里拉高原 | perp_offset | lixiang | 0.019 | 2.81 | 99.662845, 27.801963 |
| mohan-border-gateway | 磨憨口岸门户 | perp_offset | zhonglao | 0.779 | 2.8 | 101.707239, 21.162537 |
| jinkouhe-canyon | 金口河峡谷 | truth_then_offset | chengkun | 0.229 | 2.8 | 103.031295, 29.25322 |
| hanzhong-basin | 汉中盆地花海 | perp_offset | xicheng | 0.216 | 2.84 | 107.99738, 33.481836 |
| fenghuang-ancient-town | 凤凰古城 | truth_then_offset | zhangjihuai | 0.011 | 2.8 | 109.628266, 28.022284 |
| zhenyuan-ancient-town | 镇远古城 | truth_then_offset | xiangqian | 0.109 | 2.8 | 108.438107, 27.026738 |
| yixian-ancient-villages | 黟县古村方向（宏村西递） | perp_offset | chihuang | 0.775 | 2.8 | 118.03526, 29.940228 |
| huangshan-north-portal | 黄山北门户 | perp_offset | hefu | 0.378 | 2.81 | 118.250098, 29.768516 |
| wanning-bays | 万宁石梅湾—日月湾方向 | perp_offset | hainandong | 0.094 | 2.8 | 110.359489, 18.751691 |
| changbai-mountain | 长白山 | truth_then_offset | dunbai | 0.019 | 1.84 | 128.143594, 42.440884 |
| yabuli-ski-distant | 亚布力滑雪场方向 | perp_offset | hamu | 0.195 | 2.8 | 128.306021, 44.994616 |
| ulat-cabl-volcano-grassland | 乌兰察布火山草原方向 | perp_offset | zhanghu | 0.382 | 2.8 | 113.151874, 40.938329 |
| badaling-great-wall | 八达岭长城 | truth_then_offset | jingzhang | 0.002 | 2.82 | 115.984627, 40.340591 |
| lalin-gongga-valley | 贡嘎—扎囊雅江河谷 | perp_offset | lalin | 0 | 2.44 | 91.402677, 29.266681 |
| lalin-shannan-canyon | 山南深切峡谷段 | perp_offset | lalin | 0 | 2.8 | 91.946039, 29.289584 |
| lalin-milin-peach | 米林桃花与河谷 | perp_offset | lalin | 0 | 2.79 | 92.919814, 29.080666 |
| lalin-nyingchi-gateway | 林芝雪域门户 | perp_offset | lalin | 0.007 | 1.75 | 94.400668, 29.488793 |
| heruo-hotan-oasis | 和田绿洲 | perp_offset | heruo | 0 | 2.8 | 79.915263, 37.185179 |
| heruo-desert-mid | 塔克拉玛干南缘铁龙 | perp_offset | heruo | 0 | 2.8 | 83.4432, 37.431194 |
| heruo-qiemo-desert | 且末沙漠旷野 | perp_offset | heruo | 0 | 2.8 | 85.537633, 38.218419 |
| heruo-ruoqiang-gateway | 若羌沙漠门户 | perp_offset | heruo | 0 | 2.81 | 88.164087, 39.005893 |
| fuping-changle-coast | 长乐滨海段 | perp_offset | fuping | 0 | 2.8 | 119.40949, 26.03169 |
| diandong-kaiyuan-metre | 开远米轨风情 | perp_offset | diandong | 0 | 2.09 | 103.167569, 23.896073 |
| diandong-yiliang-hills | 宜良坝子与山地 | perp_offset | diandong | 0 | 2.54 | 103.070329, 24.687737 |
| zhonglao-mojiang-hills | 墨江山地茶乡 | perp_offset | zhonglao | 0 | 2.8 | 101.883735, 23.489567 |
| baocheng-guangyuan-jialing | 广元嘉陵江 | perp_offset | baocheng | 0 | 2.8 | 105.148233, 32.017759 |
| zhangjihuai-guzhang-wuling | 古丈武陵山色 | perp_offset | zhangjihuai | 0 | 2.8 | 109.934625, 28.490663 |
| chuanqing-maoxian-gorge | 茂县岷江峡谷 | perp_offset | chuanqing | 0 | 2.76 | 103.692024, 32.340257 |
| chuanqing-gaochuan | 高川山地 | perp_offset | chuanqing | 0 | 2.79 | 104.180146, 31.681604 |
| dunge-yardang-rail | 雅丹地貌段 | perp_offset | dunge | 0 | 2.8 | 94.900227, 39.308303 |
| dunge-dangjinshan-rail | 当金山口 | perp_offset | dunge | 0 | 2.8 | 94.652183, 38.049674 |
| dunge-qaidam-salt | 柴达木盐湖盆地 | perp_offset | dunge | 0 | 2.8 | 95.464999, 37.535573 |
| yiwan-enshi-karst | 恩施岩溶山地 | perp_offset | yiwan | 0 | 2.8 | 109.992576, 30.573014 |
| yiwan-lichuan-plateau | 利川齐岳山一带 | perp_offset | yiwan | 0.48 | 2.64 | 108.687741, 30.330174 |
| dunbai-antu | 安图山地 | perp_offset | dunbai | 0 | 2.8 | 128.255354, 42.607918 |
| zhanghu-bashang-rail | 坝上草原 | perp_offset | zhanghu | 0 | 2.8 | 114.044135, 40.775734 |
| zhanghu-xinghe | 兴和草原过渡带 | perp_offset | zhanghu | 0 | 2.77 | 112.984088, 40.963487 |
| zhanghu-zhuozi | 卓资山地草原 | perp_offset | zhanghu | 0 | 2.8 | 112.33903, 40.955029 |
| jitong-hexigten-rail | 克什克腾草原 | perp_offset | jitong | 0 | 2.8 | 117.192186, 43.192553 |
| jitong-linxi | 林西山地草甸 | perp_offset | jitong | 0 | 1.32 | 119.191502, 43.789611 |
| linha-hexi-gobi | 临河—额济纳戈壁 | perp_offset | linha | 0 | 2.8 | 106.256162, 40.431178 |
| linha-badan-rail | 巴丹吉林沙漠边缘 | perp_offset | linha | 0 | 2.8 | 104.158357, 41.215962 |
| hainandong-qionghai | 琼海滨海平原 | perp_offset | hainandong | 0 | 2.8 | 110.486964, 18.934984 |
| hainandong-lingshui | 陵水近海段 | perp_offset | hainandong | 0 | 2.8 | 110.00912, 18.507224 |
| hainanxi-qiziwan | 棋子湾方向 | perp_offset | hainanxi | 0 | 2.8 | 108.78451, 19.215435 |
| hainanxi-dongfang-salt | 东方盐田 | perp_offset | hainanxi | 0 | 2.8 | 108.745545, 18.687687 |
| hainanxi-lingao | 临高滨海 | perp_offset | hainanxi | 0 | 2.8 | 109.649763, 19.821725 |
| hamu-shangzhi-forest | 尚志林海 | perp_offset | hamu | 0 | 2.8 | 127.882198, 45.243851 |
| hamu-hailin | 海林山地 | perp_offset | hamu | 0 | 2.78 | 128.691899, 44.927879 |
| nankun-puzhehei-rail | 普者黑喀斯特 | perp_offset | nankun | 0 | 2.8 | 103.830802, 23.823987 |
| nankun-funing-karst | 富宁峰林 | perp_offset | nankun | 0 | 2.8 | 105.883129, 23.670699 |
| lixiang-newshang | 丽江北上山地 | perp_offset | lixiang | 0 | 2.8 | 100.097472, 27.015725 |
| chengkun-liangshan | 大凉山峡谷 | perp_offset | chengkun | 0 | 2.53 | 102.75193, 28.950977 |
| chengkun-panzhihua | 攀枝花金沙江 | perp_offset | chengkun | 0 | 2.69 | 101.889823, 25.927352 |
| yuli-fuling | 涪陵长江库区 | perp_offset | yuli | 0 | 2.8 | 106.852898, 29.704187 |
| yuli-fengdu | 丰都库区山地 | perp_offset | yuli | 0 | 2.8 | 107.264333, 29.802907 |
| yuli-shizhu | 石柱山地 | perp_offset | yuli | 0 | 2.8 | 108.05338, 29.962111 |
| yuli-lichuan-portal | 利川齐岳山门户 | perp_offset | yuli | 0 | 2.7 | 108.772563, 30.234012 |
| jingzhang-qinghe | 清河出京段 | perp_offset | jingzhang | 0 | 2.8 | 116.17925, 40.159456 |
| jingzhang-huailai-valley | 怀来河谷 | perp_offset | jingzhang | 0 | 2.8 | 115.485737, 40.377303 |
| jingzhang-zhangjiakou-portal | 张家口坝上门户 | perp_offset | jingzhang | 0 | 2.8 | 114.871628, 40.72481 |
| lari-quxiu | 曲水雅江宽谷 | perp_offset | lari | 0 | 2.8 | 90.606972, 29.265922 |
| lari-nimu | 尼木河谷 | perp_offset | lari | 0 | 2.58 | 90.092552, 29.329105 |
| lari-renbu | 仁布山地 | perp_offset | lari | 0 | 2.52 | 89.499549, 29.309014 |
| guiguang-duyun | 都匀斗篷山方向 | perp_offset | guiguang | 0 | 2.8 | 109.725504, 25.6621 |
| guiguang-rongjiang | 榕江山地 | perp_offset | guiguang | 0 | 2.8 | 110.52988, 25.190014 |
| guiguang-hezhou | 贺州山水 | perp_offset | guiguang | 0 | 2.8 | 111.37475, 24.562028 |
| guiguang-zhaoqing | 肇庆星湖方向 | perp_offset | guiguang | 0 | 2.8 | 112.734504, 23.222438 |
| xiangqian-loudi | 娄底丘陵 | perp_offset | xiangqian | 0 | 2.8 | 111.832849, 27.585372 |
| xiangqian-xupu | 溆浦武陵谷地 | perp_offset | xiangqian | 0 | 2.79 | 110.611722, 27.587741 |
| xiangqian-huaihua | 怀化山地 | perp_offset | xiangqian | 0 | 2.8 | 109.179716, 27.370277 |
| xiashen-zhangzhou | 漳州滨海 | perp_offset | xiashen | 0 | 2.79 | 117.609298, 24.182989 |
| xiashen-yunxiao | 云霄沿海 | perp_offset | xiashen | 0 | 2.8 | 116.818353, 23.60454 |
| xiashen-shanwei | 汕尾红海湾方向 | perp_offset | xiashen | 0 | 2.8 | 115.416931, 22.789137 |
| xiashen-huizhou | 惠州南滨海 | perp_offset | xiashen | 0 | 2.75 | 114.616964, 22.818031 |
| lanyu-lanzhou-south | 兰州南缘黄土 | perp_offset | lanyu | 0 | 2.78 | 104.226751, 34.880486 |
| lanyu-guangyuan-rail | 广元蜀道 | perp_offset | lanyu | 0 | 2.8 | 105.865056, 32.484897 |
| lanyu-chongqing-approach | 重庆北前山城 | perp_offset | lanyu | 0 | 2.8 | 106.201754, 30.041921 |
| yinlan-wuzhong | 吴忠黄河灌区 | perp_offset | yinlan | 0 | 2.8 | 106.135822, 37.636947 |
| yinlan-zhongwei-rail | 中卫南沙漠边缘 | perp_offset | yinlan | 0 | 2.8 | 105.466398, 37.420606 |
| yinlan-jingtai | 景泰黄河石林方向 | perp_offset | yinlan | 0 | 2.8 | 104.765105, 36.742638 |
| yinlan-baiyin | 白银黄土丘陵 | perp_offset | yinlan | 0 | 2.79 | 104.205503, 36.454014 |
| nanjiang-korla-oasis | 库尔勒绿洲 | perp_offset | nanjiang | 0 | 2.8 | 86.178968, 41.720151 |
| nanjiang-luntai | 轮台胡杨与戈壁 | perp_offset | nanjiang | 0 | 2.8 | 83.663525, 41.775944 |
| nanjiang-aksu | 阿克苏绿洲 | perp_offset | nanjiang | 0 | 2.8 | 80.746524, 41.258125 |
| nanjiang-artux | 阿图什至喀什绿洲 | perp_offset | nanjiang | 0 | 2.8 | 78.598713, 39.835661 |
| kunli-chuxiong | 楚雄高原 | perp_offset | kunli | 0 | 2.8 | 101.41953, 25.07681 |
| kunli-xiangyun | 祥云坝子 | perp_offset | kunli | 0 | 2.8 | 100.88226, 25.323775 |
| kunli-heqing | 鹤庆田园 | perp_offset | kunli | 0 | 2.8 | 100.206181, 26.092609 |
| xicheng-foping | 佛坪秦岭腹地 | perp_offset | xicheng | 0 | 2.8 | 108.506464, 33.831156 |
| xicheng-ningqiang | 宁强南秦巴 | perp_offset | xicheng | 0 | 2.8 | 105.942188, 32.560397 |
| xicheng-jiangyou | 江油绵阳平原 | perp_offset | xicheng | 0 | 2.8 | 104.608457, 31.355834 |
| chenggui-leshan-rail | 乐山岷江 | perp_offset | chenggui | 0 | 2.8 | 104.023145, 29.315606 |
| chenggui-yibin | 宜宾江城 | perp_offset | chenggui | 0 | 2.8 | 104.533735, 28.805447 |
| chenggui-bijie | 毕节乌蒙 | perp_offset | chenggui | 0 | 2.8 | 105.147201, 27.616584 |
| geku-huatugou | 花土沟石油城戈壁 | perp_offset | geku | 0 | 2.8 | 91.434408, 37.951935 |
| geku-ruoqiang-rail | 若羌沙漠绿洲 | perp_offset | geku | 0 | 2.8 | 88.20721, 38.982492 |
| geku-yuli | 尉犁塔里木 | perp_offset | geku | 0 | 2.8 | 87.224608, 40.121112 |
| yinxi-wuzhong-rail | 吴忠宁东平原 | perp_offset | yinxi | 0 | 2.8 | 106.726946, 37.438796 |
| yinxi-guyuan | 固原六盘山方向 | perp_offset | yinxi | 0 | 2.8 | 107.470736, 36.427561 |
| yinxi-liupanshan | 六盘山段 | perp_offset | yinxi | 0 | 2.8 | 107.644222, 35.727426 |
| yinxi-qingyang | 庆阳黄土高原 | perp_offset | yinxi | 0 | 2.8 | 108.150109, 34.679822 |
| zhengyu-nanyang | 南阳盆地 | truth | zhengyu | 0 | 15.34 | 112.5, 32.3 |
| zhengyu-xingshan | 兴山三峡山地 | perp_offset | zhengyu | 0 | 2.73 | 110.947527, 31.695668 |
| zhengyu-wushan | 巫山峡谷 | perp_offset | zhengyu | 0 | 2.8 | 109.565273, 31.060175 |
| zhengyu-wanzhou | 万州库区 | perp_offset | zhengyu | 0 | 2.78 | 107.947333, 30.724697 |
| qingrong-jimo | 即墨滨海 | perp_offset | qingrong | 0 | 2.8 | 120.408785, 36.651373 |
| qingrong-haiyang | 海阳海岸方向 | perp_offset | qingrong | 0 | 2.79 | 120.956588, 37.098017 |
| qingrong-yantai | 烟台滨海 | perp_offset | qingrong | 0 | 2.79 | 121.306636, 37.409558 |
| qingrong-weihai | 威海海岸 | perp_offset | qingrong | 0 | 2.8 | 121.773364, 37.46139 |
| qingrong-rongcheng | 荣成天尽头方向 | perp_offset | qingrong | 0 | 2.8 | 122.43397, 37.146296 |
| rilan-rizhao | 日照海滨方向 | perp_offset | rilan | 0 | 2.8 | 119.443388, 35.381539 |
| rilan-linyi | 临沂沂蒙 | perp_offset | rilan | 0 | 2.8 | 118.293574, 35.181777 |
| rilan-heze | 菏泽平原 | perp_offset | rilan | 0 | 2.8 | 115.44044, 35.103693 |
| shanghehang-huainan | 淮南江淮 | perp_offset | shanghehang | 0 | 2.8 | 117.113138, 32.561924 |
| shanghehang-chaohu | 巢湖方向 | truth | shanghehang | 0 | 17.91 | 117.522739, 31.5282 |
| shanghehang-wuhu | 芜湖长江 | perp_offset | shanghehang | 0 | 2.78 | 118.818768, 30.94515 |
| shanghehang-xuancheng | 宣城皖南 | perp_offset | shanghehang | 0 | 2.8 | 119.795735, 30.873961 |
| hukun-yiwu | 义乌金华丘陵 | perp_offset | hukun | 0 | 2.8 | 119.979788, 29.282711 |
| hukun-shangrao | 上饶信江 | perp_offset | hukun | 0 | 2.8 | 117.389024, 28.38395 |
| ninghang-liyang | 溧阳天目湖方向 | perp_offset | ninghang | 0 | 2.5 | 119.126501, 31.679594 |
| ninghang-yixing-rail | 宜兴陶都山水 | perp_offset | ninghang | 0 | 2.8 | 119.886281, 31.292257 |
| ninghang-huzhou-rail | 湖州太湖南缘 | perp_offset | ninghang | 0 | 2.8 | 120.046653, 30.816183 |
| huhang-jiashan | 嘉善—嘉兴水乡 | perp_offset | huhang | 0 | 2.8 | 120.752584, 30.638809 |
| huhang-haining | 海宁西钱塘方向 | perp_offset | huhang | 0 | 2.8 | 120.429114, 30.443133 |
| huhang-hangzhou-portal | 杭州东门户 | perp_offset | huhang | 0 | 2.8 | 120.186724, 30.277021 |
| hangtai-tiantaishan | 天台山 | truth | hangtai | 0 | 7.7 | 121.042214, 29.178844 |
| hangtai-shengzhou | 嵊州新昌山水 | perp_offset | hangtai | 0 | 2.8 | 120.825747, 29.949664 |
| hangwen-nanxijiang | 楠溪江 | perp_offset | hangwen | 0 | 2.8 | 120.605506, 28.927846 |
| guinan-libo | 荔波喀斯特 | perp_offset | guinan | 0 | 2.8 | 108.185379, 24.653464 |
| guinan-dushan | 独山山地 | perp_offset | guinan | 0 | 2.8 | 107.722589, 25.648223 |
| haida-bayuquan | 鲅鱼圈渤海 | perp_offset | haida | 0 | 2.8 | 122.03993, 40.069875 |
| haida-dalian-coast | 大连滨海 | perp_offset | haida | 0 | 2.82 | 121.627625, 38.996751 |
| jingha-chengde-distant | 承德避暑山庄方向 | perp_offset | jingha | 0 | 2.8 | 120.163566, 41.47315 |
| jingha-changchun-plain | 长春平原雪原 | perp_offset | jingha | 0 | 2.8 | 125.010105, 43.754922 |
| xulian-lianyungang | 连云港海滨 | perp_offset | xulian | 0 | 2.83 | 119.14041, 34.632476 |
| zhengtai-taihang | 太行山晋城段 | perp_offset | zhengtai | 0 | 2.42 | 113.067595, 36.04799 |
| zhengtai-changzhi | 长治上党盆地 | perp_offset | zhengtai | 0 | 2.8 | 113.071152, 36.670487 |
| guangshengang-humen | 虎门珠江口 | perp_offset | guangshengang | 0 | 2.8 | 113.716177, 22.893146 |
| guangshengang-hongkong-distant | 香港西九龙门户 | perp_offset | guangshengang | 0 | 2.8 | 114.191454, 22.305673 |
| fuxia-putian | 莆田湄洲湾方向 | perp_offset | fuxia | 0 | 2.8 | 119.083473, 25.346476 |
| fuxia-quanzhou | 泉州海丝方向 | perp_offset | fuxia | 0 | 2.8 | 118.444199, 24.620768 |
| yantong-dafeng-wetland | 大丰麋鹿湿地方向 | perp_offset | yantong | 0 | 2.8 | 120.361172, 32.923126 |
| huningyanjiang-jiangyin | 江阴长江 | perp_offset | huningyanjiang | 0 | 2.8 | 120.107011, 31.709523 |
| jingguang-yellow-river | 黄河郑州段方向 | perp_offset | jingguang | 0 | 2.8 | 113.971342, 33.726356 |
| jingguang-wuhan-yangtze | 武汉长江方向 | perp_offset | jingguang | 0 | 2.8 | 114.396013, 29.959222 |
| jinghu-nanjing-yangtze | 南京长江 | perp_offset | jinghu | 0 | 2.79 | 118.683366, 31.952487 |
| chengyu-chongqing-hills | 重庆西山城丘陵 | perp_offset | chengyu | 0 | 2.8 | 106.464119, 29.580845 |

## 保护/跳过样例（不完整）

- `qinghai-lake`: protected_precise
- `yuzhu-peak`: protected_precise
- `kekexili`: already_off_rail (1.29 km)
- `wudaoliang`: already_off_rail (2.21 km)
- `tuotuohe-source`: already_off_rail (39.94 km)
- `tongtian-river`: already_off_rail (7.31 km)
- `sanjiangyuan`: already_off_rail (0.94 km)
- `geladandong`: protected_precise
- `cuona-lake`: already_off_rail (2.91 km)
- `qiangtang-grassland`: already_off_rail (3.24 km)
- `nyainqentanglha`: already_off_rail (19.25 km)
- `namtso-distant`: already_off_rail (47.02 km)
- `yangbajing-geothermal`: already_off_rail (1.92 km)
- `yarlung-tsangpo-gorge-lalin`: already_off_rail (1.97 km)
- `namcha-barwa-distant`: already_off_rail (62.74 km)
- `yamdrok-distant`: already_off_rail (2.72 km)
- `shigatse-plain`: already_off_rail (2.23 km)
- `minjiang-gorge-chuanqing`: already_off_rail (1.52 km)
- `songpan-grassland`: already_off_rail (10.88 km)
- `huanglong-jiuzhai-portal`: already_off_rail (8 km)
- `menyuan-rapeseed`: already_off_rail (4 km)
- `qilian-snow-lanxin`: already_off_rail (21.8 km)
- `jiayuguan-fort-distant`: already_off_rail (10.76 km)
- `turpan-flaming-mountain`: already_off_rail (12.43 km)
- `hami-oasis`: already_off_rail (1.46 km)
- `dunhuang-mogao-distant`: already_off_rail (9.29 km)
- `yardang-geomorphology`: already_off_rail (75.85 km)
- `dangjinshan-pass`: already_off_rail (47.39 km)
- `altun-mountains`: already_off_rail (65.35 km)
- `taklamakan-south-geku`: already_off_rail (1.25 km)
- `taitema-lake`: already_off_rail (32.13 km)
- `taklamakan-ring-heruo`: already_off_rail (8.31 km)
- `kunlun-north-foothill`: already_off_rail (2.81 km)
- `desert-sunset-heruo`: already_off_rail (64.21 km)
- `tianshan-south-nanjiang`: already_off_rail (2.7 km)
- `bosten-lake-distant`: already_off_rail (37.67 km)
- `kuqa-canyon-distant`: already_off_rail (41.97 km)
- `tarim-oasis-belt`: already_off_rail (0.96 km)
- `ejina-populus`: already_off_rail (4.88 km)
- `badan-jaran-edge`: already_off_rail (9.9 km)
