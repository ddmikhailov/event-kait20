# MOS Active 1.0 — Known Issues & Backlog

Reviewed against current source at HEAD (`release/2026-09-25-rc1`), 2026-09-24.
Items confirmed fixed by Stage 1–4 work are removed. IDs are kept stable from the
prior review pass for traceability; gaps in numbering are closed items.

## P1 — Release / Data Integrity

### N01. No tenant check on scanner routes

`backend/src/event_api/routers/attendance.py` — `event_context()` looks up the
event by id only, with no `tenant_id`/`organization_id` filter. SCANNER is
additionally restricted by `event_access`, but ORGANIZER/SUPER_ADMIN of _any_
tenant can reach another tenant's offline bundle, QR resolution, and
attendance sync. Still open — confirmed no scoping added to `event_context()`.

### N02. No tenant check in reporting/streams

`backend/src/event_api/routers/reporting.py` and `routers/streams.py` fetch
events by id without a tenant filter — cross-tenant statistics, ticket
broadcast (`send-tickets`), and stream capacity mutation are reachable.
Still open.

### N03. Organization boundary not enforced everywhere tenant is

`tenant_scope.py`'s helpers filter by `tenant_id` only, while the schema
allows multiple organizations per tenant. Participations, manual score
adjustment, profile/consent, achievements, and person status endpoints in
`activity.py`/`scoring_v2.py` let one organization act on another's data
within the same tenant. Partially narrowed (achievement linking and
`person_activity` were made organization-scoped in Stage 4.3), but the
routes listed above are not. Still open.

### N04. Season/scoring-rule reference not scoped to organization

`activity_service.py`'s `reference()` filters by `id` only; `seasons` is
organization-owned. An event, participation, or scoring rule can reference
another organization's season. Still open.

### N06. Ticket resend is not separated from person-lookup dedup

`registration_service.py` (`queue_ticket`, `public_repeat_response`) still
queues a ticket to the saved email on any repeat-submission match, with only
an IP rate limit as protection; the idempotency key still embeds a fresh
`uuid4`, so the unique index on `email_deliveries.idempotency_key` never
triggers. Anyone who knows a participant's name plus one of email/phone/DOB
can trigger unlimited resends, and the response shape confirms whether a
person is registered. Still open — confirmed unchanged in current source.

### N07. QR ticket lifetime undecided

`security.py`'s registration QR signature (`registration_signature`) has no
expiry or one-time-use binding, unlike the auth-link tokens in the same file
which do carry `expires_at`. A leaked ticket screenshot is valid forever;
the only revocation path is annulling the registration. Still open —
confirmed no TTL added.

### N08. Scanner logout can destroy pending/rejected attendance irrecoverably

`apps/scanner/src/App.tsx` (`logout`) still only warns via `window.confirm`
before `clearBusinessData()`; there is no export or handoff path, and
`unresolvedCount()` still includes terminally `REJECTED` items, so an
operator can get stuck needing to destroy the queue to hand off the device.
Still open — confirmed unchanged in current source.

### N09. Person merge is unimplemented; `merged_into_id` is dead

Confirmed by search: `merged_into_id` is never written anywhere in the
backend — only ever read as a filter (`WHERE merged_into_id IS NULL`). When
`find_or_create_person` finds more than one candidate, it creates a _third_
new person flagged `dedup_review_required`, and nothing in the product acts
on that flag (`AdminParticipants.tsx` only shows a badge). Still open —
this is the most consequential open item: it actively creates duplicate
Person records with no resolution path.

## P2 — Product / Reliability

### N11. Attendance sync batch is not atomic

Each item in a sync batch (up to 500) opens its own connection/transaction
(`routers/attendance.py`). A mid-batch failure leaves a partial commit and
the client may resend the whole batch, risking dup/loss.

### N12. Person lock released before import transaction commits

`routers/excel.py`'s `release_person_locks` runs inside the still-open
transaction, unlike the correct pattern in `registrations.py` (release after
commit). Concurrent import + onsite registration can still race to create
duplicate Person rows.

### N13. Email idempotency keys are not deterministic

Ticket-resend idempotency keys embed a fresh `uuid4`, so the unique index on
`email_deliveries.idempotency_key` can never dedupe a double-click or worker
restart resend. (Root cause shared with N06.)

