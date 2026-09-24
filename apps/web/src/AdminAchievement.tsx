import type {
  Participation,
  PersonAchievement,
  PersonSummary,
  SessionResponse,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useState } from 'react';

import { adminApi } from './admin-api.js';
import { zonedLocalToIso } from './admin-values.js';
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

const STATUS_LABELS: Record<PersonAchievement['status'], string> = {
  DRAFT: 'Черновик',
  PENDING: 'Ожидает решения',
  VERIFIED: 'Подтверждено',
  REJECTED: 'Отклонено',
  CANCELLED: 'Отменено',
};

const SOURCE_LABELS: Record<PersonAchievement['source'], string> = {
  EVENT_KAIT20: 'Мероприятие КАИТ №20',
  MANUAL: 'Вручную',
  IMPORT: 'Импорт',
  EXTERNAL_SYSTEM: 'Внешняя система',
};

export const achievementStatusLabel = (
  status: PersonAchievement['status'],
): string => STATUS_LABELS[status];

export const achievementSourceLabel = (
  source: PersonAchievement['source'],
): string => SOURCE_LABELS[source];

// Readable context so an Event/Participation link never shows only its raw
// UUID - the id fields stay on the object for the API, but are never the
// primary label rendered in the list.
export const achievementContextLabel = (
  achievement: PersonAchievement,
): string | null => {
  if (achievement.participationId) {
    const parts = [
      achievement.eventTitle ?? 'Участие',
      achievement.participationRole?.name,
      achievement.participationResult?.name,
    ].filter(Boolean);
    return parts.join(' · ');
  }
  if (achievement.eventId) return achievement.eventTitle ?? 'Мероприятие';
  return null;
};

const personFullName = (person: {
  lastName: string;
  firstName: string;
  middleName: string | null;
}) =>
  [person.lastName, person.firstName, person.middleName]
    .filter(Boolean)
    .join(' ');

const participationLabel = (item: Participation): string =>
  [
    item.eventTitle,
    new Intl.DateTimeFormat('ru-RU', { timeZone: MOSCOW_TIMEZONE }).format(
      new Date(item.eventStartAt),
    ),
    item.role?.name,
    item.result?.name,
  ]
    .filter(Boolean)
    .join(' · ');

// A cross-Event search can return a virtual row for a DRAFT registration
// that has no persisted Participation yet (`id === null`) - it can never be
// an Achievement's participation_id (a real foreign key), so it must never
// be offered as a selectable link target.
export type LinkedParticipation = Participation & { id: string };

export const linkableParticipations = (
  items: Participation[],
): LinkedParticipation[] =>
  items.filter((item): item is LinkedParticipation => item.id !== null);

type LinkMode = 'none' | 'participation';

const DECISIONS: {
  status: 'VERIFIED' | 'REJECTED' | 'CANCELLED';
  label: string;
}[] = [
  { status: 'VERIFIED', label: 'Подтвердить' },
  { status: 'REJECTED', label: 'Отклонить' },
  { status: 'CANCELLED', label: 'Отменить' },
];

