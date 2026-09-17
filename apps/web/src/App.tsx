import type {
  PublicEventResponse,
  PublicEventSummary,
  PublicRegistrationResponse,
  TicketResponse,
} from '@event-registration/contracts';
import {
  Button,
  BooleanQuestion,
  RegistrationSystemFields,
  ConsentCheckbox,
} from '@event-registration/ui';
import { StreamSelector } from './EventStreams.js';
import { defaultSystemFields } from '@event-registration/contracts';
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';

import { PublicApiError, publicApi, publicMediaUrl } from './api-client.js';
import {
  RegistrationFormError,
  registrationValues,
} from './registration-values.js';

type Route =
  | { kind: 'admin' }
  | { kind: 'events' }
  | { kind: 'event'; slug: string }
  | { kind: 'ticket'; publicId: string; signature: string }
  | { kind: 'password-reset'; token: string }
  | { kind: 'invitation'; token: string }
  | { kind: 'password-forgot' }
  | { kind: 'home' };

export const App = () => {
  const route = currentRoute();
  let page: React.ReactNode;
  if (route.kind === 'admin') {
    page = (
      <Suspense fallback={<LoadingPage text="Открываем кабинет…" />}>
        <AdminApp />
      </Suspense>
    );
  } else if (route.kind === 'events') page = <EventCatalogPage />;
  else if (route.kind === 'event') page = <EventPage slug={route.slug} />;
  else if (route.kind === 'ticket')
    page = <TicketPage publicId={route.publicId} signature={route.signature} />;
  else if (route.kind === 'password-reset' || route.kind === 'invitation')
    page = <AuthLinkPage kind={route.kind} token={route.token} />;
  else if (route.kind === 'password-forgot') page = <PasswordForgotPage />;
  else page = <HomePage />;
  return (
    <>
      <BrandLogo />
      {page}
    </>
  );
};

const BrandLogo = () => (
  <header className="site-header">
    <a className="global-brand" href="/" aria-label="На главную КАИТ №20">
      <img src="/kait20-logo.png" alt="КАИТ №20" />
    </a>
  </header>
);

const PasswordForgotPage = () => {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <main className="registration-shell">
      <section className="registration-panel compact-panel">
        <p className="eyebrow">Безопасность учётной записи</p>
        <h1>Восстановление пароля</h1>
        {sent ? (
          <Message kind="notice">
            Если активная учётная запись существует, инструкция отправлена на
            указанный адрес.
          </Message>
        ) : (
          <form
            className="registration-form"
            onSubmit={(event) => {
              event.preventDefault();
              const email = String(
                new FormData(event.currentTarget).get('email') ?? '',
              );
              void publicApi
                .forgotPassword(email)
                .then(() => setSent(true))
                .catch((caught) => setError(messageForError(caught)));
            }}
          >
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            {error ? <Message kind="error">{error}</Message> : null}
            <Button type="submit">Отправить инструкцию</Button>
          </form>
        )}
      </section>
    </main>
  );
};

