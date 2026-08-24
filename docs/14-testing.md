# 14. Testing Strategy

Статус: **Approved baseline required from first feature**

## 1. Critical invariants

Tests must prove:
- concurrent registration cannot exceed capacity;
- SCANNER cannot administrative-overbook;
- one Person cannot have two ACTIVE registrations for same Event after confident match;
- ANNULLED does not count toward capacity;
- QR for wrong Event cannot create attendance;
- forged/modified QR signature fails;
- duplicate `client_event_id` is idempotent;
- two offline devices can sync same participant without changing first attendance incorrectly;
- SCANNER cannot access unassigned Event;
- failed email does not roll back Registration;
- Person edit does not mutate Registration snapshot;
- form edits do not corrupt historical RegistrationAnswer snapshots.

## 2. Unit tests

- email/phone/name normalization;
- dedup matching and conflict cases;
- dynamic field validation;
- QR signing/verification and offline payload hashing;
- RBAC policies;
- statistics;
- XLSX row mapping/sanitization;
- offline clock/duplicate resolution.

## 3. Integration tests — real PostgreSQL

- registration transaction;
- capacity race with parallel requests;
- partial unique active-registration constraint;
- annulment/re-registration;
- RegistrationAnswer persistence;
- session/invitation/reset token lifecycle;
- attendance idempotency;
- EventAccess;
- email delivery idempotency/outbox-equivalent boundary.

## 4. API contract tests

Every implemented endpoint gets:
- valid success;
- schema validation failure;
- unauthenticated/forbidden where applicable;
- relevant business errors;
- no unexpected PII in error payload.

High-priority codes: `CAPACITY_FULL`, `ALREADY_REGISTERED`, `REGISTRATION_CLOSED`, `INVALID_QR`, `REGISTRATION_ANNULLED`.

## 5. Frontend E2E

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

Before first large Event, staging scenario around 1000 registrations and multiple parallel scanner clients. Focus on transaction races, sync batches and email queue behavior rather than synthetic extreme RPS.

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
