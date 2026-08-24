import type {
  ExcelImportMapping,
  FormFieldResponse,
} from '@event-registration/contracts';
import {
  emailSchema,
  participantNameSchema,
  personTypeSchema,
  russianPhoneSchema,
} from '@event-registration/contracts';
import ExcelJS from 'exceljs';

import { ApiError } from '../common/api-error.js';

export const EXCEL_FILE_LIMIT = 5 * 1024 * 1024;
export const EXCEL_ROW_LIMIT = 5_000;
export const EXCEL_PREVIEW_TTL_MS = 24 * 60 * 60 * 1_000;

export type ParsedParticipant = {
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
  studyGroup: string | null;
  organization: string | null;
  personType:
    | 'KAIT_STUDENT'
    | 'KAIT_TEACHER'
    | 'EXTERNAL_STUDENT'
    | 'EXTERNAL_TEACHER'
    | null;
};

export type ParsedExcelRow = {
  rowNumber: number;
  participant: ParsedParticipant;
  answers: Map<string, string | boolean | string[]>;
  errors: string[];
};

export type ParsedWorkbook = {
  headers: string[];
  mapping: ExcelImportMapping;
  rows: ParsedExcelRow[];
};

const canonicalHeaders: Omit<ExcelImportMapping, 'customFields'> = {
  lastName: 'Фамилия',
  firstName: 'Имя',
  middleName: 'Отчество',
  birthDate: 'Дата рождения',
  personType: 'Тип участника',
  studyGroup: 'Группа',
  organization: 'Организация',
  phone: 'Телефон',
  email: 'Email',
};

const personTypeAliases = new Map<string, ParsedParticipant['personType']>([
  ['kait_student', 'KAIT_STUDENT'],
  ['студент каит №20', 'KAIT_STUDENT'],
  ['студент каит no20', 'KAIT_STUDENT'],
  ['kait_teacher', 'KAIT_TEACHER'],
  ['преподаватель каит №20', 'KAIT_TEACHER'],
  ['преподаватель каит no20', 'KAIT_TEACHER'],
  ['external_student', 'EXTERNAL_STUDENT'],
  ['студент другой организации', 'EXTERNAL_STUDENT'],
  ['external_teacher', 'EXTERNAL_TEACHER'],
  ['преподаватель другой организации', 'EXTERNAL_TEACHER'],
]);

export const parseExcelWorkbook = async (
  source: Buffer,
  fields: FormFieldResponse[],
  requestedMapping?: ExcelImportMapping,
): Promise<ParsedWorkbook> => {
  if (source.length > EXCEL_FILE_LIMIT || source.length < 4) {
    throw invalidFile('File must be a non-empty XLSX up to 5 MiB');
  }
  if (source[0] !== 0x50 || source[1] !== 0x4b) {
    throw invalidFile('File content is not XLSX');
  }
  validateZipContainer(source);

  const workbook = new ExcelJS.Workbook();
  try {
    const workbookSource = new Uint8Array(source).buffer;
    await workbook.xlsx.load(workbookSource);
  } catch {
    throw invalidFile('XLSX workbook could not be read');
  }
  const sheets = workbook.worksheets.filter(
    (sheet) => sheet.actualRowCount > 0,
  );
  if (sheets.length !== 1) {
    throw invalidFile('Workbook must contain exactly one non-empty worksheet');
  }
  const sheet = sheets[0]!;
  if (sheet.model.merges.length > 0) {
    throw invalidFile('Merged cells are not supported');
  }

  const headerRow = sheet.getRow(1);
  const headers = Array.from({ length: headerRow.cellCount }, (_, index) =>
    cellText(headerRow.getCell(index + 1).value).trim(),
  );
  if (headers.some((header) => !header)) {
    throw invalidFile('Header cells must not be empty');
  }
  if (new Set(headers.map(normalizeHeader)).size !== headers.length) {
    throw invalidFile('Header names must be unique');
  }
  const mapping = requestedMapping ?? proposeMapping(headers, fields);
  assertMapping(mapping, headers, fields);

  const rows: ParsedExcelRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (rowIsEmpty(row, headers.length)) continue;
    if (rows.length >= EXCEL_ROW_LIMIT) {
      throw invalidFile('Workbook contains more than 5000 data rows');
    }
    rows.push(parseRow(row, rowNumber, headers, mapping, fields));
  }
  if (rows.length === 0) throw invalidFile('Workbook has no data rows');
  return { headers, mapping, rows };
};

