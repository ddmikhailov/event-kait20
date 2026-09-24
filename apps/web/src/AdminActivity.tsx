import type {
  ActivityReference,
  EventResponse,
  Participation,
  ScoringRule,
  Season,
  SessionResponse,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';
import { seasonValues } from './admin-values.js';

type Notice = { kind: 'error' | 'success'; text: string };

export const EventParticipationWorkspace = ({
  event,
  onBack,
}: {
  event: EventResponse;
  onBack: () => void;
}) => {
  const [items, setItems] = useState<Participation[]>([]);
  const [roles, setRoles] = useState<ActivityReference[]>([]);
  const [results, setResults] = useState<ActivityReference[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [roleId, setRoleId] = useState('');
  const [resultId, setResultId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [participations, roleList, resultList] = await Promise.all([
        adminApi.participations(event.id),
        adminApi.activityRoles(),
        adminApi.activityResults(),
      ]);
      setItems(participations.items);
      setRoles(roleList.items.filter((item) => item.active));
      setResults(resultList.items.filter((item) => item.active));
    } catch (error) {
      setNotice(activityError(error));
    } finally {
      setBusy(false);
    }
  }, [event.id]);

  useEffect(() => void load(), [load]);

  const chosen = useMemo(
    () => items.filter((item) => selected.has(item.registrationId)),
    [items, selected],
  );

  const requireSelection = () => {
    if (chosen.length > 0) return true;
    setNotice({ kind: 'error', text: 'Выберите хотя бы одного участника.' });
    return false;
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
      setSelected(new Set());
      setReason('');
      await load();
      setNotice({ kind: 'success', text: success });
    } catch (error) {
      setNotice(activityError(error));
    } finally {
      setBusy(false);
    }
  };

  const assign = () => {
    if (!requireSelection()) return;
    if (!roleId) {
      setNotice({ kind: 'error', text: 'Выберите роль участия.' });
      return;
    }
    if (reason.trim().length < 3) {
      setNotice({ kind: 'error', text: 'Укажите причину изменения.' });
      return;
    }
    void run(
      () =>
        adminApi.assignParticipations(event.id, {
          registrationIds: chosen.map((item) => item.registrationId),
          roleId,
          resultId: resultId || null,
          reason: reason.trim(),
        }),
      'Роль и результат сохранены.',
    );
  };

  const confirm = () => {
    if (!requireSelection()) return;
    const withoutAttendance = chosen.some(
      (item) => !item.registration.firstAttendedAt,
    );
    if (!roleId && chosen.some((item) => !item.role)) {
      setNotice({ kind: 'error', text: 'Выберите роль участия.' });
      return;
    }
    if (withoutAttendance && reason.trim().length < 3) {
      setNotice({
        kind: 'error',
        text: 'Для участника без отметки Scanner укажите причину подтверждения.',
      });
      return;
    }
    if (
      withoutAttendance &&
      !window.confirm(
        'У части участников нет отметки о входе через Scanner. Всё равно подтвердить их участие?',
      )
    )
      return;
    void run(
      () =>
        adminApi.confirmParticipations(event.id, {
          registrationIds: chosen.map((item) => item.registrationId),
          roleId: roleId || null,
          resultId: resultId || null,
          source: 'ADMIN',
          confirmWithoutAttendance: withoutAttendance,
          overrideReason: withoutAttendance ? reason.trim() : null,
        }),
      'Участие подтверждено. Начисление рассчитано по действующим правилам.',
    );
  };

  const cancel = () => {
    if (!requireSelection()) return;
    const ids = chosen
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id));
    if (ids.length !== chosen.length) {
      setNotice({
        kind: 'error',
        text: 'Отменить можно только ранее созданные записи участия.',
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
    void run(
      () =>
        adminApi.cancelParticipations(event.id, {
          participationIds: ids,
          reason: reason.trim(),
        }),
      'Участие отменено. История баллов сохранена.',
    );
  };

  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button className="text-button" onClick={onBack}>
          ← Регистрации
        </button>
        <span>{items.length} участников</span>
      </header>
      <section className="admin-content">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">Фактическое участие</p>
            <h1>{event.title}</h1>
            <p>
              Registration, Attendance и подтверждённое участие учитываются
              отдельно.
            </p>
          </div>
        </header>
        {notice && (
          <p className={`admin-notice ${notice.kind}`} role="status">
            {notice.text}
          </p>
        )}
        <section className="admin-panel activity-actions">
          <label>
            <span>Роль участия</span>
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Не изменять</option>
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
              onChange={(e) => setResultId(e.target.value)}
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
            <span>Причина изменения или подтверждения без Scanner</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Например: подтверждено по итоговой ведомости"
            />
          </label>
          <div className="row-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={assign}
            >
              Назначить роль
            </button>
            <Button disabled={busy} onClick={confirm}>
              Подтвердить участие
            </Button>
            <button className="danger-button" disabled={busy} onClick={cancel}>
              Отменить участие
            </button>
          </div>
        </section>
        <div className="participant-table-wrap">
          <table className="participant-table activity-table">
            <thead>
              <tr>
                <th aria-label="Выбор" />
                <th>Участник</th>
                <th>Посещаемость</th>
                <th>Поток</th>
                <th>Роль / результат</th>
                <th>Участие</th>
                <th>Баллы</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.registrationId}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Выбрать ${fullName(item)}`}
                      checked={selected.has(item.registrationId)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(item.registrationId);
                        else next.delete(item.registrationId);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td>
                    <strong>{fullName(item)}</strong>
                    <span>
                      {item.registration.studyGroup ?? 'Группа не указана'}
                    </span>
                  </td>
                  <td>
                    {item.registration.firstAttendedAt
                      ? 'Вход подтверждён'
                      : 'Нет отметки Scanner'}
                  </td>
                  <td>{item.streamTitle ?? 'Общий поток'}</td>
                  <td>
                    <strong>{item.role?.name ?? 'Не назначена'}</strong>
                    <span>{item.result?.name ?? 'Без результата'}</span>
                  </td>
                  <td>{participationStatus(item.status)}</td>
                  <td>
                    <strong>{item.scoreAwarded}</strong>
                    <span>{scoringStatus(item.scoringState)}</span>
                    {item.scoreReason && (
                      <details>
                        <summary>Почему начислено</summary>
                        <p>{item.scoreReason}</p>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!busy && items.length === 0 && (
            <p className="admin-empty compact">Участников пока нет.</p>
          )}
        </div>
      </section>
    </main>
  );
};

export const ActivitySettings = ({
  role,
  onBack,
}: {
  role: SessionResponse['user']['role'];
  onBack: () => void;
}) => {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [roles, setRoles] = useState<ActivityReference[]>([]);
  const [categories, setCategories] = useState<ActivityReference[]>([]);
  const [levels, setLevels] = useState<ActivityReference[]>([]);
  const [rules, setRules] = useState<ScoringRule[]>([]);
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [seasonList, roleList, categoryList, levelList, ruleList] =
        await Promise.all([
          adminApi.seasons(),
          adminApi.activityRoles(),
          adminApi.activityCategories(),
          adminApi.activityLevels(),
          adminApi.scoringRules(),
        ]);
      setSeasons(seasonList.items);
      setRoles(roleList.items);
      setCategories(categoryList.items);
      setLevels(levelList.items);
      setRules(ruleList.items);
    } catch (error) {
      setNotice(activityError(error));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const createSeason = async (form: FormData) => {
    setBusy(true);
    try {
      // The admin enters Moscow wall-clock time regardless of the browser's
      // own timezone — seasonValues() resolves both boundaries against the
      // Europe/Moscow IANA zone via zonedLocalToIso, never the machine's
      // local offset.
      await adminApi.saveSeason(seasonValues(form));
      await load();
      setNotice({ kind: 'success', text: 'Сезон создан.' });
    } catch (error) {
      setNotice(activityError(error));
    } finally {
      setBusy(false);
    }
  };

  const createRule = async (form: FormData) => {
    setBusy(true);
    try {
      await adminApi.saveScoringRule({
        seasonId: String(form.get('seasonId')),
        eventCategoryId: optionalId(form.get('categoryId')),
        eventLevelId: optionalId(form.get('levelId')),
        participationRoleId: optionalId(form.get('roleId')),
        participationResultId: null,
        points: Number(form.get('points')),
        priority: Number(form.get('priority')),
        active: true,
        validFrom: null,
        validTo: null,
      });
      await load();
      setNotice({ kind: 'success', text: 'Правило начисления создано.' });
    } catch (error) {
      setNotice(activityError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button className="text-button" onClick={onBack}>
          ← Мероприятия
        </button>
        <span>Активность и баллы</span>
      </header>
      <section className="admin-content">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">Общее ядро KAIT Platform</p>
            <h1>Активность</h1>
            <p>Сезоны, роли участия и правила начисления баллов.</p>
          </div>
        </header>
        {notice && (
          <p className={`admin-notice ${notice.kind}`} role="status">
            {notice.text}
          </p>
        )}
        {role !== 'SUPER_ADMIN' && (
          <p className="admin-notice">
            Организатор может просматривать настройки. Изменять глобальную
            систему баллов может только SUPER_ADMIN.
          </p>
        )}
        <div className="activity-settings-grid">
          <section className="admin-panel">
            <h2>Сезоны</h2>
            <ul className="activity-list">
              {seasons.map((season) => (
                <li key={season.id}>
                  <strong>{season.name}</strong>
                  <span>{season.active ? 'Текущий сезон' : season.code}</span>
                </li>
              ))}
            </ul>
            {role === 'SUPER_ADMIN' && (
              <form
                action={(form) => void createSeason(form)}
                className="stack-form"
              >
                <label>
                  <span>Код</span>
                  <input name="code" required placeholder="2026_2027" />
                </label>
                <label>
                  <span>Название</span>
                  <input
                    name="name"
                    required
                    placeholder="2026/2027 учебный год"
                  />
                </label>
                <label>
                  <span>Начало сезона (МСК)</span>
                  <input name="startsAt" type="datetime-local" required />
                </label>
                <label>
                  <span>Окончание сезона (МСК)</span>
                  <input name="endsAt" type="datetime-local" required />
                </label>
                <label className="checkbox-line">
                  <input name="active" type="checkbox" />
                  <span>Сделать текущим сезоном</span>
                </label>
                <Button type="submit" disabled={busy}>
                  Создать сезон
                </Button>
              </form>
            )}
          </section>
          <section className="admin-panel">
            <h2>Роли участия</h2>
            <ul className="activity-list">
              {roles.map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong>
                  <span>{item.code}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="admin-panel activity-rules-panel">
            <h2>Правила начисления</h2>
            <div className="participant-table-wrap">
              <table className="participant-table">
                <thead>
                  <tr>
                    <th>Сезон</th>
                    <th>Условия</th>
                    <th>Баллы</th>
                    <th>Версия</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id}>
                      <td>
                        {seasons.find((x) => x.id === rule.seasonId)?.name ??
                          '—'}
                      </td>
                      <td>{ruleLabel(rule, categories, levels, roles)}</td>
                      <td>{rule.points}</td>
                      <td>
                        {rule.version}
                        {rule.active ? '' : ' · неактивно'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {role === 'SUPER_ADMIN' && (
              <form
                action={(form) => void createRule(form)}
                className="activity-rule-form"
              >
                <label>
                  <span>Сезон</span>
                  <select name="seasonId" required>
                    <option value="">Выберите</option>
                    {seasons.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Категория</span>
                  <select name="categoryId">
                    <option value="">Любая</option>
                    {categories.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Уровень</span>
                  <select name="levelId">
                    <option value="">Любой</option>
                    {levels.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Роль</span>
                  <select name="roleId">
                    <option value="">Любая</option>
                    {roles.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Баллы</span>
                  <input name="points" type="number" required />
                </label>
                <label>
                  <span>Приоритет</span>
                  <input
                    name="priority"
                    type="number"
                    min="0"
                    defaultValue="0"
                    required
                  />
                </label>
                <Button type="submit" disabled={busy}>
                  Создать правило
                </Button>
              </form>
            )}
          </section>
        </div>
      </section>
    </main>
  );
};

const optionalId = (value: FormDataEntryValue | null) => {
  const text = String(value ?? '').trim();
  return text || null;
};

export const fullName = (item: Participation) =>
  [
    item.registration.lastName,
    item.registration.firstName,
    item.registration.middleName,
  ]
    .filter(Boolean)
    .join(' ');

export const participationStatus = (status: Participation['status']) =>
  ({ DRAFT: 'Черновик', CONFIRMED: 'Подтверждено', CANCELLED: 'Отменено' })[
    status
  ];

export const scoringStatus = (status: Participation['scoringState']) =>
  ({
    NOT_SCORED: 'Не рассчитано',
    AWARDED: 'Начислено',
    NO_RULE: 'Нет подходящего правила',
    REVERSED: 'Начисление отменено',
  })[status];

const ruleLabel = (
  rule: ScoringRule,
  categories: ActivityReference[],
  levels: ActivityReference[],
  roles: ActivityReference[],
) =>
  [
    categories.find((x) => x.id === rule.eventCategoryId)?.name,
    levels.find((x) => x.id === rule.eventLevelId)?.name,
    roles.find((x) => x.id === rule.participationRoleId)?.name,
  ]
    .filter(Boolean)
    .join(' · ') || 'Любое участие';

export const activityError = (error: unknown): Notice => {
  if (error instanceof AdminApiError) {
    const messages: Record<string, string> = {
      ATTENDANCE_REQUIRED:
        'Нет отметки Scanner. Подтвердите действие явно и укажите причину.',
      SCORING_RULE_CONFLICT:
        'Такое правило пересекается с другим правилом того же приоритета.',
      SCORING_RULE_AMBIGUOUS:
        'Для участия подходят несколько равнозначных правил. Исправьте настройки начисления.',
      REGISTRATION_NOT_FOUND: 'Регистрация не найдена или неактивна.',
      PARTICIPATION_NOT_FOUND: 'Запись об участии не найдена.',
      PARTICIPATION_ROLE_REQUIRED: 'Укажите роль участия.',
      INVALID_REFERENCE: 'Указанная роль или результат недоступны.',
      EVENT_NOT_FOUND: 'Мероприятие не найдено.',
      PERSON_NOT_FOUND: 'Человек не найден.',
      STUDY_GROUP_NOT_FOUND: 'Учебная группа не найдена или недоступна.',
      MEMBERSHIP_NOT_FOUND:
        'Действующая принадлежность в этой организации не найдена.',
      MEMBERSHIP_ALREADY_CLOSED: 'Эта принадлежность уже завершена.',
      MEMBERSHIP_PERIOD_OVERLAP:
        'Периоды учебной принадлежности пересекаются. Обратитесь к администратору для сверки истории.',
      // Deliberately NOT mapping the generic `CONFLICT` code here (Stage 4
      // Final Cleanup, closing the Stage 4.2 debt note): `CONFLICT` is
      // reused by many unrelated backend endpoints across this codebase
      // (event slug, staff account, stream limits, ...) - giving it one
      // fixed, Membership-specific message in this SHARED mapper was
      // fragile and wrong for every other caller. Membership's own
      // no-op-transfer CONFLICT now has its own mapping in
      // AdminMembership.tsx; every other caller falls back to the
      // backend's own message below, same as any other unmapped code.
      ACHIEVEMENT_NOT_FOUND: 'Достижение не найдено.',
      // Achievement-specific, deliberately not reusing the shared CONFLICT
      // mapping above (Stage 4.2 debt note) - this code means something
      // different in each domain.
      ACHIEVEMENT_REFERENCE_MISMATCH:
        'Мероприятие и участие не описывают одно и то же событие, или ссылка недоступна.',
      PERSON_MISMATCH: 'Человек не совпадает с выбранным.',
    };
    return { kind: 'error', text: messages[error.code] ?? error.message };
  }
  return { kind: 'error', text: 'Не удалось выполнить действие.' };
};
