# 11. Email

Статус: **Release 1.0 SMTP implementation**

## Сценарии

- REGISTRATION_TICKET — ссылка на билет/QR, Event, время и место;
- STAFF_INVITATION — одноразовая ссылка активации SCANNER;
- PASSWORD_RESET — одноразовая ссылка установки нового пароля.

Регистрация и административная операция сначала фиксируют business transaction
и durable email_deliveries intent. SMTP не находится в request path, поэтому
ошибка почты не откатывает регистрацию.

## Worker

Отдельный Python worker:

1. выбирает запись через `FOR UPDATE SKIP LOCKED` и подтверждает захват
   условным атомарным `UPDATE`, чтобы устаревший снимок MySQL не привёл к
   двойной обработке несколькими worker-процессами; контекст письма загружается
   после короткой claim-транзакции в `READ COMMITTED`, поэтому join не наследует
   устаревший snapshot конкурентно созданной Registration;
2. переводит её в SENDING и увеличивает attempts;
3. реконструирует ссылку из server HMAC, не читая raw token из БД;
4. отправляет text/plain и HTML через SMTP STARTTLS с обязательной проверкой
   сертификата системным trust store;
5. переводит запись в SENT либо возвращает в QUEUED;
6. после EMAIL_MAX_ATTEMPTS переводит в FAILED;
7. повторно подхватывает SENDING lease старше десяти минут после сбоя процесса.

В БД не сохраняются тело письма, participant PII snapshot, SMTP credential или
raw token. provider_message_id и ограниченный error code используются для
диагностики. Message-ID основан на delivery ID.

## Массовые билеты

Импорт сам письма не отправляет. SUPER_ADMIN отдельно подтверждает ticket batch
с client-generated request UUID. Idempotency key включает request UUID и
Registration ID; повтор одного запроса не создаёт дубликаты.

## Production

Обязательны SMTP_HOST, SMTP_FROM_EMAIL и при необходимости username/app
password. Личный основной пароль почтового ящика запрещён. SMTP secret хранится
в Lockbox или защищённом deployment env. Demo без SMTP оставляет intents QUEUED.

Произвольные массовые объявления относятся к версии 2.0.
