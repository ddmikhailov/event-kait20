import type {
  ActivityDirection,
  ActivityDirectionUpdate,
  ActivityDirectionValues,
  SessionResponse,
} from '@event-registration/contracts';
import {
  activityDirectionUpdateSchema,
  activityDirectionValuesSchema,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useCallback, useEffect, useState } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';

type Notice = { kind: 'error' | 'success'; text: string };

export const directionStatusLabel = (active: boolean): string =>
  active ? 'Активно' : 'Неактивно';

// Pure so the exact canonical-refresh-failure wording (Stage 4 convention:
// the mutation already committed, so this reads as "saved, but the screen
// may be stale" - never as "the action failed") can be unit-tested without
// driving the stateful container.
export const refreshFailureNotice = (successText: string): string =>
  `${successText} Но не удалось обновить список. Обновите страницу.`;

// Structure domain, not Activity - deliberately its own error mapper
// rather than reusing AdminActivity's activityError() (same lesson as
// Stage 4.4's manualAdjustmentError(): a shared code can mean something
// different in each domain, so it gets its own message here rather than a
// borrowed one written for a different endpoint).
export const directionError = (error: unknown): Notice => {
  if (error instanceof AdminApiError) {
    const messages: Record<string, string> = {
      REFERENCE_CONFLICT:
        'Направление с таким кодом или названием уже существует в этой организации.',
      DIRECTION_NOT_FOUND: 'Направление не найдено.',
      ORGANIZATION_SCOPE_MISMATCH:
        'Операции со справочником выполняются в рамках текущей организации.',
      VALIDATION_ERROR: 'Проверьте введённые данные.',
    };
    if (error.code in messages)
      return { kind: 'error', text: messages[error.code]! };
    return { kind: 'error', text: error.message };
  }
  return { kind: 'error', text: 'Не удалось выполнить действие.' };
};

type DirectionValidation<T> =
  | { success: true; data: T }
  | {
      success: false;
      field: 'code' | 'name' | 'description' | 'sortOrder' | 'other';
      message: string;
    };

const fieldFrom = (
  paths: PropertyKey[],
): 'code' | 'name' | 'description' | 'sortOrder' | 'other' => {
  if (paths.includes('code')) return 'code';
  if (paths.includes('name')) return 'name';
  if (paths.includes('description')) return 'description';
  if (paths.includes('sortOrder')) return 'sortOrder';
  return 'other';
};

const FIELD_MESSAGES: Record<string, string> = {
  code: 'Код должен содержать только латинские буквы, цифры и подчёркивание, начинаться с буквы (до 50 символов).',
  name: 'Укажите название направления (до 150 символов).',
  description: 'Описание не должно превышать 500 символов.',
  sortOrder: 'Порядок сортировки должен быть целым числом от 0 до 100 000.',
  other: 'Проверьте введённые данные.',
};

// The full shared contract (the same one the backend's own Pydantic model
// mirrors) is the single gate before any POST/PATCH - not an ad hoc
// hand-rolled check. Pure and independently testable without simulating
// fetch, mirroring parseManualAdjustmentRequest()'s shape from Stage 4.4.
export const parseDirectionCreateRequest = (
  candidate: unknown,
): DirectionValidation<ActivityDirectionValues> => {
  const parsed = activityDirectionValuesSchema.safeParse(candidate);
  if (parsed.success) return { success: true, data: parsed.data };
  const field = fieldFrom(parsed.error.issues.flatMap((issue) => issue.path));
  return { success: false, field, message: FIELD_MESSAGES[field]! };
};

export const parseDirectionUpdateRequest = (
  candidate: unknown,
): DirectionValidation<ActivityDirectionUpdate> => {
  const parsed = activityDirectionUpdateSchema.safeParse(candidate);
  if (parsed.success) return { success: true, data: parsed.data };
  const field = fieldFrom(parsed.error.issues.flatMap((issue) => issue.path));
  return { success: false, field, message: FIELD_MESSAGES[field]! };
};

type Mode = 'idle' | 'create' | 'edit';

