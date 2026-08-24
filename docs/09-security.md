# 09. Security & Personal Data

Статус: **Engineering security baseline v0.2 — final production review still mandatory**

> Документ описывает технические меры и не является юридическим заключением по 152-ФЗ.

## 1. Data classification

System processes PII including ФИО, email, phone, birth date, study group and organization. Production logs, metrics, audit and error reporting must avoid duplicating this data without necessity.

## 2. Hosting

Production business data and primary infrastructure are placed in Yandex Cloud in the Russian deployment selected for the project. Legal/organizational compliance is separately verified by the college before launch.

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

Milestone A implementation freeze:

- first `SUPER_ADMIN` is created only by the `bootstrap:super-admin` CLI using ephemeral environment input; the command refuses to overwrite any existing SUPER_ADMIN;
- opaque session tokens contain 256 random bits and only their SHA-256 hashes are persisted;
- invitation/reset links contain a persisted record id and an HMAC-SHA-256 value bound to purpose and expiry; the database persists only the link hash and one-time record state, while the email worker can reconstruct the link from server-side HMAC configuration;
- successful password reset revokes all existing sessions for the user.

## 6. Cookie/CSRF/CORS model

Preferred deployment uses application subdomains under one parent domain (e.g. web/scanner/api). Configure exact CORS allowlist, `credentials` only for trusted origins and never wildcard with credentials.

Mutating cookie-authenticated requests require explicit Origin/Referer validation and CSRF protection appropriate to chosen same-site topology. Exact implementation is frozen during auth scaffold and covered by integration tests.

Milestone A uses exact `Origin` matching against validated Web/Scanner configuration plus a session-bound HMAC CSRF token in `X-CSRF-Token`. The opaque session is stored in the `staff_session` cookie with `HttpOnly`, `SameSite=Lax`, explicit expiry and `Secure` in production. Wildcard credentialed CORS is not supported.

## 7. Authorization

Backend policy:
- SUPER_ADMIN: full MVP administrative scope;
- SCANNER: assigned Event only;
- public: no participant lists.

Every protected handler has explicit permission guard. UI hiding is not authorization.

SCANNER cannot overbook capacity. Administrative capacity override belongs to SUPER_ADMIN and is audited.

## 8. Offline PII

Scanner caches minimum fields only. Cache lifecycle:
- prepared only after authorization;
- clear on logout;
- auto-expire default 24h after Event end;
- access revalidated on reconnect.

Browser storage is not treated as encrypted trusted storage against an unlocked/compromised device. Minimize stored fields instead of relying on ineffective client-side secret encryption.

## 9. Database/network

- PostgreSQL not publicly exposed to client apps.
- API/worker use least-privilege service accounts/connectivity.
- TLS for service connections where supported/required.
- DB migrations run with controlled credentials separate from runtime when practical.

## 10. Secrets

Yandex Lockbox/environment secret injection for DB, session, QR, SMTP/API and storage credentials.

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

Milestone A rate limiting is process-local and bounds login, forgot/reset and invitation acceptance. Distributed multi-instance rate limiting remains a mandatory production security gate before horizontal API scaling; no external rate-limit service is introduced in MVP foundation code.

Public registration uses the same process-local foundation and exact trusted
Origin policy. Its production distributed enforcement remains part of the same
security gate.

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

## 14. Web security headers

Production baseline includes:
- CSP appropriate for Vite apps and QR/camera needs;
- HSTS after domain/HTTPS validation;
- `X-Content-Type-Options: nosniff`;
- frame protection via CSP `frame-ancestors`;
- `Referrer-Policy`;
- secure cache policy for ticket/admin responses.

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
- Object Storage ACL;
- backup/restore access;
- secret rotation;
- dependency/security scan;
- PWA offline data cleanup/logout.
