import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const scannerBase = process.env.VITE_SCANNER_BASE_PATH ?? '/';

export default defineConfig({
  base: scannerBase,
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
        start_url: scannerBase,
        background_color: '#ffffff',
        theme_color: '#2b2c7c',
        lang: 'ru',
        icons: [
          { src: 'scanner-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'scanner-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: `${scannerBase}index.html`,
      },
    }),
  ],
});
