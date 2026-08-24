import {
  eventAccessRequestSchema,
  staffInvitationRequestSchema,
  type EventAccessListResponse,
  type EventResponse,
  type StaffListResponse,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useCallback, useEffect, useState } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';

type Notice = { kind: 'error' | 'success'; text: string };
type StaffSummary = StaffListResponse['items'][number];
type AccessSummary = EventAccessListResponse['items'][number];

export const StaffDirectory = ({
  events,
  currentUserId,
  onBack,
}: {
  events: EventResponse[];
  currentUserId: string;
  onBack: () => void;
}) => {
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setStaff((await adminApi.staff()).items);
    } catch (error) {
      setNotice(staffError(error));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = async (form: FormData) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const eventId = String(form.get('eventId') ?? '').trim();
      const result = await adminApi.inviteStaff(
        staffInvitationRequestSchema.parse({
          email: String(form.get('email') ?? ''),
          ...(eventId ? { eventId } : {}),
        }),
      );
      setNotice({
        kind: 'success',
        text: `Приглашение поставлено в очередь и действует до ${formatDateTime(result.expiresAt)}.`,
      });
      await load();
    } catch (error) {
      setNotice(staffError(error));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (user: StaffSummary) => {
    if (
      !window.confirm(
        `Деактивировать ${user.email}? Все действующие сессии будут отозваны.`,
      )
    )
      return;
    setBusy(true);
    try {
      await adminApi.deactivateStaff(user.id);
      await load();
      setNotice({
        kind: 'success',
        text: 'Учётная запись деактивирована, действующие сессии отозваны.',
      });
    } catch (error) {
      setNotice(staffError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button className="text-button" onClick={onBack}>
          ← Мероприятия
        </button>
        <span>{staff.length} сотрудников</span>
      </header>
      <div className="staff-layout">
        <section className="admin-panel">
          <div className="admin-section-title">
            <div>
              <p className="eyebrow">Новый сотрудник</p>
              <h1>Пригласить сканировщика</h1>
              <p className="muted">
                Ссылка создаётся на сервере и отправляется через очередь писем.
              </p>
            </div>
          </div>
          {notice && <StaffNotice notice={notice} />}
          <form
            className="admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              void invite(new FormData(event.currentTarget));
            }}
          >
            <label>
              <span>Email *</span>
              <input name="email" type="email" required />
            </label>
            <label>
              <span>Сразу назначить мероприятие</span>
              <select name="eventId" defaultValue="">
                <option value="">Без назначения</option>
                {events
                  .filter((event) => event.status !== 'ARCHIVED')
                  .map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title}
                    </option>
                  ))}
              </select>
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? 'Создаём приглашение…' : 'Отправить приглашение'}
            </Button>
          </form>
        </section>
        <section className="admin-panel staff-list-panel">
          <div className="admin-section-title">
            <div>
              <p className="eyebrow">Доступ</p>
              <h2>Сотрудники</h2>
            </div>
          </div>
          <StaffList
            staff={staff}
            currentUserId={currentUserId}
            busy={busy}
            onDeactivate={deactivate}
          />
        </section>
      </div>
    </main>
  );
};

export const StaffList = ({
  staff,
  currentUserId,
  busy,
  onDeactivate,
}: {
  staff: StaffSummary[];
  currentUserId: string;
  busy: boolean;
  onDeactivate: (user: StaffSummary) => Promise<void>;
}) => (
  <div className="staff-list">
    {staff.map((user) => (
      <article className={!user.active ? 'inactive' : ''} key={user.id}>
        <div>
          <strong>{user.email}</strong>
          <span>
            {roleLabel(user.role)} · создан {formatDate(user.createdAt)}
          </span>
        </div>
        <div className="staff-row-actions">
          <span className={`staff-status ${user.active ? 'active' : ''}`}>
            {user.active ? 'Активен' : 'Отключён'}
          </span>
          {user.active && user.id !== currentUserId && (
            <button
              className="text-button danger-text"
              disabled={busy}
              onClick={() => void onDeactivate(user)}
            >
              Деактивировать
            </button>
          )}
          {user.id === currentUserId && <em>Текущая учётная запись</em>}
        </div>
      </article>
    ))}
    {staff.length === 0 && (
      <p className="admin-empty compact">Сотрудников пока нет.</p>
    )}
  </div>
);

