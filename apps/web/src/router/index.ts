import { createRouter, createWebHistory } from 'vue-router';
import SelectTrip from '../pages/SelectTrip.vue';
import TripMap from '../pages/TripMap.vue';
import RouteDetail from '../pages/RouteDetail.vue';
import CorridorMap from '../pages/CorridorMap.vue';
import AtlasMap from '../pages/AtlasMap.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'select', component: SelectTrip },
    { path: '/trip', name: 'trip', component: TripMap },
    { path: '/route/:corridorId', name: 'route-detail', component: RouteDetail },
    { path: '/route/:corridorId/map', name: 'corridor-map', component: CorridorMap },
    { path: '/atlas', name: 'atlas', component: AtlasMap },
  ],
});
