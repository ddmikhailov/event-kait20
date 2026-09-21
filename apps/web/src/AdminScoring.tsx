import type {
  ActivityReference,
  AssignScoringPolicy,
  NewcomerTierValue,
  PolicyVersion,
  PolicyVersionDetail,
  PolicyVersionValues,
  Season,
  ScoringComponentValue,
  ScoringPolicy,
  SessionResponse,
  StatusTypeReference,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';

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

const VersionEditor = ({
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
      const effectiveFrom = new Date(
        String(form.get('effectiveFrom')),
      ).toISOString();
      const effectiveToRaw = String(form.get('effectiveTo') ?? '').trim();
      await adminApi.publishScoringPolicyVersion(version.id, {
        effectiveFrom,
        effectiveTo: effectiveToRaw
          ? new Date(effectiveToRaw).toISOString()
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
            <span>Начало действия</span>
            <input name="effectiveFrom" type="datetime-local" required />
          </label>
          <label>
            <span>Окончание действия (необязательно)</span>
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
                            <span>Действует с</span>
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

  const loadReferences = useCallback(async () => {
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
      setPolicies(policyList.items);
      setRoles(roleList.items);
      setLevels(levelList.items);
      setResults(resultList.items);
      setStatusTypes(statusList.items);
      setSeasons(seasonList.items);
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
      setPublishablePolicyIds(
        new Set(publishableIds.filter((id): id is string => id !== undefined)),
      );
    } catch (error) {
      setNotice(scoringAdminError(error));
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
      await loadReferences();
      setNotice({ kind: 'success', text: 'Политика создана.' });
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
    const effectiveFrom = new Date(effectiveFromRaw).toISOString();
    if (season.scoringPolicyId) {
      const current = policies.find(
        (item) => item.id === season.scoringPolicyId,
      );
      const confirmed = window.confirm(
        `Сменить систему начисления баллов для сезона «${season.name}»?\n\n` +
          `Было: ${current?.name ?? 'не назначена'}\n` +
          `Станет: ${policy.name}\n` +
          `Действует с: ${new Date(effectiveFrom).toLocaleString('ru-RU')}`,
      );
      if (!confirmed) return;
    }
    const values: AssignScoringPolicy = { scoringPolicyId, effectiveFrom };
    setBusy(true);
    setNotice(undefined);
    try {
      await adminApi.assignSeasonScoringPolicy(season.id, values);
      setAssigningSeasonId(undefined);
      await loadReferences();
      setNotice({
        kind: 'success',
        text: `Система начисления баллов назначена сезону «${season.name}».`,
      });
    } catch (error) {
      setNotice(scoringAdminError(error));
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
