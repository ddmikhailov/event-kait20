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
- consent version identifier.

Final legal URL is an external project input still pending.

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
- SUPER_ADMIN: full MVP administrative scope;
- SCANNER: assigned Event only;
- public: no participant lists.

Every protected handler has explicit permission guard. UI hiding is not authorization.

SCANNER cannot overbook capacity. Administrative capacity override belongs to SUPER_ADMIN and is audited.

Participant-management implementation keeps global Person search and all
Registration mutations SUPER_ADMIN-only. SCANNER search is restricted by
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
immediately after commit. Only SUPER_ADMIN endpoints can preview, commit, or
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
