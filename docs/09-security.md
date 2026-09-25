# 09. Security & Personal Data

Статус: **Release 1.0 security baseline**

> Документ описывает технические меры и не является юридическим заключением по 152-ФЗ.

## 1. Data classification

System processes PII including ФИО, email, phone, birth date, study group and organization. Production logs, metrics, audit and error reporting must avoid duplicating this data without necessity.

## 2. Hosting

Production business data and application runtime are placed on the
organisation-managed Russian infrastructure selected for the release. The
college separately verifies legal and organizational compliance before launch.

## 3. Consent

Public registration requires explicit checkbox. Persist:
- accepted=true;
- timestamp;
- consent URL;
- privacy-policy URL;
- consent version identifier.

The deployed configuration must use the approved KAIT №20 consent and privacy-policy documents. The public form receives these URLs from the API, and every new or refreshed Registration stores both URLs plus the shared legal-document version. Existing historical rows are not rewritten when a document version changes.

### 3.1 Public repeat registration

Knowledge of a participant's name, birth date, phone or email is not proof of ownership of an existing Registration. A public repeat must not change Person or Registration data and must not return the existing registration ID or signed ticket URL. Recovery email is addressed only to the contact already stored in the historical Registration. Without a stored email, correction and ticket recovery require an authorized organizer.

## 4. QR security/privacy

- No PII in QR payload.
- Registration-specific random public ID + server HMAC signature (or cryptographically equivalent approved implementation).
- Signing secret never reaches web/scanner.
- Annulled Registration makes ticket invalid.
- Online scanner sends QR payload in POST body, not URL.
- Ticket URL route uses `Referrer-Policy: no-referrer`; logs must redact/mask signature/token segments.

The implemented signature is HMAC-SHA-256 over the Registration public ID and
is compared in constant time. Ticket responses use `Cache-Control: no-store`.
Malformed, tampered, missing and annulled references share the same public error.

## 5. Authentication

Staff only:
- invitation-controlled account creation;
- email + password;
- Argon2id password hash;
- server-side sessions;
- random opaque session token in `HttpOnly; Secure` cookie;
- DB stores only token hash;
- login/session rotation on authentication and password change;
- password reset token one-time + short TTL;
- invitation token one-time + TTL.

Release implementation:

- first `SUPER_ADMIN` is initiated only by the `event-bootstrap-admin` CLI; it
  persists only a hash and prints a one-time activation link, while the intended
  administrator sets the password on first browser entry; the command refuses a
  second valid link and refuses permanently after activation;
- on the isolated Amvera beta, the same CLI may write the link to a private
  `/data` file for the project owner rather than stdout; it recovers only a
  still-valid link for the same email and removes that file after activation on
  the next configured startup;
- opaque session tokens contain 256 random bits and only their SHA-256 hashes are persisted;
- invitation/reset links contain a persisted record id and an HMAC-SHA-256 value bound to purpose and expiry; the database persists only the link hash and one-time record state, while the email worker can reconstruct the link from server-side HMAC configuration;
- successful password reset revokes all existing sessions for the user.

## 6. Cookie/CSRF/CORS model

Release deployment uses separate Web and Scanner HTTPS origins. Each origin
proxies same-origin `/api` to the same loopback backend. Configure the exact two
origins, `credentials` only for them and never wildcard with credentials.

Mutating cookie-authenticated requests require explicit Origin/Referer validation and CSRF protection appropriate to chosen same-site topology. Exact implementation is frozen during auth scaffold and covered by integration tests.

Release 1.0 uses exact `Origin` matching against validated Web/Scanner configuration plus a session-bound HMAC CSRF token in `X-CSRF-Token`. The opaque session is stored in the `staff_session` cookie with `HttpOnly`, `SameSite=Lax`, explicit expiry and `Secure` in production. Wildcard credentialed CORS is not supported. Public login/reset/invitation operations remain usable with a stale cookie but still require trusted Origin and rate limits.

## 7. Authorization

Backend policy:
- SUPER_ADMIN: full administrative scope, administrator-role management and Event purge;
- ORGANIZER: global Event/data scope and SCANNER management, but no administrator-role management or Event purge;
- SCANNER: assigned Event only;
- public: no participant lists.

Every protected handler has explicit permission guard. UI hiding is not authorization.

An assigned SCANNER, SUPER_ADMIN or ORGANIZER may explicitly confirm onsite
capacity override. EventAccess still applies; the actor and explicit override are
audited. The public registration endpoint never accepts an override flag.

Unlisted Events are discoverable to anyone with the direct registration link;
isListed is catalogue visibility, not authentication or a confidentiality boundary.
Stream identifiers are validated against their Event and reinforced by a composite FK.

Participant-management implementation keeps global Person search and all
Registration mutations administrator-only. SCANNER search is restricted by
EventAccess and returns the documented minimum display snapshot; it does not
return email or birth date. Audit metadata for participant edits stores changed
field names and control flags, not before/after PII values.

## 8. Offline PII

Scanner caches minimum fields only. Cache lifecycle:
- prepared only after authorization;
- clear on logout;
- auto-expire default 24h after Event end;
- access revalidated on reconnect.