const AuthLinkPage = ({
  kind,
  token,
}: {
  kind: 'password-reset' | 'invitation';
  token: string;
}) => {
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [destination, setDestination] = useState('/admin');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const password = String(values.get('password') ?? '');
    const confirmation = String(values.get('confirmation') ?? '');
    if (password.length < 12 || password !== confirmation) {
      setError(
        'Пароль должен содержать минимум 12 символов, а значения — совпадать',
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (kind === 'invitation') {
        const result = await publicApi.acceptInvitation(token, password);
        setDestination(result.role === 'SCANNER' ? '/scanner' : '/admin');
      } else await publicApi.resetPassword(token, password);
      setMessage('Пароль сохранён. Теперь можно войти в рабочий интерфейс.');
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="registration-shell">
      <section className="registration-panel compact-panel">
        <p className="eyebrow">Безопасность учётной записи</p>
        <h1>
          {kind === 'invitation' ? 'Активация сотрудника' : 'Новый пароль'}
        </h1>
        {message ? (
          <>
            <Message kind="notice">{message}</Message>
            <a className="primary-link" href={destination}>
              Перейти ко входу
            </a>
          </>
        ) : (
          <form
            className="registration-form"
            onSubmit={(event) => void submit(event)}
          >
            <label>
              Новый пароль
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Повторите пароль
              <input
                name="confirmation"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            {error ? <Message kind="error">{error}</Message> : null}
            <Button type="submit" disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сохранить пароль'}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
};

const AdminApp = lazy(async () => {
  const module = await import('./AdminApp.js');
  return { default: module.AdminApp };
});

const EventPage = ({ slug }: { slug: string }) => {
  const [event, setEvent] = useState<PublicEventResponse>();
  const [result, setResult] = useState<PublicRegistrationResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      publicApi
        .event(slug)
        .then((response) => {
          if (cancelled) return;
          setEvent(response);
          document.title = `${response.title} — регистрация`;
        })
        .catch((caught: unknown) => {
          if (!cancelled) setError(messageForError(caught));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    return () => {
      window.clearInterval(interval);
      cancelled = true;
    };
  }, [slug]);

  const submit = async (values: FormData) => {
    if (!event) return;
    setSubmitting(true);
    setError(undefined);
    try {
      setResult(
        await publicApi.register(slug, registrationValues(values, event)),
      );
    } catch (caught) {
      setError(messageForError(caught));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingPage text="Загружаем мероприятие…" />;
  if (!event) return <ErrorPage message={error ?? 'Мероприятие не найдено'} />;
  if (result) return <RegistrationSuccess event={event} result={result} />;

  return (
    <main className="public-page">
      <EventHero event={event} />
      <section className="registration-panel" aria-labelledby="form-title">
        <div className="section-heading">
          <p className="eyebrow">Регистрация</p>
          <h2 id="form-title">
            {event.availability === 'OPEN'
              ? 'Заполните данные участника'
              : availabilityMessage(event.availability)}
          </h2>
          <p>
            Если вы укажете email, на него придёт билет. Поля со звёздочкой
            обязательны.
          </p>
        </div>
        {error && <Message kind="error">{error}</Message>}
        {event.availability === 'OPEN' ? (
          <RegistrationForm
            event={event}
            submitting={submitting}
            onSubmit={submit}
          />
        ) : (
          <Message kind="notice">
            {availabilityMessage(event.availability)}
          </Message>
        )}
      </section>
      <PrivacyNote />
    </main>
  );
};

const EventHero = ({ event }: { event: PublicEventResponse }) => (
  <header
    className={`event-hero ${event.coverObjectKey ? 'has-cover' : ''}`}
    style={
      event.coverObjectKey
        ? {
            backgroundImage: `linear-gradient(90deg, rgb(20 21 70 / 92%), rgb(43 44 124 / 58%)), url("${publicMediaUrl(event.coverObjectKey)}")`,
          }
        : undefined
    }
  >
    <div className="hero-content">
      <p className="eyebrow">Мероприятие КАИТ №20</p>
      <EventStatusLabel status={event.effectiveStatus} />
      {event.direction && (
        <span className="event-direction">{event.direction}</span>
      )}
      <h1>{event.title}</h1>
      {event.description && <p className="description">{event.description}</p>}
      <dl className="event-facts">
        <div>
          <dt>Когда</dt>
          <dd>{formatPeriod(event.startAt, event.endAt, event.timezone)}</dd>
        </div>
        <div>
          <dt>Где</dt>
          <dd>{event.location}</dd>
        </div>
      </dl>
    </div>
  </header>
);

export const RegistrationForm = ({
  event,
  submitting,
  onSubmit,
}: {
  event: PublicEventResponse;
  submitting: boolean;
  onSubmit: (values: FormData) => Promise<void>;
}) => {
  const [requestId] = useState(() => crypto.randomUUID());
  const submit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    void onSubmit(new FormData(formEvent.currentTarget));
  };
  return (
    <form className="registration-form" onSubmit={submit} noValidate={false}>
      {event.streamsEnabled && <StreamSelector streams={event.streams ?? []} />}
      <input type="hidden" name="requestId" value={requestId} />
      <RegistrationSystemFields
        fields={event.systemFields ?? defaultSystemFields('public', true)}
        allowedTypes={event.allowedPersonTypes}
        disabled={submitting}
      />

      {event.formFields.length > 0 && (
        <fieldset>
          <legend>Дополнительные вопросы</legend>
          <div className="dynamic-fields">
            {event.formFields.map((field) => (
              <DynamicField key={field.id} field={field} />
            ))}
          </div>
        </fieldset>
      )}

      <ConsentCheckbox
        consentUrl={event.consentUrl}
        privacyPolicyUrl={event.privacyPolicyUrl}
      />
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Регистрируем…' : 'Получить билет'}
      </Button>
      <p className="form-footnote">
        Сохраните билет после регистрации. Если email не указан, письмо с
        билетом не придёт.
      </p>
    </form>
  );
};

type PublicField = PublicEventResponse['formFields'][number];

const DynamicField = ({ field }: { field: PublicField }) => {
  const name = `field-${field.id}`;
  const label = `${field.label}${field.required ? ' *' : ''}`;
  if (field.type === 'BOOLEAN')
    return (
      <BooleanQuestion
        name={name}
        label={field.label}
        required={field.required}
      />
    );
  if (field.type === 'SINGLE_CHOICE') {
    return (
      <label>
        <span>{label}</span>
        <select name={name} required={field.required} defaultValue="">
          <option value="">Выберите вариант</option>
          {field.options?.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === 'MULTI_CHOICE') {
    return (
      <div className="choice-group" role="group" aria-label={field.label}>
        <p>{label}</p>
        {field.options?.map((option) => (
          <label className="choice-row" key={option}>
            <input name={name} type="checkbox" value={option} />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <label>
      <span>{label}</span>
      {field.type === 'LONG_TEXT' ? (
        <textarea name={name} required={field.required} maxLength={20_000} />
      ) : (
        <input name={name} required={field.required} maxLength={20_000} />
      )}
    </label>
  );
};

export const RegistrationSuccess = ({
  event,
  result,
}: {
  event: PublicEventResponse;
  result: PublicRegistrationResponse;
}) => (
  <main className="centered-page">
    <section className="success-card">
      <span className="success-icon" aria-hidden="true">
        ✓
      </span>
      <p className="eyebrow">
        {result.status === 'REGISTERED'
          ? 'Регистрация завершена'
          : 'Регистрация уже существует'}
      </p>
      <h1>{event.title}</h1>
      {result.status === 'REGISTERED' ? (
        <>
          <p>
            Откройте и сохраните билет. Если вы указали email, письмо поставлено
            в очередь отправки; его доставка может занять некоторое время.
          </p>
          <a className="primary-link" href={result.ticketUrl} rel="noreferrer">
            Открыть билет
          </a>
          <p className="muted">
            Сохраните письмо или эту ссылку до мероприятия.
          </p>
        </>
      ) : (
        <p>
          {result.recoveryQueued
            ? 'Билет повторно отправлен на email, который был указан при первоначальной регистрации. Мы не изменили сохранённые данные.'
            : 'Мы не изменили сохранённые данные. Чтобы получить билет или скорректировать регистрацию, обратитесь к организатору мероприятия.'}
        </p>
      )}
    </section>
  </main>
);

const TicketPage = ({
  publicId,
  signature,
}: {
  publicId: string;
  signature: string;
}) => {
  const [ticket, setTicket] = useState<TicketResponse>();
  const [qrImage, setQrImage] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    void publicApi
      .ticket(publicId, signature)
      .then(async (response) => {
        const { default: QRCode } = await import('qrcode');
        const image = await QRCode.toDataURL(response.qrPayload, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 480,
        });
        if (cancelled) return;
        setTicket(response);
        setQrImage(image);
        document.title = `Билет — ${response.event.title}`;
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(messageForError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [publicId, signature]);

  if (error) return <ErrorPage message={error} />;
  if (!ticket || !qrImage) return <LoadingPage text="Открываем билет…" />;
  return <TicketCard ticket={ticket} qrImage={qrImage} />;
};

export const TicketCard = ({
  ticket,
  qrImage,
}: {
  ticket: TicketResponse;
  qrImage: string;
}) => (
  <main className="ticket-page">
    <article className="ticket-card">
      <header>
        <p className="eyebrow">Билет участника</p>
        <h1>{ticket.event.title}</h1>
        {ticket.event.streamTitle && <p>{ticket.event.streamTitle}</p>}
      </header>
      <img className="ticket-qr" src={qrImage} alt="QR-код билета" />
      <section className="ticket-details">
        <h2>{fullName(ticket.participantName)}</h2>
        <p>
          {formatPeriod(
            ticket.event.startAt,
            ticket.event.endAt,
            ticket.event.timezone,
          )}
        </p>
        <p>{ticket.event.location}</p>
      </section>
      <p className="ticket-hint">Покажите этот QR-код сотруднику на входе.</p>
    </article>
  </main>
);

const usePublicEvents = () => {
  const [events, setEvents] = useState<PublicEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      publicApi
        .events()
        .then((response) => {
          if (!cancelled) setEvents(response.items);
        })
        .catch((caught: unknown) => {
          if (!cancelled) setError(messageForError(caught));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    return () => {
      window.clearInterval(interval);
      cancelled = true;
    };
  }, []);
  return { events, loading, error };
};

const HomePage = () => {
  const { events, loading, error } = usePublicEvents();
  const featured = events.slice(0, 4);
  return (
    <main className="calendar-page">
      <header className="calendar-hero">
        <p className="eyebrow">Открытые мероприятия КАИТ №20</p>
        <h1>Учитесь, пробуйте, участвуйте</h1>
        <p>Выберите интересное событие и зарегистрируйтесь онлайн.</p>
      </header>
      <section
        className="featured-events-section"
        aria-labelledby="featured-title"
      >
        <header className="public-section-heading">
          <div>
            <p className="eyebrow">Ближайшие события</p>
            <h2 id="featured-title">Мероприятия</h2>
          </div>
          <a className="catalog-link" href="/events">
            Все мероприятия <span aria-hidden="true">→</span>
          </a>
        </header>
        {loading && <p className="calendar-state">Загружаем мероприятия…</p>}
        {error && <Message kind="error">{error}</Message>}
        {!loading && !error && featured.length === 0 && <PublicEventsEmpty />}
        {featured.length > 0 && (
          <div className="compact-event-list">
            {featured.map((event) => (
              <CompactEventRow event={event} key={event.id} />
            ))}
          </div>
        )}
      </section>
      <footer className="calendar-footer">
        КАИТ №20 · Мастерство и профессионализм
      </footer>
    </main>
  );
};

const EventCatalogPage = () => {
  const { events, loading, error } = usePublicEvents();
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState('ALL');
  const [month, setMonth] = useState('ALL');
  const [location, setLocation] = useState('ALL');
  const directions = useMemo(
    () =>
      [
        ...new Set(events.map((event) => event.direction).filter(Boolean)),
      ] as string[],
    [events],
  );
  const months = useMemo(() => {
    const values = new Map<string, string>();
    for (const event of events)
      values.set(eventMonthKey(event), eventMonthLabel(event));
    return [...values.entries()];
  }, [events]);
  const locations = useMemo(
    () => [...new Set(events.map((event) => event.location))],
    [events],
  );
  const visible = useMemo(
    () => filterPublicEvents(events, { query, direction, month, location }),
    [events, query, direction, month, location],
  );
  const hasFilters =
    query.trim() !== '' ||
    direction !== 'ALL' ||
    month !== 'ALL' ||
    location !== 'ALL';
  return (
    <main className="catalog-page">
      <a className="back-link" href="/">
        ← На главную
      </a>
      <header className="catalog-hero">
        <p className="eyebrow">Афиша КАИТ №20</p>
        <h1>Все мероприятия</h1>
        <p>
          Найдите событие по названию, категории, месяцу или месту проведения.
        </p>
      </header>
      <section
        className="catalog-filters"
        aria-label="Поиск и фильтры мероприятий"
      >
        <label className="catalog-search">
          <span>Поиск</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название, описание или место"
          />
        </label>
        <label>
          <span>Категория</span>
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
          >
            <option value="ALL">Все категории</option>
            {directions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Месяц</span>
          <select
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          >
            <option value="ALL">Любой месяц</option>
            {months.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Место</span>
          <select
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          >
            <option value="ALL">Любое место</option>
            {locations.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        {hasFilters && (
          <button
            className="clear-filters"
            type="button"
            onClick={() => {
              setQuery('');
              setDirection('ALL');
              setMonth('ALL');
              setLocation('ALL');
            }}
          >
            Сбросить фильтры
          </button>
        )}
      </section>
      <div className="catalog-results-heading" aria-live="polite">
        <strong>{visible.length}</strong> {eventCountLabel(visible.length)}
      </div>
      {loading && <p className="calendar-state">Загружаем мероприятия…</p>}
      {error && <Message kind="error">{error}</Message>}
      {!loading && !error && visible.length === 0 && (
        <section className="calendar-empty">
          <h2>
            {hasFilters ? 'Ничего не найдено' : 'Скоро появятся новые события'}
          </h2>
          <p>
            {hasFilters
              ? 'Измените запрос или сбросьте часть фильтров.'
              : 'Сейчас нет опубликованных предстоящих мероприятий.'}
          </p>
        </section>
      )}
      <section
        className="calendar-event-grid"
        aria-label="Найденные мероприятия"
      >
        {visible.map((event) => (
          <PublicEventCard event={event} key={event.id} />
        ))}
      </section>
    </main>
  );
};

type CatalogFilters = {
  query: string;
  direction: string;
  month: string;
  location: string;
};

export const filterPublicEvents = (
  events: PublicEventSummary[],
  filters: CatalogFilters,
) => {
  const query = filters.query.trim().toLocaleLowerCase('ru-RU');
  return events.filter((event) => {
    const searchable = [
      event.title,
      event.description,
      event.location,
      event.direction,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('ru-RU');
    return (
      (!query || searchable.includes(query)) &&
      (filters.direction === 'ALL' || event.direction === filters.direction) &&
      (filters.month === 'ALL' || eventMonthKey(event) === filters.month) &&
      (filters.location === 'ALL' || event.location === filters.location)
    );
  });
};

const CompactEventRow = ({ event }: { event: PublicEventSummary }) => (
  <article className="compact-event-row">
    <time dateTime={event.startAt} className="compact-event-date">
      <strong>{eventDateParts(event).day}</strong>
      <span>{shortMonth(event)}</span>
    </time>
    <div>
      <EventStatusLabel status={event.effectiveStatus} />
      <div className="event-card-meta">
        <span>{eventDateParts(event).label}</span>
        {event.direction && <span>{event.direction}</span>}
      </div>
      <h3>
        <a href={`/events/${encodeURIComponent(event.slug)}`}>{event.title}</a>
      </h3>
      <p>{event.location}</p>
    </div>
    <a
      className="compact-event-action"
      href={`/events/${encodeURIComponent(event.slug)}`}
      aria-label={`Открыть мероприятие «${event.title}»`}
    >
      <span aria-hidden="true">→</span>
    </a>
  </article>
);

const PublicEventsEmpty = () => (
  <section className="calendar-empty">
    <h2>Скоро здесь появятся новые события</h2>
    <p>Сейчас нет мероприятий с открытой регистрацией.</p>
  </section>
);

const zonedDateParts = (value: string, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: number('year'), month: number('month'), day: number('day') };
};

const PublicEventCard = ({ event }: { event: PublicEventSummary }) => (
  <article className="public-event-card">
    <a
      className="event-cover"
      href={`/events/${encodeURIComponent(event.slug)}`}
    >
      {event.coverObjectKey ? (
        <img src={publicMediaUrl(event.coverObjectKey)} alt="" />
      ) : (
        <span aria-hidden="true">{eventDateParts(event).day}</span>
      )}
    </a>
    <div className="public-event-content">
      <EventStatusLabel status={event.effectiveStatus} />
      <div className="event-card-meta">
        <time dateTime={event.startAt}>{eventDateParts(event).label}</time>
        {event.direction && <span>{event.direction}</span>}
      </div>
      <h3>
        <a href={`/events/${encodeURIComponent(event.slug)}`}>{event.title}</a>
      </h3>
      {event.description && <p>{event.description}</p>}
      <p className="event-location">{event.location}</p>
      <a
        className="event-register-link"
        href={`/events/${encodeURIComponent(event.slug)}`}
      >
        Подробнее и регистрация <span aria-hidden="true">→</span>
      </a>
    </div>
  </article>
);

const eventDateParts = (event: PublicEventSummary) => {
  const date = new Date(event.startAt);
  return {
    day: new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      timeZone: event.timezone,
    }).format(date),
    label: new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: event.timezone,
    }).format(date),
  };
};

const shortMonth = (event: PublicEventSummary) =>
  new Intl.DateTimeFormat('ru-RU', {
    month: 'short',
    timeZone: event.timezone,
  })
    .format(new Date(event.startAt))
    .replace('.', '');

const eventMonthKey = (event: PublicEventSummary) => {
  const parts = zonedDateParts(event.startAt, event.timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
};

const eventMonthLabel = (event: PublicEventSummary) =>
  new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
    timeZone: event.timezone,
  }).format(new Date(event.startAt));

const eventCountLabel = (count: number) => {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'мероприятий';
  if (last === 1) return 'мероприятие';
  if (last >= 2 && last <= 4) return 'мероприятия';
  return 'мероприятий';
};

const LoadingPage = ({ text }: { text: string }) => (
  <main className="centered-page" aria-busy="true">
    <p className="loading-label">{text}</p>
  </main>
);

const ErrorPage = ({ message }: { message: string }) => (
  <main className="centered-page">
    <section className="error-card">
      <p className="eyebrow">Не удалось открыть страницу</p>
      <h1>{message}</h1>
      <p>Проверьте ссылку или попробуйте ещё раз позднее.</p>
    </section>
  </main>
);

const Message = ({
  kind,
  children,
}: {
  kind: 'error' | 'notice';
  children: React.ReactNode;
}) => (
  <div
    className={`message ${kind}`}
    role={kind === 'error' ? 'alert' : 'status'}
  >
    {children}
  </div>
);

const PrivacyNote = () => (
  <footer className="privacy-note">
    Данные используются только для организации участия в мероприятии. QR-код не
    содержит ФИО, email или телефон в открытом виде.
  </footer>
);

const currentRoute = (): Route => {
  const parts =
    typeof window === 'undefined'
      ? []
      : window.location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'admin') return { kind: 'admin' };
  if (parts[0] === 'events' && !parts[1]) return { kind: 'events' };
  if (parts[0] === 'events' && parts[1]) {
    return { kind: 'event', slug: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === 'tickets' && parts[1] && parts[2]) {
    return {
      kind: 'ticket',
      publicId: decodeURIComponent(parts[1]),
      signature: decodeURIComponent(parts[2]),
    };
  }
  if (parts[0] === 'auth' && parts[1] === 'password-reset' && parts[2]) {
    return { kind: 'password-reset', token: decodeURIComponent(parts[2]) };
  }
  if (parts[0] === 'auth' && parts[1] === 'password-forgot') {
    return { kind: 'password-forgot' };
  }
  if (parts[0] === 'auth' && parts[1] === 'invitation' && parts[2]) {
    return { kind: 'invitation', token: decodeURIComponent(parts[2]) };
  }
  return { kind: 'home' };
};

const messageForError = (error: unknown): string => {
  if (error instanceof RegistrationFormError) return error.message;
  if (error instanceof PublicApiError) {
    const messages: Record<string, string> = {
      EVENT_NOT_FOUND: 'Мероприятие не найдено',
      REGISTRATION_CLOSED: 'Регистрация закрыта',
      CAPACITY_FULL: 'Свободных мест больше нет',
      STREAM_REQUIRED: 'Выберите поток мероприятия',
      STREAM_INVALID:
        'Этот поток недоступен. Обновите страницу и выберите другой',
      STREAM_ALREADY_SELECTED:
        'Вы уже записаны в другой поток этого мероприятия. Для изменения обратитесь к организатору',
      PARTICIPANT_TYPE_NOT_ALLOWED:
        'Мероприятие недоступно для выбранного типа участника',
      FORM_VERSION_INVALID:
        'Форма изменилась. Обновите страницу и попробуйте снова',
      VALIDATION_ERROR: 'Проверьте правильность заполнения формы',
      RATE_LIMITED: 'Слишком много попыток. Попробуйте немного позже',
      INVALID_QR: 'Билет недействителен',
      NETWORK_ERROR: 'Нет соединения с сервером',
    };
    return messages[error.code] ?? 'Не удалось выполнить запрос';
  }
  return 'Произошла непредвиденная ошибка';
};

const availabilityMessage = (
  availability: PublicEventResponse['availability'],
) =>
  availability === 'FULL'
    ? 'Все места уже заняты'
    : 'Регистрация на мероприятие закрыта';

const formatPeriod = (start: string, end: string, timezone: string): string => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const date = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeZone: timezone,
  }).format(startDate);
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });
  return `${date}, ${time.format(startDate)}–${time.format(endDate)}`;
};

const fullName = (name: TicketResponse['participantName']): string =>
  [name.lastName, name.firstName, name.middleName].filter(Boolean).join(' ');

export const EventStatusLabel = ({
  status,
}: {
  status: PublicEventSummary['effectiveStatus'];
}) =>
  status ? (
    <span className={`event-status event-status-${status.toLowerCase()}`}>
      {
        {
          DRAFT: 'Черновик',
          REGISTRATION_OPEN: 'Регистрация открыта',
          REGISTRATION_CLOSED: 'Регистрация закрыта',
          ACTIVE: 'Мероприятие идёт',
          COMPLETED: 'Мероприятие завершено',
          ARCHIVED: 'Архив',
        }[status]
      }
    </span>
  ) : null;
