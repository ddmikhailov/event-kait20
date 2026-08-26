import type {
  EventResponse,
  FormFieldResponse,
  SessionResponse,
} from '@event-registration/contracts';
import { loginRequestSchema } from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';
import { EventParticipants, PeopleDirectory } from './AdminParticipants.js';
import { EventStatistics } from './AdminReporting.js';
import { EventAccessManager, StaffDirectory } from './AdminStaff.js';
import {
  eventDefaults,
  eventValues,
  formFieldDefaults,
  formFieldValues,
} from './admin-values.js';

type Notice = { kind: 'error' | 'success'; text: string };

export const AdminApp = () => {
  const [session, setSession] = useState<SessionResponse>();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>();

  useEffect(() => {
    let cancelled = false;
    void adminApi
      .restoreSession()
      .then((restored) => {
        if (!cancelled) setSession(restored);
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice(errorNotice(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = async () => {
    setLoading(true);
    try {
      await adminApi.logout();
    } catch {
      // The local authenticated view must still close if the server is gone.
    } finally {
      setSession(undefined);
      setNotice(undefined);
      setLoading(false);
    }
  };

  if (loading) return <AdminLoading />;
  if (!session) {
    return (
      <AdminLogin
        notice={notice}
        onLogin={async (email, password) => {
          setLoading(true);
          setNotice(undefined);
          try {
            setSession(
              await adminApi.login(
                loginRequestSchema.parse({ email, password }),
              ),
            );
          } catch (error) {
            setNotice(errorNotice(error));
          } finally {
            setLoading(false);
          }
        }}
      />
    );
  }
  if (session.user.role !== 'SUPER_ADMIN') {
    return <RoleDenied email={session.user.email} onLogout={logout} />;
  }
  return <AdminWorkspace session={session} onLogout={logout} />;
};

const AdminWorkspace = ({
  session,
  onLogout,
}: {
  session: SessionResponse;
  onLogout: () => Promise<void>;
}) => {
  const [events, setEvents] = useState<EventResponse[]>([]);
  const [view, setView] = useState<
    | 'events'
    | 'editor'
    | 'participants'
    | 'statistics'
    | 'people'
    | 'staff'
    | 'access'
  >('events');
  const [selected, setSelected] = useState<EventResponse>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  const loadEvents = useCallback(async () => {
    setBusy(true);
    try {
      setEvents((await adminApi.events()).items);
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const openEditor = async (event?: EventResponse) => {
    setNotice(undefined);
    setSelected(event);
    setView('editor');
  };

  if (view === 'editor') {
    return (
      <EventEditor
        key={selected?.id ?? 'new-event'}
        event={selected}
        onBack={() => {
          setView('events');
          setSelected(undefined);
          void loadEvents();
        }}
      />
    );
  }
  if (view === 'participants' && selected) {
    return (
      <EventParticipants
        event={selected}
        onBack={() => {
          setView('events');
          setSelected(undefined);
          void loadEvents();
        }}
      />
    );
  }
  if (view === 'people') {
    return <PeopleDirectory onBack={() => setView('events')} />;
  }
  if (view === 'statistics' && selected) {
    return (
      <EventStatistics
        event={selected}
        onBack={() => {
          setSelected(undefined);
          setView('events');
        }}
      />
    );
  }
  if (view === 'staff') {
    return (
      <StaffDirectory
        events={events}
        currentUserId={session.user.id}
        onBack={() => setView('events')}
      />
    );
  }
  if (view === 'access' && selected) {
    return (
      <EventAccessManager
        event={selected}
        onBack={() => {
          setSelected(undefined);
          setView('events');
        }}
      />
    );
  }

  return (
    <main className="admin-shell">
      <AdminHeader email={session.user.email} onLogout={onLogout} />
      <section className="admin-content">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">Управление</p>
            <h1>Мероприятия</h1>
            <p>Создавайте события и настраивайте форму регистрации.</p>
          </div>
          <div className="row-actions">
            <button
              className="secondary-button"
              onClick={() => setView('staff')}
            >
              Сотрудники
            </button>
            <button
              className="secondary-button"
              onClick={() => setView('people')}
            >
              Общая база людей
            </button>
            <Button onClick={() => void openEditor()}>Новое мероприятие</Button>
          </div>
        </header>
        {notice && <AdminNotice notice={notice} />}
        {busy && events.length === 0 ? (
          <p className="admin-empty">Загружаем мероприятия…</p>
        ) : (
          <EventGrid
            events={events}
            onOpen={openEditor}
            onParticipants={async (event) => {
              setSelected(event);
              setView('participants');
            }}
            onAccess={async (event) => {
              setSelected(event);
              setView('access');
            }}
            onStatistics={async (event) => {
              setSelected(event);
              setView('statistics');
            }}
          />
        )}
      </section>
    </main>
  );
};

export const EventGrid = ({
  events,
  onOpen,
  onParticipants,
  onAccess,
  onStatistics,
}: {
  events: EventResponse[];
  onOpen: (event: EventResponse) => Promise<void>;
  onParticipants: (event: EventResponse) => Promise<void>;
  onAccess: (event: EventResponse) => Promise<void>;
  onStatistics: (event: EventResponse) => Promise<void>;
}) => (
  <section className="admin-event-grid" aria-label="Список мероприятий">
    {events.map((event) => (
      <article className="admin-event-card" key={event.id}>
        <div className="admin-card-topline">
          <StatusBadge status={event.status} />
          <span>{event.capacity} мест</span>
        </div>
        <h2>{event.title}</h2>
        <p>{formatDate(event.startAt, event.timezone)}</p>
        <p>{event.location}</p>
        <div className="event-card-actions">
          <button
            className="secondary-button"
            onClick={() => void onParticipants(event)}
          >
            Участники
          </button>
          <button
            className="secondary-button"
            onClick={() => void onStatistics(event)}
          >
            Статистика
          </button>
          <button
            className="secondary-button"
            onClick={() => void onAccess(event)}
          >
            Доступ
          </button>
          <button
            className="secondary-button"
            onClick={() => void onOpen(event)}
          >
            {event.status === 'ARCHIVED' ? 'Посмотреть' : 'Настроить'}
          </button>
        </div>
      </article>
    ))}
    {events.length === 0 && (
      <div className="admin-empty">
        <h2>Мероприятий пока нет</h2>
        <p>Создайте первое мероприятие, чтобы открыть регистрацию.</p>
      </div>
    )}
  </section>
);

const EventEditor = ({
  event,
  onBack,
}: {
  event?: EventResponse | undefined;
  onBack: () => void;
}) => {
  const [savedEvent, setSavedEvent] = useState(event);
  const [fields, setFields] = useState<FormFieldResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const archived = savedEvent?.status === 'ARCHIVED';

  const loadFields = useCallback(async (eventId: string) => {
    try {
      setFields((await adminApi.formFields(eventId)).items);
    } catch (error) {
      setNotice(errorNotice(error));
    }
  }, []);

  useEffect(() => {
    if (savedEvent) void loadFields(savedEvent.id);
  }, [loadFields, savedEvent?.id]);

  const saveEvent = async (form: FormData) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const values = eventValues(form);
      const result = savedEvent
        ? await adminApi.updateEvent(savedEvent.id, values)
        : await adminApi.createEvent(values);
      setSavedEvent(result);
      setNotice({ kind: 'success', text: 'Изменения сохранены' });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!savedEvent || !window.confirm('Архивировать мероприятие?')) return;
    setBusy(true);
    try {
      setSavedEvent(await adminApi.archiveEvent(savedEvent.id));
      setNotice({ kind: 'success', text: 'Мероприятие перемещено в архив' });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button className="text-button" onClick={onBack}>
          ← Все мероприятия
        </button>
        {savedEvent && <StatusBadge status={savedEvent.status} />}
      </header>
      <div className="admin-editor-layout">
        <section className="admin-panel">
          <div className="admin-section-title">
            <div>
              <p className="eyebrow">Основные данные</p>
              <h1>{savedEvent ? savedEvent.title : 'Новое мероприятие'}</h1>
            </div>
          </div>
          {notice && <AdminNotice notice={notice} />}
          {archived && (
            <AdminNotice
              notice={{
                kind: 'success',
                text: 'Архивное мероприятие доступно только для просмотра.',
              }}
            />
          )}
          <EventForm
            event={savedEvent}
            busy={busy}
            readOnly={archived}
            onSubmit={saveEvent}
          />
          {savedEvent && !archived && (
            <button
              className="danger-button"
              disabled={busy}
              onClick={() => void archive()}
            >
              Архивировать мероприятие
            </button>
          )}
        </section>
        <section className="admin-panel">
          <div className="admin-section-title">
            <div>
              <p className="eyebrow">Форма участника</p>
              <h2>Дополнительные поля</h2>
            </div>
          </div>
          {savedEvent ? (
            <FormFieldsEditor
              eventId={savedEvent.id}
              fields={fields}
              readOnly={archived}
              onChanged={() => loadFields(savedEvent.id)}
            />
          ) : (
            <p className="admin-empty compact">
              Сначала сохраните мероприятие — после этого можно добавить поля.
            </p>
          )}
        </section>
      </div>
    </main>
  );
};

export const EventForm = ({
  event,
  busy,
  readOnly,
  onSubmit,
}: {
  event?: EventResponse | undefined;
  busy: boolean;
  readOnly: boolean;
  onSubmit: (form: FormData) => Promise<void>;
}) => {
  const values = eventDefaults(event);
  const statuses: EventResponse['status'][] = event
    ? allowedStatuses(event.status)
    : ['DRAFT', 'REGISTRATION_OPEN'];
  return (
    <form
      className="admin-form"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        void onSubmit(new FormData(submitEvent.currentTarget));
      }}
    >
      <div className="form-grid">
        <AdminText
          name="title"
          label="Название"
          value={values.title}
          required
          disabled={readOnly}
        />
        <AdminText
          name="slug"
          label="Адрес страницы (slug)"
          value={values.slug}
          required
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          disabled={readOnly}
        />
        <AdminText
          name="startAt"
          label="Начало"
          type="datetime-local"
          value={values.startAt}
          required
          disabled={readOnly}
        />
        <AdminText
          name="endAt"
          label="Окончание"
          type="datetime-local"
          value={values.endAt}
          required
          disabled={readOnly}
        />
        <AdminText
          name="registrationDeadline"
          label="Приём заявок до"
          type="datetime-local"
          value={values.registrationDeadline}
          required
          disabled={readOnly}
        />
        <AdminText
          name="capacity"
          label="Количество мест"
          type="number"
          min={1}
          value={values.capacity}
          required
          disabled={readOnly}
        />
        <AdminText
          name="location"
          label="Место проведения"
          value={values.location}
          required
          disabled={readOnly}
        />
        <AdminText
          name="timezone"
          label="Часовой пояс"
          value={values.timezone}
          required
          disabled={readOnly}
        />
        <label>
          <span>Статус *</span>
          <select
            name="status"
            defaultValue={String(values.status)}
            disabled={readOnly}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <AdminText
          name="coverObjectKey"
          label="Ключ обложки"
          value={values.coverObjectKey}
          disabled={readOnly}
        />
      </div>
      <label>
        <span>Описание</span>
        <textarea
          name="description"
          defaultValue={String(values.description)}
          maxLength={20_000}
          disabled={readOnly}
        />
      </label>
      {!readOnly && (
        <Button type="submit" disabled={busy}>
          {busy
            ? 'Сохраняем…'
            : event
              ? 'Сохранить изменения'
              : 'Создать мероприятие'}
        </Button>
      )}
    </form>
  );
};

const FormFieldsEditor = ({
  eventId,
  fields,
  readOnly,
  onChanged,
}: {
  eventId: string;
  fields: FormFieldResponse[];
  readOnly: boolean;
  onChanged: () => Promise<void>;
}) => {
  const [editing, setEditing] = useState<FormFieldResponse>();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  const save = async (form: FormData) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const values = formFieldValues(form);
      if (editing) await adminApi.updateFormField(eventId, editing.id, values);
      else await adminApi.createFormField(eventId, values);
      await onChanged();
      setEditing(undefined);
      setCreating(false);
      setNotice({ kind: 'success', text: 'Поле формы сохранено' });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (field: FormFieldResponse) => {
    if (!window.confirm(`Отключить поле «${field.label}»?`)) return;
    setBusy(true);
    try {
      await adminApi.deactivateFormField(eventId, field.id);
      await onChanged();
      setNotice({ kind: 'success', text: 'Поле отключено, история сохранена' });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field-manager">
      {notice && <AdminNotice notice={notice} />}
      {!readOnly && !creating && !editing && (
        <button className="secondary-button" onClick={() => setCreating(true)}>
          + Добавить поле
        </button>
      )}
      {(creating || editing) && (
        <FormFieldForm
          key={editing?.id ?? 'new-field'}
          field={editing}
          busy={busy}
          onCancel={() => {
            setCreating(false);
            setEditing(undefined);
          }}
          onSubmit={save}
        />
      )}
      <ol className="field-list">
        {fields.map((field) => (
          <li className={field.active ? '' : 'inactive'} key={field.id}>
            <div>
              <strong>{field.label}</strong>
              <span>
                {fieldTypeLabel(field.type)} · порядок {field.sortOrder}
                {field.required ? ' · обязательно' : ''}
              </span>
              {!field.active && <em>Отключено</em>}
            </div>
            {!readOnly && field.active && (
              <div className="row-actions">
                <button
                  className="text-button"
                  onClick={() => {
                    setCreating(false);
                    setEditing(field);
                  }}
                >
                  Изменить
                </button>
                <button
                  className="text-button danger-text"
                  disabled={busy}
                  onClick={() => void deactivate(field)}
                >
                  Отключить
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {fields.length === 0 && !creating && (
        <p className="admin-empty compact">Дополнительных полей пока нет.</p>
      )}
    </div>
  );
};

const FormFieldForm = ({
  field,
  busy,
  onCancel,
  onSubmit,
}: {
  field?: FormFieldResponse | undefined;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (form: FormData) => Promise<void>;
}) => {
  const defaults = formFieldDefaults(field);
  const [type, setType] = useState(String(defaults.type));
  const choice = type === 'SINGLE_CHOICE' || type === 'MULTI_CHOICE';
  return (
    <form
      className="field-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(new FormData(event.currentTarget));
      }}
    >
      <AdminText
        name="label"
        label="Название поля"
        value={defaults.label}
        required
      />
      <div className="form-grid">
        <label>
          <span>Тип *</span>
          <select
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {fieldTypes.map((item) => (
              <option key={item} value={item}>
                {fieldTypeLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <AdminText
          name="sortOrder"
          label="Порядок"
          type="number"
          min={0}
          value={defaults.sortOrder}
          required
        />
      </div>
      {choice && (
        <label>
          <span>Варианты ответа — по одному в строке *</span>
          <textarea
            name="options"
            defaultValue={String(defaults.options)}
            required
          />
        </label>
      )}
      <label className="admin-checkbox">
        <input
          name="required"
          type="checkbox"
          defaultChecked={Boolean(defaults.required)}
        />
        <span>Обязательное поле</span>
      </label>
      <div className="row-actions">
        <Button type="submit" disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить поле'}
        </Button>
        <button className="secondary-button" type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
};

const AdminText = ({
  label,
  value,
  ...props
}: Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'defaultValue' | 'value'
> & { label: string; value: string | number }) => (
  <label>
    <span>
      {label}
      {props.required ? ' *' : ''}
    </span>
    <input {...props} defaultValue={value} />
  </label>
);

export const AdminLogin = ({
  notice,
  onLogin,
}: {
  notice?: Notice | undefined;
  onLogin: (email: string, password: string) => Promise<void>;
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <main className="admin-auth-page">
      <section className="admin-auth-card">
        <p className="eyebrow">КАИТ №20</p>
        <h1>Кабинет организатора</h1>
        <p>Войдите под учётной записью администратора.</p>
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void onLogin(email, password);
          }}
        >
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>Пароль</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <Button type="submit">Войти</Button>
        </form>
        <a className="text-button" href="/auth/password-forgot">
          Не помню пароль
        </a>
        {notice && <AdminNotice notice={notice} />}
      </section>
    </main>
  );
};

export const RoleDenied = ({
  email,
  onLogout,
}: {
  email: string;
  onLogout: () => Promise<void>;
}) => (
  <main className="admin-auth-page">
    <section className="admin-auth-card">
      <p className="eyebrow">Доступ ограничен</p>
      <h1>Нужна роль администратора</h1>
      <p>
        Учётная запись {email} предназначена для сканера и не имеет доступа к
        кабинету.
      </p>
      <Button onClick={() => void onLogout()}>Выйти</Button>
    </section>
  </main>
);

const AdminHeader = ({
  email,
  onLogout,
}: {
  email: string;
  onLogout: () => Promise<void>;
}) => (
  <header className="admin-topbar">
    <strong>КАИТ №20 · Организатор</strong>
    <div>
      <span>{email}</span>
      <button className="text-button" onClick={() => void onLogout()}>
        Выйти
      </button>
    </div>
  </header>
);

const AdminLoading = () => (
  <main className="admin-auth-page" aria-busy="true">
    <p className="loading-label">Проверяем доступ…</p>
  </main>
);

const AdminNotice = ({ notice }: { notice: Notice }) => (
  <div
    className={`admin-notice ${notice.kind}`}
    role={notice.kind === 'error' ? 'alert' : 'status'}
  >
    {notice.text}
  </div>
);

const StatusBadge = ({ status }: { status: EventResponse['status'] }) => (
  <span
    className={`status-badge status-${status.toLowerCase().replace('_', '-')}`}
  >
    {statusLabel(status)}
  </span>
);

const fieldTypes: FormFieldResponse['type'][] = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'BOOLEAN',
];

const statusLabels: Record<EventResponse['status'], string> = {
  DRAFT: 'Черновик',
  REGISTRATION_OPEN: 'Регистрация открыта',
  REGISTRATION_CLOSED: 'Регистрация закрыта',
  ACTIVE: 'Идёт сейчас',
  COMPLETED: 'Завершено',
  ARCHIVED: 'Архив',
};

const statusTransitions: Record<
  EventResponse['status'],
  EventResponse['status'][]
> = {
  DRAFT: ['DRAFT', 'REGISTRATION_OPEN'],
  REGISTRATION_OPEN: ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ACTIVE'],
  REGISTRATION_CLOSED: [
    'REGISTRATION_CLOSED',
    'REGISTRATION_OPEN',
    'ACTIVE',
    'COMPLETED',
  ],
  ACTIVE: ['ACTIVE', 'COMPLETED'],
  COMPLETED: ['COMPLETED'],
  ARCHIVED: ['ARCHIVED'],
};

const fieldTypeLabels: Record<FormFieldResponse['type'], string> = {
  SHORT_TEXT: 'Короткий текст',
  LONG_TEXT: 'Длинный текст',
  SINGLE_CHOICE: 'Один вариант',
  MULTI_CHOICE: 'Несколько вариантов',
  BOOLEAN: 'Да / нет',
};

const allowedStatuses = (status: EventResponse['status']) =>
  statusTransitions[status];
const statusLabel = (status: EventResponse['status']) => statusLabels[status];
const fieldTypeLabel = (type: FormFieldResponse['type']) =>
  fieldTypeLabels[type];

const errorNotice = (error: unknown): Notice => {
  if (error instanceof AdminApiError) {
    const messages: Record<string, string> = {
      INVALID_CREDENTIALS: 'Неверный email или пароль',
      UNAUTHENTICATED: 'Сессия завершена. Войдите снова',
      FORBIDDEN: 'Недостаточно прав для этой операции',
      INVALID_EVENT_STATE: 'Такой переход статуса недоступен',
      INVALID_TIME_RANGE:
        'Проверьте даты: окончание должно быть после начала, а приём заявок — завершиться не позже начала',
      CAPACITY_BELOW_ACTIVE_REGISTRATIONS:
        'Количество мест меньше числа действующих регистраций',
      CONFLICT: 'Такой адрес страницы уже используется',
      CSRF_INVALID: 'Защитный токен устарел. Обновите страницу',
      NETWORK_ERROR: 'Нет соединения с сервером',
      VALIDATION_ERROR: 'Проверьте заполненные поля',
    };
    return {
      kind: 'error',
      text: messages[error.code] ?? 'Не удалось выполнить операцию',
    };
  }
  return {
    kind: 'error',
    text: 'Проверьте заполненные поля и попробуйте снова',
  };
};

const formatDate = (value: string, timezone: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
