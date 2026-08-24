import { createHash, randomUUID } from 'node:crypto';

import type {
  ExcelImportCommitRequest,
  ExcelImportCommitResponse,
  ExcelImportMapping,
  ExcelImportPreviewResponse,
  FormFieldResponse,
} from '@event-registration/contracts';
import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Pool, PoolClient } from 'pg';

import { ApiError } from '../common/api-error.js';
import { DATABASE_POOL } from '../common/tokens.js';
import {
  EXCEL_PREVIEW_TTL_MS,
  parseExcelWorkbook,
  type ParsedExcelRow,
  type ParsedParticipant,
} from './excel-parser.js';

type EventRow = { capacity: number; id: string; status: string; title: string };
type Candidate = {
  birth_date: Date | null;
  email_normalized: string | null;
  first_name: string;
  id: string;
  last_name: string;
  middle_name: string | null;
  organization: string | null;
  phone_normalized: string | null;
  study_group: string | null;
};
type Classified = {
  category: 'NEW' | 'ALREADY_REGISTERED' | 'POSSIBLE_MATCH' | 'ERROR';
  candidates: ExcelImportPreviewResponse['rows'][number]['candidates'];
  matchedPersonId?: string;
  row: ParsedExcelRow;
};
type JobRow = {
  committed_at: Date | null;
  event_id: string;
  expires_at: Date;
  file_data: Buffer | null;
  status: string;
};
type FieldRow = {
  active: boolean;
  created_at: Date;
  event_id: string;
  id: string;
  label: string;
  options: unknown;
  required: boolean;
  sort_order: number;
  type: FormFieldResponse['type'];
  updated_at: Date;
};

