import type {
  EventResponse,
  EventStatisticsResponse,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useCallback, useEffect, useState } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';

export const EventStatistics = ({
  event,
  onBack,
}: {
  event: EventResponse;
  onBack: () => void;
}) => {
  const [statistics, setStatistics] = useState<EventStatisticsResponse>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      setStatistics(await adminApi.eventStatistics(event.id));
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.message
          : 'Статистика не загрузилась.',
      );
    } finally {
      setBusy(false);
    }
  }, [event.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button className="text-button" onClick={onBack}>
          ← Все мероприятия
        </button>
        <span>{event.title}</span>
      </header>
      <section className="reporting-layout">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">Сводка</p>
            <h1>Статистика мероприятия</h1>
            <p>Только действующие регистрации, обновление по запросу.</p>
          </div>
          <Button disabled={busy} onClick={() => void load()}>
            {busy ? 'Обновляем…' : 'Обновить'}
          </Button>
        </header>
        {error && <div className="admin-notice error">{error}</div>}
        {statistics ? (
          <StatisticsDashboard
            statistics={statistics}
            timezone={event.timezone}
          />
        ) : (
          !error && <p className="admin-empty">Собираем статистику…</p>
        )}
      </section>
    </main>
  );
};

export const StatisticsDashboard = ({
  statistics,
  timezone,
}: {
  statistics: EventStatisticsResponse;
  timezone: string;
}) => {
  const metrics = [
    ['Лимит', statistics.capacity],
    ['Зарегистрировано', statistics.registered],
    ['Свободно', statistics.freePlaces],
    ['Пришло', statistics.attended],
    ['Не пришло', statistics.absent],
    ['Посещаемость', `${formatNumber(statistics.attendancePercentage)}%`],
  ];
  const maximum = Math.max(
    1,
    ...statistics.arrivalSeries.map((point) => point.count),
  );
  return (
    <>
      <section className="reporting-metrics" aria-label="Основные показатели">
        {metrics.map(([label, value]) => (
          <article className="admin-panel" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </article>
        ))}
      </section>
      <section className="admin-panel arrival-panel">
        <header>
          <div>
            <h2>Динамика прихода</h2>
            <p>Количество первых посещений по 15-минутным интервалам.</p>
          </div>
          <span>{timezone}</span>
        </header>
        {statistics.arrivalSeries.length === 0 ? (
          <p className="admin-empty">Посещений пока нет.</p>
        ) : (
          <ol className="arrival-series">
            {statistics.arrivalSeries.map((point) => (
              <li key={point.bucketStart}>
                <time dateTime={point.bucketStart}>
                  {formatTime(point.bucketStart, timezone)}
                </time>
                <span className="arrival-track" aria-hidden="true">
                  <span
                    style={{
                      width: `${Math.max(4, (point.count / maximum) * 100)}%`,
                    }}
                  />
                </span>
                <strong>{point.count}</strong>
                <small>всего {point.cumulative}</small>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
};

const formatNumber = (value: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);

const formatTime = (value: string, timezone: string): string =>
  new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
