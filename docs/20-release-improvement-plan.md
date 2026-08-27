# 20. План доведения MVP до первого публичного выпуска

Статус: **выполняется**  
База плана: Release 1.0, commit `02ca066`

## Принципы

1. Сначала закрываются риски безопасности, потери данных и невозможности
   отката; косметические улучшения не блокируют релиз.
2. Всё, что не требует реквизитов организации, автоматизируется локально и в CI.
3. Один и тот же immutable commit проверяется локально, на staging и в
   production. Ручная пересборка между средами запрещена.
4. Новые платные сервисы до staging не требуются. Используются существующий
   GitHub CI, нативная MySQL 8.1.0 и открытые инструменты проекта.
5. Каждый этап имеет измеримый результат и не повторяет проверки предыдущего.

## Этап 1. Автоматический production security smoke

Приоритет: **критический**. Статус: **код завершён; staging-прогон ожидает
домены и TLS**.

Расширить безопасную проверку уже развёрнутого приложения. Она не авторизуется,
не создаёт участников и не использует production credentials.

Результат:

- liveness/readiness доступны только на ожидаемом API;
- `/docs`, `/redoc`, `/openapi.json` закрыты;
- Web/Scanner/API используют три разных HTTPS origin;
- trusted Web Origin получает точный CORS allow header;
- посторонний Origin не получает CORS-доступ, а mutation отклоняется;
- HSTS, nosniff, frame, referrer, permissions policy и CSP проверяются после
  прохождения через Nginx;
- Web shell, Scanner shell и PWA manifest соответствуют релизу.

Готовность: тесты smoke-валидатора включены в `pnpm test`, а staging-команда
завершается успешно на реальных доменах.

## Этап 2. Release-readiness отчёт и security regression

Приоритет: **критический**. Статус: **автоматизация завершена; реальные evidence
заполняются после staging-проверок**.

- сформировать единый отчёт с commit SHA, CI run, migration list, временем,
  средой и результатами обязательных gates;
- проверить brute-force/rate limits, CSRF/session rotation, SCANNER role matrix,
  QR tampering/enumeration и отсутствие PII/секретов в логах ошибок;
- расширить негативные XLSX-тесты архивами, неверными MIME, oversized input и
  spreadsheet injection;
- зафиксировать отсутствие Swagger, demo seed, wildcard CORS и небезопасных
  cookie на production-конфигурации.

Готовность: все проверки воспроизводимы одной командой, а отчёт не содержит
секретов или персональных данных.

## Этап 3. Браузерный E2E и доступность

Приоритет: **высокий**. Статус: **Chromium E2E, offline reload/reconnect,
mobile layout и автоматический accessibility-аудит работают локально и в CI;
физические Chrome/Edge и Android-проверки ожидают staging**.

- public registration → ticket;
- admin login → Event/form/participant lifecycle;
- invitation → SCANNER login → assigned Event;
- online scan, offline persistence, reload и reconnect;
- keyboard-only навигация, видимый focus, labels, контраст и mobile layout;
- Chrome/Edge desktop и Android-устройство для камеры/PWA.

Автоматизируемые сценарии запускаются в CI без реальных писем и PII. Камера,
установка PWA и два физических scanner-устройства остаются ручной staging
приёмкой.

Готовность: критические journeys зелёные, найденные дефекты классифицированы;
открытых critical/high дефектов нет.

## Этап 4. Нагрузка и конкурентность

Приоритет: **высокий перед первым крупным Event**. Статус: **локальный
воспроизводимый профиль на MySQL 8.1.0 завершён; повтор с серверными метриками и
утверждение порогов ожидают staging**.

- около 1000 регистраций с конкурентной проверкой capacity;
- повторные/idempotent регистрации;
- параллельные scanner sync batches с двух и более устройств;
- рост и обработка email queue, ограниченные retries;
- latency p50/p95/p99, error rate, CPU/RAM и MySQL connections.

Сценарий работает на staging с синтетическими данными и не требует платного
load-testing сервиса. Целевые пороги утверждаются после измерения реального
сервера организации.

Команда `pnpm test:load` формирует обезличенный агрегатный отчёт в `.runtime`,
проверяет capacity/idempotency, четыре параллельных scanner-потока, конкурентный
захват email queue и ограниченный retry. В ходе локального прогона устранена
гонка чтения устаревшего Registration-контекста при параллельном захвате email
delivery несколькими worker-процессами.

Локальный baseline 2026-08-27 на developer-машине: 1000 запросов, 800 созданных
регистраций и 200 корректных `CAPACITY_FULL` за 18,67 с; p50/p95/p99 —
391/839/1310 мс; 800 attendance events от четырёх устройств и 850 email intents
обработаны без потерь. Это контроль регрессии, а не обещание производительности
будущего сервера.

## Этап 5. Эксплуатационная готовность

Приоритет: **критический**.

- monitoring systemd units, readiness, места на диске, MySQL, email queue и TLS;
- ежедневный encrypted backup и автоматическая проверка свежести;
- off-host копирование без хранения age identity на application-сервере;
- restore drill в отдельную MySQL 8.1.0 с зафиксированными RPO/RTO;
- ротация DB/application/SMTP secrets по runbook;
- учебный rollback application-кода на предыдущий immutable release.

Готовность: backup реально восстановлен, alert доставлен ответственному, rollback
проверен, а результаты приложены к release-readiness отчёту.

## Этап 6. Staging с реквизитами организации

Требует от организации:

- Linux-сервер, три домена, DNS и TLS;
- consent URL/version, утверждённые ответственным за ПД;
- SMTP app credential и тестовый список получателей;
- production secrets и off-host backup destination;
- ответственные за релиз, восстановление и инциденты;
- письменное принятие lifecycle-риска MySQL 8.1.0.

На staging разворачивается тот же commit, запускаются migrations, security
smoke, browser/device E2E, email delivery и restore rehearsal.

## Этап 7. Production cutover

1. Заморозить изменения и выбрать полный commit SHA.
2. Подтвердить зелёный CI и подписанный release decision.
3. Создать и вынести recovery point.
4. Выполнить immutable deployment и migrations.
5. Запустить production smoke до открытия регистрации.
6. Провести короткий ручной путь admin/registration/email/scanner.
7. Открыть трафик и усиленно наблюдать первые 60 минут.
8. При нарушении gate остановить writes/traffic и выполнить утверждённый rollback.

## Порядок следующих изменений

Следующий локальный блок — monitoring/backup/restore helpers Этапа 5. Staging и
production не начинаются до получения внешних реквизитов; это предотвращает
повторные дорогие прогоны и экономит инженерные лимиты.
