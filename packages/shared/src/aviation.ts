/**
 * 航空基础数据与推导工具（纪念票·飞行票使用）。
 *
 * 设计原则：
 * - 机场中文名、IATA/ICAO、英文名、坐标为**确定性数据**，本地即可自动匹配，
 *   不依赖任何在线服务（例如 广州白云 CAN ↔ Guangzhou Baiyun International Airport）。
 * - 起降时刻、登机口等动态信息只能来自航班数据服务商，见 apps/api flightLookup：
 *   配置 AIRLABS_API_KEY 后自动拉取；未配置时这些字段留空，由前端标注「待补」。
 */

/** 机场 */
export interface Airport {
  iata: string;
  icao?: string;
  /** 中文全名，如「广州白云国际机场」 */
  name: string;
  /** 简称，如「白云」 */
  short: string;
  /** 所在城市（中文） */
  city: string;
  province?: string;
  /** 英文全名 */
  nameEn: string;
  /** 城市英文名 */
  cityEn: string;
  lat: number;
  lng: number;
}

/** 航空公司 */
export interface Airline {
  iata: string;
  icao?: string;
  /** 中文全称 */
  name: string;
  /** 英文全称 */
  nameEn: string;
  /** 中文简称 */
  short?: string;
  alliance?: '星空联盟' | '天合联盟' | '寰宇一家';
  /** 品牌色 */
  color?: string;
}

/** 舱位等级 */
export interface CabinClass {
  value: string;
  valueEn: string;
  code: string;
}

export const CABIN_CLASSES: CabinClass[] = [
  { value: '经济舱', valueEn: 'Economy Class', code: 'Y' },
  { value: '超级经济舱', valueEn: 'Premium Economy', code: 'W' },
  { value: '公务舱', valueEn: 'Business Class', code: 'J' },
  { value: '头等舱', valueEn: 'First Class', code: 'F' },
];

