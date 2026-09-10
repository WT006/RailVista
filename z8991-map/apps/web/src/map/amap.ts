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
