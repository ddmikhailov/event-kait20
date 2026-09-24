# 07. API Contracts v1

Статус: **Release 1.0 REST contracts; client schemas live in `packages/contracts`**

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

### `GET /public/events`
Auth: public.

Returns at most 200 listed, published Events (REGISTRATION_OPEN, REGISTRATION_CLOSED or ACTIVE) whose end time is in the future, ordered by start time. Includes derived effectiveStatus; draft/archive/unlisted Events never enter this catalogue. The response contains only
catalogue presentation data: title, slug, description, optional direction and
cover key, schedule, timezone, location and deadline. It does not expose
participant counts or internal staff data.

### `GET /public/events/:slug`
Auth: public.

Returns only data needed to render registration:
- title/description/cover;
- start/end/timezone/location;
- registration availability (`OPEN`, `CLOSED`, `FULL`);
- system form configuration;
- active custom fields;
- consent URL, privacy-policy URL and shared version.

Exact participant counts are not required in public response.

### Event cover endpoints

`POST /admin/events/:eventId/cover` accepts one multipart field `cover` for a
`SUPER_ADMIN` or `ORGANIZER` session protected by Origin and CSRF checks. Only
JPEG, PNG and WebP are accepted; the default limit is 5 MiB. The server ignores
the original filename, generates an opaque key and stores media under
`MEDIA_ROOT`. Replacing a cover removes the previous file after the database
update succeeds. Public images are served by
`GET /media/event-covers/:key`; SVG and arbitrary paths are rejected.

`DELETE /admin/events/:eventId/cover` removes the current cover. Archived Events
remain immutable.

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
- `200 ALREADY_REGISTERED` with only `recoveryQueued: boolean`. It never returns a registration reference or `ticketUrl`. The existing snapshot is not changed; resend is queued only to the email already stored in that Registration. When no stored email exists, the participant is directed to the organizer.

The implemented request requires birth date, normalized Russian phone, email,
participant type, conditional study group/organization, current consent version
and typed `customAnswers`. Consent and privacy-policy URLs plus their shared
version are deployment configuration and are returned by the public Event response; every Registration persists their
historical snapshot. `ticketUrl` is signed with the server-only QR secret and
contains no plaintext participant data.

Public deduplication is not authorization to modify an existing Registration. Submitted contact data is used only to locate a possible match; it cannot replace saved contacts, answers or stream selection. A replay of the same public `requestId` follows the same neutral recovery response.

Participant type is one of `KAIT_STUDENT`, `KAIT_TEACHER`, `EXTERNAL_STUDENT`,
`EXTERNAL_TEACHER`, `PARENT`, `OTHER`. Study group is required only for
`KAIT_STUDENT`; organization is required only for external students/employees.
Neither field is accepted from the public form for `PARENT` or `OTHER`.

Errors include: `VALIDATION_ERROR`, `REGISTRATION_CLOSED`, `CAPACITY_FULL`, `EVENT_NOT_FOUND`, `FORM_VERSION_INVALID`, rate limit.

Public web implementation freeze: `/events/:slug` renders the Event and typed
dynamic form from these contracts; it does not persist draft PII in browser
storage. The client submits the consent version received with the rendered
Event and branches on stable error codes. Production builds freeze
`VITE_API_BASE_URL=/api`; Apache proxies that same-origin prefix to FastAPI.

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
- `POST /auth/invitations/:token/accept` — set initial password and activate a
  ORGANIZER/SCANNER invitation or the single CLI-created first-SUPER_ADMIN invitation.

Email links open Web routes `/auth/password-reset/:token` and
`/auth/invitation/:token`. The admin login links to `/auth/password-forgot`.
These pages never store raw auth tokens outside the current browser URL and
submit them directly to the API over HTTPS.

Mutating cookie-authenticated routes require CSRF/origin protection according to `09-security.md`.

## 5. Admin — Events

- `GET /admin/events`
- `POST /admin/events`
- `GET /admin/events/:eventId`
- `PATCH /admin/events/:eventId`
- `POST /admin/events/:eventId/archive`
- `POST /admin/events/:eventId/purge`

