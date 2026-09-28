import { Button } from '@event-registration/ui';
import { useSyncExternalStore } from 'react';

import { scannerUpdates } from './pwa-updates.js';

export const ScannerUpdateNotice = ({ busy }: { busy: boolean }) => {
  const state = useSyncExternalStore(
    scannerUpdates.subscribe,
    scannerUpdates.getSnapshot,
    scannerUpdates.getSnapshot,
  );
  if (!state.available && !state.offlineReady && !state.error) return null;
  return (
    <section className="scanner-update" aria-label="Обновление Scanner">
      <div role="status">
        <strong>
          {state.available
            ? 'Доступна новая версия Scanner'
            : state.error
              ? 'Не удалось подготовить офлайн-приложение'
              : 'Приложение готово к работе без интернета'}
        </strong>
        <p>
          {state.available
            ? 'Обновление перезагрузит Scanner. Сохранённые на устройстве отметки останутся в очереди.'
            : 'Для офлайн-работы также подготовьте нужное мероприятие при наличии связи.'}
        </p>
        {state.error && (
          <p>
            Проверьте соединение. Если обновление не применяется, закройте и
            снова откройте Scanner после завершения работы. Данные сайта не
            очищайте.
          </p>
        )}
        {busy && state.available && (
          <p>Дождитесь завершения текущей операции.</p>
        )}
      </div>
      {state.available && (
        <Button
          disabled={busy || state.applying}
          onClick={() => void scannerUpdates.apply()}
        >
          {state.applying ? 'Обновляем…' : 'Обновить Scanner'}
        </Button>
      )}
    </section>
  );
};
