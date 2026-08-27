# ADR-001 — Yandex Cloud as primary infrastructure

Status: **Superseded by ADR-012 for Release 1.0 deployment**

## Context
Проекту принципиально важно российское размещение. Требуются MySQL, object storage, secrets, queue, backups, staging/production.

## Decision
Историческое решение выбирало Yandex Cloud. После получения требований
системного администратора Release 1.0 поставляется на organisation-managed
Russian infrastructure по ADR-012. Yandex Cloud остаётся допустимой будущей
площадкой, но не является обязательным runtime или release gate.

## Consequences
- Release 1.0 не поставляет production IaC или cloud resources.
- MySQL 8.1.0 предоставляет организация; application package не устанавливает
  и не обновляет database service.
- Перед production требуется отдельная юридическая проверка требований к ПД; выбор облака сам по себе не является доказательством compliance.
