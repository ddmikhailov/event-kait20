import { Button } from '@event-registration/ui';
import type {
  FormFieldResponse,
  ScannerOnsiteRegistrationRequest,
} from '@event-registration/contracts';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiClientError, scannerApi } from './api-client.js';
import {
  scannerDatabase,
  type PendingAttendanceRecord,
  type PreparedEventRecord,
} from './offline-database.js';
import { QrCamera } from './QrCamera.js';
import {
  OfflineScannerError,
  scannerService,
  type AttendanceOutcome,
  type ScanResolution,
  type ScannerEvent,
} from './scanner-service.js';

type DisplayEvent = ScannerEvent & {
  prepared?: PreparedEventRecord | undefined;
};
type View = 'loading' | 'login' | 'events' | 'scanner';
type Feedback = {
  kind: 'success' | 'already' | 'error' | 'offline';
  text: string;
};

export const App = () => {
  const [view, setView] = useState<View>('loading');
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<DisplayEvent>();
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>();
  const [busy, setBusy] = useState(false);

  const loadEvents = useCallback(async () => {
    await scannerDatabase.clearExpired();
    const prepared = await scannerDatabase.preparedEvents.toArray();
    const preparedById = new Map(
      prepared.map((event) => [event.eventId, event]),
    );
    try {
      const session = await scannerApi.restoreSession();
      if (!session) {
        setView('login');
        return;
      }
      const response = await scannerApi.events();
      setEvents(
        response.items.map((event) => ({
          ...event,
          prepared: preparedById.get(event.id),
        })),
      );
      setView('events');
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'NETWORK_ERROR') {
        setEvents(prepared.map(preparedDisplayEvent));
        setFeedback({
          kind: 'offline',
          text: 'Сервер недоступен. Доступны только подготовленные мероприятия.',
        });
        setView(prepared.length > 0 ? 'events' : 'login');
        return;
      }
      setFeedback({ kind: 'error', text: messageForError(error) });
      setView('login');
    }
  }, []);

  useEffect(() => {
    void loadEvents();
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, [loadEvents]);

  useEffect(() => {
    if (!online || !selectedEvent || view !== 'scanner') return;
    let cancelled = false;
    void scannerService
      .reconnect(selectedEvent.id)
      .then(async () => {
        if (cancelled) return;
        setPendingCount(await scannerDatabase.pendingCount(selectedEvent.id));
        setFeedback({ kind: 'success', text: 'Данные синхронизированы' });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFeedback({ kind: 'error', text: messageForError(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [online, selectedEvent, view]);

  const login = async (email: string, password: string) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await scannerApi.login({ email, password });
      await loadEvents();
    } catch (error) {
      setFeedback({ kind: 'error', text: messageForError(error) });
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await scannerApi.logout().catch(() => undefined);
    } finally {
      await scannerDatabase.clearBusinessData();
      setEvents([]);
      setSelectedEvent(undefined);
      setFeedback(undefined);
      setView('login');
      setBusy(false);
    }
  };

  const prepareAndOpen = async (event: DisplayEvent) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      if (!event.prepared) {
        if (!online)
          throw new OfflineScannerError(
            'OFFLINE_NOT_READY',
            'Мероприятие не подготовлено',
          );
        await scannerService.prepareEvent(event);
      }
      const prepared = await scannerDatabase.preparedEvents.get(event.id);
      const display = { ...event, prepared };
      setSelectedEvent(display);
      setPendingCount(await scannerDatabase.pendingCount(event.id));
      setView('scanner');
    } catch (error) {
      setFeedback({ kind: 'error', text: messageForError(error) });
    } finally {
      setBusy(false);
    }
  };

  if (view === 'loading') return <LoadingScreen />;
  if (view === 'login') {
    return <LoginScreen busy={busy} feedback={feedback} onLogin={login} />;
  }
  if (view === 'events') {
    return (
      <EventScreen
        events={events}
        online={online}
        busy={busy}
        feedback={feedback}
        onOpen={prepareAndOpen}
        onLogout={logout}
      />
    );
  }
  return selectedEvent ? (
    <ScannerScreen
      event={selectedEvent}
      online={online}
      pendingCount={pendingCount}
      feedback={feedback}
      onFeedback={setFeedback}
      onPendingCount={setPendingCount}
      onBack={() => {
        setSelectedEvent(undefined);
        setView('events');
        void loadEvents();
      }}
      onLogout={logout}
    />
  ) : null;
};

const LoginScreen = ({
  busy,
  feedback,
  onLogin,
}: {
  busy: boolean;
  feedback?: Feedback | undefined;
  onLogin: (email: string, password: string) => Promise<void>;
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">КАИТ №20</p>
        <h1>Scanner</h1>
        <p className="muted">Войдите под учётной записью сотрудника.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onLogin(email, password);
          }}
        >
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? 'Входим…' : 'Войти'}
          </Button>
        </form>
        {feedback && <FeedbackBanner feedback={feedback} />}
      </section>
    </main>
  );
};