### N14. No admin visibility into ticket delivery failures

Delivery status/error is only surfaced for staff invitations, not
`REGISTRATION_TICKET` deliveries — a failed/cancelled ticket is invisible
outside direct DB access.

### N15. Capacity check diverges when streams are enabled

When a stream is selected, only the stream's own capacity is checked, not
the event's — the sum of stream capacities can exceed `events.capacity`,
and the public page can show "OPEN" past the event limit.

### N16. Changing a form field's type/options orphans saved answers

`routers/events.py`'s `update_field` allows type/option changes without
checking existing `registration_answers`; deactivating a field leaves
orphaned answers, and adding a required field can make existing
registrations un-updatable with a misleading error.

### N17. Audit log has no read path

`audit()` is called from ~60 call sites but nothing in the product ever
selects from `audit_log` — including `SCORE_MEMBERSHIP_AMBIGUOUS`, the
event that flags a silently lost membership link (see N18-adjacent history).

### N20. Event purge deletes audit log without entity-type scoping

`routers/events.py`'s purge deletes `audit_log` rows by `entity_id IN
(subquery)` without an `entity_type` filter — a UUID collision across entity
types can delete unrelated audit rows, and registration/attendance audit
trail is destroyed unconditionally on purge, not just when history exists.

### N21. Score-granting authority is inconsistent

Confirmed still present: `confirm_participations` (which triggers
`award_score`) requires only `csrf_administrator` (ORGANIZER can reach it),
while `POST /admin/activity/score-adjustments` requires `csrf_super_admin`.
An ORGANIZER cannot manually adjust 5 points but can grant unlimited points
by confirming participations under favorable rules. Directions were moved
to `csrf_super_admin` in Stage 4 Final Cleanup, but this core asymmetry
(confirm-participations vs. manual-adjustment) was not addressed.

### N22. "Mutate → refresh → notify" contract not applied everywhere

The contract (loader returns `Promise<boolean>`, state only updates on
success, failure shows a distinct "refresh the page" message) is followed
in the Stage 4 screens but not in `AdminActivity.tsx`, `AdminStaff.tsx`,
`AdminParticipants.tsx`, `EventStreams.tsx`, parts of `AdminApp.tsx`/
`AdminScoring.tsx` — several of these show success/failure inverted or
overwritten.

### N23. Search-busy and mutation-busy flags are shared

`AdminScoring.tsx` and `AdminParticipants.tsx` still share one busy flag
across independent search/mutation operations in places, allowing a fast
search to unblock a save button mid-mutation (double-submit risk). Fixed
already in `AdminActivityAdmin.tsx` as the reference pattern.

### N24. Admin date display/input not consistently Moscow time

Outside of season creation (N10, now fixed) and scoring simulator dates,
several screens still format or parse dates in the browser's local
timezone (`EventStreams.tsx`, `AdminParticipants.tsx`, `AdminStaff.tsx`) or
show raw ISO strings (`AdminScoring.tsx`).

### N25. Error-code handling is inconsistent across screens

Nine independent error-code maps with two incompatible fallback policies —
some surface raw English backend text to Russian-speaking users, others
collapse everything to a generic failure message, losing actionable codes
(e.g. `EVENT_HAS_ACTIVITY_HISTORY`, `RATE_LIMITED`). Several domain codes
(`SEASON_CONFLICT`, `MEMBERSHIP_PERIOD_OVERLAP`, `REQUEST_ALREADY_USED`,
etc.) are not mapped anywhere. Partially touched in Stage 4 Final Cleanup
(one `CONFLICT` mapping removed from `AdminActivity.tsx`/`AdminMembership.tsx`)
but the systemic inconsistency remains.

### N26. Scanner doesn't warn about a stale offline bundle

The server tracks `offlineDataVersion` and the client stores
`serverVersion`, but nothing compares them or shows `preparedAt` to the
operator; an unresolved QR from after bundle prep is rejected outright with
no manual-entry fallback.

### N27. Rejected attendance marks have no resolution path

A timestamp-skew rejection (`INVALID_TIMESTAMP`) is permanent in the local
queue, shown with only an id and code — no retry, export, or admin
override.

### N28. N+1 queries and unbounded selects on hot paths

Excel import does per-row `COUNT(*)` queries inside an open `FOR UPDATE`
transaction; several admin list endpoints (achievements, registration
history, staff) are unbounded; person search is an unindexed `LIKE '%q%'`
full scan.

### N29. Rate limiting keys on `request.client.host` behind a reverse proxy

If TLS terminates at the organisation's external proxy (per architecture),
all public registrations/logins share one bucket unless proxy headers are
trusted correctly — topology needs to be confirmed against the actual
deployment and the limiter adjusted if needed.

### N30. Integrity errors collapse to generic 4xx/500s

`create_event` has no `IntegrityError` handler (duplicate slug → 500).
Several `conflict()` call sites collapse duplicate-key, FK violation, and
NOT NULL into one generic code, losing the actual cause for the operator.

## P3 — UX / Technical Debt

### N31. Unfinished subsystems with no consumer

`domain_outbox` is written from nine call sites but never read; `built_in`
flags are always false for categories/levels (column doesn't exist for
those tables); `structure_diagnostics.py` is only imported by a test.
Each needs either a consumer or a decision to remove it.

### N32. Duplicated helpers and inconsistent labels

Four separate `fullName` implementations, two byte-identical
`formatDateTime`, duplicated status-label maps that disagree with each
other for the same enum value (e.g. `NO_RULE`).

### N33. Assorted small UI defects

Includes a `null`/`undefined` selection-comparison bug from Stage 4.1
(`AdminActivityAdmin.tsx`), raw UUIDs/error codes shown to users in a few
places, silently-ignored duplicate "add row" clicks, missing confirmation
on two irreversible scoring actions, always-on "page 1 of 1", and a
30-second event refresh that can unmount a form mid-edit.

### N34. Admin screen accessibility gaps

Several editable-grid inputs lack labels; error regions inconsistently use
`role="status"` vs `role="alert"`; some tables have empty header cells;
screen changes don't move focus.

### N35. React hooks ESLint rules not enabled

`eslint-plugin-react-hooks` is not configured, so `rules-of-hooks` and
`exhaustive-deps` issues (missing effect cleanup, `setState` after unmount)
are not caught automatically.

### N36. Scanner PWA is not installable

No icon set in the manifest, so the browser won't offer home-screen
install; `registerType: 'prompt'` with `immediate: false` means an update
notification never actually shows.

### N37. Misc backend technical debt

Deprecated `datetime.utcnow()` via inline import in `attendance.py`;
unvalidated table-name interpolation in `activity.py`'s generic reference
helpers (safe today only because all call sites pass literals); a few
untyped helpers in `scoring_v2.py`; manual role check instead of the shared
dependency in `registrations.py`; cover-file deletion outside the
transaction in `events.py`; deactivating staff doesn't clear `event_access`;
import file deleted on commit (`excel.py`), preventing later reconciliation;
registration signature fingerprint tied to `session_secret`.

## Process

### N39. Public profile/leaderboard routes exist ahead of Stage 5/6

Eight unauthenticated `/public/*` routes for profiles, achievements, and
leaderboards already work in `activity.py`, gated correctly by consent and
`allowed_fields`/visibility. They were never product-reviewed because they
were assumed unstarted. Open questions: no rate limit on these routes (and
`offset` allows up to 100000), and there is still no admin or self-service
UI to grant/withdraw publication consent — only direct API calls.

### N40. Contracts/CI/deploy review pass incomplete

A planned pass over contract-vs-response drift, `tsconfig` strictness
across packages, actual CI composition, secrets/env handling, and migration
deploy strategy was started and not finished in the prior review round.

## Future Product Stages

- Stage 5 — Student Cabinet
- Stage 6 — Rankings / Leaderboards

---

Closed since the prior review pass (verified against current source, not
just marked off): **N05** (GET profile route no longer writes to the DB —
mutation moved to the `PATCH` route under `csrf_super_admin`), **N10**
(season creation now goes through `zonedLocalToIso` with the Europe/Moscow
zone), **N18/N19** (student membership transfer/close routes
`transfer_membership`/`close_membership` now exist and give period
boundaries defined atomic semantics).
