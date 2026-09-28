import type {
  PublicParticipationList,
  PublicProfile,
  PublicStudentList,
  PublicLeaderboardSeasons,
  LeaderboardResponse,
} from '@event-registration/contracts';
import { useEffect, useState, type FormEvent } from 'react';

import { PublicApiError, publicApi } from './api-client.js';

const pointsText = (value: string) => value.replace(/\.?0+$/, '');

const loadError = (error: unknown) =>
  error instanceof PublicApiError && error.code === 'RATE_LIMITED'
    ? 'Слишком много запросов. Попробуйте через минуту.'
    : 'Не удалось загрузить данные. Обновите страницу и попробуйте снова.';

const catalogParams = () =>
  new URLSearchParams(
    typeof window === 'undefined' ? '' : window.location.search,
  );

const initialQuery = () => {
  const value = catalogParams().get('q')?.trim() ?? '';
  return value.length >= 2 && value.length <= 80 ? value : '';
};

const boundedOffset = (value: string | null) => {
  const number = Number(value);
  return value && Number.isInteger(number) && number >= 0 && number <= 10_000
    ? number
    : 0;
};

const boundedPage = (value: string | null) => {
  const number = Number(value);
  return value && Number.isInteger(number) && number >= 1 && number <= 401
    ? number
    : 1;
};

const replaceParams = (changes: Record<string, string | null>) => {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(changes)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.replaceState(null, '', url);
};

const profileHref = (slug: string) => {
  const params = catalogParams();
  params.delete('page');
  params.delete('history');
  return `/mos-active/students/${encodeURIComponent(slug)}?${params.toString()}`;
};

const catalogHref = () => {
  const params = catalogParams();
  params.delete('page');
  params.delete('history');
  const search = params.toString();
  return `/mos-active${search ? `?${search}` : ''}`;
};

