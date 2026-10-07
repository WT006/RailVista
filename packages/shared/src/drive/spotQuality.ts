/**
 * 公路景点是否值得作为「景点」展示（图集 / 沿程可共用）。
 * 不改库文件；OSM 测绘支峰、乐园设施、金门工事在这里挡掉。
 */
import { inKinmenMatsu } from './spotGrid.js';

export const ROAD_ATLAS_MIN_SCORE = 65;

const PEAK_CATS = new Set(['nature.mountain', 'nature.canyon']);
const CJK_RE = /[\u4e00-\u9fff]/;
const NOTABLE_PEAK = /主峰|雪山|景区|风景区|国家公园|大峡谷/;
const FAMOUS_PEAK =
  /(?<![枯翠])华山|(?<!小)黄山|(?<!小)峨眉|衡山|恒山|嵩山|长白|武夷|武当山|梵净|贡嘎|梅里|卡瓦格博|南迦巴瓦|卓奥友|希夏邦马|冈仁波齐|珠穆朗玛(?!南)|乔戈里|慕士塔格|公格尔|博格达|各拉丹冬|格拉丹东|阿尼玛卿|四姑娘|哈巴雪山|玉龙雪山|梧桐山|骊山|崂山|太白|青城|点苍|鸡足|神农架|神农顶|武功山|三清山|丹霞/;
const FALSE_FAMOUS = /小黄山|枯华山|小峨眉|牛黄山|梅恒山|北武当|珠穆朗玛南峰/;
const SURVEY_PEAK = /海拔峰|[IVX]{1,4}\s*峰|\bI\b|\bII\b|\bIII\b|Kangri|Peak$|Ri I|Marble Peak/;
const GENERIC_VIEW = /观景台|觀景台|瞭望台|瞭望點|瞭望点|眺望|观景点|觀景點|台阶|臺階/;
const PARK_FACILITY =
  /奇航|漂流|过山车|矿山车|娱乐天地|摩天轮|旋转木马|碰碰车|Jump\s*360|游乐/;
const MILITARY_WORKS = /坑道|砲陣|據點|据点|觀測所|观测所|碉堡|鐵漢堡|铁汉堡|鐵堡/;
const JUNK_LABEL =
  /^(景点|教堂|天鹅|觀光长廊|观光长廊)$|65km|35km|飞龙乘云|爱情码头|殡葬|酒吧街|霹破石|聽海軒|听海轩|蜜月阁|佛山第一梯|走马岗网红/;
const FOREIGN_LABEL = /Núi |Ялалт|Cát Cát|Walk To The Edge|Loi Pangnao|Fupingbao|Газированная/;
const TOMB_KEEP = /乾陵|定陵|长陵|昭陵|福陵|黄帝陵|成吉思汗|中山陵|鲁迅|聂耳|苏公|明孝陵|清东陵|清西陵/;
const RUIN_KEEP = /古城|故城|高昌|楼兰|殷墟|三星堆|金沙|古格|圆明园|大明宫|交河|小河墓地|城头山|良渚|圆明/;

export type AtlasRoadDisplaySpot = {
  name: string;
  lng?: number;
  lat?: number;
  score?: number;
  category?: string;
  source?: string;
  ele?: number;
};

function isNotableMountain(s: AtlasRoadDisplaySpot): boolean {
  const name = s.name ?? '';
  if (String(s.source ?? '').startsWith('hand-curated')) return true;
  if (!CJK_RE.test(name) || SURVEY_PEAK.test(name) || FALSE_FAMOUS.test(name)) return false;
  const ele = s.ele;
  if (NOTABLE_PEAK.test(name) && !/神山/.test(name)) {
    if (!Number.isFinite(ele) || (ele as number) >= 800) return true;
  }
  if (FAMOUS_PEAK.test(name)) {
    if (Number.isFinite(ele) && (ele as number) < 800) return false;
    return true;
  }
  return false;
}

function isOsmLabelNoise(s: AtlasRoadDisplaySpot): boolean {
  const name = s.name ?? '';
  const score = s.score ?? 0;
  const cat = s.category ?? '';
  if (PARK_FACILITY.test(name) || MILITARY_WORKS.test(name)) return true;
  if (JUNK_LABEL.test(name) || FOREIGN_LABEL.test(name)) return true;
  if (/墓$|墓地$/.test(name) && !TOMB_KEEP.test(name)) return true;
  if (cat === 'culture.ruin' && !RUIN_KEEP.test(name) && score < 80) return true;
  if (/燈塔|灯塔/.test(name) && score < 76) return true;
  if (/石刻$/.test(name) && cat !== 'culture.heritage' && score < 76) return true;
  if (cat === 'viewpoint.observation-deck' && score < 70) return true;
  if (GENERIC_VIEW.test(name) && (score < 73 || /台阶|臺階|牌坊/.test(name))) return true;
  if (name.length <= 2 && score < 73) return true;
  return false;
}

/** 图集落图：真景点，不是 OSM 测绘点 */
export function isAtlasRoadDisplaySpot(s: AtlasRoadDisplaySpot): boolean {
  if ((s.score ?? 0) < ROAD_ATLAS_MIN_SCORE) return false;
  if (s.lng != null && s.lat != null && inKinmenMatsu(s.lng, s.lat)) return false;
  if (isOsmLabelNoise(s)) return false;
  const cat = s.category ?? '';
  if (PEAK_CATS.has(cat)) return isNotableMountain(s);
  return true;
}
