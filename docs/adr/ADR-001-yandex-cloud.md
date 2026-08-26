# ADR-001 — Yandex Cloud as primary infrastructure

Status: **Accepted**

## Context
Проекту принципиально важно российское размещение. Требуются MySQL, object storage, secrets, queue, backups, staging/production.

## Decision
Использовать Yandex Cloud как основную инфраструктурную платформу.

## Consequences
- IaC ориентируется на Yandex Cloud.
- MySQL 8.1.0 — основной database service; конкретный способ размещения требует отдельного решения из-за завершённого жизненного цикла этой версии.
- Перед production требуется отдельная юридическая проверка требований к ПД; выбор облака сам по себе не является доказательством compliance.