// ── 机场库（中国大陆/港澳台主要运输机场 + 常用国际枢纽） ─────────────────────
const AIRPORT_LIST: Airport[] = [
  // 华北
  { iata: 'PEK', icao: 'ZBAA', name: '北京首都国际机场', short: '首都', city: '北京', province: '北京', nameEn: 'Beijing Capital International Airport', cityEn: 'Beijing', lat: 40.08, lng: 116.58 },
  { iata: 'PKX', icao: 'ZBAD', name: '北京大兴国际机场', short: '大兴', city: '北京', province: '北京', nameEn: 'Beijing Daxing International Airport', cityEn: 'Beijing', lat: 39.51, lng: 116.41 },
  { iata: 'NAY', icao: 'ZBNY', name: '北京南苑机场', short: '南苑', city: '北京', province: '北京', nameEn: 'Beijing Nanyuan Airport', cityEn: 'Beijing', lat: 39.79, lng: 116.39 },
  { iata: 'TSN', icao: 'ZBTJ', name: '天津滨海国际机场', short: '滨海', city: '天津', province: '天津', nameEn: 'Tianjin Binhai International Airport', cityEn: 'Tianjin', lat: 39.12, lng: 117.35 },
  { iata: 'SJW', icao: 'ZBSJ', name: '石家庄正定国际机场', short: '正定', city: '石家庄', province: '河北', nameEn: 'Shijiazhuang Zhengding International Airport', cityEn: 'Shijiazhuang', lat: 38.28, lng: 114.70 },
  { iata: 'HDG', icao: 'ZBHD', name: '邯郸机场', short: '邯郸', city: '邯郸', province: '河北', nameEn: 'Handan Airport', cityEn: 'Handan', lat: 36.53, lng: 114.43 },
  { iata: 'TYN', icao: 'ZBYN', name: '太原武宿国际机场', short: '武宿', city: '太原', province: '山西', nameEn: 'Taiyuan Wusu International Airport', cityEn: 'Taiyuan', lat: 37.74, lng: 112.63 },
  { iata: 'DAT', icao: 'ZBDT', name: '大同云冈机场', short: '云冈', city: '大同', province: '山西', nameEn: 'Datong Yungang Airport', cityEn: 'Datong', lat: 40.06, lng: 113.48 },
  { iata: 'CIH', icao: 'ZBCZ', name: '长治王村机场', short: '王村', city: '长治', province: '山西', nameEn: 'Changzhi Wangcun Airport', cityEn: 'Changzhi', lat: 36.08, lng: 113.13 },
  { iata: 'YCU', icao: 'ZBYC', name: '运城张孝机场', short: '张孝', city: '运城', province: '山西', nameEn: 'Yuncheng Zhangxiao Airport', cityEn: 'Yuncheng', lat: 35.12, lng: 111.03 },
  { iata: 'WUT', icao: 'ZBXZ', name: '忻州五台山机场', short: '五台山', city: '忻州', province: '山西', nameEn: 'Xinzhou Wutaishan Airport', cityEn: 'Xinzhou', lat: 38.60, lng: 112.97 },
  { iata: 'LLV', icao: 'ZBLL', name: '吕梁大武机场', short: '大武', city: '吕梁', province: '山西', nameEn: 'Lvliang Dawu Airport', cityEn: 'Lvliang', lat: 37.69, lng: 111.14 },
  { iata: 'HET', icao: 'ZBHH', name: '呼和浩特白塔国际机场', short: '白塔', city: '呼和浩特', province: '内蒙古', nameEn: 'Hohhot Baita International Airport', cityEn: 'Hohhot', lat: 40.85, lng: 111.82 },
  { iata: 'BAV', icao: 'ZBOW', name: '包头东河机场', short: '东河', city: '包头', province: '内蒙古', nameEn: 'Baotou Donghe Airport', cityEn: 'Baotou', lat: 40.56, lng: 110.00 },
  { iata: 'XIL', icao: 'ZBXH', name: '锡林浩特机场', short: '锡林浩特', city: '锡林浩特', province: '内蒙古', nameEn: 'Xilinhot Airport', cityEn: 'Xilinhot', lat: 43.91, lng: 116.10 },
  { iata: 'CIF', icao: 'ZBCF', name: '赤峰玉龙机场', short: '玉龙', city: '赤峰', province: '内蒙古', nameEn: 'Chifeng Yulong Airport', cityEn: 'Chifeng', lat: 42.16, lng: 118.84 },
  { iata: 'HLH', icao: 'ZBUL', name: '乌兰浩特义勒力特机场', short: '义勒力特', city: '乌兰浩特', province: '内蒙古', nameEn: 'Ulanhot Yileleeteuk Airport', cityEn: 'Ulanhot', lat: 46.20, lng: 122.01 },
  { iata: 'TGO', icao: 'ZBTL', name: '通辽机场', short: '通辽', city: '通辽', province: '内蒙古', nameEn: 'Tongliao Airport', cityEn: 'Tongliao', lat: 43.56, lng: 122.20 },
  { iata: 'ERL', icao: 'ZBER', name: '二连浩特赛乌苏国际机场', short: '赛乌苏', city: '二连浩特', province: '内蒙古', nameEn: 'Erenhot Saiwusu International Airport', cityEn: 'Erenhot', lat: 43.69, lng: 112.08 },
  { iata: 'WUA', icao: 'ZBUH', name: '乌海机场', short: '乌海', city: '乌海', province: '内蒙古', nameEn: 'Wuhai Airport', cityEn: 'Wuhai', lat: 39.68, lng: 106.80 },
  { iata: 'EJN', icao: 'ZBEN', name: '额济纳旗桃来机场', short: '桃来', city: '额济纳旗', province: '内蒙古', nameEn: 'Ejina Banner Taolai Airport', cityEn: 'Ejina', lat: 41.95, lng: 100.90 },
  { iata: 'HLD', icao: 'ZBLA', name: '海拉尔东山机场', short: '东山', city: '海拉尔', province: '内蒙古', nameEn: 'Hailar Dongshan Airport', cityEn: 'Hailar', lat: 49.21, lng: 119.82 },
  { iata: 'NZH', icao: 'ZBMZ', name: '满洲里西郊机场', short: '西郊', city: '满洲里', province: '内蒙古', nameEn: 'Manzhouli Xijiao Airport', cityEn: 'Manzhouli', lat: 49.57, lng: 117.33 },

  // 东北
  { iata: 'SHE', icao: 'ZYTX', name: '沈阳桃仙国际机场', short: '桃仙', city: '沈阳', province: '辽宁', nameEn: 'Shenyang Taoxian International Airport', cityEn: 'Shenyang', lat: 41.64, lng: 123.48 },
  { iata: 'DLC', icao: 'ZYTL', name: '大连周水子国际机场', short: '周水子', city: '大连', province: '辽宁', nameEn: 'Dalian Zhoushuizi International Airport', cityEn: 'Dalian', lat: 38.96, lng: 121.54 },
  { iata: 'JNZ', icao: 'ZYJZ', name: '锦州锦州湾机场', short: '锦州湾', city: '锦州', province: '辽宁', nameEn: 'Jinzhou Jinzhouwan Airport', cityEn: 'Jinzhou', lat: 39.07, lng: 121.29 },
  { iata: 'AOG', icao: 'ZYAS', name: '鞍山腾鳌机场', short: '腾鳌', city: '鞍山', province: '辽宁', nameEn: 'Anshan Tengao Airport', cityEn: 'Anshan', lat: 41.10, lng: 122.96 },
  { iata: 'HRB', icao: 'ZYHB', name: '哈尔滨太平国际机场', short: '太平', city: '哈尔滨', province: '黑龙江', nameEn: 'Harbin Taiping International Airport', cityEn: 'Harbin', lat: 45.62, lng: 126.25 },
  { iata: 'MDG', icao: 'ZYMD', name: '牡丹江海浪国际机场', short: '海浪', city: '牡丹江', province: '黑龙江', nameEn: 'Mudanjiang Hailang International Airport', cityEn: 'Mudanjiang', lat: 44.53, lng: 129.57 },
  { iata: 'JMU', icao: 'ZYJM', name: '佳木斯东郊机场', short: '东郊', city: '佳木斯', province: '黑龙江', nameEn: 'Jiamusi Dongjiao Airport', cityEn: 'Jiamusi', lat: 46.84, lng: 130.46 },
  { iata: 'HEK', icao: 'ZYHE', name: '黑河瑷珲机场', short: '瑷珲', city: '黑河', province: '黑龙江', nameEn: 'Heihe Aihui Airport', cityEn: 'Heihe', lat: 50.22, lng: 127.49 },
  { iata: 'OHE', icao: 'ZYMH', name: '漠河古莲机场', short: '古莲', city: '漠河', province: '黑龙江', nameEn: 'Mohe Gulian Airport', cityEn: 'Mohe', lat: 52.91, lng: 122.42 },
  { iata: 'DQA', icao: 'ZYDQ', name: '大庆萨尔图机场', short: '萨尔图', city: '大庆', province: '黑龙江', nameEn: 'Daqing Sartu Airport', cityEn: 'Daqing', lat: 46.74, lng: 125.13 },
  { iata: 'CGQ', icao: 'ZYCC', name: '长春龙嘉国际机场', short: '龙嘉', city: '长春', province: '吉林', nameEn: 'Changchun Longjia International Airport', cityEn: 'Changchun', lat: 43.99, lng: 125.69 },
  { iata: 'JIL', icao: 'ZYJL', name: '吉林二台子机场', short: '二台子', city: '吉林', province: '吉林', nameEn: 'Jilin Ertaizi Airport', cityEn: 'Jilin', lat: 43.87, lng: 126.39 },
  { iata: 'YNJ', icao: 'ZYYJ', name: '延吉朝阳川国际机场', short: '朝阳川', city: '延吉', province: '吉林', nameEn: 'Yanji Chaoyangchuan International Airport', cityEn: 'Yanji', lat: 42.88, lng: 129.45 },

  // 华东
  { iata: 'PVG', icao: 'ZSPD', name: '上海浦东国际机场', short: '浦东', city: '上海', province: '上海', nameEn: 'Shanghai Pudong International Airport', cityEn: 'Shanghai', lat: 31.14, lng: 121.81 },
  { iata: 'SHA', icao: 'ZSSS', name: '上海虹桥国际机场', short: '虹桥', city: '上海', province: '上海', nameEn: 'Shanghai Hongqiao International Airport', cityEn: 'Shanghai', lat: 31.20, lng: 121.34 },
  { iata: 'HGH', icao: 'ZSHC', name: '杭州萧山国际机场', short: '萧山', city: '杭州', province: '浙江', nameEn: 'Hangzhou Xiaoshan International Airport', cityEn: 'Hangzhou', lat: 30.23, lng: 120.43 },
  { iata: 'NGB', icao: 'ZSNB', name: '宁波栎社国际机场', short: '栎社', city: '宁波', province: '浙江', nameEn: 'Ningbo Lishe International Airport', cityEn: 'Ningbo', lat: 29.83, lng: 121.46 },
  { iata: 'WNZ', icao: 'ZSWZ', name: '温州龙湾国际机场', short: '龙湾', city: '温州', province: '浙江', nameEn: 'Wenzhou Longwan International Airport', cityEn: 'Wenzhou', lat: 27.91, lng: 120.85 },
  { iata: 'YIW', icao: 'ZSYW', name: '义乌机场', short: '义乌', city: '义乌', province: '浙江', nameEn: 'Yiwu Airport', cityEn: 'Yiwu', lat: 29.34, lng: 120.03 },
  { iata: 'HSN', icao: 'ZSZS', name: '舟山普陀山机场', short: '普陀山', city: '舟山', province: '浙江', nameEn: 'Zhoushan Putuoshan Airport', cityEn: 'Zhoushan', lat: 29.94, lng: 122.36 },
  { iata: 'HYN', icao: 'ZSLQ', name: '台州路桥机场', short: '路桥', city: '台州', province: '浙江', nameEn: 'Taizhou Luqiao Airport', cityEn: 'Taizhou', lat: 28.56, lng: 121.42 },
  { iata: 'NKG', icao: 'ZSNJ', name: '南京禄口国际机场', short: '禄口', city: '南京', province: '江苏', nameEn: 'Nanjing Lukou International Airport', cityEn: 'Nanjing', lat: 31.74, lng: 118.86 },
  { iata: 'WUX', icao: 'ZSWX', name: '无锡硕放机场', short: '硕放', city: '无锡', province: '江苏', nameEn: 'Wuxi Shuofang Airport', cityEn: 'Wuxi', lat: 31.50, lng: 120.43 },
  { iata: 'CZX', icao: 'ZSCZ', name: '常州奔牛国际机场', short: '奔牛', city: '常州', province: '江苏', nameEn: 'Changzhou Benniu International Airport', cityEn: 'Changzhou', lat: 31.92, lng: 119.78 },
  { iata: 'XUZ', icao: 'ZSXZ', name: '徐州观音国际机场', short: '观音', city: '徐州', province: '江苏', nameEn: 'Xuzhou Guanyin International Airport', cityEn: 'Xuzhou', lat: 34.06, lng: 117.56 },
  { iata: 'YNZ', icao: 'ZSYN', name: '盐城南洋国际机场', short: '南洋', city: '盐城', province: '江苏', nameEn: 'Yancheng Nanyang International Airport', cityEn: 'Yancheng', lat: 33.43, lng: 120.20 },
  { iata: 'HFE', icao: 'ZSOF', name: '合肥新桥国际机场', short: '新桥', city: '合肥', province: '安徽', nameEn: 'Hefei Xinqiao International Airport', cityEn: 'Hefei', lat: 31.86, lng: 116.97 },
  { iata: 'FUG', icao: 'ZSFY', name: '阜阳西关机场', short: '西关', city: '阜阳', province: '安徽', nameEn: 'Fuyang Xiguan Airport', cityEn: 'Fuyang', lat: 32.88, lng: 115.74 },
  { iata: 'JIU', icao: 'ZSJJ', name: '九江庐山机场', short: '庐山', city: '九江', province: '江西', nameEn: 'Jiujiang Lushan Airport', cityEn: 'Jiujiang', lat: 29.71, lng: 116.03 },
  { iata: 'KHN', icao: 'ZSCN', name: '南昌昌北国际机场', short: '昌北', city: '南昌', province: '江西', nameEn: 'Nanchang Changbei International Airport', cityEn: 'Nanchang', lat: 28.43, lng: 115.90 },
  { iata: 'JGS', icao: 'ZSGS', name: '井冈山机场', short: '井冈山', city: '吉安', province: '江西', nameEn: 'Jinggangshan Airport', cityEn: 'Ji\'an', lat: 26.84, lng: 114.33 },
  { iata: 'FOC', icao: 'ZSFZ', name: '福州长乐国际机场', short: '长乐', city: '福州', province: '福建', nameEn: 'Fuzhou Changle International Airport', cityEn: 'Fuzhou', lat: 25.94, lng: 119.66 },
  { iata: 'XMN', icao: 'ZSAM', name: '厦门高崎国际机场', short: '高崎', city: '厦门', province: '福建', nameEn: 'Xiamen Gaoqi International Airport', cityEn: 'Xiamen', lat: 24.54, lng: 118.13 },
  { iata: 'JJN', icao: 'ZSQZ', name: '泉州晋江国际机场', short: '晋江', city: '泉州', province: '福建', nameEn: 'Quanzhou Jinjiang International Airport', cityEn: 'Quanzhou', lat: 24.80, lng: 118.59 },
  { iata: 'WUS', icao: 'ZSWY', name: '武夷山机场', short: '武夷山', city: '南平', province: '福建', nameEn: 'Wuyishan Airport', cityEn: 'Wuyishan', lat: 27.45, lng: 118.00 },
  { iata: 'TNA', icao: 'ZSJN', name: '济南遥墙国际机场', short: '遥墙', city: '济南', province: '山东', nameEn: 'Jinan Yaoqiang International Airport', cityEn: 'Jinan', lat: 36.86, lng: 117.22 },
  { iata: 'TAO', icao: 'ZSQD', name: '青岛胶东国际机场', short: '胶东', city: '青岛', province: '山东', nameEn: 'Qingdao Jiaodong International Airport', cityEn: 'Qingdao', lat: 36.27, lng: 120.37 },
  { iata: 'YNT', icao: 'ZSYT', name: '烟台蓬莱国际机场', short: '蓬莱', city: '烟台', province: '山东', nameEn: 'Yantai Penglai International Airport', cityEn: 'Yantai', lat: 37.64, lng: 120.72 },
  { iata: 'WEF', icao: 'ZSWF', name: '潍坊机场', short: '潍坊', city: '潍坊', province: '山东', nameEn: 'Weifang Airport', cityEn: 'Weifang', lat: 36.79, lng: 119.12 },
  { iata: 'DOY', icao: 'ZSDY', name: '东营胜利机场', short: '胜利', city: '东营', province: '山东', nameEn: 'Dongying Shengli Airport', cityEn: 'Dongying', lat: 37.50, lng: 118.79 },
  { iata: 'RIZ', icao: 'ZSRZ', name: '日照山字河机场', short: '山字河', city: '日照', province: '山东', nameEn: 'Rizhao Shanzihe Airport', cityEn: 'Rizhao', lat: 35.40, lng: 119.32 },

  // 华中
  { iata: 'CGO', icao: 'ZHCC', name: '郑州新郑国际机场', short: '新郑', city: '郑州', province: '河南', nameEn: 'Zhengzhou Xinzheng International Airport', cityEn: 'Zhengzhou', lat: 34.52, lng: 113.84 },
  { iata: 'LYA', icao: 'ZHLY', name: '洛阳北郊机场', short: '北郊', city: '洛阳', province: '河南', nameEn: 'Luoyang Beijiao Airport', cityEn: 'Luoyang', lat: 34.74, lng: 112.39 },
  { iata: 'NNY', icao: 'ZHNY', name: '南阳姜营机场', short: '姜营', city: '南阳', province: '河南', nameEn: 'Nanyang Jiangying Airport', cityEn: 'Nanyang', lat: 33.00, lng: 112.62 },
  { iata: 'WUH', icao: 'ZHHH', name: '武汉天河国际机场', short: '天河', city: '武汉', province: '湖北', nameEn: 'Wuhan Tianhe International Airport', cityEn: 'Wuhan', lat: 30.78, lng: 114.21 },
  { iata: 'YIH', icao: 'ZHYC', name: '宜昌三峡机场', short: '三峡', city: '宜昌', province: '湖北', nameEn: 'Yichang Sanxia Airport', cityEn: 'Yichang', lat: 30.55, lng: 111.48 },
  { iata: 'WDS', icao: 'ZHSY', name: '十堰武当山机场', short: '武当山', city: '十堰', province: '湖北', nameEn: 'Shiyan Wudangshan Airport', cityEn: 'Shiyan', lat: 32.59, lng: 110.91 },
  { iata: 'XFN', icao: 'ZHXF', name: '襄阳刘集机场', short: '刘集', city: '襄阳', province: '湖北', nameEn: 'Xiangyang Liuji Airport', cityEn: 'Xiangyang', lat: 32.15, lng: 112.29 },
  { iata: 'ENH', icao: 'ZHES', name: '恩施许家坪机场', short: '许家坪', city: '恩施', province: '湖北', nameEn: 'Enshi Xujiaping Airport', cityEn: 'Enshi', lat: 30.32, lng: 109.49 },
  { iata: 'CSX', icao: 'ZGHA', name: '长沙黄花国际机场', short: '黄花', city: '长沙', province: '湖南', nameEn: 'Changsha Huanghua International Airport', cityEn: 'Changsha', lat: 28.19, lng: 113.22 },
  { iata: 'DYG', icao: 'ZGDY', name: '张家界荷花机场', short: '荷花', city: '张家界', province: '湖南', nameEn: 'Zhangjiajie Hehua Airport', cityEn: 'Zhangjiajie', lat: 29.10, lng: 110.44 },

  // 华南
  { iata: 'CAN', icao: 'ZGGG', name: '广州白云国际机场', short: '白云', city: '广州', province: '广东', nameEn: 'Guangzhou Baiyun International Airport', cityEn: 'Guangzhou', lat: 23.39, lng: 113.30 },
  { iata: 'SZX', icao: 'ZGSZ', name: '深圳宝安国际机场', short: '宝安', city: '深圳', province: '广东', nameEn: "Shenzhen Bao'an International Airport", cityEn: 'Shenzhen', lat: 22.64, lng: 113.81 },
  { iata: 'ZUH', icao: 'ZGSD', name: '珠海金湾机场', short: '金湾', city: '珠海', province: '广东', nameEn: 'Zhuhai Jinwan Airport', cityEn: 'Zhuhai', lat: 22.01, lng: 113.38 },
  { iata: 'SWA', icao: 'ZGOW', name: '揭阳潮汕国际机场', short: '潮汕', city: '揭阳', province: '广东', nameEn: 'Jieyang Chaoshan International Airport', cityEn: 'Jieyang', lat: 23.56, lng: 116.51 },
  { iata: 'ZHA', icao: 'ZGZJ', name: '湛江吴川机场', short: '吴川', city: '湛江', province: '广东', nameEn: 'Zhanjiang Wuchuan Airport', cityEn: 'Zhanjiang', lat: 21.22, lng: 110.36 },
  { iata: 'HUZ', icao: 'ZGHZ', name: '惠州平潭机场', short: '平潭', city: '惠州', province: '广东', nameEn: 'Huizhou Pingtan Airport', cityEn: 'Huizhou', lat: 23.25, lng: 114.60 },
  { iata: 'MXZ', icao: 'ZGMX', name: '梅州梅县机场', short: '梅县', city: '梅州', province: '广东', nameEn: 'Meizhou Meixian Airport', cityEn: 'Meizhou', lat: 24.26, lng: 116.10 },
  { iata: 'NNG', icao: 'ZGNN', name: '南宁吴圩国际机场', short: '吴圩', city: '南宁', province: '广西', nameEn: 'Nanning Wuxu International Airport', cityEn: 'Nanning', lat: 22.61, lng: 108.17 },
  { iata: 'BHY', icao: 'ZGBH', name: '北海福成机场', short: '福成', city: '北海', province: '广西', nameEn: 'Beihai Fucheng Airport', cityEn: 'Beihai', lat: 21.54, lng: 109.29 },
  { iata: 'KWL', icao: 'ZGKL', name: '桂林两江国际机场', short: '两江', city: '桂林', province: '广西', nameEn: 'Guilin Liangjiang International Airport', cityEn: 'Guilin', lat: 25.22, lng: 110.04 },
  { iata: 'HAK', icao: 'ZJHK', name: '海口美兰国际机场', short: '美兰', city: '海口', province: '海南', nameEn: 'Haikou Meilan International Airport', cityEn: 'Haikou', lat: 19.94, lng: 110.46 },
  { iata: 'SYX', icao: 'ZJSY', name: '三亚凤凰国际机场', short: '凤凰', city: '三亚', province: '海南', nameEn: 'Sanya Phoenix International Airport', cityEn: 'Sanya', lat: 18.30, lng: 109.41 },

  // 西南
  { iata: 'CTU', icao: 'ZUUU', name: '成都双流国际机场', short: '双流', city: '成都', province: '四川', nameEn: 'Chengdu Shuangliu International Airport', cityEn: 'Chengdu', lat: 30.58, lng: 103.95 },
  { iata: 'TFU', icao: 'ZUTF', name: '成都天府国际机场', short: '天府', city: '成都', province: '四川', nameEn: 'Chengdu Tianfu International Airport', cityEn: 'Chengdu', lat: 30.32, lng: 104.44 },
  { iata: 'MIG', icao: 'ZUMY', name: '绵阳南郊机场', short: '南郊', city: '绵阳', province: '四川', nameEn: 'Mianyang Nanjiao Airport', cityEn: 'Mianyang', lat: 31.43, lng: 104.74 },
  { iata: 'DAX', icao: 'ZUDX', name: '达州河市机场', short: '河市', city: '达州', province: '四川', nameEn: 'Dazhou Heshi Airport', cityEn: 'Dazhou', lat: 31.13, lng: 107.43 },
  { iata: 'YBP', icao: 'ZUYB', name: '宜宾五粮液机场', short: '五粮液', city: '宜宾', province: '四川', nameEn: 'Yibin Wuliangye Airport', cityEn: 'Yibin', lat: 28.86, lng: 104.55 },
  { iata: 'LZO', icao: 'ZULZ', name: '泸州云龙机场', short: '云龙', city: '泸州', province: '四川', nameEn: 'Luzhou Yunlong Airport', cityEn: 'Luzhou', lat: 28.85, lng: 105.47 },
  { iata: 'NAO', icao: 'ZUNC', name: '南充高坪机场', short: '高坪', city: '南充', province: '四川', nameEn: 'Nanchong Gaoping Airport', cityEn: 'Nanchong', lat: 30.80, lng: 106.17 },
  { iata: 'XTC', icao: 'ZUXC', name: '西昌青山机场', short: '青山', city: '西昌', province: '四川', nameEn: 'Xichang Qingshan Airport', cityEn: 'Xichang', lat: 27.99, lng: 102.18 },
  { iata: 'CKG', icao: 'ZUCK', name: '重庆江北国际机场', short: '江北', city: '重庆', province: '重庆', nameEn: 'Chongqing Jiangbei International Airport', cityEn: 'Chongqing', lat: 29.72, lng: 106.64 },
  { iata: 'WXN', icao: 'ZUWX', name: '万州五桥机场', short: '五桥', city: '万州', province: '重庆', nameEn: 'Wanzhou Wuqiao Airport', cityEn: 'Wanzhou', lat: 30.80, lng: 108.43 },
  { iata: 'JIQ', icao: 'ZUQJ', name: '黔江武陵山机场', short: '武陵山', city: '黔江', province: '重庆', nameEn: 'Qianjiang Wulingshan Airport', cityEn: 'Qianjiang', lat: 29.52, lng: 108.83 },
  { iata: 'KMG', icao: 'ZPPP', name: '昆明长水国际机场', short: '长水', city: '昆明', province: '云南', nameEn: 'Kunming Changshui International Airport', cityEn: 'Kunming', lat: 25.10, lng: 102.93 },
  { iata: 'JHG', icao: 'ZPJH', name: '西双版纳嘎洒国际机场', short: '嘎洒', city: '景洪', province: '云南', nameEn: 'Xishuangbanna Gasa International Airport', cityEn: 'Jinghong', lat: 21.99, lng: 100.76 },
  { iata: 'LJG', icao: 'ZPLJ', name: '丽江三义国际机场', short: '三义', city: '丽江', province: '云南', nameEn: 'Lijiang Sanyi International Airport', cityEn: 'Lijiang', lat: 26.68, lng: 100.25 },
  { iata: 'DLU', icao: 'ZPDL', name: '大理荒草坝机场', short: '荒草坝', city: '大理', province: '云南', nameEn: 'Dali Huangcaoba Airport', cityEn: 'Dali', lat: 25.65, lng: 100.32 },
  { iata: 'DIG', icao: 'ZPDQ', name: '迪庆香格里拉机场', short: '香格里拉', city: '迪庆', province: '云南', nameEn: 'Diqing Shangri-La Airport', cityEn: 'Diqing', lat: 27.79, lng: 99.68 },
  { iata: 'LUM', icao: 'ZPMS', name: '德宏芒市国际机场', short: '芒市', city: '芒市', province: '云南', nameEn: 'Dehong Mangshi International Airport', cityEn: 'Mangshi', lat: 24.40, lng: 98.53 },
  { iata: 'TCZ', icao: 'ZPTC', name: '腾冲驼峰机场', short: '驼峰', city: '腾冲', province: '云南', nameEn: 'Tengchong Tuofeng Airport', cityEn: 'Tengchong', lat: 24.94, lng: 98.49 },
  { iata: 'BSD', icao: 'ZPBS', name: '保山云瑞机场', short: '云瑞', city: '保山', province: '云南', nameEn: 'Baoshan Yunrui Airport', cityEn: 'Baoshan', lat: 25.05, lng: 99.17 },
  { iata: 'PUM', icao: 'ZPSM', name: '普洱思茅机场', short: '思茅', city: '普洱', province: '云南', nameEn: 'Pu\'er Simao Airport', cityEn: 'Pu\'er', lat: 22.79, lng: 100.96 },
  { iata: 'LNJ', icao: 'ZPLC', name: '临沧博尚机场', short: '博尚', city: '临沧', province: '云南', nameEn: 'Lincang Boshang Airport', cityEn: 'Lincang', lat: 23.74, lng: 100.03 },
  { iata: 'KWE', icao: 'ZUGY', name: '贵阳龙洞堡国际机场', short: '龙洞堡', city: '贵阳', province: '贵州', nameEn: 'Guiyang Longdongbao International Airport', cityEn: 'Guiyang', lat: 26.54, lng: 106.80 },
  { iata: 'ZYI', icao: 'ZUZY', name: '遵义新舟机场', short: '新舟', city: '遵义', province: '贵州', nameEn: 'Zunyi Xinzhou Airport', cityEn: 'Zunyi', lat: 27.81, lng: 107.25 },
  { iata: 'WMT', icao: 'ZUMT', name: '遵义茅台机场', short: '茅台', city: '遵义', province: '贵州', nameEn: 'Zunyi Maotai Airport', cityEn: 'Zunyi', lat: 27.97, lng: 106.44 },
  { iata: 'ACX', icao: 'ZUYI', name: '兴义万峰林机场', short: '万峰林', city: '兴义', province: '贵州', nameEn: 'Xingyi Wanfenglin Airport', cityEn: 'Xingyi', lat: 25.09, lng: 104.96 },
  { iata: 'TEN', icao: 'ZUTR', name: '铜仁凤凰机场', short: '凤凰', city: '铜仁', province: '贵州', nameEn: 'Tongren Fenghuang Airport', cityEn: 'Tongren', lat: 27.89, lng: 109.30 },
  { iata: 'LXA', icao: 'ZULS', name: '拉萨贡嘎国际机场', short: '贡嘎', city: '拉萨', province: '西藏', nameEn: 'Lhasa Gonggar International Airport', cityEn: 'Lhasa', lat: 29.30, lng: 90.91 },
  { iata: 'LZY', icao: 'ZUNZ', name: '林芝米林机场', short: '米林', city: '林芝', province: '西藏', nameEn: 'Nyingchi Mainling Airport', cityEn: 'Nyingchi', lat: 29.31, lng: 94.34 },
  { iata: 'BPX', icao: 'ZUBD', name: '昌都邦达机场', short: '邦达', city: '昌都', province: '西藏', nameEn: 'Qamdo Bamda Airport', cityEn: 'Qamdo', lat: 30.55, lng: 97.11 },
  { iata: 'NGQ', icao: 'ZUAL', name: '阿里普兰机场', short: '普兰', city: '阿里', province: '西藏', nameEn: 'Ngari Burang Airport', cityEn: 'Ngari', lat: 30.20, lng: 81.15 },
  { iata: 'GOQ', icao: 'ZLGM', name: '格尔木机场', short: '格尔木', city: '格尔木', province: '青海', nameEn: 'Golmud Airport', cityEn: 'Golmud', lat: 36.40, lng: 94.79 },
  { iata: 'XNN', icao: 'ZLXN', name: '西宁曹家堡国际机场', short: '曹家堡', city: '西宁', province: '青海', nameEn: 'Xining Caojiabao International Airport', cityEn: 'Xining', lat: 36.53, lng: 102.04 },
  { iata: 'XIY', icao: 'ZLXY', name: '西安咸阳国际机场', short: '咸阳', city: '西安', province: '陕西', nameEn: "Xi'an Xianyang International Airport", cityEn: "Xi'an", lat: 34.45, lng: 108.75 },
  { iata: 'ENY', icao: 'ZLYA', name: '延安南泥湾机场', short: '南泥湾', city: '延安', province: '陕西', nameEn: 'Yan\'an Nanniwan Airport', cityEn: "Yan'an", lat: 36.64, lng: 109.46 },
  { iata: 'UYN', icao: 'ZLYL', name: '榆林榆阳机场', short: '榆阳', city: '榆林', province: '陕西', nameEn: 'Yulin Yuyang Airport', cityEn: 'Yulin', lat: 38.27, lng: 109.73 },
  { iata: 'LHW', icao: 'ZLLL', name: '兰州中川国际机场', short: '中川', city: '兰州', province: '甘肃', nameEn: 'Lanzhou Zhongchuan International Airport', cityEn: 'Lanzhou', lat: 36.52, lng: 103.62 },
  { iata: 'DNZ', icao: 'ZLDH', name: '敦煌莫高国际机场', short: '莫高', city: '敦煌', province: '甘肃', nameEn: 'Dunhuang Mogao International Airport', cityEn: 'Dunhuang', lat: 40.17, lng: 94.81 },
  { iata: 'JGN', icao: 'ZLJQ', name: '嘉峪关酒泉机场', short: '嘉峪关', city: '嘉峪关', province: '甘肃', nameEn: 'Jiayuguan Jiuquan Airport', cityEn: 'Jiayuguan', lat: 39.86, lng: 98.29 },
  { iata: 'IQN', icao: 'ZLQY', name: '庆阳西峰机场', short: '西峰', city: '庆阳', province: '甘肃', nameEn: 'Qingyang Xifeng Airport', cityEn: 'Qingyang', lat: 35.80, lng: 107.60 },
  { iata: 'CHW', icao: 'ZLJC', name: '张掖甘州机场', short: '甘州', city: '张掖', province: '甘肃', nameEn: 'Zhangye Ganzhou Airport', cityEn: 'Zhangye', lat: 38.80, lng: 100.31 },
  { iata: 'THQ', icao: 'ZLTS', name: '天水麦积山机场', short: '麦积山', city: '天水', province: '甘肃', nameEn: 'Tianshui Maijishan Airport', cityEn: 'Tianshui', lat: 34.56, lng: 105.86 },
  { iata: 'GXH', icao: 'ZLXH', name: '甘南夏河机场', short: '夏河', city: '甘南', province: '甘肃', nameEn: 'Gannan Xiahe Airport', cityEn: 'Gannan', lat: 34.81, lng: 102.91 },
  { iata: 'URC', icao: 'ZWWW', name: '乌鲁木齐地窝堡国际机场', short: '地窝堡', city: '乌鲁木齐', province: '新疆', nameEn: 'Urumqi Diwopu International Airport', cityEn: 'Urumqi', lat: 43.91, lng: 87.47 },
  { iata: 'KHG', icao: 'ZWSH', name: '喀什徕宁国际机场', short: '徕宁', city: '喀什', province: '新疆', nameEn: 'Kashgar Laining International Airport', cityEn: 'Kashgar', lat: 39.54, lng: 75.99 },
  { iata: 'HMI', icao: 'ZWHM', name: '哈密伊州机场', short: '伊州', city: '哈密', province: '新疆', nameEn: 'Hami Yizhou Airport', cityEn: 'Hami', lat: 42.84, lng: 93.67 },
  { iata: 'KRL', icao: 'ZWKL', name: '库尔勒梨城机场', short: '梨城', city: '库尔勒', province: '新疆', nameEn: 'Korla Licheng Airport', cityEn: 'Korla', lat: 41.63, lng: 86.15 },
  { iata: 'AKU', icao: 'ZWAK', name: '阿克苏红旗坡机场', short: '红旗坡', city: '阿克苏', province: '新疆', nameEn: 'Aksu Hongqipo Airport', cityEn: 'Aksu', lat: 41.26, lng: 80.29 },
  { iata: 'HTN', icao: 'ZWTN', name: '和田昆冈机场', short: '昆冈', city: '和田', province: '新疆', nameEn: 'Hotan Kungang Airport', cityEn: 'Hotan', lat: 37.04, lng: 79.86 },
  { iata: 'NLT', icao: 'ZWKN', name: '阿勒泰雪都机场', short: '雪都', city: '阿勒泰', province: '新疆', nameEn: 'Altay Xuedu Airport', cityEn: 'Altay', lat: 47.75, lng: 88.09 },
  { iata: 'KRY', icao: 'ZWKM', name: '克拉玛依古海机场', short: '古海', city: '克拉玛依', province: '新疆', nameEn: 'Karamay Guhai Airport', cityEn: 'Karamay', lat: 45.47, lng: 84.96 },
  { iata: 'BPL', icao: 'ZWBL', name: '博乐阿拉山口机场', short: '阿拉山口', city: '博乐', province: '新疆', nameEn: 'Bole Alashankou Airport', cityEn: 'Bole', lat: 44.89, lng: 82.30 },
  { iata: 'FYN', icao: 'ZWFY', name: '富蕴可可托海机场', short: '可可托海', city: '富蕴', province: '新疆', nameEn: 'Fuyun Koktokay Airport', cityEn: 'Fuyun', lat: 46.82, lng: 89.52 },
  { iata: 'RQA', icao: 'ZWRQ', name: '若羌楼兰机场', short: '楼兰', city: '若羌', province: '新疆', nameEn: 'Ruoqiang Loulan Airport', cityEn: 'Ruoqiang', lat: 39.04, lng: 88.17 },
  { iata: 'IQM', icao: 'ZWCQ', name: '且末玉都机场', short: '玉都', city: '且末', province: '新疆', nameEn: 'Qiemo Yudu Airport', cityEn: 'Qiemo', lat: 38.15, lng: 85.53 },
  { iata: 'YIN', icao: 'ZWYC', name: '银川河东国际机场', short: '河东', city: '银川', province: '宁夏', nameEn: 'Yinchuan Hedong International Airport', cityEn: 'Yinchuan', lat: 38.33, lng: 106.39 },
  { iata: 'ZHY', icao: 'ZLZW', name: '中卫沙坡头机场', short: '沙坡头', city: '中卫', province: '宁夏', nameEn: 'Zhongwei Shapotou Airport', cityEn: 'Zhongwei', lat: 37.57, lng: 105.14 },
  { iata: 'ZQZ', icao: 'ZBCZ', name: '张家口宁远机场', short: '宁远', city: '张家口', province: '河北', nameEn: 'Zhangjiakou Ningyuan Airport', cityEn: 'Zhangjiakou', lat: 40.74, lng: 114.93 },

  // 港澳台
  { iata: 'HKG', icao: 'VHHH', name: '香港国际机场', short: '赤鱲角', city: '香港', province: '香港', nameEn: 'Hong Kong International Airport', cityEn: 'Hong Kong', lat: 22.31, lng: 113.91 },
  { iata: 'MFM', icao: 'VMMC', name: '澳门国际机场', short: '澳门', city: '澳门', province: '澳门', nameEn: 'Macau International Airport', cityEn: 'Macau', lat: 22.15, lng: 113.59 },
  { iata: 'TPE', icao: 'RCTP', name: '台北桃园国际机场', short: '桃园', city: '桃园', province: '台湾', nameEn: 'Taiwan Taoyuan International Airport', cityEn: 'Taoyuan', lat: 25.08, lng: 121.23 },
  { iata: 'TSA', icao: 'RCSS', name: '台北松山机场', short: '松山', city: '台北', province: '台湾', nameEn: 'Taipei Songshan Airport', cityEn: 'Taipei', lat: 25.07, lng: 121.55 },
  { iata: 'KHH', icao: 'RCKH', name: '高雄小港国际机场', short: '小港', city: '高雄', province: '台湾', nameEn: 'Kaohsiung International Airport', cityEn: 'Kaohsiung', lat: 22.58, lng: 120.35 },

  // 常用国际枢纽
  { iata: 'BKK', icao: 'VTBS', name: '曼谷素万那普机场', short: '素万那普', city: '曼谷', nameEn: 'Suvarnabhumi Airport', cityEn: 'Bangkok', lat: 13.69, lng: 100.75 },
  { iata: 'SIN', icao: 'WSSS', name: '新加坡樟宜机场', short: '樟宜', city: '新加坡', nameEn: 'Singapore Changi Airport', cityEn: 'Singapore', lat: 1.36, lng: 103.99 },
  { iata: 'NRT', icao: 'RJAA', name: '东京成田国际机场', short: '成田', city: '东京', nameEn: 'Narita International Airport', cityEn: 'Tokyo', lat: 35.77, lng: 140.39 },
  { iata: 'HND', icao: 'RJTT', name: '东京羽田国际机场', short: '羽田', city: '东京', nameEn: 'Tokyo Haneda International Airport', cityEn: 'Tokyo', lat: 35.55, lng: 139.78 },
  { iata: 'ICN', icao: 'RKSI', name: '首尔仁川国际机场', short: '仁川', city: '首尔', nameEn: 'Incheon International Airport', cityEn: 'Seoul', lat: 37.46, lng: 126.44 },
  { iata: 'KUL', icao: 'WMKK', name: '吉隆坡国际机场', short: '吉隆坡', city: '吉隆坡', nameEn: 'Kuala Lumpur International Airport', cityEn: 'Kuala Lumpur', lat: 2.75, lng: 101.71 },
  { iata: 'DPS', icao: 'WADD', name: '巴厘岛登巴萨机场', short: '登巴萨', city: '巴厘岛', nameEn: 'I Gusti Ngurah Rai International Airport', cityEn: 'Bali', lat: 8.75, lng: 115.17 },
  { iata: 'DXB', icao: 'OMDB', name: '迪拜国际机场', short: '迪拜', city: '迪拜', nameEn: 'Dubai International Airport', cityEn: 'Dubai', lat: 25.25, lng: 55.36 },
  { iata: 'LHR', icao: 'EGLL', name: '伦敦希思罗机场', short: '希思罗', city: '伦敦', nameEn: 'London Heathrow Airport', cityEn: 'London', lat: 51.47, lng: -0.45 },
  { iata: 'CDG', icao: 'LFPG', name: '巴黎戴高乐机场', short: '戴高乐', city: '巴黎', nameEn: 'Paris Charles de Gaulle Airport', cityEn: 'Paris', lat: 49.01, lng: 2.55 },
  { iata: 'JFK', icao: 'KJFK', name: '纽约约翰·肯尼迪机场', short: '肯尼迪', city: '纽约', nameEn: 'John F. Kennedy International Airport', cityEn: 'New York', lat: 40.64, lng: -73.78 },
  { iata: 'LAX', icao: 'KLAX', name: '洛杉矶国际机场', short: '洛杉矶', city: '洛杉矶', nameEn: 'Los Angeles International Airport', cityEn: 'Los Angeles', lat: 33.94, lng: -118.41 },
  { iata: 'SYD', icao: 'YSSY', name: '悉尼金斯福德·史密斯机场', short: '悉尼', city: '悉尼', nameEn: 'Sydney Kingsford Smith Airport', cityEn: 'Sydney', lat: -33.95, lng: 151.18 },
  { iata: 'IST', icao: 'LTFM', name: '伊斯坦布尔机场', short: '伊斯坦布尔', city: '伊斯坦布尔', nameEn: 'Istanbul Airport', cityEn: 'Istanbul', lat: 41.26, lng: 28.74 },
  { iata: 'KTM', icao: 'VNKT', name: '加德满都特里布万机场', short: '特里布万', city: '加德满都', nameEn: 'Kathmandu Tribhuvan Airport', cityEn: 'Kathmandu', lat: 27.70, lng: 85.36 },
];

