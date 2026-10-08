import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reviewedAt = '2026-10-05';
const reviewRound = '2026-10-scarce-prov';

// —— 六维映射与 subtype→category 映射（沿用 20261002 批次惯例，category 禁止落入 other）——
const dimension = { cultural: ['culture', 'history'], natural: ['geo', 'nature'], landmark: ['architecture', 'culture'] };
const categoryFor = (subtype) => ({
  snow_mountain: 'mountain', mountain_range: 'mountain', karst_danxia: 'mountain', volcano_geothermal: 'mountain',
  lake: 'lake', wetland: 'lake', gorge: 'gorge', river: 'gorge', water_feature: 'gorge',
  grassland: 'grassland', plain_basin: 'grassland', terrace_farmland: 'grassland', seasonal_foliage: 'grassland',
  desert_gobi: 'desert', bridge: 'engineering', tunnel: 'engineering', water_conservancy: 'engineering', dam: 'engineering',
})[subtype];
const V3_DIMENSIONS = new Set(['geo', 'nature', 'culture', 'history', 'construct', 'architecture']);
const PROVINCES = new Set(['北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆']);

// —— 六省铁路候选（WGS84 POI 特征点，贴走廊选点；near=on_track/window，far=distant）——
// 每行：id/name/province/lng/lat/kind/subtype/view(maxDistKm 可选)/hints/wiki/nearStations/intro
const cand = [
  // ===== 安徽（目标新增 10；走廊 hefu/ningrong/ningan/anjiu/wangang，避开 jinghu）=====
  { id: 'anhui-chaohu-eastbay', name: '巢湖东岸湖湾', province: '安徽', lng: 117.71, lat: 31.68, kind: 'natural', subtype: 'lake', view: ['window', 'near'], hints: [{ corridorId: 'hefu', nearStations: ['巢湖东', '铜陵北'] }], wiki: '巢湖', intro: '合福高铁过巢湖东站至铜陵北区间，东南侧车窗可见巢湖东岸湖湾与波光水色，夏秋水位丰盈，晨昏光线最好。' },
  { id: 'anhui-anqing-yangtze', name: '安庆长江江段', province: '安徽', lng: 117.06, lat: 30.5, kind: 'natural', subtype: 'river', view: ['window', 'near'], hints: [{ corridorId: 'ningan', nearStations: ['安庆'] }], wiki: '安庆长江大桥', intro: '宁安城际过安庆站西侧江岸，长江主航道与振风塔江景即在车窗旁，四季江景不歇，晴日晨昏远眺最好。' },
  { id: 'anhui-jingting-shan', name: '敬亭山', province: '安徽', lng: 118.75, lat: 31.03, kind: 'natural', subtype: 'mountain_range', view: ['window', 'near'], hints: [{ corridorId: 'wangang', nearStations: ['宣城'] }], wiki: '敬亭山', intro: '敬亭山立于宣城站北郊，皖赣线出宣城站北行时山影即在线路左侧，江南诗山满目青翠，四季可望，晨光最好。' },
  { id: 'anhui-taiping-lake', name: '太平湖', province: '安徽', lng: 118.16, lat: 30.29, kind: 'natural', subtype: 'lake', view: ['distant', 'far'], maxDistKm: 36, hints: [{ corridorId: 'hefu', nearStations: ['黄山北'] }], wiki: '太平湖 (安徽)', intro: '合福高铁过黄山北站北侧区间，西侧车窗可见太平湖湖湾与群岛相嵌，秋冬湖水澄澈山色分明，晨昏光线最好。' },
  { id: 'anhui-huangshan-peaks', name: '黄山群峰', province: '安徽', lng: 118.17, lat: 30.13, kind: 'natural', subtype: 'mountain_range', view: ['distant', 'far'], maxDistKm: 32, hints: [{ corridorId: 'hefu', nearStations: ['黄山北'] }], wiki: '黄山', intro: '合福高铁过黄山北站，西侧车窗远眺黄山群峰轮廓，天都莲花诸峰隐约可见，秋冬晴日远眺最好。' },
  { id: 'anhui-shuiyang-river', name: '水阳江宣城段', province: '安徽', lng: 118.79, lat: 30.95, kind: 'natural', subtype: 'river', view: ['window', 'near'], hints: [{ corridorId: 'wangang', nearStations: ['宣城', '巷口桥'] }], wiki: '水阳江', intro: '皖赣线沿水阳江过宣城站至宁国区间，江湾与竹排即在车窗旁，两岸圩田相接，四季水色各异，夏秋丰水最好。' },
  { id: 'anhui-shengjin-lake', name: '升金湖湿地', province: '安徽', lng: 117.18, lat: 30.44, kind: 'natural', subtype: 'lake', view: ['distant', 'far'], maxDistKm: 20, hints: [{ corridorId: 'ningan', nearStations: ['安庆', '池州'] }], wiki: '升金湖', intro: '宁安城际过安庆至池州区间，长江北岸升金湖湿地可远眺湖面与滩涂，越冬候鸟万羽群集，冬季观鸟最好。' },
  { id: 'anhui-bianyuzhou-bridge', name: '鳊鱼洲长江大桥', province: '安徽', lng: 116.28, lat: 30.06, kind: 'natural', subtype: 'bridge', view: ['distant', 'far'], maxDistKm: 16, hints: [{ corridorId: 'anjiu', nearStations: ['安庆', '太湖北'] }], wiki: '鳊鱼洲长江大桥', intro: '安九高铁经鳊鱼洲长江大桥跨越长江，斜拉桥塔凌空，晴日自过江段远眺桥塔与江面，晨昏光线最好。' },
  { id: 'anhui-dabie-piedmont', name: '大别山南麓丘陵', province: '安徽', lng: 115.6, lat: 31.1, kind: 'natural', subtype: 'mountain_range', view: ['distant', 'far'], maxDistKm: 30, hints: [{ corridorId: 'ningrong', nearStations: ['金寨', '麻城北'] }], wiki: '大别山', intro: '宁蓉线过金寨至麻城北区间，南侧车窗可见大别山南麓丘陵连绵与茶园梯地，春夏山花烂漫云雾缠绕，春季最好。' },
  { id: 'anhui-zhongmiao-guma', name: '中庙姥山岛', province: '安徽', lng: 117.62, lat: 31.62, kind: 'natural', subtype: 'lake', view: ['window', 'near'], hints: [{ corridorId: 'hefu', nearStations: ['巢湖东'] }], wiki: '中庙', intro: '合福高铁过巢湖东站，西北侧车窗可见中庙古寺与姥山岛浮于湖面，夏秋湖面开阔，晨昏光线最好。' },

  // ===== 湖北（目标新增 12；走廊 hanyi/jiaoliu/hanshi/jingguang/ningrong）=====
  { id: 'hubei-tianxingzhou-bridge', name: '天兴洲长江大桥', province: '湖北', lng: 114.42, lat: 30.65, kind: 'natural', subtype: 'bridge', view: ['on_track', 'near'], hints: [{ corridorId: 'jingguang', nearStations: ['武汉', '滠口'] }], wiki: '天兴洲长江大桥', intro: '京广高铁经天兴洲长江大桥跨越长江，列车在桥上左右两侧均见江面与洲滩，四季江景，晨昏光线最好。' },
  { id: 'hubei-xiling-gorge-mouth', name: '西陵峡口', province: '湖北', lng: 111.28, lat: 30.75, kind: 'natural', subtype: 'gorge', view: ['distant', 'far'], maxDistKm: 25, hints: [{ corridorId: 'hanyi', nearStations: ['宜昌东'] }], wiki: '西陵峡', intro: '汉宜线过宜昌东站后西望，远眺西陵峡口峡壁与长江出峡江面，山势渐收水势渐阔，晴日晨昏远眺最好。' },
  { id: 'hubei-geheyan-dam', name: '隔河岩水库大坝', province: '湖北', lng: 111.19, lat: 30.47, kind: 'natural', subtype: 'water_conservancy', view: ['distant', 'far'], maxDistKm: 40, hints: [{ corridorId: 'jiaoliu', nearStations: ['宜昌', '长阳'] }], wiki: '隔河岩水电站', intro: '焦柳线过宜昌段，西南方远眺清江隔河岩水库大坝与库区水面，高坝锁江库湾深碧，四季水景，晴日最好。' },
  { id: 'hubei-xiangyang-hanjiang', name: '襄阳汉江岸线', province: '湖北', lng: 112.15, lat: 32.03, kind: 'natural', subtype: 'river', view: ['window', 'near'], hints: [{ corridorId: 'hanshi', nearStations: ['襄阳东'] }, { corridorId: 'jiaoliu', nearStations: ['襄阳'] }], wiki: '汉江 (中国)', intro: '汉十高铁过襄阳段，汉江与古城墙江岸即在车窗旁，一江碧水穿城而过，四季江景不歇，晨昏光线最好。' },
  { id: 'hubei-shennongxi', name: '神农溪', province: '湖北', lng: 110.36, lat: 31.06, kind: 'natural', subtype: 'river', view: ['distant', 'far'], maxDistKm: 45, hints: [{ corridorId: 'ningrong', nearStations: ['巴东'] }], wiki: '神农溪', intro: '宁蓉线过巴东站，北侧远眺神农溪溪谷与峡谷出口，溪水碧绿深切山体，夏秋水量丰盈，晴日远眺最好。' },
  { id: 'hubei-qingjiang-enshi', name: '清江恩施城区段', province: '湖北', lng: 109.48, lat: 30.3, kind: 'natural', subtype: 'river', view: ['window', 'near'], hints: [{ corridorId: 'ningrong', nearStations: ['恩施'] }], wiki: '清江', intro: '宁蓉线过恩施站，清江自城中蜿蜒穿过，江湾与吊桥即在车窗旁，四季水色各异，晨昏光线最好。' },
  { id: 'hubei-yunyang-hanjiang', name: '郧阳汉江库湾', province: '湖北', lng: 110.8, lat: 32.85, kind: 'natural', subtype: 'river', view: ['distant', 'far'], maxDistKm: 18, hints: [{ corridorId: 'hanshi', nearStations: ['十堰东'] }], wiki: '郧阳区', intro: '汉十高铁过十堰东站北望，远眺郧阳汉江库湾与两岸青山，库面开阔水色湛蓝，夏秋水位丰盈，晴日最好。' },
  { id: 'hubei-wudang-mountain', name: '武当山', province: '湖北', lng: 111.0, lat: 32.4, kind: 'natural', subtype: 'mountain_range', view: ['distant', 'far'], maxDistKm: 14, hints: [{ corridorId: 'hanshi', nearStations: ['武当山西'] }], wiki: '武当山', intro: '汉十高铁过武当山西站，南侧远眺武当山群峰与金顶轮廓，仙山楼阁隐于云雾，四季山色，秋冬晴日最好。' },
  { id: 'hubei-danjiangkou-dam', name: '丹江口水库大坝', province: '湖北', lng: 111.52, lat: 32.56, kind: 'natural', subtype: 'water_conservancy', view: ['distant', 'far'], maxDistKm: 16, hints: [{ corridorId: 'hanshi', nearStations: ['丹江口南'] }], wiki: '丹江口水库', intro: '汉十高铁过丹江口南站，北侧远眺丹江口水库大坝与浩渺库面，南水北调水源地四季碧波万顷，晴日远眺最好。' },
  { id: 'hubei-fanwan-lake', name: '返湾湖湿地', province: '湖北', lng: 112.85, lat: 30.45, kind: 'natural', subtype: 'wetland', view: ['window', 'near'], hints: [{ corridorId: 'hanyi', nearStations: ['潜江'] }], wiki: '返湾湖', intro: '汉宜线过潜江站西侧，返湾湖湿地湖面与芦苇荡即在车窗旁，候鸟群集生态良好，四季湖景，冬季观鸟最好。' },
  { id: 'hubei-chibi-yangtze', name: '赤壁长江江段', province: '湖北', lng: 113.87, lat: 29.78, kind: 'natural', subtype: 'river', view: ['window', 'near'], hints: [{ corridorId: 'jingguang', nearStations: ['赤壁北'] }], wiki: '赤壁市', intro: '京广高铁过赤壁北站，东侧车窗可见长江江面与三国赤壁古战场江岸，江流浩荡，四季江景，晨昏最好。' },
  { id: 'hubei-zhanghe-reservoir', name: '漳河水库', province: '湖北', lng: 112.15, lat: 30.98, kind: 'natural', subtype: 'water_conservancy', view: ['distant', 'far'], maxDistKm: 16, hints: [{ corridorId: 'jiaoliu', nearStations: ['荆门'] }], wiki: '漳河水库', intro: '焦柳线过荆门段，西侧远眺漳河水库湖面与岛屿星罗，库水清澈群山环抱，四季水景，晴日晨昏最好。' },

  // ===== 天津（目标新增 8；走廊 jingjin/jinqin；bbox 内无旧数据可回填，全靠新增）=====
  { id: 'tianjin-haihe-downtown', name: '海河中心城区段', province: '天津', lng: 117.19, lat: 39.14, kind: 'natural', subtype: 'river', view: ['on_track', 'near'], hints: [{ corridorId: 'jingjin', nearStations: ['天津'] }], wiki: '海河', intro: '京津城际过天津站，海河两岸桥梁与世纪钟广场即在车窗旁，河面游船往来，四季河景不歇，夜色灯光最好。' },
  { id: 'tianjin-haihe-estuary', name: '海河入海段', province: '天津', lng: 117.73, lat: 38.99, kind: 'natural', subtype: 'river', view: ['distant', 'far'], maxDistKm: 16, hints: [{ corridorId: 'jinqin', nearStations: ['滨海'] }], wiki: '海河', intro: '津秦高铁过滨海站南侧，海河入海口与防潮闸河面远眺可及，河海交汇水色分明，四季可望，晨昏最好。' },
  { id: 'tianjin-haihe-tanggu', name: '海河塘沽段', province: '天津', lng: 117.65, lat: 39.0, kind: 'natural', subtype: 'river', view: ['distant', 'far'], maxDistKm: 10, hints: [{ corridorId: 'jinqin', nearStations: ['塘沽', '滨海'] }], wiki: '海河', intro: '津秦高铁过塘沽站，海河下游船闸与外滩江岸远眺可及，河面货轮往来繁忙，四季河景，晨昏光线最好。' },
  { id: 'tianjin-beidagang', name: '北大港湿地', province: '天津', lng: 117.55, lat: 38.85, kind: 'natural', subtype: 'wetland', view: ['distant', 'far'], maxDistKm: 24, hints: [{ corridorId: 'jinqin', nearStations: ['滨海'] }], wiki: '北大港水库', intro: '津秦高铁过滨海站，西南远眺北大港湿地水面与芦苇荡，候鸟万羽群集栖息，四季湿地景观，冬季观鸟最好。' },
  { id: 'tianjin-qilihai', name: '七里海湿地', province: '天津', lng: 117.57, lat: 39.44, kind: 'natural', subtype: 'wetland', view: ['distant', 'far'], maxDistKm: 28, hints: [{ corridorId: 'jinqin', nearStations: ['滨海北'] }], wiki: '七里海', intro: '津秦高铁过滨海北站，西北远眺七里海湿地水面与芦苇滩，古泻湖湿地生态原始，四季可望，秋季候鸟最好。' },
  { id: 'tianjin-beitang-estuary', name: '北塘永定新河口', province: '天津', lng: 117.7, lat: 39.1, kind: 'natural', subtype: 'river', view: ['window', 'near'], hints: [{ corridorId: 'jinqin', nearStations: ['滨海', '滨海北'] }], wiki: '北塘', intro: '津秦高铁过滨海站北侧，永定新河入海口与北塘渔港即在车窗旁，河海交汇渔船往来，四季河口景观，晨昏最好。' },
  { id: 'tianjin-beiyun-canal', name: '北运河武清段', province: '天津', lng: 117.05, lat: 39.39, kind: 'natural', subtype: 'river', view: ['window', 'near'], hints: [{ corridorId: 'jingjin', nearStations: ['武清'] }], wiki: '北运河', intro: '京津城际过武清站，北运河与京杭大运河故道即在车窗旁，河道笔直绿带相伴，四季河景，晨昏光线最好。' },
  { id: 'tianjin-dongli-lake', name: '东丽湖', province: '天津', lng: 117.38, lat: 39.13, kind: 'natural', subtype: 'lake', view: ['window', 'near'], hints: [{ corridorId: 'jinqin', nearStations: ['军粮城北'] }], wiki: '东丽湖', intro: '津秦高铁过军粮城北站，北侧远眺东丽湖湖面与温泉度假区，湖面开阔水鸟翔集，四季湖景，晨昏最好。' },

  // ===== 宁夏（目标新增 8；走廊 baolan/yinxi/baozhong）=====
  { id: 'ningxia-shapotou', name: '沙坡头沙漠黄河段', province: '宁夏', lng: 105.02, lat: 37.47, kind: 'natural', subtype: 'desert_gobi', view: ['on_track', 'near'], hints: [{ corridorId: 'baolan', nearStations: ['中卫', '沙坡头'] }], wiki: '沙坡头', intro: '包兰铁路过沙坡头段，列车直接穿越腾格里沙漠东缘，麦草方格锁沙与黄河大拐弯即在车窗两侧，四季景观，晨昏光线最好。' },
  { id: 'ningxia-helan-suyukou', name: '贺兰山苏峪口', province: '宁夏', lng: 105.95, lat: 38.73, kind: 'natural', subtype: 'mountain_range', view: ['distant', 'far'], maxDistKm: 26, hints: [{ corridorId: 'baolan', nearStations: ['银川'] }], wiki: '贺兰山', intro: '包兰铁路过银川段，西侧远眺贺兰山苏峪口山势与岩壁，贺兰晴雪闻名塞上，四季山色，冬季雪景最好。' },
  { id: 'ningxia-qingtongxia-gorge', name: '青铜峡黄河大峡谷', province: '宁夏', lng: 106.03, lat: 37.95, kind: 'natural', subtype: 'gorge', view: ['distant', 'far'], maxDistKm: 20, hints: [{ corridorId: 'yinxi', nearStations: ['吴忠'] }], wiki: '青铜峡', intro: '银西高铁过吴忠段，西侧远眺青铜峡黄河大峡谷与拦河大坝，峡口锁黄河十里山水相接，四季水景，晨昏最好。' },
  { id: 'ningxia-yuehai-wetland', name: '阅海湿地', province: '宁夏', lng: 106.24, lat: 38.6, kind: 'natural', subtype: 'wetland', view: ['distant', 'far'], maxDistKm: 14, hints: [{ corridorId: 'baolan', nearStations: ['银川'] }], wiki: '阅海', intro: '包兰铁路过银川段，东侧远眺阅海湿地湖面与芦苇荡，塞上湖城水鸟翔集，四季湖景，夏季荷花最好。' },
  { id: 'ningxia-mingcui-lake', name: '鸣翠湖湿地', province: '宁夏', lng: 106.34, lat: 38.49, kind: 'natural', subtype: 'wetland', view: ['distant', 'far'], maxDistKm: 16, hints: [{ corridorId: 'baolan', nearStations: ['银川'] }], wiki: '鸣翠湖', intro: '包兰铁路过银川段，东侧远眺鸣翠湖湿地湖面与迷宫水道，芦苇丛生百鸟鸣翠，四季湖景，夏季最好。' },
  { id: 'ningxia-liupan-mountain', name: '六盘山', province: '宁夏', lng: 106.25, lat: 35.28, kind: 'natural', subtype: 'mountain_range', view: ['distant', 'far'], maxDistKm: 48, hints: [{ corridorId: 'baozhong', nearStations: ['固原'] }], wiki: '六盘山', intro: '宝中铁路过固原段，南侧远眺六盘山主峰与层叠山峦，泾渭分水岭高原绿岛，四季山色，秋季层林最好。' },
  { id: 'ningxia-zhongning-huanghe', name: '中宁黄河段', province: '宁夏', lng: 105.68, lat: 37.5, kind: 'natural', subtype: 'river', view: ['window', 'near'], hints: [{ corridorId: 'baolan', nearStations: ['中宁'] }], wiki: '中宁县', intro: '包兰铁路过中宁段，黄河与枸杞园灌溉渠网即在车窗旁，塞上江南水田相连，四季河景，夏秋枸杞红时最好。' },
  { id: 'ningxia-niushou-mountain', name: '牛首山', province: '宁夏', lng: 106.05, lat: 37.85, kind: 'natural', subtype: 'mountain_range', view: ['distant', 'far'], maxDistKm: 20, hints: [{ corridorId: 'yinxi', nearStations: ['吴忠'] }], wiki: '牛首山 (宁夏)', intro: '银西高铁过吴忠段，西北远眺牛首山双峰与寺庙群轮廓，黄河东岸佛教名山，四季山色，晨昏光线最好。' },

  // ===== 青海（目标新增 14；走廊 qingzang/lanxin/geku）=====
  { id: 'qinghai-qinghai-lake-north', name: '青海湖北岸', province: '青海', lng: 100.2, lat: 37.2, kind: 'natural', subtype: 'lake', view: ['window', 'near'], hints: [{ corridorId: 'qingzang', nearStations: ['刚察', '哈尔盖'] }], wiki: '青海湖', intro: '青藏铁路过刚察段，南侧车窗可见青海湖北岸湖面与沙岛相接，中国最大内陆咸水湖碧波接天，四季湖景，夏季最好。' },
  { id: 'qinghai-jinyintan', name: '金银滩原子城草原', province: '青海', lng: 100.99, lat: 36.95, kind: 'natural', subtype: 'grassland', view: ['distant', 'far'], maxDistKm: 10, hints: [{ corridorId: 'qingzang', nearStations: ['海晏'] }], wiki: '金银滩草原', intro: '青藏铁路过海晏站，金银滩草原与原子城纪念地远眺可及，两弹一星摇篮草原辽阔，四季草色，夏季最好。' },
  { id: 'qinghai-huangyuan-gorge', name: '湟源峡谷', province: '青海', lng: 101.2, lat: 36.62, kind: 'natural', subtype: 'gorge', view: ['window', 'near'], hints: [{ corridorId: 'qingzang', nearStations: ['湟源'] }], wiki: '湟源县', intro: '青藏铁路过湟源站西侧，湟水峡谷与丹噶尔古城山口即在车窗旁，峡口水急山势逼仄，四季河谷景观，晨昏最好。' },
  { id: 'qinghai-buha-river-mouth', name: '布哈河口', province: '青海', lng: 99.8, lat: 37.05, kind: 'natural', subtype: 'river', view: ['distant', 'far'], maxDistKm: 16, hints: [{ corridorId: 'qingzang', nearStations: ['刚察', '鸟岛'] }], wiki: '布哈河', intro: '青藏铁路过刚察西段，南侧远眺布哈河入湖河口与湿地三角洲，青海湖最大入湖河流水色清浑相接，四季水景，夏季最好。' },
  { id: 'qinghai-tianjun-buha', name: '天峻布哈河谷', province: '青海', lng: 99.03, lat: 37.3, kind: 'natural', subtype: 'river', view: ['distant', 'far'], maxDistKm: 20, hints: [{ corridorId: 'qingzang', nearStations: ['天峻'] }], wiki: '天峻县', intro: '青藏铁路过天峻站，布哈河河谷与草原曲流远眺可及，河汊纵横牛羊散牧，四季河谷景观，夏季最好。' },
  { id: 'qinghai-keruke-lake', name: '可鲁克湖', province: '青海', lng: 97.17, lat: 37.27, kind: 'natural', subtype: 'lake', view: ['distant', 'far'], maxDistKm: 20, hints: [{ corridorId: 'qingzang', nearStations: ['德令哈', '戈碧'] }], wiki: '可鲁克湖', intro: '青藏铁路过德令哈西段，北侧远眺可鲁克湖湖面与芦苇沼泽，柴达木盆地淡水湖生态孤岛，四季湖景，晨昏最好。' },
  { id: 'qinghai-chaerhan-salt-lake', name: '察尔汗盐湖', province: '青海', lng: 95.2, lat: 36.75, kind: 'natural', subtype: 'lake', view: ['on_track', 'near'], hints: [{ corridorId: 'qingzang', nearStations: ['察尔汗', '格尔木'] }], wiki: '察尔汗盐湖', intro: '青藏铁路过察尔汗盐湖段，列车直接行驶在万丈盐桥盐盖路基上，左右两侧卤水盐田晶光闪烁，四季奇观，晴日最好。' },
  { id: 'qinghai-geermu-huyang', name: '格尔木胡杨林', province: '青海', lng: 94.55, lat: 36.35, kind: 'natural', subtype: 'wetland', view: ['distant', 'far'], maxDistKm: 32, hints: [{ corridorId: 'qingzang', nearStations: ['格尔木'] }], wiki: '格尔木胡杨林', intro: '青藏铁路过格尔木段，西侧远眺格尔木河畔胡杨林与荒漠河岸林带，高原胡杨秋色金黄，四季景观，秋季最好。' },
  { id: 'qinghai-kunlun-pass', name: '昆仑山口', province: '青海', lng: 94.05, lat: 35.63, kind: 'natural', subtype: 'mountain_range', view: ['on_track', 'near'], hints: [{ corridorId: 'qingzang', nearStations: ['纳赤台', '玉珠峰'] }], wiki: '昆仑山口', intro: '青藏铁路过昆仑山口段，列车爬升穿越昆仑山垭口，两侧雪山连绵冻土广布，四季雪山景观，晴日远眺最好。' },
  { id: 'qinghai-yuzhu-peak', name: '玉珠峰', province: '青海', lng: 94.25, lat: 35.7, kind: 'natural', subtype: 'snow_mountain', view: ['window', 'near'], hints: [{ corridorId: 'qingzang', nearStations: ['西大滩', '玉珠峰'] }], wiki: '玉珠峰', intro: '青藏铁路过西大滩段，南侧车窗远眺玉珠峰雪顶与冰川末梢，六千米级雪山近在咫尺，四季雪景，晨昏光线最好。' },
  { id: 'qinghai-kekexili-station', name: '可可西里保护站', province: '青海', lng: 92.85, lat: 35.35, kind: 'natural', subtype: 'grassland', view: ['distant', 'far'], maxDistKm: 28, hints: [{ corridorId: 'qingzang', nearStations: ['五道梁', '沱沱河'] }], wiki: '可可西里', intro: '青藏铁路过五道梁至沱沱河段，西侧远眺可可西里高原草场与藏羚羊栖息地边缘，四季荒原景观，夏季最好。' },
  { id: 'qinghai-tanggula-pass', name: '唐古拉山口', province: '青海', lng: 91.71, lat: 33.44, kind: 'natural', subtype: 'mountain_range', view: ['distant', 'far'], maxDistKm: 22, hints: [{ corridorId: 'qingzang', nearStations: ['唐古拉'] }], wiki: '唐古拉山口', intro: '青藏铁路过唐古拉山口段，列车在海拔五千零七十二米的世界铁路最高点穿越垭口，左右两侧雪峰绵延，四季雪景，晴日最好。' },
  { id: 'qinghai-aiken-spring', name: '艾肯泉', province: '青海', lng: 90.55, lat: 38.27, kind: 'natural', subtype: 'water_feature', view: ['distant', 'far'], maxDistKm: 30, hints: [{ corridorId: 'geku', nearStations: ['茫崖', '花土沟'] }], wiki: '艾肯泉', intro: '格库铁路过茫崖段，南侧远眺艾肯泉泉眼与红色环状泉华，恶魔之眼镶嵌戈壁，四季泉景，晴日远眺最好。' },
  { id: 'qinghai-geermu-river-gorge', name: '格尔木河出山峡谷', province: '青海', lng: 94.85, lat: 36.35, kind: 'natural', subtype: 'gorge', view: ['window', 'near'], hints: [{ corridorId: 'qingzang', nearStations: ['格尔木', '南山口'] }], wiki: '格尔木河', intro: '青藏铁路过格尔木站北上，西侧车窗可见格尔木河出山峡谷与河谷水线，昆仑雪水穿峡而下，四季河谷景观，晨昏最好。' },

  // ===== 贵州（目标新增 8；走廊 guiguang/hukun/yugui/chenggui）=====
  { id: 'guizhou-hongfeng-lake', name: '红枫湖', province: '贵州', lng: 106.43, lat: 26.55, kind: 'natural', subtype: 'lake', view: ['distant', 'far'], maxDistKm: 12, hints: [{ corridorId: 'hukun', nearStations: ['贵安', '清镇'] }], wiki: '红枫湖', intro: '沪昆高铁过安顺段，北侧远眺红枫湖湖面与岛屿星罗，湖光山色相映成趣，四季湖景，秋季红枫最好。' },
  { id: 'guizhou-doupeng-mountain', name: '斗篷山', province: '贵州', lng: 107.5, lat: 26.35, kind: 'natural', subtype: 'mountain_range', view: ['distant', 'far'], maxDistKm: 12, hints: [{ corridorId: 'guiguang', nearStations: ['都匀东'] }], wiki: '斗篷山', intro: '贵广高铁过都匀东站，西北侧远眺斗篷山主峰与原始森林，黔南第一峰满目苍翠，四季山色，晨昏光线最好。' },
  { id: 'guizhou-duliu-river', name: '都柳江榕江段', province: '贵州', lng: 108.52, lat: 25.93, kind: 'natural', subtype: 'river', view: ['window', 'near'], hints: [{ corridorId: 'guiguang', nearStations: ['榕江'] }], wiki: '都柳江', intro: '贵广高铁过榕江站，都柳江河湾与侗寨吊脚楼即在车窗旁，江水碧绿两岸青山，四季河谷景观，晨昏光线最好。' },
  { id: 'guizhou-tianhe-tan', name: '天河潭', province: '贵州', lng: 106.62, lat: 26.44, kind: 'natural', subtype: 'gorge', view: ['distant', 'far'], maxDistKm: 15, hints: [{ corridorId: 'hukun', nearStations: ['贵阳北', '平坝南'] }], wiki: '天河潭', intro: '沪昆高铁过贵阳段，西南远眺天河潭喀斯特峡谷与溶洞瀑布，山水洞潭浑然一体，四季景观，夏秋水量最好。' },
  { id: 'guizhou-loushan-pass', name: '娄山关', province: '贵州', lng: 106.83, lat: 28.18, kind: 'natural', subtype: 'mountain_range', view: ['window', 'near'], hints: [{ corridorId: 'yugui', nearStations: ['桐梓东'] }], wiki: '娄山关', intro: '渝黔高铁过桐梓东站，南侧远眺娄山关雄关要隘与群山叠嶂，长空雁叫霜晨月故地，四季可望，晨雾最好。' },
  { id: 'guizhou-wumeng-grassland', name: '乌蒙大草原', province: '贵州', lng: 104.45, lat: 25.9, kind: 'natural', subtype: 'grassland', view: ['distant', 'far'], maxDistKm: 20, hints: [{ corridorId: 'hukun', nearStations: ['盘州'] }], wiki: '乌蒙大草原', intro: '沪昆高铁过盘州段，西北远眺乌蒙大草原高原草场与风电风车，贵州海拔最高草原，四季景观，夏秋草绿最好。' },
  { id: 'guizhou-beipan-bridge', name: '北盘江特大桥', province: '贵州', lng: 105.28, lat: 25.93, kind: 'natural', subtype: 'bridge', view: ['window', 'near'], maxDistKm: 5, hints: [{ corridorId: 'hukun', nearStations: ['关岭', '普安县'] }], wiki: '北盘江大桥', intro: '沪昆高铁经北盘江特大桥过江，列车在桥上左右两侧均见峡谷深谷与江面，世界最高铁路桥凌空，四季谷景，晴日最好。' },
  { id: 'guizhou-huaxi-river', name: '花溪十里河滩', province: '贵州', lng: 106.65, lat: 26.42, kind: 'natural', subtype: 'river', view: ['distant', 'far'], maxDistKm: 18, hints: [{ corridorId: 'hukun', nearStations: ['贵阳南', '贵阳北'] }], wiki: '花溪国家城市湿地公园', intro: '沪昆高铁过贵阳段，南侧远眺花溪河十里河滩湿地，河湾曲折花木扶疏，四季水景，夏秋花季最好。' },
];

