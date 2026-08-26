# 19. MVP release status

Дата среза: **24 августа 2026**

Статус: **Release candidate engineering baseline; external production gates open**

## Implemented

- MySQL 8.1.0/Prisma domain, migrations and historical constraints;
- staff auth, sessions, password reset, invitations, RBAC and EventAccess;
- Event/form management and SUPER_ADMIN Web workspace;
- public registration, conservative Person deduplication, capacity and tickets;
- participant administration, onsite registration and audit metadata;
- Scanner PWA, online/offline attendance and synchronization;
- XLSX preview/commit/export with capacity and formula safety;
- statistics and idempotent ticket-batch delivery intents;
- email persistence, claim/retry processor and message/QR construction;
- API container, CI, health/readiness, deployment smoke and recovery runbooks.

## Verified in the repository

- full formatting, lint, typecheck, test and build suite;
- empty-database migration on disposable MySQL 8.1.0;
- HTTP integration tests for auth, CSRF/CORS, RBAC, registration, attendance,
  Excel, reporting and email persistence;
- Web/Scanner component and offline-storage tests;
- clean Linux API container build in GitHub Actions;
- local API + Web + production Scanner PWA manifest deployment smoke;
- repeat registration with matching normalized FIO and strong identifier returns
  `ALREADY_REGISTERED`; FIO changes remain conservatively separate by design.

## External production gates

These inputs cannot be correctly invented in application code:

1. legal consent URL and approved consent text/version;
2. production domains, DNS and TLS certificates;
3. email SMTP/API provider, verified sender/domain and idempotent transport;
4. Yandex Cloud folder, budget, zones, resource sizes, IAM and network topology;
5. backup retention/RPO/RTO plus a successful restore rehearsal;
6. monitoring destinations, alert thresholds and incident contacts;
7. staging browser/device acceptance, camera/PWA upgrade checks and the planned
   1000-participant concurrency rehearsal;
8. final privacy/security owner approval for real personal data processing.

Process-local auth rate limiting is acceptable only for a single API instance.
Distributed enforcement remains a gate before horizontal scaling.

## Promotion sequence

1. Approve the external inputs above and provision isolated staging.
2. Connect the chosen email transport without changing the outbox contract.
3. Deploy the exact release commit and run `docs/runbooks/mvp-acceptance.md`.
4. Fix all findings, repeat CI/acceptance and freeze the release candidate SHA.
5. Complete backup restore and security review, then manually promote the same
   immutable artifacts to production.
