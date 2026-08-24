import type {
  PublicEventResponse,
  PublicRegistrationResponse,
  TicketResponse,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useEffect, useState, type FormEvent } from 'react';

import { PublicApiError, publicApi } from './api-client.js';
import {
  RegistrationFormError,
  registrationValues,
} from './registration-values.js';

type Route =
  | { kind: 'event'; slug: string }
  | { kind: 'ticket'; publicId: string; signature: string }
  | { kind: 'home' };

export const App = () => {
  const route = currentRoute();
  if (route.kind === 'event') return <EventPage slug={route.slug} />;
  if (route.kind === 'ticket') {
    return <TicketPage publicId={route.publicId} signature={route.signature} />;
  }
  return <HomePage />;
};

const EventPage = ({ slug }: { slug: string }) => {
  const [event, setEvent] = useState<PublicEventResponse>();
  const [result, setResult] = useState<PublicRegistrationResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void publicApi
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
    return () => {
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
            После регистрации билет придёт на email. Поля со звёздочкой
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
  <header className="event-hero">
    <div className="brand-mark" aria-hidden="true">
      КАИТ №20
    </div>
    <div className="hero-content">
      <p className="eyebrow">Мероприятие КАИТ №20</p>
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
  const [personType, setPersonType] = useState<
    'KAIT_STUDENT' | 'KAIT_TEACHER' | 'EXTERNAL_STUDENT' | 'EXTERNAL_TEACHER'
  >('KAIT_STUDENT');
  const submit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    void onSubmit(new FormData(formEvent.currentTarget));
  };
  return (
    <form className="registration-form" onSubmit={submit} noValidate={false}>
      <fieldset>
        <legend>Основная информация</legend>
        <div className="form-grid">
          <TextField name="lastName" label="Фамилия" required maxLength={100} />
          <TextField name="firstName" label="Имя" required maxLength={100} />
          <TextField name="middleName" label="Отчество" maxLength={100} />
          <TextField
            name="birthDate"
            label="Дата рождения"
            type="date"
            required
          />
          <TextField name="email" label="Email" type="email" required />
          <TextField
            name="phone"
            label="Телефон"
            type="tel"
            placeholder="+7 999 000-00-00"
            required
          />
          <label>
            <span>Статус участника *</span>
            <select
              name="personType"
              value={personType}
              onChange={(changeEvent) =>
                setPersonType(changeEvent.target.value as typeof personType)
              }
            >
              <option value="KAIT_STUDENT">Студент КАИТ №20</option>
              <option value="KAIT_TEACHER">Преподаватель КАИТ №20</option>
              <option value="EXTERNAL_STUDENT">
                Студент другой организации
              </option>
              <option value="EXTERNAL_TEACHER">
                Преподаватель другой организации
              </option>
            </select>
          </label>
          {personType.endsWith('_STUDENT') && (
            <TextField
              name="studyGroup"
              label="Учебная группа"
              required
              maxLength={100}
            />
          )}
          {personType.startsWith('EXTERNAL_') && (
            <TextField
              name="organization"
              label="Образовательная организация"
              required
              maxLength={255}
            />
          )}
        </div>
      </fieldset>

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

      <label className="consent-row">
        <input name="consentAccepted" type="checkbox" required />
        <span>
          Я согласен(на) на обработку персональных данных в соответствии с{' '}
          <a href={event.consentUrl} target="_blank" rel="noreferrer">
            условиями обработки
          </a>
          . *
        </span>
      </label>
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Регистрируем…' : 'Получить билет'}
      </Button>
      <p className="form-footnote">
        Если вы уже зарегистрированы, новая запись не создастся — билет будет
        отправлен повторно.
      </p>
    </form>
  );
};

type PublicField = PublicEventResponse['formFields'][number];

const DynamicField = ({ field }: { field: PublicField }) => {
  const name = `field-${field.id}`;
  const label = `${field.label}${field.required ? ' *' : ''}`;
  if (field.type === 'BOOLEAN') {
    return (
      <label className="choice-row">
        <input name={name} type="checkbox" required={field.required} />
        <span>{label}</span>
      </label>
    );
  }
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

const TextField = ({
  label,
  required = false,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'required'> & {
  label: string;
  required?: boolean;
}) => (
  <label>
    <span>
      {label}
      {required ? ' *' : ''}
    </span>
    <input {...props} required={required} />
  </label>
);

const RegistrationSuccess = ({
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
          : 'Вы уже зарегистрированы'}
      </p>
      <h1>{event.title}</h1>
      <p>
        {result.status === 'REGISTERED'
          ? 'Мы отправили билет на указанный email.'
          : 'Новую регистрацию создавать не стали. Билет отправлен повторно.'}
      </p>
      <a className="primary-link" href={result.ticketUrl} rel="noreferrer">
        Открыть билет
      </a>
      <p className="muted">Сохраните письмо или эту ссылку до мероприятия.</p>
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

const HomePage = () => (
  <main className="centered-page">
    <section className="home-card">
      <p className="eyebrow">КАИТ №20</p>
      <h1>Регистрация на мероприятия</h1>
      <p>
        Откройте персональную ссылку мероприятия, которую получили от
        организаторов.
      </p>
    </section>
  </main>
);

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
  return { kind: 'home' };
};

const messageForError = (error: unknown): string => {
  if (error instanceof RegistrationFormError) return error.message;
  if (error instanceof PublicApiError) {
    const messages: Record<string, string> = {
      EVENT_NOT_FOUND: 'Мероприятие не найдено',
      REGISTRATION_CLOSED: 'Регистрация закрыта',
      CAPACITY_FULL: 'Свободных мест больше нет',
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
