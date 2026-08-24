import type {
  EventResponse,
  FormFieldResponse,
  PersonDetailResponse,
  PersonListResponse,
  RegistrationDetailResponse,
  RegistrationListResponse,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useCallback, useEffect, useState } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';
import { downloadEventExcel, EventExcel } from './AdminExcel.js';
import {
  onsiteValues,
  participantDefaults,
  ParticipantFormError,
  personUpdateValues,
  registrationUpdateValues,
} from './participant-values.js';

type Notice = { kind: 'error' | 'success'; text: string };
type RegistrationSummary = RegistrationListResponse['items'][number];
type PersonSummary = PersonListResponse['items'][number];

export const EventParticipants = ({
  event,
  onBack,
}: {
  event: EventResponse;
  onBack: () => void;
}) => {
  const [response, setResponse] = useState<RegistrationListResponse>();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'ANNULLED'>('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<RegistrationDetailResponse>();
  const [onsite, setOnsite] = useState(false);
  const [excel, setExcel] = useState(false);
  const [fields, setFields] = useState<FormFieldResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setResponse(
        await adminApi.registrations(
          event.id,
          query,
          status || undefined,
          page,
        ),
      );
    } catch (error) {
      setNotice(participantError(error));
    } finally {
      setBusy(false);
    }
  }, [event.id, page, query, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (registrationId: string) => {
    setBusy(true);
    setNotice(undefined);
    try {
      setSelected(await adminApi.registration(event.id, registrationId));
    } catch (error) {
      setNotice(participantError(error));
    } finally {
      setBusy(false);
    }
  };

  const openOnsite = async () => {
    setBusy(true);
    try {
      setFields(
        (await adminApi.formFields(event.id)).items.filter(
          (field) => field.active,
        ),
      );
      setOnsite(true);
    } catch (error) {
      setNotice(participantError(error));
    } finally {
      setBusy(false);
    }
  };

  const sendImportedTickets = async () => {
    if (
      !window.confirm(
        'Поставить в очередь билеты для всех действующих Excel-регистраций с email?',
      )
    )
      return;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await adminApi.sendTickets(event.id, {
        requestId: crypto.randomUUID(),
        selection: 'IMPORTED',
      });
      setNotice({
        kind: 'success',
        text: `В очередь добавлено: ${result.queuedRows}. Без email: ${result.withoutEmailRows}. Уже поставлено этой операцией: ${result.alreadyQueuedRows}.`,
      });
    } catch (error) {
      setNotice(participantError(error));
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <RegistrationDetail
        event={event}
        registration={selected}
        onBack={() => {
          setSelected(undefined);
          void load();
        }}
        onChanged={setSelected}
      />
    );
  }
  if (onsite) {
    return (
      <OnsiteRegistration
        event={event}
        fields={fields}
        onBack={() => {
          setOnsite(false);
          void load();
        }}
      />
    );
  }
  if (excel) {
    return (
      <EventExcel
        event={event}
        onBack={() => setExcel(false)}
        onCommitted={() => void load()}
      />
    );
  }

  const canRegisterOnsite = [
    'REGISTRATION_OPEN',
    'REGISTRATION_CLOSED',
    'ACTIVE',
  ].includes(event.status);
  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button className="text-button" onClick={onBack}>
          ← Все мероприятия
        </button>
        <span className="participant-count">
          {response?.total ?? 0} регистраций
        </span>
      </header>
      <section className="admin-content">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">Участники</p>
            <h1>{event.title}</h1>
            <p>Регистрационные данные относятся только к этому мероприятию.</p>
          </div>
          <div className="row-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void sendImportedTickets()}
            >
              Отправить QR импортированным
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void downloadEventExcel(event.id)
                  .catch((error: unknown) => setNotice(participantError(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Экспортировать Excel
            </button>
            {canRegisterOnsite && (
              <button
                className="secondary-button"
                onClick={() => setExcel(true)}
              >
                Импортировать Excel
              </button>
            )}
            {canRegisterOnsite && (
              <Button onClick={() => void openOnsite()}>
                Добавить на месте
              </Button>
            )}
          </div>
        </header>
        {notice && <ParticipantNotice notice={notice} />}
        <RegistrationFilters
          query={query}
          status={status}
          busy={busy}
          onApply={(nextQuery, nextStatus) => {
            setQuery(nextQuery);
            setStatus(nextStatus);
            setPage(1);
          }}
        />
        <RegistrationTable
          items={response?.items ?? []}
          busy={busy}
          onOpen={open}
        />
        {response && (
          <Pagination
            page={response.page}
            pageSize={response.pageSize}
            total={response.total}
            onPage={setPage}
          />
        )}
      </section>
    </main>
  );
};

const RegistrationFilters = ({
  query,
  status,
  busy,
  onApply,
}: {
  query: string;
  status: '' | 'ACTIVE' | 'ANNULLED';
  busy: boolean;
  onApply: (query: string, status: '' | 'ACTIVE' | 'ANNULLED') => void;
}) => {
  const [draftQuery, setDraftQuery] = useState(query);
  const [draftStatus, setDraftStatus] = useState(status);
  return (
    <form
      className="participant-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draftQuery.trim(), draftStatus);
      }}
    >
      <label>
        <span>Поиск</span>
        <input
          value={draftQuery}
          onChange={(event) => setDraftQuery(event.target.value)}
          placeholder="ФИО, email, телефон или группа"
        />
      </label>
      <label>
        <span>Статус</span>
        <select
          value={draftStatus}
          onChange={(event) =>
            setDraftStatus(event.target.value as typeof draftStatus)
          }
        >
          <option value="">Все</option>
          <option value="ACTIVE">Действующие</option>
          <option value="ANNULLED">Аннулированные</option>
        </select>
      </label>
      <Button type="submit" disabled={busy}>
        Найти
      </Button>
    </form>
  );
};

