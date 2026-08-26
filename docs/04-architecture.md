# 04. System Architecture

Статус: **Release 1.0 architecture**

## 1. Архитектурный стиль

Используется **модульный монолит** для backend, а не микросервисы.

Причины:
- нагрузка MVP умеренная;
- единая предметная модель;
- проще транзакции регистрации/capacity;
- проще разработка и сопровождение;
- проще параллельная работа Codex по доменным модулям.

Отдельным процессом запускается email worker. MySQL-таблица email_deliveries
является durable outbox: intent создаётся в business transaction, а worker
атомарно забирает его и отправляет через SMTP.

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
Обрабатывает durable email-delivery intents, retries и SMTP transport.

## 3. Общая схема

```text
Public/Admin Web ─┐
Scanner PWA ──────┼── HTTPS ──> FastAPI ─────> MySQL 8.1.0
                  │                              ▲
                  └── Scanner: IndexedDB/Dexie  └── Email Worker ──> SMTP
```

## 4. Технологический стек

Реализован:

- Python 3.12 для backend;
- TypeScript для Web/Scanner;
- pnpm workspaces;
- Turborepo;
- React + Vite;
- собственная CSS design system;
- FastAPI + Pydantic 2;
- Zod в клиентских контрактах;
- MySQL 8.1.0;
- SQLAlchemy 2 + PyMySQL;
- Dexie/IndexedDB;
- GitHub Actions;
- нативные systemd services и Nginx; целевая площадка — Yandex Cloud/сервер организации.

Версии Node-пакетов фиксируются lockfile, Python-зависимости — точными версиями в `backend/pyproject.toml`. Shared Zod schemas в `packages/contracts` обслуживают Web/Scanner, а эквивалентная server-side проверка публичной границы выполняется Pydantic-моделями.

## 5. Backend доступ к БД

Frontend и Scanner не получают прямой доступ к MySQL. Вся работа идёт через API и server-side authorization.

## 6. Staging и Production

Два независимых окружения с отдельными БД и секретами. Staging используется для тестовых мероприятий, миграций и проверки offline/email.