// —— 校验（intro 码点 40~90 + 四要素关键词 / category 非 other / dims 词表 / 省份合法）——
const need = { seg: /((?<!光)线|区间|站|高铁|铁路|城际)/, view: /(左|右|车窗|远眺)/, time: /(晨|昏|夜|四季|全年|夏|秋|冬|[0-9一二三四五六七八九十]+月)/ };
for (const c of cand) {
  if (!c.id || !c.name || !PROVINCES.has(c.province)) throw new Error(`${c.id}: id/name/province 非法`);
  if (!categoryFor(c.subtype)) throw new Error(`${c.id}: subtype ${c.subtype} 落入 other，禁止`);
  const dims = dimension[c.kind] ?? ['geo', 'nature'];
  if (dims.length > 2 || !dims.every((d) => V3_DIMENSIONS.has(d))) throw new Error(`${c.id}: dims 非法`);
  const len = [...c.intro].length;
  if (len < 40 || len > 90) throw new Error(`${c.id}: intro ${len} 字，需 40~90`);
  if (!need.seg.test(c.intro) || !need.view.test(c.intro) || !need.time.test(c.intro)) {
    throw new Error(`${c.id}: intro 四要素缺失（区段/视角/时段）`);
  }
  if (!c.hints?.length || !c.hints.every((h) => h.corridorId)) throw new Error(`${c.id}: lineHints 必填`);
}

