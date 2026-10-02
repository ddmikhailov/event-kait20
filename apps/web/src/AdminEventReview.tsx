import type {
  ActivityReference,
  EventReview,
  EventReviewDecision,
  EventReviewScorePreview,
  RosterSearch,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useCallback, useEffect, useState } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';
import { RosterSuggestions } from './RosterSuggestions.js';

type ReviewItem = EventReview['items'][number];

const scorePreviewMessage = (code: string | null) =>
  ({
    ABSENT: 'Не пришёл — баллы не начисляются.',
    NOT_STUDENT: 'Для этой категории участника баллы не начисляются.',
    REJECTED: 'Запись отклонена — баллы не начисляются.',
    ROSTER_MATCH_REQUIRED: 'Сначала сопоставьте студента с контингентом.',
    ROSTER_LINK_CONFLICT:
      'У студента уже есть другая активная регистрация на это мероприятие.',
    REVIEW_IDENTITY_LOCKED:
      'Проверьте связь с профилем: у участия уже есть история начислений.',
    SCORING_SETUP_REQUIRED:
      'Укажите сезон, уровень и действующие правила баллов.',
    SCORING_COMPONENT_MISSING:
      'В правилах не хватает значения роли, уровня, результата или очередности участия.',
    SCORING_POLICY_VERSION_NOT_FOUND:
      'Для даты мероприятия нет опубликованных правил баллов.',
  })[code ?? ''] ?? 'Расчёт сейчас недоступен. Проверьте настройки баллов.';

const ScorePreview = ({ preview }: { preview: EventReviewScorePreview }) => {
  if (preview.state !== 'READY' || !preview.calculation)
    return <p role="status">{scorePreviewMessage(preview.code)}</p>;
  const calculation = preview.calculation;
  return (
    <details>
      <summary>Предварительный результат: {preview.points}</summary>
      <p>
        Роль «{calculation.role.name}»: {calculation.role.value} × уровень «
        {calculation.level.name}»: {calculation.level.value} × коэффициент
        мероприятия: {String(calculation.eventBoost)} × коэффициент очередности:{' '}
        {calculation.newcomer.value}.
      </p>
      {calculation.statuses.map((status) => (
        <p key={status.id}>
          Статус «{status.name}»: ×{status.value}.
        </p>
      ))}
      <p>
        Бонус за результат: {calculation.resultBonus}. Итого:{' '}
        {calculation.finalPoints}.
      </p>
      <p>
        Расчёт станет окончательным только после утверждения всей ведомости.
      </p>
    </details>
  );
};

const reviewError = (error: unknown) => {
  if (!(error instanceof AdminApiError))
    return 'Не удалось выполнить действие.';
  const messages: Record<string, string> = {
    REVIEW_ITEM_CHANGED:
      'Карточка изменилась: поступила отметка Scanner или решение другого сотрудника. Отмените местные правки, обновите список и проверьте решение заново.',
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
    FORBIDDEN:
      'Исправить утверждённый список может только главный администратор.',
    REVIEW_NOT_APPROVED:
      'Для повторной сверки выберите утверждённое мероприятие.',
    REVIEW_IDENTITY_LOCKED:
      'Участие с начислениями нельзя перенести другому студенту. Сначала проверьте исходную связь; историю начислений нужно сохранить.',
  };
  const message =
    messages[error.code] ?? 'Не удалось выполнить действие. Повторите попытку.';
  return error.requestId
    ? `${message} Код обращения: ${error.requestId}.`
    : message;
};

const initialDecision = (item: ReviewItem): EventReviewDecision => ({
  expectedVersion: item.version,
  attendanceDecision: item.attendanceDecision,
  roleId: item.roleId,
  resultId: item.resultId,
  rosterPersonId: item.rosterPersonId,
  rejectMatch: item.matchState === 'REJECTED',
  reason: '',
});

