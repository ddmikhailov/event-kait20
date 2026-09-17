# Active/MosActive integration implementation plan

## Current architecture audit

- Backend: Python 3.12 FastAPI modular monolith. Persistence uses SQLAlchemy 2 Core with parameterized SQL; the project intentionally has no declarative ORM model layer.
- Database: MySQL 8.1.0. Reviewed additive SQL migrations are applied in filename order and checksummed in `schema_migrations`.
- Frontend: React/Vite Web administrator and public registration application, plus a separate React/Vite Scanner PWA with Dexie/IndexedDB offline storage.
- Identity: `persons.id` is the existing global identity. `registrations` references Person and preserves a historical participant snapshot.
- Event domain: Event, configurable registration fields, optional EventStream, participant-type restrictions, visibility, archive/purge and Moscow-time lifecycle already exist.
- Attendance: append-only `attendance_events`, globally unique `client_event_id`, and denormalized `registrations.first_attended_at`. Scanner creates Attendance only.
- Staff authorization: `SUPER_ADMIN`, `ORGANIZER`, `SCANNER`; server-side dependencies enforce administrator and SUPER_ADMIN boundaries. Scanner access is Event-scoped through `event_access`.
- Audit: compact ID/metadata records in `audit_log`; no full PII snapshots.
- Transactions: SQLAlchemy transactions, `FOR UPDATE`, named MySQL registration locks and database uniqueness constraints protect concurrency-sensitive operations.
- Import/export: transactional XLSX preview/commit and formula-safe export with dynamic registration answers.
- Tests: real disposable MySQL 8.1.0 integration suite, TypeScript unit tests, Playwright browser tests and release/security checks.

## Reusable foundations

1. Keep Person as the single identity and link all Active entities to it.
2. Keep Registration, Attendance and Scanner behavior unchanged.
3. Reuse administrator authorization, CSRF/Origin protection, audit helper, pagination conventions and SQL transaction pattern.
4. Reuse EventStream and registration attendance snapshots when creating Participation.
5. Extend the existing administrator Web rather than creating an Active administrator.

## Additions

1. Participation, ParticipationRole and ParticipationResult.
2. Season, EventCategory and EventLevel classification.
3. Versioned ScoringRule and immutable ScoreTransaction ledger.
4. StudentProfile, ProfilePublicationConsent, Achievement and StudentMembership foundation.
5. Transactional domain outbox for future Active consumers.
6. Administrative Participation/scoring APIs and privacy-safe profile, history and leaderboard APIs.
7. Event participant bulk actions, Activity settings screens, export and reporting additions.

## Safe extensions to existing entities

- `events`: nullable `season_id`, `category_id` and `level_id`; old Events remain valid without classification.
- Existing registration responses: optional Participation summary only; no change to registration or ticket semantics.
- Existing event statistics and XLSX export: additive Participation/scoring fields.
- Person fields remain authoritative; StudentProfile never duplicates PII.

## New migrations

- `013_active_foundation.sql`: normalized classifiers, Participation, scoring ledger, profile/privacy, achievement, membership and outbox tables plus nullable Event classification foreign keys and safe system seeds.

Old migrations remain byte-for-byte unchanged.

## New API areas

- `/admin/activity/*`: seasons, classifiers, roles, results and scoring rules (global mutation is SUPER_ADMIN-only).
- `/admin/events/{eventId}/participations/*`: paginated list, role/result update, bulk confirm and cancel for administrators.
- `/admin/people/{personId}/activity/*`: staff-visible participation, achievement and score history.
- `/public/profiles/{slug}` and child resources: consent-gated whitelisted public data.
- `/public/leaderboard` and aggregate group/department routes: season rankings
  without internal Person IDs, email or phone.

## Frontend changes

- Extend the Event participant workspace with Attendance, Participation role/result/status, scoring state and awarded points.
- Add selection and bulk role/confirm/cancel operations, including an explicit no-Attendance override confirmation and reason.
- Add an administrator Activity section for seasons, roles/classifiers and scoring rules; only SUPER_ADMIN can mutate global settings.
- Scanner UI and offline database remain unchanged.

## Backward-compatibility risks and controls

- Existing Events have no classification: Participation remains valid and records `NO_RULE` instead of failing.
- Rule changes must not rewrite history: updates create a new rule version; ScoreTransaction stores awarded points and rule version snapshot.
- Duplicate confirmation/cancellation: database idempotency keys and row locks prevent duplicate AWARD/REVERSAL records.
- Profile enumeration/PII: public routes use opaque slugs, consent checks and explicit response whitelists.
- Group history: StudentMembership is additive and optional; current Person fields are not rewritten or migrated automatically.
- Migration safety: only nullable Event columns and new tables/indexes are added; no historical participation or score backfill is performed.
