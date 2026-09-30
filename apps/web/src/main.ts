import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { autoAnimatePlugin } from '@formkit/auto-animate/vue';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import App from './App.vue';
import { router } from './router';
import './styles/tokens.css';
import './styles/base.css';
import './styles/drive.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(autoAnimatePlugin);
app.mount('#app');
