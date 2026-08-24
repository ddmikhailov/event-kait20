# 07. API Contracts v1

Статус: **Approved API surface baseline — request/response schemas become code in `packages/contracts`**

## 1. Conventions

- REST + JSON; XLSX endpoints return/accept binary multipart/file responses where stated.
- Shared Zod schemas are the canonical request/response contracts.
- Staff authentication: server-side session cookie.
- All staff authorization is enforced by API, never only by UI.
- Error envelope is stable:

```json
{
  "error": {
    "code": "CAPACITY_FULL",
    "message": "Human-readable message",
    "requestId": "...",
    "details": {}
  }
}
```

- Never place full QR payloads, passwords, session tokens or sensitive PII in server logs.
- Collection endpoints use cursor or page/limit pagination consistently; initial implementation may use `page`, `pageSize` with hard maximum 100.

## 2. Public Event

### `GET /public/events/:slug`
Auth: public.

Returns only data needed to render registration:
- title/description/cover;
- start/end/timezone/location;
- registration availability (`OPEN`, `CLOSED`, `FULL`);
- system form configuration;
- active custom fields;
- consent URL/version.

Exact participant counts are not required in public response.

### `POST /public/events/:slug/register`
Auth: public. Rate limited.

Request:
- standard participant fields;
- `customAnswers[]` keyed by `fieldId`;
- `consentAccepted: true`;
- consent version from rendered form.

Transaction validates event state, deadline, capacity, dynamic answers and deduplication.

Success variants:
- `201 REGISTERED` with `ticketUrl` and registration reference;
- `200 ALREADY_REGISTERED` with neutral confirmation and resend queued when email exists.

The implemented request requires birth date, normalized Russian phone, email,
participant type, conditional study group/organization, current consent version
and typed `customAnswers`. Consent URL/version are deployment configuration and
are returned by the public Event response; every Registration persists their
historical snapshot. `ticketUrl` is signed with the server-only QR secret and
contains no plaintext participant data.

Errors include: `VALIDATION_ERROR`, `REGISTRATION_CLOSED`, `CAPACITY_FULL`, `EVENT_NOT_FOUND`, `FORM_VERSION_INVALID`, rate limit.

Public web implementation freeze: `/events/:slug` renders the Event and typed
dynamic form from these contracts; it does not persist draft PII in browser
storage. The client submits the consent version received with the rendered
Event and branches on stable error codes. `VITE_API_BASE_URL` optionally selects
the API origin at build time; an empty value uses the web application's origin.

## 3. Ticket

### `GET /tickets/:publicId/:signature`
Auth: possession of unguessable signed URL.

Returns only the Event title/start/end/timezone/location, the historical
Registration name snapshot and the signed QR payload. Email, phone, birth date,
form answers and internal identifiers are not returned.

Security headers: `Referrer-Policy: no-referrer` and `Cache-Control: no-store`;
endpoint/path logging must mask token/signature components.

Malformed, incorrectly signed, missing and annulled tickets all return the same
generic `INVALID_QR` response without exposing participant data.

The public client route `/tickets/:publicId/:signature` fetches the ticket with
`cache: no-store`, renders the QR locally from the opaque signed payload and
never displays that raw payload as text. The web document declares a
`no-referrer` policy.

