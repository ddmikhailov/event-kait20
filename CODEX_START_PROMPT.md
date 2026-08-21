# Codex Start Prompt — Event Registration System

Read `AGENTS.md` first, then read all files under `docs/` before making any code changes. Treat the documentation as the canonical product and architecture specification. Do not silently redesign the system or replace documented technology choices.

## Current goal

Create the initial repository scaffold only. Do **not** implement product business features yet.

## Required repository structure

- `apps/web` — React + Vite public registration + admin shell
- `apps/scanner` — React + Vite PWA scanner shell
- `apps/api` — NestJS modular-monolith API shell
- `apps/email-worker` — background email worker shell
- `packages/contracts` — shared Zod schemas / DTO contracts
- `packages/database` — Prisma schema + migrations foundation
- `packages/ui` — shared KAИТ №20 UI primitives/design tokens
- `packages/config` — shared project configuration
- `packages/utils` — shared utilities
- `infra/terraform` — staging/production infrastructure skeleton for Yandex Cloud

Use pnpm workspaces and Turborepo. Configure strict TypeScript, ESLint, Prettier, test infrastructure, environment validation, Prisma foundation, and basic CI.

## Non-negotiable architecture

- TypeScript throughout.
- React + Vite for web applications; do not switch to Next.js.
- NestJS API as a modular monolith; do not split into microservices.
- PostgreSQL is the system of record.
- Prisma for database access/migrations.
- Scanner is an installable offline-first PWA using IndexedDB/Dexie.
- REST API, not GraphQL.
- Yandex Cloud is the target production platform.
- No Firebase/Supabase as application backend.
- No Kubernetes.
- No App Store / Google Play release path.
- Preserve the MVP/v2 boundaries in the documentation.

## First implementation task

1. Inspect all documentation and report any blocking contradictions before coding.
2. Scaffold the monorepo and packages/apps above.
3. Add root scripts for `lint`, `typecheck`, `test`, and `build`.
4. Add shared TypeScript and lint/format configuration.
5. Add minimal health/startup shells only; no registration/event/attendance business logic yet.
6. Add Prisma configuration without inventing undocumented schema changes.
7. Add environment schema/validation with placeholder variables only; never add real secrets.
8. Add basic CI that installs dependencies and runs lint, typecheck, tests, and builds.
9. Run every validation command and fix all failures.
10. At the end, provide:

- changed files summary;
- commands run and results;
- architectural observations;
- remaining TODOs;
- any decisions that require product-owner approval.

If a decision is already specified in `AGENTS.md`, `docs/`, or an ADR, follow it. If a required decision is genuinely unspecified and affects architecture or product behavior, stop that specific part rather than guessing, and flag it in the final report.