export const RegistrationTable = ({
  items,
  busy,
  onOpen,
}: {
  items: RegistrationSummary[];
  busy: boolean;
  onOpen: (registrationId: string) => Promise<void>;
}) => (
  <div className="participant-table-wrap">
    <table className="participant-table">
      <thead>
        <tr>
          <th>Участник</th>
          <th>Контакты</th>
          <th>Группа / организация</th>
          <th>Источник</th>
          <th>Статус</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>
              <strong>{fullName(item)}</strong>
              <span>{personTypeLabel(item.personType)}</span>
            </td>
            <td>
              <span>{item.email ?? 'Email не указан'}</span>
              <span>{item.phone ?? 'Телефон не указан'}</span>
            </td>
            <td>{item.studyGroup ?? item.organization ?? '—'}</td>
            <td>{sourceLabel(item.source)}</td>
            <td>
              <RegistrationBadge status={item.status} />
            </td>
            <td>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void onOpen(item.id)}
              >
                Открыть
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    {items.length === 0 && (
      <p className="admin-empty compact">Регистрации не найдены.</p>
    )}
  </div>
);

const RegistrationDetail = ({
  event,
  registration,
  onBack,
  onChanged,
}: {
  event: EventResponse;
  registration: RegistrationDetailResponse;
  onBack: () => void;
  onChanged: (registration: RegistrationDetailResponse) => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const active = registration.status === 'ACTIVE';

  const save = async (form: FormData) => {
    setBusy(true);
    setNotice(undefined);
    try {
      onChanged(
        await adminApi.updateRegistration(
          event.id,
          registration.id,
          registrationUpdateValues(form),
        ),
      );
      setNotice({ kind: 'success', text: 'Регистрационные данные обновлены' });
    } catch (error) {
      setNotice(participantError(error));
    } finally {
      setBusy(false);
    }
  };

  const annul = async () => {
    if (
      !window.confirm('Аннулировать регистрацию? Это действие нельзя отменить.')
    )
      return;
    setBusy(true);
    try {
      await adminApi.annulRegistration(event.id, registration.id);
      onChanged(await adminApi.registration(event.id, registration.id));
      setNotice({
        kind: 'success',
        text: 'Регистрация аннулирована, место освобождено',
      });
    } catch (error) {
      setNotice(participantError(error));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      await adminApi.resendTicket(event.id, registration.id);
      setNotice({
        kind: 'success',
        text: 'Повторная отправка билета поставлена в очередь',
      });
    } catch (error) {
      setNotice(participantError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button className="text-button" onClick={onBack}>
          ← Участники
        </button>
        <RegistrationBadge status={registration.status} />
      </header>
      <div className="participant-detail-layout">
        <section className="admin-panel">
          <div className="admin-section-title">
            <div>
              <p className="eyebrow">Регистрация</p>
              <h1>{fullName(registration)}</h1>
              <p className="muted">{event.title}</p>
            </div>
          </div>
          {notice && <ParticipantNotice notice={notice} />}
          {!active && (
            <ParticipantNotice
              notice={{
                kind: 'success',
                text: 'Аннулированная регистрация доступна только для просмотра.',
              }}
            />
          )}
          <ParticipantForm
            participant={registration}
            disabled={!active}
            busy={busy}
            onSubmit={save}
          />
          {active && (
            <div className="participant-actions">
              <Button
                disabled={busy || !registration.email}
                onClick={() => void resend()}
              >
                Отправить билет повторно
              </Button>
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => void annul()}
              >
                Аннулировать регистрацию
              </button>
              {!registration.email && (
                <span>Email не указан — отправка билета недоступна.</span>
              )}
            </div>
          )}
        </section>
        <RegistrationFacts registration={registration} />
      </div>
    </main>
  );
};

export const ParticipantForm = ({
  participant,
  disabled = false,
  busy = false,
  onSubmit,
}: {
  participant?: RegistrationDetailResponse | PersonDetailResponse | undefined;
  disabled?: boolean;
  busy?: boolean;
  onSubmit: (form: FormData) => Promise<void>;
}) => {
  const defaults = participantDefaults(participant);
  const [personType, setPersonType] = useState(defaults.personType);
  return (
    <form
      className="admin-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(new FormData(event.currentTarget));
      }}
    >
      <div className="form-grid">
        <ParticipantInput
          name="lastName"
          label="Фамилия"
          value={defaults.lastName}
          required
          disabled={disabled}
        />
        <ParticipantInput
          name="firstName"
          label="Имя"
          value={defaults.firstName}
          required
          disabled={disabled}
        />
        <ParticipantInput
          name="middleName"
          label="Отчество"
          value={defaults.middleName}
          disabled={disabled}
        />
        <ParticipantInput
          name="birthDate"
          label="Дата рождения"
          type="date"
          value={defaults.birthDate}
          disabled={disabled}
        />
        <ParticipantInput
          name="email"
          label="Email"
          type="email"
          value={defaults.email}
          disabled={disabled}
        />
        <ParticipantInput
          name="phone"
          label="Телефон"
          type="tel"
          value={defaults.phone}
          disabled={disabled}
        />
        <label>
          <span>Тип участника *</span>
          <select
            name="personType"
            value={personType}
            disabled={disabled}
            onChange={(event) =>
              setPersonType(event.target.value as typeof personType)
            }
          >
            {personTypes.map((type) => (
              <option key={type} value={type}>
                {personTypeLabel(type)}
              </option>
            ))}
          </select>
        </label>
        {personType.endsWith('_STUDENT') && (
          <ParticipantInput
            name="studyGroup"
            label="Учебная группа"
            value={defaults.studyGroup}
            disabled={disabled}
          />
        )}
        {personType.startsWith('EXTERNAL_') && (
          <ParticipantInput
            name="organization"
            label="Организация"
            value={defaults.organization}
            disabled={disabled}
          />
        )}
      </div>
      {!disabled && (
        <Button type="submit" disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      )}
    </form>
  );
};

