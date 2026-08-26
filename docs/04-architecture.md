# 04. System Architecture

Статус: **Approved high-level architecture**

## 1. Архитектурный стиль

Используется **модульный монолит** для backend, а не микросервисы.

Причины:
- нагрузка MVP умеренная;
- единая предметная модель;
- проще транзакции регистрации/capacity;
- проще разработка и сопровождение;
- проще параллельная работа Codex по доменным модулям.

Отдельно выносится только email worker/background processing. Надёжная постановка email после business commit должна использовать idempotent delivery/outbox-equivalent boundary, чтобы сбой между DB commit и queue publish не терял письмо.

## 2. Приложения

### `apps/web`
React + Vite.

Содержит:
- public registration;
- ticket page;
- admin web.

### `apps/scanner`
Отдельное React + Vite PWA.

Причина разделения — собственный service worker, offline storage, lifecycle камеры и синхронизация.

### `apps/api`
NestJS backend.

Модули:
- auth;
- people;
- events;
- forms;
- registrations;
- attendance;
- staff;
- imports;
- statistics;
- audit.

### `apps/email-worker`
Получает задачи отправки писем из очереди.

## 3. Общая схема

```text
Public/Admin Web ─┐
Scanner PWA ──────┼── HTTPS ──> NestJS API ──> MySQL 8.1.0
                  │                  │
                  │                  ├──> Object Storage
                  │                  └──> Message Queue ──> Email Worker ──> SMTP/API
                  │
                  └── Scanner local: IndexedDB/Dexie
```

## 4. Технологический стек

Предварительно зафиксирован:

- TypeScript;
- pnpm workspaces;
- Turborepo;
- React + Vite;
- Tailwind CSS + собственная design system;
- NestJS;
- Zod;
- MySQL 8.1.0;
- Prisma;
- Dexie/IndexedDB;
- TanStack Query;
- React Hook Form;
- Terraform;
- GitHub Actions;
- Yandex Cloud.

Версии пакетов фиксируются lockfile и обновляются только контролируемо. Shared Zod request/response schemas живут в `packages/contracts`; API и клиенты не поддерживают параллельные самодельные типы одного контракта.

## 5. Backend доступ к БД

Frontend и Scanner не получают прямой доступ к MySQL. Вся работа идёт через API и server-side authorization.

## 6. Staging и Production

Два независимых окружения с отдельными БД и секретами. Staging используется для тестовых мероприятий, миграций и проверки offline/email.
