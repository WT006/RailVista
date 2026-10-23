import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // maplibre 自带 worker；被 optimizeDeps 打进 .vite/deps 后路径丢失，
  // GeoJSON 折线/热力会静默失败，地图只剩底图。
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  server: {
    // 本机 Windows 排除了 5170–5269（Hyper-V/NAT），绑 5173 会 EACCES
    port: 5280,
    strictPort: true,
    proxy: {
      '/api': {
        // 与 apps/api 默认 PORT=3010 对齐（3000 在 Windows 排除段内）
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
      },
    },
  },
});
