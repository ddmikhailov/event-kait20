export const App = () => (
  <main className="scanner-shell">
    <header>
      <p className="connection-state">SHELL READY</p>
      <h1>Scanner</h1>
    </header>
    <section
      className="camera-placeholder"
      aria-label="Область сканирования QR"
    >
      <span>Камера будет подключена на этапе scanner feature</span>
    </section>
    <p className="notice">
      Offline-хранилище и синхронизация будут реализованы после утверждения
      доменных контрактов.
    </p>
  </main>
);
