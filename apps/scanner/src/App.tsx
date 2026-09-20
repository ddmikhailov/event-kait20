import {
  Button,
  BooleanQuestion,
  RegistrationSystemFields,
  ConsentCheckbox,
} from '@event-registration/ui';
import {
  defaultSystemFields,
  missingSystemField,
  systemFieldLabels,
  scannerOnsiteRegistrationRequestSchema,
  type SystemFields,
  type PersonType,
} from '@event-registration/contracts';
import type {
  FormFieldResponse,
  StreamResponse,
  ScannerOnsiteRegistrationRequest,
} from '@event-registration/contracts';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import { ApiClientError, scannerApi } from './api-client.js';
import {
  OfflineOwnerMismatchError,
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
    try {
      const session = await scannerApi.restoreSession();
      if (!session) {
        await scannerDatabase.revokeOfflineAccess();
        setView('login');
        return;
      }
      await scannerDatabase.bindOwner(session.user.id);
      const prepared = await scannerDatabase.preparedEvents.toArray();
      const preparedById = new Map(
        prepared.map((event) => [event.eventId, event]),
      );
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
        if (!(await scannerDatabase.offlineAccessAllowed())) {
          setEvents([]);
          setFeedback({
            kind: 'error',
            text: 'Для офлайн-работы сначала подтвердите доступ при наличии связи.',
          });
          setView('login');
          return;
        }
        const prepared = await scannerDatabase.preparedEvents.toArray();
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
    setFeedback(undefined);
    try {
      if ((await scannerDatabase.unresolvedCount()) > 0 && online) {
        for (const eventId of await scannerDatabase.pendingEventIds()) {
          try {
            await scannerService.flushPending(eventId);
          } catch {
            break;
          }
        }
      }
      const unresolved = await scannerDatabase.unresolvedCount();
      if (
        unresolved > 0 &&
        !window.confirm(
          `На устройстве осталось ${unresolved} несинхронизированных или отклонённых отметок. Выйти и удалить их без возможности восстановления?`,
        )
      ) {
        return;
      }
      try {
        await scannerApi.logout();
      } catch (error) {
        if (!(error instanceof ApiClientError) || error.status !== 401) {
          throw error;
        }
      }
      await scannerDatabase.clearBusinessData();
      setEvents([]);
      setSelectedEvent(undefined);
      setFeedback(undefined);
      setView('login');
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: `Выход не завершён: ${messageForError(error)}`,
      });
    } finally {
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

  let page: ReactNode;
  if (view === 'loading') page = <LoadingScreen />;
  else if (view === 'login')
    page = <LoginScreen busy={busy} feedback={feedback} onLogin={login} />;
  else if (view === 'events') {
    page = (
      <EventScreen
        events={events}
        online={online}
        busy={busy}
        feedback={feedback}
        onOpen={prepareAndOpen}
        onLogout={logout}
      />
    );
  } else
    page = selectedEvent ? (
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
  return (
    <>
      <header className="site-header">
        <a className="global-brand" href="/" aria-label="КАИТ №20">
          <img src="/kait20-logo.png" alt="КАИТ №20" />
        </a>
      </header>
      {page}
    </>
  );
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
  const actionLocked = useRef(false);
  const [workMode, setWorkMode] = useState<'scan' | 'search' | 'onsite'>(
    'scan',
  );
  const [fastMode, setFastMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ScanResolution[]>([]);
  const [rejected, setRejected] = useState<PendingAttendanceRecord[]>([]);
  const [confirmMode, setConfirmMode] = useState<
    'MANUAL_CONFIRM' | 'MANUAL_SEARCH'
  >('MANUAL_CONFIRM');
  const [formFields, setFormFields] = useState<FormFieldResponse[]>([]);
  const [systemFields, setSystemFields] = useState<SystemFields>(
    defaultSystemFields('onsite', true),
  );
  const [allowedTypes, setAllowedTypes] = useState<PersonType[] | null>(null);
  const [formFieldsReady, setFormFieldsReady] = useState(false);
  const [streams, setStreams] = useState<StreamResponse[]>([]);
  const [streamsRequired, setStreamsRequired] = useState(false);
  const syncInProgress = useRef(false);

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

  const synchronizePending = useCallback(async () => {
    if (syncInProgress.current) return;
    syncInProgress.current = true;
    try {
      await scannerService.flushPending(event.id);
      await updatePending();
    } catch (error) {
      onFeedback({
        kind:
          error instanceof ApiClientError && error.code === 'NETWORK_ERROR'
            ? 'offline'
            : 'error',
        text: messageForError(error),
      });
    } finally {
      syncInProgress.current = false;
    }
  }, [event.id, onFeedback, updatePending]);

  useEffect(() => {
    if (!online) return;
    const interval = window.setInterval(
      () => void synchronizePending(),
      10_000,
    );
    return () => window.clearInterval(interval);
  }, [online, synchronizePending]);

  useEffect(() => {
    if (!online) return;
    setFormFieldsReady(false);
    void Promise.all([
      scannerApi.formFields(event.id),
      scannerApi.streams(event.id),
    ])
      .then(([response, streamsResponse]) => {
        setFormFields(
          response.items.map((field) => ({
            ...field,
            required: field.onsiteRequired ?? field.required,
          })),
        );
        setSystemFields(
          response.systemFields ?? defaultSystemFields('onsite', true),
        );
        setAllowedTypes(response.allowedPersonTypes ?? null);
        setStreams(streamsResponse.items);
        setStreamsRequired(streamsResponse.streamsEnabled ?? false);
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
        const outcomeFeedback = feedbackForOutcome(outcome);
        onFeedback({
          ...outcomeFeedback,
          text: `${fullName(resolved)} · ${outcomeFeedback.text}`,
        });
        await updatePending();
        setParticipant(undefined);
      } catch (error) {
        onFeedback({ kind: 'error', text: messageForError(error) });
      } finally {
        setBusy(false);
      }
    },
    [event.id, onFeedback, updatePending],
  );

  const resolve = useCallback(
    async (qrPayload: string) => {
      if (
        actionLocked.current ||
        busy ||
        feedback?.kind === 'error' ||
        !qrPayload.trim()
      )
        return;
      actionLocked.current = true;
      setBusy(true);
      onFeedback(undefined);
      try {
        const resolved = await scannerService.resolveQr(
          event.id,
          qrPayload.trim(),
        );
        setConfirmMode('MANUAL_CONFIRM');
        if (fastMode) await record(resolved, 'FAST_SCAN');
        else setParticipant(resolved);
      } catch (error) {
        onFeedback({ kind: 'error', text: messageForError(error) });
      } finally {
        setBusy(false);
        actionLocked.current = false;
      }
    },
    [busy, event.id, fastMode, feedback, onFeedback, record],
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
    let registered = false;
    try {
      let result;
      try {
        result = await scannerApi.onsite(event.id, values);
      } catch (error) {
        if (
          !(error instanceof ApiClientError) ||
          error.code !== 'CAPACITY_FULL'
        )
          throw error;
        if (
          !window.confirm(
            'Свободных мест нет. Точно добавить участника сверх лимита? Действие будет записано в журнале.',
          )
        ) {
          throw new ApiClientError(
            'CAPACITY_OVERRIDE_CANCELLED',
            409,
            'Добавление отменено. Участник не зарегистрирован.',
          );
        }
        result = await scannerApi.onsite(event.id, {
          ...values,
          capacityOverride: true,
        });
      }
      registered = true;
      if (attendImmediately) {
        const outcome = await scannerService.recordAttendance(
          event.id,
          result.registrationId,
          'ONSITE_REGISTRATION',
        );
        const outcomeFeedback = feedbackForOutcome(outcome);
        onFeedback(outcomeFeedback);
        if (outcomeFeedback.kind === 'error') {
          await updatePending();
          return;
        }
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
      onFeedback({
        kind: 'error',
        text: registered
          ? `Участник зарегистрирован, но отметку посещения или синхронизацию нужно проверить. ${messageForError(error)}`
          : messageForError(error),
      });
      if (!registered) throw error;
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
        onSynchronize={synchronizePending}
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
        {workMode === 'scan' && (
          <label className="mode-toggle">
            <input
              type="checkbox"
              checked={fastMode}
              onChange={(event) => setFastMode(event.target.checked)}
            />
            Быстрый режим
          </label>
        )}
      </header>

      <nav className="scanner-tabs" aria-label="Режим работы">
        {(
          [
            ['scan', 'Сканировать'],
            ['search', 'Найти'],
            ['onsite', 'Добавить на месте'],
          ] as const
        ).map(([mode, label]) => (
          <button
            type="button"
            key={mode}
            aria-pressed={workMode === mode}
            disabled={busy || feedback?.kind === 'error'}
            onClick={() => {
              setWorkMode(mode);
              setParticipant(undefined);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {feedback && (
        <div
          className={feedback.kind === 'error' ? 'scanner-error-notice' : ''}
        >
          <FeedbackBanner
            feedback={feedback}
            compact={workMode === 'scan' && feedback.kind !== 'error'}
          />
          {feedback.kind === 'error' && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => onFeedback(undefined)}
            >
              Понятно, проверить и продолжить
            </button>
          )}
        </div>
      )}
      {workMode === 'scan' && (
        <QrCamera
          active={feedback?.kind !== 'error' && (fastMode || !participant)}
          onDecode={(value) => void resolve(value)}
        />
      )}

      {participant && (
        <ParticipantCard
          participant={participant}
          busy={busy || feedback?.kind === 'error'}
          fastMode={fastMode}
          onConfirm={() => void record(participant, confirmMode)}
          onClose={() => {
            setParticipant(undefined);
            onFeedback(undefined);
          }}
        />
      )}

      <section className="scanner-tools" inert={feedback?.kind === 'error'}>
        {workMode === 'search' && (
          <section>
            <h2>Найти участника</h2>
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
          </section>
        )}
        {workMode === 'onsite' && (
          <section>
            <h2>Добавить участника на месте</h2>
            {online && formFieldsReady ? (
              <OnsiteRegistrationForm
                fields={formFields}
                systemFields={systemFields}
                allowedTypes={allowedTypes}
                streams={streams}
                streamsRequired={streamsRequired}
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
          </section>
        )}
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

export const OnsiteRegistrationForm = ({
  fields,
  streams = [],
  streamsRequired = false,
  systemFields = defaultSystemFields('onsite', true),
  allowedTypes = null,
  busy,
  onSubmit,
}: {
  fields: FormFieldResponse[];
  streams?: StreamResponse[];
  streamsRequired?: boolean;
  systemFields?: SystemFields;
  allowedTypes?: PersonType[] | null;
  busy: boolean;
  onSubmit: (
    values: ScannerOnsiteRegistrationRequest,
    attendImmediately: boolean,
  ) => Promise<void>;
}) => {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const submitLocked = useRef(false);
  const [resultText, setResultText] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLocked.current || busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    submitLocked.current = true;
    setSubmitting(true);
    setResultText('');
    const optional = (name: string) =>
      String(form.get(name) ?? '').trim() || null;
    const customAnswers: ScannerOnsiteRegistrationRequest['customAnswers'] = [];
    for (const field of fields) {
      const name = `field-${field.id}`;
      if (field.type === 'BOOLEAN') {
        const value = optional(name);
        if (value)
          customAnswers.push({
            fieldId: field.id,
            value: value === 'true' || value === 'on',
          });
      } else if (field.type === 'MULTI_CHOICE') {
        const value = form.getAll(name).map(String).filter(Boolean);
        if (value.length) customAnswers.push({ fieldId: field.id, value });
      } else {
        const value = optional(name);
        if (value) customAnswers.push({ fieldId: field.id, value });
      }
    }
    try {
      const personType = optional('personType');
      const values = scannerOnsiteRegistrationRequestSchema.parse({
        requestId,
        streamId: optional('streamId'),
        firstName: String(form.get('firstName') ?? ''),
        lastName: String(form.get('lastName') ?? ''),
        middleName: optional('middleName'),
        birthDate: optional('birthDate'),
        email: optional('email'),
        phone: optional('phone'),
        personType,
        studyGroup:
          personType === 'KAIT_STUDENT' ? optional('studyGroup') : null,
        organization: personType?.startsWith('EXTERNAL_')
          ? optional('organization')
          : null,
        consentAccepted: form.has('consentAccepted'),
        customAnswers,
      });
      const missing = missingSystemField(
        values,
        systemFields,
        !!allowedTypes && allowedTypes.length < 6,
      );
      if (missing) {
        setResultText(`Заполните поле «${systemFieldLabels[missing]}»`);
        return;
      }
      if (
        fields.some(
          (field) =>
            (field.onsiteRequired ?? field.required) &&
            !customAnswers.some((answer) => answer.fieldId === field.id),
        )
      ) {
        setResultText('Ответьте на обязательные дополнительные вопросы.');
        return;
      }
      await onSubmit(values, form.has('attendImmediately'));
      formElement.reset();
      setRequestId(crypto.randomUUID());
      setResultText(
        'Регистрация сохранена. Можно добавить следующего участника.',
      );
    } catch (error) {
      setResultText(messageForError(error));
    } finally {
      submitLocked.current = false;
      setSubmitting(false);
    }
  };
  return (
    <form className="onsite-form" onSubmit={submit}>
      <fieldset className="onsite-fields" disabled={busy || submitting}>
        {streamsRequired && (
          <label>
            Поток *
            <select name="streamId" required defaultValue="">
              <option value="" disabled>
                Выберите один поток
              </option>
              {streams.map((stream) => (
                <option
                  key={stream.id}
                  value={stream.id}
                  disabled={!stream.active || stream.ended}
                >
                  {stream.title} ·{' '}
                  {formatEventDate(stream.startAt, 'Europe/Moscow')} · свободно:{' '}
                  {stream.remaining}
                </option>
              ))}
            </select>
          </label>
        )}
        <RegistrationSystemFields
          key={requestId}
          fields={systemFields}
          allowedTypes={allowedTypes}
        />
        <ConsentCheckbox onsite />
        {fields.map((field) => (
          <OnsiteField
            key={field.id}
            field={{
              ...field,
              required: field.onsiteRequired ?? field.required,
            }}
          />
        ))}
        <label className="checkbox-row">
          <input name="attendImmediately" type="checkbox" defaultChecked />
          Сразу отметить посещение
        </label>
        <Button type="submit" disabled={busy || submitting}>
          {busy || submitting ? 'Сохраняем…' : 'Зарегистрировать'}
        </Button>
      </fieldset>
      {resultText && <p role="status">{resultText}</p>}
    </form>
  );
};

const OnsiteField = ({ field }: { field: FormFieldResponse }) => {
  const name = `field-${field.id}`;
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
        {participant.streamTitle && (
          <div>
            <dt>Поток</dt>
            <dd>{participant.streamTitle}</dd>
          </div>
        )}
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
  onSynchronize,
  onLogout,
}: {
  online: boolean;
  pendingCount: number;
  rejectedCount: number;
  onSynchronize?: (() => Promise<void>) | undefined;
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
    {online && pendingCount > 0 && onSynchronize && (
      <button className="text-button" onClick={() => void onSynchronize()}>
        Синхронизировать
      </button>
    )}
    <button className="text-button" onClick={() => void onLogout()}>
      Выйти
    </button>
  </div>
);

const FeedbackBanner = ({
  feedback,
  compact = false,
}: {
  feedback: Feedback;
  compact?: boolean;
}) => (
  <div
    className={`feedback ${feedback.kind} ${compact ? 'compact' : ''}`}
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
    case 'INVALID_TIMESTAMP':
      return {
        kind: 'error',
        text: 'Отметка не принята: время устройства или даты мероприятия не соответствуют допустимому периоду. Проверьте их перед продолжением.',
      };
    case 'REGISTRATION_ANNULLED':
    case 'INVALID_REGISTRATION':
      return {
        kind: 'error',
        text: 'Отметка не принята: регистрация отсутствует или аннулирована. Проверьте участника.',
      };
    case 'CLIENT_EVENT_CONFLICT':
      return {
        kind: 'error',
        text: 'Отметка не принята: идентификатор уже использован для другой операции. Запись сохранена для проверки.',
      };
    default:
      return { kind: 'error', text: 'Посещение отклонено сервером' };
  }
};

const messageForError = (error: unknown): string => {
  if (error instanceof OfflineOwnerMismatchError) return error.message;
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
      STREAM_REQUIRED: 'Выберите поток мероприятия',
      STREAM_INVALID:
        'Этот поток недоступен. Обновите страницу и выберите другой',
      STREAM_ALREADY_SELECTED:
        'Участник уже записан в другой поток. Обратитесь к организатору',
      PARTICIPANT_TYPE_NOT_ALLOWED:
        'Этот тип участника не разрешён для мероприятия. Уточните условия у организатора.',
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