const AIRPORTS: Record<string, Airport> = Object.fromEntries(
  AIRPORT_LIST.map((a) => [a.iata.toUpperCase(), a]),
);

// ── 航空公司库 ──────────────────────────────────────────────────────────────
const AIRLINE_LIST: Airline[] = [
  // 中国大陆
  { iata: 'CA', icao: 'CCA', name: '中国国际航空', nameEn: 'Air China', short: '国航', alliance: '星空联盟', color: '#E0312A' },
  { iata: 'CZ', icao: 'CSN', name: '中国南方航空', nameEn: 'China Southern Airlines', short: '南方航空', alliance: '天合联盟', color: '#003D79' },
  { iata: 'MU', icao: 'CES', name: '中国东方航空', nameEn: 'China Eastern Airlines', short: '东方航空', alliance: '天合联盟', color: '#00457C' },
  { iata: 'HU', icao: 'CHH', name: '海南航空', nameEn: 'Hainan Airlines', short: '海南航空', color: '#C8102E' },
  { iata: '3U', icao: 'CSC', name: '四川航空', nameEn: 'Sichuan Airlines', short: '四川航空', color: '#E60012' },
  { iata: 'MF', icao: 'CXA', name: '厦门航空', nameEn: 'Xiamen Airlines', short: '厦门航空', alliance: '天合联盟', color: '#0066B3' },
  { iata: 'FM', icao: 'CSH', name: '上海航空', nameEn: 'Shanghai Airlines', short: '上海航空', alliance: '天合联盟', color: '#1A3E72' },
  { iata: 'SC', icao: 'CDG', name: '山东航空', nameEn: 'Shandong Airlines', short: '山东航空', color: '#0B6FA4' },
  { iata: 'ZH', icao: 'CSZ', name: '深圳航空', nameEn: 'Shenzhen Airlines', short: '深圳航空', alliance: '星空联盟', color: '#C8161D' },
  { iata: 'KN', icao: 'CUA', name: '中国联合航空', nameEn: 'China United Airlines', short: '联合航空', color: '#8B1A1A' },
  { iata: 'G5', icao: 'HXA', name: '华夏航空', nameEn: 'China Express Airlines', short: '华夏航空', color: '#E60012' },
  { iata: '9C', icao: 'CQH', name: '春秋航空', nameEn: 'Spring Airlines', short: '春秋航空', color: '#FF7A00' },
  { iata: 'GS', icao: 'GCR', name: '天津航空', nameEn: 'Tianjin Airlines', short: '天津航空', color: '#B41F21' },
  { iata: 'JD', icao: 'CBJ', name: '首都航空', nameEn: 'Capital Airlines', short: '首都航空', color: '#C8102E' },
  { iata: 'PN', icao: 'CHB', name: '西部航空', nameEn: 'West Air', short: '西部航空', color: '#8B0000' },
  { iata: 'EU', icao: 'UEA', name: '成都航空', nameEn: 'Chengdu Airlines', short: '成都航空', color: '#E60012' },
  { iata: 'GJ', icao: 'CDC', name: '浙江长龙航空', nameEn: 'Loong Air', short: '长龙航空', color: '#1B5E9E' },
  { iata: 'HO', icao: 'DKH', name: '吉祥航空', nameEn: 'Juneyao Air', short: '吉祥航空', color: '#B41F21' },
  { iata: 'Y8', icao: 'YZF', name: '金鹏航空', nameEn: 'Suparna Airlines', short: '金鹏航空', color: '#C8102E' },
  { iata: 'JR', icao: 'JOY', name: '幸福航空', nameEn: 'Joy Air', short: '幸福航空', color: '#C8102E' },
  { iata: 'GX', icao: 'CBG', name: '广西北部湾航空', nameEn: 'GX Airlines', short: '北部湾航空', color: '#C8102E' },
  { iata: '8L', icao: 'LKE', name: '祥鹏航空', nameEn: 'Lucky Air', short: '祥鹏航空', color: '#C8102E' },
  { iata: 'RY', icao: 'CJX', name: '江西航空', nameEn: 'Jiangxi Air', short: '江西航空', color: '#0B3D91' },
  { iata: 'NS', icao: 'HBH', name: '河北航空', nameEn: 'Hebei Airlines', short: '河北航空', color: '#B41F21' },
  { iata: 'QW', icao: 'QDA', name: '青岛航空', nameEn: 'Qingdao Airlines', short: '青岛航空', color: '#0B5FA5' },
  { iata: 'A6', icao: 'HUD', name: '湖南航空', nameEn: 'Air Travel', short: '湖南航空', color: '#C8102E' },
  { iata: 'UQ', icao: 'CUH', name: '乌鲁木齐航空', nameEn: 'Urumqi Air', short: '乌鲁木齐航空', color: '#7A1F1F' },
  { iata: 'KY', icao: 'KNA', name: '昆明航空', nameEn: 'Kunming Airlines', short: '昆明航空', color: '#C8102E' },
  { iata: 'OQ', icao: 'CQN', name: '重庆航空', nameEn: 'Chongqing Airlines', short: '重庆航空', color: '#C8102E' },
  { iata: 'GT', icao: 'CGH', name: '桂林航空', nameEn: 'Air Guilin', short: '桂林航空', color: '#B41F21' },
  { iata: 'DR', icao: 'RLH', name: '瑞丽航空', nameEn: 'Ruili Airlines', short: '瑞丽航空', color: '#8B0000' },
  { iata: '9H', icao: 'CGN', name: '长安航空', nameEn: 'Air Changan', short: '长安航空', color: '#B41F21' },
  // 港澳台
  { iata: 'CX', icao: 'CPA', name: '国泰航空', nameEn: 'Cathay Pacific', short: '国泰航空', alliance: '寰宇一家', color: '#00633F' },
  { iata: 'BR', icao: 'EVA', name: '长荣航空', nameEn: 'EVA Air', short: '长荣航空', alliance: '星空联盟', color: '#006B3F' },
  { iata: 'CI', icao: 'CAL', name: '中华航空', nameEn: 'China Airlines', short: '中华航空', alliance: '天合联盟', color: '#003D79' },
  { iata: 'NX', icao: 'AMU', name: '澳门航空', nameEn: 'Air Macau', short: '澳门航空', color: '#C8102E' },
  // 国际常用
  { iata: 'AA', icao: 'AAL', name: '美国航空', nameEn: 'American Airlines', short: '美航', alliance: '寰宇一家', color: '#C8102E' },
  { iata: 'UA', icao: 'UAL', name: '美国联合航空', nameEn: 'United Airlines', short: '美联航', alliance: '星空联盟', color: '#0033A0' },
  { iata: 'DL', icao: 'DAL', name: '达美航空', nameEn: 'Delta Air Lines', short: '达美航空', alliance: '天合联盟', color: '#9B1B30' },
  { iata: 'BA', icao: 'BAW', name: '英国航空', nameEn: 'British Airways', short: '英航', alliance: '寰宇一家', color: '#002F6C' },
  { iata: 'AF', icao: 'AFR', name: '法国航空', nameEn: 'Air France', short: '法航', alliance: '天合联盟', color: '#002147' },
  { iata: 'LH', icao: 'DLH', name: '汉莎航空', nameEn: 'Lufthansa', short: '汉莎航空', alliance: '星空联盟', color: '#001E4F' },
  { iata: 'EK', icao: 'UAE', name: '阿联酋航空', nameEn: 'Emirates', short: '阿联酋航空', color: '#D71920' },
  { iata: 'SQ', icao: 'SIA', name: '新加坡航空', nameEn: 'Singapore Airlines', short: '新航', alliance: '星空联盟', color: '#F99F1C' },
  { iata: 'JL', icao: 'JAL', name: '日本航空', nameEn: 'Japan Airlines', short: '日航', alliance: '寰宇一家', color: '#AA0033' },
  { iata: 'NH', icao: 'ANA', name: '全日空', nameEn: 'All Nippon Airways', short: '全日空', alliance: '星空联盟', color: '#002F6C' },
  { iata: 'KE', icao: 'KAL', name: '大韩航空', nameEn: 'Korean Air', short: '大韩航空', alliance: '天合联盟', color: '#003478' },
  { iata: 'OZ', icao: 'AAR', name: '韩亚航空', nameEn: 'Asiana Airlines', short: '韩亚航空', alliance: '星空联盟', color: '#8B002A' },
  { iata: 'QF', icao: 'QFA', name: '澳洲航空', nameEn: 'Qantas', short: '澳航', alliance: '寰宇一家', color: '#E4002B' },
  { iata: 'QR', icao: 'QTR', name: '卡塔尔航空', nameEn: 'Qatar Airways', short: '卡塔尔航空', alliance: '寰宇一家', color: '#5C0632' },
  { iata: 'TK', icao: 'THY', name: '土耳其航空', nameEn: 'Turkish Airlines', short: '土耳其航空', alliance: '星空联盟', color: '#C8102E' },
  { iata: 'TG', icao: 'THA', name: '泰国航空', nameEn: 'Thai Airways International', short: '泰航', alliance: '星空联盟', color: '#9B1B30' },
  { iata: 'VN', icao: 'HVN', name: '越南航空', nameEn: 'Vietnam Airlines', short: '越南航空', alliance: '天合联盟', color: '#003D79' },
  { iata: 'GA', icao: 'GIA', name: '嘉鲁达印尼航空', nameEn: 'Garuda Indonesia', short: '印尼鹰航', alliance: '天合联盟', color: '#005BAC' },
  { iata: 'MH', icao: 'MAS', name: '马来西亚航空', nameEn: 'Malaysia Airlines', short: '马航', alliance: '寰宇一家', color: '#C8102E' },
  { iata: 'ET', icao: 'ETH', name: '埃塞俄比亚航空', nameEn: 'Ethiopian Airlines', short: '埃塞航空', alliance: '星空联盟', color: '#007A3D' },
  { iata: 'AC', icao: 'ACA', name: '加拿大航空', nameEn: 'Air Canada', short: '加航', alliance: '星空联盟', color: '#D71920' },
  { iata: 'NZ', icao: 'ANZ', name: '新西兰航空', nameEn: 'Air New Zealand', short: '新西兰航空', alliance: '星空联盟', color: '#000000' },
];

