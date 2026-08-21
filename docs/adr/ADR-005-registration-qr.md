# ADR-005 — QR belongs to Registration, not Person

Status: **Accepted**

## Context
Один человек регистрируется на разные мероприятия. Требуется раздельная история и возможность аннулировать конкретную регистрацию.

## Decision
Каждая Registration получает собственный QR. Персональные данные в QR открыто не кодируются.

## Consequences
Повторная отправка билета относится к Registration. Scanner всегда валидирует QR в контексте конкретного Event.
