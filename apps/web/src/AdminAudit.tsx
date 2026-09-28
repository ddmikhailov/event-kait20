import type { AuditList } from '@event-registration/contracts';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import { AdminApiError, adminApi } from './admin-api.js';

export const AdminAudit = ({ onBack }: { onBack: () => void }) => {
  const [actionInput, setActionInput] = useState('');
  const [requestInput, setRequestInput] = useState('');
  const [filters, setFilters] = useState({ action: '', requestId: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AuditList>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError('');
    setResult(undefined);
    try {
      const response = await adminApi.auditLog(
        page,
        filters.action,
        filters.requestId,
      );
      if (sequence === loadSequence.current) setResult(response);
    } catch (failure) {
      const code =
        failure instanceof AdminApiError && failure.requestId
          ? ` Код обращения: ${failure.requestId}.`
          : '';
      if (sequence === loadSequence.current)
        setError(`Не удалось загрузить журнал.${code}`);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const next = {
      action: actionInput.trim().toUpperCase(),
      requestId: requestInput.trim(),
    };
    setPage(1);
    setFilters(next);
    if (
      page === 1 &&
      next.action === filters.action &&
      next.requestId === filters.requestId
    )
      void load();
  };

  return (
    <main className="admin-shell">
      <section className="admin-content">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">Управление</p>
            <h1>Журнал действий</h1>
            <p>
              Изменения сотрудников и код запроса для поиска в журнале сервера.
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={onBack}>
            К мероприятиям
          </button>
        </header>
        <form className="admin-card" onSubmit={search}>
          <label htmlFor="audit-action">Код действия</label>
          <input
            id="audit-action"
            value={actionInput}
            maxLength={64}
            pattern="[A-Za-z0-9_]+"
            placeholder="Например, PERSON_MERGED"
            onChange={(event) => setActionInput(event.target.value)}
          />
          <label htmlFor="audit-request-id">Код запроса</label>
          <input
            id="audit-request-id"
            value={requestInput}
            maxLength={64}
            pattern="[A-Za-z0-9._:-]+"
            onChange={(event) => setRequestInput(event.target.value)}
          />
          <button type="submit" className="secondary-button">
            Найти
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        {loading && <p role="status">Загружаем журнал…</p>}
        {!loading && result?.items.length === 0 && <p>Записей не найдено.</p>}
        <section aria-label="Записи журнала">
          {result?.items.map((entry) => (
            <article className="admin-card" key={entry.id}>
              <h2>{entry.action}</h2>
              <p>{new Date(entry.createdAt).toLocaleString('ru-RU')}</p>
              <dl>
                <dt>Сотрудник</dt>
                <dd>{entry.actorEmail}</dd>
                <dt>Объект</dt>
                <dd>
                  {entry.entityType}
                  {entry.entityId ? ` · ${entry.entityId}` : ''}
                </dd>
                <dt>Код запроса</dt>
                <dd>{entry.requestId ?? 'Для прежней записи не сохранён'}</dd>
              </dl>
            </article>
          ))}
        </section>
        {(page > 1 || result?.hasNext) && (
          <nav aria-label="Страницы журнала" className="admin-heading-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={loading || page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Назад
            </button>
            <span>Страница {page}</span>
            <button
              type="button"
              className="secondary-button"
              disabled={loading || !result?.hasNext}
              onClick={() => setPage((value) => value + 1)}
            >
              Далее
            </button>
          </nav>
        )}
      </section>
    </main>
  );
};
