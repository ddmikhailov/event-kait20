import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'КАИТ №20 — Scanner',
        short_name: 'Scanner',
        description: 'Сканер билетов мероприятий КАИТ №20',
        display: 'standalone',
        start_url: '/',
        background_color: '#ffffff',
        theme_color: '#2b2c7c',
        lang: 'ru',
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
});
