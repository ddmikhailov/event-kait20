import {
  streamValuesSchema,
  type EventResponse,
  type StreamResponse,
} from '@event-registration/contracts';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { adminApi, AdminApiError } from './admin-api.js';

export const streamTime = (stream: StreamResponse) => {
  const format = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${format.format(new Date(stream.startAt))} — ${format.format(new Date(stream.endAt))} (МСК)`;
};

export const StreamSelector = ({
  streams,
  onsite = false,
}: {
  streams: StreamResponse[];
  onsite?: boolean;
}) => (
  <label>
    <span>Поток *</span>
    <select name="streamId" required defaultValue="">
      <option value="" disabled>
        Выберите один поток
      </option>
      {streams
        .filter((stream) => stream.active)
        .map((stream) => (
          <option
            key={stream.id}
            value={stream.id}
            disabled={stream.ended || (!onsite && stream.remaining === 0)}
          >
            {stream.title} · {streamTime(stream)} ·{' '}
            {stream.ended ? 'завершён' : `свободно мест: ${stream.remaining}`}
          </option>
        ))}
    </select>
  </label>
);

export const OnsiteStreamSelector = ({ event }: { event: EventResponse }) => {
  const [streams, setStreams] = useState<StreamResponse[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!event.streamsEnabled) return;
    let cancelled = false;
    void adminApi
      .streams(event.id)
      .then((result) => {
        if (!cancelled) setStreams(result.items);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [event.id, event.streamsEnabled]);
  if (!event.streamsEnabled) return null;
  return (
    <>
      {error && (
        <p role="alert">Не удалось загрузить потоки. Обновите страницу.</p>
      )}
      <StreamSelector streams={streams} onsite />
    </>
  );
};

const localTime = (value: string) =>
  new Date(new Date(value).getTime() + 3 * 3600_000).toISOString().slice(0, 16);

export const EventStreamsEditor = ({
  event,
  onChanged,
}: {
  event: EventResponse;
  onChanged: () => Promise<void>;
}) => {
  const [items, setItems] = useState<StreamResponse[]>([]);
  const [editing, setEditing] = useState<StreamResponse>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const load = useCallback(async () => {
    setItems((await adminApi.streams(event.id)).items);
  }, [event.id]);
  useEffect(() => {
    void load().catch(() =>
      setNotice('Не удалось загрузить потоки. Обновите страницу.'),
    );
  }, [load]);
  const submit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (busy) return;
    const form = new FormData(submitEvent.currentTarget);
    setBusy(true);
    setNotice('');
    try {
      const values = streamValuesSchema.parse({
        title: form.get('title'),
        startAt: new Date(`${String(form.get('startAt'))}+03:00`).toISOString(),
        endAt: new Date(`${String(form.get('endAt'))}+03:00`).toISOString(),
        capacity: Number(form.get('capacity')),
        sortOrder: Number(form.get('sortOrder')),
        active: form.has('active'),
      });
      await adminApi.saveStream(event.id, values, editing?.id);
      setEditing(undefined);
      setRevision((value) => value + 1);
      await Promise.all([load(), onChanged()]);
      setNotice('Поток сохранён. Общая вместимость пересчитана.');
    } catch (error) {
      const messages: Record<string, string> = {
        STREAM_HISTORY_CONFLICT:
          'В мероприятии уже есть регистрации без потоков. Автоматическое распределение недоступно: создайте новое мероприятие с потоками.',
        INVALID_TIME_RANGE:
          'Время потока должно находиться в пределах начала и окончания мероприятия.',
        CAPACITY_BELOW_ACTIVE_REGISTRATIONS:
          'Нельзя уменьшить лимит ниже числа зарегистрированных в потоке.',
      };
      setNotice(
        error instanceof AdminApiError
          ? (messages[error.code] ??
              'Не удалось сохранить поток. Проверьте данные и повторите.')
          : 'Проверьте название, время и количество мест.',
      );
    } finally {
      setBusy(false);
    }
  };
  const immutable = event.status === 'ARCHIVED' || event.status === 'COMPLETED';
  return (
    <section className="admin-panel">
      <h2>Потоки мероприятия</h2>
      <p className="muted">
        Участник выбирает один поток. Время — московское (UTC+3). Добавляйте
        потоки до начала регистрации. Общий лимит равен сумме лимитов всех
        потоков, включая закрытые.
      </p>
      {notice && <p role="status">{notice}</p>}
      {items.map((item) => (
        <article key={item.id} className="stream-summary">
          <strong>{item.title}</strong>
          <p>{streamTime(item)}</p>
          <p>
            Записано: {item.registered} / {item.capacity} ·{' '}
            {item.active ? 'Доступен для записи' : 'Запись отключена'}
          </p>
          <button
            type="button"
            disabled={busy || immutable}
            className="secondary-button"
            onClick={() => {
              setEditing(item);
              setRevision((value) => value + 1);
            }}
          >
            Изменить поток
          </button>
        </article>
      ))}
      {!immutable && (
        <form
          key={revision}
          className="admin-form"
          onSubmit={(submitEvent) => void submit(submitEvent)}
        >
          <fieldset disabled={busy}>
            <legend>{editing ? 'Изменение потока' : 'Новый поток'}</legend>
            <label>
              Название
              <input
                name="title"
                required
                maxLength={200}
                defaultValue={editing?.title ?? ''}
                placeholder="Например: Поток 1 — утро"
              />
            </label>
            <label>
              Начало
              <input
                name="startAt"
                type="datetime-local"
                required
                defaultValue={localTime(editing?.startAt ?? event.startAt)}
              />
            </label>
            <label>
              Окончание
              <input
                name="endAt"
                type="datetime-local"
                required
                defaultValue={localTime(editing?.endAt ?? event.endAt)}
              />
            </label>
            <label>
              Количество мест
              <input
                name="capacity"
                type="number"
                required
                min={1}
                max={1_000_000}
                defaultValue={editing?.capacity ?? 30}
              />
            </label>
            <label>
              Порядок отображения
              <input
                name="sortOrder"
                type="number"
                min={0}
                max={100_000}
                required
                defaultValue={editing?.sortOrder ?? items.length}
              />
            </label>
            <label className="checkbox-label">
              <input
                name="active"
                type="checkbox"
                defaultChecked={editing?.active ?? true}
              />
              Разрешить запись в поток
            </label>
            <p className="muted">
              Отключение записи сохраняет участников и их билеты. Изменение
              времени обновляет билет, но не рассылает уведомления: предупредите
              участников отдельно.
            </p>
            <button className="primary-button" disabled={busy}>
              Сохранить поток
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(undefined);
                  setRevision((value) => value + 1);
                }}
              >
                Отменить редактирование
              </button>
            )}
          </fieldset>
        </form>
      )}
    </section>
  );
};