const EventScreen = ({
  events,
  online,
  busy,
  feedback,
  onOpen,
  onLogout,
}: {
  events: DisplayEvent[];
  online: boolean;
  busy: boolean;
  feedback?: Feedback | undefined;
  onOpen: (event: DisplayEvent) => Promise<void>;
  onLogout: () => Promise<void>;
}) => (
  <main className="event-shell">
    <TopBar
      online={online}
      pendingCount={0}
      rejectedCount={0}
      onLogout={onLogout}
    />
    <header className="page-heading">
      <p className="eyebrow">Выбор мероприятия</p>
      <h1>Куда отмечаем вход?</h1>
    </header>
    {feedback && <FeedbackBanner feedback={feedback} />}
    <section className="event-grid" aria-label="Доступные мероприятия">
      {events.map((event) => (
        <article className="event-card" key={event.id}>
          <div>
            <span className={`readiness ${event.prepared ? 'ready' : ''}`}>
              {event.prepared ? 'OFFLINE READY' : 'ТРЕБУЕТ ПОДГОТОВКИ'}
            </span>
            <h2>{event.title}</h2>
            <p>{formatEventDate(event.startAt, event.timezone)}</p>
            <p>{event.location}</p>
          </div>
          <Button
            disabled={busy || (!online && !event.prepared)}
            onClick={() => void onOpen(event)}
          >
            {event.prepared ? 'Открыть' : 'Подготовить и открыть'}
          </Button>
        </article>
      ))}
      {events.length === 0 && (
        <p className="empty-state">Нет доступных подготовленных мероприятий.</p>
      )}
    </section>
  </main>
);