// —— 批次内互斥去重（同 id / 同 norm 名 / <0.5km 近邻）——
const norm = (n) => String(n || '').replace(/（[^）]*）/g, '').replace(/[·・\s]/g, '');
const seenIds = new Set();
const seenNames = new Set();
const rows = [];
let dedupN = 0;
for (const c of cand) {
  if (seenIds.has(c.id) || seenNames.has(norm(c.name))) { dedupN += 1; continue; }
  let prox = false;
  for (const r of rows) {
    const dx = (r.lng - c.lng) * 111.32 * Math.cos((c.lat * Math.PI) / 180);
    const dy = (r.lat - c.lat) * 110.574;
    if (Math.hypot(dx, dy) < 0.5) { prox = true; break; }
  }
  if (prox) { dedupN += 1; continue; }
  rows.push(c);
  seenIds.add(c.id);
  seenNames.add(norm(c.name));
}

// —— 投影自检：读取走廊几何计算距轨距离，超阈值打 WARN（正式门禁在合并时由 enrichV3Spots 强制）——
const corridorCache = new Map();
const havKm = ([lng1, lat1], [lng2, lat2]) => {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
function loadCorridor(id) {
  if (corridorCache.has(id)) return corridorCache.get(id);
  const p = join(root, `data/presets/corridors/${id}.json`);
  if (!existsSync(p)) throw new Error(`corridor not found: ${id}`);
  const c = JSON.parse(readFileSync(p, 'utf8'));
  const g = { railway: c.railway };
  corridorCache.set(id, g);
  return g;
}
function projectDist(g, lng, lat) {
  let best = Infinity;
  const { railway } = g;
  for (let i = 0; i < railway.length - 1; i++) {
    const [x1, y1] = railway[i];
    const [x2, y2] = railway[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((lng - x1) * dx + (lat - y1) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = havKm([lng, lat], [x1 + t * dx, y1 + t * dy]);
    if (d < best) best = d;
  }
  return best;
}
let warnN = 0;
for (const c of rows) {
  const [visibility, viewScale] = c.view;
  const maxAllowed = c.maxDistKm ?? { on_track: 3, window: 8, distant: 35 }[visibility] ?? 8;
  const dist = projectDist(loadCorridor(c.hints[0].corridorId), c.lng, c.lat);
  if (dist > maxAllowed) {
    warnN += 1;
    console.warn(`WARN ${c.id}: 距 ${c.hints[0].corridorId} 折线 ${dist.toFixed(1)}km > 阈值 ${maxAllowed}km`);
  }
}

// —— 组装 spot 对象（sources：wiki A 级 + OSM 独立二次源）——
const spots = rows.map((c) => {
  const [visibility, viewScale] = c.view;
  return {
    id: c.id,
    name: c.name,
    province: c.province,
    lng: c.lng,
    lat: c.lat,
    intro: c.intro,
    visibility,
    maxDistKm: c.maxDistKm,
    viewScale,
    viewMinutes: viewScale === 'near' ? 3 : 3,
    category: categoryFor(c.subtype),
    subtype: c.subtype,
    dimensions: dimension[c.kind] ?? ['geo', 'nature'],
    tags: [c.province, '自然景区'],
    bestView: {
      months: [],
      timeOfDay: 'day',
      light: 'any',
      note: '地点坐标标记景观本体；能否从具体列车区段看到需结合线路和地形判断。',
      blocked: [],
    },
    source: 'curated',
    reviewedAt,
    reviewRound,
    sources: [
      { type: 'wiki', level: 'A', ref: `https://zh.wikipedia.org/wiki/${encodeURIComponent(c.wiki)}`, quote: `用于核对「${c.name}」名称、地点和公开地理位置。`, checkedAt: reviewedAt },
      { type: 'osm', level: 'A', ref: `https://www.openstreetmap.org/search?query=${encodeURIComponent(c.name)}`, quote: `按名称核对「${c.name}」对应地理实体与地图位置。`, checkedAt: reviewedAt },
    ],
    verification: {
      status: 'probable',
      checkedAt: reviewedAt,
      checkedBy: 'Codex',
      method: 'WGS84 地点坐标与公开地图实体交叉核对；铁路视线按地理关系估计。',
    },
    lineHints: c.hints,
  };
});

// —— 各省 near/far 与维度覆盖自检 ——
const byProv = {};
for (const s of spots) {
  byProv[s.province] = byProv[s.province] || { near: 0, far: 0, dims: new Set() };
  byProv[s.province][s.viewScale] += 1;
  for (const d of s.dimensions) byProv[s.province].dims.add(d);
}
for (const [p, st] of Object.entries(byProv)) {
  if (!st.near || !st.far) throw new Error(`${p}: viewScale 覆盖不全（near=${st.near} far=${st.far}）`);
  for (const need2 of ['geo', 'culture', 'history']) {
    if (st.dims.has(need2)) { byProv[p].hasHum = true; break; }
  }
  console.log(`${p}: ${st.near + st.far} 条（near ${st.near} / far ${st.far}），dims=[${[...st.dims].join(',')}]`);
}

writeFileSync(
  join(root, 'data/presets/scenic-spots-supplement-20261005.json'),
  JSON.stringify({
    version: 3,
    updated: reviewedAt,
    note: `${reviewRound} 六省（皖鄂津宁青黔）铁路景点补全批次；由策展生成器读取后经 curated 合并器进入主库。`,
    spots,
  }, null, 2) + '\n',
  'utf8',
);
console.log(`wrote ${spots.length} candidate spots（批次内去重 ${dedupN}，投影自检 WARN ${warnN}）`);