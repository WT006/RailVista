import { createRouter, createWebHistory } from 'vue-router';
import SelectTrip from '../pages/SelectTrip.vue';
import TripMap from '../pages/TripMap.vue';
import RouteDetail from '../pages/RouteDetail.vue';
import AtlasMap from '../pages/AtlasMap.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'select', component: SelectTrip },
    { path: '/trip', name: 'trip', component: TripMap },
    { path: '/route/:corridorId', name: 'route-detail', component: RouteDetail },
    { path: '/atlas', name: 'atlas', component: AtlasMap },
  ],
});
