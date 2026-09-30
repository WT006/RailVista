import { createRouter, createWebHistory } from 'vue-router';
import SelectTrip from '../pages/SelectTrip.vue';
import TripMap from '../pages/TripMap.vue';
import RouteDetail from '../pages/RouteDetail.vue';
import AtlasMap from '../pages/AtlasMap.vue';
import DriveHome from '../pages/DriveHome.vue';
import DriveRoadbook from '../pages/DriveRoadbook.vue';
import DriveNav from '../pages/DriveNav.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'select', component: SelectTrip },
    { path: '/trip', name: 'trip', component: TripMap },
    { path: '/route/:corridorId', name: 'route-detail', component: RouteDetail },
    { path: '/atlas', name: 'atlas', component: AtlasMap },
    { path: '/drive', name: 'drive-home', component: DriveHome },
    { path: '/drive/:routeId', name: 'drive-roadbook', component: DriveRoadbook },
    { path: '/drive/:routeId/nav', name: 'drive-nav', component: DriveNav },
  ],
});
