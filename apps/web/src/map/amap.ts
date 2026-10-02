/**
 * 高德地图 JS API 2.0 加载器（apps/web/src/map/amap.ts）。
 *
 * - 幂等：window.AMap 已存在则直接复用，不重复插 script；
 * - 超时保护：script 被网络环境静默拦截（代理 / 广告拦截插件 / 企业网关）时，
 *   onload/onerror 都不会触发，Promise 会永远 pending —— 页面表现为
 *   "可选要素一直不加载、页面停在不完整状态"。这里加 12s 硬超时，到点 reject，
 *   让上层进入带重试按钮的错误态，而不是无限等待。
 */
export function loadAmap(key: string, security?: string): Promise<typeof window.AMap> {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (security) {
    window._AMapSecurityConfig = { securityJsCode: security };
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      script.remove();
      reject(new Error('高德地图脚本加载超时（12s），请检查网络或代理设置'));
    }, 12_000);
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    script.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(window.AMap);
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(new Error('高德地图脚本加载失败'));
    };
    document.head.appendChild(script);
  });
}