export const DirectionPanel = ({
  canManage,
  busy,
  directions,
  mode,
  editingDirection,
  onBeginCreate,
  onBeginEdit,
  onCancelForm,
  onSubmitCreate,
  onSubmitUpdate,
  onActivate,
  onDeactivate,
}: {
  canManage: boolean;
  busy: boolean;
  directions: ActivityDirection[];
  mode: Mode;
  editingDirection: ActivityDirection | undefined;
  onBeginCreate: () => void;
  onBeginEdit: (direction: ActivityDirection) => void;
  onCancelForm: () => void;
  onSubmitCreate: (form: FormData) => void;
  onSubmitUpdate: (form: FormData) => void;
  onActivate: (direction: ActivityDirection) => void;
  onDeactivate: (direction: ActivityDirection) => void;
}) => (
  <section className="admin-panel">
    <h2>Направления</h2>
    <div className="participant-table-wrap">
      <table className="participant-table">
        <thead>
          <tr>
            <th>Код</th>
            <th>Название</th>
            <th>Описание</th>
            <th>Статус</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {directions.map((direction) => (
            <tr key={direction.id}>
              <td>{direction.code}</td>
              <td>{direction.name}</td>
              <td>{direction.description ?? '—'}</td>
              <td>{directionStatusLabel(direction.active)}</td>
              <td>
                {canManage && (
                  <div className="row-actions">
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => onBeginEdit(direction)}
                    >
                      Изменить
                    </button>
                    {direction.active ? (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => onDeactivate(direction)}
                      >
                        Деактивировать
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => onActivate(direction)}
                      >
                        Активировать
                      </button>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
          {directions.length === 0 && (
            <tr>
              <td colSpan={5}>Направлений пока нет.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    {canManage && mode === 'idle' && (
      <div className="row-actions">
        <Button onClick={onBeginCreate} disabled={busy}>
          Добавить направление
        </Button>
      </div>
    )}
    {canManage && mode === 'create' && (
      <form action={onSubmitCreate} className="stack-form">
        <h3>Новое направление</h3>
        <label>
          <span>Код</span>
          <input
            name="code"
            required
            disabled={busy}
            placeholder="PROFORIENTATION"
            maxLength={50}
          />
        </label>
        <label>
          <span>Название</span>
          <input name="name" required disabled={busy} maxLength={150} />
        </label>
        <label>
          <span>Описание</span>
          <textarea name="description" disabled={busy} maxLength={500} />
        </label>
        <label>
          <span>Порядок сортировки</span>
          <input
            name="sortOrder"
            type="number"
            min={0}
            max={100_000}
            step={1}
            defaultValue={0}
            disabled={busy}
          />
        </label>
        <div className="row-actions">
          <Button type="submit" disabled={busy}>
            Сохранить
          </Button>
          <button
            type="button"
            className="text-button"
            onClick={onCancelForm}
            disabled={busy}
          >
            Отмена
          </button>
        </div>
      </form>
    )}
    {canManage && mode === 'edit' && editingDirection && (
      <form action={onSubmitUpdate} className="stack-form">
        <h3>Изменить направление «{editingDirection.name}»</h3>
        <label>
          <span>Код</span>
          <input
            name="code"
            required
            disabled={busy}
            defaultValue={editingDirection.code}
            maxLength={50}
          />
        </label>
        <label>
          <span>Название</span>
          <input
            name="name"
            required
            disabled={busy}
            defaultValue={editingDirection.name}
            maxLength={150}
          />
        </label>
        <label>
          <span>Описание</span>
          <textarea
            name="description"
            disabled={busy}
            defaultValue={editingDirection.description ?? ''}
            maxLength={500}
          />
        </label>
        <label>
          <span>Порядок сортировки</span>
          <input
            name="sortOrder"
            type="number"
            min={0}
            max={100_000}
            step={1}
            defaultValue={editingDirection.sortOrder}
            disabled={busy}
          />
        </label>
        <div className="row-actions">
          <Button type="submit" disabled={busy}>
            Сохранить
          </Button>
          <button
            type="button"
            className="text-button"
            onClick={onCancelForm}
            disabled={busy}
          >
            Отмена
          </button>
        </div>
      </form>
    )}
  </section>
);

export const DirectionAdmin = ({
  role,
  onBack,
}: {
  role: SessionResponse['user']['role'];
  onBack: () => void;
}) => {
  // Stage 4 Final Cleanup: ActivityDirection is structural configuration,
  // resolved per the Stage 4.4 N21 principle - mutations require
  // SUPER_ADMIN, matching the backend's now-changed csrf_super_admin
  // dependency. ORGANIZER keeps read access to this screen (list stays
  // `administrator`); the screen is never hidden from them, only its
  // mutation controls.
  const canManage = role === 'SUPER_ADMIN';
  const [directions, setDirections] = useState<ActivityDirection[]>([]);
  const [mode, setMode] = useState<Mode>('idle');
  const [editingDirection, setEditingDirection] = useState<ActivityDirection>();
  const [loadBusy, setLoadBusy] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const busy = loadBusy || mutationBusy;
  const [notice, setNotice] = useState<Notice>();

  const loadDirections = async (): Promise<boolean> => {
    try {
      // No `active` filter - every inactive Direction must stay
      // administratively visible (otherwise it could never be reactivated
      // or even understood as part of history).
      setDirections((await adminApi.directions()).items);
      return true;
    } catch (error) {
      setNotice(directionError(error));
      return false;
    }
  };

  const load = useCallback(async () => {
    setLoadBusy(true);
    try {
      await loadDirections();
    } finally {
      setLoadBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const beginCreate = () => {
    setMode('create');
    setEditingDirection(undefined);
    setNotice(undefined);
  };

  const beginEdit = (direction: ActivityDirection) => {
    setMode('edit');
    setEditingDirection(direction);
    setNotice(undefined);
  };

  const cancelForm = () => {
    setMode('idle');
    setEditingDirection(undefined);
    setNotice(undefined);
  };

  const afterMutation = async (successText: string) => {
    const refreshed = await loadDirections();
    setNotice(
      refreshed
        ? { kind: 'success', text: successText }
        : { kind: 'error', text: refreshFailureNotice(successText) },
    );
  };

  const submitCreate = async (form: FormData) => {
    const code = String(form.get('code') ?? '')
      .trim()
      .toUpperCase();
    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const sortOrder = Number(form.get('sortOrder') ?? 0);
    const validated = parseDirectionCreateRequest({
      code,
      name,
      description: description || null,
      active: true,
      sortOrder,
    });
    if (!validated.success) {
      setNotice({ kind: 'error', text: validated.message });
      return;
    }
    setMutationBusy(true);
    setNotice(undefined);
    try {
      await adminApi.createDirection(validated.data);
      setMode('idle');
      await afterMutation('Направление добавлено.');
    } catch (error) {
      setNotice(directionError(error));
    } finally {
      setMutationBusy(false);
    }
  };

  const submitUpdate = async (form: FormData) => {
    if (!editingDirection) return;
    const code = String(form.get('code') ?? '')
      .trim()
      .toUpperCase();
    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const sortOrder = Number(form.get('sortOrder') ?? 0);
    const validated = parseDirectionUpdateRequest({
      code,
      name,
      description: description || null,
      sortOrder,
    });
    if (!validated.success) {
      setNotice({ kind: 'error', text: validated.message });
      return;
    }
    setMutationBusy(true);
    setNotice(undefined);
    try {
      await adminApi.updateDirection(editingDirection.id, validated.data);
      setMode('idle');
      setEditingDirection(undefined);
      await afterMutation('Направление изменено.');
    } catch (error) {
      setNotice(directionError(error));
    } finally {
      setMutationBusy(false);
    }
  };

  const activate = async (direction: ActivityDirection) => {
    if (!window.confirm(`Активировать направление «${direction.name}»?`))
      return;
    setMutationBusy(true);
    setNotice(undefined);
    try {
      await adminApi.updateDirection(direction.id, { active: true });
      await afterMutation('Направление активировано.');
    } catch (error) {
      setNotice(directionError(error));
    } finally {
      setMutationBusy(false);
    }
  };

  const deactivate = async (direction: ActivityDirection) => {
    if (!window.confirm(`Деактивировать направление «${direction.name}»?`))
      return;
    setMutationBusy(true);
    setNotice(undefined);
    try {
      await adminApi.deactivateDirection(direction.id);
      await afterMutation('Направление деактивировано.');
    } catch (error) {
      setNotice(directionError(error));
    } finally {
      setMutationBusy(false);
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-editor-header">
        <button type="button" className="text-button" onClick={onBack}>
          ← Мероприятия
        </button>
        <span>Направления</span>
      </header>
      <section className="admin-content">
        <header className="admin-page-heading">
          <div>
            <p className="eyebrow">Activity Core</p>
            <h1>Направления</h1>
            <p>
              Справочник направлений активности, используемый при классификации
              мероприятий.
            </p>
          </div>
        </header>
        {notice && (
          <p className={`admin-notice ${notice.kind}`} role="status">
            {notice.text}
          </p>
        )}
        <DirectionPanel
          canManage={canManage}
          busy={busy}
          directions={directions}
          mode={mode}
          editingDirection={editingDirection}
          onBeginCreate={beginCreate}
          onBeginEdit={beginEdit}
          onCancelForm={cancelForm}
          onSubmitCreate={(form) => void submitCreate(form)}
          onSubmitUpdate={(form) => void submitUpdate(form)}
          onActivate={(direction) => void activate(direction)}
          onDeactivate={(direction) => void deactivate(direction)}
        />
      </section>
    </main>
  );
};
