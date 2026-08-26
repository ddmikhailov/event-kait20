# AGENTS.md — Event Registration System

This file is the root engineering policy for Codex and all contributors.

## 1. Read before changing code

For any non-trivial task, read the relevant files in `docs/`. Start with:

- `docs/01-product-spec.md`
- `docs/02-user-roles.md`
- `docs/04-architecture.md`
- `docs/05-domain-model.md`
- `docs/06-database.md`
- `docs/07-api-contracts.md`
- `docs/08-offline-sync.md` for scanner/offline work
- `docs/09-security.md` for auth/PII/QR/import work
- `docs/10-ui-design-system.md` for UI

If code and documentation conflict, do not guess. Treat approved product/ADR docs as the intended behavior and surface the conflict in the handoff; update docs in the same change when the task explicitly changes behavior.

## 2. Product boundaries

MVP facts that must not be silently changed:

- Participant has no account/dashboard.
- Staff roles in MVP: `SUPER_ADMIN`, `SCANNER`; `EVENT_ADMIN` is future.
- Only SUPER_ADMIN creates Events.
- QR is unique per Registration/Event and contains no plaintext PII.
- Scanner is an installable PWA. Do not introduce App Store/Google Play release work.
- MySQL 8.1.0 is the source of truth; spreadsheets are import/export only.
- Infrastructure target is Yandex Cloud.
- Scanner offline mode is required for prepared registrations/attendance.
- Brand-new onsite Registration is online-only in MVP.
- SCANNER cannot overbook capacity; SUPER_ADMIN may explicitly override and must be audited.
- Version 2.0 committed feature: mass Event email broadcasts. Do not pull it into MVP unless asked.

## 3. Architecture boundaries

Current stack:

- Python 3.12 backend plus TypeScript frontend workspaces
- `apps/web`: React + Vite
- `apps/scanner`: React + Vite PWA
- `backend`: FastAPI modular monolith and background email worker
- SQLAlchemy 2 with reviewed SQL migrations
- MySQL 8.1.0
- shared Zod contracts
- Dexie/IndexedDB in scanner
- native systemd + Nginx deployment; Yandex Cloud remains the target platform

Do not introduce Next.js, GraphQL, microservices, Kubernetes, Supabase/Firebase or a second primary database without an explicit ADR/owner decision.

## 4. Domain invariants

Preserve these in DB constraints and tests where possible:

- `Person != Registration != StaffUser`.
- Registration stores a participant snapshot; editing Person must not rewrite history.
- One ACTIVE Registration per `(event_id, person_id)`.
- Capacity counts ACTIVE registrations only.
- FIO alone never auto-merges Person.
- Attendance is event-based and idempotent by `client_event_id`.
- First valid attendance time remains the primary `first_attended_at`.
- Email failure never rolls back a committed Registration.
- Offline bundle refresh must never delete unsynced attendance.

## 5. Security rules

- Never commit secrets or real credentials.
- Never put secrets in browser bundles.
- Do not log passwords, session/reset/invitation tokens, full QR payloads, registration request bodies, or unnecessary PII.
- Staff authorization is server-side for every protected endpoint.
- Use least privilege for service accounts and DB access.
- Passwords: Argon2id; sessions/tokens stored as hashes server-side.
- QR signing secret stays server-side.
- XLSX input is untrusted; validate and neutralize spreadsheet formula injection on export.
- Do not weaken CSP/CORS/CSRF/session protections to make a test pass.

## 6. Database/migrations

- All schema changes require a migration and relevant docs/contracts update.
- Do not use destructive production migrations without an explicit migration/rollback plan.
- Business history uses archive/annul/deactivate rather than hard delete.
- Preserve required MySQL invariants in reviewed SQL migrations.

## 7. API/contracts

- Define request/response schemas in shared `packages/contracts` before or with endpoint implementation.
- Clients must branch on stable machine-readable error codes, not message text.
- Do not expose extra PII because it is convenient for frontend development.
- Pagination/filter limits must be bounded.

## 8. Scanner/offline

- IndexedDB writes for bundle replacement and pending events must be transactional.
- Generate `client_event_id` before network send and persist it.
- On reconnect, sync pending attendance before replacing stale bundle data.
- Logout clears cached business data.
- App/service-worker updates must preserve pending attendance.
- Do not claim true offline revocation/security that browsers cannot provide; follow the documented lifecycle controls.

## 9. UI

Follow `docs/10-ui-design-system.md`:

- Montserrat typography
- white space, clear grid, blue-violet-purple brand axis
- official logo asset only; never redraw it
- scanner prioritizes speed/contrast over decoration
- accessible labels, focus states, keyboard behavior for admin forms

Do not add decorative complexity that harms registration speed or scanner readability.

## 10. Testing / Definition of Done

Every feature must have tests appropriate to its risk. At minimum before handoff:

- relevant unit/integration/API/E2E tests pass;
- lint passes;
- typecheck passes;
- no known authorization bypass;
- docs updated when behavior changed.

Critical concurrency/offline/security invariants require regression tests, not manual confidence.

Canonical commands from the repository root:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm format:check`

## 11. Dependencies

Prefer existing dependencies. Adding a dependency requires a clear reason and must not duplicate an existing capability. Avoid large framework changes for a small feature.

## 12. Working style

- Inspect before editing.
- Keep changes scoped to the task.
- Do not refactor unrelated areas opportunistically.
- Do not silently change product semantics.
- Do not delete failing tests to achieve green status.
- For ambiguous non-critical implementation details, choose the simplest option consistent with docs and mention it in handoff.
- For product/permission/privacy ambiguity, stop changing semantics and surface the issue.

## 13. Handoff format

At the end of a task report:

1. What changed.
2. Key files.
3. Tests/checks run and result.
4. Migrations/config changes.
5. Risks or follow-ups.

Keep handoffs concise and factual.