Browser storage is not treated as encrypted trusted storage against an unlocked/compromised device. Minimize stored fields instead of relying on ineffective client-side secret encryption.

The backend offline bundle contains no email, birth date, custom answers, raw QR
payload or signing secret. QR resolution and attendance synchronization require
an active server session plus current EventAccess; an unassigned SCANNER cannot
download, resolve or sync for the Event.

## 9. Database/network

- MySQL not publicly exposed to client apps.
- API/worker use least-privilege service accounts/connectivity.
- TLS for service connections where supported/required.
- DB migrations run with controlled credentials separate from runtime when practical.

## 10. Secrets

The organisation's protected configuration mechanism provides DB, session, QR,
SMTP and external credentials. The application receives only a path through
`EVENT_REGISTRATION_ENV_FILE`; the protected file remains outside Git and
Apache DocumentRoot.

Rules:
- never commit `.env` secrets;
- `.env.example` contains names only;
- no secrets in browser bundles;
- no primary mailbox password in repository/chat/config;
- rotate secrets with documented process.

## 11. Rate limiting / abuse

At minimum:
- login;
- forgot/reset flows;
- public register;
- public ticket endpoint where needed;
- invitation acceptance.

Return generic authentication/reset responses to reduce account enumeration.

Authentication rate limits are stored in MySQL and shared by all API workers.
Buckets cover source IP and, for login, normalized account identity. Persisted
keys are server-HMAC values, not raw IP/email. Public registration/ticket abuse
limits use the same shared foundation and exact trusted Origin policy where a
browser mutation is involved. The reverse proxy must pass client IP only from
its explicitly trusted address.

## 12. Logging/audit

Operational logs:
- requestId;
- route template, not secret path values;
- status/latency;
- internal error code.

Do not log request bodies for registration/auth by default.

Audit log records significant admin actions but should store field names/compact context rather than a second full copy of sensitive before/after PII.

## 13. XLSX security

- extension + MIME/content validation;
- hard file size and row limits;
- reject/neutralize unsupported formulas/macros;
- never execute formulas server-side;
- exports escape cells that could become spreadsheet formulas (`=`, `+`, `-`, `@` prefixes) when data is user-controlled;
- temporary import object retention is short and access private.

The MVP preview payload is private MySQL `longblob`, not an application log
or aggregate result. It expires after at most 24 hours and is deleted
immediately after commit. Only SUPER_ADMIN/ORGANIZER endpoints can preview, commit, or
export. `.xlsm`, multiple worksheets, merged cells and formula cells are not
accepted by the MVP importer.

## 14. Web security headers

Production baseline includes:
- CSP appropriate for Vite apps and QR/camera needs;
- HSTS after domain/HTTPS validation;
- `X-Content-Type-Options: nosniff`;
- frame protection via CSP `frame-ancestors`;
- `Referrer-Policy`;
- secure cache policy for ticket/admin responses.

Swagger, ReDoc and OpenAPI JSON are disabled in production. Unexpected errors
return a generic stable envelope without exception detail. Demo seed refuses to
run outside development.

## 15. Backups

Daily production DB backups. Backup retention and restore test are deployment decisions that must be documented before real PII launch. Backups receive same access discipline as primary DB.

Permanent Event purge does not rewrite existing backups. Operators must communicate
that purged Event data can remain in protected backup media until normal retention
expires; restoring such a backup requires reapplying the purge before service return.

## 16. Production security gate

Before first live Event, explicitly review/test:
- CSRF/CORS/session behavior;
- brute force/rate limits;
- QR enumeration/forgery tests;
- authorization matrix;
- PII leakage in logs/errors;
- XLSX malicious inputs/formula injection;
- temporary XLSX storage access and cleanup;
- backup/restore access;
- secret rotation;
- dependency/security scan;
- PWA offline data cleanup/logout.

## Activity profile privacy

Importing a verified roster creates PUBLIC StudentProfiles with opaque random
slugs; SUPER_ADMIN may hide individual profiles. Publication consent records are
collected outside the platform. The old `profile_publication_consents` table is
retained as historical data but no longer read or written by the application.
This change does not remove the separate Event registration consent flow.

Public routes require a KAIT student in the roster with PUBLIC visibility and
apply fixed response allowlists. The directory returns only surname and initials;
the season ranking adds the sum of Event participation points. A profile adds
the current study group, roster campus and Event titles with positive net points.
These routes never return full given names, Person ID, email, phone, role,
result, achievements, manual adjustments, internal score reasons or audit data.
Legacy public achievement, score-ledger and group/department ranking routes are
removed. Public activity requests retain a shared rate limit and responses use
`Cache-Control: no-store` so a hidden profile is not retained by HTTP caches.
Scanner has no Activity administration permission; manual score adjustment and
global configuration remain SUPER_ADMIN-only.

ScoringPolicy lifecycle, Season policy assignment and Person Status writes are
SUPER_ADMIN-only and derive Organization from authenticated staff context.
Client-supplied organization authority is not accepted. Preview is authenticated
administration functionality; calculation snapshots are not public.