const MosActiveLeaderboard = () => {
  const [seasons, setSeasons] = useState<PublicLeaderboardSeasons>();
  const [seasonId, setSeasonId] = useState('');
  const [ranking, setRanking] = useState<LeaderboardResponse>();
  const [offset, setOffset] = useState(() =>
    boundedOffset(catalogParams().get('rankOffset')),
  );
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    publicApi
      .leaderboardSeasons()
      .then((result) => {
        if (!cancelled) {
          setSeasons(result);
          const requested = catalogParams().get('season');
          const selected =
            result.items.find((item) => item.id === requested)?.id ??
            result.items[0]?.id ??
            '';
          setSeasonId(selected);
          if (selected) replaceParams({ season: selected });
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
              replaceParams({ season: event.target.value, rankOffset: null });
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
        <p>Опубликованных профилей пока нет.</p>
      )}
      {ranking && ranking.items.length > 0 && (
        <>
          <ol className="mos-active-list mos-active-ranking" start={offset + 1}>
            {ranking.items.map((item) => (
              <li key={item.publicSlug}>
                <a href={profileHref(item.publicSlug)}>
                  <strong>
                    {item.rank}. {item.displayName}
                  </strong>
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
                const next = Math.max(0, offset - ranking.limit);
                setOffset(next);
                replaceParams({
                  season: seasonId,
                  rankOffset: next ? String(next) : null,
                });
              }}
            >
              Назад
            </button>
            <button
              type="button"
              disabled={!ranking.hasNext || offset >= 10_000}
              onClick={() => {
                setRanking(undefined);
                const next = offset + ranking.limit;
                setOffset(next);
                replaceParams({ season: seasonId, rankOffset: String(next) });
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
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [offset, setOffset] = useState(() =>
    boundedOffset(catalogParams().get('studentOffset')),
  );
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
  }, [query, offset, searchAttempt]);

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (input.trim().length === 1) {
      setError(
        'Введите минимум два символа или очистите поле для просмотра всех студентов.',
      );
      return;
    }
    setOffset(0);
    const next = input.trim();
    setQuery(next);
    replaceParams({ q: next, studentOffset: null });
    setSearchAttempt((current) => current + 1);
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
        <p>Рейтинг студентов и баллы за мероприятия.</p>
      </header>
      <nav className="mos-active-shortcuts" aria-label="На этой странице">
        <a href="#mos-active-ranking-title">Рейтинг студентов</a>
        <a href="#mos-active-query">Найти студента</a>
      </nav>
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
                <a href={profileHref(student.publicSlug)}>
                  <strong>{student.displayName}</strong>
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
                const next = Math.max(0, offset - data.limit);
                setOffset(next);
                replaceParams({ studentOffset: next ? String(next) : null });
              }}
            >
              Назад
            </button>
            <button
              type="button"
              disabled={!data.hasNext || offset >= 10_000}
              onClick={() => {
                setData(undefined);
                const next = offset + data.limit;
                setOffset(next);
                replaceParams({ studentOffset: String(next) });
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
  const [selectedSeason] = useState(() => catalogParams().get('season'));
  const [allHistory, setAllHistory] = useState(
    () => catalogParams().get('history') === 'all',
  );
  const [profile, setProfile] = useState<PublicProfile>();
  const [participations, setParticipations] =
    useState<PublicParticipationList>();
  const [participationPage, setParticipationPage] = useState(() =>
    boundedPage(catalogParams().get('page')),
  );
  const [participationAttempt, setParticipationAttempt] = useState(0);
  const [profileError, setProfileError] = useState<string>();
  const [participationError, setParticipationError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    publicApi
      .student(slug)
      .then((result) => {
        if (!cancelled) setProfile(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setProfileError(
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
    setParticipations(undefined);
    setParticipationError(undefined);
    publicApi
      .studentParticipations(
        slug,
        participationPage,
        allHistory ? undefined : (selectedSeason ?? undefined),
      )
      .then((result) => {
        if (!cancelled) setParticipations(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setParticipationError(loadError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [
    profile,
    slug,
    participationPage,
    participationAttempt,
    allHistory,
    selectedSeason,
  ]);

  const changeParticipationPage = (next: number) => {
    setParticipationPage(next);
    replaceParams({ page: next > 1 ? String(next) : null });
  };

  const toggleHistory = () => {
    const next = !allHistory;
    setAllHistory(next);
    setParticipationPage(1);
    replaceParams({ history: next ? 'all' : null, page: null });
  };

  return (
    <main className="catalog-page mos-active-page">
      <a className="back-link" href={catalogHref()}>
        ← Все студенты
      </a>
      {profileError && (
        <p role="alert" className="message error">
          {profileError}
        </p>
      )}
      {!profile && !profileError && (
        <p className="calendar-state">Загружаем профиль…</p>
      )}
      {profile && (
        <>
          <header className="catalog-hero">
            <p className="eyebrow">МосАктив · студент КАИТ №20</p>
            <h1>{profile.displayName}</h1>
            <p>Учебная группа: {profile.studyGroup ?? 'не указана'}</p>
            <p>Отделение/площадка: {profile.campus ?? 'не указана'}</p>
          </header>
          {selectedSeason && (
            <button
              type="button"
              className="secondary-button"
              onClick={toggleHistory}
            >
              {allHistory
                ? 'Показать начисления выбранного сезона'
                : 'Показать начисления за все сезоны'}
            </button>
          )}
          {participationError && (
            <div role="alert" className="message error">
              <p>{participationError}</p>
              <button
                type="button"
                onClick={() =>
                  setParticipationAttempt((current) => current + 1)
                }
              >
                Повторить загрузку начислений
              </button>
            </div>
          )}
          {!participations && !participationError && (
            <p className="calendar-state">Загружаем начисления…</p>
          )}
          {participations && (
            <section className="mos-active-section">
              <h2>
                {selectedSeason && !allHistory
                  ? 'Баллы за мероприятия выбранного сезона'
                  : 'Баллы за мероприятия — все сезоны'}
              </h2>
              {participations.items.length === 0 && (
                <p>Начислений за мероприятия пока нет.</p>
              )}
              <ul>
                {participations.items.map((item, index) => (
                  <li key={`${item.eventTitle}-${index}`}>
                    <strong>{item.eventTitle}</strong>
                    <span>{pointsText(item.points)} баллов</span>
                  </li>
                ))}
              </ul>
              <PageControls
                page={participationPage}
                hasNext={participations.hasNext}
                onPage={changeParticipationPage}
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
