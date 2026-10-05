import { createRouter, createWebHistory } from 'vue-router';
import SelectTrip from '../pages/SelectTrip.vue';
import TripMap from '../pages/TripMap.vue';
import RouteDetail from '../pages/RouteDetail.vue';
import CorridorMap from '../pages/CorridorMap.vue';
import AtlasMap from '../pages/AtlasMap.vue';
import DriveHome from '../pages/DriveHome.vue';
import DriveTrip from '../pages/DriveTrip.vue';
import DriveRoad from '../pages/DriveRoad.vue';
import DriveRankings from '../pages/DriveRankings.vue';
import DriveBoard from '../pages/DriveBoard.vue';
import DriveRoadbook from '../pages/DriveRoadbook.vue';
import TicketHome from '../pages/TicketHome.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'select', component: SelectTrip },
    { path: '/trip', name: 'trip', component: TripMap },
    { path: '/route/:corridorId', name: 'route-detail', component: RouteDetail },
    { path: '/route/:corridorId/map', name: 'corridor-map', component: CorridorMap },
    { path: '/atlas', name: 'atlas', component: AtlasMap },
    // ── 万里路书 · 旅行纪念票（顶部菜单第 4 入口） ──────────────────────────
    { path: '/ticket', name: 'ticket', component: TicketHome },
    // ── 万里路书 · 全国公路旅游网（PRD §2.1 路由表） ─────────────────────────
    { path: '/drive', name: 'drive-home', component: DriveHome },
    { path: '/drive/trip', name: 'drive-trip', component: DriveTrip },
    { path: '/drive/road/:code', name: 'drive-road', component: DriveRoad },
    // /drive/atlas 复用全国地图（公路图层与铁路图层共存）
    {
      path: '/drive/atlas',
      name: 'drive-atlas',
      component: AtlasMap,
      props: { drive: true },
    },
    { path: '/drive/rankings', name: 'drive-rankings', component: DriveRankings },
    { path: '/drive/rankings/:boardId', name: 'drive-board', component: DriveBoard },
    { path: '/drive/roadbook/:routeId', name: 'drive-roadbook', component: DriveRoadbook },
    // v0.3.0 旧路径兼容：/drive/:id → 路书页；/drive/:id/nav → 沿程页
    { path: '/drive/:routeId', redirect: (to) => `/drive/roadbook/${to.params.routeId}` },
    {
      path: '/drive/:routeId/nav',
      redirect: (to) => `/drive/trip?route=${to.params.routeId}`,
    },
  ],
});
