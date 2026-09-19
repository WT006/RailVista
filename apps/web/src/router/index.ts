import { createRouter, createWebHistory } from 'vue-router';
import SelectTrip from '../pages/SelectTrip.vue';
import TripMap from '../pages/TripMap.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'select', component: SelectTrip },
    { path: '/trip', name: 'trip', component: TripMap },
  ],
});
