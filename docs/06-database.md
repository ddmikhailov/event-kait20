# 06. MySQL Database Specification

Статус: **Release 1.0 MySQL 8.1.0 schema**

## 1. Таблицы MVP

Локальное обновление после r2 добавляет миграции 007–010, не меняя 001–006:

- 007: email_deliveries.next_attempt_at и индекс очереди отложенных повторов;
- 008: events.allowed_person_types (JSON; NULL означает все категории);
- 009: events.is_listed=true по умолчанию и индекс публичного каталога;
- 010: events.streams_enabled=false по умолчанию, event_streams и nullable
  registrations.stream_id. Составной FK (stream_id,event_id) гарантирует принадлежность
  потока мероприятию. Удаление по FK — RESTRICT. Индекс (stream_id,status) используется
  при подсчёте мест. CHECK ограничивает положительную capacity, порядок и интервал.

Все даты новых таблиц — UTC DATETIME(3), отображение — Europe/Moscow.
Уникальность ACTIVE (event_id,person_id) не меняется. При регистрации и изменении
потоков сначала блокируется Event; это сериализует конкурирующие заявки на место.
Миграция не назначает потоки старым регистрациям. Для Event с уже существующими
регистрациями автоматическое включение потоков запрещено.

1. `persons`
2. `events`
3. `event_form_fields`
4. `registrations`
5. `registration_answers`
6. `attendance_events`
7. `staff_users`
8. `event_access`
9. `staff_invitations`
10. `sessions`
11. `password_reset_tokens`
12. `email_deliveries`
13. `import_jobs`
14. `audit_log`
15. `security_rate_limits` — HMACed shared abuse-control buckets; no raw IP/email.

## 2. Common conventions

- Primary identifiers: UUID.
- Business timestamps: `datetime(3)`, persisted and read in UTC.
- Event timezone stored separately; default `Europe/Moscow`.
- All tables with mutable records use `created_at` / `updated_at` where applicable.
- Hard delete is avoided for business entities referenced by history.

### MySQL version policy

- Application compatibility target: MySQL 8.1.0 exactly.
- Staging and integration tests must use MySQL 8.1.0 and reject a different server version.
- MySQL-specific migrations must remain compatible with MySQL 8.1.0.
- MySQL 8.1 is an expired Innovation release. The owner explicitly fixed this
  exact version for the organisation server. Production therefore requires
  documented risk acceptance, network isolation, least-privilege accounts and
  proven backup/restore; changing the major/minor target is outside Release 1.0.

## 3. `persons`

- `id uuid PK`
- `last_name varchar not null`
- `first_name varchar not null`
- `middle_name varchar null`
- `birth_date date null`
- `email varchar null`
- `email_normalized varchar null`
- `phone varchar null`
- `phone_normalized varchar null`
- `person_type enum not null`: `KAIT_STUDENT`, `KAIT_TEACHER`, `EXTERNAL_STUDENT`, `EXTERNAL_TEACHER`, `PARENT`, `OTHER`
- `organization varchar null`
- `study_group varchar null`
- `dedup_review_required boolean default false`
- `merged_into_id uuid null FK persons(id)` — reserved for future/manual reconciliation
- timestamps

Normalization:
- phone → `+7XXXXXXXXXX`;
- email → trim + lowercase;
- names → trim, collapse repeated spaces, case-normalized comparison value in application logic.

Do not impose global `UNIQUE(email_normalized)` or `UNIQUE(phone_normalized)`: bad imports/shared contacts must not prevent preserving data. Use indexes and application-level matching.

## 4. `events`

- `id uuid PK`
- `title varchar not null`
- `slug varchar not null unique`
- `description text null`
- `direction varchar(80) null` — public catalogue filter/label
- `cover_object_key varchar null`
- `start_at datetime(3) not null`
- `end_at datetime(3) not null`
- `timezone varchar not null default 'Europe/Moscow'`
- `location varchar not null`
- `registration_deadline datetime(3) not null`
- `capacity integer not null check capacity > 0`
- `status enum not null`
- `created_by uuid FK staff_users(id)`
- `offline_data_version bigint not null default 1`
- `archived_at datetime(3) null`
- timestamps