## 4. Auth

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/session`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `POST /auth/invitations/:token/accept` — set initial password and activate invitation.

Mutating cookie-authenticated routes require CSRF/origin protection according to `09-security.md`.

## 5. Admin — Events

- `GET /admin/events`
- `POST /admin/events`
- `GET /admin/events/:eventId`
- `PATCH /admin/events/:eventId`
- `POST /admin/events/:eventId/archive`

Permission: SUPER_ADMIN in MVP.

Important errors: `INVALID_EVENT_STATE`, `INVALID_TIME_RANGE`, `CAPACITY_BELOW_ACTIVE_REGISTRATIONS`.

Implemented MVP status transitions:

- `DRAFT → REGISTRATION_OPEN`;
- `REGISTRATION_OPEN → REGISTRATION_CLOSED | ACTIVE`;
- `REGISTRATION_CLOSED → REGISTRATION_OPEN | ACTIVE | COMPLETED`;
- `ACTIVE → COMPLETED`;
- `COMPLETED → ARCHIVED` through the archive action;
- any non-archived status may be archived through the explicit archive action;
- `ARCHIVED` is terminal and immutable.

New Events start as `DRAFT` or `REGISTRATION_OPEN`. The registration deadline cannot be later than Event start, and Event end must be later than start.

The MVP Web administrator workspace is mounted at `/admin`. It restores the
server-side session using the HttpOnly cookie, retains the returned CSRF value
in page memory only, and sends credentialed mutations with the CSRF header. A
SCANNER session is shown an explicit role boundary and cannot enter Event or
form-field management. Event date/time inputs are interpreted in the Event's
configured IANA timezone rather than the administrator device timezone.

## 6. Admin — Form fields

- `GET /admin/events/:eventId/form-fields`
- `POST /admin/events/:eventId/form-fields`
- `PATCH /admin/events/:eventId/form-fields/:fieldId`
- `DELETE /admin/events/:eventId/form-fields/:fieldId` — soft deactivate.

Permission: SUPER_ADMIN.

Structural changes are audited. Existing RegistrationAnswer snapshots remain historical.

The administrator workspace lists active and inactive fields together so that
soft-deactivated history remains visible. Choice options are entered as an
ordered list and are validated by the shared API contracts and the server.

## 7. Admin — Global People

- `GET /admin/people?query=&page=&pageSize=`
- `GET /admin/people/:personId`
- `PATCH /admin/people/:personId`

Person detail returns current canonical data and Registration history. Updating Person does not rewrite existing Registration snapshots.

The implemented list uses bounded `page`/`pageSize` pagination (maximum 100)
and searches current name, email, phone and study group. Person updates are
audited with changed field names only; PII values are not copied to audit
metadata.

Manual merge endpoint is intentionally deferred until merge UX/rules are designed.

The administrator Web workspace exposes this as a separate global People
directory. Editing the current Person card never rewrites Registration
snapshots; participation history is read-only in this view. Records marked for
deduplication review are visibly flagged, while manual merge remains deferred.

## 8. Admin — Registrations

- `GET /admin/events/:eventId/registrations`
- `GET /admin/events/:eventId/registrations/:registrationId`
- `PATCH /admin/events/:eventId/registrations/:registrationId`
- `POST /admin/events/:eventId/registrations/:registrationId/annul`
- `POST /admin/events/:eventId/registrations/:registrationId/resend-ticket`
- `POST /admin/events/:eventId/registrations/onsite`

`onsite` requires online API. Standard call respects capacity.

For SUPER_ADMIN only, request may contain explicit `capacityOverride: true`; this is audit logged. SCANNER endpoint never accepts this flag.

The implemented admin Registration endpoints edit the historical Registration
snapshot, not the current Person record. Annulment is irreversible through the
MVP API, releases capacity, invalidates the ticket and increments the Event
offline-data version. Ticket resend requires an active Registration with email.

Onsite input requires name, birth date, Russian phone, participant type and the
current Event form answers; email is optional. An onsite record uses source
`ONSITE` and does not claim public-form consent. It is allowed for
`REGISTRATION_OPEN`, `REGISTRATION_CLOSED` and `ACTIVE` Events. A confident
repeat returns the existing active Registration instead of consuming capacity.

The Event participant workspace implements bounded search/status filtering,
Registration detail and snapshot editing, irreversible annulment with an
explicit confirmation, durable ticket-resend intent and online onsite
registration with current active form fields. `capacityOverride` is off by
default and is presented as an exceptional audited SUPER_ADMIN action. Signed
ticket URLs are not rendered in participant tables or persisted by the Web
client.

## 9. Excel

### `POST /admin/events/:eventId/import/preview`
SUPER_ADMIN only. Multipart field `file` with `.xlsx`. Returns `importJobId`,
24-hour expiry, canonical column mapping, aggregate capacity impact and row
categories/errors. No Person or Registration is committed.

### `POST /admin/events/:eventId/import/:importJobId/commit`
SUPER_ADMIN only. Accepts the confirmed mapping, explicit decisions for every
possible match and optional `capacityOverride` (false by default). Re-parses the
file and commits all accepted rows transactionally. If Event capacity changed
since preview, returns `CAPACITY_FULL` unless the audited override is explicit.
The source payload is deleted after success and commit is one-time.

### `GET /admin/events/:eventId/export.xlsx`
SUPER_ADMIN only. Returns a private, non-cacheable sanitized XLSX for the Event;
user-controlled formula prefixes are neutralized.

### `POST /admin/events/:eventId/send-tickets`
Queues registration-ticket emails for selected/imported active registrations with email. Requires explicit confirmation in UI.

## 10. Statistics

### `GET /admin/events/:eventId/statistics`
Returns capacity, active registrations, free places, attended, absent, attendance percentage and time-bucket arrival series.

## 11. Staff & access

- `GET /admin/staff`
- `POST /admin/staff/invitations`
- `POST /admin/staff/:userId/deactivate`
- `GET /admin/events/:eventId/access`
- `POST /admin/events/:eventId/access`
- `DELETE /admin/events/:eventId/access/:userId`

SUPER_ADMIN only in MVP.

The administrator Web workspace lists active and inactive staff accounts,
creates SCANNER invitation email intent with optional initial Event assignment,
and supports explicit deactivation with a session-revocation warning. Raw
invitation tokens are never returned to or stored by the Web client. The
current signed-in account is not offered a self-deactivation action; the server
remains authoritative for last-SUPER_ADMIN protection.

Event cards link to an access manager that lists current assignments and only
offers active SCANNER accounts for new access. New access cannot be assigned to
an archived Event. Removing access is explicit and confirmed; all authorization
continues to be enforced server-side.

## 12. Scanner — event access

### `GET /scanner/events`
Returns only assigned Event summaries.

### `GET /scanner/events/:eventId/offline-bundle`
Requires active session + EventAccess. Returns bundle version, expiry metadata and minimum participant dataset.

The implemented full bundle returns the decimal-string `offline_data_version`,
generation/server time, expiry at Event end + 24 hours, row count, SHA-256
checksum and active Registration snapshots. Each snapshot contains the allowed
scanner fields and SHA-256 of its expected signed QR payload; the signing secret
and raw QR payload are not included. The reviewed MVP hard limit is 5000 rows.

### `POST /scanner/events/:eventId/resolve-qr`
Online scan lookup. QR payload is in JSON body, not URL, to reduce secret exposure in access logs.

Returns participant display data and attendance state. Does not itself create attendance unless request explicitly includes supported fast-mode confirmation; preferred implementation can call sync endpoint immediately after resolve.

The implemented endpoint only resolves an HMAC-valid QR belonging to the Event
in the route. Forged, malformed and cross-Event QR values return `INVALID_QR`;
an existing annulled Registration returns `REGISTRATION_ANNULLED`. Resolution
does not create an AttendanceEvent.

### `GET /scanner/events/:eventId/registrations/search`
Search by name/phone/email/group within assigned Event.

The response contains only Registration id, name, phone, group, participant
type, organization and first-attendance time. Email and birth date may be search
keys but are not returned to SCANNER.

### `GET /scanner/events/:eventId/form-fields`

Returns active configurable registration fields required by the online onsite
form. Requires an active session and explicit EventAccess for SCANNER;
SUPER_ADMIN retains global access. Inactive historical fields are not exposed.

### `POST /scanner/events/:eventId/registrations/onsite`
Online only. Permission: assigned SCANNER or SUPER_ADMIN. SCANNER cannot overbook.

## 13. Scanner — attendance sync

### `POST /scanner/events/:eventId/attendance/sync`
Used for both online single-event confirmation and offline batch reconnect.

Request includes:
- `deviceId`;
- array of events with unique `clientEventId`;
- `registrationId`;
- mode;
- device timestamp;
- estimated server-adjusted timestamp/clock metadata when available.

The implemented batch accepts 1–500 unique client event IDs. Every item also
declares `ONLINE` or `OFFLINE_SYNC` source. Estimated scan time must fall within
24 hours before Event start and 24 hours after Event end; suspicious values are
returned as `INVALID_TIMESTAMP` and are not persisted.

Per item response:
- `ACCEPTED`
- `ALREADY_PROCESSED`
- `REGISTRATION_ALREADY_ATTENDED`
- `INVALID_REGISTRATION`
- `REGISTRATION_ANNULLED`
- `ACCESS_DENIED`
- `INVALID_TIMESTAMP`

The whole batch is not failed because one item is duplicate/invalid; return per-item results.

Valid attempts are persisted as AttendanceEvent rows, including repeats.
Registration is locked while an item is applied: the first accepted attempt
sets `first_attended_at`, while later attempts are stored with `duplicate=true`
and cannot rewrite it. A retry of the globally unique `clientEventId` returns
`ALREADY_PROCESSED`. The response includes the current offline-data version.

## 14. Shared business error codes

Baseline:
- `UNAUTHENTICATED`
- `FORBIDDEN`
- `VALIDATION_ERROR`
- `NOT_FOUND`
- `EVENT_NOT_FOUND`
- `REGISTRATION_NOT_FOUND`
- `REGISTRATION_CLOSED`
- `CAPACITY_FULL`
- `ALREADY_REGISTERED`
- `REGISTRATION_ANNULLED`
- `INVALID_QR`
- `FORM_VERSION_INVALID`
- `IMPORT_INVALID`
- `IMPORT_EXPIRED`
- `RATE_LIMITED`
- `CONFLICT`

HTTP status is meaningful but client behavior keys off stable code.

## 15. Transaction/audit boundaries

- Registration creation/duplicate resolution: one DB transaction for capacity + Person/Registration/answers.
- Email queue publication occurs after successful business commit using an outbox/idempotent delivery strategy or equivalent implementation preventing lost/duplicate user-visible sends.
- Attendance item processing is idempotent by `client_event_id`.
- Admin mutations that change Event, Registration, access or capacity write compact audit records.

## 16. Contract implementation rule

Before implementing an endpoint, create its Zod request/response schema in `packages/contracts` and API tests for success + authorization + key business errors. The TypeScript contract is allowed to add exact field names, but may not change product semantics in this document without updating docs/ADR.
