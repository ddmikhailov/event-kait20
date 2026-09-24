import type {
  ManualAdjustmentRequest,
  PersonScoreSummary,
  PersonScoreTransaction,
  PersonSummary,
  Season,
  SessionResponse,
} from '@event-registration/contracts';
import { manualAdjustmentRequestSchema } from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useState } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';
import { activityError } from './AdminActivity.js';

type Notice = { kind: 'error' | 'success'; text: string };

const MOSCOW_TIMEZONE = 'Europe/Moscow';

const formatMoscow = (iso: string): string =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

const TRANSACTION_TYPE_LABELS: Record<PersonScoreTransaction['type'], string> =
  {
    AWARD: 'Начисление',
    REVERSAL: 'Отмена начисления',
    MANUAL_ADJUSTMENT: 'Ручная корректировка',
  };

export const transactionTypeLabel = (
  type: PersonScoreTransaction['type'],
): string => TRANSACTION_TYPE_LABELS[type];

// Presentation-only sign formatting - the canonical decimal string sent to
// the API and shown after reload is never recomputed here, only its
// leading sign is inspected for display.
export const formatSignedPoints = (points: string): string =>
  points.trim().startsWith('-')
    ? `−${points.trim().slice(1)}`
    : `+${points.trim()}`;

const personFullName = (person: {
  lastName: string;
  firstName: string;
  middleName: string | null;
}) =>
  [person.lastName, person.firstName, person.middleName]
    .filter(Boolean)
    .join(' ');

// Pure so the exact confirmation wording can be unit-tested without
// invoking window.confirm - no arithmetic on `points`, only string
// inspection of its sign, matching the canonical decimal string as typed.
export const adjustmentConfirmationText = (
  personName: string,
  seasonName: string,
  points: string,
): string => {
  const trimmed = points.trim();
  const negative = trimmed.startsWith('-');
  const magnitude = negative ? trimmed.slice(1) : trimmed;
  return negative
    ? `Снять ${magnitude} балла у «${personName}» в сезоне «${seasonName}»?`
    : `Добавить +${magnitude} баллов «${personName}» в сезоне «${seasonName}»?`;
};

// Manual-adjustment-specific error mapping, deliberately NOT reusing the
// shared activityError()'s INVALID_REFERENCE wording (written for
// role/result references elsewhere) - the same code means something
// different here (an unavailable Season), so it gets its own message
// rather than a second silent meaning bolted onto the shared map (the
// Stage 4.2 CONFLICT debt this batch was told not to repeat).
export const manualAdjustmentError = (error: unknown): Notice => {
  if (error instanceof AdminApiError) {
    if (error.code === 'NETWORK_ERROR') {
      return {
        kind: 'error',
        text: 'Не удалось подтвердить результат операции. Повторная отправка будет выполнена с тем же идентификатором операции.',
      };
    }
    const messages: Record<string, string> = {
      IDEMPOTENCY_KEY_REUSED:
        'Эта операция уже была отправлена с другими данными. Нажмите «Сбросить», чтобы начать новую корректировку.',
      INVALID_REFERENCE: 'Выбранный сезон недоступен для этой организации.',
    };
    if (error.code in messages) {
      return { kind: 'error', text: messages[error.code]! };
    }
  }
  return activityError(error);
};

export type ManualAdjustmentValidation =
  | { success: true; data: ManualAdjustmentRequest }
  | { success: false; field: 'points' | 'reason' | 'other'; message: string };

// The FULL shared request contract is the single source of truth before
// any POST - not the points schema alone. A candidate that passes
// `manualAdjustmentPointsSchema` in isolation but fails the full request
// (e.g. a too-short reason) must never reach adminApi.createManualAdjustment.
// Pure and independently testable without simulating fetch: given a
// candidate object, it either returns the exact payload to send or a
// field-tagged, human-readable (Russian) message - never a raw Zod error.
export const parseManualAdjustmentRequest = (
  candidate: unknown,
): ManualAdjustmentValidation => {
  const parsed = manualAdjustmentRequestSchema.safeParse(candidate);
  if (parsed.success) return { success: true, data: parsed.data };
  const paths = parsed.error.issues.map((issue) => issue.path[0]);
  if (paths.includes('points')) {
    return {
      success: false,
      field: 'points',
      message:
        'Баллы должны быть ненулевым значением от -1 000 000 до 1 000 000, не более 4 знаков после запятой.',
    };
  }
  if (paths.includes('reason')) {
    return {
      success: false,
      field: 'reason',
      message: 'Укажите причину длиной от 3 до 500 символов.',
    };
  }
  return {
    success: false,
    field: 'other',
    message: 'Проверьте введённые данные.',
  };
};