export const EventReviewQueue = ({
  onBack,
  canCorrect,
}: {
  onBack: () => void;
  canCorrect: boolean;
}) => {
  const [pending, setPending] = useState<{ id: string; title: string }[]>([]);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const [state, setState] = useState<'PENDING' | 'APPROVED'>('PENDING');

  const load = useCallback(async () => {
    try {
      setPending((await adminApi.pendingEventReviews(state)).items);
      setError(undefined);
    } catch (cause) {
      setError(reviewError(cause));
    }
  }, [state]);

  useEffect(() => void load(), [load]);
  if (selected)
    return (
      <EventReviewWorkspace
        canCorrect={canCorrect}
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
        <label>
          Списки мероприятий
          <select
            value={state}
            onChange={(event) => {
              setPending([]);
              setState(event.target.value as 'PENDING' | 'APPROVED');
            }}
          >
            <option value="PENDING">Ожидают проверки</option>
            <option value="APPROVED">Утверждённые</option>
          </select>
        </label>
        {pending.length === 0 ? (
          <p>В выбранном разделе нет мероприятий.</p>
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
  canCorrect,
}: {
  eventId: string;
  onBack: () => void;
  canCorrect: boolean;
}) => {
  const [review, setReview] = useState<EventReview>();
  const [roles, setRoles] = useState<ActivityReference[]>([]);
  const [results, setResults] = useState<ActivityReference[]>([]);
  const [drafts, setDrafts] = useState<Record<string, EventReviewDecision>>({});
  const [scorePreviews, setScorePreviews] = useState<
    Record<string, EventReviewScorePreview>
  >({});
  const [searchFor, setSearchFor] = useState<string>();
  const [searchText, setSearchText] = useState('');
  const [candidates, setCandidates] = useState<RosterSearch['items']>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [participantQuery, setParticipantQuery] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<{
    kind: 'error' | 'success';
    text: string;
  }>();

  const dirtyCount = Object.keys(drafts).length;
  const canEdit =
    review?.state === 'PENDING' && (!review.isCorrection || canCorrect);
  useEffect(() => {
    if (!dirtyCount) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirtyCount]);

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
      setScorePreviews((current) => {
        const next = { ...current };
        delete next[item.registrationId];
        return next;
      });
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
  const previewScore = async (item: ReviewItem) => {
    if (busy || drafts[item.registrationId]) return;
    setBusy(true);
    try {
      const result = await adminApi.previewEventReviewScore(
        eventId,
        item.registrationId,
        item.version,
      );
      setScorePreviews((current) => ({
        ...current,
        [item.registrationId]: result,
      }));
      setNotice(undefined);
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
    if (busy || dirtyCount > 0) return;
    setBusy(true);
    try {
      setReview(await adminApi.refreshEventReview(eventId));
      setScorePreviews({});
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
    if (busy || dirtyCount > 0 || review?.state !== 'PENDING') return;
    if (
      !window.confirm(
        'Утвердить список и начислить баллы отмеченным студентам?',
      )
    )
      return;
    setBusy(true);
    try {
      const summary = await adminApi.approveEventReview(eventId);
      setReview((current) =>
        current ? { ...current, state: 'APPROVED' } : current,
      );
      setNotice({
        kind: 'success',
        text: `Список утверждён. Проверено записей: ${summary.registered}. Пришли: ${summary.present}. Не пришли: ${summary.absent}. Получили баллы: ${summary.awarded}.`,
      });
    } catch (error) {
      setNotice({ kind: 'error', text: reviewError(error) });
    } finally {
      setBusy(false);
    }
  };
  const reopen = async () => {
    if (busy || !canCorrect || correctionReason.trim().length < 3) return;
    setBusy(true);
    try {
      setReview(await adminApi.reopenEventReview(eventId, correctionReason));
      setCorrectionReason('');
      setNotice({
        kind: 'success',
        text: 'Повторная сверка открыта. Баллы изменятся только после утверждения исправлений.',
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
  const filtered = (review?.items ?? []).filter((item) => {
    const name = [
      item.lastName,
      item.firstName,
      item.middleName,
      item.studyGroup,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('ru');
    if (!name.includes(participantQuery.trim().toLocaleLowerCase('ru')))
      return false;
    if (filter === 'UNMATCHED')
      return ['UNMATCHED', 'AMBIGUOUS'].includes(item.matchState);
    if (filter === 'CHANGED') return item.attendanceChangedSinceReview;
    if (filter === 'DIRTY') return Boolean(drafts[item.registrationId]);
    if (filter === 'PRESENT' || filter === 'ABSENT')
      return decision(item).attendanceDecision === filter;
    return true;
  });
  const lastPage = Math.max(0, Math.ceil(filtered.length / 25) - 1);
  const currentPage = Math.min(page, lastPage);
  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (
              !dirtyCount ||
              window.confirm(
                'Есть несохранённые решения. Выйти и отменить эти изменения?',
              )
            )
              onBack();
          }}
        >
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
        {review?.isCorrection && review.state === 'PENDING' && (
          <p>
            Повторная сверка. Изменять и утверждать решения может только главный
            администратор. До утверждения действуют прежние начисления.
          </p>
        )}
        {canEdit && review && (
          <div className="admin-panel">
            <p>
              Записей: {review.items.length}. Требуют сопоставления или
              отклонения: {unresolved}.
            </p>
            {dirtyCount > 0 && (
              <p role="status">
                Несохранённых карточек: {dirtyCount}. Сохраните или отмените
                изменения перед обновлением отметок и утверждением.
              </p>
            )}
            <div className="row-actions">
              <button
                className="secondary-button"
                disabled={busy || dirtyCount > 0}
                onClick={() => void refresh()}
              >
                Проверить новые отметки
              </button>
              <Button
                disabled={busy || dirtyCount > 0 || unresolved > 0}
                onClick={() => void approve()}
              >
                Утвердить и начислить баллы
              </Button>
            </div>
          </div>
        )}
        {review?.state === 'APPROVED' && (
          <div className="admin-panel">
            <p>Список утверждён. Начисления отражены в MosActive.</p>
            {canCorrect && (
              <>
                <label>
                  Причина повторной сверки
                  <input
                    value={correctionReason}
                    disabled={busy}
                    maxLength={500}
                    onChange={(event) =>
                      setCorrectionReason(event.target.value)
                    }
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={busy || correctionReason.trim().length < 3}
                  onClick={() => void reopen()}
                >
                  Открыть повторную сверку
                </button>
              </>
            )}
          </div>
        )}
        {review && review.state !== 'NOT_STARTED' && (
          <>
            <div className="admin-panel">
              <label>
                Поиск по участникам
                <input
                  value={participantQuery}
                  maxLength={150}
                  onChange={(event) => {
                    setParticipantQuery(event.target.value);
                    setPage(0);
                  }}
                  placeholder="ФИО или группа"
                />
              </label>
              <label>
                Показать
                <select
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="ALL">Все записи</option>
                  <option value="UNMATCHED">Без сопоставления</option>
                  <option value="CHANGED">Новая отметка Scanner</option>
                  <option value="DIRTY">Несохранённые изменения</option>
                  <option value="PRESENT">Пришли</option>
                  <option value="ABSENT">Не пришли</option>
                </select>
              </label>
              <p>
                Найдено: {filtered.length} из {review.items.length}. Утверждение
                применяется ко всему списку мероприятия.
              </p>
              <div className="row-actions">
                <button
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Предыдущие участники
                </button>
                <span>
                  Страница {currentPage + 1} из {lastPage + 1}
                </span>
                <button
                  disabled={currentPage >= lastPage}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Следующие участники
                </button>
              </div>
            </div>
            <div className="review-list" aria-label="Участники для проверки">
              {filtered
                .slice(currentPage * 25, (currentPage + 1) * 25)
                .map((item) => {
                  const selected = decision(item);
                  const scorePreview = scorePreviews[item.registrationId];
                  return (
                    <article className="review-card" key={item.registrationId}>
                      <fieldset
                        className="review-card-controls"
                        disabled={busy || !canEdit}
                        aria-label="Решение по участнику"
                      >
                        {drafts[item.registrationId] && (
                          <div className="row-actions">
                            <strong>Есть несохранённые изменения</strong>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setDrafts((current) => {
                                  const next = { ...current };
                                  delete next[item.registrationId];
                                  return next;
                                })
                              }
                            >
                              Отменить изменения
                            </button>
                          </div>
                        )}
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
                            {item.scannerFirstAttendedAt
                              ? 'Пришёл'
                              : 'Нет отметки'}
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
                        {canEdit && (
                          <div className="review-card-score">
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={
                                busy || Boolean(drafts[item.registrationId])
                              }
                              onClick={() => void previewScore(item)}
                            >
                              Рассчитать баллы
                            </button>
                            {drafts[item.registrationId] && (
                              <p>Сначала сохраните изменения карточки.</p>
                            )}
                            {scorePreview?.version === item.version && (
                              <ScorePreview preview={scorePreview} />
                            )}
                          </div>
                        )}
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
                            <RosterSuggestions
                              key={item.registrationId}
                              eventId={eventId}
                              item={item}
                              onSelect={(id) => {
                                change(item, {
                                  rosterPersonId: id,
                                  rejectMatch: false,
                                });
                                setSearchFor(undefined);
                              }}
                            />
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
                                Введите не менее двух символов для поиска.
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
                      </fieldset>
                    </article>
                  );
                })}
            </div>
          </>
        )}
      </section>
    </main>
  );
};