const ScannerScreen = ({
  event,
  online,
  pendingCount,
  feedback,
  onFeedback,
  onPendingCount,
  onBack,
  onLogout,
}: {
  event: DisplayEvent;
  online: boolean;
  pendingCount: number;
  feedback?: Feedback | undefined;
  onFeedback: (feedback?: Feedback | undefined) => void;
  onPendingCount: (count: number) => void;
  onBack: () => void;
  onLogout: () => Promise<void>;
}) => {
  const [participant, setParticipant] = useState<ScanResolution>();
  const [busy, setBusy] = useState(false);
  const [fastMode, setFastMode] = useState(false);
  const [manualQr, setManualQr] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ScanResolution[]>([]);
  const [rejected, setRejected] = useState<PendingAttendanceRecord[]>([]);
  const [confirmMode, setConfirmMode] = useState<
    'MANUAL_CONFIRM' | 'MANUAL_SEARCH'
  >('MANUAL_CONFIRM');
  const [formFields, setFormFields] = useState<FormFieldResponse[]>([]);
  const [formFieldsReady, setFormFieldsReady] = useState(false);

  const updatePending = useCallback(async () => {
    const [pending, rejectedItems] = await Promise.all([
      scannerDatabase.pendingCount(event.id),
      scannerDatabase.rejectedForEvent(event.id),
    ]);
    onPendingCount(pending);
    setRejected(rejectedItems);
  }, [event.id, onPendingCount]);

  useEffect(() => {
    void updatePending();
  }, [updatePending]);

  useEffect(() => {
    if (!online) return;
    setFormFieldsReady(false);
    void scannerApi
      .formFields(event.id)
      .then((response) => {
        setFormFields(response.items);
        setFormFieldsReady(true);
      })
      .catch((error: unknown) =>
        onFeedback({ kind: 'error', text: messageForError(error) }),
      );
  }, [event.id, online, onFeedback]);

  const record = useCallback(
    async (
      resolved: ScanResolution,
      mode: 'MANUAL_CONFIRM' | 'FAST_SCAN' | 'MANUAL_SEARCH',
    ) => {
      setBusy(true);
      try {
        const outcome = await scannerService.recordAttendance(
          event.id,
          resolved.registrationId,
          mode,
        );
        onFeedback(feedbackForOutcome(outcome));
        await updatePending();
        if (fastMode) {
          window.setTimeout(() => {
            setParticipant(undefined);
            onFeedback(undefined);
          }, 1_200);
        }
      } catch (error) {
        onFeedback({ kind: 'error', text: messageForError(error) });
      } finally {
        setBusy(false);
      }
    },
    [event.id, fastMode, onFeedback, updatePending],
  );

  const resolve = useCallback(
    async (qrPayload: string) => {
      if (busy || !qrPayload.trim()) return;
      setBusy(true);
      onFeedback(undefined);
      try {
        const resolved = await scannerService.resolveQr(
          event.id,
          qrPayload.trim(),
        );
        setParticipant(resolved);
        setConfirmMode('MANUAL_CONFIRM');
        if (fastMode) await record(resolved, 'FAST_SCAN');
      } catch (error) {
        onFeedback({ kind: 'error', text: messageForError(error) });
      } finally {
        setManualQr('');
        setBusy(false);
      }
    },
    [busy, event.id, fastMode, onFeedback, record],
  );

  const search = async () => {
    setBusy(true);
    try {
      setSearchResults(await scannerService.search(event.id, searchQuery));
    } catch (error) {
      onFeedback({ kind: 'error', text: messageForError(error) });
    } finally {
      setBusy(false);
    }
  };

  const registerOnsite = async (
    values: ScannerOnsiteRegistrationRequest,
    attendImmediately: boolean,
  ) => {
    setBusy(true);
    onFeedback(undefined);
    try {
      const result = await scannerApi.onsite(event.id, values);
      if (attendImmediately) {
        const outcome = await scannerService.recordAttendance(
          event.id,
          result.registrationId,
          'ONSITE_REGISTRATION',
        );
        onFeedback(feedbackForOutcome(outcome));
      } else {
        onFeedback({
          kind: result.status === 'REGISTERED' ? 'success' : 'already',
          text:
            result.status === 'REGISTERED'
              ? 'Участник зарегистрирован'
              : 'Регистрация уже существовала и обновлена',
        });
      }
      try {
        await scannerService.reconnect(event.id);
        await updatePending();
      } catch (error) {
        if (error instanceof ApiClientError && error.code === 'NETWORK_ERROR') {
          await updatePending();
          onFeedback({
            kind: 'offline',
            text: 'Участник сохранён. Локальный список обновится после восстановления связи.',
          });
        } else {
          throw error;
        }
      }
    } catch (error) {
      onFeedback({ kind: 'error', text: messageForError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="scanner-shell">
      <TopBar
        online={online}
        pendingCount={pendingCount}
        rejectedCount={rejected.length}
        onLogout={onLogout}
      />
      <header className="scanner-heading">
        <button className="text-button" onClick={onBack}>
          ← Назад
        </button>
        <div>
          <p className="eyebrow">{event.location}</p>
          <h1>{event.title}</h1>
        </div>
        <label className="mode-toggle">
          <input
            type="checkbox"
            checked={fastMode}
            onChange={(event) => setFastMode(event.target.checked)}
          />
          Быстрый режим
        </label>
      </header>

      {feedback && <FeedbackBanner feedback={feedback} />}
      <QrCamera
        active={!participant && !busy}
        onDecode={(value) => void resolve(value)}
      />

      {participant && (
        <ParticipantCard
          participant={participant}
          busy={busy}
          fastMode={fastMode}
          onConfirm={() => void record(participant, confirmMode)}
          onClose={() => {
            setParticipant(undefined);
            onFeedback(undefined);
          }}
        />
      )}

      <section className="scanner-tools">
        <details>
          <summary>Ввести QR вручную</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void resolve(manualQr);
            }}
          >
            <label>
              Содержимое QR
              <input
                value={manualQr}
                onChange={(event) => setManualQr(event.target.value)}
                autoComplete="off"
              />
            </label>
            <Button type="submit" disabled={busy || !manualQr.trim()}>
              Проверить
            </Button>
          </form>
        </details>
        <details>
          <summary>Найти участника</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <label>
              ФИО, телефон, email или группа
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy}>
              Найти
            </Button>
          </form>
          <div className="search-results">
            {searchResults.map((item) => (
              <button
                key={item.registrationId}
                className="search-result"
                onClick={() => {
                  setParticipant(item);
                  setConfirmMode('MANUAL_SEARCH');
                  setSearchResults([]);
                }}
              >
                <strong>{fullName(item)}</strong>
                <span>
                  {item.studyGroup ?? item.organization ?? 'Без группы'}
                </span>
              </button>
            ))}
          </div>
        </details>
        <details>
          <summary>Добавить участника на месте</summary>
          {online && formFieldsReady ? (
            <OnsiteRegistrationForm
              fields={formFields}
              busy={busy}
              onSubmit={registerOnsite}
            />
          ) : online ? (
            <p className="muted">Загружаем поля формы…</p>
          ) : (
            <p className="muted">
              Регистрация на месте доступна только при соединении с сервером.
            </p>
          )}
        </details>
      </section>
      {rejected.length > 0 && (
        <details className="rejected-sync">
          <summary>{rejected.length} отметок требуют проверки</summary>
          <ul>
            {rejected.map((item) => (
              <li key={item.clientEventId}>
                <span>{item.registrationId}</span>
                <strong>{item.rejectionStatus ?? 'SYNC_ERROR'}</strong>
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
};

const OnsiteRegistrationForm = ({
  fields,
  busy,
  onSubmit,
}: {
  fields: FormFieldResponse[];
  busy: boolean;
  onSubmit: (
    values: ScannerOnsiteRegistrationRequest,
    attendImmediately: boolean,
  ) => Promise<void>;
}) => {
  const [personType, setPersonType] =
    useState<ScannerOnsiteRegistrationRequest['personType']>('KAIT_STUDENT');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const optional = (name: string) =>
      String(form.get(name) ?? '').trim() || null;
    const customAnswers: ScannerOnsiteRegistrationRequest['customAnswers'] = [];
    for (const field of fields) {
      if (field.type === 'BOOLEAN') {
        customAnswers.push({
          fieldId: field.id,
          value: form.has(`field-${field.id}`),
        });
        continue;
      }
      if (field.type === 'MULTI_CHOICE') {
        const value = form
          .getAll(`field-${field.id}`)
          .map(String)
          .filter(Boolean);
        if (value.length > 0) customAnswers.push({ fieldId: field.id, value });
        continue;
      }
      const value = optional(`field-${field.id}`);
      if (value) customAnswers.push({ fieldId: field.id, value });
    }
    void onSubmit(
      {
        lastName: String(form.get('lastName') ?? ''),
        firstName: String(form.get('firstName') ?? ''),
        middleName: optional('middleName'),
        birthDate: String(form.get('birthDate') ?? ''),
        email: optional('email'),
        phone: String(form.get('phone') ?? ''),
        studyGroup: optional('studyGroup'),
        personType,
        organization: optional('organization'),
        customAnswers,
      },
      form.has('attendImmediately'),
    );
  };

  return (
    <form className="onsite-form" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Фамилия
          <input name="lastName" required maxLength={100} />
        </label>
        <label>
          Имя
          <input name="firstName" required maxLength={100} />
        </label>
        <label>
          Отчество
          <input name="middleName" maxLength={100} />
        </label>
        <label>
          Дата рождения
          <input name="birthDate" type="date" required />
        </label>
        <label>
          Телефон
          <input
            name="phone"
            type="tel"
            required
            placeholder="+7 999 000-00-00"
          />
        </label>
        <label>
          Email (необязательно)
          <input name="email" type="email" />
        </label>
        <label>
          Тип участника
          <select
            name="personType"
            value={personType}
            onChange={(event) =>
              setPersonType(
                event.target
                  .value as ScannerOnsiteRegistrationRequest['personType'],
              )
            }
          >
            <option value="KAIT_STUDENT">Студент КАИТ</option>
            <option value="KAIT_TEACHER">Преподаватель КАИТ</option>
            <option value="EXTERNAL_STUDENT">Внешний студент</option>
            <option value="EXTERNAL_TEACHER">Внешний преподаватель</option>
          </select>
        </label>
        {personType.endsWith('_STUDENT') && (
          <label>
            Группа
            <input name="studyGroup" required maxLength={100} />
          </label>
        )}
        {personType.startsWith('EXTERNAL_') && (
          <label>
            Организация
            <input name="organization" required maxLength={255} />
          </label>
        )}
      </div>
      {fields.map((field) => (
        <OnsiteField key={field.id} field={field} />
      ))}
      <label className="checkbox-row">
        <input name="attendImmediately" type="checkbox" defaultChecked />
        Сразу отметить посещение
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? 'Сохраняем…' : 'Зарегистрировать'}
      </Button>
    </form>
  );
};

const OnsiteField = ({ field }: { field: FormFieldResponse }) => {
  const name = `field-${field.id}`;
  if (field.type === 'BOOLEAN') {
    return (
      <label className="checkbox-row">
        <input name={name} type="checkbox" required={field.required} />
        {field.label}
      </label>
    );
  }
  if (field.type === 'SINGLE_CHOICE') {
    return (
      <label>
        {field.label}
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
      <fieldset>
        <legend>{field.label}</legend>
        {field.options?.map((option) => (
          <label className="checkbox-row" key={option}>
            <input name={name} type="checkbox" value={option} />
            {option}
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <label>
      {field.label}
      {field.type === 'LONG_TEXT' ? (
        <textarea name={name} required={field.required} maxLength={20_000} />
      ) : (
        <input name={name} required={field.required} maxLength={20_000} />
      )}
    </label>
  );
};

const ParticipantCard = ({
  participant,
  busy,
  fastMode,
  onConfirm,
  onClose,
}: {
  participant: ScanResolution;
  busy: boolean;
  fastMode: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) => (
  <section className="participant-card" aria-live="polite">
    <div>
      <p className="eyebrow">{participant.offline ? 'OFFLINE' : 'ONLINE'}</p>
      <h2>{fullName(participant)}</h2>
      <dl>
        <div>
          <dt>Группа</dt>
          <dd>{participant.studyGroup ?? '—'}</dd>
        </div>
        <div>
          <dt>Организация</dt>
          <dd>{participant.organization ?? '—'}</dd>
        </div>
        <div>
          <dt>Телефон</dt>
          <dd>{participant.phone ?? '—'}</dd>
        </div>
        <div>
          <dt>Первый вход</dt>
          <dd>
            {participant.firstAttendedAt
              ? formatTime(participant.firstAttendedAt)
              : 'Ещё не отмечен'}
          </dd>
        </div>
      </dl>
    </div>
    {!fastMode && (
      <div className="participant-actions">
        <Button disabled={busy} onClick={onConfirm}>
          Подтвердить посещение
        </Button>
        <button className="text-button" onClick={onClose}>
          Отмена
        </button>
      </div>
    )}
  </section>
);

const TopBar = ({
  online,
  pendingCount,
  rejectedCount,
  onLogout,
}: {
  online: boolean;
  pendingCount: number;
  rejectedCount: number;
  onLogout: () => Promise<void>;
}) => (
  <div className="top-bar">
    <span className={`network-state ${online ? 'online' : 'offline'}`}>
      {online
        ? pendingCount > 0
          ? `ONLINE · ${pendingCount} ожидают`
          : 'ONLINE · синхронизировано'
        : `OFFLINE · ${pendingCount} ожидают`}
    </span>
    {rejectedCount > 0 && (
      <span className="sync-warning">{rejectedCount} отклонены</span>
    )}
    <button className="text-button" onClick={() => void onLogout()}>
      Выйти
    </button>
  </div>
);

const FeedbackBanner = ({ feedback }: { feedback: Feedback }) => (
  <div
    className={`feedback ${feedback.kind}`}
    role="status"
    aria-live="assertive"
  >
    {feedback.text}
  </div>
);

const LoadingScreen = () => (
  <main className="loading-shell">
    <p>Загружаем Scanner…</p>
  </main>
);

const preparedDisplayEvent = (event: PreparedEventRecord): DisplayEvent => ({
  id: event.eventId,
  title: event.title,
  startAt: event.startAt,
  endAt: event.endAt,
  timezone: event.timezone,
  location: event.location,
  status: 'ACTIVE',
  prepared: event,
});

const feedbackForOutcome = (outcome: AttendanceOutcome): Feedback => {
  switch (outcome.status) {
    case 'ACCEPTED':
      return { kind: 'success', text: 'Посещение подтверждено' };
    case 'QUEUED':
      return { kind: 'offline', text: 'Сохранено на устройстве' };
    case 'ALREADY_PROCESSED':
    case 'REGISTRATION_ALREADY_ATTENDED':
      return { kind: 'already', text: 'Участник уже был отмечен' };
    default:
      return { kind: 'error', text: 'Посещение отклонено сервером' };
  }
};

const messageForError = (error: unknown): string => {
  if (error instanceof ApiClientError || error instanceof OfflineScannerError) {
    const messages: Record<string, string> = {
      INVALID_QR: 'QR недействителен для этого мероприятия',
      REGISTRATION_ANNULLED: 'Регистрация аннулирована',
      FORBIDDEN: 'Нет доступа к мероприятию',
      UNAUTHENTICATED: 'Требуется повторный вход',
      INVALID_CREDENTIALS: 'Неверный email или пароль',
      NETWORK_ERROR: 'Нет соединения с сервером',
      ACCESS_REVALIDATION_REQUIRED: 'Требуется повторный вход',
      OFFLINE_NOT_READY: 'Сначала подготовьте мероприятие онлайн',
      CAPACITY_FULL: 'На мероприятии нет свободных мест',
      FORM_VERSION_INVALID:
        'Поля формы изменились. Закройте и откройте форму снова.',
    };
    return messages[error.code] ?? error.message;
  }
  return 'Не удалось выполнить операцию';
};

const fullName = (participant: ScanResolution): string =>
  [participant.lastName, participant.firstName, participant.middleName]
    .filter(Boolean)
    .join(' ');

const formatTime = (value: string): string =>
  new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value));

const formatEventDate = (value: string, timezone: string): string =>
  new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
