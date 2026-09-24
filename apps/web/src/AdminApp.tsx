import type {
  ActivityReference,
  EventResponse,
  FormFieldResponse,
  Season,
  SessionResponse,
} from '@event-registration/contracts';
import {
  loginRequestSchema,
  personTypeSchema,
  personTypeLabels,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';
import { ActivitySettings } from './AdminActivity.js';
import { ParticipationsAdmin } from './AdminActivityAdmin.js';
import { AchievementAdmin } from './AdminAchievement.js';
import { MembershipAdmin } from './AdminMembership.js';
import { ScoringAdmin } from './AdminScoring.js';
import { publicMediaUrl } from './api-client.js';
import { EventParticipants, PeopleDirectory } from './AdminParticipants.js';
import { EventStatistics } from './AdminReporting.js';
import { RegistrationFormEditor } from './RegistrationFormEditor.js';
import { EventStreamsEditor } from './EventStreams.js';
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
      setSession(undefined);
      setNotice(undefined);
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        setSession(undefined);
        setNotice(undefined);
      } else {
        setNotice({
          kind: 'error',
          text: `Выход не завершён: ${errorNotice(error).text}`,
        });
      }
    } finally {
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
  if (session.user.role === 'SCANNER') {
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
    | 'activity'
    | 'participations'
    | 'membership'
    | 'achievements'
    | 'scoring'
  >('events');
  const [selected, setSelected] = useState<EventResponse>();
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  const loadEvents = useCallback(async () => {
    setBusy(true);
    try {
      setEvents((await adminApi.events(showArchived)).items);
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusy(false);
    }
  }, [showArchived]);

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
        currentRole={session.user.role}
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
        currentRole={session.user.role}
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
  if (view === 'activity') {
    return (
      <ActivitySettings
        role={session.user.role}
        onBack={() => setView('events')}
      />
    );
  }
  if (view === 'scoring') {
    return (
      <ScoringAdmin role={session.user.role} onBack={() => setView('events')} />
    );
  }
  if (view === 'participations') {
    return (
      <ParticipationsAdmin
        role={session.user.role}
        onBack={() => setView('events')}
      />
    );
  }
  if (view === 'membership') {
    return (
      <MembershipAdmin
        role={session.user.role}
        onBack={() => setView('events')}
      />
    );
  }
  if (view === 'achievements') {
    return (
      <AchievementAdmin
        role={session.user.role}
        onBack={() => setView('events')}
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
            <label className="archive-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              <span>Показать архив</span>
            </label>
            <button
              className="secondary-button"
              onClick={() => setView('activity')}
            >
              Активность
            </button>
            <button
              className="secondary-button"
              onClick={() => setView('participations')}
            >
              Участия
            </button>
            <button
              className="secondary-button"
              onClick={() => setView('membership')}
            >
              Учебная принадлежность
            </button>
            <button
              className="secondary-button"
              onClick={() => setView('achievements')}
            >
              Достижения
            </button>
            <button
              className="secondary-button"
              onClick={() => setView('scoring')}
            >
              Скоринг v2
            </button>
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
          <StatusBadge status={event.effectiveStatus ?? event.status} />
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
  currentRole,
  onBack,
}: {
  event?: EventResponse | undefined;
  currentRole: SessionResponse['user']['role'];
  onBack: () => void;
}) => {
  const [savedEvent, setSavedEvent] = useState(event);
  const [fields, setFields] = useState<FormFieldResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [categories, setCategories] = useState<ActivityReference[]>([]);
  const [levels, setLevels] = useState<ActivityReference[]>([]);
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

  useEffect(() => {
    void Promise.all([
      adminApi.seasons(),
      adminApi.activityCategories(),
      adminApi.activityLevels(),
    ])
      .then(([seasonList, categoryList, levelList]) => {
        setSeasons(seasonList.items);
        setCategories(categoryList.items.filter((item) => item.active));
        setLevels(levelList.items.filter((item) => item.active));
      })
      .catch((error: unknown) => setNotice(errorNotice(error)));
  }, []);

  const saveEvent = async (form: FormData) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const values = eventValues(form);
      let result = savedEvent
        ? await adminApi.updateEvent(savedEvent.id, values)
        : await adminApi.createEvent(values);
      const cover = form.get('cover');
      if (cover instanceof File && cover.size > 0) {
        result = await adminApi.uploadEventCover(result.id, cover);
      }
      setSavedEvent(result);
      setNotice({ kind: 'success', text: 'Изменения сохранены' });
    } catch (error) {
      setNotice(errorNotice(error));
    } finally {
      setBusy(false);
    }
  };

  const deleteCover = async () => {
    if (!savedEvent?.coverObjectKey || !window.confirm('Удалить обложку?'))
      return;
    setBusy(true);
    setNotice(undefined);
    try {
      setSavedEvent(await adminApi.deleteEventCover(savedEvent.id));
      setNotice({ kind: 'success', text: 'Обложка удалена' });
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

  const copyRegistrationLink = async () => {
    if (!savedEvent) return;
    try {
      await navigator.clipboard.writeText(registrationUrl(savedEvent.slug));
      setNotice({ kind: 'success', text: 'Ссылка на регистрацию скопирована' });
    } catch {
      setNotice({
        kind: 'error',
        text: 'Не удалось скопировать ссылку. Выделите и скопируйте её вручную.',
      });
    }
  };

  const purge = async () => {
    if (!savedEvent || currentRole !== 'SUPER_ADMIN') return;
    const confirmation = window.prompt(
      `Удаление необратимо. Введите адрес страницы «${savedEvent.slug}», чтобы удалить мероприятие и все его регистрации. Общие карточки людей сохранятся.`,
    );
    if (confirmation === null) return;
    if (confirmation.trim() !== savedEvent.slug) {
      setNotice({ kind: 'error', text: 'Адрес страницы введён неверно' });
      return;
    }
    setBusy(true);
    try {
      await adminApi.purgeEvent(savedEvent.id, {
        confirmationSlug: confirmation.trim(),
      });
      onBack();
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
        {savedEvent && (
          <StatusBadge
            status={savedEvent.effectiveStatus ?? savedEvent.status}
          />
        )}
      </header>
      <div className="admin-editor-layout">
        <section className="admin-panel event-primary-panel">
          <div className="admin-section-title">
            <div>
              <p className="eyebrow">Основные данные</p>
              <h1>{savedEvent ? savedEvent.title : 'Новое мероприятие'}</h1>
            </div>
          </div>
          {notice && <AdminNotice notice={notice} />}
          {savedEvent && !archived && (
            <div className="registration-link-panel">
              <div>
                <strong>Ссылка на регистрацию</strong>
                <a
                  href={registrationUrl(savedEvent.slug)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {registrationUrl(savedEvent.slug)}
                </a>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void copyRegistrationLink()}
              >
                Скопировать ссылку
              </button>
            </div>
          )}
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
            onDeleteCover={deleteCover}
            seasons={seasons}
            categories={categories}
            levels={levels}
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
          {savedEvent && archived && currentRole === 'SUPER_ADMIN' && (
            <button
              className="danger-button"
              disabled={busy}
              onClick={() => void purge()}
            >
              Удалить мероприятие навсегда
            </button>
          )}
        </section>
        <section className="admin-panel">
          {savedEvent && (
            <RegistrationFormEditor
              key={savedEvent.id}
              event={savedEvent}
              onSaved={setSavedEvent}
            />
          )}
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
        {savedEvent && (
          <EventStreamsEditor
            event={savedEvent}
            onChanged={async () =>
              setSavedEvent(await adminApi.event(savedEvent.id))
            }
          />
        )}
      </div>
    </main>
  );
};

export const EventForm = ({
  event,
  busy,
  readOnly,
  onSubmit,
  onDeleteCover,
  seasons = [],
  categories = [],
  levels = [],
}: {
  event?: EventResponse | undefined;
  busy: boolean;
  readOnly: boolean;
  onSubmit: (form: FormData) => Promise<void>;
  onDeleteCover?: (() => Promise<void>) | undefined;
  seasons?: Season[];
  categories?: ActivityReference[];
  levels?: ActivityReference[];
}) => {
  const values = eventDefaults(event);
  const [coverPreview, setCoverPreview] = useState<string>();
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
          key={values.capacity}
          readOnly={event?.streamsEnabled ?? false}
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
          name="direction"
          label="Направление"
          value={values.direction}
          maxLength={80}
          placeholder="Например: Профориентация"
          disabled={readOnly}
        />
        <label>
          <span>Сезон активности</span>
          <select
            name="seasonId"
            defaultValue={values.seasonId}
            disabled={readOnly}
          >
            <option value="">Не выбран</option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Категория активности</span>
          <select
            name="categoryId"
            defaultValue={values.categoryId}
            disabled={readOnly}
          >
            <option value="">Не выбрана</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Уровень мероприятия</span>
          <select
            name="levelId"
            defaultValue={values.levelId}
            disabled={readOnly}
          >
            <option value="">Не выбран</option>
            {levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">Все даты и время — московские (UTC+3).</p>
        <input type="hidden" name="visibilityConfigured" value="1" />
        <label className="checkbox-row">
          <input
            type="checkbox"
            name="isListed"
            defaultChecked={values.isListed}
            disabled={readOnly}
          />
          Показывать в общем списке мероприятий
        </label>
        <p className="muted">
          Если выключено, регистрация доступна только по прямой ссылке. Ссылку
          можно переслать; это не проверка приглашения.
        </p>
        <fieldset disabled={readOnly}>
          <legend>Кто может зарегистрироваться</legend>
          <input type="hidden" name="allowedPersonTypesConfigured" value="1" />
          {personTypeSchema.options.map((type) => (
            <label className="checkbox-row" key={type}>
              <input
                type="checkbox"
                name="allowedPersonTypes"
                value={type}
                defaultChecked={
                  !values.allowedPersonTypes ||
                  values.allowedPersonTypes.includes(type)
                }
              />
              {personTypeLabels[type]}
            </label>
          ))}
          <p className="muted">
            Выберите хотя бы один тип участника. Уже созданные регистрации
            сохранятся.
          </p>
        </fieldset>
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
      </div>
      <div className="cover-editor">
        <div className="cover-preview">
          {coverPreview || event?.coverObjectKey ? (
            <img
              src={coverPreview ?? publicMediaUrl(event!.coverObjectKey!)}
              alt="Предварительный просмотр обложки"
            />
          ) : (
            <span>Обложка пока не загружена</span>
          )}
        </div>
        {!readOnly && (
          <div className="cover-controls">
            <label className="cover-file-label">
              <span>
                {event?.coverObjectKey
                  ? 'Заменить обложку'
                  : 'Загрузить обложку'}
              </span>
              <input
                name="cover"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(changeEvent) => {
                  if (coverPreview) URL.revokeObjectURL(coverPreview);
                  const file = changeEvent.target.files?.[0];
                  if (file && file.size > 5_242_880) {
                    changeEvent.target.setCustomValidity(
                      'Размер обложки не должен превышать 5 МБ',
                    );
                    changeEvent.target.reportValidity();
                    changeEvent.target.value = '';
                    setCoverPreview(undefined);
                    return;
                  }
                  changeEvent.target.setCustomValidity('');
                  setCoverPreview(file ? URL.createObjectURL(file) : undefined);
                }}
              />
            </label>
            <small>
              JPEG, PNG или WebP, не более 5 МБ. Рекомендуем 1600 × 900.
            </small>
            {event?.coverObjectKey && onDeleteCover && (
              <button
                className="text-button"
                type="button"
                onClick={() => void onDeleteCover()}
              >
                Удалить обложку
              </button>
            )}
          </div>
        )}
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
        <span>Обязательный ответ на сайте</span>
      </label>
      <label className="admin-checkbox">
        <input
          name="onsiteRequired"
          type="checkbox"
          defaultChecked={Boolean(defaults.onsiteRequired)}
        />
        <span>Обязательный ответ при регистрации на месте</span>
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
  ACTIVE: 'Мероприятие идёт',
  COMPLETED: 'Мероприятие завершено',
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
      FORM_FIELD_LIMIT_EXCEEDED:
        'Достигнут лимит дополнительных полей формы. Отключите неиспользуемое поле, чтобы добавить новое',
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

const registrationUrl = (slug: string) => {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/events/${encodeURIComponent(slug)}`;
};