Event management permission: SUPER_ADMIN or ORGANIZER. `GET /admin/events`
hides archived Events by default; `includeArchived=true` returns them. Permanent
purge is SUPER_ADMIN-only, requires an already archived Event and an exact
`confirmationSlug`, removes Event-scoped records and preserves Person rows only
when no Activity history exists. Any Participation (including DRAFT), linked score
or Achievement yields `409 EVENT_HAS_ACTIVITY_HISTORY`; use archive instead.

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

Permission: SUPER_ADMIN or ORGANIZER.

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

For SUPER_ADMIN/ORGANIZER, request may contain explicit `capacityOverride: true`;
this is audit logged. An assigned SCANNER may also explicitly confirm this flag on the scanner onsite endpoint.

The implemented admin Registration endpoints edit the historical Registration
snapshot, not the current Person record. Annulment is irreversible through the
MVP API, releases capacity, invalidates the ticket and increments the Event
offline-data version. Ticket resend requires an active Registration with email.

Onsite input requires first/last name and consentAccepted=true (operator confirms the participant actually gave consent); other system and custom fields follow the onsite constructor. It uses source ONSITE and records the current consent version/time without mislabelling the source as public. It is allowed for
`REGISTRATION_OPEN`, `REGISTRATION_CLOSED` and `ACTIVE` Events. A confident
repeat returns the existing active Registration instead of consuming capacity.

The Event participant workspace implements bounded search/status filtering,
Registration detail and snapshot editing, irreversible annulment with an
explicit confirmation, durable ticket-resend intent and online onsite
registration with current active form fields. `capacityOverride` is off by
default and is presented as an exceptional audited administrator action. Signed
ticket URLs are not rendered in participant tables or persisted by the Web
client.

## 9. Excel

### `POST /admin/events/:eventId/import/preview`
SUPER_ADMIN or ORGANIZER. Multipart field `file` with `.xlsx`. Returns `importJobId`,
24-hour expiry, canonical column mapping, aggregate capacity impact and row
categories/errors. No Person or Registration is committed.

### `POST /admin/events/:eventId/import/:importJobId/commit`
SUPER_ADMIN or ORGANIZER. Accepts the confirmed mapping, explicit decisions for every
possible match and optional `capacityOverride` (false by default). Re-parses the
file and commits all accepted rows transactionally. If Event capacity changed
since preview, returns `CAPACITY_FULL` unless the audited override is explicit.
The source payload is deleted after success and commit is one-time.

### `GET /admin/events/:eventId/export.xlsx`
SUPER_ADMIN or ORGANIZER. Returns a private, non-cacheable sanitized XLSX for the Event;
user-controlled formula prefixes are neutralized. Every Event form field, including a
soft-deactivated historical field, is exported as a separate `Поле: <название>` column;
multi-choice answers are joined with `; ` and boolean answers use `Да`/`Нет`. Fields with
the same display label receive deterministic numeric suffixes instead of merging answers.

### `POST /admin/events/:eventId/send-tickets`
SUPER_ADMIN or ORGANIZER. Queues registration-ticket emails for either all imported
registrations (`selection=IMPORTED`) or an explicit bounded list
(`selection=REGISTRATION_IDS`). Only ACTIVE registrations with email create
delivery intents. The required client-generated `requestId` is part of every
delivery idempotency key, so retrying the same confirmed operation cannot queue
a duplicate; an intentional resend uses a new request id. The UI requires
explicit confirmation and reports queued, already queued, no-email and
inactive/missing counts.

## 10. Statistics

### `GET /admin/events/:eventId/statistics`
SUPER_ADMIN or ORGANIZER. Returns capacity, ACTIVE registrations, non-negative free
places, attended/absent, one-decimal attendance percentage and first-attendance
arrival series grouped into 15-minute UTC instants. The client renders those
instants in the Event timezone. ANNULLED registrations do not contribute to any
metric. The response is private and non-cacheable.

## 11. Staff & access

- `GET /admin/staff`
- `POST /admin/staff/invitations`
- `POST /admin/staff/:userId/deactivate`
- `GET /admin/events/:eventId/access`
- `POST /admin/events/:eventId/access`
- `DELETE /admin/events/:eventId/access/:userId`

SUPER_ADMIN and ORGANIZER. SUPER_ADMIN may invite ORGANIZER or SCANNER;
ORGANIZER may invite/deactivate and assign access only for SCANNER. Neither role
may deactivate itself, and the last active SUPER_ADMIN remains protected.

