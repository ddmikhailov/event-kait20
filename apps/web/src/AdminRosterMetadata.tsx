import {
  updateRosterMetadataRequestSchema,
  type PersonDetailResponse,
} from '@event-registration/contracts';
import { useEffect, useState, type FormEvent } from 'react';

import { AdminApiError, adminApi, withSupportCode } from './admin-api.js';

const fields = [
  ['educationStatus', 'Статус обучения'],
  ['campusAddress', 'Площадка'],
  ['course', 'Курс обучения'],
  ['programName', 'Специальность'],
  ['programCode', 'Код специальности'],
] as const;
const draftOf = (person: PersonDetailResponse) =>
  Object.fromEntries(
    fields.map(([key]) => [key, person.roster?.[key] ?? '']),
  ) as Record<(typeof fields)[number][0], string>;

export const AdminRosterMetadata = ({
  person,
  disabled,
  onChanged,
  onDirtyChange,
  onBusyChange,
}: {
  person: PersonDetailResponse;
  disabled: boolean;
  onChanged: (value: PersonDetailResponse) => void;
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
}) => {
  const [draft, setDraft] = useState(() => draftOf(person));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const changed = fields.some(
    ([key]) => draft[key] !== (person.roster?.[key] ?? ''),
  );
  const dirty = changed || reason !== '';
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  const setWorking = (value: boolean) => {
    setBusy(value);
    onBusyChange(value);
  };
  const reset = (value: PersonDetailResponse) => {
    setDraft(draftOf(value));
    setReason('');
    setConflict(false);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = updateRosterMetadataRequestSchema.safeParse({
      ...Object.fromEntries(
        fields.map(([key]) => [key, draft[key].trim() || null]),
      ),
      expectedVersion: person.rosterVersion,
      reason,
    });
    if (!parsed.success) {
      setFailed(true);
      setNotice(
        'Проверьте поля и укажите причину изменения: от 3 до 500 символов.',
      );
      return;
    }
    setWorking(true);
    setNotice('');
    try {
      const updated = await adminApi.updateRosterMetadata(
        person.id,
        parsed.data,
      );
      reset(updated);
      onChanged(updated);
      setFailed(false);
      setNotice(
        'Данные контингента сохранены. История регистраций и начислений не изменена.',
      );
    } catch (error) {
      setFailed(true);
      const stale =
        error instanceof AdminApiError &&
        error.code === 'ROSTER_METADATA_CHANGED';
      setConflict(stale);
      setNotice(
        withSupportCode(
          error,
          stale
            ? 'Другой сотрудник уже изменил эти данные. Ваш ввод сохранён в форме. Скопируйте нужные правки и загрузите актуальную карточку.'
            : 'Не удалось сохранить данные. Ваш ввод сохранён в форме. Повторите попытку.',
        ),
      );
    } finally {
      setWorking(false);
    }
  };
  const reload = async () => {
    if (
      dirty &&
      !window.confirm(
        'Загрузить актуальные данные? Несохранённые правки этого раздела будут сброшены.',
      )
    )
      return;
    setWorking(true);
    try {
      const updated = await adminApi.person(person.id);
      reset(updated);
      onChanged(updated);
      setNotice('Актуальные данные загружены.');
      setFailed(false);
    } catch {
      setNotice('Не удалось загрузить карточку. Ваш ввод сохранён.');
      setFailed(true);
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="admin-panel">
      <h2>Данные контингента</h2>
      <p className="muted">
        Площадка отображается в публичной карточке. Остальные поля этого раздела
        видны только сотрудникам. Изменение статуса обучения не скрывает профиль
        и не меняет баллы автоматически.
      </p>
      {notice && (
        <p
          className={`admin-notice ${failed ? 'error' : 'success'}`}
          role={failed ? 'alert' : 'status'}
        >
          {notice}
        </p>
      )}
      <form className="admin-form" onSubmit={(event) => void save(event)}>
        <fieldset
          className="roster-metadata-fields"
          disabled={disabled || busy}
        >
          <legend>Текущие сведения студента</legend>
          <div className="roster-metadata-grid">
            {fields.map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  maxLength={120}
                  value={draft[key]}
                  onChange={(event) =>
                    setDraft({ ...draft, [key]: event.target.value })
                  }
                />
              </label>
            ))}
            <label>
              <span>Причина изменения</span>
              <textarea
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </div>
          <div className="admin-toolbar">
            <button
              type="submit"
              disabled={!changed || reason.trim().length < 3 || conflict}
            >
              Сохранить данные контингента
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!dirty}
              onClick={() => {
                reset(person);
                setNotice('');
              }}
            >
              Отменить правки
            </button>
            {conflict && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void reload()}
              >
                Загрузить актуальные данные
              </button>
            )}
          </div>
        </fieldset>
      </form>
    </section>
  );
};
