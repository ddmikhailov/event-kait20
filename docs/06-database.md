# 06. MySQL Database Specification

Статус: **Approved MySQL 8.1.0 SQL/SQLAlchemy baseline — v0.3**

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
- Business timestamps: `datetime(3)`, persisted and read in UTC.
- Event timezone stored separately; default `Europe/Moscow`.
- All tables with mutable records use `created_at` / `updated_at` where applicable.
- Hard delete is avoided for business entities referenced by history.

### MySQL version policy

- Application compatibility target: MySQL 8.1.0 exactly.
- Staging and integration tests must use MySQL 8.1.0 and reject a different server version.
- MySQL-specific migrations must remain compatible with MySQL 8.1.0.
- MySQL 8.1 is an expired Innovation release. The owner explicitly accepted this lifecycle risk; a supported production hosting option and an upgrade plan remain release gates.

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

MVP roles: `SUPER_ADMIN`, `SCANNER`.

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

## 18. Stage 1 implementation decisions

Resolved in the MySQL 8.1.0 baseline migration:

- exact enum identifiers are defined by `backend/migrations/001_mysql_8_1_baseline.sql` and persisted as MySQL enum values;
- the baseline Person name index is a B-tree on `(last_name, first_name, middle_name)`; no optional database extension is required;
- business timestamp columns use UTC `datetime(3)` values;
- one ACTIVE Registration per `(event_id, person_id)` is enforced by the reviewed generated-column unique index `registrations_event_id_person_id_active_key` because MySQL 8.1 has no partial unique indexes.