The administrator Web workspace lists active and inactive staff accounts,
creates role-specific invitation email intent; SCANNER may receive an optional
initial Event assignment, while ORGANIZER is always global,
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
Online only. Permission: assigned SCANNER or global administrator. An explicit
capacityOverride=true is accepted after confirmation and audited; EventAccess
cannot be bypassed by the flag.

### Local post-r2 additions: streams, visibility and invitations

- Event create/update: isListed and allowedPersonTypes (NULL = all categories).
  Event responses expose streamsEnabled; capacity of a multi-stream Event is
  derived and must be changed through individual streams.
- GET/POST /admin/events/:eventId/streams; PATCH /admin/events/:eventId/streams/:streamId.
  Administrator-only mutations use the full StreamValues contract: title,
  startAt, endAt, capacity, sortOrder, active. No destructive stream delete.
- GET /scanner/events/:eventId/streams: assigned EventAccess required; returns
  active streams with registered/remaining and ended state, no participant PII.
- Public Event response includes streamsEnabled and active streams. Registration
  requests accept streamId, required for multi-stream Events. STREAM_REQUIRED,
  STREAM_INVALID, STREAM_ALREADY_SELECTED and STREAM_HISTORY_CONFLICT are stable errors.
- Tickets show streamTitle and the selected stream's start/end; QR remains
  registration-scoped and contains no new personal data.
- GET /admin/staff/invitations shows the most recent 100 invitations and delivery
  status, attempts, error code and next retry time. ORGANIZER sees SCANNER invitations only.
- POST /admin/staff/invitations/:id/resend accepts requestId UUID. Repeated request
  IDs are idempotent; QUEUED/SENDING are not duplicated; accepted/expired invitations
  cannot be resent; other resends have a 60-second cooldown. Never returns a raw token.

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
Both timestamps must include an explicit UTC offset. The backend converts them to UTC before range validation and persistence.

Per item response:
- `ACCEPTED`
- `ALREADY_PROCESSED`
- `REGISTRATION_ALREADY_ATTENDED`
- `INVALID_REGISTRATION`
- `REGISTRATION_ANNULLED`
- `ACCESS_DENIED`
- `INVALID_TIMESTAMP`
- `CLIENT_EVENT_CONFLICT`

The whole batch is not failed because one item is duplicate/invalid; return per-item results.

Valid attempts are persisted as AttendanceEvent rows, including repeats.
Registration is locked while an item is applied: the first accepted attempt
sets `first_attended_at`, while later attempts are stored with `duplicate=true`
and cannot rewrite it. A retry of the globally unique `clientEventId` returns
`ALREADY_PROCESSED` only when the immutable event, registration, scanner, device, mode, source and timestamps match. Reuse with a different payload returns `CLIENT_EVENT_CONFLICT` and must remain visible in the Scanner queue. The response includes the current offline-data version.

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

Before implementing an endpoint, update the Pydantic API boundary and the matching client Zod schema in `packages/contracts`, then add tests for success, authorization and key business errors. Exact field names may not change product semantics in this document without updating docs/ADR.

## Configurable registration fields and automatic status

Event create/update accepts `formConfig: {public: [{key, mode}], onsite: [{key, mode}]}`; each array must contain middleName, birthDate, email, phone, personType, studyGroup, organization exactly once. Mode is HIDDEN/OPTIONAL/REQUIRED. Public Event GET exposes only public `systemFields`; assigned scanner field GET exposes onsite `systemFields` and allowedPersonTypes. When categories are restricted, personType is required regardless of a hidden/optional setting. Irrelevant group/organisation data is not collected. Custom fields expose separate `required` and `onsiteRequired`; BOOLEAN accepts both true and false, required means an explicit answer.

Registration clients generate a UUID `requestId` before the first send and reuse it for retries. It is required when email/phone/birthDate are absent. Reusing it with another payload yields REQUEST_ALREADY_USED. Never regenerate it merely because of a network error. A successful retry does not queue another ticket email. Changing capacityOverride after the capacity warning is not a different participant payload. Public/onsite forms require consentAccepted=true.

Event responses include optional-compatible `effectiveStatus` with the existing status enum; `status` remains the operator state for updates. Public detail includes registrationDeadline. Boundaries and catalogue inclusion are defined in docs/01-product-spec.md. Public pages refresh from the server every 30 seconds while visible; the registration POST always enforces the deadline regardless of a stale browser display. Direct GET for draft/archive returns 404.

