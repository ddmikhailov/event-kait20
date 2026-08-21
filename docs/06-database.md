# 06. PostgreSQL Database Specification

Статус: **Approved baseline for first Prisma schema — v0.2**

## 1. Таблицы MVP

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

## 2. Common conventions

- Primary identifiers: UUID.
- Business timestamps: `timestamptz`, persisted in UTC.
- Event timezone stored separately; default `Europe/Moscow`.
- All tables with mutable records use `created_at` / `updated_at` where applicable.
- Hard delete is avoided for business entities referenced by history.

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
- `person_type enum not null`
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
- `cover_object_key varchar null`
- `start_at timestamptz not null`
- `end_at timestamptz not null`
- `timezone varchar not null default 'Europe/Moscow'`
- `location varchar not null`
- `registration_deadline timestamptz not null`
- `capacity integer not null check capacity > 0`
- `status enum not null`
- `created_by uuid FK staff_users(id)`
- `offline_data_version bigint not null default 1`
- `archived_at timestamptz null`
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
- `options jsonb null` — only option configuration, not participant answers
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
- `consent_accepted_at timestamptz null`
- `registered_at timestamptz not null`
- `first_attended_at timestamptz null`
- `annulled_at timestamptz null`
- `annulled_by uuid null FK staff_users(id)`
- timestamps

Sources: `PUBLIC_FORM`, `EXCEL_IMPORT`, `ONSITE`, `ADMIN_MANUAL`.

Status: `ACTIVE`, `ANNULLED`.

Critical constraint: partial unique index on `(event_id, person_id)` where `status = 'ACTIVE'`.

Capacity counts only `ACTIVE` registrations.

## 7. `registration_answers`

- `id uuid PK`
- `registration_id uuid FK registrations(id)`
- `field_id uuid FK event_form_fields(id)`
- `field_label_snapshot varchar not null`
- `field_type_snapshot enum not null`
- `answer jsonb not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

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
- `device_scanned_at timestamptz not null`
- `estimated_scanned_at timestamptz not null`
- `received_at timestamptz not null`
- `duplicate boolean not null default false`
- `created_at timestamptz not null`

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
- `last_login_at timestamptz null`
- `password_changed_at timestamptz not null`
- timestamps

MVP roles: `SUPER_ADMIN`, `SCANNER`.

## 10. `event_access`

- `id uuid PK`
- `event_id uuid FK events(id)`
- `user_id uuid FK staff_users(id)`
- `role enum not null`
- `created_by uuid FK staff_users(id)`
- `created_at timestamptz not null`

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
- `status enum not null`
- `attempts integer not null default 0`
- `last_error_code varchar null`
- `provider_message_id varchar null`
- `queued_at`, `sent_at`, `created_at`, `updated_at`

MVP types: `REGISTRATION_TICKET`, `STAFF_INVITATION`, `PASSWORD_RESET`.

## 13. `import_jobs`

- `id`, `event_id`, `created_by`, status;
- total/valid/error/duplicate rows;
- `result_summary jsonb` containing aggregate counts only, not a second permanent copy of all PII;
- timestamps.

## 14. `audit_log`

- `id uuid PK`
- `actor_user_id uuid null`
- `action varchar not null`
- `entity_type varchar not null`
- `entity_id uuid null`
- `metadata jsonb null`
- `created_at timestamptz not null`

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

SUPER_ADMIN administrative overbooking is a separate explicit action/flag and must be audit logged.

## 16. Delete policies

- Event with business history: `RESTRICT`, use archive.
- Registration: annul, not hard delete.
- Person referenced by Registration: `RESTRICT`; future merge uses `merged_into_id`.
- EventFormField referenced by answers: soft deactivate, never destructive delete.
- StaffUser: deactivate, retain audit references.

## 17. Required indexes

- `persons(email_normalized)`
- `persons(phone_normalized)`
- name search index strategy chosen during Prisma/PostgreSQL implementation
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

## 18. Remaining implementation choices

These do not block scaffold but must be resolved in the first DB task:

- exact Prisma enum identifiers;
- PostgreSQL extension/index for tolerant Cyrillic name search (if needed after baseline LIKE/ILIKE testing);
- timestamp precision standard;
- exact migration implementation of partial unique index if Prisma schema cannot express it directly.
