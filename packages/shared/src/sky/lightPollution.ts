/**
 * 光污染估算（旅途天象算法 · 观星层）
 *
 * 公开光污染栅格（VIIRS DNB / World Atlas）均需离线大数据文件，且无免费在线点查 API。
 * 这里用「城市夜间灯光影响场」启发式：对沿途坐标叠加各城市指数衰减贡献，
 * 映射到 Bortle 1~9 暗空等级，供观星指数与 UI 展示（标注为估算值）。
 *
 * 模型：score = Σ w_i · exp(-d_i / (12 + 34·w_i))，w 为城市规模权重（0.35~1.5）。
 */

export interface LightPollutionEstimate {
  /** Bortle 暗空等级 1（极暗）~ 9（市中心） */
  bortle: number;
  /** 天空亮度 SQM 估算（mag/arcsec²，越大越暗） */
  sqmMag: number;
  /** 中文标签 */
  label: string;
  /** 是否适合观星 */
  goodForStars: boolean;
  /** 最近的主要光源城市（调试/说明用） */
  nearestCity?: string;
}

interface CityLight {
  name: string;
  lng: number;
  lat: number;
  w: number;
}

/** 主要城市夜间灯光源（覆盖全国铁路走廊，w=规模权重） */
const CITIES: CityLight[] = [
  { name: '北京', lng: 116.41, lat: 39.9, w: 1.5 },
  { name: '天津', lng: 117.2, lat: 39.13, w: 1.2 },
  { name: '上海', lng: 121.47, lat: 31.23, w: 1.5 },
  { name: '广州', lng: 113.26, lat: 23.13, w: 1.35 },
  { name: '深圳', lng: 114.06, lat: 22.55, w: 1.3 },
  { name: '东莞', lng: 113.75, lat: 23.02, w: 1.1 },
  { name: '佛山', lng: 113.12, lat: 23.02, w: 1.1 },
  { name: '南京', lng: 118.8, lat: 32.06, w: 1.15 },
  { name: '苏州', lng: 120.62, lat: 31.3, w: 1.15 },
  { name: '无锡', lng: 120.3, lat: 31.57, w: 1.0 },
  { name: '常州', lng: 119.97, lat: 31.81, w: 0.9 },
  { name: '南通', lng: 120.89, lat: 32.02, w: 0.9 },
  { name: '徐州', lng: 117.28, lat: 34.26, w: 1.0 },
  { name: '连云港', lng: 119.22, lat: 34.6, w: 0.75 },
  { name: '杭州', lng: 120.15, lat: 30.28, w: 1.2 },
  { name: '宁波', lng: 121.55, lat: 29.87, w: 1.05 },
  { name: '温州', lng: 120.7, lat: 27.99, w: 0.95 },
  { name: '嘉兴', lng: 120.75, lat: 30.75, w: 0.85 },
  { name: '绍兴', lng: 120.58, lat: 29.99, w: 0.85 },
  { name: '金华', lng: 119.65, lat: 29.08, w: 0.8 },
  { name: '合肥', lng: 117.23, lat: 31.82, w: 1.05 },
  { name: '芜湖', lng: 118.43, lat: 31.35, w: 0.8 },
  { name: '蚌埠', lng: 117.39, lat: 32.92, w: 0.75 },
  { name: '安庆', lng: 117.06, lat: 30.51, w: 0.7 },
  { name: '阜阳', lng: 115.81, lat: 32.89, w: 0.7 },
  { name: '福州', lng: 119.3, lat: 26.08, w: 1.05 },
  { name: '厦门', lng: 118.09, lat: 24.48, w: 1.0 },
  { name: '泉州', lng: 118.68, lat: 24.87, w: 0.9 },
  { name: '南昌', lng: 115.86, lat: 28.68, w: 1.0 },
  { name: '九江', lng: 116.0, lat: 29.71, w: 0.75 },
  { name: '赣州', lng: 114.94, lat: 25.83, w: 0.75 },
  { name: '济南', lng: 117.12, lat: 36.65, w: 1.1 },
  { name: '青岛', lng: 120.38, lat: 36.07, w: 1.1 },
  { name: '烟台', lng: 121.45, lat: 37.46, w: 0.85 },
  { name: '潍坊', lng: 119.16, lat: 36.71, w: 0.85 },
  { name: '临沂', lng: 118.35, lat: 35.05, w: 0.8 },
  { name: '郑州', lng: 113.63, lat: 34.75, w: 1.1 },
  { name: '洛阳', lng: 112.45, lat: 34.62, w: 0.9 },
  { name: '开封', lng: 114.31, lat: 34.8, w: 0.75 },
  { name: '武汉', lng: 114.31, lat: 30.59, w: 1.25 },
  { name: '宜昌', lng: 111.29, lat: 30.69, w: 0.8 },
  { name: '襄阳', lng: 112.12, lat: 32.01, w: 0.8 },
  { name: '长沙', lng: 112.94, lat: 28.23, w: 1.1 },
  { name: '株洲', lng: 113.13, lat: 27.83, w: 0.75 },
  { name: '衡阳', lng: 112.57, lat: 26.89, w: 0.75 },
  { name: '怀化', lng: 110.0, lat: 27.55, w: 0.6 },
  { name: '南宁', lng: 108.37, lat: 22.82, w: 1.0 },
  { name: '桂林', lng: 110.29, lat: 25.27, w: 0.8 },
  { name: '柳州', lng: 109.42, lat: 24.31, w: 0.75 },
  { name: '北海', lng: 109.12, lat: 21.48, w: 0.65 },
  { name: '湛江', lng: 110.36, lat: 21.27, w: 0.75 },
  { name: '海口', lng: 110.2, lat: 20.04, w: 0.85 },
  { name: '三亚', lng: 109.51, lat: 18.25, w: 0.7 },
  { name: '中国香港', lng: 114.17, lat: 22.32, w: 1.35 },
  { name: '中国澳门', lng: 113.55, lat: 22.2, w: 1.0 },
  { name: '台北', lng: 121.52, lat: 25.03, w: 1.15 },
  { name: '高雄', lng: 120.3, lat: 22.62, w: 1.0 },
  { name: '台中', lng: 120.68, lat: 24.14, w: 0.95 },
  { name: '重庆', lng: 106.55, lat: 29.56, w: 1.3 },
  { name: '成都', lng: 104.07, lat: 30.67, w: 1.25 },
  { name: '绵阳', lng: 104.74, lat: 31.46, w: 0.8 },
  { name: '乐山', lng: 103.77, lat: 29.55, w: 0.7 },
  { name: '宜宾', lng: 104.63, lat: 28.77, w: 0.7 },
  { name: '西昌', lng: 102.26, lat: 27.89, w: 0.6 },
  { name: '攀枝花', lng: 101.72, lat: 26.58, w: 0.65 },
  { name: '贵阳', lng: 106.63, lat: 26.65, w: 1.0 },
  { name: '遵义', lng: 106.93, lat: 27.73, w: 0.7 },
  { name: '昆明', lng: 102.83, lat: 24.88, w: 1.1 },
  { name: '曲靖', lng: 103.8, lat: 25.49, w: 0.7 },
  { name: '大理', lng: 100.23, lat: 25.59, w: 0.65 },
  { name: '丽江', lng: 100.23, lat: 26.86, w: 0.6 },
  { name: '拉萨', lng: 91.14, lat: 29.65, w: 0.8 },
  { name: '日喀则', lng: 88.88, lat: 29.27, w: 0.5 },
  { name: '林芝', lng: 94.36, lat: 29.65, w: 0.45 },
  { name: '那曲', lng: 92.05, lat: 31.48, w: 0.4 },
  { name: '格尔木', lng: 94.9, lat: 36.4, w: 0.5 },
  { name: '西宁', lng: 101.78, lat: 36.62, w: 0.9 },
  { name: '德令哈', lng: 97.37, lat: 37.37, w: 0.4 },
  { name: '兰州', lng: 103.83, lat: 36.06, w: 1.05 },
  { name: '天水', lng: 105.72, lat: 34.58, w: 0.65 },
  { name: '嘉峪关', lng: 98.29, lat: 39.77, w: 0.55 },
  { name: '敦煌', lng: 94.68, lat: 40.14, w: 0.45 },
  { name: '西安', lng: 108.94, lat: 34.34, w: 1.2 },
  { name: '咸阳', lng: 108.71, lat: 34.33, w: 0.8 },
  { name: '宝鸡', lng: 107.24, lat: 34.36, w: 0.7 },
  { name: '银川', lng: 106.23, lat: 38.49, w: 0.85 },
  { name: '乌鲁木齐', lng: 87.62, lat: 43.82, w: 1.1 },
  { name: '吐鲁番', lng: 89.19, lat: 42.95, w: 0.5 },
  { name: '哈密', lng: 93.51, lat: 42.82, w: 0.5 },
  { name: '库尔勒', lng: 86.15, lat: 41.76, w: 0.6 },
  { name: '阿克苏', lng: 80.26, lat: 41.17, w: 0.55 },
  { name: '喀什', lng: 75.99, lat: 39.47, w: 0.6 },
  { name: '伊宁', lng: 81.28, lat: 43.9, w: 0.55 },
  { name: '呼和浩特', lng: 111.75, lat: 40.84, w: 0.95 },
  { name: '包头', lng: 109.84, lat: 40.66, w: 0.85 },
  { name: '鄂尔多斯', lng: 109.78, lat: 39.6, w: 0.7 },
  { name: '太原', lng: 112.55, lat: 37.87, w: 1.05 },
  { name: '大同', lng: 113.3, lat: 40.08, w: 0.7 },
  { name: '沈阳', lng: 123.43, lat: 41.8, w: 1.1 },
  { name: '大连', lng: 121.62, lat: 38.91, w: 1.0 },
  { name: '长春', lng: 125.32, lat: 43.82, w: 1.0 },
  { name: '吉林', lng: 126.55, lat: 43.84, w: 0.75 },
  { name: '哈尔滨', lng: 126.63, lat: 45.76, w: 1.1 },
  { name: '齐齐哈尔', lng: 123.92, lat: 47.35, w: 0.7 },
  { name: '大庆', lng: 125.1, lat: 46.59, w: 0.75 },
  { name: '海拉尔', lng: 119.77, lat: 49.21, w: 0.5 },
  { name: '石家庄', lng: 114.51, lat: 38.04, w: 1.05 },
  { name: '唐山', lng: 118.18, lat: 39.63, w: 0.85 },
  { name: '保定', lng: 115.46, lat: 38.87, w: 0.8 },
  { name: '邯郸', lng: 114.49, lat: 36.61, w: 0.75 },
  { name: '张家口', lng: 114.88, lat: 40.82, w: 0.65 },
  { name: '承德', lng: 117.94, lat: 40.95, w: 0.6 },
];

