# 14. Testing Strategy

Статус: **Release 1.0 validation policy**

## 1. Critical invariants

Tests must prove:
- concurrent registration cannot exceed capacity;
- SCANNER can only explicitly confirm audited onsite overbooking within assigned EventAccess;
- one Person cannot have two ACTIVE registrations for same Event after confident match;
- ANNULLED does not count toward capacity;
- QR for wrong Event cannot create attendance;
- forged/modified QR signature fails;
- duplicate `client_event_id` is idempotent;
- two offline devices can sync same participant without changing first attendance incorrectly;
- SCANNER cannot access unassigned Event;
- ORGANIZER has global Event/data access but cannot manage administrator roles or purge Events;
- archived Events are hidden by default and explicit purge preserves Person rows;
- failed email does not roll back Registration;
- Person edit does not mutate Registration snapshot;
- form edits do not corrupt historical RegistrationAnswer snapshots.

Post-r2 regression coverage also checks: independent stream capacity under concurrent
requests, one stream per Person/Event, composite same-Event FK, closed-stream ticket
preservation, unlisted catalogue exclusion with working direct link, allowed participant
categories, truthful invitation failure status and idempotent resend, Moscow stream time,
and stream-name/checksum preservation through contract parsing into offline IndexedDB.

## 2. Unit tests

- email/phone/name normalization;
- dedup matching and conflict cases;
- dynamic field validation;
- QR signing/verification and offline payload hashing;
- RBAC policies;
- statistics;
- XLSX row mapping/sanitization;
- offline clock/duplicate resolution.

## 3. Integration tests — real MySQL 8.1.0

Presentation coverage includes the public open-registration catalogue, the
additive `005_event_presentation.sql` migration, authenticated cover upload,
public raster delivery and rejection of SVG/unsupported media.

- registration transaction;
- capacity race with parallel requests;
- generated-column unique active-registration constraint;
- annulment/re-registration;
- RegistrationAnswer persistence;
- session/invitation/reset token lifecycle;
- attendance idempotency;
- EventAccess;
- ORGANIZER role migration, invitation boundary and SUPER_ADMIN-only purge;
- email delivery idempotency/outbox-equivalent boundary.
- shared MySQL-backed rate limiting and SMTP worker retry transitions.

## 4. API contract tests

Every implemented endpoint gets:
- valid success;
- schema validation failure;
- unauthenticated/forbidden where applicable;
- relevant business errors;
- no unexpected PII in error payload.

High-priority codes: `CAPACITY_FULL`, `ALREADY_REGISTERED`, `REGISTRATION_CLOSED`, `INVALID_QR`, `REGISTRATION_ANNULLED`.

## 5. Frontend E2E

Responsive checks cover the desktop month grid, the mobile Event-card feed,
direction filters and the official logo. Scanner checks assert that manual QR
text entry is absent and fast scan keeps camera decoding active while showing a
compact attendee result.

- public registration → success/ticket;
- duplicate registration → no duplicate row + resend behavior;
- admin Event create/edit;
- global Person search/history;
- participant list/edit/annul;
- scanner online resolve → confirm;
- manual search → confirm;
- onsite registration online;
- Excel preview → commit;
- invitation → initial password → login.

The public web client baseline includes unit coverage for conditional system
fields, rendered custom fields, required multi-choice answers, phone
normalization, consent-version binding and non-text QR rendering. Browser smoke
checks cover the Event form at desktop and mobile widths; full
registration-to-ticket E2E remains part of staging validation against the real
API and email flow.

The administrator Web baseline adds contract-level tests for credentialed
session restoration and in-memory CSRF propagation, timezone-aware Event form
values, valid status choices, SCANNER role separation, archived Event read-only
behavior, and form-field option normalization. Browser smoke checks cover
login, Event list/create/edit and form-field management at desktop and mobile
widths; the real session/CSRF flow remains part of staging validation against
the deployed API.

Participant administration adds Web tests for Registration/Person edit payload
separation, Russian phone normalization, typed onsite answers, explicit
capacity override, participant status/source rendering, read-only annulled
state and credentialed search filters. Browser smoke coverage includes the
participant table, Registration detail, onsite form and narrow-screen table
scroll containment using synthetic PII only.

Staff administration Web coverage verifies current-account self-deactivation
protection in the UI, inactive-account state, invitation request shape without
raw tokens, in-memory CSRF propagation and Event-scoped access routes. Browser
smoke checks cover the staff directory and access manager at desktop and mobile
widths using synthetic accounts only.

Excel coverage uses real MySQL 8.1.0 and proves empty-database migration,
preview without business writes, aggregate-only `result_summary`, source-file
deletion after commit, one-time commit, capacity recheck, administrator-only
authorization, `EXCEL_IMPORT` persistence and formula-safe export. Parser unit
tests cover the canonical template, formula cells and merged-cell rejection.

MVP reporting coverage proves ACTIVE-only statistics, capacity/free/absence
arithmetic, one-decimal percentage, 15-minute arrival buckets, private cache
headers and administrator authorization. Ticket-batch integration tests prove
import-only selection, no-email accounting, request-id idempotency, compact
audit metadata and SCANNER denial. Web tests cover the metrics/empty states and
in-memory CSRF propagation for a confirmed batch.

## 6. Offline E2E

