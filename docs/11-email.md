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

У конкретной регистрации есть «Повторно отправить письмо».

## 5. Failure policy

Email delivery имеет состояния:
- queued;
- sending;
- sent;
- failed.

Worker выполняет ограниченные retries. Ошибка после retries должна быть видна администратору.

## 6. Credentials

Не использовать основной пароль почтового аккаунта в коде. Используется отдельный SMTP app password/API credential, сохранённый как server secret.

## 7. Версия 2.0

Обязательный backlog: массовые email-рассылки участникам выбранного мероприятия (перенос, изменение места, объявление и т. п.).

Архитектура MVP должна позволять добавить `EVENT_BROADCAST` без изменения Registration model.

Автоматические reminders — future capability, не MVP.
