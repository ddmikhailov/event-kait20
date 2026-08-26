# 15. Перенос на сервер и релиз

Статус: **Release 1.0 runbook**

## 1. Подготовить сервер

- Linux x86_64, Docker Engine с Compose, минимум 4 CPU / 8 GB RAM / 60 GB SSD;
- открыты только 22 (через allowlist), 80 и 443;
- MySQL/API/Web/Scanner ports наружу не открываются;
- настроены три HTTPS-адреса: web, scanner, api;
- настроены off-host backups, monitoring и синхронизация времени.

MySQL 8.1.0 — обязательная существующая совместимость проекта.

## 2. Подготовить конфигурацию

Скопировать deploy/production.env.example в deploy/production.env и заменить
все example/replace значения. Сгенерировать независимые secrets не менее
32 random bytes. Файл должен иметь доступ только владельцу deployment.

Проверить:

    docker compose --env-file deploy/production.env -f compose.production.yml config

Нельзя использовать demo credentials или переносить .demo.env.

## 3. Reverse proxy

Настроить TLS:

- PUBLIC_WEB_URL → 127.0.0.1:8080;
- PUBLIC_SCANNER_URL → 127.0.0.1:8081;
- PUBLIC_API_URL → 127.0.0.1:3000.

Передавать X-Forwarded-For/Proto только от доверенного proxy. Значение
TRUSTED_PROXY_IPS должно содержать точный адрес reverse proxy, а не wildcard.
Ограничить размер HTTP body на proxy согласно API (XLSX максимум 10 MB).

## 4. Первый запуск

    docker compose --env-file deploy/production.env -f compose.production.yml build
    docker compose --env-file deploy/production.env -f compose.production.yml up -d
    docker compose --env-file deploy/production.env -f compose.production.yml ps

Миграции применяются до старта API и защищены checksum. После readiness создать
первого администратора интерактивной CLI-командой внутри API container. Команда
откажется работать, если SUPER_ADMIN уже существует; пароль не передаётся в
аргументах и не сохраняется в deployment-файлах.

## 5. Приёмка

1. Проверить health/live и health/ready.
2. Убедиться, что docs, redoc и openapi.json возвращают 404.
3. Выполнить docs/runbooks/mvp-acceptance.md на тестовом Event.
4. Отправить invitation, reset и participant ticket на тестовые адреса.
5. Проверить Scanner на реальном телефоне: камера, install, offline/reconnect.
6. Выполнить backup и восстановить его в отдельную пустую MySQL 8.1.0.
7. Проверить alerts и только затем открыть публичную регистрацию.

## 6. Обновление и rollback

- выпускать immutable Git tag/image версии;
- до миграции создавать recovery point;
- сначала staging, затем тот же commit production;
- не редактировать применённые SQL-файлы;
- rollback приложения выполняется предыдущими images;
- rollback данных — только восстановлением по runbook, не обратной миграцией наугад.

Команды полного validation описаны в README и docs/14-testing.md.
