import type {
  PersonSummary,
  SessionResponse,
  StudentMembership,
  StudyGroup,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useCallback, useState } from 'react';

import { adminApi } from './admin-api.js';
import { activityError } from './AdminActivity.js';

type Notice = { kind: 'error' | 'success'; text: string };

const MOSCOW_TIMEZONE = 'Europe/Moscow';

const todayMoscow = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: MOSCOW_TIMEZONE }).format(
    new Date(),
  );

// Pure calendar-date arithmetic only (no Date-object time-of-day, no UTC
// conversion of a wall-clock instant) - student_memberships.valid_from/
// valid_to are plain SQL DATE columns, and this mirrors the backend's own
// `effective_from - timedelta(days=1)` exactly, just for display before the
// admin confirms. Using UTC field accessors throughout keeps this
// independent of the browser's own timezone, since there is no time-of-day
// component to be local to in the first place.
const dayBefore = (isoDate: string): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

const formatRu = (isoDate: string): string => {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
};

// Pure so the exact D / D-1 wording can be unit-tested without invoking
// window.confirm or the mutation itself.
export const transferConfirmationText = (
  currentStudyGroup: string,
  targetStudyGroup: string,
  effectiveFrom: string,
  today: string,
): string[] => {
  const closesOn = dayBefore(effectiveFrom);
  const lines = [
    `Перевести из «${currentStudyGroup}» в «${targetStudyGroup}» с ${formatRu(effectiveFrom)}?`,
    `Текущая принадлежность будет завершена ${formatRu(closesOn)}.`,
  ];
  if (effectiveFrom < today) {
    lines.push(
      'Изменение не перепишет уже начисленные баллы и их историческую привязку.',
    );
  }
  return lines;
};

const personFullName = (person: {
  lastName: string;
  firstName: string;
  middleName: string | null;
}) =>
  [person.lastName, person.firstName, person.middleName]
    .filter(Boolean)
    .join(' ');

export const membershipState = (
  membership: StudentMembership,
  today: string,
): 'Текущая' | 'Завершена' | 'Запланирована' => {
  if (membership.validFrom > today) return 'Запланирована';
  if (membership.validTo !== null && membership.validTo < today)
    return 'Завершена';
  return 'Текущая';
};

type Mode = 'idle' | 'create' | 'transfer' | 'close';

