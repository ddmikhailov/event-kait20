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

## 6. Admin — Form fields

- `GET /admin/events/:eventId/form-fields`
- `POST /admin/events/:eventId/form-fields`
- `PATCH /admin/events/:eventId/form-fields/:fieldId`
- `DELETE /admin/events/:eventId/form-fields/:fieldId` — soft deactivate.

Permission: SUPER_ADMIN.

Structural changes are audited. Existing RegistrationAnswer snapshots remain historical.

## 7. Admin — Global People

- `GET /admin/people?query=&page=&pageSize=`
- `GET /admin/people/:personId`
- `PATCH /admin/people/:personId`

Person detail returns current canonical data and Registration history. Updating Person does not rewrite existing Registration snapshots.

Manual merge endpoint is intentionally deferred until merge UX/rules are designed.

## 8. Admin — Registrations

- `GET /admin/events/:eventId/registrations`
- `GET /admin/events/:eventId/registrations/:registrationId`
- `PATCH /admin/events/:eventId/registrations/:registrationId`
- `POST /admin/events/:eventId/registrations/:registrationId/annul`
- `POST /admin/events/:eventId/registrations/:registrationId/resend-ticket`
- `POST /admin/events/:eventId/registrations/onsite`

`onsite` requires online API. Standard call respects capacity.

For SUPER_ADMIN only, request may contain explicit `capacityOverride: true`; this is audit logged. SCANNER endpoint never accepts this flag.

## 9. Excel

### `POST /admin/events/:eventId/import/preview`
Multipart `.xlsx`. Returns `importJobId`, column mapping proposal and row categories/errors. No business records committed.

### `POST /admin/events/:eventId/import/:importJobId/commit`
Commits the validated preview. If Event capacity changed since preview, server re-checks and may return `CAPACITY_FULL`/capacity conflict.

### `GET /admin/events/:eventId/export.xlsx`
Returns sanitized XLSX.

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

## 12. Scanner — event access

### `GET /scanner/events`
Returns only assigned Event summaries.

### `GET /scanner/events/:eventId/offline-bundle`
Requires active session + EventAccess. Returns bundle version, expiry metadata and minimum participant dataset.

### `POST /scanner/events/:eventId/resolve-qr`
Online scan lookup. QR payload is in JSON body, not URL, to reduce secret exposure in access logs.

Returns participant display data and attendance state. Does not itself create attendance unless request explicitly includes supported fast-mode confirmation; preferred implementation can call sync endpoint immediately after resolve.

### `GET /scanner/events/:eventId/registrations/search`
Search by name/phone/email/group within assigned Event.

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

Per item response:
- `ACCEPTED`
- `ALREADY_PROCESSED`
- `REGISTRATION_ALREADY_ATTENDED`
- `INVALID_REGISTRATION`
- `REGISTRATION_ANNULLED`
- `ACCESS_DENIED`

The whole batch is not failed because one item is duplicate/invalid; return per-item results.

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
