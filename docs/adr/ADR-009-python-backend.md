# ADR-009 — Python 3.12 backend

Статус: **Accepted**  
Дата: 2026-08-26

## Контекст

Владелец явно решил заменить серверную реализацию на Python 3.12 и удалить прежний NestJS/Prisma backend. Продуктовые контракты, REST-маршруты, MySQL 8.1.0 и доменные ограничения не меняются.

## Решение

- Backend реализуется на Python 3.12 как модульный монолит FastAPI.
- Pydantic 2 является границей проверки входных данных; SQLAlchemy 2 и PyMySQL выполняют параметризованный доступ к MySQL 8.1.0.
- Миграции — проверенные SQL-файлы с неизменяемой контрольной суммой после применения.
- Авторизация остаётся session-based: Argon2id, хеши непрозрачных токенов, HttpOnly cookie, точный CORS allowlist и CSRF.
- React/Vite Web и Scanner сохраняются; их публичные REST-контракты не меняются.
- Email worker входит в Python-пакет. Интеграция с реальным почтовым провайдером остаётся отдельным production gate.

## Последствия

Python 3.12 и MySQL 8.1.0 обязательны в разработке, CI и production. Старые `apps/api`, `apps/email-worker`, Prisma client и Node database/config packages удаляются, чтобы исключить две конкурирующие backend-реализации.
