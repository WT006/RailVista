/**
 * 高德官方底图样式。
 * - darkblue（极夜蓝）：项目默认，深蓝夜景，与亮蓝铁路线对比清晰
 * - dark（幻影黑）/ grey（雅士灰）：偏炭黑/土灰，Cinematic Ink 曾误用，勿再回退
 * @see https://developer.amap.com/api/javascript-api-v2/guide/map/map-style
 */
export const AMAP_MAP_STYLE = 'amap://styles/grey';

export function loadAmap(key: string, security?: string): Promise<typeof window.AMap> {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (security) {
    window._AMapSecurityConfig = { securityJsCode: security };
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    script.onload = () => resolve(window.AMap);
    script.onerror = () => reject(new Error('高德地图脚本加载失败'));
    document.head.appendChild(script);
  });
}