const RegistrationFacts = ({
  registration,
}: {
  registration: RegistrationDetailResponse;
}) => (
  <aside className="admin-panel participant-facts">
    <div>
      <span>Источник</span>
      <strong>{sourceLabel(registration.source)}</strong>
    </div>
    <div>
      <span>Зарегистрирован</span>
      <strong>{formatDateTime(registration.registeredAt)}</strong>
    </div>
    <div>
      <span>Первое посещение</span>
      <strong>
        {registration.firstAttendedAt
          ? formatDateTime(registration.firstAttendedAt)
          : 'Не отмечено'}
      </strong>
    </div>
    <div>
      <span>Аннулирован</span>
      <strong>
        {registration.annulledAt
          ? formatDateTime(registration.annulledAt)
          : 'Нет'}
      </strong>
    </div>
    <section>
      <h2>Ответы формы</h2>
      {registration.answers.length ? (
        <dl>
          {registration.answers.map((answer) => (
            <div key={answer.fieldId}>
              <dt>{answer.fieldLabel}</dt>
              <dd>{displayAnswer(answer.value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">Дополнительных ответов нет.</p>
      )}
    </section>
  </aside>
);

const OnsiteRegistration = ({
  event,
  fields,
  onBack,
}: {
  event: EventResponse;
  fields: FormFieldResponse[];
  onBack: () => void;
}) => {
  const [personType, setPersonType] = useState<
    'KAIT_STUDENT' | 'KAIT_TEACHER' | 'EXTERNAL_STUDENT' | 'EXTERNAL_TEACHER'
  >('KAIT_STUDENT');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const submit = async (form: FormData) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await adminApi.onsiteRegistration(
        event.id,
        onsiteValues(form, fields),
      );
      setNotice({
        kind: 'success',
        text:
          result.status === 'REGISTERED'
            ? 'Участник зарегистрирован'
            : 'Действующая регистрация уже существовала',
      });
    } catch (error) {
      setNotice(participantError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button className="text-button" onClick={onBack}>
          ← Участники
        </button>
        <span>Очная регистрация</span>
      </header>
      <section className="admin-content onsite-content">
        <div className="admin-panel">
          <div className="admin-section-title">
            <div>
              <p className="eyebrow">На месте</p>
              <h1>Добавить участника</h1>
              <p className="muted">{event.title}</p>
            </div>
          </div>
          {notice && <ParticipantNotice notice={notice} />}
          <form
            className="admin-form"
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault();
              void submit(new FormData(submitEvent.currentTarget));
            }}
          >
            <div className="form-grid">
              <ParticipantInput
                name="lastName"
                label="Фамилия"
                value=""
                required
              />
              <ParticipantInput
                name="firstName"
                label="Имя"
                value=""
                required
              />
              <ParticipantInput name="middleName" label="Отчество" value="" />
              <ParticipantInput
                name="birthDate"
                label="Дата рождения"
                type="date"
                value=""
                required
              />
              <ParticipantInput
                name="email"
                label="Email"
                type="email"
                value=""
              />
              <ParticipantInput
                name="phone"
                label="Телефон"
                type="tel"
                value=""
                required
              />
              <label>
                <span>Тип участника *</span>
                <select
                  name="personType"
                  value={personType}
                  onChange={(changeEvent) =>
                    setPersonType(changeEvent.target.value as typeof personType)
                  }
                >
                  {personTypes.map((type) => (
                    <option key={type} value={type}>
                      {personTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              {personType.endsWith('_STUDENT') && (
                <ParticipantInput
                  name="studyGroup"
                  label="Учебная группа"
                  value=""
                  required
                />
              )}
              {personType.startsWith('EXTERNAL_') && (
                <ParticipantInput
                  name="organization"
                  label="Организация"
                  value=""
                  required
                />
              )}
            </div>
            {fields.length > 0 && (
              <fieldset className="onsite-fields">
                <legend>Дополнительные вопросы</legend>
                {fields.map((field) => (
                  <OnsiteField key={field.id} field={field} />
                ))}
              </fieldset>
            )}
            <label className="capacity-override">
              <input name="capacityOverride" type="checkbox" />
              <span>
                <strong>Разрешить превышение вместимости</strong>Используйте
                только по осознанному решению администратора. Действие попадёт в
                аудит.
              </span>
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? 'Регистрируем…' : 'Зарегистрировать'}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
};

const OnsiteField = ({ field }: { field: FormFieldResponse }) => {
  const name = `field-${field.id}`;
  const label = `${field.label}${field.required ? ' *' : ''}`;
  if (field.type === 'BOOLEAN')
    return (
      <label className="admin-checkbox">
        <input name={name} type="checkbox" required={field.required} />
        <span>{label}</span>
      </label>
    );
  if (field.type === 'SINGLE_CHOICE')
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
  if (field.type === 'MULTI_CHOICE')
    return (
      <div className="choice-group">
        <p>{label}</p>
        {field.options?.map((option) => (
          <label className="choice-row" key={option}>
            <input name={name} type="checkbox" value={option} />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  return (
    <label>
      <span>{label}</span>
      {field.type === 'LONG_TEXT' ? (
        <textarea name={name} required={field.required} />
      ) : (
        <input name={name} required={field.required} />
      )}
    </label>
  );
};

export const PeopleDirectory = ({ onBack }: { onBack: () => void }) => {
  const [response, setResponse] = useState<PersonListResponse>();
  const [query, setQuery] = useState('');
  const [draftQuery, setDraftQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PersonDetailResponse>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setResponse(await adminApi.people(query, page));
    } catch (error) {
      setNotice(participantError(error));
    } finally {
      setBusy(false);
    }
  }, [page, query]);
  useEffect(() => {
    void load();
  }, [load]);
  const open = async (personId: string) => {
    setBusy(true);
    try {
      setSelected(await adminApi.person(personId));
    } catch (error) {
      setNotice(participantError(error));
    } finally {
      setBusy(false);
    }
  };
  if (selected)
    return (
      <PersonDetail
        person={selected}
        onBack={() => {
          setSelected(undefined);
          void load();
        }}
        onChanged={setSelected}
      />
    );
  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button className="text-button" onClick={onBack}>
          ← Мероприятия
        </button>
        <span>{response?.total ?? 0} человек</span>
      </header>
      <section className="admin-content">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">Общая база</p>
            <h1>Люди</h1>
            <p>Текущие контактные данные и история участий.</p>
          </div>
        </header>
        {notice && <ParticipantNotice notice={notice} />}
        <form
          className="participant-filters people-filter"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(draftQuery.trim());
            setPage(1);
          }}
        >
          <label>
            <span>Поиск</span>
            <input
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              placeholder="ФИО, email, телефон или группа"
            />
          </label>
          <Button type="submit" disabled={busy}>
            Найти
          </Button>
        </form>
        <PeopleTable items={response?.items ?? []} busy={busy} onOpen={open} />
        {response && (
          <Pagination
            page={response.page}
            pageSize={response.pageSize}
            total={response.total}
            onPage={setPage}
          />
        )}
      </section>
    </main>
  );
};

const PeopleTable = ({
  items,
  busy,
  onOpen,
}: {
  items: PersonSummary[];
  busy: boolean;
  onOpen: (personId: string) => Promise<void>;
}) => (
  <div className="participant-table-wrap">
    <table className="participant-table">
      <thead>
        <tr>
          <th>Человек</th>
          <th>Контакты</th>
          <th>Группа / организация</th>
          <th>Проверка</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {items.map((person) => (
          <tr key={person.id}>
            <td>
              <strong>{fullName(person)}</strong>
              <span>{personTypeLabel(person.personType)}</span>
            </td>
            <td>
              <span>{person.email ?? 'Email не указан'}</span>
              <span>{person.phone ?? 'Телефон не указан'}</span>
            </td>
            <td>{person.studyGroup ?? person.organization ?? '—'}</td>
            <td>
              {person.dedupReviewRequired ? (
                <span className="review-badge">Требует проверки</span>
              ) : (
                '—'
              )}
            </td>
            <td>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void onOpen(person.id)}
              >
                Открыть
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    {items.length === 0 && (
      <p className="admin-empty compact">Люди не найдены.</p>
    )}
  </div>
);

const PersonDetail = ({
  person,
  onBack,
  onChanged,
}: {
  person: PersonDetailResponse;
  onBack: () => void;
  onChanged: (person: PersonDetailResponse) => void;
}) => {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const save = async (form: FormData) => {
    setBusy(true);
    try {
      onChanged(
        await adminApi.updatePerson(person.id, personUpdateValues(form)),
      );
      setNotice({
        kind: 'success',
        text: 'Текущие данные человека обновлены. Исторические регистрации не изменены.',
      });
    } catch (error) {
      setNotice(participantError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button className="text-button" onClick={onBack}>
          ← Общая база
        </button>
        {person.dedupReviewRequired && (
          <span className="review-badge">Требует проверки</span>
        )}
      </header>
      <div className="participant-detail-layout">
        <section className="admin-panel">
          <div className="admin-section-title">
            <div>
              <p className="eyebrow">Текущая карточка</p>
              <h1>{fullName(person)}</h1>
            </div>
          </div>
          {notice && <ParticipantNotice notice={notice} />}
          <ParticipantForm participant={person} busy={busy} onSubmit={save} />
        </section>
        <aside className="admin-panel participant-history">
          <h2>История участий</h2>
          {person.registrations.map((item) => (
            <article key={item.id}>
              <strong>{item.eventTitle}</strong>
              <span>
                {formatDateTime(item.registeredAt)} · {sourceLabel(item.source)}
              </span>
              <RegistrationBadge status={item.status} />
            </article>
          ))}
          {person.registrations.length === 0 && (
            <p className="muted">Истории участий нет.</p>
          )}
        </aside>
      </div>
    </main>
  );
};

const ParticipantInput = ({
  label,
  value,
  ...props
}: Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'defaultValue' | 'value'
> & { label: string; value: string }) => (
  <label>
    <span>
      {label}
      {props.required ? ' *' : ''}
    </span>
    <input {...props} defaultValue={value} />
  </label>
);
const ParticipantNotice = ({ notice }: { notice: Notice }) => (
  <div
    className={`admin-notice ${notice.kind}`}
    role={notice.kind === 'error' ? 'alert' : 'status'}
  >
    {notice.text}
  </div>
);
const RegistrationBadge = ({ status }: { status: 'ACTIVE' | 'ANNULLED' }) => (
  <span className={`registration-badge ${status.toLowerCase()}`}>
    {status === 'ACTIVE' ? 'Действует' : 'Аннулирована'}
  </span>
);
const Pagination = ({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="pagination" aria-label="Страницы">
      <button
        className="secondary-button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        ← Назад
      </button>
      <span>
        Страница {page} из {pages}
      </span>
      <button
        className="secondary-button"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Вперёд →
      </button>
    </nav>
  );
};

const personTypes = [
  'KAIT_STUDENT',
  'KAIT_TEACHER',
  'EXTERNAL_STUDENT',
  'EXTERNAL_TEACHER',
] as const;
const personTypeLabels = {
  KAIT_STUDENT: 'Студент КАИТ №20',
  KAIT_TEACHER: 'Преподаватель КАИТ №20',
  EXTERNAL_STUDENT: 'Студент другой организации',
  EXTERNAL_TEACHER: 'Преподаватель другой организации',
} as const;
const sourceLabels = {
  PUBLIC_FORM: 'Публичная форма',
  EXCEL_IMPORT: 'Excel',
  ONSITE: 'На месте',
  ADMIN_MANUAL: 'Администратор',
} as const;
const personTypeLabel = (type: keyof typeof personTypeLabels) =>
  personTypeLabels[type];
const sourceLabel = (source: keyof typeof sourceLabels) => sourceLabels[source];
const fullName = (person: {
  lastName: string;
  firstName: string;
  middleName: string | null;
}) =>
  [person.lastName, person.firstName, person.middleName]
    .filter(Boolean)
    .join(' ');
const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
const displayAnswer = (value: unknown): string =>
  Array.isArray(value)
    ? value.join(', ')
    : typeof value === 'boolean'
      ? value
        ? 'Да'
        : 'Нет'
      : String(value ?? '—');

const participantError = (error: unknown): Notice => {
  if (error instanceof ParticipantFormError) {
    return { kind: 'error', text: error.message };
  }
  if (error instanceof AdminApiError) {
    const messages: Record<string, string> = {
      REGISTRATION_NOT_FOUND: 'Регистрация не найдена',
      REGISTRATION_ANNULLED: 'Регистрация уже аннулирована',
      CAPACITY_FULL: 'Свободных мест нет',
      INVALID_EVENT_STATE:
        'Состояние мероприятия не позволяет выполнить операцию',
      FORM_VERSION_INVALID: 'Поля формы изменились. Обновите страницу',
      VALIDATION_ERROR: 'Проверьте заполненные поля',
      UNAUTHENTICATED: 'Сессия завершена. Обновите страницу и войдите снова',
      FORBIDDEN: 'Недостаточно прав',
      NETWORK_ERROR: 'Нет соединения с сервером',
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
