import type {
  ActivityReference,
  EventReview,
  EventReviewDecision,
  RosterSearch,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useCallback, useEffect, useState } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';

type ReviewItem = EventReview['items'][number];

const reviewError = (error: unknown) => {
  if (!(error instanceof AdminApiError))
    return 'Не удалось выполнить действие.';
  const messages: Record<string, string> = {
    REVIEW_STALE:
      'Появились новые отметки Scanner. Обновите список и проверьте изменения.',
    ROSTER_MATCH_REQUIRED:
      'Свяжите или отклоните каждого нераспознанного студента.',
    ROSTER_LINK_CONFLICT:
      'Этот студент уже зарегистрирован на мероприятие. Проверьте повторную запись.',
    SCORING_SETUP_REQUIRED:
      'Укажите сезон и уровень, опубликуйте и назначьте полные правила баллов.',
    REVIEW_NOT_PENDING:
      'Этот список уже утверждён или ещё не передан на проверку.',
  };
  return (
    messages[error.code] ?? 'Не удалось выполнить действие. Повторите попытку.'
  );
};

const initialDecision = (item: ReviewItem): EventReviewDecision => ({
  attendanceDecision: item.attendanceDecision,
  roleId: item.roleId,
  resultId: item.resultId,
  rosterPersonId: item.rosterPersonId,
  rejectMatch: item.matchState === 'REJECTED',
  reason: '',
});

