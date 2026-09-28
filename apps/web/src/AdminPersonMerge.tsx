import type {
  PersonDetailResponse,
  PersonMergePreview,
  PersonSummary,
} from '@event-registration/contracts';
import { useState } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';

const name = (person: PersonSummary) =>
  [person.lastName, person.firstName, person.middleName]
    .filter(Boolean)
    .join(' ');

const IdentityCard = ({
  title,
  person,
}: {
  title: string;
  person: PersonSummary;
}) => (
  <div>
    <h4>{title}</h4>
    <dl>
      <dt>ФИО</dt>
      <dd>{name(person)}</dd>
      <dt>Дата рождения</dt>
      <dd>{person.birthDate ?? 'Не указана'}</dd>
      <dt>Email</dt>
      <dd>{person.email ?? 'Не указан'}</dd>
      <dt>Телефон</dt>
      <dd>{person.phone ?? 'Не указан'}</dd>
      <dt>Учебная группа</dt>
      <dd>{person.studyGroup ?? 'Не указана'}</dd>
      <dt>Организация</dt>
      <dd>{person.organization ?? 'Не указана'}</dd>
    </dl>
  </div>
);

const historyLabels: Record<string, string> = {
  registrations: 'Регистрации',
  participations: 'Участия',
  achievements: 'Достижения',
  score_transactions: 'Начисления и отмены',
  student_memberships: 'Учебная история',
  person_status_assignments: 'Статусы',
};

const conflictLabels: Record<string, string> = {
  ACTIVE_REGISTRATION: 'Две активные регистрации на одно мероприятие',
  CONFIRMED_PARTICIPATION: 'Два подтверждённых участия в одном мероприятии',
  SCORING_SEQUENCE: 'Совпадает внутренний номер начисления',
  MEMBERSHIP_OVERLAP: 'Пересекаются периоды обучения',
  STATUS_OVERLAP: 'Пересекаются одинаковые статусы студента',
};

const errorMessage = (error: unknown) => {
  if (error instanceof AdminApiError) {
    if (error.code === 'PERSON_MERGE_CONFLICT')
      return 'История изменилась или обнаружен конфликт. Повторите сравнение и разрешите конфликт вручную.';
    if (error.code === 'PERSON_NOT_FOUND')
      return 'Одна из карточек уже недоступна. Обновите список людей.';
  }
  return 'Не удалось выполнить действие. Повторите попытку.';
};

export const AdminPersonMerge = ({
  person,
  onChanged,
}: {
  person: PersonDetailResponse;
  onChanged: (person: PersonDetailResponse) => void;
}) => {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<PersonSummary[]>([]);
  const [preview, setPreview] = useState<PersonMergePreview>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const search = async () => {
    if (query.trim().length < 2) return;
    setBusy(true);
    setNotice('');
    setPreview(undefined);
    try {
      const result = await adminApi.people(query.trim());
      setCandidates(result.items.filter((item) => item.id !== person.id));
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const compare = async (sourcePersonId: string) => {
    setBusy(true);
    setNotice('');
    try {
      setPreview(await adminApi.previewPersonMerge(person.id, sourcePersonId));
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const merge = async () => {
    if (!preview?.canMerge || reason.trim().length < 3) return;
    if (
      !window.confirm(
        `Объединить «${name(preview.source)}» с «${name(preview.target)}»? Обе истории будут в основной карточке.`,
      )
    )
      return;
    setBusy(true);
    setNotice('');
    try {
      onChanged(
        await adminApi.mergePerson(person.id, {
          sourcePersonId: preview.source.id,
          reason: reason.trim(),
        }),
      );
      setPreview(undefined);
      setCandidates([]);
      setReason('');
      setNotice('Карточки объединены. История сохранена в основной карточке.');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    if (reason.trim().length < 3) return;
    setBusy(true);
    setNotice('');
    try {
      onChanged(
        await adminApi.dismissPersonDuplicate(person.id, reason.trim()),
      );
      setReason('');
      setNotice('Отметка о возможном дубле снята. Причина записана в журнал.');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-panel">
      <h2>Проверить возможный дубль</h2>
      <p>
        Основная карточка: {name(person)}. Исторические данные сохраняются;
        текущие ФИО, группа и площадка берутся из основной карточки.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label>
          Найти вторую карточку по ФИО, группе или контакту
          <input
            value={query}
            minLength={2}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || query.trim().length < 2}>
          Найти для сравнения
        </button>
      </form>
      {candidates.length > 0 && (
        <ul>
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              {name(candidate)} · {candidate.studyGroup ?? 'Группа не указана'}{' '}
              <button
                type="button"
                disabled={busy}
                onClick={() => void compare(candidate.id)}
              >
                Сравнить
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <div className="admin-panel">
          <h3>Сравнение историй</h3>
          <div className="merge-comparison">
            <IdentityCard title="Основная карточка" person={preview.target} />
            <IdentityCard title="Вторая карточка" person={preview.source} />
          </div>
          <ul>
            {Object.entries(historyLabels).map(([key, label]) => (
              <li key={key}>
                {label}: {preview.targetCounts[key] ?? 0} +{' '}
                {preview.sourceCounts[key] ?? 0}
              </li>
            ))}
          </ul>
          {preview.conflicts.length > 0 && (
            <div role="alert">
              <p>Объединение остановлено. Разрешите конфликты вручную:</p>
              <ul>
                {preview.conflicts.map((conflict) => (
                  <li
                    key={`${conflict.code}-${conflict.eventId ?? conflict.sequence ?? ''}`}
                  >
                    {conflictLabels[conflict.code]}
                    {conflict.eventId
                      ? ` · мероприятие ${conflict.eventId}`
                      : ''}
                    {conflict.sequence ? ` · номер ${conflict.sequence}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <label>
        Причина решения
        <input
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="row-actions">
        <button
          type="button"
          disabled={busy || !preview?.canMerge || reason.trim().length < 3}
          onClick={() => void merge()}
        >
          Объединить в основную карточку
        </button>
        {person.dedupReviewRequired && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void dismiss()}
          >
            Это не дубль
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
};