Event status: `DRAFT`, `REGISTRATION_OPEN`, `REGISTRATION_CLOSED`, `ACTIVE`, `COMPLETED`, `ARCHIVED`.

Business validation additionally requires `end_at >= start_at` and deadline rules in API.

## 5. `event_form_fields`

- `id uuid PK`
- `event_id uuid FK events(id)`
- `type enum not null`
- `label varchar not null`
- `required boolean not null default false`
- `sort_order integer not null`
- `options json null` — only option configuration, not participant answers
- `active boolean not null default true`
- timestamps

Types: `SHORT_TEXT`, `LONG_TEXT`, `SINGLE_CHOICE`, `MULTI_CHOICE`, `BOOLEAN`.

Changes after registrations are allowed but audited. Existing RegistrationAnswer rows preserve field label/type snapshots. New required fields only apply to subsequent submissions.

## 6. `registrations`

- `id uuid PK`
- `public_id uuid not null unique`
- `event_id uuid FK events(id)`
- `person_id uuid FK persons(id)`
- `source enum not null`
- `status enum not null default ACTIVE`
- snapshot: `last_name`, `first_name`, `middle_name`, `birth_date`, `email`, `phone`, `study_group`, `person_type`, `organization`
- `consent_accepted boolean not null`
- `consent_version varchar null`
- `consent_url varchar null`
- `privacy_policy_url varchar null`
- `consent_accepted_at datetime(3) null`
- `registered_at datetime(3) not null`
- `first_attended_at datetime(3) null`
- `annulled_at datetime(3) null`
- `annulled_by uuid null FK staff_users(id)`
- timestamps

Sources: `PUBLIC_FORM`, `EXCEL_IMPORT`, `ONSITE`, `ADMIN_MANUAL`.

Status: `ACTIVE`, `ANNULLED`.

Critical constraint: a virtual generated column is `1` only when `status = 'ACTIVE'` and `NULL` otherwise; a unique index on `(event_id, person_id, active_registration)` enforces one ACTIVE Registration while allowing multiple historical ANNULLED rows.

Capacity counts only `ACTIVE` registrations.

## 7. `registration_answers`

- `id uuid PK`
- `registration_id uuid FK registrations(id)`
- `field_id uuid FK event_form_fields(id)`
- `field_label_snapshot varchar not null`
- `field_type_snapshot enum not null`
- `answer json not null`
- `created_at datetime(3) not null`
- `updated_at datetime(3) not null`

Constraint: `UNIQUE(registration_id, field_id)`.

`answer` uses a typed JSON value according to field type: string, boolean or string array. Validation is performed through shared Zod contracts before persistence.

## 8. `attendance_events`

- `id uuid PK`
- `client_event_id uuid not null unique`
- `event_id uuid FK events(id)`
- `registration_id uuid FK registrations(id)`
- `scanner_user_id uuid null FK staff_users(id)`
- `device_id uuid null`
- `mode enum not null`
- `source enum not null`
- `device_scanned_at datetime(3) not null`
- `estimated_scanned_at datetime(3) not null`
- `received_at datetime(3) not null`
- `duplicate boolean not null default false`
- `created_at datetime(3) not null`

Modes: `MANUAL_CONFIRM`, `FAST_SCAN`, `MANUAL_SEARCH`, `ONSITE_REGISTRATION`.

Source may distinguish `ONLINE` and `OFFLINE_SYNC`.

## 9. `staff_users`

- `id uuid PK`
- `person_id uuid null FK persons(id)`
- `email varchar not null`
- `email_normalized varchar not null unique`
- `password_hash varchar not null`
- `system_role enum not null`
- `active boolean not null default true`
- `last_login_at datetime(3) null`
- `password_changed_at datetime(3) not null`
- timestamps

Roles: `SUPER_ADMIN`, `ORGANIZER`, `SCANNER`.

## 10. `event_access`

- `id uuid PK`
- `event_id uuid FK events(id)`
- `user_id uuid FK staff_users(id)`
- `role enum not null`
- `created_by uuid FK staff_users(id)`
- `created_at datetime(3) not null`

