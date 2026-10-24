/**
 * 底图瓦片来源：默认走 BFF 反代缓存（Key 留服务端）；
 * `VITE_TIANDITU_TILE_MODE=direct` 时回退浏览器直连（需 VITE_TIANDITU_TK）。
 */
import type { BasemapTileSource } from './tiandituStyle';

function apiBase(): string {
  const raw = (import.meta.env.VITE_API_BASE || '/api').trim() || '/api';
  return raw.replace(/\/$/, '');
}

export function resolveBasemapTileSource(): BasemapTileSource {
  const mode = String(import.meta.env.VITE_TIANDITU_TILE_MODE || 'proxy')
    .trim()
    .toLowerCase();
  if (mode === 'direct') {
    const tk = (import.meta.env.VITE_TIANDITU_TK || '').trim();
    if (!tk) {
      throw new Error('直连模式需配置 VITE_TIANDITU_TK（apps/web/.env）');
    }
    return { mode: 'direct', tk };
  }
  return { mode: 'proxy', baseUrl: `${apiBase()}/map-tiles` };
}

/** 地图页初始化前：代理模式不要求前端 Key；直连模式必须有 Key */
export function basemapConfigError(): string | null {
  try {
    resolveBasemapTileSource();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : '底图配置无效';
  }
}
