# ADR-004 — Modular monolith backend

Status: **Accepted**

## Context
Нагрузка невысокая, но предметная логика имеет сильные транзакционные связи. Микросервисы усложнили бы deployment, data consistency и разработку.

## Decision
Один FastAPI application на Python 3.12 как модульный монолит. Email worker — отдельный процесс того же Python-пакета.

## Consequences
Доменные границы сохраняются через Python routers/services. Выделение отдельного сервиса в будущем возможно только при реальной необходимости.
