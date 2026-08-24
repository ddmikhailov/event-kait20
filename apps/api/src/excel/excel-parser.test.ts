import type { FormFieldResponse } from '@event-registration/contracts';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { parseExcelWorkbook } from './excel-parser.js';

const fields: FormFieldResponse[] = [];
const headers = [
  'Фамилия',
  'Имя',
  'Дата рождения',
  'Тип участника',
  'Группа',
  'Телефон',
  'Email',
];

const workbookBuffer = async (
  edit: (sheet: ExcelJS.Worksheet) => void,
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Импорт');
  sheet.addRow(headers);
  sheet.addRow([
    'Иванов',
    'Иван',
    '2000-01-02',
    'Студент КАИТ №20',
    'ИС-1',
    '+79990000000',
    '',
  ]);
  edit(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

describe('Excel import parser', () => {
  it('parses the canonical Russian template and normalizes values', async () => {
    const parsed = await parseExcelWorkbook(
      await workbookBuffer(() => undefined),
      fields,
    );

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.errors).toEqual([]);
    expect(parsed.rows[0]?.participant).toMatchObject({
      birthDate: '2000-01-02',
      email: null,
      organization: 'КАИТ №20',
      personType: 'KAIT_STUDENT',
      phone: '+79990000000',
    });
  });

  it('reports formulas as row errors', async () => {
    const source = await workbookBuffer((sheet) => {
      sheet.getCell('A2').value = { formula: '1+1', result: 2 };
    });

    const parsed = await parseExcelWorkbook(source, fields);
    expect(parsed.rows[0]?.errors).toContain('Формула не разрешена: Фамилия');
  });

  it('rejects merged cells', async () => {
    const source = await workbookBuffer((sheet) => sheet.mergeCells('A2:B2'));

    await expect(parseExcelWorkbook(source, fields)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