Constraint: `UNIQUE(event_id, user_id)`.

## 11. Auth support tables

### `staff_invitations`
- `id`, `email_normalized`, `token_hash unique`, `invited_by`, optional `event_id`, role, `expires_at`, `accepted_at`, `created_at`.

### `sessions`
- `id`, `user_id`, `token_hash unique`, `expires_at`, `created_at`, `last_used_at`, `revoked_at`, optional diagnostic metadata.

### `password_reset_tokens`
- `id`, `user_id`, `token_hash unique`, `expires_at`, `used_at`, `created_at`.

Raw invitation/session/reset tokens are never persisted.

## 12. `email_deliveries`

- `id uuid PK`
- `idempotency_key varchar not null unique`
- `type enum not null`
- `recipient_email varchar not null`
- optional `event_id`, `registration_id`, `staff_user_id`
- optional `staff_invitation_id`, `password_reset_token_id` for durable auth-link reconstruction by the email worker;
- `status enum not null`
- `attempts integer not null default 0`
- `last_error_code varchar null`
- `provider_message_id varchar null`
- `queued_at`, `sent_at`, `created_at`, `updated_at`

At most one auth-link record reference is set on a delivery. The referenced invitation/reset row contains the record id, purpose-by-table, expiry and one-time state; raw link tokens are not stored.

MVP types: `REGISTRATION_TICKET`, `STAFF_INVITATION`, `PASSWORD_RESET`.

## 13. `import_jobs`

- `id`, `event_id`, `created_by`, status;
- total/valid/error/duplicate rows;
- `result_summary json` containing aggregate counts only, not a second permanent copy of all PII;
- `expires_at`, optional `committed_at`;
- timestamps.

`import_job_files` is a technical, one-to-one, short-lived preview payload:
`import_job_id`, `file_data longblob`, SHA-256, `created_at`, `expires_at`. It is not
business history: deleting an ImportJob may cascade only to this payload. The
payload is removed immediately after commit and expires after at most 24 hours.
No parsed participant rows are stored in `result_summary` or audit metadata.

## 14. `audit_log`

- `id uuid PK`
- `actor_user_id uuid null`
- `action varchar not null`
- `entity_type varchar not null`
- `entity_id uuid null`
- `metadata json null`
- `created_at datetime(3) not null`

By default metadata contains changed field names and operational context, not full duplicated PII values.

## 15. Capacity transaction

Public and normal onsite registration:

1. begin transaction;
2. lock target Event row (`SELECT ... FOR UPDATE` equivalent);
3. verify state/deadline as appropriate;
4. count active registrations;
5. reject with `CAPACITY_FULL` if no capacity;
6. deduplicate/create Person;
7. enforce active `(event_id, person_id)` uniqueness;
8. create/update Registration and answers;
9. commit.

The service serializes overlapping strong Person identity keys with MySQL named
locks (`GET_LOCK`/`RELEASE_LOCK`) before matching/creating Person. Locks are
released explicitly on the same connection after commit or rollback. This prevents two
concurrent public submissions with the same normalized name plus email, phone
or birth date from silently creating separate Person rows. Matching remains in
the service layer; no deduplication trigger is introduced.

Administrative overbooking by SUPER_ADMIN/ORGANIZER is a separate explicit
action/flag and must be audit logged. An assigned SCANNER can also explicitly confirm onsite overbooking; EventAccess remains mandatory.

## 16. Delete policies

- Event uses `RESTRICT` by default and archive for normal history retention.
- Explicit permanent Event purge is available only after archive and only to
  SUPER_ADMIN. It is rejected with `EVENT_HAS_ACTIVITY_HISTORY` when the Event has
  any Participation (including DRAFT), linked ScoreTransaction or Achievement.
  Archive is the normal lifecycle operation; immutable Activity ledger/audit rows
  are never erased by ordinary purge. An Activity-free purge preserves global
  Person rows and leaves a compact non-PII `EVENT_PURGED` audit fact.
- Backup copies are not modified retroactively by purge and disappear only under
  the organisation's configured backup-retention policy.
