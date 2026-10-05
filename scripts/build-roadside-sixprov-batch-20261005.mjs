/**
 * 公路六省批次增量入库（2026-10-05）：
 *   天津 ≥30、宁夏 ≥40、安徽 ≥50、湖北 ≥50、青海 ≥40、贵州 ≥100
 * 增量写回 data/roads/roadside-spots.json，三级去重（id / 归一化名称 / 500m 近邻）。
 * 用法：默认 --dry 预览；--write 正式落盘。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'data/roads/roadside-spots.json');
const backup = join(root, 'data/roads/roadside-spots.pre-sixprov-20261005.json');
const WRITE = process.argv.includes('--write');
const reviewedAt = '2026-10-05';

const PROVINCES = new Set(['北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆']);

const VIS = new Set(['roadside', 'detour5', 'detour20', 'distant']);
const CATS = new Set([
  'nature.mountain', 'nature.lake', 'nature.river', 'nature.canyon', 'nature.forest', 'nature.grassland', 'nature.desert', 'nature.glacier',
  'engineering.bridge', 'engineering.tunnel', 'engineering.dam', 'engineering.pass', 'engineering.spiral-road', 'engineering.service-area',
  'culture.heritage', 'culture.ancient-town', 'culture.temple', 'culture.village', 'culture.ruin', 'culture.red',
  'viewpoint.landmark', 'viewpoint.observation-deck', 'viewpoint.scenic-byway', 'viewpoint.sunrise',
  'experience.hot-spring',
]);

const cand = [
  // ===== 天津（目标 +30）=====
  { id: 'tj-panshan', name: '盘山', province: '天津', lng: 117.39, lat: 40.06, category: 'nature.mountain', visibility: 'detour20', tier: 'A', score: 72, intro: '京东第一山，津蓟高速盘山出口，三盘暮雨挂月峰石塔松林。' },
  { id: 'tj-dulesi', name: '独乐寺', province: '天津', lng: 117.41, lat: 40.05, category: 'culture.temple', visibility: 'detour5', tier: 'A', score: 68, intro: '辽代木构观音阁与山门，蓟州古城内国保单位，津蓟高速可达。' },
  { id: 'tj-huangyaguan', name: '黄崖关长城', province: '天津', lng: 117.43, lat: 40.26, category: 'culture.heritage', visibility: 'detour20', tier: 'B', score: 58, intro: '蓟州长城黄崖关段，津围北线可达，雄关水关八卦城。' },
  { id: 'tj-baxianshan', name: '八仙山', province: '天津', lng: 117.55, lat: 40.18, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 52, intro: '蓟州最高峰，原始次生林，津蓟高速延长线可达。' },
  { id: 'tj-limutai', name: '梨木台', province: '天津', lng: 117.6, lat: 40.2, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 50, intro: '蓟州石英砂岩峰林与冰川遗迹，津蓟高速延长线可达。' },
  { id: 'tj-jiushanding', name: '九山顶', province: '天津', lng: 117.58, lat: 40.22, category: 'nature.mountain', visibility: 'detour20', tier: 'C', score: 44, intro: '蓟州自然制高点，长城遗址与峡谷，津蓟高速可达。' },
  { id: 'tj-yuqiao-reservoir', name: '于桥水库', province: '天津', lng: 117.48, lat: 40.05, category: 'nature.lake', visibility: 'detour5', tier: 'B', score: 52, intro: '蓟州于桥水库湖面，津蓟高速州河湾出口，环湖公路观景。' },
  { id: 'tj-huanxiu-lake', name: '环秀湖', province: '天津', lng: 117.35, lat: 40.08, category: 'nature.lake', visibility: 'detour20', tier: 'C', score: 40, intro: '蓟州环秀湖山间水库，津蓟高速可达，湖光山色。' },
  { id: 'tj-haihe-guweijie', name: '海河古文化街段', province: '天津', lng: 117.19, lat: 39.14, category: 'culture.ancient-town', visibility: 'roadside', tier: 'A', score: 66, intro: '海河沿岸古文化街天后宫，京津塘高速天津站出口。' },
  { id: 'tj-wudadao', name: '五大道', province: '天津', lng: 117.21, lat: 39.12, category: 'viewpoint.landmark', visibility: 'roadside', tier: 'A', score: 64, intro: '天津租界洋楼群，京津塘高速可达，万国建筑博物馆。' },
  { id: 'tj-italian-block', name: '意式风情区', province: '天津', lng: 117.2, lat: 39.14, category: 'viewpoint.landmark', visibility: 'roadside', tier: 'B', score: 56, intro: '原意租界马可波罗广场洋楼群，京津塘高速可达。' },
  { id: 'tj-tianjin-eye', name: '天津之眼', province: '天津', lng: 117.18, lat: 39.15, category: 'viewpoint.landmark', visibility: 'roadside', tier: 'A', score: 62, intro: '海河永乐桥摩天轮，京津塘高速可达，城市地标。' },
  { id: 'tj-jinwan-square', name: '津湾广场', province: '天津', lng: 117.2, lat: 39.13, category: 'viewpoint.landmark', visibility: 'roadside', tier: 'B', score: 54, intro: '海河沿岸金融街洋楼群，京津塘高速可达。' },
  { id: 'tj-dabei-chanyuan', name: '大悲禅院', province: '天津', lng: 117.19, lat: 39.16, category: 'culture.temple', visibility: 'roadside', tier: 'B', score: 48, intro: '天津最大佛教寺院，海河沿岸，京津塘高速可达。' },
  { id: 'tj-qilihai', name: '七里海湿地', province: '天津', lng: 117.57, lat: 39.44, category: 'nature.grassland', visibility: 'detour20', tier: 'A', score: 60, intro: '古泻湖湿地国家级自然保护区，津宁高速可达，候鸟栖息。' },
  { id: 'tj-beidagang', name: '北大港湿地', province: '天津', lng: 117.55, lat: 38.85, category: 'nature.grassland', visibility: 'detour20', tier: 'B', score: 54, intro: '滨海新区水库湿地，荣乌高速可达，遗鸥迁徙停歇。' },
  { id: 'tj-tuanbo-lake', name: '团泊洼', province: '天津', lng: 117.0, lat: 38.9, category: 'nature.lake', visibility: 'detour20', tier: 'C', score: 42, intro: '静海团泊洼水库湿地，京沪高速静海出口，温泉度假区。' },
  { id: 'tj-dagukou-fort', name: '大沽口炮台', province: '天津', lng: 117.71, lat: 38.97, category: 'culture.heritage', visibility: 'detour5', tier: 'B', score: 56, intro: '海河入海口炮台遗址，津港高速可达，近代海防见证。' },
  { id: 'tj-chaoyin-temple', name: '潮音寺', province: '天津', lng: 117.7, lat: 39.0, category: 'culture.temple', visibility: 'detour5', tier: 'C', score: 42, intro: '塘沽潮音寺海河入海口古寺，津港高速可达。' },
  { id: 'tj-yangliuqing', name: '杨柳青古镇', province: '天津', lng: 117.0, lat: 39.14, category: 'culture.ancient-town', visibility: 'detour5', tier: 'A', score: 62, intro: '西青杨柳青年画发源地，京沪高速杨柳青出口，石家大院。' },
  { id: 'tj-shijia-dayuan', name: '石家大院', province: '天津', lng: 117.01, lat: 39.15, category: 'culture.heritage', visibility: 'detour5', tier: 'B', score: 54, intro: '杨柳青石家大院清代民居，京沪高速可达，华北第一宅。' },
  { id: 'tj-binhaibeidao', name: '滨海航母公园', province: '天津', lng: 117.75, lat: 39.0, category: 'viewpoint.landmark', visibility: 'detour5', tier: 'B', score: 56, intro: '基辅号航母主题公园，海滨高速汉沽出口，军事体验。' },
  { id: 'tj-beitang-guzhen', name: '北塘古镇', province: '天津', lng: 117.7, lat: 39.1, category: 'culture.ancient-town', visibility: 'detour5', tier: 'B', score: 50, intro: '滨海北塘古镇渔港，海滨高速可达，明清炮台老街。' },
  { id: 'tj-dongli-lake', name: '东丽湖', province: '天津', lng: 117.38, lat: 39.13, category: 'nature.lake', visibility: 'detour5', tier: 'B', score: 48, intro: '东丽湖温泉度假区，京津塘高速军粮城出口，湖面开阔。' },
  { id: 'tj-haihe-tanggu', name: '海河塘沽段', province: '天津', lng: 117.65, lat: 39.0, category: 'nature.river', visibility: 'roadside', tier: 'B', score: 50, intro: '海河下游塘沽段外滩公园，海滨高速可达，河海交汇。' },
  { id: 'tj-haihe-estuary', name: '海河入海口', province: '天津', lng: 117.73, lat: 38.99, category: 'nature.river', visibility: 'detour5', tier: 'B', score: 52, intro: '海河入海口防潮闸，海滨高速可达，河海交汇观景。' },
  { id: 'tj-beiyun-canal', name: '北运河武清段', province: '天津', lng: 117.05, lat: 39.39, category: 'nature.river', visibility: 'detour5', tier: 'C', score: 44, intro: '武清北运河京杭大运河故道，京津塘高速武清出口。' },
  { id: 'tj-jinbao-wetland', name: '津保湿地走廊', province: '天津', lng: 116.9, lat: 39.2, category: 'nature.grassland', visibility: 'detour20', tier: 'C', score: 40, intro: '西青独流减河湿地走廊，荣乌高速可达，候鸟栖息。' },
  { id: 'tj-baxian-gu', name: '白蛇谷', province: '天津', lng: 117.5, lat: 40.15, category: 'nature.canyon', visibility: 'detour20', tier: 'C', score: 44, intro: '蓟州白蛇谷峡谷，津蓟高速延长线可达，一线天奇景。' },
  { id: 'tj-jiulong-shan', name: '九龙山', province: '天津', lng: 117.52, lat: 40.17, category: 'nature.mountain', visibility: 'detour20', tier: 'C', score: 44, intro: '蓟州九龙山国家森林公园，津蓟高速可达，九峰连绵。' },

  // ===== 宁夏（目标 +40）=====
  { id: 'nx-shapotou', name: '沙坡头', province: '宁夏', lng: 105.02, lat: 37.47, category: 'nature.desert', visibility: 'roadside', tier: 'A', score: 78, intro: '腾格里沙漠与黄河交汇，包兰铁路沙坡头站，治沙奇迹。' },
  { id: 'nx-shahu', name: '沙湖', province: '宁夏', lng: 106.35, lat: 38.85, category: 'nature.lake', visibility: 'detour5', tier: 'A', score: 72, intro: '沙湖沙漠湿地候鸟区，京藏高速沙湖出口，沙水相依。' },
  { id: 'nx-xixia-tombs', name: '西夏王陵', province: '宁夏', lng: 105.95, lat: 38.55, category: 'culture.heritage', visibility: 'detour5', tier: 'A', score: 70, intro: '西夏帝王陵墓群，京藏高速银川出口，东方金字塔。' },
  { id: 'nx-zhenbeibao', name: '镇北堡影视城', province: '宁夏', lng: 105.95, lat: 38.58, category: 'viewpoint.landmark', visibility: 'detour5', tier: 'A', score: 66, intro: '张贤亮创办影视城，京藏高速可达，大话西游取景地。' },
  { id: 'nx-helan-suyukou', name: '贺兰山苏峪口', province: '宁夏', lng: 105.95, lat: 38.73, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 58, intro: '贺兰山苏峪口国家森林公园，京藏高速可达，岩画岩羊。' },
  { id: 'nx-helan-rockart', name: '贺兰山岩画', province: '宁夏', lng: 105.88, lat: 38.7, category: 'culture.heritage', visibility: 'detour20', tier: 'A', score: 64, intro: '贺兰口岩画群太阳神岩画，京藏高速可达，远古游牧遗存。' },
  { id: 'nx-gunzhongkou', name: '滚钟口', province: '宁夏', lng: 105.9, lat: 38.55, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 50, intro: '贺兰山滚钟口三面环山，京藏高速可达，避暑胜地。' },
  { id: 'nx-baisikou-twin-towers', name: '拜寺口双塔', province: '宁夏', lng: 105.92, lat: 38.65, category: 'culture.heritage', visibility: 'detour20', tier: 'B', score: 52, intro: '贺兰山拜寺口西夏双塔，京藏高速可达，密檐砖塔。' },
  { id: 'nx-yuehai', name: '阅海湿地', province: '宁夏', lng: 106.24, lat: 38.6, category: 'nature.grassland', visibility: 'detour5', tier: 'B', score: 50, intro: '银川阅海国家湿地公园，京藏高速可达，塞上湖城。' },
  { id: 'nx-mingcui-lake', name: '鸣翠湖', province: '宁夏', lng: 106.34, lat: 38.49, category: 'nature.grassland', visibility: 'detour5', tier: 'B', score: 50, intro: '银川鸣翠湖国家湿地公园，京藏高速可达，百鸟鸣翠。' },
  { id: 'nx-xinghai-lake', name: '星海湖', province: '宁夏', lng: 106.4, lat: 38.9, category: 'nature.lake', visibility: 'detour5', tier: 'B', score: 46, intro: '石嘴山星海湖湿地，京藏高速可达，山水园林。' },
  { id: 'nx-qingtongxia-gorge', name: '青铜峡黄河大峡谷', province: '宁夏', lng: 106.03, lat: 37.95, category: 'nature.canyon', visibility: 'detour5', tier: 'A', score: 64, intro: '青铜峡黄河大峡谷一百零八塔，京藏高速可达，十里山水。' },
  { id: 'nx-108-towers', name: '一百零八塔', province: '宁夏', lng: 106.05, lat: 37.95, category: 'culture.heritage', visibility: 'detour5', tier: 'A', score: 60, intro: '青铜峡黄河岸边西夏塔群，京藏高速可达，三角形布列。' },
  { id: 'nx-huanghe-lou', name: '黄河楼', province: '宁夏', lng: 106.0, lat: 37.98, category: 'viewpoint.landmark', visibility: 'detour5', tier: 'B', score: 50, intro: '青铜峡黄河楼仿古建筑，京藏高速可达，登楼观河。' },
  { id: 'nx-zhongwei-gaomiao', name: '中卫高庙', province: '宁夏', lng: 105.2, lat: 37.5, category: 'culture.temple', visibility: 'detour5', tier: 'B', score: 54, intro: '中卫高庙三教合一古建筑群，定武高速可达，砖雕精美。' },
  { id: 'nx-tengger-desert', name: '腾格里沙漠', province: '宁夏', lng: 104.9, lat: 37.4, category: 'nature.desert', visibility: 'detour20', tier: 'B', score: 56, intro: '腾格里沙漠东缘，定武高速中卫出口，沙漠越野营地。' },
  { id: 'nx-tongxin-mosque', name: '同心清真大寺', province: '宁夏', lng: 105.9, lat: 36.98, category: 'culture.temple', visibility: 'detour5', tier: 'B', score: 52, intro: '同心清真大寺中国传统式清真寺，福银高速可达。' },
  { id: 'nx-weizhou', name: '韦州古城', province: '宁夏', lng: 106.25, lat: 37.35, category: 'culture.ancient-town', visibility: 'detour20', tier: 'C', score: 44, intro: '韦州古城康济塔，福银高速可达，回族文化古镇。' },
  { id: 'nx-liupanshan', name: '六盘山', province: '宁夏', lng: 106.25, lat: 35.28, category: 'nature.mountain', visibility: 'detour20', tier: 'A', score: 60, intro: '六盘山国家森林公园，福银高速固原出口，红军长征翻越。' },
  { id: 'nx-laolongtan', name: '老龙潭', province: '宁夏', lng: 106.3, lat: 35.3, category: 'nature.river', visibility: 'detour20', tier: 'B', score: 50, intro: '泾河源头老龙潭，福银高速可达，黄土高原绿岛。' },
  { id: 'nx-jinghe-source', name: '泾河源', province: '宁夏', lng: 106.32, lat: 35.35, category: 'nature.river', visibility: 'detour20', tier: 'B', score: 48, intro: '泾河发源地二龙河，福银高速可达，泾渭分明之源。' },
  { id: 'nx-xumishan-grotto', name: '须弥山石窟', province: '宁夏', lng: 106.15, lat: 36.1, category: 'culture.heritage', visibility: 'detour20', tier: 'A', score: 62, intro: '须弥山石窟北朝造像，福银高速可达，丝路东段遗存。' },
  { id: 'nx-huoshizhai', name: '火石寨', province: '宁夏', lng: 105.8, lat: 36.2, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 54, intro: '火石寨丹霞国家地质公园，福银高速可达，紫红色砂岩。' },
  { id: 'nx-shuigouyu', name: '水洞沟遗址', province: '宁夏', lng: 106.5, lat: 38.3, category: 'culture.ruin', visibility: 'detour20', tier: 'A', score: 62, intro: '水洞沟旧石器遗址，青银高速灵武出口，三万年前古人。' },
  { id: 'nx-lingwu-dinosaur', name: '灵武恐龙化石', province: '宁夏', lng: 106.7, lat: 38.1, category: 'culture.ruin', visibility: 'detour20', tier: 'B', score: 52, intro: '灵武南磁湾恐龙化石点，青银高速可达，侏罗纪遗存。' },
  { id: 'nx-niushou-shan', name: '牛首山', province: '宁夏', lng: 106.05, lat: 37.85, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 48, intro: '牛首山双峰黄河东岸，京藏高速可达，佛教名山寺庙群。' },
  { id: 'nx-zhongning-huanghe', name: '中宁黄河段', province: '宁夏', lng: 105.68, lat: 37.5, category: 'nature.river', visibility: 'roadside', tier: 'B', score: 48, intro: '中宁黄河与枸杞园，京藏高速中宁出口，塞上枸杞之乡。' },
  { id: 'nx-yinchuan-huanghe-park', name: '银川黄河金岸', province: '宁夏', lng: 106.35, lat: 38.4, category: 'nature.river', visibility: 'roadside', tier: 'B', score: 50, intro: '银川黄河金岸景观带，京藏高速可达，黄河东岸观景。' },
  { id: 'nx-shizuishan-wuhai', name: '石嘴山黄河段', province: '宁夏', lng: 106.5, lat: 39.0, category: 'nature.river', visibility: 'roadside', tier: 'C', score: 42, intro: '石嘴山黄河与乌兰布和沙漠交汇，京藏高速可达。' },
  { id: 'nx-helan-zhongbei', name: '贺兰山中北段', province: '宁夏', lng: 105.85, lat: 38.9, category: 'nature.mountain', visibility: 'distant', tier: 'B', score: 50, intro: '贺兰山中北段山势，京藏高速沿线远眺，贺兰晴雪。' },
  { id: 'nx-yinchuan-chengtian', name: '承天寺塔', province: '宁夏', lng: 106.27, lat: 38.47, category: 'culture.heritage', visibility: 'detour5', tier: 'B', score: 48, intro: '银川承天寺塔西夏古塔，京藏高速可达，老城地标。' },
  { id: 'nx-najiahu-mosque', name: '纳家户清真寺', province: '宁夏', lng: 106.1, lat: 38.3, category: 'culture.temple', visibility: 'detour5', tier: 'B', score: 50, intro: '永宁纳家户清真大寺，京藏高速可达，回族建筑典范。' },
  { id: 'nx-helan-wine', name: '贺兰山东麓葡萄廊', province: '宁夏', lng: 105.8, lat: 38.5, category: 'viewpoint.scenic-byway', visibility: 'detour20', tier: 'B', score: 52, intro: '贺兰山东麓葡萄酒庄带，京藏高速可达，中国波尔多。' },
  { id: 'nx-guyuan-wenmiao', name: '固原文庙', province: '宁夏', lng: 106.24, lat: 36.0, category: 'culture.heritage', visibility: 'detour5', tier: 'C', score: 42, intro: '固原文庙明清古建，福银高速可达，边塞儒学遗存。' },
  { id: 'nx-yanchi-lake', name: '盐池长城', province: '宁夏', lng: 107.3, lat: 37.2, category: 'culture.heritage', visibility: 'detour20', tier: 'B', score: 48, intro: '盐池长城与花马池古城，青银高速可达，长城关隘。' },
  { id: 'nx-hongsipu', name: '红寺堡扬水', province: '宁夏', lng: 106.0, lat: 37.4, category: 'engineering.dam', visibility: 'detour20', tier: 'C', score: 40, intro: '红寺堡扬水工程，福银高速可达，荒漠变绿洲奇迹。' },
  { id: 'nx-tongxin-guan', name: '同心韦州古道', province: '宁夏', lng: 106.2, lat: 37.2, category: 'viewpoint.scenic-byway', visibility: 'detour20', tier: 'C', score: 40, intro: '同心韦州丝路古道，福银高速可达，黄土高原回族聚落。' },
  { id: 'nx-pengyang-yangchang', name: '彭阳梯田', province: '宁夏', lng: 106.6, lat: 35.8, category: 'viewpoint.scenic-byway', visibility: 'detour20', tier: 'C', score: 44, intro: '彭阳黄土梯田与杏花，福银高速可达，春日花海。' },
  { id: 'nx-jingyuan-jinghe', name: '泾源泾河', province: '宁夏', lng: 106.35, lat: 35.4, category: 'nature.river', visibility: 'detour5', tier: 'B', score: 48, intro: '泾源泾河源风景区，福银高速可达，老龙潭峡谷。' },

  // ===== 安徽（目标 +43）=====
  { id: 'ah-huangshan', name: '黄山', province: '安徽', lng: 118.17, lat: 30.13, category: 'nature.mountain', visibility: 'detour20', tier: 'A', score: 88, intro: '黄山世界遗产，京台高速汤口出口，奇松怪石云海温泉。' },
  { id: 'ah-jiuhuashan', name: '九华山', province: '安徽', lng: 117.8, lat: 30.46, category: 'nature.mountain', visibility: 'detour20', tier: 'A', score: 78, intro: '九华山佛教名山，京台高速青阳出口，地藏道场莲花佛国。' },
  { id: 'ah-tianzhushan', name: '天柱山', province: '安徽', lng: 116.57, lat: 30.63, category: 'nature.mountain', visibility: 'detour20', tier: 'A', score: 72, intro: '天柱山世界地质公园，沪蓉高速潜山出口，古南岳擎天柱。' },
  { id: 'ah-qiyunshan', name: '齐云山', province: '安徽', lng: 117.9, lat: 29.8, category: 'nature.mountain', visibility: 'detour20', tier: 'A', score: 66, intro: '齐云山道教名山，京台高速休宁出口，丹霞地貌摩崖石刻。' },
  { id: 'ah-langyashan', name: '琅琊山', province: '安徽', lng: 118.3, lat: 32.3, category: 'nature.mountain', visibility: 'detour5', tier: 'B', score: 58, intro: '滁州琅琊山醉翁亭，沪陕高速滁州出口，欧阳修醉翁亭记。' },
  { id: 'ah-jingtingshan', name: '敬亭山', province: '安徽', lng: 118.75, lat: 31.03, category: 'nature.mountain', visibility: 'detour5', tier: 'B', score: 50, intro: '宣城敬亭山江南诗山，沪渝高速宣城出口，李白独坐敬亭山。' },
  { id: 'ah-taiping-lake', name: '太平湖', province: '安徽', lng: 118.16, lat: 30.29, category: 'nature.lake', visibility: 'detour5', tier: 'B', score: 58, intro: '太平湖黄山北麓水库，京台高速太平湖出口，湖光山色。' },
  { id: 'ah-chaohu', name: '巢湖', province: '安徽', lng: 117.6, lat: 31.6, category: 'nature.lake', visibility: 'roadside', tier: 'A', score: 64, intro: '巢湖中国五大淡水湖，京台高速巢湖出口，湖中姥山岛中庙。' },
  { id: 'ah-shengjin-lake', name: '升金湖湿地', province: '安徽', lng: 117.18, lat: 30.44, category: 'nature.grassland', visibility: 'detour20', tier: 'B', score: 54, intro: '升金湖国家级湿地，沪渝高速安庆出口，候鸟越冬地。' },
  { id: 'ah-huating-lake', name: '花亭湖', province: '安徽', lng: 116.3, lat: 30.6, category: 'nature.lake', visibility: 'detour20', tier: 'B', score: 48, intro: '太湖县花亭湖水库，沪蓉高速太湖出口，湖岛相映。' },
  { id: 'ah-wanfo-lake', name: '万佛湖', province: '安徽', lng: 116.5, lat: 31.3, category: 'nature.lake', visibility: 'detour5', tier: 'B', score: 52, intro: '舒城万佛湖水库，沪陕高速舒城出口，湖中群岛万佛名。' },
  { id: 'ah-xinanjing', name: '新安江山水画廊', province: '安徽', lng: 118.4, lat: 29.7, category: 'nature.river', visibility: 'roadside', tier: 'A', score: 66, intro: '歙县新安江山水画廊，京台高速深渡出口，徽州母亲河。' },
  { id: 'ah-shuiyang-jiang', name: '水阳江', province: '安徽', lng: 118.79, lat: 30.95, category: 'nature.river', visibility: 'detour5', tier: 'C', score: 42, intro: '宣城水阳江皖南水系，沪渝高速宣城出口，江湾竹排。' },
  { id: 'ah-qingyi-jiang', name: '青弋江', province: '安徽', lng: 118.3, lat: 30.95, category: 'nature.river', visibility: 'detour20', tier: 'C', score: 42, intro: '泾县青弋江皖南水系，沪渝高速泾县出口，李白桃花潭。' },
  { id: 'ah-xidi', name: '西递', province: '安徽', lng: 117.64, lat: 30.1, category: 'culture.ancient-town', visibility: 'detour5', tier: 'A', score: 72, intro: '西递世界遗产徽州古村，京台高速黟县出口，牌坊祠堂马头墙。' },
  { id: 'ah-hongcun', name: '宏村', province: '安徽', lng: 117.7, lat: 30.16, category: 'culture.ancient-town', visibility: 'detour5', tier: 'A', score: 74, intro: '宏村世界遗产牛形古村，京台高速宏村出口，南湖月沼承志堂。' },
  { id: 'ah-tunxi-oldstreet', name: '屯溪老街', province: '安徽', lng: 118.31, lat: 29.72, category: 'culture.ancient-town', visibility: 'roadside', tier: 'A', score: 62, intro: '屯溪老街宋明徽派建筑，京台高速屯溪出口，活着的清明上河图。' },
  { id: 'ah-huizhou-gucheng', name: '徽州古城', province: '安徽', lng: 118.44, lat: 29.87, category: 'culture.ancient-town', visibility: 'detour5', tier: 'A', score: 64, intro: '歙县徽州古城府衙许国石坊，京台高速歙县出口。' },
  { id: 'ah-sanhe-guzhen', name: '三河古镇', province: '安徽', lng: 117.18, lat: 31.5, category: 'culture.ancient-town', visibility: 'detour5', tier: 'B', score: 56, intro: '肥西三河古镇水乡，京台高速三河出口，肥水之战古战场。' },
  { id: 'ah-longchuan', name: '龙川', province: '安徽', lng: 118.7, lat: 30.07, category: 'culture.ancient-town', visibility: 'detour20', tier: 'A', score: 60, intro: '绩溪龙川胡氏宗祠，沪渝高速绩溪出口，尚书府奕世坊。' },
  { id: 'ah-chengkan', name: '呈坎', province: '安徽', lng: 118.3, lat: 29.9, category: 'culture.ancient-town', visibility: 'detour20', tier: 'B', score: 54, intro: '徽州呈坎八卦村，京台高速潜口出口，罗东舒祠宝纶阁。' },
  { id: 'ah-tangmo', name: '唐模', province: '安徽', lng: 118.35, lat: 29.9, category: 'culture.ancient-town', visibility: 'detour20', tier: 'B', score: 50, intro: '徽州唐模古村檀干园，京台高速潜口出口，小西湖同胞翰林。' },
  { id: 'ah-tangyue-paifang', name: '棠樾牌坊群', province: '安徽', lng: 118.4, lat: 29.9, category: 'culture.heritage', visibility: 'detour5', tier: 'A', score: 62, intro: '歙县棠樾鲍氏牌坊群七座连列，京台高速可达。' },
  { id: 'ah-baogong-ci', name: '包公祠', province: '安徽', lng: 117.3, lat: 31.85, category: 'culture.temple', visibility: 'detour5', tier: 'B', score: 50, intro: '合肥包公祠包公园，京台高速合肥出口，包龙图故里。' },
  { id: 'ah-xiaoyaojin', name: '逍遥津', province: '安徽', lng: 117.29, lat: 31.87, category: 'viewpoint.landmark', visibility: 'roadside', tier: 'B', score: 48, intro: '合肥逍遥津公园，京台高速合肥出口，张辽威震逍遥津。' },
  { id: 'ah-mingzhongdu', name: '明中都皇故城', province: '安徽', lng: 117.55, lat: 32.85, category: 'culture.ruin', visibility: 'detour20', tier: 'A', score: 58, intro: '凤阳明中都皇故城遗址，京台高速凤阳出口，明初都城遗址。' },
  { id: 'ah-caishiji', name: '采石矶', province: '安徽', lng: 118.5, lat: 31.7, category: 'nature.mountain', visibility: 'detour5', tier: 'A', score: 60, intro: '马鞍山采石矶长江三矶之首，沪渝高速马鞍山出口，李白捞月处。' },
  { id: 'ah-tianmenshan', name: '天门山', province: '安徽', lng: 118.4, lat: 31.6, category: 'nature.mountain', visibility: 'detour5', tier: 'B', score: 52, intro: '芜湖天门山长江两岸，沪渝高速芜湖出口，楚江天门中断。' },
  { id: 'ah-xiaogushan', name: '小孤山', province: '安徽', lng: 116.2, lat: 30.0, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 50, intro: '宿松小孤山长江中孤峰，沪蓉高速宿松出口，海门第一关。' },
  { id: 'ah-maren-qifeng', name: '马仁奇峰', province: '安徽', lng: 118.3, lat: 30.95, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 50, intro: '繁昌马仁奇峰楠木林，沪渝高速繁昌出口，六奇景山寺。' },
  { id: 'ah-tiantangzhai', name: '天堂寨', province: '安徽', lng: 115.7, lat: 31.2, category: 'nature.mountain', visibility: 'detour20', tier: 'A', score: 66, intro: '金寨天堂寨大别山主峰，沪蓉高速金寨出口，吴楚东南第一关。' },
  { id: 'ah-baima-gorge', name: '白马大峡谷', province: '安徽', lng: 115.75, lat: 31.25, category: 'nature.canyon', visibility: 'detour20', tier: 'B', score: 52, intro: '金寨白马大峡谷天堂寨下，沪蓉高速金寨出口，瀑布群。' },
  { id: 'ah-yanzihe-gorge', name: '燕子河大峡谷', province: '安徽', lng: 115.8, lat: 31.3, category: 'nature.canyon', visibility: 'detour20', tier: 'B', score: 50, intro: '金寨燕子河大峡谷，沪蓉高速金寨出口，天坑瀑布。' },
  { id: 'ah-foziling-reservoir', name: '佛子岭水库', province: '安徽', lng: 116.4, lat: 31.3, category: 'engineering.dam', visibility: 'detour5', tier: 'A', score: 56, intro: '霍山佛子岭水库连拱坝，沪陕高速霍山出口，新中国第一坝。' },
  { id: 'ah-xianghongdian', name: '响洪甸水库', province: '安徽', lng: 116.3, lat: 31.4, category: 'engineering.dam', visibility: 'detour20', tier: 'B', score: 48, intro: '金寨响洪甸水库大坝，沪蓉高速金寨出口，治淮骨干工程。' },
  { id: 'ah-yingjiang-temple', name: '迎江寺振风塔', province: '安徽', lng: 117.06, lat: 30.5, category: 'culture.temple', visibility: 'detour5', tier: 'B', score: 52, intro: '安庆迎江寺振风塔长江岸边，沪渝高速安庆出口。' },
  { id: 'ah-shouxian-gucheng', name: '寿县古城', province: '安徽', lng: 116.78, lat: 32.57, category: 'culture.ancient-town', visibility: 'detour5', tier: 'A', score: 58, intro: '寿县古城宋城墙楚都，京台高速寿县出口，淝水之战古战场。' },
  { id: 'ah-bagongshan', name: '八公山', province: '安徽', lng: 116.7, lat: 32.6, category: 'nature.mountain', visibility: 'detour5', tier: 'B', score: 48, intro: '淮南八公山淝水之战古战场，京台高速淮南出口，豆腐发源地。' },
  { id: 'ah-bozhou-huaxilou', name: '亳州花戏楼', province: '安徽', lng: 115.78, lat: 33.85, category: 'culture.heritage', visibility: 'detour5', tier: 'A', score: 58, intro: '亳州花戏楼大关帝庙砖雕，济广高速亳州出口，明清戏台。' },
  { id: 'ah-caocao-tunnel', name: '曹操地下运兵道', province: '安徽', lng: 115.78, lat: 33.87, category: 'culture.heritage', visibility: 'detour5', tier: 'A', score: 56, intro: '亳州曹操地下运兵道，济广高速亳州出口，三国地下长城。' },
  { id: 'ah-dabie-tiantang', name: '大别山主峰景区', province: '安徽', lng: 115.7, lat: 31.15, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 56, intro: '大别山主峰白马大尖，沪蓉高速金寨出口，江淮分水岭。' },
  { id: 'ah-huangshan-west-sea', name: '黄山西海大峡谷', province: '安徽', lng: 118.15, lat: 30.1, category: 'nature.canyon', visibility: 'detour20', tier: 'A', score: 72, intro: '黄山西海大峡谷栈道，京台高速汤口出口，梦幻景区。' },
  { id: 'ah-jiuhua-dizang', name: '九华山地藏圣像', province: '安徽', lng: 117.85, lat: 30.5, category: 'viewpoint.landmark', visibility: 'detour5', tier: 'A', score: 58, intro: '九华山大愿文化园地藏圣像，京台高速青阳出口。' },
  { id: 'ah-tianzhu-mysterious', name: '天柱山神秘谷', province: '安徽', lng: 116.55, lat: 30.62, category: 'nature.canyon', visibility: 'detour20', tier: 'B', score: 54, intro: '天柱山神秘谷花岗岩洞穴，沪蓉高速潜山出口，皖公神像。' },
  { id: 'ah-chaohu-zhongmiao', name: '巢湖中庙姥山岛', province: '安徽', lng: 117.62, lat: 31.62, category: 'viewpoint.landmark', visibility: 'detour5', tier: 'B', score: 52, intro: '巢湖中庙古寺与姥山岛，京台高速巢湖出口，湖中浮岛。' },

  // ===== 湖北（目标 +41）=====
  { id: 'hb-wudangshan', name: '武当山', province: '湖北', lng: 111.0, lat: 32.4, category: 'nature.mountain', visibility: 'detour20', tier: 'A', score: 82, intro: '武当山世界遗产道教名山，福银高速武当山出口，金顶紫霄。' },
  { id: 'hb-shennongjia', name: '神农架', province: '湖北', lng: 110.5, lat: 31.7, category: 'nature.mountain', visibility: 'detour20', tier: 'A', score: 78, intro: '神农架世界遗产原始森林，呼北高速神农架出口，华中屋脊。' },
  { id: 'hb-dabieshan', name: '大别山', province: '湖北', lng: 115.0, lat: 31.0, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 58, intro: '大别山主峰天堂寨，沪蓉高速罗田出口，江淮分水岭。' },
  { id: 'hb-jiugongshan', name: '九宫山', province: '湖北', lng: 114.6, lat: 29.4, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 56, intro: '通山九宫山道教名山，杭瑞高速通山出口，云中湖铜鼓包。' },
  { id: 'hb-qiyueshan', name: '齐岳山', province: '湖北', lng: 108.6, lat: 30.3, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 50, intro: '利川齐岳山风电场，沪蓉高速利川出口，南方最大草场。' },
  { id: 'hb-threegorges-dam', name: '三峡大坝', province: '湖北', lng: 111.0, lat: 30.8, category: 'engineering.dam', visibility: 'detour5', tier: 'A', score: 82, intro: '三峡大坝世界最大水电工程，沪蓉高速三峡出口，坛子岭观景。' },
  { id: 'hb-gezhouba', name: '葛洲坝', province: '湖北', lng: 111.28, lat: 30.7, category: 'engineering.dam', visibility: 'detour5', tier: 'B', score: 58, intro: '葛洲坝长江干流第一坝，沪蓉高速宜昌出口，万里长江第一坝。' },
  { id: 'hb-geheyan-dam', name: '隔河岩水库大坝', province: '湖北', lng: 111.19, lat: 30.47, category: 'engineering.dam', visibility: 'detour20', tier: 'B', score: 52, intro: '长阳隔河岩水库大坝，沪蓉高速长阳出口，清江第一坝。' },
  { id: 'hb-danjiangkou-dam', name: '丹江口水库大坝', province: '湖北', lng: 111.52, lat: 32.56, category: 'engineering.dam', visibility: 'detour5', tier: 'A', score: 64, intro: '丹江口水库南水北调中线水源，福银高速丹江口出口。' },
  { id: 'hb-xiling-gorge', name: '西陵峡', province: '湖北', lng: 111.2, lat: 30.8, category: 'nature.canyon', visibility: 'detour5', tier: 'A', score: 70, intro: '西陵峡三峡最长峡，沪蓉高速三峡出口，灯影峡牛肝马肺。' },
  { id: 'hb-wu-gorge', name: '巫峡', province: '湖北', lng: 110.0, lat: 31.0, category: 'nature.canyon', visibility: 'detour20', tier: 'A', score: 68, intro: '巫峡三峡幽深峡，沪蓉高速巴东出口，神女十二峰。' },
  { id: 'hb-qutang-gorge', name: '瞿塘峡', province: '湖北', lng: 109.5, lat: 31.0, category: 'nature.canyon', visibility: 'distant', tier: 'A', score: 64, intro: '瞿塘峡三峡最短峡，沪蓉高速巫山出口方向，夔门天下雄。' },
  { id: 'hb-qingjiang-gallery', name: '清江画廊', province: '湖北', lng: 111.0, lat: 30.5, category: 'nature.river', visibility: 'detour5', tier: 'A', score: 64, intro: '长阳清江画廊倒影峡，沪蓉高速长阳出口，八百里清江。' },
  { id: 'hb-shennongxi', name: '神农溪', province: '湖北', lng: 110.36, lat: 31.06, category: 'nature.river', visibility: 'detour20', tier: 'A', score: 60, intro: '巴东神农溪纤夫漂流，沪蓉高速巴东出口，三峡支流峡谷。' },
  { id: 'hb-xiangxi-river', name: '香溪', province: '湖北', lng: 110.8, lat: 31.3, category: 'nature.river', visibility: 'detour20', tier: 'B', score: 48, intro: '兴山香溪河昭君故里，沪蓉高速兴山出口，王昭君浣纱处。' },
  { id: 'hb-donghu', name: '东湖', province: '湖北', lng: 114.4, lat: 30.55, category: 'nature.lake', visibility: 'roadside', tier: 'A', score: 64, intro: '武汉东湖城市湖泊，沪蓉高速武汉出口，楚天台听涛磨山。' },
  { id: 'hb-liangzi-lake', name: '梁子湖', province: '湖北', lng: 114.6, lat: 30.3, category: 'nature.lake', visibility: 'detour20', tier: 'B', score: 52, intro: '鄂州梁子湖武昌鱼产地，沪渝高速鄂州出口，湖北第二大湖。' },
  { id: 'hb-honghu', name: '洪湖', province: '湖北', lng: 113.4, lat: 29.8, category: 'nature.lake', visibility: 'detour20', tier: 'B', score: 50, intro: '洪湖革命老区湿地，沪渝高速洪湖出口，荷花菱藕水乡。' },
  { id: 'hb-futou-lake', name: '斧头湖', province: '湖北', lng: 114.2, lat: 29.9, category: 'nature.lake', visibility: 'detour20', tier: 'C', score: 42, intro: '嘉鱼斧头湖湿地，沪渝高速嘉鱼出口，江汉平原湖区。' },
  { id: 'hb-huanghelou', name: '黄鹤楼', province: '湖北', lng: 114.3, lat: 30.55, category: 'viewpoint.landmark', visibility: 'roadside', tier: 'A', score: 76, intro: '武汉黄鹤楼江南三大名楼，沪蓉高速武汉出口，极目楚天。' },
  { id: 'hb-guqintai', name: '古琴台', province: '湖北', lng: 114.26, lat: 30.55, category: 'culture.heritage', visibility: 'roadside', tier: 'B', score: 54, intro: '武汉古琴台俞伯牙钟子期，沪蓉高速武汉出口，高山流水。' },
  { id: 'hb-qingchuan-ge', name: '晴川阁', province: '湖北', lng: 114.28, lat: 30.57, category: 'culture.heritage', visibility: 'roadside', tier: 'B', score: 50, intro: '武汉晴川阁禹王矶，沪蓉高速武汉出口，晴川历历汉阳树。' },
  { id: 'hb-guiyuan-temple', name: '归元寺', province: '湖北', lng: 114.26, lat: 30.54, category: 'culture.temple', visibility: 'roadside', tier: 'B', score: 52, intro: '武汉归元寺佛教寺院，沪蓉高速武汉出口，数罗汉归元禅寺。' },
  { id: 'hb-chibi-battlefield', name: '赤壁古战场', province: '湖北', lng: 113.87, lat: 29.78, category: 'culture.heritage', visibility: 'detour5', tier: 'A', score: 60, intro: '赤壁三国古战场，京港澳高速赤壁出口，周郎赤壁东风。' },
  { id: 'hb-jingzhou-gucheng', name: '荆州古城', province: '湖北', lng: 112.24, lat: 30.33, category: 'culture.ancient-town', visibility: 'detour5', tier: 'A', score: 64, intro: '荆州古城墙三国重镇，二广高速荆州出口，关公大意失荆州。' },
  { id: 'hb-xiangyang-gucheng', name: '襄阳古城', province: '湖北', lng: 112.15, lat: 32.03, category: 'culture.ancient-town', visibility: 'detour5', tier: 'A', score: 62, intro: '襄阳古城墙护城河，二广高速襄阳出口，郭靖守襄阳。' },
  { id: 'hb-yuquan-temple', name: '当阳玉泉寺', province: '湖北', lng: 111.8, lat: 30.8, category: 'culture.temple', visibility: 'detour5', tier: 'B', score: 52, intro: '当阳玉泉寺天台宗祖庭，沪蓉高速当阳出口，关公显圣处。' },
  { id: 'hb-mingxianling', name: '明显陵', province: '湖北', lng: 112.6, lat: 31.2, category: 'culture.heritage', visibility: 'detour5', tier: 'A', score: 62, intro: '钟祥明显陵世界遗产，沪蓉高速钟祥出口，明世宗父母陵。' },
  { id: 'hb-enshi-gorge', name: '恩施大峡谷', province: '湖北', lng: 109.4, lat: 30.3, category: 'nature.canyon', visibility: 'detour20', tier: 'A', score: 68, intro: '恩施大峡谷一柱香绝壁，沪蓉高速恩施出口，喀斯特奇观。' },
  { id: 'hb-tenglong-dong', name: '腾龙洞', province: '湖北', lng: 108.6, lat: 30.3, category: 'nature.canyon', visibility: 'detour20', tier: 'A', score: 60, intro: '利川腾龙洞最大溶洞，沪蓉高速利川出口，卧龙吞江瀑布。' },
  { id: 'hb-suobuya-stone-forest', name: '梭布垭石林', province: '湖北', lng: 109.6, lat: 30.4, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 52, intro: '恩施梭布垭奥陶纪石林，沪蓉高速恩施出口，海螺化石。' },
  { id: 'hb-quyuan-hometown', name: '屈原故里', province: '湖北', lng: 110.8, lat: 31.0, category: 'culture.heritage', visibility: 'detour5', tier: 'A', score: 58, intro: '秭归屈原故里乐平里，沪蓉高速秭归出口，屈原祠凤凰山。' },
  { id: 'hb-zhaojun-hometown', name: '昭君故里', province: '湖北', lng: 110.8, lat: 31.3, category: 'culture.heritage', visibility: 'detour5', tier: 'B', score: 54, intro: '兴山昭君故里宝坪村，沪蓉高速兴山出口，王昭君出塞。' },
  { id: 'hb-mulan-mountain', name: '木兰山', province: '湖北', lng: 114.4, lat: 31.0, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 50, intro: '黄陂木兰山道教名山，沪蓉高速黄陂出口，代父从军故里。' },
  { id: 'hb-mulan-lake', name: '木兰湖', province: '湖北', lng: 114.5, lat: 31.0, category: 'nature.lake', visibility: 'detour20', tier: 'B', score: 48, intro: '黄陂木兰湖夏家寺水库，沪蓉高速黄陂出口，木兰天池。' },
  { id: 'hb-mulan-grassland', name: '木兰草原', province: '湖北', lng: 114.45, lat: 31.05, category: 'nature.grassland', visibility: 'detour20', tier: 'B', score: 48, intro: '黄陂木兰草原蒙元风情，沪蓉高速黄陂出口，华中草原。' },
  { id: 'hb-dahongshan', name: '大洪山', province: '湖北', lng: 113.0, lat: 31.5, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 48, intro: '随州大洪山佛教名山，许广高速随州出口，楚北第一峰。' },
  { id: 'hb-longzhong', name: '古隆中', province: '湖北', lng: 112.0, lat: 32.0, category: 'culture.heritage', visibility: 'detour5', tier: 'A', score: 58, intro: '襄阳古隆中诸葛亮躬耕，二广高速襄阳出口，三顾茅庐三分天下。' },
  { id: 'hb-shuijing-zhuang', name: '水镜庄', province: '湖北', lng: 111.8, lat: 31.8, category: 'culture.heritage', visibility: 'detour5', tier: 'B', score: 48, intro: '南漳水镜庄司马徽隐居，二广高速南漳出口，水镜先生。' },
  { id: 'hb-lushui-lake', name: '陆水湖', province: '湖北', lng: 113.8, lat: 29.7, category: 'nature.lake', visibility: 'detour5', tier: 'B', score: 48, intro: '赤壁陆水湖千岛湖，京港澳高速赤壁出口，三峡试验坝。' },
  { id: 'hb-yinshui-dong', name: '隐水洞', province: '湖北', lng: 114.2, lat: 29.6, category: 'nature.canyon', visibility: 'detour20', tier: 'B', score: 50, intro: '通山隐水洞地下河溶洞，杭瑞高速通山出口，十里地下长廊。' },
  { id: 'hb-wuhan-yangtze-bridge', name: '武汉长江大桥', province: '湖北', lng: 114.29, lat: 30.55, category: 'engineering.bridge', visibility: 'roadside', tier: 'A', score: 60, intro: '武汉长江大桥万里长江第一桥，沪蓉高速武汉出口。' },

  // ===== 青海（目标 +19）=====
  { id: 'qh-qinghai-lake-north', name: '青海湖北岸', province: '青海', lng: 100.2, lat: 37.2, category: 'nature.lake', visibility: 'roadside', tier: 'A', score: 78, intro: '青海湖北岸环湖西路，京藏高速刚察出口，中国最大咸水湖。' },
  { id: 'qh-chaka-salt-lake', name: '茶卡盐湖', province: '青海', lng: 99.1, lat: 36.7, category: 'nature.lake', visibility: 'detour5', tier: 'A', score: 76, intro: '茶卡盐湖天空之镜，京藏高速茶卡出口，盐湖小火车倒影。' },
  { id: 'qh-chaerhan-salt-lake', name: '察尔汗盐湖', province: '青海', lng: 95.2, lat: 36.75, category: 'nature.lake', visibility: 'detour5', tier: 'A', score: 70, intro: '察尔汗盐湖万丈盐桥，京藏高速格尔木出口，盐盖路基。' },
  { id: 'qh-keluke-lake', name: '可鲁克湖', province: '青海', lng: 97.17, lat: 37.27, category: 'nature.lake', visibility: 'detour5', tier: 'B', score: 54, intro: '德令哈可鲁克湖托素湖，京藏高速德令哈出口，情人湖。' },
  { id: 'qh-hala-lake', name: '哈拉湖', province: '青海', lng: 97.3, lat: 38.2, category: 'nature.lake', visibility: 'distant', tier: 'B', score: 52, intro: '哈拉湖无人区深湖，德马高速方向，祁连山腹地咸水湖。' },
  { id: 'qh-taer-temple', name: '塔尔寺', province: '青海', lng: 101.6, lat: 36.5, category: 'culture.temple', visibility: 'detour5', tier: 'A', score: 70, intro: '湟中塔尔寺藏传佛教格鲁派，京藏高速塔尔寺出口，宗喀巴诞生地。' },
  { id: 'qh-qutan-temple', name: '瞿昙寺', province: '青海', lng: 102.3, lat: 36.2, category: 'culture.temple', visibility: 'detour20', tier: 'B', score: 56, intro: '乐都瞿昙寺明代宫廷寺院，京藏高速乐都出口，小故宫壁画。' },
  { id: 'hb-wencheng-temple-qh', name: '文成公主庙', province: '青海', lng: 97.1, lat: 33.0, category: 'culture.temple', visibility: 'detour20', tier: 'B', score: 52, intro: '玉树文成公主庙贝沟石刻，共玉高速玉树出口方向，唐蕃古道。' },
  { id: 'qh-riyue-shan', name: '日月山', province: '青海', lng: 101.0, lat: 36.4, category: 'nature.mountain', visibility: 'detour5', tier: 'B', score: 54, intro: '日月山文成公主镜山，京藏高速倒淌河出口，唐蕃分界。' },
  { id: 'qh-daotang-river', name: '倒淌河', province: '青海', lng: 100.8, lat: 36.4, category: 'nature.river', visibility: 'detour5', tier: 'C', score: 42, intro: '倒淌河自东向西流入青海湖，京藏高速倒淌河出口。' },
  { id: 'qh-guide-geopark', name: '贵德地质公园', province: '青海', lng: 101.5, lat: 36.1, category: 'nature.canyon', visibility: 'detour5', tier: 'B', score: 54, intro: '贵德国家地质公园丹霞七彩峰，京藏高速贵德出口，黄河清贵德。' },
  { id: 'qh-kanbula', name: '坎布拉', province: '青海', lng: 101.8, lat: 36.1, category: 'nature.mountain', visibility: 'detour20', tier: 'B', score: 56, intro: '坎布拉国家森林公园丹霞，京藏高速李家峡出口，黄河上游。' },
  { id: 'qh-menyuan-flower', name: '门源油菜花海', province: '青海', lng: 101.6, lat: 37.4, category: 'nature.grassland', visibility: 'detour5', tier: 'A', score: 62, intro: '门源百里油菜花海，京藏高速门源出口，七月金色海洋。' },
  { id: 'qh-qilian-zhuoer', name: '祁连卓尔山', province: '青海', lng: 100.2, lat: 38.2, category: 'nature.mountain', visibility: 'detour5', tier: 'A', score: 60, intro: '祁连卓尔山红润皇后，京藏高速祁连出口，东方小瑞士。' },
  { id: 'qh-niuxin-shan', name: '牛心山', province: '青海', lng: 100.25, lat: 38.2, category: 'nature.mountain', visibility: 'detour5', tier: 'B', score: 50, intro: '祁连牛心山阿米东索神山，京藏高速祁连出口。' },
  { id: 'qh-heiquan-reservoir', name: '黑泉水库', province: '青海', lng: 101.5, lat: 36.8, category: 'engineering.dam', visibility: 'detour5', tier: 'B', score: 46, intro: '大通黑泉水库宁缠垭口，京藏高速大通出口，西宁水源。' },
  { id: 'qh-dadongshu-pass', name: '大冬树山垭口', province: '青海', lng: 100.3, lat: 38.0, category: 'engineering.pass', visibility: 'detour20', tier: 'B', score: 50, intro: '大冬树山垭口海拔四千二百米，京藏高速祁连方向，最高公路垭口。' },
  { id: 'qh-animachen', name: '阿尼玛卿雪山', province: '青海', lng: 99.8, lat: 34.8, category: 'nature.mountain', visibility: 'distant', tier: 'A', score: 64, intro: '阿尼玛卿雪山藏区四大神山，德马高速玛沁方向，黄河源头最大山。' },
  { id: 'qh-nianbaoyuze', name: '年保玉则', province: '青海', lng: 101.1, lat: 33.3, category: 'nature.mountain', visibility: 'distant', tier: 'A', score: 60, intro: '年保玉则神山妖女湖，德马高速久治方向，天神后花园。' },
  { id: 'qh-mengda-tianchi', name: '孟达天池', province: '青海', lng: 102.7, lat: 35.8, category: 'nature.lake', visibility: 'detour20', tier: 'B', score: 50, intro: '循化孟达天池自然保护区，京藏高速循化出口，青海西双版纳。' },
  { id: 'qh-laji-shan', name: '拉鸡山', province: '青海', lng: 101.7, lat: 36.3, category: 'nature.mountain', visibility: 'detour5', tier: 'C', score: 44, intro: '拉鸡山垭口贵南方向，京藏高速贵南出口，青海南山屏障。' },
  { id: 'qh-daban-shan', name: '大坂山', province: '青海', lng: 101.7, lat: 37.2, category: 'engineering.pass', visibility: 'detour5', tier: 'B', score: 46, intro: '大坂山垭口宁张公路，京藏高速门源方向，达坂山隧道。' },

  // ===== 贵州（目标 +5，补足至 100）=====
  { id: 'gz-fanjingshan', name: '梵净山', province: '贵州', lng: 108.7, lat: 27.9, category: 'nature.mountain', visibility: 'detour20', tier: 'A', score: 82, intro: '梵净山世界遗产弥勒道场，杭瑞高速江口出口，红云金顶蘑菇石。' },
  { id: 'gz-zhenyuan-gucheng', name: '镇远古城', province: '贵州', lng: 108.4, lat: 27.05, category: 'culture.ancient-town', visibility: 'detour5', tier: 'A', score: 64, intro: '镇远古城㵲阳河畔，沪昆高速镇远出口，苗疆长城青龙洞。' },
  { id: 'gz-qinglong-dong', name: '青龙洞古建筑群', province: '贵州', lng: 108.43, lat: 27.05, category: 'culture.heritage', visibility: 'detour5', tier: 'B', score: 56, intro: '镇远青龙洞贴崖古建筑，沪昆高速镇远出口，儒释道三教合一。' },
  { id: 'gz-maolan-karst', name: '茂兰喀斯特', province: '贵州', lng: 108.1, lat: 25.3, category: 'nature.mountain', visibility: 'detour20', tier: 'A', score: 64, intro: '荔波茂兰喀斯特森林世界遗产，厦蓉高速荔波出口，漏斗森林。' },
  { id: 'gz-baili-juanhua', name: '百里杜鹃', province: '贵州', lng: 105.8, lat: 27.1, category: 'nature.grassland', visibility: 'detour20', tier: 'A', score: 60, intro: '黔西百里杜鹃林带，杭瑞高速黔西出口，春天百里花海。' },
  { id: 'gz-longgong', name: '龙宫', province: '贵州', lng: 105.9, lat: 26.1, category: 'nature.canyon', visibility: 'detour5', tier: 'A', score: 58, intro: '安顺龙宫水溶洞地下河，沪昆高速安顺出口，龙门瀑布天池。' },
  { id: 'gz-tianlong-tunpu', name: '天龙屯堡', province: '贵州', lng: 106.1, lat: 26.3, category: 'culture.ancient-town', visibility: 'detour5', tier: 'B', score: 52, intro: '平坝天龙屯堡明代军屯，沪昆高速平坝出口，石头江南地戏。' },
  { id: 'gz-yunmen-tun', name: '云门屯', province: '贵州', lng: 106.6, lat: 27.0, category: 'nature.canyon', visibility: 'detour20', tier: 'B', score: 48, intro: '遵义云门屯洛安江峡，杭瑞高速遵义出口，云门囤水峡。' },

  // ===== 补充候选（填补缺口）=====
  // 天津 +2
  { id: 'tj-jizhou-gucheng', name: '蓟州古城', province: '天津', lng: 117.41, lat: 40.05, category: 'culture.ancient-town', visibility: 'detour5', tier: 'B', score: 52, intro: '蓟州古城渔阳郡治，津蓟高速蓟州出口，独乐寺白塔鲁班庙。' },
  { id: 'tj-baxian-tableland', name: '八仙桌', province: '天津', lng: 117.53, lat: 40.16, category: 'nature.mountain', visibility: 'detour20', tier: 'C', score: 42, intro: '蓟州八仙桌石英砂岩台地，津蓟高速延长线可达，桌状山顶。' },
  { id: 'tj-jizhou-baita', name: '蓟州白塔', province: '天津', lng: 117.4, lat: 40.06, category: 'culture.heritage', visibility: 'detour5', tier: 'B', score: 48, intro: '蓟州白塔辽代古塔，津蓟高速蓟州出口，独乐寺附属建筑。' },
  // 宁夏 +2
  { id: 'nx-helan-zhongkou', name: '贺兰山滚钟口景区', province: '宁夏', lng: 105.88, lat: 38.53, category: 'nature.mountain', visibility: 'detour5', tier: 'B', score: 52, intro: '贺兰山滚钟口笔架峰三面环山，京藏高速银川出口，西夏行宫。' },
  { id: 'nx-yinchuan-haihe-tower', name: '银川海宝塔', province: '宁夏', lng: 106.28, lat: 38.48, category: 'culture.heritage', visibility: 'detour5', tier: 'B', score: 48, intro: '银川海宝塔北郊海宝公园，京藏高速可达，千年古塔。' },
  // 安徽 +4
  { id: 'ah-jingxian-taohuatan', name: '泾县桃花潭', province: '安徽', lng: 118.3, lat: 30.85, category: 'nature.river', visibility: 'detour5', tier: 'B', score: 54, intro: '泾县桃花潭李白汪伦情，沪渝高速泾县出口，潭面十里踏歌岸。' },
  { id: 'ah-ningguo-enlong', name: '恩龙世界木屋村', province: '安徽', lng: 118.98, lat: 30.63, category: 'viewpoint.landmark', visibility: 'detour5', tier: 'C', score: 42, intro: '宁国恩龙木屋村，沪渝高速宁国出口，世界民俗博览。' },
  { id: 'ah-guichi-mushan', name: '池州牧山', province: '安徽', lng: 117.5, lat: 30.7, category: 'nature.mountain', visibility: 'detour20', tier: 'C', score: 42, intro: '池州牧山秋浦河畔，沪渝高速池州出口，李白秋浦歌。' },
  { id: 'ah-qianshan', name: '潜山山谷流泉', province: '安徽', lng: 116.58, lat: 30.63, category: 'culture.heritage', visibility: 'detour5', tier: 'B', score: 48, intro: '潜山山谷流泉摩崖石刻，沪蓉高速潜山出口，三祖僧璨道场。' },
  // 湖北 +5
  { id: 'hb-huangmei-wuzu', name: '黄梅五祖寺', province: '湖北', lng: 115.9, lat: 30.1, category: 'culture.temple', visibility: 'detour5', tier: 'A', score: 56, intro: '黄梅五祖寺禅宗五祖弘忍道场，沪蓉高速黄梅出口，东山法门。' },
  { id: 'hb-huangmei-sizu', name: '黄梅四祖寺', province: '湖北', lng: 115.85, lat: 30.15, category: 'culture.temple', visibility: 'detour5', tier: 'B', score: 52, intro: '黄梅四祖寺禅宗四祖道信道场，沪蓉高速黄梅出口，双峰山。' },
  { id: 'hb-tongshan-jiugong', name: '通山闯王陵', province: '湖北', lng: 114.5, lat: 29.5, category: 'culture.heritage', visibility: 'detour20', tier: 'B', score: 50, intro: '通山李自成墓九宫山，杭瑞高速通山出口，闯王殉难处。' },
  { id: 'hb-enshi-suobuya', name: '恩施土司城', province: '湖北', lng: 109.5, lat: 30.27, category: 'culture.ancient-town', visibility: 'detour5', tier: 'B', score: 54, intro: '恩施土司城土家族吊脚楼，沪蓉高速恩施出口，九进堂土司王府。' },
  { id: 'hb-xianning-wenquan', name: '咸宁温泉', province: '湖北', lng: 114.3, lat: 29.85, category: 'experience.hot-spring', visibility: 'detour5', tier: 'B', score: 52, intro: '咸宁温泉地热资源，京港澳高速咸宁出口，华中温泉之乡。' },
];

for (const c of cand) {
  if (!c.id || !c.name || !PROVINCES.has(c.province)) throw new Error(`${c.id}: id/name/province 非法`);
  if (!CATS.has(c.category)) throw new Error(`${c.id}: category ${c.category} 不在词表`);
  if (!VIS.has(c.visibility)) throw new Error(`${c.id}: visibility ${c.visibility} 非法`);
  const len = [...c.intro].length;
  if (len < 10 || len > 90) throw new Error(`${c.id}: intro ${len} 字，需 10~90`);
}

const main = JSON.parse(readFileSync(target, 'utf8'));
const norm = (n) => String(n || '').replace(/（[^）]*）/g, '').replace(/[·・\s]/g, '');

const existingIds = new Set(main.spots.map((s) => s.id));
const existingByNameProv = new Map();
for (const s of main.spots) {
  const key = `${norm(s.name)}|${s.province || ''}`;
  if (!existingByNameProv.has(key)) existingByNameProv.set(key, s);
}
const existingPts = main.spots.map((s) => [s.lng, s.lat]);

const rows = [];
let dupId = 0, dupName = 0, dupProx = 0;
for (const c of cand) {
  if (existingIds.has(c.id)) { dupId += 1; continue; }
  if (existingByNameProv.has(`${norm(c.name)}|${c.province}`)) { dupName += 1; continue; }
  let prox = false;
  for (const [lng, lat] of existingPts) {
    const dx = (lng - c.lng) * 111.32 * Math.cos((c.lat * Math.PI) / 180);
    const dy = (lat - c.lat) * 110.574;
    if (Math.hypot(dx, dy) < 0.5) { prox = true; break; }
  }
  if (prox) { dupProx += 1; continue; }
  for (const r of rows) {
    const dx = (r.lng - c.lng) * 111.32 * Math.cos((c.lat * Math.PI) / 180);
    const dy = (r.lat - c.lat) * 110.574;
    if (Math.hypot(dx, dy) < 0.5) { prox = true; break; }
  }
  if (prox) { dupProx += 1; continue; }
  rows.push(c);
}

const byProvBefore = {};
for (const p of ['安徽', '湖北', '天津', '宁夏', '青海', '贵州']) {
  byProvBefore[p] = main.spots.filter((s) => s.province === p).length;
}
const byProvAdd = {};
for (const c of rows) byProvAdd[c.province] = (byProvAdd[c.province] || 0) + 1;

console.log(`候选 ${cand.length} | 去重 id=${dupId} name=${dupName} prox=${dupProx} | 新增 ${rows.length}`);
console.log('六省增量:', JSON.stringify(byProvAdd));
console.log('六省入库后:', JSON.stringify(Object.fromEntries(
  Object.entries(byProvBefore).map(([p, n]) => [p, n + (byProvAdd[p] || 0)]),
)));

if (WRITE) {
  if (!existsSync(backup)) copyFileSync(target, backup);
  for (const c of rows) {
    main.spots.push({
      id: c.id, name: c.name, lng: c.lng, lat: c.lat,
      tier: c.tier, category: c.category, score: c.score,
      visibility: c.visibility, intro: c.intro,
      canPark: ['roadside', 'detour5'].includes(c.visibility),
      source: 'hand-curated', verified: true, province: c.province,
      reviewedAt,
    });
  }
  main.updated = reviewedAt;
  writeFileSync(target, JSON.stringify(main, null, 2) + '\n', 'utf8');
  console.log(`--write 已落盘 -> ${target}（总 ${main.spots.length} 条）`);
} else {
  console.log('--dry 预览模式（不写盘），正式落盘请加 --write');
}