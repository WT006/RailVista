/**
 * 34 省级行政区 bbox 配置（按省分片抓取，PRD §3.4 Step 2）。
 *
 * 单条全国查询易超时/限流；按省 bbox 分片（34 次/条）命中率高且可断点续抓。
 * bbox 边界基于民政部行政区划数据，含争议区外扩 0.5° 缓冲。
 * 格式：{ code, name, bbox: [s, w, n, e] }（south, west, north, east）
 */
export const PROVINCE_BBOXES = [
  { code: '11', name: '北京', bbox: [39.4, 115.4, 41.1, 117.5] },
  { code: '12', name: '天津', bbox: [38.5, 116.7, 40.3, 118.0] },
  { code: '31', name: '上海', bbox: [30.4, 120.8, 31.9, 122.2] },
  { code: '50', name: '重庆', bbox: [28.2, 105.3, 32.6, 110.2] },
  { code: '13', name: '河北', bbox: [36.0, 113.4, 42.6, 119.8] },
  { code: '14', name: '山西', bbox: [34.5, 110.2, 40.7, 114.6] },
  { code: '21', name: '辽宁', bbox: [38.7, 118.8, 43.5, 125.8] },
  { code: '22', name: '吉林', bbox: [40.8, 121.6, 46.3, 131.3] },
  { code: '23', name: '黑龙江', bbox: [43.4, 121.1, 53.6, 135.1] },
  { code: '32', name: '江苏', bbox: [30.7, 116.3, 35.2, 121.9] },
  { code: '33', name: '浙江', bbox: [27.1, 118.0, 31.5, 122.9] },
  { code: '34', name: '安徽', bbox: [29.4, 114.9, 34.7, 119.7] },
  { code: '35', name: '福建', bbox: [23.5, 115.8, 28.3, 120.6] },
  { code: '36', name: '江西', bbox: [24.5, 113.9, 30.1, 118.5] },
  { code: '37', name: '山东', bbox: [34.4, 114.3, 38.4, 122.7] },
  { code: '41', name: '河南', bbox: [31.4, 110.3, 36.4, 116.6] },
  { code: '42', name: '湖北', bbox: [29.0, 108.2, 33.3, 116.1] },
  { code: '43', name: '湖南', bbox: [24.6, 108.8, 30.1, 114.3] },
  { code: '44', name: '广东', bbox: [20.2, 109.7, 25.5, 117.2] },
  { code: '46', name: '海南', bbox: [18.1, 108.6, 20.2, 111.0] },
  { code: '51', name: '四川', bbox: [26.0, 97.3, 34.3, 108.5] },
  { code: '52', name: '贵州', bbox: [24.6, 103.6, 29.2, 109.6] },
  { code: '53', name: '云南', bbox: [21.1, 97.5, 29.2, 106.2] },
  { code: '61', name: '陕西', bbox: [31.6, 105.5, 39.6, 111.3] },
  { code: '62', name: '甘肃', bbox: [32.3, 92.5, 42.8, 108.7] },
  { code: '63', name: '青海', bbox: [31.6, 89.4, 38.9, 103.1] },
  { code: '71', name: '内蒙古', bbox: [37.4, 97.2, 53.6, 126.0] },
  { code: '45', name: '广西', bbox: [20.9, 104.5, 26.4, 112.5] },
  { code: '54', name: '西藏', bbox: [26.5, 78.4, 36.5, 99.1] },
  { code: '64', name: '宁夏', bbox: [35.1, 104.3, 39.3, 107.7] },
  { code: '65', name: '新疆', bbox: [34.3, 73.5, 49.2, 96.4] },
  { code: '91', name: '香港', bbox: [22.1, 113.8, 22.6, 114.5] },
  { code: '92', name: '澳门', bbox: [22.1, 113.5, 22.2, 113.6] },
  { code: '71T', name: '台湾', bbox: [21.8, 119.6, 25.6, 122.1] },
];

/**
 * 跨省去重：边界 way 按 way.id 去重，保留首次出现。
 * 分片抓取时同一条 way 可能被相邻两省的 bbox 都覆盖到，合并时需去重。
 */
export function mergeProvincialWays(waysByProvince) {
  const seen = new Set();
  const merged = [];
  let dedupCount = 0;
  for (const ways of waysByProvince) {
    if (!ways) continue;
    for (const way of ways) {
      if (seen.has(way.id)) {
        dedupCount += 1;
        continue;
      }
      seen.add(way.id);
      merged.push(way);
    }
  }
  if (dedupCount > 0) console.log(`  跨省去重 ${dedupCount} ways`);
  return merged;
}