const proposeMapping = (
  headers: string[],
  fields: FormFieldResponse[],
): ExcelImportMapping => {
  const byNormalized = new Map(
    headers.map((value) => [normalizeHeader(value), value]),
  );
  const required = (key: keyof typeof canonicalHeaders): string => {
    const match = byNormalized.get(normalizeHeader(canonicalHeaders[key]!));
    if (!match)
      throw invalidFile(`Required column is missing: ${canonicalHeaders[key]}`);
    return match;
  };
  const optional = (key: keyof typeof canonicalHeaders): string | undefined =>
    byNormalized.get(normalizeHeader(canonicalHeaders[key]!));
  const customFields: Record<string, string> = {};
  for (const field of fields.filter((item) => item.active)) {
    const header = byNormalized.get(normalizeHeader(`Поле: ${field.label}`));
    if (header) customFields[field.id] = header;
    else if (field.required)
      throw invalidFile(
        `Required form-field column is missing: Поле: ${field.label}`,
      );
  }

  return {
    lastName: required('lastName'),
    firstName: required('firstName'),
    birthDate: required('birthDate'),
    personType: required('personType'),
    phone: required('phone'),
    ...(optional('middleName') ? { middleName: optional('middleName') } : {}),
    ...(optional('studyGroup') ? { studyGroup: optional('studyGroup') } : {}),
    ...(optional('organization')
      ? { organization: optional('organization') }
      : {}),
    ...(optional('email') ? { email: optional('email') } : {}),
    customFields,
  };
};

const assertMapping = (
  mapping: ExcelImportMapping,
  headers: string[],
  fields: FormFieldResponse[],
) => {
  const knownHeaders = new Set(headers);
  const mapped = [
    mapping.lastName,
    mapping.firstName,
    mapping.middleName,
    mapping.birthDate,
    mapping.personType,
    mapping.studyGroup,
    mapping.organization,
    mapping.phone,
    mapping.email,
    ...Object.values(mapping.customFields),
  ].filter((value): value is string => Boolean(value));
  if (mapped.some((header) => !knownHeaders.has(header))) {
    throw invalidFile('Column mapping refers to an unknown header');
  }
  if (new Set(mapped).size !== mapped.length) {
    throw invalidFile('Each source column may be mapped only once');
  }
  const activeIds = new Set(
    fields.filter((field) => field.active).map((field) => field.id),
  );
  if (
    Object.keys(mapping.customFields).some((fieldId) => !activeIds.has(fieldId))
  ) {
    throw invalidFile(
      'Column mapping refers to an inactive or unknown form field',
    );
  }
  for (const field of fields.filter((item) => item.active && item.required)) {
    if (!mapping.customFields[field.id]) {
      throw invalidFile(`Required form field is not mapped: ${field.label}`);
    }
  }
};

const parseRow = (
  row: ExcelJS.Row,
  rowNumber: number,
  headers: string[],
  mapping: ExcelImportMapping,
  fields: FormFieldResponse[],
): ParsedExcelRow => {
  const values = new Map(
    headers.map((header, index) => [header, row.getCell(index + 1).value]),
  );
  const errors: string[] = [];
  const text = (header: string | undefined): string =>
    header ? cellText(values.get(header)).trim() : '';
  for (const [header, value] of values) {
    if (isFormula(value)) errors.push(`Формула не разрешена: ${header}`);
  }
  const name = (header: string, label: string): string => {
    const parsed = participantNameSchema.safeParse(text(header));
    if (!parsed.success)
      errors.push(`${label}: обязательное значение до 100 символов`);
    return parsed.success ? parsed.data : text(header);
  };
  const emailValue = text(mapping.email);
  const parsedEmail = emailValue ? emailSchema.safeParse(emailValue) : null;
  if (parsedEmail && !parsedEmail.success)
    errors.push('Email: неверный формат');
  const phoneValue = text(mapping.phone);
  const parsedPhone = russianPhoneSchema.safeParse(phoneValue);
  if (!parsedPhone.success) errors.push('Телефон: нужен российский номер');
  const personType = parsePersonType(text(mapping.personType));
  if (!personType) errors.push('Тип участника: неизвестное значение');
  const birthDate = parseDate(values.get(mapping.birthDate));
  if (!birthDate)
    errors.push('Дата рождения: используйте ДД.ММ.ГГГГ или ГГГГ-ММ-ДД');
  const studyGroup = nullableText(text(mapping.studyGroup));
  const organization = nullableText(text(mapping.organization));
  if (personType?.endsWith('_STUDENT') && !studyGroup)
    errors.push('Группа обязательна для студента');
  if (personType?.startsWith('EXTERNAL_') && !organization)
    errors.push('Организация обязательна для внешнего участника');

  const answers = new Map<string, string | boolean | string[]>();
  for (const field of fields.filter((item) => item.active)) {
    const raw = text(mapping.customFields[field.id]);
    if (!raw) {
      if (field.required) errors.push(`${field.label}: обязательное поле`);
      continue;
    }
    const answer = parseAnswer(field, raw);
    if (answer === undefined) errors.push(`${field.label}: неверное значение`);
    else answers.set(field.id, answer);
  }

  return {
    rowNumber,
    participant: {
      lastName: name(mapping.lastName, 'Фамилия'),
      firstName: name(mapping.firstName, 'Имя'),
      middleName: nullableText(text(mapping.middleName)),
      birthDate,
      email: parsedEmail?.success ? parsedEmail.data : nullableText(emailValue),
      phone: parsedPhone.success ? parsedPhone.data : nullableText(phoneValue),
      studyGroup,
      organization: personType?.startsWith('EXTERNAL_')
        ? organization
        : 'КАИТ №20',
      personType,
    },
    answers,
    errors,
  };
};