export const MembershipPanel = ({
  canManage,
  busy,
  hasSearched,
  searchResults,
  selectedPerson,
  onSearch,
  onSelectPerson,
  onClearSelection,
  memberships,
  studyGroups,
  mode,
  onBeginCreate,
  onBeginTransfer,
  onBeginClose,
  onCancelForm,
  onSubmitCreate,
  onSubmitTransfer,
  onSubmitClose,
}: {
  canManage: boolean;
  busy: boolean;
  hasSearched: boolean;
  searchResults: PersonSummary[];
  selectedPerson: PersonSummary | undefined;
  onSearch: (form: FormData) => void;
  onSelectPerson: (person: PersonSummary) => void;
  onClearSelection: () => void;
  memberships: StudentMembership[];
  studyGroups: StudyGroup[];
  mode: Mode;
  onBeginCreate: () => void;
  onBeginTransfer: () => void;
  onBeginClose: () => void;
  onCancelForm: () => void;
  onSubmitCreate: (form: FormData) => void;
  onSubmitTransfer: (form: FormData) => void;
  onSubmitClose: (form: FormData) => void;
}) => {
  const today = todayMoscow();
  const current = memberships.find((item) => item.validTo === null);
  const activeGroups = studyGroups.filter((group) => group.active);

  return (
    <section className="admin-panel">
      <h2>Учебная принадлежность</h2>
      {!selectedPerson && (
        <>
          <form action={onSearch} className="stack-form">
            <label>
              <span>Найти человека</span>
              <input
                name="query"
                placeholder="ФИО, email, телефон или группа"
              />
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
                  <th>Группа</th>
                  <th>Отделение</th>
                  <th>Курс</th>
                  <th>Действует с</th>
                  <th>Действует по</th>
                  <th>Состояние</th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((item) => (
                  <tr key={item.id}>
                    <td>{item.studyGroup}</td>
                    <td>{item.department ?? '—'}</td>
                    <td>{item.course ?? '—'}</td>
                    <td>{formatRu(item.validFrom)}</td>
                    <td>{item.validTo ? formatRu(item.validTo) : '—'}</td>
                    <td>{membershipState(item, today)}</td>
                  </tr>
                ))}
                {memberships.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      Принадлежность в этой организации не найдена.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {canManage && mode === 'idle' && (
            <div className="row-actions">
              {!current && (
                <Button onClick={onBeginCreate} disabled={busy}>
                  Назначить
                </Button>
              )}
              {current && (
                <>
                  <Button onClick={onBeginTransfer} disabled={busy}>
                    Перевести
                  </Button>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={busy}
                    onClick={onBeginClose}
                  >
                    Завершить
                  </button>
                </>
              )}
            </div>
          )}
          {canManage && mode === 'create' && (
            <form action={onSubmitCreate} className="stack-form">
              <h3>Назначить учебную принадлежность</h3>
              <label>
                <span>Учебная группа</span>
                <select name="studyGroupId" required disabled={busy}>
                  <option value="">Выберите группу…</option>
                  {activeGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} ({group.department.name})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Действует с</span>
                <input name="validFrom" type="date" required disabled={busy} />
              </label>
              <div className="row-actions">
                <Button type="submit" disabled={busy}>
                  Сохранить
                </Button>
                <button
                  type="button"
                  className="text-button"
                  onClick={onCancelForm}
                  disabled={busy}
                >
                  Отмена
                </button>
              </div>
            </form>
          )}
          {canManage && mode === 'transfer' && current && (
            <form action={onSubmitTransfer} className="stack-form">
              <h3>Перевести в другую группу</h3>
              <p>
                Текущая принадлежность: <strong>{current.studyGroup}</strong>
                {' с '}
                {formatRu(current.validFrom)}.
              </p>
              <label>
                <span>Новая учебная группа</span>
                <select name="studyGroupId" required disabled={busy}>
                  <option value="">Выберите группу…</option>
                  {activeGroups
                    .filter((group) => group.id !== current.studyGroupId)
                    .map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name} ({group.department.name})
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>Дата перевода</span>
                <input
                  name="effectiveFrom"
                  type="date"
                  required
                  disabled={busy}
                />
              </label>
              <div className="row-actions">
                <Button type="submit" disabled={busy}>
                  Перевести
                </Button>
                <button
                  type="button"
                  className="text-button"
                  onClick={onCancelForm}
                  disabled={busy}
                >
                  Отмена
                </button>
              </div>
            </form>
          )}
          {canManage && mode === 'close' && current && (
            <form action={onSubmitClose} className="stack-form">
              <h3>Завершить принадлежность к «{current.studyGroup}»</h3>
              <label>
                <span>Действует по (включительно)</span>
                <input
                  name="lastValidOn"
                  type="date"
                  required
                  disabled={busy}
                />
              </label>
              <div className="row-actions">
                <button type="submit" className="danger-button" disabled={busy}>
                  Завершить
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={onCancelForm}
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
};

export const MembershipAdmin = ({
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
  const [memberships, setMemberships] = useState<StudentMembership[]>([]);
  const [studyGroups, setStudyGroups] = useState<StudyGroup[]>([]);
  const [mode, setMode] = useState<Mode>('idle');
  // searchBusy covers person search and switching selection (read-only
  // loads); mutationBusy covers create/transfer/close only. Kept separate so
  // a search never re-enables controls for a mutation still in flight, and a
  // mutation's own canonical refresh (which internally reloads via the same
  // "search" path) never gets raced by an unrelated new search - the Stage
  // 4.1 lesson applied here from the start rather than copied from the
  // shared-busy pattern still used elsewhere in this admin.
  const [searchBusy, setSearchBusy] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const busy = searchBusy || mutationBusy;
  const [notice, setNotice] = useState<Notice>();

  const loadMemberships = useCallback(
    async (personId: string): Promise<boolean> => {
      try {
        setMemberships((await adminApi.memberships(personId)).items);
        return true;
      } catch (error) {
        setNotice(activityError(error));
        return false;
      }
    },
    [],
  );

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
    setMode('idle');
    setSearchBusy(true);
    setNotice(undefined);
    try {
      const [membershipResult, groupResult] = await Promise.all([
        adminApi.memberships(person.id),
        adminApi.studyGroups(true),
      ]);
      setMemberships(membershipResult.items);
      setStudyGroups(groupResult.items);
    } catch (error) {
      setNotice(activityError(error));
    } finally {
      setSearchBusy(false);
    }
  };

  const clearSelection = () => {
    setSelectedPerson(undefined);
    setMemberships([]);
    setStudyGroups([]);
    setMode('idle');
  };

  const cancelForm = () => {
    setMode('idle');
    setNotice(undefined);
  };

  // Same contract as every other admin screen this session: the mutation
  // already committed by the time this runs, so a failed refresh reads as
  // "saved, but the screen may be stale" - never as "the action failed".
  const afterMutation = async (successText: string) => {
    if (!selectedPerson) return;
    const refreshed = await loadMemberships(selectedPerson.id);
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
    const studyGroupId = String(form.get('studyGroupId') ?? '');
    const validFrom = String(form.get('validFrom') ?? '');
    if (!studyGroupId || !validFrom) return;
    setMutationBusy(true);
    setNotice(undefined);
    try {
      await adminApi.createMembership(selectedPerson.id, {
        studyGroupId,
        validFrom,
        validTo: null,
      });
      setMode('idle');
      await afterMutation('Принадлежность назначена.');
    } catch (error) {
      setNotice(activityError(error));
    } finally {
      setMutationBusy(false);
    }
  };

  const submitTransfer = async (form: FormData) => {
    if (!selectedPerson) return;
    const studyGroupId = String(form.get('studyGroupId') ?? '');
    const effectiveFrom = String(form.get('effectiveFrom') ?? '');
    if (!studyGroupId || !effectiveFrom) return;
    const target = studyGroups.find((group) => group.id === studyGroupId);
    const current = memberships.find((item) => item.validTo === null);
    if (!target || !current) return;
    const confirmationLines = transferConfirmationText(
      current.studyGroup,
      target.name,
      effectiveFrom,
      todayMoscow(),
    );
    if (!window.confirm(confirmationLines.join('\n'))) return;
    setMutationBusy(true);
    setNotice(undefined);
    try {
      await adminApi.transferMembership(selectedPerson.id, {
        studyGroupId,
        effectiveFrom,
      });
      setMode('idle');
      await afterMutation('Перевод сохранён.');
    } catch (error) {
      setNotice(activityError(error));
    } finally {
      setMutationBusy(false);
    }
  };

  const submitClose = async (form: FormData) => {
    if (!selectedPerson) return;
    const lastValidOn = String(form.get('lastValidOn') ?? '');
    if (!lastValidOn) return;
    const current = memberships.find((item) => item.validTo === null);
    if (!current) return;
    if (
      !window.confirm(
        `Завершить принадлежность к «${current.studyGroup}» по ${formatRu(lastValidOn)} включительно?`,
      )
    )
      return;
    setMutationBusy(true);
    setNotice(undefined);
    try {
      await adminApi.closeMembership(selectedPerson.id, { lastValidOn });
      setMode('idle');
      await afterMutation('Принадлежность завершена.');
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
        <span>Учебная принадлежность</span>
      </header>
      <section className="admin-content">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">Activity Core</p>
            <h1>Учебная принадлежность</h1>
            <p>
              Найдите человека, посмотрите историю его учебной группы и, при
              необходимости, назначьте, переведите или завершите принадлежность.
            </p>
          </div>
        </header>
        {notice && (
          <p className={`admin-notice ${notice.kind}`} role="status">
            {notice.text}
          </p>
        )}
        <MembershipPanel
          canManage={canManage}
          busy={busy}
          hasSearched={hasSearchedPeople}
          searchResults={personResults}
          selectedPerson={selectedPerson}
          onSearch={(form) => void searchPeople(form)}
          onSelectPerson={(person) => void selectPerson(person)}
          onClearSelection={clearSelection}
          memberships={memberships}
          studyGroups={studyGroups}
          mode={mode}
          onBeginCreate={() => setMode('create')}
          onBeginTransfer={() => setMode('transfer')}
          onBeginClose={() => setMode('close')}
          onCancelForm={cancelForm}
          onSubmitCreate={(form) => void submitCreate(form)}
          onSubmitTransfer={(form) => void submitTransfer(form)}
          onSubmitClose={(form) => void submitClose(form)}
        />
      </section>
    </main>
  );
};
