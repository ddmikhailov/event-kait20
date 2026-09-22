import type {
  ActivityDirection,
  ActivityReference,
  Participation,
  Season,
  SessionResponse,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useCallback, useEffect, useState } from 'react';

import { adminApi } from './admin-api.js';
import {
  activityError,
  fullName,
  participationStatus,
  scoringStatus,
} from './AdminActivity.js';

type Notice = { kind: 'error' | 'success'; text: string };

type Filters = {
  query: string;
  status: string;
  scoringState: string;
  seasonId: string;
  directionId: string;
};

const emptyFilters: Filters = {
  query: '',
  status: '',
  scoringState: '',
  seasonId: '',
  directionId: '',
};

const eventDate = (isoInstant: string): string =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(isoInstant));

export const ParticipationsPanel = ({
  seasons,
  directions,
  roles,
  results,
  filters,
  onFilterChange,
  onSearchSubmit,
  items,
  page,
  pageSize,
  total,
  onPageChange,
  selectedId,
  onSelectRow,
  busy,
  selected,
  roleId,
  resultId,
  reason,
  onRoleIdChange,
  onResultIdChange,
  onReasonChange,
  onChangeRoleResult,
  onConfirm,
  onCancel,
  onCloseDetail,
}: {
  seasons: Season[];
  directions: ActivityDirection[];
  roles: ActivityReference[];
  results: ActivityReference[];
  filters: Filters;
  onFilterChange: (filters: Filters) => void;
  onSearchSubmit: (form: FormData) => void;
  items: Participation[];
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  selectedId: string | undefined;
  onSelectRow: (item: Participation) => void;
  busy: boolean;
  selected: Participation | undefined;
  roleId: string;
  resultId: string;
  reason: string;
  onRoleIdChange: (value: string) => void;
  onResultIdChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onChangeRoleResult: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onCloseDetail: () => void;
}) => (
  <>
    <section className="admin-panel">
      <form action={onSearchSubmit} className="stack-form">
        <label>
          <span>Найти по ФИО, email, телефону или группе</span>
          <input
            name="query"
            defaultValue={filters.query}
            placeholder="Иванов"
          />
        </label>
        <div className="row-actions">
          <label>
            <span>Сезон</span>
            <select
              value={filters.seasonId}
              disabled={busy}
              onChange={(event) =>
                onFilterChange({ ...filters, seasonId: event.target.value })
              }
            >
              <option value="">Любой сезон</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Направление</span>
            <select
              value={filters.directionId}
              disabled={busy}
              onChange={(event) =>
                onFilterChange({ ...filters, directionId: event.target.value })
              }
            >
              <option value="">Любое направление</option>
              {directions.map((direction) => (
                <option key={direction.id} value={direction.id}>
                  {direction.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Статус участия</span>
            <select
              value={filters.status}
              disabled={busy}
              onChange={(event) =>
                onFilterChange({ ...filters, status: event.target.value })
              }
            >
              <option value="">Любой статус</option>
              <option value="DRAFT">Черновик</option>
              <option value="CONFIRMED">Подтверждено</option>
              <option value="CANCELLED">Отменено</option>
            </select>
          </label>
          <label>
            <span>Начисление</span>
            <select
              value={filters.scoringState}
              disabled={busy}
              onChange={(event) =>
                onFilterChange({ ...filters, scoringState: event.target.value })
              }
            >
              <option value="">Любое</option>
              <option value="NOT_SCORED">Не рассчитано</option>
              <option value="AWARDED">Начислено</option>
              <option value="NO_RULE">Нет подходящего правила</option>
              <option value="REVERSED">Начисление отменено</option>
            </select>
          </label>
        </div>
        <Button type="submit" disabled={busy}>
          Найти
        </Button>
      </form>
    </section>
    <section className="admin-panel">
      <div className="participant-table-wrap">
        <table className="participant-table">
          <thead>
            <tr>
              <th>Участник</th>
              <th>Мероприятие</th>
              <th>Сезон / направление</th>
              <th>Роль / результат</th>
              <th>Участие</th>
              <th>Баллы</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.registrationId}
                className={item.id === selectedId ? 'selected' : ''}
              >
                <td>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onSelectRow(item)}
                  >
                    <strong>{fullName(item)}</strong>
                    <span>
                      {item.registration.studyGroup ?? 'Группа не указана'}
                    </span>
                  </button>
                </td>
                <td>
                  <strong>{item.eventTitle}</strong>
                  <span>{eventDate(item.eventStartAt)}</span>
                </td>
                <td>
                  <strong>{item.seasonName ?? 'Без сезона'}</strong>
                  <span>{item.directionName ?? 'Без направления'}</span>
                </td>
                <td>
                  <strong>{item.role?.name ?? 'Не назначена'}</strong>
                  <span>{item.result?.name ?? 'Без результата'}</span>
                </td>
                <td>{participationStatus(item.status)}</td>
                <td>
                  <strong>{item.scoreAwarded}</strong>
                  <span>{scoringStatus(item.scoringState)}</span>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6}>Ничего не найдено.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {total > pageSize && (
        <div className="row-actions">
          <button
            type="button"
            className="text-button"
            disabled={busy || page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            ← Раньше
          </button>
          <span>
            Стр. {page} из {Math.max(1, Math.ceil(total / pageSize))}
          </span>
          <button
            type="button"
            className="text-button"
            disabled={busy || page * pageSize >= total}
            onClick={() => onPageChange(page + 1)}
          >
            Позже →
          </button>
        </div>
      )}
    </section>
    {selected && (
      <section className="admin-panel">
        <header className="admin-editor-header">
          <button type="button" className="text-button" onClick={onCloseDetail}>
            ← Список
          </button>
          <span>{fullName(selected)}</span>
        </header>
        <ul className="activity-list">
          <li>
            <strong>Мероприятие</strong>
            <span>
              {selected.eventTitle} · {eventDate(selected.eventStartAt)}
            </span>
          </li>
          <li>
            <strong>Сезон</strong>
            <span>{selected.seasonName ?? 'Без сезона'}</span>
          </li>
          <li>
            <strong>Направление</strong>
            <span>{selected.directionName ?? 'Без направления'}</span>
          </li>
          <li>
            <strong>Группа</strong>
            <span>{selected.registration.studyGroup ?? 'Не указана'}</span>
          </li>
          <li>
            <strong>Посещаемость</strong>
            <span>
              {selected.registration.firstAttendedAt
                ? 'Вход подтверждён Scanner'
                : 'Нет отметки Scanner'}
            </span>
          </li>
          <li>
            <strong>Статус участия</strong>
            <span>{participationStatus(selected.status)}</span>
          </li>
          <li>
            <strong>Начисление</strong>
            <span>
              {selected.scoreAwarded} · {scoringStatus(selected.scoringState)}
            </span>
          </li>
          {selected.scoreReason && (
            <li>
              <strong>Причина начисления</strong>
              <span>{selected.scoreReason}</span>
            </li>
          )}
        </ul>
        {selected.status !== 'CANCELLED' && (
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              onChangeRoleResult();
            }}
          >
            <h3>Роль и результат</h3>
            <label>
              <span>Роль участия</span>
              <select
                value={roleId}
                onChange={(event) => onRoleIdChange(event.target.value)}
              >
                <option value="">Не выбрана</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Результат</span>
              <select
                value={resultId}
                onChange={(event) => onResultIdChange(event.target.value)}
              >
                <option value="">Без результата</option>
                {results.map((result) => (
                  <option key={result.id} value={result.id}>
                    {result.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="activity-reason">
              <span>Причина изменения</span>
              <input
                value={reason}
                onChange={(event) => onReasonChange(event.target.value)}
                maxLength={500}
                placeholder="Например: уточнено по итоговой ведомости"
              />
            </label>
            <div className="row-actions">
              <button
                type="submit"
                className="secondary-button"
                disabled={busy}
              >
                Сохранить роль и результат
              </button>
              {selected.status === 'DRAFT' && (
                <Button type="button" disabled={busy} onClick={onConfirm}>
                  Подтвердить участие
                </Button>
              )}
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                onClick={onCancel}
              >
                Отменить участие
              </button>
            </div>
          </form>
        )}
      </section>
    )}
  </>
);

export const ParticipationsAdmin = ({
  onBack,
}: {
  role: SessionResponse['user']['role'];
  onBack: () => void;
}) => {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [directions, setDirections] = useState<ActivityDirection[]>([]);
  const [roles, setRoles] = useState<ActivityReference[]>([]);
  const [results, setResults] = useState<ActivityReference[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Participation[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Participation>();
  const [roleId, setRoleId] = useState('');
  const [resultId, setResultId] = useState('');
  const [reason, setReason] = useState('');
  // Kept as two independent flags rather than one shared `busy`: a filter
  // change's search() and a lifecycle mutation (confirm/cancel/reassign) can
  // be in flight at once, and one finishing first must never clear the
  // other's disabled state. search() only ever touches searchBusy; the
  // mutation handlers only ever touch mutationBusy. `busy` below is their
  // OR, used solely for UI disabling.
  const [searchBusy, setSearchBusy] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const busy = searchBusy || mutationBusy;
  const [notice, setNotice] = useState<Notice>();

  const loadReferences = useCallback(async () => {
    try {
      const [seasonList, directionList, roleList, resultList] =
        await Promise.all([
          adminApi.seasons(),
          adminApi.directions(true),
          adminApi.activityRoles(),
          adminApi.activityResults(),
        ]);
      setSeasons(seasonList.items);
      setDirections(directionList.items);
      setRoles(roleList.items.filter((item) => item.active));
      setResults(resultList.items.filter((item) => item.active));
    } catch (error) {
      setNotice(activityError(error));
    }
  }, []);

  useEffect(() => void loadReferences(), [loadReferences]);

  // Returns whether the search actually landed, exactly like Stage 3's
  // loadReferences/loadPersonStatuses contract: a caller that just ran a
  // mutation needs to know whether this specific refresh succeeded, since
  // the mutation may have already committed even if this call then fails.
  const search = useCallback(
    async (targetPage: number): Promise<boolean> => {
      setSearchBusy(true);
      try {
        const response = await adminApi.searchParticipations({
          ...(filters.query ? { query: filters.query } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.scoringState
            ? { scoringState: filters.scoringState }
            : {}),
          ...(filters.seasonId ? { seasonId: filters.seasonId } : {}),
          ...(filters.directionId ? { directionId: filters.directionId } : {}),
          page: targetPage,
        });
        setItems(response.items);
        setTotal(response.total);
        setPage(response.page);
        setPageSize(response.pageSize);
        // Functional update reads the latest `selected` at commit time
        // rather than closing over it, so `search` itself only needs to
        // depend on `filters` — it stays correct even when called right
        // after a mutation that didn't itself change the filters.
        setSelected((current) => {
          if (!current) return current;
          const stillPresent = response.items.find(
            (item) => item.registrationId === current.registrationId,
          );
          if (stillPresent) {
            setRoleId(stillPresent.role?.id ?? '');
            setResultId(stillPresent.result?.id ?? '');
          }
          return stillPresent;
        });
        return true;
      } catch (error) {
        setNotice(activityError(error));
        return false;
      } finally {
        setSearchBusy(false);
      }
    },
    [filters],
  );

  useEffect(() => void search(1), [filters]);

  const submitQuery = (form: FormData) => {
    const query = String(form.get('query') ?? '').trim();
    setNotice(undefined);
    setFilters((current) => ({ ...current, query }));
  };

  const changeFilters = (next: Filters) => {
    setNotice(undefined);
    setFilters(next);
  };

  const selectRow = (item: Participation) => {
    setSelected(item);
    setRoleId(item.role?.id ?? '');
    setResultId(item.result?.id ?? '');
    setReason('');
    setNotice(undefined);
  };

  const closeDetail = () => {
    setSelected(undefined);
    setReason('');
  };

  // Every mutation below follows the same contract: the action already
  // committed on the backend by the time we reach the refresh, so a failed
  // refresh must read as "saved, but the screen may be stale" — never as
  // "the action failed" and never silently shown as a plain success.
  const afterMutation = async (successText: string) => {
    const refreshed = await search(page);
    setNotice(
      refreshed
        ? { kind: 'success', text: successText }
        : {
            kind: 'error',
            text: `${successText} Но не удалось обновить данные на экране. Обновите страницу.`,
          },
    );
  };

  const changeRoleResult = async () => {
    if (!selected) return;
    if (!roleId) {
      setNotice({ kind: 'error', text: 'Выберите роль участия.' });
      return;
    }
    if (reason.trim().length < 3) {
      setNotice({ kind: 'error', text: 'Укажите причину изменения.' });
      return;
    }
    setMutationBusy(true);
    setNotice(undefined);
    try {
      await adminApi.assignParticipations(selected.eventId, {
        registrationIds: [selected.registrationId],
        roleId,
        resultId: resultId || null,
        reason: reason.trim(),
      });
      setReason('');
      await afterMutation('Роль и результат сохранены.');
    } catch (error) {
      setNotice(activityError(error));
    } finally {
      setMutationBusy(false);
    }
  };

  const confirmSelected = async () => {
    if (!selected) return;
    const withoutAttendance = !selected.registration.firstAttendedAt;
    if (!roleId && !selected.role) {
      setNotice({ kind: 'error', text: 'Выберите роль участия.' });
      return;
    }
    if (withoutAttendance && reason.trim().length < 3) {
      setNotice({
        kind: 'error',
        text: 'Нет отметки Scanner — укажите причину подтверждения без неё.',
      });
      return;
    }
    if (
      !window.confirm(
        'Подтвердить участие и выполнить начисление баллов по действующим правилам?',
      )
    )
      return;
    setMutationBusy(true);
    setNotice(undefined);
    try {
      await adminApi.confirmParticipations(selected.eventId, {
        registrationIds: [selected.registrationId],
        roleId: roleId || null,
        resultId: resultId || null,
        source: 'ADMIN',
        confirmWithoutAttendance: withoutAttendance,
        overrideReason: withoutAttendance ? reason.trim() : null,
      });
      setReason('');
      await afterMutation(
        'Участие подтверждено. Начисление рассчитано по действующим правилам.',
      );
    } catch (error) {
      setNotice(activityError(error));
    } finally {
      setMutationBusy(false);
    }
  };

  const cancelSelected = async () => {
    if (!selected?.id) {
      setNotice({
        kind: 'error',
        text: 'Отменить можно только уже созданную запись участия.',
      });
      return;
    }
    if (reason.trim().length < 3) {
      setNotice({ kind: 'error', text: 'Укажите причину отмены.' });
      return;
    }
    if (
      !window.confirm(
        'Отменить участие? Уже начисленные баллы будут компенсированы обратной операцией.',
      )
    )
      return;
    setMutationBusy(true);
    setNotice(undefined);
    try {
      await adminApi.cancelParticipations(selected.eventId, {
        participationIds: [selected.id],
        reason: reason.trim(),
      });
      setReason('');
      await afterMutation('Участие отменено. История баллов сохранена.');
    } catch (error) {
      setNotice(activityError(error));
    } finally {
      setMutationBusy(false);
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button type="button" className="text-button" onClick={onBack}>
          ← Мероприятия
        </button>
        <span>Участия</span>
      </header>
      <section className="admin-content">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">Activity Core</p>
            <h1>Участия</h1>
            <p>
              Найдите участие и посмотрите его контекст: сезон, направление,
              роль, результат, начисление.
            </p>
          </div>
        </header>
        {notice && (
          <p className={`admin-notice ${notice.kind}`} role="status">
            {notice.text}
          </p>
        )}
        <ParticipationsPanel
          seasons={seasons}
          directions={directions}
          roles={roles}
          results={results}
          filters={filters}
          onFilterChange={changeFilters}
          onSearchSubmit={submitQuery}
          items={items}
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(next) => void search(next)}
          selectedId={selected?.id ?? undefined}
          onSelectRow={selectRow}
          busy={busy}
          selected={selected}
          roleId={roleId}
          resultId={resultId}
          reason={reason}
          onRoleIdChange={setRoleId}
          onResultIdChange={setResultId}
          onReasonChange={setReason}
          onChangeRoleResult={() => void changeRoleResult()}
          onConfirm={() => void confirmSelected()}
          onCancel={() => void cancelSelected()}
          onCloseDetail={closeDetail}
        />
      </section>
    </main>
  );
};
