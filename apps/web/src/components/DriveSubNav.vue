<script setup lang="ts">
/**
 * 万里路书次级导航（PRD §2.2）：承载主/从分界，不是顶栏。
 *
 *   [ 找路线 ]  [ 榜单 ▾ ]  [ 路书 ▾ ]
 *      主         从属        从属
 *
 * 从属项视觉权重低于主项（榜单/路书为描边胶囊，主项为实底）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client';
import type { DriveRouteLite } from '@railvista/shared';

const route = useRoute();
const bookOpen = ref(false);
const books = ref<DriveRouteLite[]>([]);
const rootEl = ref<HTMLElement | null>(null);

function isActive(path: string): boolean {
  if (path === '/drive') return route.path === '/drive';
  return route.path.startsWith(path);
}

async function loadBooks() {
  if (books.value.length) return;
  try {
    const data = await api.getDriveRoutes();
    books.value = data.routes;
  } catch {
    /* 路书列表加载失败时菜单显示空态 */
  }
}

function toggleBook() {
  bookOpen.value = !bookOpen.value;
  if (bookOpen.value) void loadBooks();
}

function onDocClick(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) bookOpen.value = false;
}

onMounted(() => document.addEventListener('click', onDocClick, { passive: true }));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <nav ref="rootEl" class="drive-subnav" aria-label="自驾模块导航">
    <router-link class="drive-subnav__main" to="/drive" :class="{ 'is-active': isActive('/drive') }">
      找路线
    </router-link>
    <router-link
      class="drive-subnav__sub"
      to="/drive/rankings"
      :class="{ 'is-active': isActive('/drive/rankings') }"
    >
      榜单 <span class="drive-subnav__caret">▾</span>
    </router-link>
    <div class="drive-subnav__wrap">
      <button type="button" class="drive-subnav__sub" :class="{ 'is-active': route.path.startsWith('/drive/roadbook') }" @click="toggleBook">
        路书 <span class="drive-subnav__caret">▾</span>
      </button>
      <Transition name="drive-subnav-menu">
        <div v-if="bookOpen" class="drive-subnav__menu" role="menu">
          <p class="drive-subnav__menu-title">精品线路书（v1 打样）</p>
          <router-link
            v-for="b in books"
            :key="b.id"
            class="drive-subnav__menu-item"
            role="menuitem"
            :to="`/drive/roadbook/${b.id}`"
            @click="bookOpen = false"
          >
            {{ b.name }}
            <span class="drive-subnav__menu-meta">{{ b.totalKm }} km</span>
          </router-link>
          <p v-if="!books.length" class="drive-subnav__menu-item is-empty">暂无成书线路</p>
        </div>
      </Transition>
    </div>
  </nav>
</template>