// Pure lifecycle rule for the operation's idempotency key: a failed
// submit (network error, validation error, IDEMPOTENCY_KEY_REUSED, ...)
// keeps the SAME requestId, so a manual retry of the same operation stays
// idempotent; only a succeeded mutation or an explicit form reset rotates
// to a fresh one for the next, distinct operation. `generate` is injected
// so this stays testable without depending on crypto.randomUUID().
export type AdjustmentOutcome = 'failed' | 'succeeded' | 'reset';

export const nextRequestId = (
  current: string,
  outcome: AdjustmentOutcome,
  generate: () => string,
): string => (outcome === 'failed' ? current : generate());

export const seasonLabel = (season: Season): string => season.name;

export const ManualAdjustmentPanel = ({
  canManage,
  busy,
  hasSearched,
  searchResults,
  selectedPerson,
  onSearch,
  onSelectPerson,
  onClearSelection,
  scoreSummary,
  scoreTransactions,
  seasons,
  creating,
  onBeginCreate,
  onCancelCreate,
  onSubmitCreate,
  pointsValue,
  onPointsChange,
}: {
  canManage: boolean;
  busy: boolean;
  hasSearched: boolean;
  searchResults: PersonSummary[];
  selectedPerson: PersonSummary | undefined;
  onSearch: (form: FormData) => void;
  onSelectPerson: (person: PersonSummary) => void;
  onClearSelection: () => void;
  scoreSummary: PersonScoreSummary[];
  scoreTransactions: PersonScoreTransaction[];
  seasons: Season[];
  creating: boolean;
  onBeginCreate: () => void;
  onCancelCreate: () => void;
  onSubmitCreate: (form: FormData) => void;
  pointsValue: string;
  onPointsChange: (value: string) => void;
}) => (
  <section className="admin-panel">
    <h2>Корректировки баллов</h2>
    {!selectedPerson && (
      <>
        <form action={onSearch} className="stack-form">
          <label>
            <span>Найти человека</span>
            <input name="query" placeholder="ФИО, email, телефон или группа" />
          </label>
          <Button type="submit" disabled={busy}>
            Найти
          </Button>
        </form>
        <ul className="activity-list">
          {searchResults.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                className="text-button"
                onClick={() => onSelectPerson(person)}
              >
                <strong>{personFullName(person)}</strong>
                <span>{person.studyGroup ?? person.organization ?? ''}</span>
              </button>
            </li>
          ))}
          {searchResults.length === 0 && !hasSearched && (
            <li>Введите запрос и нажмите «Найти».</li>
          )}
          {searchResults.length === 0 && hasSearched && (
            <li>Никого не найдено по этому запросу.</li>
          )}
        </ul>
      </>
    )}
    {selectedPerson && (
      <>
        <p>
          <strong>{personFullName(selectedPerson)}</strong>{' '}
          <button
            type="button"
            className="text-button"
            onClick={onClearSelection}
            disabled={busy}
          >
            Выбрать другого человека
          </button>
        </p>
        <h3>Итого по сезонам</h3>
        <div className="participant-table-wrap">
          <table className="participant-table">
            <thead>
              <tr>
                <th>Сезон</th>
                <th>Баллы</th>
              </tr>
            </thead>
            <tbody>
              {scoreSummary.map((item) => (
                <tr key={item.seasonId}>
                  <td>{item.seasonName}</td>
                  <td>{item.points}</td>
                </tr>
              ))}
              {scoreSummary.length === 0 && (
                <tr>
                  <td colSpan={2}>Баллов пока нет.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <h3>Последние операции</h3>
        <div className="participant-table-wrap">
          <table className="participant-table">
            <thead>
              <tr>
                <th>Сезон</th>
                <th>Тип</th>
                <th>Баллы</th>
                <th>Причина</th>
                <th>Когда</th>
              </tr>
            </thead>
            <tbody>
              {scoreTransactions.map((item) => (
                <tr key={item.id}>
                  <td>{item.seasonName}</td>
                  <td>{transactionTypeLabel(item.type)}</td>
                  <td>{formatSignedPoints(item.points)}</td>
                  <td>{item.reason ?? '—'}</td>
                  <td>{formatMoscow(item.createdAt)}</td>
                </tr>
              ))}
              {scoreTransactions.length === 0 && (
                <tr>
                  <td colSpan={5}>Операций пока нет.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {canManage && !creating && (
          <div className="row-actions">
            <Button onClick={onBeginCreate} disabled={busy}>
              Новая корректировка
            </Button>
          </div>
        )}
        {canManage && creating && (
          <form action={onSubmitCreate} className="stack-form">
            <h3>Новая корректировка баллов</h3>
            <label>
              <span>Сезон</span>
              <select name="seasonId" required disabled={busy}>
                <option value="">Выберите сезон…</option>
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {seasonLabel(season)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Баллы (например, 5.0000 или -3.5000)</span>
              <input
                name="points"
                required
                disabled={busy}
                value={pointsValue}
                onChange={(event) => onPointsChange(event.target.value)}
                placeholder="5.0000"
              />
            </label>
            <label>
              <span>Причина</span>
              <textarea
                name="reason"
                required
                disabled={busy}
                minLength={3}
                maxLength={500}
              />
            </label>
            <div className="row-actions">
              <Button type="submit" disabled={busy}>
                Подтвердить
              </Button>
              <button
                type="button"
                className="text-button"
                onClick={onCancelCreate}
                disabled={busy}
              >
                Сбросить
              </button>
            </div>
          </form>
        )}
      </>
    )}
  </section>
);

export const ManualAdjustmentAdmin = ({
  role,
  onBack,
}: {
  role: SessionResponse['user']['role'];
  onBack: () => void;
}) => {
  const canManage = role === 'SUPER_ADMIN';
  const [personResults, setPersonResults] = useState<PersonSummary[]>([]);
  const [hasSearchedPeople, setHasSearchedPeople] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<PersonSummary>();
  const [scoreSummary, setScoreSummary] = useState<PersonScoreSummary[]>([]);
  const [scoreTransactions, setScoreTransactions] = useState<
    PersonScoreTransaction[]
  >([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [creating, setCreating] = useState(false);
  const [pointsValue, setPointsValue] = useState('');
  const [requestId, setRequestId] = useState<string>(() => crypto.randomUUID());
  // searchBusy/mutationBusy split, same convention as Stage 4.2/4.3: every
  // read (Person search, activity reload, Season list) shares searchBusy;
  // only the adjustment submit uses mutationBusy.
  const [searchBusy, setSearchBusy] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const busy = searchBusy || mutationBusy;
  const [notice, setNotice] = useState<Notice>();

  const loadActivity = async (personId: string): Promise<boolean> => {
    try {
      const activity = await adminApi.personActivity(personId);
      setScoreSummary(activity.scoreSummary);
      setScoreTransactions(activity.scoreTransactions);
      return true;
    } catch (error) {
      setNotice(manualAdjustmentError(error));
      return false;
    }
  };

  const searchPeople = async (form: FormData) => {
    const query = String(form.get('query') ?? '').trim();
    setSearchBusy(true);
    setNotice(undefined);
    try {
      setPersonResults((await adminApi.people(query)).items);
      setHasSearchedPeople(true);
    } catch (error) {
      setNotice(manualAdjustmentError(error));
    } finally {
      setSearchBusy(false);
    }
  };

  const selectPerson = async (person: PersonSummary) => {
    setSelectedPerson(person);
    setCreating(false);
    setSearchBusy(true);
    setNotice(undefined);
    try {
      const [, seasonList] = await Promise.all([
        loadActivity(person.id),
        adminApi.seasons(),
      ]);
      setSeasons(seasonList.items);
    } catch (error) {
      setNotice(manualAdjustmentError(error));
    } finally {
      setSearchBusy(false);
    }
  };

  const clearSelection = () => {
    setSelectedPerson(undefined);
    setScoreSummary([]);
    setScoreTransactions([]);
    setSeasons([]);
    setCreating(false);
  };

  const beginCreate = () => {
    setCreating(true);
    setPointsValue('');
    setNotice(undefined);
  };

  // Explicit reset per the instruction: abandons a requestId that may be
  // stuck against a rejected/idempotency-conflicted payload and starts a
  // fresh operation - never done silently or automatically on failure.
  const cancelCreate = () => {
    setCreating(false);
    setPointsValue('');
    setRequestId((current) =>
      nextRequestId(current, 'reset', () => crypto.randomUUID()),
    );
    setNotice(undefined);
  };

  const afterMutation = async (successText: string) => {
    if (!selectedPerson) return;
    const refreshed = await loadActivity(selectedPerson.id);
    setNotice(
      refreshed
        ? { kind: 'success', text: successText }
        : {
            kind: 'error',
            text: `${successText} Но не удалось обновить данные на экране. Обновите страницу.`,
          },
    );
  };

  const submitCreate = async (form: FormData) => {
    if (!selectedPerson) return;
    const seasonId = String(form.get('seasonId') ?? '');
    const points = String(form.get('points') ?? '').trim();
    const reason = String(form.get('reason') ?? '').trim();
    if (!seasonId || !points || !reason) return;
    const season = seasons.find((item) => item.id === seasonId);
    if (!season) return;
    // The full shared request contract is the gate, not the points schema
    // in isolation - a candidate can never reach adminApi.createManualAdjustment
    // without first passing manualAdjustmentRequestSchema in its entirety.
    const validated = parseManualAdjustmentRequest({
      requestId,
      personId: selectedPerson.id,
      seasonId,
      points,
      reason,
    });
    if (!validated.success) {
      setNotice({ kind: 'error', text: validated.message });
      return;
    }
    if (
      !window.confirm(
        adjustmentConfirmationText(
          personFullName(selectedPerson),
          seasonLabel(season),
          validated.data.points,
        ),
      )
    )
      return;
    setMutationBusy(true);
    setNotice(undefined);
    try {
      await adminApi.createManualAdjustment(validated.data);
      setRequestId((current) =>
        nextRequestId(current, 'succeeded', () => crypto.randomUUID()),
      );
      setCreating(false);
      setPointsValue('');
      await afterMutation('Корректировка сохранена.');
    } catch (error) {
      // requestId intentionally NOT rotated here - see nextRequestId's
      // 'failed' branch: an unknown-outcome network error or a rejected
      // request must stay retryable under the same idempotency key. A
      // validation failure above (never reaching this block) is likewise
      // safe to leave the requestId untouched - the backend never saw it.
      setNotice(manualAdjustmentError(error));
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
        <span>Корректировки баллов</span>
      </header>
      <section className="admin-content">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">Activity Core</p>
            <h1>Корректировки баллов</h1>
            <p>
              Найдите человека, посмотрите его баллы по сезонам и, при
              необходимости, внесите ручную корректировку в ledger.
            </p>
          </div>
        </header>
        {notice && (
          <p className={`admin-notice ${notice.kind}`} role="status">
            {notice.text}
          </p>
        )}
        <ManualAdjustmentPanel
          canManage={canManage}
          busy={busy}
          hasSearched={hasSearchedPeople}
          searchResults={personResults}
          selectedPerson={selectedPerson}
          onSearch={(form) => void searchPeople(form)}
          onSelectPerson={(person) => void selectPerson(person)}
          onClearSelection={clearSelection}
          scoreSummary={scoreSummary}
          scoreTransactions={scoreTransactions}
          seasons={seasons}
          creating={creating}
          onBeginCreate={beginCreate}
          onCancelCreate={cancelCreate}
          onSubmitCreate={(form) => void submitCreate(form)}
          pointsValue={pointsValue}
          onPointsChange={setPointsValue}
        />
      </section>
    </main>
  );
};