const AIRLINES: Record<string, Airline> = Object.fromEntries(
  AIRLINE_LIST.map((a) => [a.iata.toUpperCase(), a]),
);

// ── 查询函数 ────────────────────────────────────────────────────────────────
export function getAirport(iata: string | undefined | null): Airport | undefined {
  if (!iata) return undefined;
  return AIRPORTS[iata.trim().toUpperCase()];
}

export function getAirline(iata: string | undefined | null): Airline | undefined {
  if (!iata) return undefined;
  return AIRLINES[iata.trim().toUpperCase()];
}

/** 解析航班号，如 CZ3467 → { airlineIata: 'CZ', number: '3467' } */
export function parseFlightIata(code: string): { airlineIata: string; number: string } | null {
  const m = /^([A-Z0-9]{2})\s*0*(\d{1,4}[A-Z]?)$/i.exec(code.trim().toUpperCase());
  if (!m) return null;
  return { airlineIata: m[1]!.toUpperCase(), number: m[2]! };
}

/** 机场本地检索（城市/简称/全名/IATA），用于无 API 时的机场选择 */
export function searchAirports(query: string, limit = 30): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) return AIRPORT_LIST.slice(0, limit);
  const scored: Array<[number, Airport]> = [];
  for (const a of AIRPORT_LIST) {
    let score = -1;
    if (a.iata.toLowerCase() === q) score = 100;
    else if (a.city.includes(query.trim()) || a.short.includes(query.trim())) score = 80;
    else if (a.name.includes(query.trim())) score = 60;
    else if (a.cityEn.toLowerCase().includes(q) || a.nameEn.toLowerCase().includes(q)) score = 40;
    if (score >= 0) scored.push([score, a]);
  }
  return scored.sort((x, y) => y[0] - x[0]).slice(0, limit).map(([, a]) => a);
}

