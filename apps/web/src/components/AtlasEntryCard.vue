<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function goAtlas() {
  void router.push('/atlas');
}
</script>

<template>
  <button type="button" class="atlas-entry rv-card" data-spotlight @click="goAtlas">
    <span class="atlas-entry__main">
      <span class="atlas-entry__title">全国铁路景点地图</span>
      <span class="atlas-entry__desc">一眼看遍中国铁路沿线的风景</span>
    </span>
    <span class="atlas-entry__go" aria-hidden="true">进入 ›</span>
  </button>
</template>

<style scoped>
.atlas-entry {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--line-accent);
  background: linear-gradient(
    135deg,
    rgba(77, 159, 255, 0.22),
    rgba(77, 159, 255, 0.07) 52%,
    rgba(157, 140, 240, 0.14)
  );
  color: var(--accent-hover);
  font-family: inherit;
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-spring),
    border-color var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-base) var(--ease-standard);
}

.atlas-entry::before {
  content: '';
  position: absolute;
  right: -26px;
  top: -30px;
  width: 104px;
  height: 104px;
  border-radius: var(--radius-full);
  border: 1px solid rgba(77, 159, 255, 0.28);
  box-shadow:
    0 0 0 18px rgba(77, 159, 255, 0.07),
    0 0 0 36px rgba(77, 159, 255, 0.04);
  pointer-events: none;
}

.atlas-entry::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(
    calc(var(--glow-radius) * 0.55) circle at var(--mx, 50%) var(--my, 0%),
    rgba(255, 255, 255, var(--glow-alpha-tile)),
    transparent 65%
  );
  transition: opacity var(--dur-base) var(--ease-standard);
}

@media (hover: hover) and (pointer: fine) {
  .atlas-entry:hover {
    transform: translateY(-2px);
    border-color: var(--accent);
    box-shadow: 0 12px 32px -12px rgba(77, 159, 255, 0.35);
  }

  .atlas-entry:hover::after {
    opacity: 1;
  }

  .atlas-entry:hover .atlas-entry__go {
    transform: translateX(3px);
  }
}

.atlas-entry__main {
  display: grid;
  gap: var(--space-1);
  text-align: left;
}

.atlas-entry__title {
  font-size: var(--fs-h3);
  font-weight: 700;
  color: var(--text-1);
}

.atlas-entry__desc {
  font-size: var(--fs-cap);
  color: var(--text-2);
}

.atlas-entry__go {
  flex-shrink: 0;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  border: 1px solid var(--line-accent);
  background: rgba(77, 159, 255, 0.16);
  font-size: var(--fs-cap);
  font-weight: 600;
  color: var(--accent-hover);
  transition: transform var(--dur-fast) var(--ease-spring);
}

@media (prefers-reduced-motion: reduce) {
  .atlas-entry,
  .atlas-entry__go {
    transition: none;
  }
}
</style>
