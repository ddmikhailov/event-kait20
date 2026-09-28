import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import { App } from './App.js';
import { scannerUpdates } from './pwa-updates.js';
import './styles.css';

if ('serviceWorker' in navigator) {
  let controller = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const next = navigator.serviceWorker.controller;
    // Workbox's isUpdate flag is captured at registration time. A page opened
    // before its first installation also needs to handle a later update.
    if (controller && next && controller !== next)
      scannerUpdates.onNeedReload();
    controller = next;
  });
}

scannerUpdates.connect(
  registerSW({
    immediate: false,
    onNeedRefresh: scannerUpdates.onNeedRefresh,
    onNeedReload: scannerUpdates.onNeedReload,
    onOfflineReady: scannerUpdates.onOfflineReady,
    onRegisterError: scannerUpdates.onRegisterError,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      let checking = false;
      const check = async () => {
        if (registration.waiting) scannerUpdates.onNeedRefresh();
        if (!navigator.onLine || registration.installing || checking) return;
        checking = true;
        try {
          await registration.update();
        } catch {
          // A failed background check does not invalidate the installed app.
        } finally {
          checking = false;
        }
      };
      void check();
      window.addEventListener('online', () => void check());
      window.addEventListener('focus', () => void check());
      window.setInterval(() => void check(), 60 * 60 * 1000);
    },
  }),
);

const rootElement = document.querySelector('#root');

if (!rootElement) {
  throw new Error('Root element was not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