export const AchievementPanel = ({
  canManage,
  busy,
  hasSearched,
  searchResults,
  selectedPerson,
  onSearch,
  onSelectPerson,
  onClearSelection,
  achievements,
  creating,
  onBeginCreate,
  onCancelCreate,
  onSubmitCreate,
  linkMode,
  onLinkModeChange,
  participationQuery,
  participationResults,
  onParticipationSearch,
  selectedParticipation,
  onSelectParticipation,
  decidingId,
  decisionReason,
  onDecisionReasonChange,
  onDecide,
}: {
  canManage: boolean;
  busy: boolean;
  hasSearched: boolean;
  searchResults: PersonSummary[];
  selectedPerson: PersonSummary | undefined;
  onSearch: (form: FormData) => void;
  onSelectPerson: (person: PersonSummary) => void;
  onClearSelection: () => void;
  achievements: PersonAchievement[];
  creating: boolean;
  onBeginCreate: () => void;
  onCancelCreate: () => void;
  onSubmitCreate: (form: FormData) => void;
  linkMode: LinkMode;
  onLinkModeChange: (mode: LinkMode) => void;
  participationQuery: string;
  participationResults: Participation[];
  onParticipationSearch: (query: string) => void;
  selectedParticipation: LinkedParticipation | undefined;
  onSelectParticipation: (item: LinkedParticipation | undefined) => void;
  decidingId: string | undefined;
  decisionReason: string;
  onDecisionReasonChange: (value: string) => void;
  onDecide: (
    achievementId: string,
    status: 'VERIFIED' | 'REJECTED' | 'CANCELLED',
  ) => void;
}) => (
  <section className="admin-panel">
    <h2>Достижения</h2>
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
        <div className="participant-table-wrap">
          <table className="participant-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Тип</th>
                <th>Источник</th>
                <th>Контекст</th>
                <th>Когда</th>
                <th>Состояние</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {achievements.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{item.type}</td>
                  <td>{achievementSourceLabel(item.source)}</td>
                  <td>{achievementContextLabel(item) ?? '—'}</td>
                  <td>{formatMoscow(item.occurredAt)}</td>
                  <td>{achievementStatusLabel(item.status)}</td>
                  <td>
                    {canManage && item.status === 'PENDING' && (
                      <div className="row-actions">
                        {decidingId === item.id ? (
                          <>
                            <input
                              placeholder="Причина решения"
                              value={decisionReason}
                              disabled={busy}
                              onChange={(event) =>
                                onDecisionReasonChange(event.target.value)
                              }
                            />
                            {DECISIONS.map((decision) => (
                              <button
                                key={decision.status}
                                type="button"
                                className="text-button"
                                disabled={
                                  busy || decisionReason.trim().length < 3
                                }
                                onClick={() =>
                                  onDecide(item.id, decision.status)
                                }
                              >
                                {decision.label}
                              </button>
                            ))}
                          </>
                        ) : (
                          <button
                            type="button"
                            className="text-button"
                            disabled={busy}
                            onClick={() => onDecide(item.id, 'VERIFIED')}
                          >
                            Решить…
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {achievements.length === 0 && (
                <tr>
                  <td colSpan={7}>Достижений пока нет.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {canManage && !creating && (
          <div className="row-actions">
            <Button onClick={onBeginCreate} disabled={busy}>
              Добавить достижение
            </Button>
          </div>
        )}
        {canManage && creating && (
          <form action={onSubmitCreate} className="stack-form">
            <h3>Новое достижение</h3>
            <label>
              <span>Название</span>
              <input name="title" required disabled={busy} maxLength={255} />
            </label>
            <label>
              <span>Тип (код)</span>
              <input
                name="achievementType"
                required
                disabled={busy}
                placeholder="CERTIFICATE"
                pattern="[A-Za-z][A-Za-z0-9_]{1,49}"
              />
            </label>
            <label>
              <span>Источник</span>
              <select
                name="source"
                required
                disabled={busy}
                defaultValue="MANUAL"
              >
                {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Дата и время</span>
              <input
                name="occurredAt"
                type="datetime-local"
                required
                disabled={busy}
              />
            </label>
            <label>
              <span>Описание</span>
              <textarea name="description" disabled={busy} maxLength={20_000} />
            </label>
            <fieldset>
              <legend>Связь с мероприятием</legend>
              <label>
                <input
                  type="radio"
                  name="linkMode"
                  checked={linkMode === 'none'}
                  disabled={busy}
                  onChange={() => onLinkModeChange('none')}
                />
                Без ссылки (вручную)
              </label>
              <label>
                <input
                  type="radio"
                  name="linkMode"
                  checked={linkMode === 'participation'}
                  disabled={busy}
                  onChange={() => onLinkModeChange('participation')}
                />
                Связано с участием
              </label>
              {linkMode === 'participation' && (
                <div className="stack-form">
                  <input
                    placeholder="Поиск участия по мероприятию"
                    value={participationQuery}
                    disabled={busy}
                    onChange={(event) =>
                      onParticipationSearch(event.target.value)
                    }
                  />
                  <ul className="activity-list">
                    {linkableParticipations(participationResults).map(
                      (item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="text-button"
                            disabled={busy}
                            onClick={() => onSelectParticipation(item)}
                          >
                            {participationLabel(item)}
                          </button>
                        </li>
                      ),
                    )}
                  </ul>
                  {selectedParticipation && (
                    <p>
                      Выбрано: {participationLabel(selectedParticipation)}{' '}
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => onSelectParticipation(undefined)}
                      >
                        Убрать
                      </button>
                    </p>
                  )}
                </div>
              )}
            </fieldset>
            <div className="row-actions">
              <Button type="submit" disabled={busy}>
                Сохранить
              </Button>
              <button
                type="button"
                className="text-button"
                onClick={onCancelCreate}
                disabled={busy}
              >
                Отмена
              </button>
            </div>
          </form>
        )}
      </>
    )}
  </section>
);

export const AchievementAdmin = ({
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
  const [achievements, setAchievements] = useState<PersonAchievement[]>([]);
  const [creating, setCreating] = useState(false);
  const [linkMode, setLinkMode] = useState<LinkMode>('none');
  const [participationQuery, setParticipationQuery] = useState('');
  const [participationResults, setParticipationResults] = useState<
    Participation[]
  >([]);
  const [selectedParticipation, setSelectedParticipation] =
    useState<LinkedParticipation>();
  const [decidingId, setDecidingId] = useState<string>();
  const [decisionReason, setDecisionReason] = useState('');
  // Same searchBusy/mutationBusy split established in Stage 4.2: every read
  // (Person search, Achievement reload, Participation picker search) shares
  // searchBusy, only create/decide mutations use mutationBusy - so a search
  // can never clear a mutation's disabled state and vice versa.
  const [searchBusy, setSearchBusy] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const busy = searchBusy || mutationBusy;
  const [notice, setNotice] = useState<Notice>();

  const loadAchievements = async (personId: string): Promise<boolean> => {
    try {
      setAchievements((await adminApi.personActivity(personId)).achievements);
      return true;
    } catch (error) {
      setNotice(activityError(error));
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
      setNotice(activityError(error));
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
      await loadAchievements(person.id);
    } finally {
      setSearchBusy(false);
    }
  };

  const clearSelection = () => {
    setSelectedPerson(undefined);
    setAchievements([]);
    setCreating(false);
  };

  const beginCreate = () => {
    setCreating(true);
    setLinkMode('none');
    setParticipationQuery('');
    setParticipationResults([]);
    setSelectedParticipation(undefined);
    setNotice(undefined);
  };

  const cancelCreate = () => {
    setCreating(false);
    setNotice(undefined);
  };

  const searchParticipationsFor = async (query: string) => {
    setParticipationQuery(query);
    if (!selectedPerson || query.trim().length < 2) {
      setParticipationResults([]);
      return;
    }
    setSearchBusy(true);
    try {
      // personId is a server-side filter on the existing, already
      // Tenant+Organization-scoped search - never a client-side filter over
      // an unrelated page of results, which could miss this Person's own
      // Participation entirely once it falls off the current page.
      const result = await adminApi.searchParticipations({
        personId: selectedPerson.id,
        query,
      });
      setParticipationResults(result.items);
    } catch (error) {
      setNotice(activityError(error));
    } finally {
      setSearchBusy(false);
    }
  };

  // Same canonical contract as Stage 4.2: the mutation has already
  // committed by the time this runs, so a failed reload reads as "saved,
  // but the screen may be stale" - never as "the action failed".
  const afterMutation = async (successText: string) => {
    if (!selectedPerson) return;
    const refreshed = await loadAchievements(selectedPerson.id);
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
    const title = String(form.get('title') ?? '').trim();
    const achievementType = String(form.get('achievementType') ?? '')
      .trim()
      .toUpperCase();
    const source = String(form.get('source') ?? 'MANUAL') as
      'EVENT_KAIT20' | 'MANUAL' | 'IMPORT' | 'EXTERNAL_SYSTEM';
    const occurredAtLocal = String(form.get('occurredAt') ?? '');
    const description = String(form.get('description') ?? '').trim();
    if (!title || !achievementType || !occurredAtLocal) return;
    // A persisted Participation id is required whenever the admin chose to
    // link one - never silently fall back to `?? null` and create an
    // unlinked Achievement instead. selectedParticipation's own type
    // (LinkedParticipation) already excludes the virtual `id === null` rows
    // a search can return, but this stays an explicit, hard validation
    // failure rather than a fallback, so a future refactor can't
    // accidentally reintroduce the silent-degrade path.
    if (linkMode === 'participation' && !selectedParticipation) {
      setNotice({
        kind: 'error',
        text: 'Выберите участие или переключитесь на вариант «Без ссылки».',
      });
      return;
    }
    setMutationBusy(true);
    setNotice(undefined);
    try {
      await adminApi.createAchievement(selectedPerson.id, {
        personId: selectedPerson.id,
        title,
        achievementType,
        source,
        occurredAt: zonedLocalToIso(occurredAtLocal, MOSCOW_TIMEZONE),
        description: description || null,
        eventId:
          linkMode === 'participation' ? selectedParticipation!.eventId : null,
        participationId:
          linkMode === 'participation' ? selectedParticipation!.id : null,
      });
      setCreating(false);
      await afterMutation('Достижение добавлено.');
    } catch (error) {
      setNotice(activityError(error));
    } finally {
      setMutationBusy(false);
    }
  };

  const beginDecide = (achievementId: string) => {
    setDecidingId(achievementId);
    setDecisionReason('');
  };

  const decide = async (
    achievementId: string,
    status: 'VERIFIED' | 'REJECTED' | 'CANCELLED',
  ) => {
    if (!selectedPerson) return;
    if (decisionReason.trim().length < 3) return;
    setMutationBusy(true);
    setNotice(undefined);
    try {
      await adminApi.decideAchievement(selectedPerson.id, achievementId, {
        status,
        reason: decisionReason.trim(),
      });
      setDecidingId(undefined);
      setDecisionReason('');
      await afterMutation('Решение по достижению сохранено.');
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
        <span>Достижения</span>
      </header>
      <section className="admin-content">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">Activity Core</p>
            <h1>Достижения</h1>
            <p>
              Найдите человека, посмотрите историю его достижений и, при
              необходимости, добавьте новое или примите решение по ожидающему.
            </p>
          </div>
        </header>
        {notice && (
          <p className={`admin-notice ${notice.kind}`} role="status">
            {notice.text}
          </p>
        )}
        <AchievementPanel
          canManage={canManage}
          busy={busy}
          hasSearched={hasSearchedPeople}
          searchResults={personResults}
          selectedPerson={selectedPerson}
          onSearch={(form) => void searchPeople(form)}
          onSelectPerson={(person) => void selectPerson(person)}
          onClearSelection={clearSelection}
          achievements={achievements}
          creating={creating}
          onBeginCreate={beginCreate}
          onCancelCreate={cancelCreate}
          onSubmitCreate={(form) => void submitCreate(form)}
          linkMode={linkMode}
          onLinkModeChange={setLinkMode}
          participationQuery={participationQuery}
          participationResults={participationResults}
          onParticipationSearch={(query) => void searchParticipationsFor(query)}
          selectedParticipation={selectedParticipation}
          onSelectParticipation={setSelectedParticipation}
          decidingId={decidingId}
          decisionReason={decisionReason}
          onDecisionReasonChange={setDecisionReason}
          onDecide={(achievementId, status) => {
            if (decidingId !== achievementId) {
              beginDecide(achievementId);
              return;
            }
            void decide(achievementId, status);
          }}
        />
      </section>
    </main>
  );
};