export const EventReviewQueue = ({ onBack }: { onBack: () => void }) => {
  const [pending, setPending] = useState<{ id: string; title: string }[]>([]);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setPending((await adminApi.pendingEventReviews()).items);
      setError(undefined);
    } catch (cause) {
      setError(reviewError(cause));
    }
  }, []);

  useEffect(() => void load(), [load]);
  if (selected)
    return (
      <EventReviewWorkspace
        eventId={selected}
        onBack={() => {
          setSelected(undefined);
          void load();
        }}
      />
    );
  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button className="text-button" onClick={onBack}>
          ← Мероприятия
        </button>
      </header>
      <section className="admin-content">
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">MosActive</p>
            <h1>Проверка участия</h1>
            <p>
              Утвердите посещаемость, роли и связи со студентами до начисления
              баллов.
            </p>
          </div>
        </div>
        {error && (
          <p className="admin-notice error" role="alert">
            {error}
          </p>
        )}
        {pending.length === 0 ? (
          <p>Сейчас нет мероприятий, ожидающих проверки.</p>
        ) : (
          <div className="admin-panel">
            {pending.map((event) => (
              <button
                key={event.id}
                className="secondary-button"
                onClick={() => setSelected(event.id)}
              >
                {event.title} — открыть список
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
};

export const EventReviewWorkspace = ({
  eventId,
  onBack,
}: {
  eventId: string;
  onBack: () => void;
}) => {
  const [review, setReview] = useState<EventReview>();
  const [roles, setRoles] = useState<ActivityReference[]>([]);
  const [results, setResults] = useState<ActivityReference[]>([]);
  const [drafts, setDrafts] = useState<Record<string, EventReviewDecision>>({});
  const [searchFor, setSearchFor] = useState<string>();
  const [searchText, setSearchText] = useState('');
  const [candidates, setCandidates] = useState<RosterSearch['items']>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: 'error' | 'success';
    text: string;
  }>();

  const load = useCallback(async () => {
    try {
      const [next, roleList, resultList] = await Promise.all([
        adminApi.eventReview(eventId),
        adminApi.activityRoles(),
        adminApi.activityResults(),
      ]);
      setReview(next);
      setRoles(roleList.items.filter((item) => item.active));
      setResults(resultList.items.filter((item) => item.active));
      setNotice(undefined);
    } catch (error) {
      setNotice({ kind: 'error', text: reviewError(error) });
    }
  }, [eventId]);
  useEffect(() => void load(), [load]);

  const decision = (item: ReviewItem) =>
    drafts[item.registrationId] ?? initialDecision(item);
  const change = (item: ReviewItem, patch: Partial<EventReviewDecision>) => {
    setDrafts((current) => ({
      ...current,
      [item.registrationId]: { ...decision(item), ...patch },
    }));
  };
  const save = async (item: ReviewItem) => {
    setBusy(true);
    try {
      const updated = await adminApi.updateEventReview(
        eventId,
        item.registrationId,
        decision(item),
      );
      setReview(updated);
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.registrationId];
        return next;
      });
      setNotice({ kind: 'success', text: 'Решение сохранено.' });
    } catch (error) {
      setNotice({ kind: 'error', text: reviewError(error) });
    } finally {
      setBusy(false);
    }
  };
  const search = async () => {
    if (searchText.trim().length < 2) return;
    setBusy(true);
    try {
      setCandidates((await adminApi.searchRoster(searchText.trim())).items);
      setHasSearched(true);
    } catch (error) {
      setNotice({ kind: 'error', text: reviewError(error) });
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    try {
      setReview(await adminApi.refreshEventReview(eventId));
      setNotice({
        kind: 'success',
        text: 'Новые отметки обновлены. Проверьте выделенные строки.',
      });
    } catch (error) {
      setNotice({ kind: 'error', text: reviewError(error) });
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    if (
      !window.confirm(
        'Утвердить список и начислить баллы отмеченным студентам?',
      )
    )
      return;
    setBusy(true);
    try {
      const summary = await adminApi.approveEventReview(eventId);
      setReview(await adminApi.eventReview(eventId));
      setNotice({
        kind: 'success',
        text: `Проверено записей: ${summary.registered}. Пришли: ${summary.present}. Не пришли: ${summary.absent}. Начислены баллы: ${summary.awarded}.`,
      });
    } catch (error) {
      setNotice({ kind: 'error', text: reviewError(error) });
    } finally {
      setBusy(false);
    }
  };
  const unresolved =
    review?.items.filter(
      (item) =>
        item.personType === 'KAIT_STUDENT' &&
        ['UNMATCHED', 'AMBIGUOUS'].includes(item.matchState),
    ).length ?? 0;
  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button className="text-button" onClick={onBack}>
          ← Очередь проверки
        </button>
      </header>
      <section className="admin-content">
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">Сверка мероприятия</p>
            <h1>{review?.title ?? 'Загрузка списка'}</h1>
            <p>Отметки Scanner сохраняются отдельно от итогового решения.</p>
          </div>
        </div>
        {notice && (
          <p className={`admin-notice ${notice.kind}`} role="status">
            {notice.text}
          </p>
        )}
        {review?.state === 'PENDING' && (
          <div className="admin-panel">
            <p>
              Записей: {review.items.length}. Требуют сопоставления или
              отклонения: {unresolved}.
            </p>
            <div className="row-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Проверить новые отметки
              </button>
              <Button
                disabled={busy || unresolved > 0}
                onClick={() => void approve()}
              >
                Утвердить и начислить баллы
              </Button>
            </div>
          </div>
        )}
        {review?.state === 'APPROVED' && (
          <p>Список утверждён. Начисления отражены в MosActive.</p>
        )}
        {review?.state === 'PENDING' && (
          <div className="review-list" aria-label="Участники для проверки">
            {review.items.map((item) => {
              const selected = decision(item);
              return (
                <article className="review-card" key={item.registrationId}>
                  <header className="review-card-header">
                    <h2>
                      {[item.lastName, item.firstName, item.middleName]
                        .filter(Boolean)
                        .join(' ')}
                    </h2>
                    <span>{item.studyGroup ?? 'Группа не указана'}</span>
                  </header>
                  <div className="review-card-status">
                    <span>Отметка Scanner</span>
                    <strong>
                      {item.scannerFirstAttendedAt ? 'Пришёл' : 'Нет отметки'}
                    </strong>
                    {item.attendanceChangedSinceReview && (
                      <strong className="review-updated">
                        Новая отметка — проверьте
                      </strong>
                    )}
                  </div>
                  <div className="review-card-fields">
                    <label>
                      Итоговое посещение
                      <select
                        value={selected.attendanceDecision}
                        onChange={(event) =>
                          change(item, {
                            attendanceDecision: event.target.value as
                              'PRESENT' | 'ABSENT',
                          })
                        }
                      >
                        <option value="PRESENT">Пришёл</option>
                        <option value="ABSENT">Не пришёл</option>
                      </select>
                    </label>
                    <label>
                      Роль
                      <select
                        value={selected.roleId}
                        onChange={(event) =>
                          change(item, { roleId: event.target.value })
                        }
                      >
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Результат
                      <select
                        value={selected.resultId ?? ''}
                        onChange={(event) =>
                          change(item, {
                            resultId: event.target.value || null,
                          })
                        }
                      >
                        <option value="">Без результата</option>
                        {results.map((result) => (
                          <option key={result.id} value={result.id}>
                            {result.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="review-card-match">
                    <h3>Студент в базе</h3>
                    {item.personType === 'KAIT_STUDENT' ? (
                      <>
                        <span>
                          {item.matchState === 'MATCHED'
                            ? 'Сопоставлен'
                            : item.matchState === 'REJECTED'
                              ? 'Отклонён'
                              : 'Требует проверки'}
                        </span>
                        {selected.rosterPersonId && (
                          <span> Запись выбрана</span>
                        )}
                        <button
                          className="text-button"
                          onClick={() => {
                            setSearchFor(item.registrationId);
                            setSearchText(item.lastName);
                            setCandidates([]);
                            setHasSearched(false);
                          }}
                        >
                          Найти студента
                        </button>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={selected.rejectMatch}
                            onChange={(event) =>
                              change(item, {
                                rejectMatch: event.target.checked,
                                rosterPersonId: event.target.checked
                                  ? null
                                  : selected.rosterPersonId,
                              })
                            }
                          />
                          Отклонить запись
                        </label>
                      </>
                    ) : (
                      'Баллы студенту КАИТ не начисляются'
                    )}
                  </div>
                  <div className="review-card-save">
                    <label>
                      Причина изменения
                      <input
                        placeholder="Причина изменения"
                        maxLength={500}
                        value={selected.reason}
                        onChange={(event) =>
                          change(item, { reason: event.target.value })
                        }
                      />
                    </label>
                    <button
                      className="secondary-button"
                      disabled={busy || selected.reason.trim().length < 3}
                      onClick={() => void save(item)}
                    >
                      Сохранить
                    </button>
                  </div>
                  {searchFor === item.registrationId && (
                    <div className="review-card-search">
                      <div className="review-card-search-heading">
                        <h3>Связать с записью студента</h3>
                        <button
                          className="text-button"
                          onClick={() => setSearchFor(undefined)}
                        >
                          Закрыть
                        </button>
                      </div>
                      <label>
                        Фамилия или группа
                        <input
                          value={searchText}
                          onChange={(event) => {
                            setSearchText(event.target.value);
                            setCandidates([]);
                            setHasSearched(false);
                          }}
                        />
                        <span className="review-field-hint">
                          Не менее трёх символов для сохранения решения.
                        </span>
                      </label>
                      <button
                        className="secondary-button"
                        disabled={busy || searchText.trim().length < 2}
                        onClick={() => void search()}
                      >
                        Найти
                      </button>
                      {hasSearched && candidates.length === 0 && (
                        <p>Подходящих записей пока нет.</p>
                      )}
                      {candidates.map((candidate) => (
                        <button
                          key={candidate.id}
                          className="review-candidate"
                          onClick={() => {
                            change(item, {
                              rosterPersonId: candidate.id,
                              rejectMatch: false,
                            });
                            setSearchFor(undefined);
                          }}
                        >
                          {[
                            candidate.lastName,
                            candidate.firstName,
                            candidate.middleName,
                            candidate.studyGroup,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
};
