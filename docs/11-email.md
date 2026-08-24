# 11. Email Specification

Статус: **Approved MVP scenarios / Draft provider setup**

## 1. Архитектура

Регистрация не должна ждать SMTP.

```text
Registration committed
→ email job queued
→ response success to participant
→ worker sends email
```

Ошибки email не откатывают регистрацию.

Invitation/reset producers persist an idempotent `email_deliveries` intent linked to the one-time auth record. The worker reconstructs the signed link from record id, purpose, expiry and the server-side HMAC secret; raw invitation/reset tokens are never durable delivery context.

The MVP worker core treats `email_deliveries` as the durable source of truth and
atomically leases work with PostgreSQL row locking (`FOR UPDATE SKIP LOCKED`). A
stale `sending` lease can be reclaimed, and every provider call uses the delivery
ID as its idempotency key. Provider/SMTP transport remains an adapter: a concrete
vendor and production credential setup are not selected in this milestone.

## 2. Типы писем MVP

- `REGISTRATION_TICKET`
- `STAFF_INVITATION`
- `PASSWORD_RESET`

## 3. Registration email

Содержит:
- название мероприятия;
- дату;
- время;
- место;
- ФИО;
- QR прямо в письме;
- кнопку «Открыть билет»;
- короткую инструкцию.

Финальный текст и визуальный шаблон будут утверждены отдельно.

## 4. Imported participants

После XLSX import письма автоматически не рассылаются. SUPER_ADMIN отдельно нажимает «Отправить QR участникам».

Массовая постановка ticket-писем требует явного подтверждения и
client-generated UUID операции. Идемпотентный ключ включает UUID операции и
Registration id: безопасный retry не создаёт вторую delivery, а осознанная
повторная отправка использует новый UUID. В очередь попадают только ACTIVE
Registration с email; строки без email и неактивные строки возвращаются
агрегированными счётчиками без PII.

У конкретной регистрации есть «Повторно отправить письмо».

## 5. Failure policy

Email delivery имеет состояния:
- queued;
- sending;
- sent;
- failed.

Worker выполняет ограниченные retries (default: 5, environment-configurable with
an upper bound). Before the last attempt a failure returns the delivery to
`queued`; after the last attempt it moves to `failed`. Persistent diagnostics
contain only a bounded error code, not message bodies, tokens or participant PII.
Ошибка после retries должна быть видна администратору.

## 6. Credentials

Не использовать основной пароль почтового аккаунта в коде. Используется отдельный SMTP app password/API credential, сохранённый как server secret.

## 7. Версия 2.0

Обязательный backlog: массовые email-рассылки участникам выбранного мероприятия (перенос, изменение места, объявление и т. п.).

Архитектура MVP должна позволять добавить `EVENT_BROADCAST` без изменения Registration model.

Автоматические reminders — future capability, не MVP.
