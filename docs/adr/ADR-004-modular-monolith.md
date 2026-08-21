# ADR-004 — Modular monolith backend

Status: **Accepted**

## Context
Нагрузка невысокая, но предметная логика имеет сильные транзакционные связи. Микросервисы усложнили бы deployment, data consistency и разработку.

## Decision
Один NestJS API как модульный монолит. Email worker — отдельный background component из-за очереди.

## Consequences
Доменные границы сохраняются через NestJS modules/packages. Выделение отдельного сервиса в будущем возможно только при реальной необходимости.