@Injectable()
export class ExcelService {
  public constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  public async preview(
    eventId: string,
    actorId: string,
    file: Express.Multer.File,
    mapping?: ExcelImportMapping,
  ): Promise<ExcelImportPreviewResponse> {
    const event = await this.event(this.pool, eventId);
    this.assertOperational(event);
    const fields = await this.fields(this.pool, eventId);
    const parsed = await parseExcelWorkbook(file.buffer, fields, mapping);
    markDuplicateRows(parsed.rows);
    const classified = await this.classify(this.pool, eventId, parsed.rows);
    const activeRegistrations = await this.activeCount(this.pool, eventId);
    const summary = this.summary(
      classified,
      activeRegistrations,
      event.capacity,
    );
    const importJobId = randomUUID();
    const expiresAt = new Date(Date.now() + EXCEL_PREVIEW_TTL_MS);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO import_jobs
          (id, event_id, created_by, status, total_rows, valid_rows,
           error_rows, duplicate_rows, result_summary, expires_at,
           created_at, updated_at)
         VALUES ($1, $2, $3, 'PREVIEW_READY', $4, $5, $6, $7,
                 $8::jsonb, $9, now(), now())`,
        [
          importJobId,
          eventId,
          actorId,
          summary.totalRows,
          summary.totalRows - summary.errorRows,
          summary.errorRows,
          summary.alreadyRegisteredRows,
          JSON.stringify(summary),
          expiresAt,
        ],
      );
      await client.query(
        `INSERT INTO import_job_files
          (import_job_id, file_data, sha256, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [
          importJobId,
          file.buffer,
          createHash('sha256').update(file.buffer).digest('hex'),
          expiresAt,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return {
      importJobId,
      expiresAt: expiresAt.toISOString(),
      headers: parsed.headers,
      mapping: parsed.mapping,
      summary,
      rows: classified.map((item) => ({
        rowNumber: item.row.rowNumber,
        category: item.category,
        errors: item.row.errors,
        participant: item.row.participant,
        candidates: item.candidates,
      })),
    };
  }

  public async commit(
    eventId: string,
    importJobId: string,
    actorId: string,
    values: ExcelImportCommitRequest,
  ): Promise<ExcelImportCommitResponse> {
    const decisions = new Map(
      values.decisions.map((decision) => [decision.rowNumber, decision]),
    );
    if (decisions.size !== values.decisions.length) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Row decisions must be unique',
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const job = await this.lockJob(client, eventId, importJobId);
      if (job.status !== 'PREVIEW_READY' || job.committed_at) {
        throw new ApiError(
          409,
          'CONFLICT',
          'Import preview is no longer available',
        );
      }
      if (job.expires_at.getTime() <= Date.now() || !job.file_data) {
        await client.query(
          `UPDATE import_jobs SET status = 'EXPIRED', updated_at = now()
           WHERE id = $1`,
          [importJobId],
        );
        await client.query(
          'DELETE FROM import_job_files WHERE import_job_id = $1',
          [importJobId],
        );
        await client.query('COMMIT');
        throw new ApiError(409, 'CONFLICT', 'Import preview has expired');
      }
      const event = await this.lockEvent(client, eventId);
      this.assertOperational(event);
      const fields = await this.fields(client, eventId);
      const parsed = await parseExcelWorkbook(
        job.file_data,
        fields,
        values.mapping,
      );
      markDuplicateRows(parsed.rows);
      const classified = await this.classify(
        client,
        eventId,
        parsed.rows,
        true,
      );

      for (const item of classified) {
        const decision = decisions.get(item.row.rowNumber);
        if (item.category === 'POSSIBLE_MATCH' && !decision) {
          throw new ApiError(
            409,
            'CONFLICT',
            'Every possible match needs a decision',
          );
        }
        if (decision?.action === 'USE_PERSON') {
          const permitted = item.candidates.some(
            (candidate) => candidate.personId === decision.personId,
          );
          if (!permitted) {
            throw new ApiError(
              409,
              'CONFLICT',
              'Selected person is not a current candidate',
            );
          }
        }
      }

      const activeBefore = await this.activeCount(client, eventId);
      const potential = classified.filter((item) => {
        if (item.category === 'ERROR' || item.category === 'ALREADY_REGISTERED')
          return false;
        return decisions.get(item.row.rowNumber)?.action !== 'SKIP';
      }).length;
      if (
        activeBefore + potential > event.capacity &&
        !values.capacityOverride
      ) {
        throw new ApiError(
          409,
          'CAPACITY_FULL',
          'Import would exceed Event capacity',
        );
      }

      let importedRows = 0;
      let skippedRows = 0;
      let duplicateRows = 0;
      let errorRows = 0;
      let withoutEmailRows = 0;
      for (const item of classified) {
        if (item.category === 'ERROR') {
          errorRows += 1;
          continue;
        }
        if (item.category === 'ALREADY_REGISTERED') {
          duplicateRows += 1;
          continue;
        }
        const decision = decisions.get(item.row.rowNumber);
        if (decision?.action === 'SKIP') {
          skippedRows += 1;
          continue;
        }
        const personId =
          decision?.action === 'USE_PERSON'
            ? decision.personId!
            : (item.matchedPersonId ??
              (await this.createPerson(
                client,
                item.row.participant,
                item.category === 'POSSIBLE_MATCH',
              )));
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM registrations
           WHERE event_id = $1 AND person_id = $2 AND status = 'ACTIVE'
           FOR UPDATE`,
          [eventId, personId],
        );
        if (existing.rows[0]) {
          duplicateRows += 1;
          continue;
        }
        const registrationId = await this.createRegistration(
          client,
          eventId,
          personId,
          item.row.participant,
        );
        await this.saveAnswers(client, registrationId, item.row, fields);
        importedRows += 1;
        if (!item.row.participant.email) withoutEmailRows += 1;
      }
      if (importedRows > 0) {
        await client.query(
          `UPDATE events SET offline_data_version = offline_data_version + 1,
             updated_at = now() WHERE id = $1`,
          [eventId],
        );
      }
      const result = {
        importJobId,
        importedRows,
        skippedRows,
        duplicateRows,
        errorRows,
        withoutEmailRows,
      };
      await client.query(
        `UPDATE import_jobs SET status = 'COMPLETED', valid_rows = $2,
           error_rows = $3, duplicate_rows = $4, result_summary = $5::jsonb,
           committed_at = now(), updated_at = now() WHERE id = $1`,
        [
          importJobId,
          importedRows,
          errorRows,
          duplicateRows,
          JSON.stringify(result),
        ],
      );
      await client.query(
        'DELETE FROM import_job_files WHERE import_job_id = $1',
        [importJobId],
      );
      await client.query(
        `INSERT INTO audit_log
          (id, actor_user_id, action, entity_type, entity_id, metadata, created_at)
         VALUES ($1, $2, 'EXCEL_IMPORT_COMMITTED', 'ImportJob', $3, $4::jsonb, now())`,
        [
          randomUUID(),
          actorId,
          importJobId,
          JSON.stringify({
            importedRows,
            skippedRows,
            duplicateRows,
            errorRows,
            capacityOverride: values.capacityOverride,
          }),
        ],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async export(
    eventId: string,
  ): Promise<{ data: Buffer; filename: string }> {
    const event = await this.event(this.pool, eventId);
    const fields = await this.fields(this.pool, eventId, false);
    const registrations = await this.pool.query<{
      birth_date: Date | null;
      email: string | null;
      first_attended_at: Date | null;
      first_name: string;
      id: string;
      last_name: string;
      middle_name: string | null;
      organization: string | null;
      person_type: string;
      phone: string | null;
      registered_at: Date;
      source: string;
      status: string;
      study_group: string | null;
    }>(
      `SELECT id, last_name, first_name, middle_name, birth_date, person_type,
              study_group, organization, phone, email, status, source,
              registered_at, first_attended_at
       FROM registrations WHERE event_id = $1 ORDER BY registered_at, id`,
      [eventId],
    );
    const answers = await this.pool.query<{
      answer: unknown;
      field_id: string;
      registration_id: string;
    }>(
      `SELECT registration_id, field_id, answer FROM registration_answers
       WHERE registration_id = ANY($1::uuid[])`,
      [registrations.rows.map((row) => row.id)],
    );
    const answerMap = new Map(
      answers.rows.map((answer) => [
        `${answer.registration_id}:${answer.field_id}`,
        answer.answer,
      ]),
    );
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Event Registration';
    const sheet = workbook.addWorksheet('Участники');
    const fixed = [
      'Фамилия',
      'Имя',
      'Отчество',
      'Дата рождения',
      'Тип участника',
      'Группа',
      'Организация',
      'Телефон',
      'Email',
      'Статус регистрации',
      'Дата регистрации',
      'Источник',
      'Посещение',
      'Первое посещение',
    ];
    sheet.addRow([...fixed, ...fields.map((field) => `Поле: ${field.label}`)]);
    sheet.getRow(1).font = { bold: true };
    for (const registration of registrations.rows) {
      sheet.addRow(
        [
          registration.last_name,
          registration.first_name,
          registration.middle_name,
          registration.birth_date?.toISOString().slice(0, 10) ?? null,
          registration.person_type,
          registration.study_group,
          registration.organization,
          registration.phone,
          registration.email,
          registration.status,
          registration.registered_at.toISOString(),
          registration.source,
          registration.first_attended_at ? 'Пришёл' : 'Не пришёл',
          registration.first_attended_at?.toISOString() ?? null,
          ...fields.map((field) =>
            neutralize(
              answerText(answerMap.get(`${registration.id}:${field.id}`)),
            ),
          ),
        ].map((value) =>
          typeof value === 'string' ? neutralize(value) : value,
        ),
      );
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns.forEach((column) => {
      column.width = 22;
    });
    const output = await workbook.xlsx.writeBuffer();
    const safeTitle = event.title
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .slice(0, 80);
    return {
      data: Buffer.from(output),
      filename: `${safeTitle || 'event'}-participants.xlsx`,
    };
  }

  private async classify(
    db: Pool | PoolClient,
    eventId: string,
    rows: ParsedExcelRow[],
    lock = false,
  ): Promise<Classified[]> {
    const result: Classified[] = [];
    for (const row of rows) {
      if (row.errors.length > 0) {
        result.push({ category: 'ERROR', candidates: [], row });
        continue;
      }
      const candidates = await this.candidates(db, row.participant, lock);
      const strong = candidates.filter((candidate) =>
        strongMatch(candidate, row.participant),
      );
      if (strong.length === 1) {
        const personId = strong[0]!.id;
        const active = await db.query(
          `SELECT 1 FROM registrations
           WHERE event_id = $1 AND person_id = $2 AND status = 'ACTIVE'${lock ? ' FOR UPDATE' : ''}`,
          [eventId, personId],
        );
        result.push({
          category: active.rows[0] ? 'ALREADY_REGISTERED' : 'NEW',
          candidates: [],
          matchedPersonId: personId,
          row,
        });
        continue;
      }
      const possible =
        strong.length > 1
          ? strong
          : candidates.filter((candidate) =>
              profileMatch(candidate, row.participant),
            );
      if (possible.length > 0) {
        result.push({
          category: 'POSSIBLE_MATCH',
          candidates: possible.slice(0, 10).map((candidate) => ({
            personId: candidate.id,
            displayName: [
              candidate.last_name,
              candidate.first_name,
              candidate.middle_name,
            ]
              .filter(Boolean)
              .join(' '),
            matchReason:
              strong.length > 1 ? 'STRONG_IDENTIFIER' : 'PROFILE_SIMILARITY',
          })),
          row,
        });
      } else result.push({ category: 'NEW', candidates: [], row });
    }
    return result;
  }

  private async candidates(
    db: Pool | PoolClient,
    participant: ParsedParticipant,
    lock: boolean,
  ): Promise<Candidate[]> {
    const result = await db.query<Candidate>(
      `SELECT id, last_name, first_name, middle_name, birth_date,
              email_normalized, phone_normalized, study_group, organization
       FROM persons WHERE merged_into_id IS NULL
         AND lower(last_name) = lower($1) AND lower(first_name) = lower($2)
         AND (($3::text IS NULL AND middle_name IS NULL) OR lower(middle_name) = lower($3))
       ORDER BY created_at LIMIT 25${lock ? ' FOR UPDATE' : ''}`,
      [participant.lastName, participant.firstName, participant.middleName],
    );
    return result.rows;
  }

  private summary(
    rows: Classified[],
    activeRegistrations: number,
    capacity: number,
  ): ExcelImportPreviewResponse['summary'] {
    const count = (category: Classified['category']) =>
      rows.filter((row) => row.category === category).length;
    const capacityImpact = count('NEW') + count('POSSIBLE_MATCH');
    return {
      totalRows: rows.length,
      newRows: count('NEW'),
      alreadyRegisteredRows: count('ALREADY_REGISTERED'),
      possibleMatchRows: count('POSSIBLE_MATCH'),
      errorRows: count('ERROR'),
      withoutEmailRows: rows.filter(
        (row) => row.category !== 'ERROR' && !row.row.participant.email,
      ).length,
      capacityImpact,
      activeRegistrations,
      capacity,
      exceedsCapacity: activeRegistrations + capacityImpact > capacity,
    };
  }

  private async createPerson(
    client: PoolClient,
    participant: ParsedParticipant,
    review: boolean,
  ): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO persons
        (id, last_name, first_name, middle_name, birth_date, email,
         email_normalized, phone, phone_normalized, person_type, organization,
         study_group, dedup_review_required, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $7, $8, $9, $10, $11, now(), now())`,
      [
        id,
        participant.lastName,
        participant.firstName,
        participant.middleName,
        participant.birthDate,
        participant.email,
        participant.phone,
        participant.personType,
        participant.organization,
        participant.studyGroup,
        review,
      ],
    );
    return id;
  }

  private async createRegistration(
    client: PoolClient,
    eventId: string,
    personId: string,
    participant: ParsedParticipant,
  ): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO registrations
        (id, public_id, event_id, person_id, source, status, last_name,
         first_name, middle_name, birth_date, email, phone, study_group,
         person_type, organization, consent_accepted, registered_at,
         created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'EXCEL_IMPORT', 'ACTIVE', $5, $6, $7, $8,
               $9, $10, $11, $12, $13, false, now(), now(), now())`,
      [
        id,
        randomUUID(),
        eventId,
        personId,
        participant.lastName,
        participant.firstName,
        participant.middleName,
        participant.birthDate,
        participant.email,
        participant.phone,
        participant.studyGroup,
        participant.personType,
        participant.organization,
      ],
    );
    return id;
  }

  private async saveAnswers(
    client: PoolClient,
    registrationId: string,
    row: ParsedExcelRow,
    fields: FormFieldResponse[],
  ): Promise<void> {
    const byId = new Map(fields.map((field) => [field.id, field]));
    for (const [fieldId, answer] of row.answers) {
      const field = byId.get(fieldId)!;
      await client.query(
        `INSERT INTO registration_answers
          (id, registration_id, field_id, field_label_snapshot,
           field_type_snapshot, answer, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, now(), now())`,
        [
          randomUUID(),
          registrationId,
          fieldId,
          field.label,
          field.type,
          JSON.stringify(answer),
        ],
      );
    }
  }

  private async event(
    db: Pool | PoolClient,
    eventId: string,
  ): Promise<EventRow> {
    const result = await db.query<EventRow>(
      'SELECT id, title, capacity, status FROM events WHERE id = $1',
      [eventId],
    );
    if (!result.rows[0])
      throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
    return result.rows[0];
  }

  private async lockEvent(
    client: PoolClient,
    eventId: string,
  ): Promise<EventRow> {
    const result = await client.query<EventRow>(
      'SELECT id, title, capacity, status FROM events WHERE id = $1 FOR UPDATE',
      [eventId],
    );
    if (!result.rows[0])
      throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
    return result.rows[0];
  }

  private assertOperational(event: EventRow): void {
    if (
      !['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ACTIVE'].includes(
        event.status,
      )
    ) {
      throw new ApiError(
        409,
        'INVALID_EVENT_STATE',
        'Event does not accept administrative registration',
      );
    }
  }

  private async activeCount(
    db: Pool | PoolClient,
    eventId: string,
  ): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM registrations
       WHERE event_id = $1 AND status = 'ACTIVE'`,
      [eventId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async fields(
    db: Pool | PoolClient,
    eventId: string,
    activeOnly = true,
  ): Promise<FormFieldResponse[]> {
    const result = await db.query<FieldRow>(
      `SELECT id, event_id, type, label, required, sort_order, options, active,
              created_at, updated_at FROM event_form_fields
       WHERE event_id = $1${activeOnly ? ' AND active = true' : ''}
       ORDER BY sort_order, created_at`,
      [eventId],
    );
    return result.rows.map((field) => ({
      id: field.id,
      eventId: field.event_id,
      type: field.type,
      label: field.label,
      required: field.required,
      sortOrder: field.sort_order,
      options: Array.isArray(field.options)
        ? (field.options as string[])
        : null,
      active: field.active,
      createdAt: field.created_at.toISOString(),
      updatedAt: field.updated_at.toISOString(),
    }));
  }

  private async lockJob(
    client: PoolClient,
    eventId: string,
    importJobId: string,
  ): Promise<JobRow> {
    const result = await client.query<JobRow>(
      `SELECT j.event_id, j.status, j.expires_at, j.committed_at, f.file_data
       FROM import_jobs j LEFT JOIN import_job_files f ON f.import_job_id = j.id
       WHERE j.id = $1 AND j.event_id = $2 FOR UPDATE OF j`,
      [importJobId, eventId],
    );
    if (!result.rows[0])
      throw new ApiError(404, 'NOT_FOUND', 'Import job not found');
    return result.rows[0];
  }
}

const strongMatch = (
  candidate: Candidate,
  participant: ParsedParticipant,
): boolean =>
  Boolean(
    (participant.email && candidate.email_normalized === participant.email) ||
    (participant.phone && candidate.phone_normalized === participant.phone) ||
    (participant.birthDate &&
      candidate.birth_date?.toISOString().slice(0, 10) ===
        participant.birthDate),
  );

const profileMatch = (
  candidate: Candidate,
  participant: ParsedParticipant,
): boolean =>
  Boolean(
    participant.studyGroup &&
    participant.organization &&
    candidate.study_group?.toLocaleLowerCase('ru-RU') ===
      participant.studyGroup.toLocaleLowerCase('ru-RU') &&
    candidate.organization?.toLocaleLowerCase('ru-RU') ===
      participant.organization.toLocaleLowerCase('ru-RU'),
  );

const neutralize = (value: string): string =>
  /^[=+\-@]/.test(value) ? `'${value}` : value;

const answerText = (value: unknown): string => {
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return value === null || value === undefined ? '' : String(value);
};

const markDuplicateRows = (rows: ParsedExcelRow[]): void => {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.errors.length > 0) continue;
    const participant = row.participant;
    const name = [
      participant.lastName,
      participant.firstName,
      participant.middleName ?? '',
    ]
      .map((value) => value.trim().toLocaleLowerCase('ru-RU'))
      .join('|');
    const keys = [
      participant.email ? `${name}|email:${participant.email}` : null,
      participant.phone ? `${name}|phone:${participant.phone}` : null,
      participant.birthDate ? `${name}|birth:${participant.birthDate}` : null,
    ].filter((value): value is string => Boolean(value));
    if (keys.some((key) => seen.has(key))) {
      row.errors.push('Повтор участника в этом файле');
      continue;
    }
    keys.forEach((key) => seen.add(key));
  }
};
