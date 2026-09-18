import type {
  ActivityReference,
  NewcomerTierValue,
  PolicyVersion,
  PolicyVersionDetail,
  PolicyVersionValues,
  ScoringComponentValue,
  ScoringPolicy,
  SessionResponse,
  StatusTypeReference,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
      const [policyList, roleList, levelList, resultList, statusList] =
        await Promise.all([
          adminApi.scoringPolicies(),
          adminApi.activityRoles(),
          adminApi.activityLevels(),
          adminApi.activityResults(),
          adminApi.scoringStatusTypes(),
        ]);
      setPolicies(policyList.items);
      setRoles(roleList.items);
      setLevels(levelList.items);
      setResults(resultList.items);
      setStatusTypes(statusList.items);
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