## Activity API

- `GET/POST/PATCH /admin/activity/seasons|roles|results|categories|levels`
- `GET/POST/PATCH /admin/activity/scoring-rules`
- `GET /admin/events/:eventId/participations`
- `POST /admin/events/:eventId/participations/assign|confirm|cancel`
- `GET /admin/people/:personId/activity`
- `GET/PATCH /admin/people/:personId/profile`
- `POST/DELETE /admin/people/:personId/profile/consent`
- `GET/POST /admin/people/:personId/memberships`
- `POST/PATCH /admin/people/:personId/achievements`
- `GET /public/profiles/:slug` and consent-gated child resources
- `GET /public/students?q=&limit=&offset=` — bounded directory of published
  KAIT student profiles; `q` searches surname or group, `limit` is at most 50,
  `offset` is at most 10000. It returns only opaque slugs, surname with initials,
  and fields allowed by each student's active publication consent. Students
  without scores can still appear. No authentication is required.
- `GET /public/leaderboard`, `/public/leaderboard/groups`,
  `/public/leaderboard/departments`

Global configuration, publication and manual score adjustments are SUPER_ADMIN
operations. Participation operations accept SUPER_ADMIN/ORGANIZER. Scanner is
explicitly excluded. Public responses use opaque slugs and omit internal Person
IDs and contact data. Exact request/response schemas are shared through
`packages/contracts/src/activity.ts`.

Public profile and personal leaderboard names use surname plus initials, never
full given names. The public profile omits organization; achievement responses
omit the free-form description. Public activity requests share a bounded
per-client rate limit. An absent or withdrawn consent immediately removes a
student from the directory and makes the profile unavailable.

The public personal leaderboard requires PUBLIC visibility plus an active consent
containing NAME and SCORES. `confirmedParticipations` and `achievements` are optional
response properties and are omitted unless their corresponding consent fields are
present; their values are scoped to the requested Season. Public group/department
leaderboards require PUBLIC + SCORES but not NAME and aggregate only transactions
with saved historical membership attribution. Manual-adjustment requestId retries
must match personId, seasonId, points and reason; otherwise the API returns
`409 IDEMPOTENCY_KEY_REUSED` and creates neither a transaction nor audit record.

## Platform structure API

- `GET /admin/structure/organization`
- `GET/POST/PATCH/DELETE /admin/structure/departments`
- `GET/POST/PATCH/DELETE /admin/structure/groups`
- `GET/POST/PATCH/DELETE /admin/structure/directions`

DELETE on these directories means `active=false`; it never physically removes
historical references. Group list filters are `departmentId`, `course` and
`active`. Tenant and current Organization come only from the authenticated staff
session. Supplying a tenant ID is not part of these contracts. A compatibility
`organizationId` must equal the current Organization or returns
`ORGANIZATION_SCOPE_MISMATCH`; inaccessible directory IDs return a generic
not-found response. No Organization selector is exposed.

Membership creation accepts `{ studyGroupId, validFrom, validTo }`. The backend
derives Organization, Department and course and returns normalized IDs/names
with the historical group, department and course snapshots. Normalized
`studyGroupId`/`departmentId` may be null for unresolved legacy history, but the
membership remains in the response. Event create/update accepts canonical
`directionId`; deprecated `direction` remains a temporary compatibility input
and is synchronized with the selected directory row. An inactive Direction is
rejected through either input with `DIRECTION_INACTIVE`. Direction names are
unique per exact scope; if legacy text matches more than one effective row, the
API returns `DIRECTION_AMBIGUOUS` and creates no Event.

Scoring v2 administration is under `/admin/activity/scoring-v2`: policy list and
creation, draft-version create/update, publish/retire, Season policy assignment
with an explicit historical activation boundary,
preview and Person status assignment/retirement. Writes require SUPER_ADMIN;
ORGANIZER may list and preview. Score amounts in changed Activity responses are
canonical four-place decimal strings, never JSON floats. Calculation snapshots
are admin-only and are not exposed by public leaderboard APIs. Snapshot
`eventStartAt` is explicit UTC ISO 8601 ending in `Z`; `eventMoscowDate` remains a
separate `YYYY-MM-DD` value. Season assignment returns
`SEASON_SCORING_POLICY_RETROACTIVE_CONFLICT` rather than crossing existing v1
award history.
