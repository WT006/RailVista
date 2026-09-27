<script setup lang="ts">
defineProps<{
  size?: number;
}>();
</script>

<template>
  <svg
    class="heyworld-logo"
    :width="size || 120"
    :height="size || 120"
    viewBox="0 0 200 200"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <clipPath id="logo-clip">
        <rect x="10" y="10" width="180" height="180" rx="24" />
      </clipPath>
    </defs>

    <g clip-path="url(#logo-clip)">
      <rect x="10" y="10" width="180" height="180" rx="24" fill="#0a0a0a" />

      <g transform="rotate(16 100 100)">
        <text
          x="100"
          y="82"
          text-anchor="middle"
          fill="white"
          font-family="'Helvetica Neue', Arial, sans-serif"
          font-size="52"
          font-weight="900"
          font-style="italic"
          letter-spacing="-1"
        >Hey</text>

        <polygon points="132,58 148,72 132,86" fill="white" />
        <polygon points="138,62 150,72 138,82" fill="none" stroke="white" stroke-width="2.5" />

        <text
          x="100"
          y="140"
          text-anchor="middle"
          fill="white"
          font-family="'Helvetica Neue', Arial, sans-serif"
          font-size="48"
          font-weight="900"
          font-style="italic"
          letter-spacing="-1"
        >World</text>
      </g>
    </g>

    <rect
      x="10"
      y="10"
      width="180"
      height="180"
      rx="24"
      fill="none"
      stroke="rgba(255,255,255,0.12)"
      stroke-width="1.5"
    />
  </svg>
</template>

<style scoped>
.heyworld-logo {
  display: block;
  flex-shrink: 0;
}
</style>