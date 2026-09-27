<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';

const status = ref<'loading' | 'up' | 'down'>('loading');
const commit = ref('');
const corridorCount = ref(0);

onMounted(async () => {
  try {
    const health = await api.getHealth();
    if (health.status === 'up' && health.version) {
      status.value = 'up';
      commit.value = health.version.commit;
      corridorCount.value = health.version.corridorCount;
    } else {
      status.value = 'down';
    }
  } catch {
    status.value = 'down';
  }
});
</script>

<template>
  <div class="api-version-badge">
    <span v-if="status === 'loading'" class="badge loading">检测 API 版本…</span>
    <span v-else-if="status === 'up'" class="badge ok">
      API 版本: {{ commit }} 走廊数: {{ corridorCount }}
    </span>
    <span v-else class="badge down">API 不可达（可能是旧实例）</span>
  </div>
</template>

<style scoped>
.api-version-badge {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  line-height: 1;
  user-select: none;
}
.badge {
  padding: 4px 8px;
  border-radius: 4px;
  white-space: nowrap;
}
.badge.loading {
  color: var(--text-muted);
  background: var(--text-primary);
}
.badge.ok {
  color: var(--success);
  background: var(--success-container);
}
.badge.down {
  color: var(--danger);
  background: var(--danger-container);
}
</style>