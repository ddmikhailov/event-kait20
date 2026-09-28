import type { RejectedAttendanceCaseList } from '@event-registration/contracts';
import { useCallback, useEffect, useState } from 'react';

import { adminApi } from './admin-api.js';

const reasonLabels: Record<string, string> = {
  INVALID_REGISTRATION: 'Регистрация не найдена',
  REGISTRATION_ANNULLED: 'Регистрация аннулирована',
  INVALID_TIMESTAMP: 'Некорректное время отметки',
  CLIENT_EVENT_CONFLICT: 'Конфликт повторной отметки',
};

export const AdminRejectedAttendance = ({ eventId }: { eventId: string }) => {
  const [offset, setOffset] = useState(0);
  const [cases, setCases] = useState<RejectedAttendanceCaseList>();
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const load = useCallback(async () => {
    try {
      setCases(await adminApi.rejectedAttendance(eventId, offset));
      setError(undefined);
    } catch {
      setError('Не удалось загрузить отклонённые отметки. Повторите запрос.');
    }
  }, [eventId, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (clientEventId: string) => {
    const explanation = reason[clientEventId]?.trim() ?? '';
    if (explanation.length < 3 || explanation.length > 500) {
      setError('Укажите результат проверки: от 3 до 500 символов.');
      return;
    }
    setBusy(clientEventId);
    setError(undefined);
    try {
      await adminApi.resolveRejectedAttendance(
        eventId,
        clientEventId,
        explanation,
      );
      setNotice('Разбор отметки завершён. Посещение и баллы не менялись.');
      await load();
    } catch {
      setError(
        'Не удалось завершить разбор. Проверьте отметку и повторите попытку.',
      );
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section
      className="admin-card"
      aria-labelledby="rejected-attendance-heading"
    >
      <h2 id="rejected-attendance-heading">Отклонённые отметки Scanner</h2>
      <p>
        Проверьте регистрацию и отметку. Для исправления посещения используйте
        сверку мероприятия. Закрытие случая само по себе не начисляет баллы.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button
        type="button"
        className="secondary-button"
        onClick={() => void load()}
      >
        Обновить очередь
      </button>
      {cases?.items.length === 0 && <p>Открытых случаев нет.</p>}
      {cases?.items.map((item) => {
        const name = [item.lastName, item.firstName, item.middleName]
          .filter(Boolean)
          .join(' ');
        return (
          <article key={item.clientEventId} className="admin-card">
            <h3>{name || 'Регистрация не найдена'}</h3>
            <p>
              {item.studyGroup ? `Группа: ${item.studyGroup}. ` : ''}
              {reasonLabels[item.rejectionStatus]}
            </p>
            <p>Отметка: {new Date(item.createdAt).toLocaleString('ru-RU')}</p>
            <label htmlFor={`handoff-${item.clientEventId}`}>
              Результат проверки
            </label>
            <textarea
              id={`handoff-${item.clientEventId}`}
              maxLength={500}
              value={reason[item.clientEventId] ?? ''}
              onChange={(event) =>
                setReason((previous) => ({
                  ...previous,
                  [item.clientEventId]: event.target.value,
                }))
              }
            />
            <button
              type="button"
              className="secondary-button"
              disabled={Boolean(busy)}
              onClick={() => void resolve(item.clientEventId)}
            >
              {busy === item.clientEventId ? 'Сохраняем…' : 'Завершить разбор'}
            </button>
          </article>
        );
      })}
      {(offset > 0 || cases?.hasNext) && (
        <div className="row-actions">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - 50))}
          >
            Назад
          </button>
          <button
            type="button"
            disabled={!cases?.hasNext}
            onClick={() => setOffset((value) => value + 50)}
          >
            Далее
          </button>
        </div>
      )}
    </section>
  );
};