function rad(d: number): number {
  return (d * Math.PI) / 180;
}

function haversineKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(h));
}

const BORTLE_LABELS: Record<number, string> = {
  1: '极暗·银河清晰',
  2: '很暗·郊野星空',
  3: '暗·乡村夜空',
  4: '较暗·城乡过渡',
  5: '中等·郊区夜空',
  6: '较亮·城市边缘',
  7: '亮·城区夜空',
  8: '很亮·城市中心',
  9: '极亮·闹市天穹',
};

/** Bortle → SQM 天空亮度近似（mag/arcsec²） */
const BORTLE_SQM: Record<number, number> = {
  1: 21.8,
  2: 21.6,
  3: 21.4,
  4: 20.8,
  5: 19.8,
  6: 18.7,
  7: 18.2,
  8: 17.5,
  9: 16.5,
};

/**
 * 估算坐标处光污染（城市灯光影响场模型）。
 * 注：这是启发式估算，非 VIIRS 实测；量级与相对比较可信，绝对值仅供参考。
 */
export function estimateLightPollution(lng: number, lat: number): LightPollutionEstimate {
  let score = 0;
  let bestW = -1;
  let nearestCity: string | undefined;
  for (const c of CITIES) {
    const d = haversineKm(lng, lat, c.lng, c.lat);
    const radius = 12 + 34 * c.w;
    score += c.w * Math.exp(-d / radius);
    if (c.w > bestW && d < 60) {
      bestW = c.w;
      nearestCity = c.name;
    }
  }
  let bortle: number;
  if (score >= 3.2) bortle = 9;
  else if (score >= 2.2) bortle = 8;
  else if (score >= 1.4) bortle = 7;
  else if (score >= 0.85) bortle = 6;
  else if (score >= 0.45) bortle = 5;
  else if (score >= 0.22) bortle = 4;
  else if (score >= 0.09) bortle = 3;
  else if (score >= 0.03) bortle = 2;
  else bortle = 1;

  return {
    bortle,
    sqmMag: BORTLE_SQM[bortle]!,
    label: BORTLE_LABELS[bortle]!,
    goodForStars: bortle <= 4,
    nearestCity,
  };
}
