# ADR-001 — Yandex Cloud as primary infrastructure

Status: **Accepted**

## Context
Проекту принципиально важно российское размещение. Требуются PostgreSQL, object storage, secrets, queue, backups, staging/production.

## Decision
Использовать Yandex Cloud как основную инфраструктурную платформу.

## Consequences
- IaC ориентируется на Yandex Cloud.
- Managed PostgreSQL — основной database service.
- Перед production требуется отдельная юридическая проверка требований к ПД; выбор облака сам по себе не является доказательством compliance.
