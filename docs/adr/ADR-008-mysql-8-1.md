# ADR-008 — MySQL 8.1.0 as source of truth

Status: **Accepted by owner, with production lifecycle gate**

## Context

Владелец явно решил заменить PostgreSQL 18 на MySQL 8.1.0. Необходимо сохранить транзакционные capacity checks, историю, RBAC, offline synchronization, аудит и существующие доменные ограничения.

MySQL 8.1.0 — Innovation release с завершённым жизненным циклом. Его нельзя считать автоматически доступным или обновляемым в managed-сервисе.

## Decision

- MySQL 8.1.0 является единственной основной БД приложения.
- Python runtime использует SQLAlchemy 2 и PyMySQL; изменения структуры выполняются reviewed SQL migrations.
- Время хранится в UTC в `datetime(3)`, timezone Event хранится отдельно.
- Единственная ACTIVE Registration обеспечивается virtual generated column и unique index, поскольку MySQL 8.1 не поддерживает partial unique indexes.
- Конкурентное сопоставление Person использует ограниченные по времени MySQL named locks, явно освобождаемые на том же соединении.
- Интеграционные тесты проверяют точную серверную версию 8.1.0.

## Consequences

- Старые PostgreSQL migrations заменены новой baseline migration; перенос существующей production-базы не входит в это решение, поскольку production данных ещё нет.
- PostgreSQL-специфичные операторы, типы и блокировки запрещены в новых migrations/runtime SQL.
- До общего production-доступа необходимо выбрать безопасный способ российского размещения MySQL 8.1.0, проверить backups/restore и письменно принять либо устранить риск отсутствия security updates.
- Переход на поддерживаемую MySQL LTS-версию потребует отдельного ADR и полного migration rehearsal.