// ── 航程推导 ────────────────────────────────────────────────────────────────
/** 按航段距离估算典型巡航高度（米） */
export function cruiseAltitudeM(distanceKm: number): number {
  if (distanceKm < 800) return 8600;
  if (distanceKm < 1800) return 9800;
  if (distanceKm < 3500) return 10700;
  return 11300;
}

/** 按航段距离估算飞行时长（分钟，含起降滑行约 25 分钟） */
export function flightDurationMinEst(distanceKm: number): number {
  if (distanceKm <= 0) return 0;
  return Math.round((distanceKm / 820) * 60 + 25);
}

/** 巡航高度友好文案，如 10,700 m → FL351 */
export function flightLevelText(altitudeM: number): string {
  return `FL${Math.round(altitudeM / 30.48 / 10) * 10}`;
}

// ── 航班查询结果（后端 /flights/lookup 返回） ───────────────────────────────
export interface FlightEndpointInfo {
  iata: string;
  icao?: string;
  terminal?: string;
  gate?: string;
  /** 计划当地时间 HH:MM */
  scheduled?: string;
  /** 实际当地时间 HH:MM */
  actual?: string;
}

export interface FlightLookup {
  /** 数据来源：airlabs=在线实时/历史；local=本地（仅航司/机场等确定信息） */
  source: 'airlabs' | 'local';
  flightNumber: string;
  airlineIata?: string;
  date: string;
  dep?: FlightEndpointInfo;
  arr?: FlightEndpointInfo;
  durationMin?: number;
  distanceKm?: number;
  cruiseAltitudeM?: number;
  status?: string;
  /** 给用户的说明（尤其本地模式为何缺时刻） */
  note?: string;
}
