/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** proxy（默认）走 BFF 瓦片缓存；direct 才需要浏览器端 Key */
  readonly VITE_TIANDITU_TILE_MODE?: string;
  readonly VITE_TIANDITU_TK?: string;
  readonly VITE_TIANDITU_REVIEW_NO?: string;
  /** @deprecated Web 运行时已切天地图；离线脚本可能仍读 */
  readonly VITE_AMAP_KEY?: string;
  /** @deprecated */
  readonly VITE_AMAP_SECURITY?: string;
  readonly VITE_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};
