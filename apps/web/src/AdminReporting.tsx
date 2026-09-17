import type {
  EventResponse,
  EventStatisticsResponse,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { personTypeLabels } from '@event-registration/contracts';
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
    [
      'Сверх лимита',
      statistics.overCapacity ??
        Math.max(0, statistics.registered - statistics.capacity),
    ],
    ['Пришло', statistics.attended],
    ['Не пришло', statistics.absent],
    ['Посещаемость', `${formatNumber(statistics.attendancePercentage)}%`],
    ['Участие подтверждено', statistics.confirmedParticipations ?? 0],
    ['Баллов начислено', statistics.scoreAwarded ?? 0],
    ['Без правила баллов', statistics.participationsWithoutScoringRule ?? 0],
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
      {statistics.byPersonType && (
        <section className="admin-panel">
          <h2>Участники по категориям</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Тип участника</th>
                  <th>Регистраций</th>
                  <th>Пришло</th>
                  <th>Не пришло</th>
                </tr>
              </thead>
              <tbody>
                {statistics.byPersonType.map((item) => (
                  <tr key={item.personType}>
                    <th scope="row">{personTypeLabels[item.personType]}</th>
                    <td>{item.registered}</td>
                    <td>{item.attended}</td>
                    <td>{item.absent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {!!statistics.byParticipationRole?.length && (
        <section className="admin-panel">
          <h2>Подтверждённое участие по ролям</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Роль</th>
                  <th>Участников</th>
                </tr>
              </thead>
              <tbody>
                {statistics.byParticipationRole.map((item) => (
                  <tr key={item.code}>
                    <th scope="row">{item.name}</th>
                    <td>{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {!!statistics.byStream?.length && (
        <section className="admin-panel">
          <h2>Итоги по потокам</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Поток</th>
                  <th>Мест</th>
                  <th>Регистраций</th>
                  <th>Пришло</th>
                  <th>Не пришло</th>
                </tr>
              </thead>
              <tbody>
                {statistics.byStream.map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{item.capacity}</td>
                    <td>{item.registered}</td>
                    <td>{item.attended}</td>
                    <td>{item.absent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="admin-panel arrival-panel">
        <header>
          <div>
            <h2>Динамика прихода</h2>
            <p>Количество первых посещений по 15-минутным интервалам.</p>
          </div>
          <span>Московское время (UTC+3)</span>
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