- Registration: annul, not hard delete.
- Person referenced by Registration: `RESTRICT`; future merge uses `merged_into_id`.
- EventFormField referenced by answers: soft deactivate, never destructive delete.
- StaffUser: deactivate, retain audit references.

## 17. Required indexes

- `persons(email_normalized)`
- `persons(phone_normalized)`
- name search index strategy chosen during MySQL implementation
- `persons(birth_date)`
- `registrations(event_id, status)`
- `registrations(event_id, last_name)`
- `registrations(event_id, phone)`
- `registrations(event_id, email)`
- `registrations(event_id, study_group)`
- `registrations(person_id)`
- `registration_answers(registration_id)`
- `attendance_events(registration_id)`
- `attendance_events(event_id, estimated_scanned_at)`
- `event_access(user_id)`
- `email_deliveries(status)`
- `events(status, registration_deadline, start_at)` — public catalogue query

## 18. Stage 1 implementation decisions

Resolved in the MySQL 8.1.0 baseline migration:

- exact enum identifiers are defined by `backend/migrations/001_mysql_8_1_baseline.sql` and persisted as MySQL enum values;
- the baseline Person name index is a B-tree on `(last_name, first_name, middle_name)`; no optional database extension is required;
- business timestamp columns use UTC `datetime(3)` values;
- one ACTIVE Registration per `(event_id, person_id)` is enforced by the reviewed generated-column unique index `registrations_event_id_person_id_active_key` because MySQL 8.1 has no partial unique indexes.

## 19. Registration constructor and retry receipts

Migration `011_registration_form_config.sql` adds nullable `events.form_config` (JSON) and `event_form_fields.onsite_required`. Null configuration preserves r2 requirements; new Events store optional defaults. Both public/onsite configurations contain exactly seven unique system-field keys, each with HIDDEN/OPTIONAL/REQUIRED mode; array order determines presentation. Names and consent cannot be disabled. Null onsite_required inherits the historical required flag.

Technical `registration_requests` stores only SHA-256 request hash, HMAC payload hash, Event/Registration references and creation time. Requests are scoped to Event and staff actor (or public channel), serialized under the Event lock. A matching retry returns the same ticket, without another registration/email; reusing a key with a changed payload is rejected. No raw request UUID or duplicate PII payload is persisted. Receipts live with the Registration and are removed by the explicit Event purge before referenced rows; FK deletion is RESTRICT. Existing strong-identifier deduplication remains; FIO-only matching never merges persons.

Automatic `effectiveStatus` is derived at read time from UTC timestamps and operator publication status, not a mutable counter or scheduled DB update. No status migration or background cron is required; see product spec for exact boundaries.

## 20. Activity foundation

Migration `013_active_foundation.sql` adds seasons, event classifiers,
participation roles/results, participations, versioned scoring rules, immutable
score transactions, student profiles/consents, achievements, historical
memberships and a transactional domain outbox. Existing Event classification
columns are nullable. Generated unique keys enforce one active Season and one
award per Participation scoring cycle on MySQL 8.1.0.

Additive migration `014_activity_integrity.sql` adds nullable
`score_transactions.membership_id` with RESTRICT FK to the historical membership,
and a generated unique `active_person_id` that permits at most one consent with
`withdrawn_at IS NULL` per Person. Existing duplicate active consents, if any, are
withdrawn deterministically except for the latest before the unique index is added.
The former scoring-rule unique match key becomes a lookup index because identical
dimensions may have disjoint validity periods. Service writes lock the Season row,
validate dimension/priority/time overlap and preserve prior versions for delayed
scoring by `Event.start_at`. Membership writes lock Person and reject inclusive
date-range overlap. Manual/legacy transactions retain null membership unless explicitly
attributed later.
See [docs/ACTIVE-INTEGRATION.md](./ACTIVE-INTEGRATION.md) for the ER model
and lifecycle.

## 21. Platform structure foundation