export const EventAccessManager = ({
  event,
  onBack,
}: {
  event: EventResponse;
  onBack: () => void;
}) => {
  const [access, setAccess] = useState<AccessSummary[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [accessResponse, staffResponse] = await Promise.all([
        adminApi.eventAccess(event.id),
        adminApi.staff(),
      ]);
      setAccess(accessResponse.items);
      setStaff(staffResponse.items);
    } catch (error) {
      setNotice(staffError(error));
    } finally {
      setBusy(false);
    }
  }, [event.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const assign = async (userId: string) => {
    setBusy(true);
    setNotice(undefined);
    try {
      await adminApi.assignEventAccess(
        event.id,
        eventAccessRequestSchema.parse({ userId }),
      );
      await load();
      setNotice({ kind: 'success', text: 'Доступ к мероприятию назначен.' });
    } catch (error) {
      setNotice(staffError(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: AccessSummary) => {
    if (!window.confirm(`Убрать доступ к мероприятию у ${item.email}?`)) return;
    setBusy(true);
    try {
      await adminApi.removeEventAccess(event.id, item.userId);
      await load();
      setNotice({ kind: 'success', text: 'Доступ к мероприятию удалён.' });
    } catch (error) {
      setNotice(staffError(error));
    } finally {
      setBusy(false);
    }
  };

  const assigned = new Set(access.map((item) => item.userId));
  const available = staff.filter(
    (user) => user.role === 'SCANNER' && user.active && !assigned.has(user.id),
  );
  const archived = event.status === 'ARCHIVED';

  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button className="text-button" onClick={onBack}>
          ← Мероприятия
        </button>
        <span>{access.length} назначений</span>
      </header>
      <section className="admin-content access-content">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">Доступ сканеров</p>
            <h1>{event.title}</h1>
            <p>Сканировщик увидит только явно назначенные мероприятия.</p>
          </div>
        </header>
        {notice && <StaffNotice notice={notice} />}
        {!archived && (
          <AccessAssignment
            available={available}
            busy={busy}
            onAssign={assign}
          />
        )}
        {archived && (
          <StaffNotice
            notice={{
              kind: 'success',
              text: 'Архивному мероприятию нельзя назначать новый доступ.',
            }}
          />
        )}
        <section className="admin-panel access-list-panel">
          <h2>Назначенные сканировщики</h2>
          <AccessList access={access} busy={busy} onRemove={remove} />
        </section>
      </section>
    </main>
  );
};

const AccessAssignment = ({
  available,
  busy,
  onAssign,
}: {
  available: StaffSummary[];
  busy: boolean;
  onAssign: (userId: string) => Promise<void>;
}) => {
  const [userId, setUserId] = useState('');
  return (
    <form
      className="access-assignment"
      onSubmit={(event) => {
        event.preventDefault();
        if (userId) void onAssign(userId);
      }}
    >
      <label>
        <span>Активный SCANNER</span>
        <select
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          required
        >
          <option value="">Выберите сотрудника</option>
          {available.map((user) => (
            <option key={user.id} value={user.id}>
              {user.email}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={busy || !userId}>
        Назначить доступ
      </Button>
      {available.length === 0 && (
        <p>Нет свободных активных SCANNER. Пригласите нового сотрудника.</p>
      )}
    </form>
  );
};

export const AccessList = ({
  access,
  busy,
  onRemove,
}: {
  access: AccessSummary[];
  busy: boolean;
  onRemove: (item: AccessSummary) => Promise<void>;
}) => (
  <div className="staff-list">
    {access.map((item) => (
      <article key={item.userId}>
        <div>
          <strong>{item.email}</strong>
          <span>Назначен {formatDateTime(item.createdAt)}</span>
        </div>
        <button
          className="text-button danger-text"
          disabled={busy}
          onClick={() => void onRemove(item)}
        >
          Убрать доступ
        </button>
      </article>
    ))}
    {access.length === 0 && (
      <p className="admin-empty compact">Сканировщики ещё не назначены.</p>
    )}
  </div>
);

const StaffNotice = ({ notice }: { notice: Notice }) => (
  <div
    className={`admin-notice ${notice.kind}`}
    role={notice.kind === 'error' ? 'alert' : 'status'}
  >
    {notice.text}
  </div>
);

const roleLabel = (role: StaffSummary['role']) =>
  role === 'SUPER_ADMIN' ? 'Администратор' : 'Сканировщик';
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(
    new Date(value),
  );
const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

const staffError = (error: unknown): Notice => {
  if (error instanceof AdminApiError) {
    const messages: Record<string, string> = {
      CONFLICT:
        'Операция невозможна: учётная запись уже существует, неактивна или защищена от деактивации.',
      NOT_FOUND: 'Сотрудник не найден.',
      EVENT_NOT_FOUND: 'Мероприятие не найдено.',
      INVALID_EVENT_STATE: 'Архивному мероприятию нельзя назначать доступ.',
      VALIDATION_ERROR: 'Проверьте заполненные поля.',
      UNAUTHENTICATED: 'Сессия завершена. Обновите страницу и войдите снова.',
      FORBIDDEN: 'Недостаточно прав.',
      NETWORK_ERROR: 'Нет соединения с сервером.',
    };
    return {
      kind: 'error',
      text: messages[error.code] ?? 'Не удалось выполнить операцию.',
    };
  }
  return { kind: 'error', text: 'Проверьте данные и попробуйте снова.' };
};
