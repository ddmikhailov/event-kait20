import type {
  EventResponse,
  ExcelImportDecision,
  ExcelImportPreviewResponse,
} from '@event-registration/contracts';
import { Button } from '@event-registration/ui';
import { useState } from 'react';

import { AdminApiError, adminApi } from './admin-api.js';

type Decision = Pick<ExcelImportDecision, 'action' | 'personId'>;

export const EventExcel = ({
  event,
  onBack,
  onCommitted,
}: {
  event: EventResponse;
  onBack: () => void;
  onCommitted: () => void;
}) => {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<ExcelImportPreviewResponse>();
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [capacityOverride, setCapacityOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: 'error' | 'success';
    text: string;
  }>();

  const previewFile = async () => {
    if (!file) {
      setNotice({ kind: 'error', text: 'Сначала выберите файл .xlsx.' });
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      setPreview(await adminApi.previewExcel(event.id, file));
      setDecisions({});
      setCapacityOverride(false);
    } catch (error) {
      setNotice(excelNotice(error));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    const unresolved = preview.rows.some(
      (row) => row.category === 'POSSIBLE_MATCH' && !decisions[row.rowNumber],
    );
    if (unresolved) {
      setNotice({
        kind: 'error',
        text: 'Для каждого возможного совпадения выберите действие.',
      });
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await adminApi.commitExcel(event.id, preview.importJobId, {
        mapping: preview.mapping,
        decisions: Object.entries(decisions).map(([rowNumber, decision]) => ({
          rowNumber: Number(rowNumber),
          action: decision.action,
          ...(decision.personId ? { personId: decision.personId } : {}),
        })),
        capacityOverride,
      });
      setNotice({
        kind: 'success',
        text: `Импорт завершён: добавлено ${result.importedRows}, пропущено ${result.skippedRows + result.duplicateRows}, ошибок ${result.errorRows}.`,
      });
      setPreview(undefined);
      setFile(undefined);
      onCommitted();
    } catch (error) {
      setNotice(excelNotice(error));
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
        <span>{event.title}</span>
      </header>
      <section className="excel-layout">
        <header className="admin-section-title">
          <p className="eyebrow">Excel</p>
          <h1>Импорт участников</h1>
          <p>
            Сначала проверьте предпросмотр. До подтверждения регистрации не
            создаются.
          </p>
        </header>
        {notice && (
          <div className={`admin-notice ${notice.kind}`}>{notice.text}</div>
        )}
        <section className="admin-panel excel-upload-panel">
          <h2>1. Выберите файл</h2>
          <p>
            Одна таблица, до 5 МБ и 5000 строк. Обязательные колонки: Фамилия,
            Имя, Дата рождения, Тип участника, Телефон. Формулы и объединённые
            ячейки не принимаются.
          </p>
          <label className="excel-file-label">
            <span>Файл .xlsx</span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(change) => {
                setFile(change.target.files?.[0]);
                setPreview(undefined);
                setNotice(undefined);
              }}
            />
          </label>
          <Button disabled={busy || !file} onClick={() => void previewFile()}>
            {busy ? 'Проверяем…' : 'Показать предпросмотр'}
          </Button>
        </section>
        {preview && (
          <>
            <PreviewSummary preview={preview} />
            <PreviewRows
              preview={preview}
              decisions={decisions}
              onDecision={(rowNumber, decision) =>
                setDecisions((current) => ({
                  ...current,
                  [rowNumber]: decision,
                }))
              }
            />
            <section className="admin-panel excel-confirm-panel">
              <h2>3. Подтвердите импорт</h2>
              {preview.summary.exceedsCapacity && (
                <label className="excel-override">
                  <input
                    type="checkbox"
                    checked={capacityOverride}
                    onChange={(change) =>
                      setCapacityOverride(change.target.checked)
                    }
                  />
                  <span>
                    Разрешить превышение вместимости ({preview.summary.capacity}
                    {' мест'})
                  </span>
                </label>
              )}
              <p>
                Файл предпросмотра будет удалён сразу после подтверждения.
                Ошибочные и уже зарегистрированные строки будут пропущены.
              </p>
              <Button disabled={busy} onClick={() => void commit()}>
                {busy ? 'Импортируем…' : 'Подтвердить импорт'}
              </Button>
            </section>
          </>
        )}
      </section>
    </main>
  );
};

const PreviewSummary = ({
  preview,
}: {
  preview: ExcelImportPreviewResponse;
}) => {
  const cards = [
    ['Всего строк', preview.summary.totalRows],
    ['Новые', preview.summary.newRows],
    ['Уже зарегистрированы', preview.summary.alreadyRegisteredRows],
    ['Возможные совпадения', preview.summary.possibleMatchRows],
    ['Ошибки', preview.summary.errorRows],
    ['Без email', preview.summary.withoutEmailRows],
  ];
  return (
    <section className="admin-panel">
      <h2>2. Проверьте результат</h2>
      <div className="excel-summary">
        {cards.map(([label, value]) => (
          <article key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </article>
        ))}
      </div>
      <p className={preview.summary.exceedsCapacity ? 'excel-warning' : ''}>
        После импорта: {preview.summary.activeRegistrations} +{' '}
        {preview.summary.capacityImpact} из {preview.summary.capacity} мест.
      </p>
    </section>
  );
};

const PreviewRows = ({
  preview,
  decisions,
  onDecision,
}: {
  preview: ExcelImportPreviewResponse;
  decisions: Record<number, Decision>;
  onDecision: (rowNumber: number, decision: Decision) => void;
}) => (
  <section className="excel-preview-table-wrap">
    <table className="participant-table excel-preview-table">
      <thead>
        <tr>
          <th>Строка</th>
          <th>Участник</th>
          <th>Результат</th>
          <th>Решение</th>
        </tr>
      </thead>
      <tbody>
        {preview.rows.slice(0, 200).map((row) => (
          <tr key={row.rowNumber}>
            <td>{row.rowNumber}</td>
            <td>
              <strong>
                {[row.participant.lastName, row.participant.firstName]
                  .filter(Boolean)
                  .join(' ')}
              </strong>
              <span>
                {row.participant.email ??
                  row.participant.phone ??
                  'Без контакта'}
              </span>
            </td>
            <td>
              <span className={`excel-category ${row.category.toLowerCase()}`}>
                {categoryLabel[row.category]}
              </span>
              {row.errors.map((error) => (
                <small key={error}>{error}</small>
              ))}
            </td>
            <td>
              {row.category === 'POSSIBLE_MATCH' ? (
                <select
                  aria-label={`Решение для строки ${row.rowNumber}`}
                  value={
                    decisions[row.rowNumber]?.action === 'USE_PERSON'
                      ? `USE:${decisions[row.rowNumber]?.personId}`
                      : (decisions[row.rowNumber]?.action ?? '')
                  }
                  onChange={(change) => {
                    const value = change.target.value;
                    onDecision(
                      row.rowNumber,
                      value.startsWith('USE:')
                        ? { action: 'USE_PERSON', personId: value.slice(4) }
                        : { action: value as 'SKIP' | 'CREATE_NEW' },
                    );
                  }}
                >
                  <option value="">Выберите…</option>
                  <option value="SKIP">Пропустить</option>
                  <option value="CREATE_NEW">Создать нового человека</option>
                  {row.candidates.map((candidate) => (
                    <option
                      key={candidate.personId}
                      value={`USE:${candidate.personId}`}
                    >
                      Связать: {candidate.displayName}
                    </option>
                  ))}
                </select>
              ) : (
                'Автоматически'
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    {preview.rows.length > 200 && (
      <p className="admin-empty">
        Показаны первые 200 строк из {preview.rows.length}. Итоговые счётчики
        учитывают весь файл.
      </p>
    )}
  </section>
);

export const downloadEventExcel = async (eventId: string): Promise<void> => {
  const result = await adminApi.exportExcel(eventId);
  const url = URL.createObjectURL(result.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  link.click();
  URL.revokeObjectURL(url);
};

const categoryLabel = {
  NEW: 'Новая регистрация',
  ALREADY_REGISTERED: 'Уже зарегистрирован',
  POSSIBLE_MATCH: 'Нужно решение',
  ERROR: 'Ошибка',
};

const excelNotice = (error: unknown) => ({
  kind: 'error' as const,
  text:
    error instanceof AdminApiError
      ? error.message
      : 'Операция с Excel не выполнена.',
});