- prepare bundle;
- incomplete bundle download does not replace prior bundle;
- network off → QR resolve;
- pending attendance persists across PWA reload;
- reconnect → sync;
- retry same batch;
- bundle refresh after pending sync;
- two devices same participant;
- logout clears offline business data;
- expired cache becomes unusable/cleared per policy;
- app/service-worker update preserves pending events.

The Scanner client test baseline additionally exercises bundle checksum failure
without replacement, local QR/search resolution, preservation of pending events
during refresh and expiry, accepted/rejected per-item handling, logout cleanup,
and the reconnect ordering contract. Camera permission and real service-worker
upgrade behavior remain browser/device E2E checks before production rollout.

Participant contract tests cover all six categories, including `PARENT` and
`OTHER` without study group or organization. MySQL integration tests verify that
both the Person record and historical Registration snapshot accept the extended
enum after migration.

## 7. Security tests before production

- CSRF/origin/CORS;
- session rotation/logout/revocation;
- role matrix;
- QR tamper/enumeration resistance;
- rate limits;
- malicious XLSX/formula injection;
- log redaction;
- storage ACL assumptions.

## 8. Load/concurrency test

Before first large Event, run the release profile against disposable MySQL 8.1.0:

```text
pnpm test:load
```

The profile creates 1000 synthetic registration requests with a constrained
capacity, repeats successful registrations, sends four concurrent attendance
batches, retries an identical batch and drains the email queue with eight
workers. It also injects controlled transient email failures and proves bounded
retry. Aggregate timings and counts are written to
`.runtime/release-load-report.json`; no participant payloads are recorded.

This is a release/manual test and is intentionally excluded from the ordinary
`pnpm test` gate. Local results detect races and regressions but are not a
production capacity claim. Before the first large Event, repeat it on staging
and record CPU, RAM and MySQL connection metrics there; approve latency and
resource thresholds only after measuring the actual organization server.

## 9. Definition of Done

A feature is not complete until:
- acceptance criteria satisfied;
- contracts/types updated;
- authorization explicit;
- unit/integration/E2E tests appropriate to risk pass;
- lint + typecheck pass;
- migrations are reviewed and reversible/operationally safe;
- docs/ADR updated when behavior or architecture changes;
- no secrets/PII accidentally added to source/log fixtures.

## 10. Release validation

CI executes the full repository validation suite and dependency vulnerability
audits. Integration tests extract the checksum-pinned official MySQL 8.1.0
server package and start a disposable native instance; Docker is not required.
After every staging rollout, unauthenticated smoke checks must pass against both
public same-origin `/api/health/live` and `/api/health/ready` proxies; the same
smoke proves closed API docs, Origin/CORS enforcement and the external HTTPS plus
Apache security-header baseline without creating business data. A production
promotion additionally requires a MySQL 8.1.0
migration rehearsal, a current recovery point and the applicable browser/device
E2E checks from this document.

## 11. r3 local regression (2026-08-30)

Added real MySQL 8.1.0 integration coverage for public/onsite constructor policies,
unchecked mandatory consent, hidden stale fields, legacy null configuration,
independent custom-answer requirements and hash-only retry receipts. Equal names
without contact/birth-date do not merge. Tests cover exact deadline/start/end
boundaries (including Moscow offset), manual close/draft/archive precedence,
catalogue inclusion and rejection of registration after the deadline.

Browser checks use the real backend: registration/ticket, admin list, a real QR
image fed through a simulated camera into the actual decoder, attendance offline
retry, constructor preview/save and mobile accessibility. This does not replace
testing physical device cameras over the organisation's HTTPS.

The QR duplicate guard survives camera pause/resume and rearms the same ticket
only after one second without a readable QR; another ticket is accepted immediately.
Dependency advisory checks cover npm runtime packages and Python dependencies;
the private application package itself is reviewed/tested, not a PyPI advisory target.

## 12. Activity regression

The real MySQL 8.1.0 suite proves Participation confirmation with and without
Attendance, deterministic scoring, ambiguous-rule rejection, historical rule
versioning, cancellation/reversal, idempotent repeat and concurrent confirmation.
It also covers Scanner denial, field-level leaderboard consent, consent withdrawal,
PUBLIC-only group/department aggregation, historical membership attribution,
event-date scoring, non-overlapping rule periods and concurrent conflict protection,
manual-adjustment payload idempotency, profile/consent concurrency, Achievement
reference integrity, and Event purge refusal for DRAFT/confirmed/scored/Achievement
Activity history while allowing purge of an Activity-free Event.
Shared contract tests reject public profile PII and require an audit reason for
confirmation without Attendance.

Scoring v2 targeted coverage uses disposable MySQL 8.1.0 and verifies exact
Decimal formula/order, seeded values, migration and legacy value/membership
preservation, explicit v1/v2 selection, published-version immutability,
preview/production parity, snapshot persistence and exact reversal. Targeted tests
also cover concurrent version publication, safe/cancelled retirement, historical
status retirement, delayed version lookup, NO_RULE sequence behavior, existing
history and concurrent newcomer assignment. Newcomer assignment is protected by a
Person row lock and a unique sequence index.

Historical-integrity coverage additionally rejects v2 activation across an
existing v1 AWARD, verifies semantic engine-marker backfill, preserves reversed
pre-v2 Participation in newcomer history, retains an inactive StatusType multiplier
for delayed historical scoring, reuses colliding Stage 2 classifier codes and IDs,
requires explicit UTC snapshot timestamps, and proves inclusive same-day status
retirement with an exclusive next-day boundary.