Migration `015_platform_structure.sql` adds Tenant, Organization, Department,
StudyGroup and the shared ActivityDirection directory. Existing records are
backfilled to the default KAIT20 Tenant and Organization without changing their
IDs. Person identity matching is tenant-scoped; staff sessions carry trusted
tenant and organization context. Event belongs to Organization and keeps the
legacy direction text only as a synchronized compatibility field for the
canonical nullable `direction_id` relation.

The KAIT20 IDs are migration backfill values, not permanent column defaults.
After backfill, mandatory scope columns are `NOT NULL` with no KAIT20 `DEFAULT`,
so a future write that omits trusted scope fails instead of silently entering
the wrong Organization. Staff access also requires active Staff, Tenant and
Organization.

StudentMembership keeps its original ID and inclusive validity period, and now
stores normalized organization, department and study-group relations plus a
historical course snapshot. New memberships derive all four values from an
active StudyGroup. Legacy rows that cannot be mapped safely keep nullable course;
group names are never parsed to infer it. ScoreTransaction retains its existing
`membership_id`. Historical membership responses display their saved group,
department and course snapshots; normalized IDs remain nullable for unresolved
legacy rows and are used for current directory linkage and aggregation.

ActivityDirection code uniqueness is per Tenant plus scope: the same code may
exist once in each Organization, and once as a tenant-global direction. MySQL
8.1 enforces code and name uniqueness with stored generated scope keys because
ordinary composite uniqueness would allow repeated `NULL` organization values.
Current structure API creates only KAIT20 organization-local directions.

The six seeded KAIT20 Departments use canonical display names: Датахаб, Кибер,
АртТех, МосСовет, Техно and Диджитал. A migration-local controlled alias table
maps exact trimmed legacy names such as Data Hub, Артех, Моссовет and Digital to
their canonical IDs under the case-insensitive database collation. It is dropped
after migration. Unknown Department text still creates a `LEGACY_*` record, and
the original StudentMembership snapshot text is never rewritten.

Non-PII legacy coverage counts are implemented by
`backend/src/event_api/structure_diagnostics.py`. It compares StudentMembership,
Person and Registration legacy group snapshots with normalized StudyGroups;
reconciliation remains controlled and never infers course from group text.

## 22. MosActive scoring v2

Migration 017 добавляет `events.boost_multiplier` (1, 1.5, 2, 3),
`activity_review_required` для новых Events и `activity_review_state`.
`student_roster_members` связывает проверенный Person с контингентом;
миграция 018 добавляет к этой связи закрытые поля исходного реестра:
`education_status`, `campus_address`, `course_label`, `program_name`,
`program_code`. Из этих полей только `campus_address` входит в публичную
карточку; остальные доступны администраторам.
`registrations.roster_match_state/roster_person_id` фиксируют предложение
сопоставления, а `event_participation_reviews` — утверждаемую ведомость со
снимком отметки Scanner, итоговым посещением, ролью, результатом и связью.
Исторические Events с подтверждённым участием сохраняют
`activity_review_required=false`; незавершённые Events без подтверждённых
участий переходят в новый порядок. Миграция добавляющая:
перед откатом остановить создание новых ведомостей и экспортировать решения;
удаление таблиц/колонок без резервной копии теряет аудиторский контекст.

Migration 016 adds organization-owned versioned scoring policies while retaining
legacy ScoringRule. `Season.scoring_policy_id IS NULL` means v1. With an assigned
policy, Events before `scoring_policy_effective_from` remain v1 and Events at/after
the boundary use v2. Ledger amounts use `DECIMAL(12,4)` and v2
rows retain the policy-version FK plus immutable JSON calculation snapshot.
Published policy versions and historical transactions are never rewritten.
Assignment of a v2 boundary is rejected when an engine-generated v1 AWARD already
exists for an Event at/after that boundary. Migration backfill marks only legacy
ScoringRule AWARD rows and their REVERSAL rows as `V1`; manual/import rows keep a
null engine marker. New Stage 2 classifier seeds use exact existing codes and
policy components resolve the actual existing IDs, without changing display names.
Newcomer history counts distinct confirmed Participation or Participation with a
historical engine AWARD, so later cancellation/reversal cannot reclaim a sequence.
