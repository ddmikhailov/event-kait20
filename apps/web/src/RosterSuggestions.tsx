import type {
  EventReview,
  RosterSuggestions as Suggestions,
} from '@event-registration/contracts';
import { useEffect, useState } from 'react';
import { adminApi, withSupportCode } from './admin-api.js';

const labels = {
  lastName: 'Фамилия',
  firstName: 'Имя',
  middleName: 'Отчество',
  studyGroup: 'Группа',
};

export const RosterSuggestions = ({
  eventId,
  item,
  onSelect,
}: {
  eventId: string;
  item: EventReview['items'][number];
  onSelect: (id: string) => void;
}) => {
  const [result, setResult] = useState<Suggestions>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void adminApi
      .suggestRoster(eventId, item.registrationId)
      .then((value) => {
        if (!cancelled) setResult(value);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(
            withSupportCode(
              caught,
              'Не удалось подобрать похожие записи. Повторите попытку или воспользуйтесь поиском ниже.',
            ),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, item.registrationId, attempt]);
  return (
    <section aria-label="Похожие записи в реестре">
      <h4>Похожие записи в реестре</h4>
      <p>
        Сравните ФИО и группу. Подсказка не подтверждает личность студента.
        После выбора укажите причину и сохраните решение.
      </p>
      {!result && !error && <p role="status">Подбираем похожие записи…</p>}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            onClick={() => {
              setError('');
              setAttempt((value) => value + 1);
            }}
          >
            Повторить подбор
          </button>
        </>
      )}
      {result?.items.length === 0 && (
        <p>Похожих записей не найдено. Попробуйте поиск ниже.</p>
      )}
      {result?.truncated && (
        <p>
          Проверена часть записей. Для точного выбора воспользуйтесь поиском
          ниже.
        </p>
      )}
      {result?.items.map((candidate) => (
        <div className="admin-panel" key={candidate.id}>
          <p>
            <strong>
              {[candidate.lastName, candidate.firstName, candidate.middleName]
                .filter(Boolean)
                .join(' ')}
            </strong>{' '}
            · {candidate.studyGroup ?? 'Группа не указана'}
          </p>
          {candidate.differingFields.length ? (
            <ul>
              {candidate.differingFields.map((field) => (
                <li key={field}>
                  {labels[field]}: в заявке «{item[field] ?? 'не указано'}», в
                  реестре «{candidate[field] ?? 'не указано'}»
                </li>
              ))}
            </ul>
          ) : (
            <p>
              ФИО и группа совпадают при сравнении без учёта регистра и различия
              Е/Ё. При нескольких совпадениях уточните личность у участника.
            </p>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={() => onSelect(candidate.id)}
          >
            Выбрать эту запись
          </button>
        </div>
      ))}
    </section>
  );
};