const parseAnswer = (
  field: FormFieldResponse,
  raw: string,
): string | boolean | string[] | undefined => {
  if (field.type === 'BOOLEAN') {
    if (['да', 'true', '1'].includes(raw.toLowerCase())) return true;
    if (['нет', 'false', '0'].includes(raw.toLowerCase())) return false;
    return undefined;
  }
  const options = field.options ?? [];
  if (field.type === 'SINGLE_CHOICE')
    return options.includes(raw) ? raw : undefined;
  if (field.type === 'MULTI_CHOICE') {
    const selected = raw
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean);
    return selected.length > 0 &&
      selected.every((value) => options.includes(value))
      ? selected
      : undefined;
  }
  return raw.length <= 20_000 ? raw : undefined;
};

const parsePersonType = (value: string): ParsedParticipant['personType'] => {
  const alias = personTypeAliases.get(value.trim().toLowerCase());
  if (!alias) return null;
  return personTypeSchema.safeParse(alias).success ? alias : null;
};

const parseDate = (value: ExcelJS.CellValue | undefined): string | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  const raw = cellText(value).trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? raw
    : raw
        .match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
        ?.slice(1)
        .reverse()
        .join('-');
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso
    ? null
    : iso;
};

const rowIsEmpty = (row: ExcelJS.Row, columns: number): boolean =>
  Array.from({ length: columns }, (_, index) =>
    cellText(row.getCell(index + 1).value).trim(),
  ).every((value) => !value);

const isFormula = (value: ExcelJS.CellValue | undefined): boolean =>
  Boolean(value && typeof value === 'object' && 'formula' in value);

const cellText = (value: ExcelJS.CellValue | undefined): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text);
    if ('result' in value) return String(value.result ?? '');
    if ('richText' in value)
      return value.richText.map((part) => part.text).join('');
  }
  return String(value);
};

const nullableText = (value: string): string | null => value || null;
const normalizeHeader = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
const invalidFile = (message: string) =>
  new ApiError(400, 'VALIDATION_ERROR', message);

const validateZipContainer = (source: Buffer): void => {
  const centralHeader = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = 0;
  let entries = 0;
  let expandedBytes = 0;
  let hasWorkbook = false;
  while ((offset = source.indexOf(centralHeader, offset)) >= 0) {
    if (offset + 46 > source.length)
      throw invalidFile('XLSX ZIP directory is invalid');
    const flags = source.readUInt16LE(offset + 8);
    const expanded = source.readUInt32LE(offset + 24);
    const nameLength = source.readUInt16LE(offset + 28);
    const extraLength = source.readUInt16LE(offset + 30);
    const commentLength = source.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > source.length)
      throw invalidFile('XLSX ZIP directory is invalid');
    const name = source
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8')
      .toLowerCase();
    if ((flags & 1) !== 0)
      throw invalidFile('Encrypted XLSX files are not supported');
    if (name.endsWith('vbaproject.bin'))
      throw invalidFile('XLSX macros are not supported');
    if (name === 'xl/workbook.xml') hasWorkbook = true;
    entries += 1;
    expandedBytes += expanded;
    if (entries > 10_000 || expandedBytes > 50 * 1024 * 1024) {
      throw invalidFile('Expanded XLSX content is too large');
    }
    offset = next;
  }
  if (entries === 0 || !hasWorkbook)
    throw invalidFile('File content is not XLSX');
};
