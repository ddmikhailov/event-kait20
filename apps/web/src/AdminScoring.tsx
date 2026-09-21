import type {
  ActivityReference,
  AssignScoringPolicy,
  NewcomerTierValue,
  PersonActivityParticipation,
  PersonStatusAssignment,
  PersonSummary,
  PolicyVersion,
  PolicyVersionDetail,
  PolicyVersionValues,
  Season,
  ScoringComponentValue,
  ScoringPolicy,
  ScoringPreviewResponse,
  SessionResponse,
  StatusAssignment,
  StatusTypeReference,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';
import { zonedLocalToIso } from './admin-values.js';

const MOSCOW_TIMEZONE = 'Europe/Moscow';

const formatMoscow = (isoInstant: string): string =>
  `${new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TIMEZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoInstant))} (МСК)`;

type Notice = { kind: 'error' | 'success'; text: string };

type EditorMode = 'create' | 'existing';

const emptyValues = (): PolicyVersionValues => ({
  roleBases: [],
  levelMultipliers: [],
  statusMultipliers: [],
  newcomerTiers: [{ sequenceFrom: 1, sequenceTo: null, value: '1.0000' }],
  resultBonuses: [],
});

const detailToValues = (detail: PolicyVersionDetail): PolicyVersionValues => ({
  roleBases: detail.roleBases,
  levelMultipliers: detail.levelMultipliers,
  statusMultipliers: detail.statusMultipliers,
  newcomerTiers: detail.newcomerTiers,
  resultBonuses: detail.resultBonuses,
});

const versionStatusLabel = (status: PolicyVersion['status']) =>
  ({
    DRAFT: 'Черновик',
    PUBLISHED: 'Опубликована',
    RETIRED: 'Завершена',
    CANCELLED: 'Отменена',
  })[status];

const scoringAdminError = (error: unknown): Notice => {
  if (error instanceof AdminApiError) {
    const messages: Record<string, string> = {
      SCORING_POLICY_CONFLICT: 'Политика с таким кодом уже существует.',
      SCORING_POLICY_INVALID:
        'Черновик не готов к публикации: проверьте компоненты и уровни новичка.',
      SCORING_POLICY_VERSION_IMMUTABLE:
        'Эта версия больше не редактируется — создайте новый черновик.',
      SCORING_POLICY_PERIOD_CONFLICT:
        'Период действия пересекается с другой версией этой политики.',
      SCORING_POLICY_RETROACTIVE_CONFLICT:
        'Нельзя завершить версию — по ней уже начислены баллы за более поздние мероприятия.',
      SCORING_POLICY_AMBIGUOUS:
        'Для этого периода действуют несколько версий политики одновременно.',
      SCORING_POLICY_VERSION_NOT_FOUND: 'Версия политики не найдена.',
      SCORING_POLICY_NOT_FOUND: 'Политика не найдена.',
      SCORING_POLICY_NOT_PUBLISHED:
        'У выбранной системы начисления нет опубликованной версии, действующей с указанной даты.',
      SEASON_NOT_FOUND: 'Сезон не найден.',
      SEASON_SCORING_POLICY_LOCKED:
        'Систему начисления для этого сезона нельзя изменить: по ней уже есть начисленные баллы.',
      SEASON_SCORING_POLICY_RETROACTIVE_CONFLICT:
        'Нельзя изменить систему начисления задним числом: в этом периоде уже есть рассчитанные активности.',
      PERSON_NOT_FOUND: 'Человек не найден.',
      INVALID_REFERENCE: 'Этот тип статуса недоступен.',
      PERSON_STATUS_PERIOD_CONFLICT:
        'Период пересекается с уже существующим статусом такого же типа у этого человека.',
      PERSON_STATUS_NOT_FOUND: 'Запись о статусе не найдена.',
    };
    return { kind: 'error', text: messages[error.code] ?? error.message };
  }
  return { kind: 'error', text: 'Не удалось выполнить действие.' };
};

const ComponentRows = ({
  label,
  items,
  options,
  editable,
  onChange,
}: {
  label: string;
  items: ScoringComponentValue[];
  options: (ActivityReference | StatusTypeReference)[];
  editable: boolean;
  onChange: (items: ScoringComponentValue[]) => void;
}) => {
  const labelFor = (classifierId: string) =>
    options.find((option) => option.id === classifierId)?.name ?? classifierId;

  return (
    <div className="admin-panel">
      <h3>{label}</h3>
      <div className="participant-table-wrap">
        <table className="participant-table">
          <thead>
            <tr>
              <th>Классификатор</th>
              <th>Значение</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.classifierId}-${index}`}>
                <td>{labelFor(item.classifierId)}</td>
                <td>
                  {editable ? (
                    <input
                      value={item.value}
                      onChange={(event) =>
                        onChange(
                          items.map((row, i) =>
                            i === index
                              ? { ...row, value: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  ) : (
                    item.value
                  )}
                </td>
                {editable && (
                  <td>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        onChange(items.filter((_, i) => i !== index))
                      }
                    >
                      Удалить
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={editable ? 3 : 2}>Не задано.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editable && (
        <form
          className="stack-form"
          action={(form) => {
            const classifierId = String(form.get('classifierId') ?? '');
            const value = String(form.get('value') ?? '').trim();
            if (!classifierId || !value) return;
            if (items.some((item) => item.classifierId === classifierId))
              return;
            onChange([...items, { classifierId, value }]);
          }}
        >
          <label>
            <span>Добавить</span>
            <select name="classifierId" required defaultValue="">
              <option value="" disabled>
                Выберите классификатор
              </option>
              {options
                .filter((option) => option.active)
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Значение</span>
            <input name="value" placeholder="1.0000" required />
          </label>
          <Button type="submit">Добавить строку</Button>
        </form>
      )}
    </div>
  );
};

const TierRows = ({
  items,
  editable,
  onChange,
}: {
  items: NewcomerTierValue[];
  editable: boolean;
  onChange: (items: NewcomerTierValue[]) => void;
}) => (
  <div className="admin-panel">
    <h3>Уровни новичка (по порядковому номеру участия)</h3>
    <div className="participant-table-wrap">
      <table className="participant-table">
        <thead>
          <tr>
            <th>От</th>
            <th>До (пусто = бесконечность)</th>
            <th>Множитель</th>
            {editable && <th />}
          </tr>
        </thead>
        <tbody>
          {items
            .slice()
            .sort((a, b) => a.sequenceFrom - b.sequenceFrom)
            .map((item, index) => (
              <tr key={`${item.sequenceFrom}-${index}`}>
                <td>{item.sequenceFrom}</td>
                <td>{item.sequenceTo ?? '∞'}</td>
                <td>
                  {editable ? (
                    <input
                      value={item.value}
                      onChange={(event) =>
                        onChange(
                          items.map((row) =>
                            row.sequenceFrom === item.sequenceFrom
                              ? { ...row, value: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  ) : (
                    item.value
                  )}
                </td>
                {editable && (
                  <td>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        onChange(
                          items.filter(
                            (row) => row.sequenceFrom !== item.sequenceFrom,
                          ),
                        )
                      }
                    >
                      Удалить
                    </button>
                  </td>
                )}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
    {editable && (
      <form
        className="stack-form"
        action={(form) => {
          const sequenceFrom = Number(form.get('sequenceFrom'));
          const sequenceToRaw = String(form.get('sequenceTo') ?? '').trim();
          const value = String(form.get('value') ?? '').trim();
          if (!sequenceFrom || !value) return;
          if (items.some((item) => item.sequenceFrom === sequenceFrom)) return;
          onChange([
            ...items,
            {
              sequenceFrom,
              sequenceTo: sequenceToRaw ? Number(sequenceToRaw) : null,
              value,
            },
          ]);
        }}
      >
        <label>
          <span>От (номер участия)</span>
          <input name="sequenceFrom" type="number" min="1" required />
        </label>
        <label>
          <span>До (пусто = бесконечность)</span>
          <input name="sequenceTo" type="number" min="1" />
        </label>
        <label>
          <span>Множитель</span>
          <input name="value" placeholder="1.0000" required />
        </label>
        <Button type="submit">Добавить уровень</Button>
      </form>
    )}
  </div>
);

export const VersionEditor = ({
  policyId,
  mode,
  version,
  references,
  canManage,
  onSaved,
  onCancel,
}: {
  policyId: string;
  mode: EditorMode;
  version?: PolicyVersionDetail | undefined;
  references: {
    roles: ActivityReference[];
    levels: ActivityReference[];
    results: ActivityReference[];
    statusTypes: StatusTypeReference[];
  };
  canManage: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) => {
  const [values, setValues] = useState<PolicyVersionValues>(
    version ? detailToValues(version) : emptyValues(),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const editable =
    canManage && (mode === 'create' || version?.status === 'DRAFT');

  const save = async () => {
    setBusy(true);
    setNotice(undefined);
    try {
      if (mode === 'create') {
        await adminApi.createScoringPolicyVersion(policyId, values);
      } else if (mode === 'existing' && version) {
        await adminApi.updateScoringPolicyVersion(version.id, values);
      }
      onSaved();
    } catch (error) {
      setNotice(scoringAdminError(error));
    } finally {
      setBusy(false);
    }
  };

  const publish = async (form: FormData) => {
    if (!version) return;
    setBusy(true);
    setNotice(undefined);
    try {
      // Policy version effective boundaries are historical scoring
      // boundaries and must be interpreted as Europe/Moscow wall-clock time
      // regardless of the admin's browser timezone — same reasoning and
      // same helper as Season policy activation (Stage 3.1).
      const effectiveFrom = zonedLocalToIso(
        String(form.get('effectiveFrom')),
        MOSCOW_TIMEZONE,
      );
      const effectiveToRaw = String(form.get('effectiveTo') ?? '').trim();
      await adminApi.publishScoringPolicyVersion(version.id, {
        effectiveFrom,
        effectiveTo: effectiveToRaw
          ? zonedLocalToIso(effectiveToRaw, MOSCOW_TIMEZONE)
          : null,
      });
      onSaved();
    } catch (error) {
      setNotice(scoringAdminError(error));
    } finally {
      setBusy(false);
    }
  };

  const retire = async () => {
    if (!version) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await adminApi.retireScoringPolicyVersion(version.id);
      onSaved();
    } catch (error) {
      setNotice(scoringAdminError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-panel">
      <header className="admin-editor-header">
        <button type="button" className="text-button" onClick={onCancel}>
          ← Версии
        </button>
        <span>
          {mode === 'create'
            ? 'Новая версия (черновик)'
            : `Версия ${version?.version ?? ''} · ${
                version ? versionStatusLabel(version.status) : ''
              }`}
        </span>
      </header>
      {notice && (
        <p className={`admin-notice ${notice.kind}`} role="status">
          {notice.text}
        </p>
      )}
      <ComponentRows
        label="Базовые баллы по роли"
        items={values.roleBases}
        options={references.roles}
        editable={editable}
        onChange={(roleBases) => setValues({ ...values, roleBases })}
      />
      <ComponentRows
        label="Множитель уровня мероприятия"
        items={values.levelMultipliers}
        options={references.levels}
        editable={editable}
        onChange={(levelMultipliers) =>
          setValues({ ...values, levelMultipliers })
        }
      />
      <ComponentRows
        label="Множитель статуса участника"
        items={values.statusMultipliers}
        options={references.statusTypes}
        editable={editable}
        onChange={(statusMultipliers) =>
          setValues({ ...values, statusMultipliers })
        }
      />
      <TierRows
        items={values.newcomerTiers}
        editable={editable}
        onChange={(newcomerTiers) => setValues({ ...values, newcomerTiers })}
      />
      <ComponentRows
        label="Бонус за результат"
        items={values.resultBonuses}
        options={references.results}
        editable={editable}
        onChange={(resultBonuses) => setValues({ ...values, resultBonuses })}
      />
      {editable && (
        <Button onClick={() => void save()} disabled={busy}>
          {mode === 'create' ? 'Создать черновик' : 'Сохранить черновик'}
        </Button>
      )}
      {canManage && mode === 'existing' && version?.status === 'DRAFT' && (
        <form action={(form) => void publish(form)} className="stack-form">
          <h3>Опубликовать</h3>
          <label>
            <span>Начало действия (МСК)</span>
            <input name="effectiveFrom" type="datetime-local" required />
          </label>
          <label>
            <span>Окончание действия (МСК, необязательно)</span>
            <input name="effectiveTo" type="datetime-local" />
          </label>
          <Button type="submit" disabled={busy}>
            Опубликовать версию
          </Button>
        </form>
      )}
      {canManage && mode === 'existing' && version?.status === 'PUBLISHED' && (
        <Button onClick={() => void retire()} disabled={busy}>
          Завершить версию
        </Button>
      )}
    </section>
  );
};

export const SeasonScoringPanel = ({
  seasons,
  policies,
  publishablePolicyIds,
  canManage,
  busy,
  assigningSeasonId,
  onBegin,
  onCancel,
  onSubmit,
}: {
  seasons: Season[];
  policies: ScoringPolicy[];
  publishablePolicyIds: Set<string>;
  canManage: boolean;
  busy: boolean;
  assigningSeasonId: string | undefined;
  onBegin: (season: Season) => void;
  onCancel: () => void;
  onSubmit: (season: Season, form: FormData) => void;
}) => (
  <section className="admin-panel">
    <h2>Сезоны · активная система начисления баллов</h2>
    <div className="participant-table-wrap">
      <table className="participant-table">
        <thead>
          <tr>
            <th>Сезон</th>
            <th>Период</th>
            <th>Активная система</th>
            <th>Действует с</th>
            {canManage && <th>Действие</th>}
          </tr>
        </thead>
        <tbody>
          {seasons.map((season) => {
            const assignedPolicy = season.scoringPolicyId
              ? policies.find((item) => item.id === season.scoringPolicyId)
              : undefined;
            const assigning = assigningSeasonId === season.id;
            return (
              <Fragment key={season.id}>
                <tr>
                  <td>
                    <strong>{season.name}</strong>
                    {season.active ? '' : ' · неактивен'}
                  </td>
                  <td>
                    {season.startsAt} – {season.endsAt}
                  </td>
                  <td>
                    {assignedPolicy
                      ? `${assignedPolicy.name}${
                          assignedPolicy.active ? '' : ' · неактивна'
                        }`
                      : 'Не назначена'}
                  </td>
                  <td>{season.scoringPolicyEffectiveFrom ?? '—'}</td>
                  {canManage && (
                    <td>
                      {!assigning && (
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() => onBegin(season)}
                        >
                          {assignedPolicy ? 'Изменить' : 'Назначить'}
                        </button>
                      )}
                      {assigning && (
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={onCancel}
                        >
                          Отмена
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                {assigning && (
                  <tr>
                    <td colSpan={canManage ? 5 : 4}>
                      {publishablePolicyIds.size === 0 ? (
                        <p className="admin-notice">
                          Нет опубликованных систем начисления баллов. Сначала
                          опубликуйте версию в разделе «Политики» слева.
                        </p>
                      ) : (
                        <form
                          action={(form) => onSubmit(season, form)}
                          className="stack-form"
                        >
                          <label>
                            <span>Система начисления баллов</span>
                            <select name="scoringPolicyId" required>
                              <option value="">Выберите систему…</option>
                              {policies
                                .filter((policy) =>
                                  publishablePolicyIds.has(policy.id),
                                )
                                .map((policy) => (
                                  <option key={policy.id} value={policy.id}>
                                    {policy.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            <span>Действует с (МСК)</span>
                            <input
                              name="effectiveFrom"
                              type="datetime-local"
                              required
                            />
                          </label>
                          <Button type="submit" disabled={busy}>
                            {assignedPolicy ? 'Сменить систему' : 'Назначить'}
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {seasons.length === 0 && (
            <tr>
              <td colSpan={canManage ? 5 : 4}>Сезонов пока нет.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </section>
);

const personFullName = (person: {
  lastName: string;
  firstName: string;
  middleName: string | null;
}) =>
  [person.lastName, person.firstName, person.middleName]
    .filter(Boolean)
    .join(' ');

const todayMoscow = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: MOSCOW_TIMEZONE }).format(
    new Date(),
  );

// Mirrors the backend's own eligibility check exactly (scoring_v2.py:195-197):
//   valid_from<=event_date
//   AND (valid_to IS NULL OR valid_to>=event_date)                  -- inclusive
//   AND (retired_effective_on IS NULL OR retired_effective_on>event_date)  -- exclusive
// validTo and retiredEffectiveOn are NOT the same kind of boundary: validTo
// is the last day the status still counts (inclusive), while
// retiredEffectiveOn is the first day it no longer counts (exclusive) — a
// status retired "today" still counts today, matching
// _status_retirement_boundary's today+1 default. Collapsing the two into one
// `endsOn <= today` check (as an earlier version of this helper did) is
// wrong for validTo specifically: it would mark a status ended one day too
// early.
export const statusState = (
  status: PersonStatusAssignment,
  today: string,
): 'Активен' | 'Завершён' | null => {
  if (status.validFrom > today) return null;
  if (status.retiredEffectiveOn !== null && status.retiredEffectiveOn <= today)
    return 'Завершён';
  if (status.validTo !== null && status.validTo < today) return 'Завершён';
  return 'Активен';
};

export const PersonStatusPanel = ({
  statusTypes,
  canManage,
  busy,
  hasSearched,
  searchResults,
  selectedPerson,
  onSearch,
  onSelectPerson,
  onClearSelection,
  statuses,
  assigning,
  onBeginAssign,
  onCancelAssign,
  onSubmitAssign,
  onRetire,
}: {
  statusTypes: StatusTypeReference[];
  canManage: boolean;
  busy: boolean;
  hasSearched: boolean;
  searchResults: PersonSummary[];
  selectedPerson: PersonSummary | undefined;
  onSearch: (form: FormData) => void;
  onSelectPerson: (person: PersonSummary) => void;
  onClearSelection: () => void;
  statuses: PersonStatusAssignment[];
  assigning: boolean;
  onBeginAssign: () => void;
  onCancelAssign: () => void;
  onSubmitAssign: (form: FormData) => void;
  onRetire: (status: PersonStatusAssignment) => void;
}) => {
  const today = todayMoscow();
  const activeStatusTypes = statusTypes.filter((type) => type.active);
  return (
    <section className="admin-panel">
      <h2>Статусы</h2>
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
            >
              Выбрать другого человека
            </button>
          </p>
          <div className="participant-table-wrap">
            <table className="participant-table">
              <thead>
                <tr>
                  <th>Тип статуса</th>
                  <th>Действует с</th>
                  <th>Действует до</th>
                  <th>Состояние</th>
                  {canManage && <th>Действие</th>}
                </tr>
              </thead>
              <tbody>
                {statuses.map((status) => {
                  const state = statusState(status, today);
                  return (
                    <tr key={status.id}>
                      <td>{status.name}</td>
                      <td>{status.validFrom}</td>
                      <td>{status.validTo ?? '—'}</td>
                      <td>{state ?? '—'}</td>
                      {canManage && (
                        <td>
                          {!status.retiredAt && (
                            <button
                              type="button"
                              className="text-button danger-text"
                              disabled={busy}
                              onClick={() => onRetire(status)}
                            >
                              Завершить
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {statuses.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 5 : 4}>Статусов пока нет.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {canManage && !assigning && (
            <Button onClick={onBeginAssign} disabled={busy}>
              Добавить статус
            </Button>
          )}
          {canManage && assigning && activeStatusTypes.length === 0 && (
            <p className="admin-notice">
              Нет доступных типов статуса. Обратитесь к администратору
              справочников.
            </p>
          )}
          {canManage && assigning && activeStatusTypes.length > 0 && (
            <form action={onSubmitAssign} className="stack-form">
              <label>
                <span>Тип статуса</span>
                <select name="statusTypeId" required>
                  <option value="">Выберите тип статуса…</option>
                  {activeStatusTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Действует с</span>
                <input name="validFrom" type="date" required />
              </label>
              <label>
                <span>Действует до (необязательно)</span>
                <input name="validTo" type="date" />
              </label>
              <div className="row-actions">
                <Button type="submit" disabled={busy}>
                  Сохранить
                </Button>
                <button
                  type="button"
                  className="text-button"
                  onClick={onCancelAssign}
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

const formatPoints = (value: string): string => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : value;
};

const participationStatusLabel = (
  status: PersonActivityParticipation['status'],
) =>
  ({
    DRAFT: 'Черновик',
    CONFIRMED: 'Подтверждено',
    CANCELLED: 'Отменено',
  })[status];

const scoringStateLabel = (
  state: PersonActivityParticipation['scoringState'],
) =>
  ({
    NOT_SCORED: 'Не рассчитано',
    AWARDED: 'Начислено',
    NO_RULE: 'Правило не найдено',
    REVERSED: 'Отменено (реверс)',
  })[state];

// The actual codes `POST .../preview` raises (scoring_v2.py) — this is the
// diagnostic explanation shown in place of a score, not a page-level error
// notice: a missing rule is an expected, explainable outcome here, not a
// failure of the Simulator itself.
const previewExplanation = (error: unknown): string => {
  if (error instanceof AdminApiError) {
    const explanations: Record<string, string> = {
      PARTICIPATION_NOT_FOUND: 'Участие не найдено.',
      SCORING_ENGINE_V1:
        'Это мероприятие ещё не переведено на новую систему начисления баллов.',
      SCORING_POLICY_NOT_ASSIGNED:
        'Сезону не назначена система начисления баллов.',
      SCORING_POLICY_AMBIGUOUS:
        'Для этой даты действуют одновременно несколько версий политики — исправьте периоды действия версий.',
      SCORING_COMPONENT_MISSING:
        'Для выбранной комбинации правило начисления не настроено.',
    };
    return explanations[error.code] ?? error.message;
  }
  return 'Не удалось выполнить расчёт.';
};

type PreviewOutcome =
  | { kind: 'result'; response: ScoringPreviewResponse }
  | { kind: 'explanation'; text: string };

export const SimulatorPanel = ({
  busy,
  hasSearched,
  searchResults,
  selectedPerson,
  onSearch,
  onSelectPerson,
  onClearSelection,
  participations,
  selectedParticipationId,
  onSelectParticipation,
  onCalculate,
  outcome,
}: {
  busy: boolean;
  hasSearched: boolean;
  searchResults: PersonSummary[];
  selectedPerson: PersonSummary | undefined;
  onSearch: (form: FormData) => void;
  onSelectPerson: (person: PersonSummary) => void;
  onClearSelection: () => void;
  participations: PersonActivityParticipation[];
  selectedParticipationId: string | undefined;
  onSelectParticipation: (participation: PersonActivityParticipation) => void;
  onCalculate: () => void;
  outcome: PreviewOutcome | undefined;
}) => (
  <section className="admin-panel">
    <h2>Симулятор</h2>
    <p>
      Показывает, сколько баллов начислил бы реальный движок за конкретное
      участие, не сохраняя результат.
    </p>
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
          >
            Выбрать другого человека
          </button>
        </p>
        <div className="participant-table-wrap">
          <table className="participant-table">
            <thead>
              <tr>
                <th>Мероприятие</th>
                <th>Дата</th>
                <th>Роль</th>
                <th>Результат</th>
                <th>Состояние</th>
                <th>Баллы</th>
              </tr>
            </thead>
            <tbody>
              {participations.map((participation) => (
                <tr key={participation.id}>
                  <td>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onSelectParticipation(participation)}
                    >
                      {participation.id === selectedParticipationId ? '● ' : ''}
                      {participation.eventTitle}
                    </button>
                  </td>
                  <td>{participation.eventStartAt}</td>
                  <td>{participation.role?.name ?? 'Не назначена'}</td>
                  <td>{participation.result?.name ?? '—'}</td>
                  <td>
                    {participationStatusLabel(participation.status)} ·{' '}
                    {scoringStateLabel(participation.scoringState)}
                  </td>
                  <td>{formatPoints(participation.points)}</td>
                </tr>
              ))}
              {participations.length === 0 && (
                <tr>
                  <td colSpan={6}>У этого человека пока нет участий.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Button
          onClick={onCalculate}
          disabled={busy || !selectedParticipationId}
        >
          Рассчитать
        </Button>
        {outcome?.kind === 'explanation' && (
          <p className="admin-notice">{outcome.text}</p>
        )}
        {outcome?.kind === 'result' && (
          <div className="admin-panel">
            <h3>Результат: {formatPoints(outcome.response.points)} баллов</h3>
            <p>
              Версия политики:{' '}
              {versionStatusLabel(outcome.response.policyVersionStatus)}
            </p>
            <ul className="activity-list">
              <li>
                Базовые баллы за роль «{outcome.response.calculation.role.name}
                »: {outcome.response.calculation.role.value}
              </li>
              <li>
                Множитель уровня «{outcome.response.calculation.level.name}»:{' '}
                {outcome.response.calculation.level.value}
              </li>
              {outcome.response.calculation.statuses.map((status) => (
                <li key={status.id}>
                  Статус «{status.name}»: ×{status.value}
                </li>
              ))}
              <li>
                Порядковое участие:{' '}
                {outcome.response.calculation.newcomer.sequence} (×
                {outcome.response.calculation.newcomer.value})
              </li>
              <li>
                Промежуточный итог (до бонуса):{' '}
                {outcome.response.calculation.multiplicativeSubtotal}
              </li>
              <li>
                Результат «
                {outcome.response.calculation.result?.name ?? 'не выбран'}»,
                бонус: {outcome.response.calculation.resultBonus}
              </li>
              <li>
                <strong>
                  Итого: {outcome.response.calculation.finalPoints}
                </strong>
              </li>
            </ul>
          </div>
        )}
      </>
    )}
  </section>
);

export const ScoringAdmin = ({
  role,
  onBack,
}: {
  role: SessionResponse['user']['role'];
  onBack: () => void;
}) => {
  const canManage = role === 'SUPER_ADMIN';
  const [policies, setPolicies] = useState<ScoringPolicy[]>([]);
  const [roles, setRoles] = useState<ActivityReference[]>([]);
  const [levels, setLevels] = useState<ActivityReference[]>([]);
  const [results, setResults] = useState<ActivityReference[]>([]);
  const [statusTypes, setStatusTypes] = useState<StatusTypeReference[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [publishablePolicyIds, setPublishablePolicyIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedPolicy, setSelectedPolicy] = useState<ScoringPolicy>();
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [editing, setEditing] = useState<{
    mode: EditorMode;
    version?: PolicyVersionDetail;
  }>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  // Returns whether the refresh actually landed. Every fetch (including the
  // per-policy version lookups) must succeed before ANY state is committed —
  // otherwise a failure partway through could leave e.g. seasons updated
  // while publishablePolicyIds is stale, a partially-refreshed UI that looks
  // consistent but isn't. Callers that follow a mutation (e.g. assigning a
  // Season's policy) must check this return value: the mutation itself may
  // have already committed on the backend even if this refresh then fails,
  // so a `false` here is not the same thing as the mutation failing.
  const loadReferences = useCallback(async (): Promise<boolean> => {
    try {
      const [
        policyList,
        roleList,
        levelList,
        resultList,
        statusList,
        seasonList,
      ] = await Promise.all([
        adminApi.scoringPolicies(),
        adminApi.activityRoles(),
        adminApi.activityLevels(),
        adminApi.activityResults(),
        adminApi.scoringStatusTypes(),
        adminApi.seasons(),
      ]);
      // A policy is offered for Season activation only once it has at least
      // one published version — matches what assign_policy actually accepts
      // (it still authoritatively re-checks the chosen effective date
      // server-side; this is a coarser client-side filter for UX only).
      const publishableIds = await Promise.all(
        policyList.items.map(async (policy) => {
          const versionList = await adminApi.scoringPolicyVersions(policy.id);
          return versionList.items.some(
            (version) => version.status === 'PUBLISHED',
          )
            ? policy.id
            : undefined;
        }),
      );
      setPolicies(policyList.items);
      setRoles(roleList.items);
      setLevels(levelList.items);
      setResults(resultList.items);
      setStatusTypes(statusList.items);
      setSeasons(seasonList.items);
      setPublishablePolicyIds(
        new Set(publishableIds.filter((id): id is string => id !== undefined)),
      );
      return true;
    } catch (error) {
      setNotice(scoringAdminError(error));
      return false;
    }
  }, []);

  useEffect(() => void loadReferences(), [loadReferences]);

  const loadVersions = useCallback(async (policy: ScoringPolicy) => {
    setBusy(true);
    try {
      setVersions((await adminApi.scoringPolicyVersions(policy.id)).items);
    } catch (error) {
      setNotice(scoringAdminError(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const openPolicy = async (policy: ScoringPolicy) => {
    setSelectedPolicy(policy);
    setEditing(undefined);
    await loadVersions(policy);
  };

  const createPolicy = async (form: FormData) => {
    setBusy(true);
    setNotice(undefined);
    try {
      await adminApi.createScoringPolicy({
        code: String(form.get('code') ?? '')
          .trim()
          .toUpperCase(),
        name: String(form.get('name') ?? '').trim(),
      });
      // Same contract as loadReferences elsewhere in this file: the create
      // already committed by this point, so a failed refresh must not be
      // reported (or silently swallowed) as either "creation failed" or an
      // unqualified "creation succeeded".
      const refreshed = await loadReferences();
      setNotice(
        refreshed
          ? { kind: 'success', text: 'Политика создана.' }
          : {
              kind: 'error',
              text: 'Политика создана, но не удалось обновить данные на экране. Обновите страницу.',
            },
      );
    } catch (error) {
      setNotice(scoringAdminError(error));
    } finally {
      setBusy(false);
    }
  };

  const openVersion = async (version: PolicyVersion) => {
    setBusy(true);
    try {
      const detail = await adminApi.scoringPolicyVersion(version.id);
      setEditing({ mode: 'existing', version: detail });
    } catch (error) {
      setNotice(scoringAdminError(error));
    } finally {
      setBusy(false);
    }
  };

  const [assigningSeasonId, setAssigningSeasonId] = useState<string>();

  const beginSeasonAssignment = (season: Season) => {
    setAssigningSeasonId(season.id);
    setNotice(undefined);
  };

  const cancelSeasonAssignment = () => setAssigningSeasonId(undefined);

  const assignSeasonPolicy = async (season: Season, form: FormData) => {
    const scoringPolicyId = String(form.get('scoringPolicyId') ?? '');
    const effectiveFromRaw = String(form.get('effectiveFrom') ?? '');
    if (!scoringPolicyId || !effectiveFromRaw) return;
    const policy = policies.find((item) => item.id === scoringPolicyId);
    if (!policy) return;
    // The admin enters a Moscow wall-clock time regardless of the browser's
    // own timezone — zonedLocalToIso resolves it against the Europe/Moscow
    // IANA zone (DST-correct), never the machine's local offset.
    const effectiveFrom = zonedLocalToIso(effectiveFromRaw, MOSCOW_TIMEZONE);
    if (season.scoringPolicyId) {
      const current = policies.find(
        (item) => item.id === season.scoringPolicyId,
      );
      const confirmed = window.confirm(
        `Сменить систему начисления баллов для сезона «${season.name}»?\n\n` +
          `Было: ${current?.name ?? 'не назначена'}\n` +
          `Станет: ${policy.name}\n` +
          `Действует с: ${formatMoscow(effectiveFrom)}`,
      );
      if (!confirmed) return;
    }
    const values: AssignScoringPolicy = { scoringPolicyId, effectiveFrom };
    setBusy(true);
    setNotice(undefined);
    try {
      await adminApi.assignSeasonScoringPolicy(season.id, values);
      setAssigningSeasonId(undefined);
      // The assignment is already committed on the backend at this point.
      // A failed refresh here is a display problem, not an assignment
      // failure — it must not be reported (or silently swallowed) as either
      // "assignment failed" or an unqualified "assignment succeeded".
      const refreshed = await loadReferences();
      setNotice(
        refreshed
          ? {
              kind: 'success',
              text: `Система начисления баллов назначена сезону «${season.name}».`,
            }
          : {
              kind: 'error',
              text: 'Система назначена, но не удалось обновить данные на экране. Обновите страницу.',
            },
      );
    } catch (error) {
      setNotice(scoringAdminError(error));
    } finally {
      setBusy(false);
    }
  };

  const [personResults, setPersonResults] = useState<PersonSummary[]>([]);
  const [hasSearchedPeople, setHasSearchedPeople] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<PersonSummary>();
  const [personStatuses, setPersonStatuses] = useState<
    PersonStatusAssignment[]
  >([]);
  const [assigningStatus, setAssigningStatus] = useState(false);

  const searchPeople = async (form: FormData) => {
    const query = String(form.get('query') ?? '').trim();
    setBusy(true);
    setNotice(undefined);
    try {
      setPersonResults((await adminApi.people(query)).items);
      setHasSearchedPeople(true);
    } catch (error) {
      setNotice(scoringAdminError(error));
    } finally {
      setBusy(false);
    }
  };

  // Same success/failure contract as loadReferences (§Season): the boolean
  // return lets a caller distinguish "the mutation committed but this
  // specific refresh failed" from an actual failure to mutate.
  const loadPersonStatuses = useCallback(
    async (personId: string): Promise<boolean> => {
      try {
        setPersonStatuses((await adminApi.personStatuses(personId)).items);
        return true;
      } catch (error) {
        setNotice(scoringAdminError(error));
        return false;
      }
    },
    [],
  );

  const selectPerson = async (person: PersonSummary) => {
    setSelectedPerson(person);
    setAssigningStatus(false);
    setBusy(true);
    setNotice(undefined);
    try {
      await loadPersonStatuses(person.id);
    } finally {
      setBusy(false);
    }
  };

  const clearPersonSelection = () => {
    setSelectedPerson(undefined);
    setPersonStatuses([]);
    setAssigningStatus(false);
  };

  const beginAssignStatus = () => {
    setAssigningStatus(true);
    setNotice(undefined);
  };

  const cancelAssignStatus = () => setAssigningStatus(false);

  const assignStatus = async (form: FormData) => {
    if (!selectedPerson) return;
    const statusTypeId = String(form.get('statusTypeId') ?? '');
    const validFrom = String(form.get('validFrom') ?? '');
    const validToRaw = String(form.get('validTo') ?? '').trim();
    if (!statusTypeId || !validFrom) return;
    // Person Status validity is a plain calendar date in this domain
    // (backend `valid_from`/`valid_to` are DATE, not DATETIME) — the
    // datetime-local + zonedLocalToIso conversion used for Season's
    // effective-from does not apply here and must not be used: there is no
    // time-of-day component to convert, so nothing should touch UTC at all.
    const values: StatusAssignment = {
      statusTypeId,
      validFrom,
      validTo: validToRaw || null,
    };
    setBusy(true);
    setNotice(undefined);
    try {
      await adminApi.assignPersonStatus(selectedPerson.id, values);
      setAssigningStatus(false);
      const refreshed = await loadPersonStatuses(selectedPerson.id);
      setNotice(
        refreshed
          ? { kind: 'success', text: 'Статус сохранён.' }
          : {
              kind: 'error',
              text: 'Статус сохранён, но не удалось обновить данные на экране. Обновите страницу.',
            },
      );
    } catch (error) {
      setNotice(scoringAdminError(error));
    } finally {
      setBusy(false);
    }
  };

  const retireStatus = async (status: PersonStatusAssignment) => {
    if (!selectedPerson) return;
    if (
      !window.confirm(
        `Завершить статус «${status.name}» для «${personFullName(selectedPerson)}»?`,
      )
    )
      return;
    setBusy(true);
    setNotice(undefined);
    try {
      await adminApi.retirePersonStatus(selectedPerson.id, status.id);
      const refreshed = await loadPersonStatuses(selectedPerson.id);
      setNotice(
        refreshed
          ? { kind: 'success', text: 'Статус завершён.' }
          : {
              kind: 'error',
              text: 'Статус завершён, но не удалось обновить данные на экране. Обновите страницу.',
            },
      );
    } catch (error) {
      setNotice(scoringAdminError(error));
    } finally {
      setBusy(false);
    }
  };

  const [simResults, setSimResults] = useState<PersonSummary[]>([]);
  const [simHasSearched, setSimHasSearched] = useState(false);
  const [simPerson, setSimPerson] = useState<PersonSummary>();
  const [simParticipations, setSimParticipations] = useState<
    PersonActivityParticipation[]
  >([]);
  const [simParticipationId, setSimParticipationId] = useState<string>();
  const [simOutcome, setSimOutcome] = useState<PreviewOutcome>();

  const searchSimulatorPeople = async (form: FormData) => {
    const query = String(form.get('query') ?? '').trim();
    setBusy(true);
    setNotice(undefined);
    try {
      setSimResults((await adminApi.people(query)).items);
      setSimHasSearched(true);
    } catch (error) {
      setNotice(scoringAdminError(error));
    } finally {
      setBusy(false);
    }
  };

  const selectSimulatorPerson = async (person: PersonSummary) => {
    setSimPerson(person);
    setSimParticipationId(undefined);
    setSimOutcome(undefined);
    setBusy(true);
    setNotice(undefined);
    try {
      setSimParticipations(
        (await adminApi.personActivity(person.id)).participations,
      );
    } catch (error) {
      setNotice(scoringAdminError(error));
    } finally {
      setBusy(false);
    }
  };

  const clearSimulatorSelection = () => {
    setSimPerson(undefined);
    setSimParticipations([]);
    setSimParticipationId(undefined);
    setSimOutcome(undefined);
  };

  const selectSimulatorParticipation = (
    participation: PersonActivityParticipation,
  ) => {
    setSimParticipationId(participation.id);
    setSimOutcome(undefined);
  };

  const calculatePreview = async () => {
    if (!simParticipationId) return;
    setBusy(true);
    setSimOutcome(undefined);
    try {
      const response = await adminApi.scoringPreview({
        participationId: simParticipationId,
      });
      setSimOutcome({ kind: 'result', response });
    } catch (error) {
      setSimOutcome({ kind: 'explanation', text: previewExplanation(error) });
    } finally {
      setBusy(false);
    }
  };

  const references = useMemo(
    () => ({ roles, levels, results, statusTypes }),
    [roles, levels, results, statusTypes],
  );

  if (editing && selectedPolicy) {
    return (
      <main className="admin-shell">
        <VersionEditor
          policyId={selectedPolicy.id}
          mode={editing.mode}
          version={editing.version}
          references={references}
          canManage={canManage}
          onSaved={() => {
            setEditing(undefined);
            void loadVersions(selectedPolicy);
          }}
          onCancel={() => setEditing(undefined)}
        />
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button type="button" className="text-button" onClick={onBack}>
          ← Мероприятия
        </button>
        <span>Скоринг v2</span>
      </header>
      <section className="admin-content">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">MosActive</p>
            <h1>Политики начисления баллов</h1>
            <p>
              Версии формулы: роль × уровень × статус × новичок + результат.
            </p>
          </div>
        </header>
        {notice && (
          <p className={`admin-notice ${notice.kind}`} role="status">
            {notice.text}
          </p>
        )}
        {!canManage && (
          <p className="admin-notice">
            Организатор может только просматривать политики скоринга. Изменять
            их может SUPER_ADMIN.
          </p>
        )}
        <SeasonScoringPanel
          seasons={seasons}
          policies={policies}
          publishablePolicyIds={publishablePolicyIds}
          canManage={canManage}
          busy={busy}
          assigningSeasonId={assigningSeasonId}
          onBegin={beginSeasonAssignment}
          onCancel={cancelSeasonAssignment}
          onSubmit={(season, form) => void assignSeasonPolicy(season, form)}
        />
        <PersonStatusPanel
          statusTypes={statusTypes}
          canManage={canManage}
          busy={busy}
          hasSearched={hasSearchedPeople}
          searchResults={personResults}
          selectedPerson={selectedPerson}
          onSearch={(form) => void searchPeople(form)}
          onSelectPerson={(person) => void selectPerson(person)}
          onClearSelection={clearPersonSelection}
          statuses={personStatuses}
          assigning={assigningStatus}
          onBeginAssign={beginAssignStatus}
          onCancelAssign={cancelAssignStatus}
          onSubmitAssign={(form) => void assignStatus(form)}
          onRetire={(status) => void retireStatus(status)}
        />
        <SimulatorPanel
          busy={busy}
          hasSearched={simHasSearched}
          searchResults={simResults}
          selectedPerson={simPerson}
          onSearch={(form) => void searchSimulatorPeople(form)}
          onSelectPerson={(person) => void selectSimulatorPerson(person)}
          onClearSelection={clearSimulatorSelection}
          participations={simParticipations}
          selectedParticipationId={simParticipationId}
          onSelectParticipation={selectSimulatorParticipation}
          onCalculate={() => void calculatePreview()}
          outcome={simOutcome}
        />
        <div className="activity-settings-grid">
          <section className="admin-panel">
            <h2>Политики</h2>
            <ul className="activity-list">
              {policies.map((policy) => (
                <li key={policy.id}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void openPolicy(policy)}
                  >
                    <strong>{policy.name}</strong>
                    <span>
                      {policy.code}
                      {policy.active ? '' : ' · неактивна'}
                    </span>
                  </button>
                </li>
              ))}
              {policies.length === 0 && <li>Политик пока нет.</li>}
            </ul>
            {canManage && (
              <form
                action={(form) => void createPolicy(form)}
                className="stack-form"
              >
                <label>
                  <span>Код</span>
                  <input name="code" required placeholder="KAIT20_DEFAULT" />
                </label>
                <label>
                  <span>Название</span>
                  <input
                    name="name"
                    required
                    placeholder="MosActive КАИТ №20"
                  />
                </label>
                <Button type="submit" disabled={busy}>
                  Создать политику
                </Button>
              </form>
            )}
          </section>
          <section className="admin-panel">
            <h2>
              {selectedPolicy ? `Версии · ${selectedPolicy.name}` : 'Версии'}
            </h2>
            {!selectedPolicy && <p>Выберите политику слева.</p>}
            {selectedPolicy && (
              <>
                <div className="participant-table-wrap">
                  <table className="participant-table">
                    <thead>
                      <tr>
                        <th>№</th>
                        <th>Статус</th>
                        <th>Действует с</th>
                        <th>Действует до</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((version) => (
                        <tr key={version.id}>
                          <td>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => void openVersion(version)}
                            >
                              {version.version}
                            </button>
                          </td>
                          <td>{versionStatusLabel(version.status)}</td>
                          <td>{version.effectiveFrom ?? '—'}</td>
                          <td>{version.effectiveTo ?? '—'}</td>
                        </tr>
                      ))}
                      {versions.length === 0 && (
                        <tr>
                          <td colSpan={4}>Версий пока нет.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {canManage && (
                  <Button
                    onClick={() => setEditing({ mode: 'create' })}
                    disabled={busy}
                  >
                    Создать черновик версии
                  </Button>
                )}
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
};
