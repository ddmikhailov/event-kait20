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

### `backend`
Python 3.12 + FastAPI backend.

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

### `backend/src/event_api/email_worker.py`
Обрабатывает durable email-delivery intents. Подключение реального провайдера остаётся production gate.

## 3. Общая схема

```text
Public/Admin Web ─┐
Scanner PWA ──────┼── HTTPS ──> FastAPI ─────> MySQL 8.1.0
                  │                  │
                  │                  ├──> Object Storage
                  │                  └──> Message Queue ──> Email Worker ──> SMTP/API
                  │
                  └── Scanner local: IndexedDB/Dexie
```

## 4. Технологический стек

Предварительно зафиксирован:

- Python 3.12 для backend;
- TypeScript для Web/Scanner;
- pnpm workspaces;
- Turborepo;
- React + Vite;
- Tailwind CSS + собственная design system;
- FastAPI + Pydantic 2;
- Zod в клиентских контрактах;
- MySQL 8.1.0;
- SQLAlchemy 2 + PyMySQL;
- Dexie/IndexedDB;
- TanStack Query;
- React Hook Form;
- Terraform;
- GitHub Actions;
- Yandex Cloud.

Версии Node-пакетов фиксируются lockfile, Python-зависимости — точными версиями в `backend/pyproject.toml`. Shared Zod schemas в `packages/contracts` обслуживают Web/Scanner, а эквивалентная server-side проверка публичной границы выполняется Pydantic-моделями.

## 5. Backend доступ к БД

Frontend и Scanner не получают прямой доступ к MySQL. Вся работа идёт через API и server-side authorization.

## 6. Staging и Production

Два независимых окружения с отдельными БД и секретами. Staging используется для тестовых мероприятий, миграций и проверки offline/email.
