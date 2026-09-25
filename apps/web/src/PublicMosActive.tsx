import type {
  PublicAchievementList,
  PublicParticipationList,
  PublicProfile,
  PublicStudentList,
  PublicLeaderboardSeasons,
  LeaderboardResponse,
  PublicScoreTransactionList,
} from '@event-registration/contracts';
import { useEffect, useState, type FormEvent } from 'react';

import { PublicApiError, publicApi } from './api-client.js';

const pointsText = (value: string) => value.replace(/\.?0+$/, '');

const loadError = (error: unknown) =>
  error instanceof PublicApiError && error.code === 'RATE_LIMITED'
    ? 'Слишком много запросов. Попробуйте через минуту.'
    : 'Не удалось загрузить данные. Обновите страницу и попробуйте снова.';

const MosActiveLeaderboard = () => {
  const [seasons, setSeasons] = useState<PublicLeaderboardSeasons>();
  const [seasonId, setSeasonId] = useState('');
  const [ranking, setRanking] = useState<LeaderboardResponse>();
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    publicApi
      .leaderboardSeasons()
      .then((result) => {
        if (!cancelled) {
          setSeasons(result);
          setSeasonId(result.items[0]?.id ?? '');
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(loadError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!seasonId) return;
    let cancelled = false;
    publicApi
      .leaderboard(seasonId, offset)
      .then((result) => {
        if (!cancelled) {
          setRanking(result);
          setError(undefined);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(loadError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [seasonId, offset]);

  return (
    <section
      className="mos-active-section"
      aria-labelledby="mos-active-ranking-title"
    >
      <h2 id="mos-active-ranking-title">Рейтинг студентов</h2>
      {seasons && seasons.items.length === 0 && (
        <p>Рейтинг пока не открыт: сезонов нет.</p>
      )}
      {seasons && seasons.items.length > 0 && (
        <>
          <label htmlFor="mos-active-season">Сезон</label>
          <select
            id="mos-active-season"
            value={seasonId}
            onChange={(event) => {
              setRanking(undefined);
              setOffset(0);
              setSeasonId(event.target.value);
            }}
          >
            {seasons.items.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </>
      )}
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {seasonId && !ranking && !error && (
        <p className="calendar-state">Загружаем рейтинг…</p>
      )}
      {ranking && ranking.items.length === 0 && (
        <p>В этом сезоне опубликованных баллов пока нет.</p>
      )}
      {ranking && ranking.items.length > 0 && (
        <>
          <ol className="mos-active-list mos-active-ranking" start={offset + 1}>
            {ranking.items.map((item) => (
              <li key={item.publicSlug}>
                <a
                  href={`/mos-active/students/${encodeURIComponent(item.publicSlug)}`}
                >
                  <strong>
                    {item.rank}. {item.displayName}
                  </strong>
                  {item.studyGroup && <span>{item.studyGroup}</span>}
                  <span>{pointsText(item.points)} баллов</span>
                </a>
              </li>
            ))}
          </ol>
          <div className="mos-active-pages">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => {
                setRanking(undefined);
                setOffset(Math.max(0, offset - ranking.limit));
              }}
            >
              Назад
            </button>
            <button
              type="button"
              disabled={
                ranking.items.length < ranking.limit || offset >= 10_000
              }
              onClick={() => {
                setRanking(undefined);
                setOffset(offset + ranking.limit);
              }}
            >
              Далее
            </button>
          </div>
        </>
      )}
    </section>
  );
};

export const MosActiveCatalog = () => {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<PublicStudentList>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    publicApi
      .students(query, offset)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(undefined);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(loadError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [query, offset]);

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (input.trim().length === 1) {
      setError(
        'Введите минимум два символа или очистите поле для просмотра всех студентов.',
      );
      return;
    }
    setOffset(0);
    setQuery(input.trim());
    setData(undefined);
    setError(undefined);
  };

  return (
    <main className="catalog-page mos-active-page">
      <a className="back-link" href="/">
        ← На главную
      </a>
      <header className="catalog-hero">
        <p className="eyebrow">КАИТ №20</p>
        <h1>МосАктив</h1>
        <p>Достижения, участие в мероприятиях и баллы студентов.</p>
      </header>
      <MosActiveLeaderboard />
      <form className="mos-active-search" onSubmit={search}>
        <label htmlFor="mos-active-query">Найти студента</label>
        <div>
          <input
            id="mos-active-query"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Фамилия или группа"
            maxLength={80}
          />
          <button type="submit">Найти</button>
        </div>
      </form>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {!error && !data && (
        <p className="calendar-state">Загружаем студентов…</p>
      )}
      {data && data.items.length === 0 && (
        <p className="calendar-empty">
          {query
            ? 'По запросу нет опубликованных профилей.'
            : 'Опубликованных профилей пока нет.'}
        </p>
      )}
      {data && data.items.length > 0 && (
        <>
          <ul className="mos-active-list">
            {data.items.map((student) => (
              <li key={student.publicSlug}>
                <a
                  href={`/mos-active/students/${encodeURIComponent(student.publicSlug)}`}
                >
                  <strong>{student.displayName}</strong>
                  {student.studyGroup && <span>{student.studyGroup}</span>}
                  {student.totalPoints !== undefined && (
                    <span>{pointsText(student.totalPoints)} баллов</span>
                  )}
                </a>
              </li>
            ))}
          </ul>
          <div className="mos-active-pages">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => {
                setData(undefined);
                setOffset(Math.max(0, offset - data.limit));
              }}
            >
              Назад
            </button>
            <button
              type="button"
              disabled={data.items.length < data.limit || offset >= 10_000}
              onClick={() => {
                setData(undefined);
                setOffset(offset + data.limit);
              }}
            >
              Далее
            </button>
          </div>
        </>
      )}
    </main>
  );
};

export const MosActiveProfile = ({ slug }: { slug: string }) => {
  const [profile, setProfile] = useState<PublicProfile>();
  const [participations, setParticipations] =
    useState<PublicParticipationList>();
  const [achievements, setAchievements] = useState<PublicAchievementList>();
  const [scoreTransactions, setScoreTransactions] =
    useState<PublicScoreTransactionList>();
  const [participationPage, setParticipationPage] = useState(1);
  const [achievementPage, setAchievementPage] = useState(1);
  const [scorePage, setScorePage] = useState(1);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    publicApi
      .student(slug)
      .then((result) => {
        if (!cancelled) setProfile(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(
            caught instanceof PublicApiError && caught.status === 404
              ? 'Профиль не найден или больше не опубликован.'
              : loadError(caught),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    publicApi
      .studentParticipations(slug, participationPage)
      .then((result) => {
        if (!cancelled) setParticipations(result);
      })
      .catch((caught: unknown) => {
        if (
          !cancelled &&
          !(caught instanceof PublicApiError && caught.status === 404)
        )
          setError(loadError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [profile, slug, participationPage]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    publicApi
      .studentAchievements(slug, achievementPage)
      .then((result) => {
        if (!cancelled) setAchievements(result);
      })
      .catch((caught: unknown) => {
        if (
          !cancelled &&
          !(caught instanceof PublicApiError && caught.status === 404)
        )
          setError(loadError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [profile, slug, achievementPage]);

  useEffect(() => {
    if (!profile || profile.totalPoints === undefined) return;
    let cancelled = false;
    publicApi
      .studentScoreTransactions(slug, scorePage)
      .then((result) => {
        if (!cancelled) setScoreTransactions(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(loadError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [profile, slug, scorePage]);

  return (
    <main className="catalog-page mos-active-page">
      <a className="back-link" href="/mos-active">
        ← Все студенты
      </a>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {!profile && !error && (
        <p className="calendar-state">Загружаем профиль…</p>
      )}
      {profile && (
        <>
          <header className="catalog-hero">
            <p className="eyebrow">МосАктив · студент КАИТ №20</p>
            <h1>{profile.displayName ?? 'Профиль студента'}</h1>
            {profile.studyGroup && <p>Группа {profile.studyGroup}</p>}
          </header>
          {profile.totalPoints !== undefined && (
            <section className="mos-active-total" aria-label="Баллы">
              <strong>{pointsText(profile.totalPoints)}</strong>
              <span>баллов за всё время</span>
            </section>
          )}
          {achievements && (
            <section className="mos-active-section">
              <h2>Достижения</h2>
              {achievements.items.length === 0 && (
                <p>Подтверждённых достижений пока нет.</p>
              )}
              <ul>
                {achievements.items.map((item, index) => (
                  <li key={`${item.title}-${item.occurredAt}-${index}`}>
                    <strong>{item.title}</strong>
                  </li>
                ))}
              </ul>
              <PageControls
                page={achievementPage}
                hasNext={achievements.items.length === achievements.pageSize}
                onPage={setAchievementPage}
              />
            </section>
          )}
          {participations && (
            <section className="mos-active-section">
              <h2>Участие в мероприятиях</h2>
              {participations.items.length === 0 && (
                <p>Подтверждённых участий пока нет.</p>
              )}
              <ul>
                {participations.items.map((item, index) => (
                  <li key={`${item.eventTitle}-${item.eventStartAt}-${index}`}>
                    <strong>{item.eventTitle}</strong>
                    <span>
                      {new Date(item.eventStartAt).toLocaleDateString('ru-RU')}
                    </span>
                    {item.role && <span>{item.role}</span>}
                    {item.result && <span>{item.result}</span>}
                    {item.points !== null && (
                      <span>{pointsText(item.points)} баллов</span>
                    )}
                  </li>
                ))}
              </ul>
              <PageControls
                page={participationPage}
                hasNext={
                  participations.items.length === participations.pageSize
                }
                onPage={setParticipationPage}
              />
            </section>
          )}
          {scoreTransactions && (
            <section className="mos-active-section">
              <h2>Как начислены баллы</h2>
              {scoreTransactions.items.length === 0 && (
                <p>Начислений пока нет.</p>
              )}
              <ul>
                {scoreTransactions.items.map((item, index) => (
                  <li key={`${item.createdAt}-${index}`}>
                    <strong>
                      {item.eventTitle ??
                        (item.type === 'LEGACY_IMPORT'
                          ? 'Перенесённые баллы'
                          : item.type === 'MANUAL_ADJUSTMENT'
                            ? 'Корректировка баллов'
                            : 'Начисление за участие')}
                    </strong>
                    <span>
                      {item.type === 'AWARD'
                        ? 'Начисление'
                        : item.type === 'REVERSAL'
                          ? 'Отмена начисления'
                          : item.type === 'MANUAL_ADJUSTMENT'
                            ? 'Ручная корректировка'
                            : 'Перенос баллов'}
                    </span>
                    <span>
                      {item.seasonName} ·{' '}
                      {new Date(item.createdAt).toLocaleDateString('ru-RU')}
                    </span>
                    <span>
                      {item.points.startsWith('-') ? '' : '+'}
                      {pointsText(item.points)} баллов
                    </span>
                  </li>
                ))}
              </ul>
              <PageControls
                page={scorePage}
                hasNext={
                  scoreTransactions.items.length === scoreTransactions.pageSize
                }
                onPage={(page) => {
                  setScoreTransactions(undefined);
                  setScorePage(page);
                }}
              />
            </section>
          )}
        </>
      )}
    </main>
  );
};

const PageControls = ({
  page,
  hasNext,
  onPage,
}: {
  page: number;
  hasNext: boolean;
  onPage: (page: number) => void;
}) => (
  <div className="mos-active-pages">
    <button
      type="button"
      disabled={page === 1}
      onClick={() => onPage(page - 1)}
    >
      Назад
    </button>
    <button type="button" disabled={!hasNext} onClick={() => onPage(page + 1)}>
      Далее
    </button>
  </div>
);
