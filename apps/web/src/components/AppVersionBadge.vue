<script setup lang="ts">
/**
 * 首页版本号展示。
 * 版本号直接读取 @railvista/shared 的 APP_VERSION（packages/shared/src/version.ts），
 * 与仓库根目录 CHANGELOG.md 的最新条目保持一致，不依赖网络请求。
 */
import { appVersionInfo, APP_VERSION } from '@railvista/shared';

const info = appVersionInfo();
</script>

<template>
  <div class="app-version-badge" :title="`${info.summary}（${info.date}）`">
    <span class="app-version-badge__label">版本</span>
    <span class="app-version-badge__num">v{{ APP_VERSION }}</span>
    <span class="app-version-badge__date">{{ info.date }}</span>
  </div>
</template>

<style scoped>
.app-version-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: var(--border-hairline);
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1;
  white-space: nowrap;
  cursor: default;
}

.app-version-badge__label {
  letter-spacing: 0.08em;
  font-weight: 600;
  opacity: 0.75;
}

.app-version-badge__num {
  font-weight: 700;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.app-version-badge__date {
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}
</style>
