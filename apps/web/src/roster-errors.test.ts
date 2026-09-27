import { describe, expect, it } from 'vitest';

import { AdminApiError } from './admin-api.js';
import { rosterErrorMessage } from './roster-errors.js';

describe('roster import errors', () => {
  it('explains the exact cell and correction without echoing uploaded values', () => {
    const message = rosterErrorMessage(
      new AdminApiError('INVALID_ROSTER_FILE', 400, 'private cell content', {
        reason: 'FORMULA',
        row: 12,
        column: 2,
      }),
    );
    expect(message).toContain('Строка 12, столбец 2');
    expect(message).toContain('Замените формулы значениями');
    expect(message).not.toContain('private');
  });

  it('identifies both duplicate rows', () => {
    expect(
      rosterErrorMessage(
        new AdminApiError('DUPLICATE_ROSTER_STUDENT', 409, '', {
          reason: 'DUPLICATE_STUDENT',
          row: 17,
          firstRow: 5,
        }),
      ),
    ).toContain('Строка 17. ФИО и группа повторяют строку 5');
  });

  it('falls back safely for old servers or invalid error metadata', () => {
    for (const details of [
      undefined,
      { reason: 'FORMULA', row: 'private cell value' },
    ]) {
      const message = rosterErrorMessage(
        new AdminApiError('INVALID_ROSTER_FILE', 400, 'private', details),
      );
      expect(message).toContain('XLSX');
      expect(message).not.toContain('private');
    }
  });

  it('explains already imported students and changed files', () => {
    expect(
      rosterErrorMessage(new AdminApiError('ROSTER_STUDENT_EXISTS', 409, '')),
    ).toContain('уже есть');
    expect(
      rosterErrorMessage(new AdminApiError('ROSTER_FILE_CHANGED', 409, '')),
    ).toContain('Проверить файл');
  });

  it('leaves authentication and network errors to the common handler', () => {
    expect(
      rosterErrorMessage(new AdminApiError('UNAUTHENTICATED', 401, '')),
    ).toBeUndefined();
  });
});
