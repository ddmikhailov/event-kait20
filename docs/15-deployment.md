# 15. Перенос на сервер и релиз без Docker

Статус: **Release 1.0 native runbook**

## 1. Подготовить сервер

- Linux x86_64 с systemd, минимум 4 CPU / 8 GB RAM / 60 GB SSD;
- Python ровно 3.12, Node.js 24, Corepack/pnpm и Nginx;
- официальный MySQL ровно 8.1.0 установлен в `/opt/mysql-8.1.0`;
- открыты только 22 (через allowlist), 80 и 443;
- настроены три HTTPS-адреса: Web, Scanner и API;
- настроены off-host backups, monitoring и синхронизация времени.

Проверить бинарник до создания данных:

```text
/opt/mysql-8.1.0/bin/mysqld --version
```

Вывод обязан содержать `Ver 8.1.0`. Другую версию использовать нельзя.

## 2. Установить MySQL как native service

Создать системного пользователя `mysql`, скопировать
`deploy/mysql/event-registration.cnf` в `/etc/mysql/` и unit
`deploy/systemd/event-registration-mysql.service` в `/etc/systemd/system/`.
Каталоги `/var/lib/mysql-8.1`, `/var/log/mysql` и `/run/mysqld` должны
принадлежать `mysql:mysql` и не читаться посторонними.

Для новой пустой установки один раз выполнить:

```text
sudo -u mysql /opt/mysql-8.1.0/bin/mysqld \
  --defaults-file=/etc/mysql/event-registration.cnf --initialize
sudo systemctl daemon-reload
sudo systemctl enable --now event-registration-mysql
```

Временный root password берётся из закрытого MySQL error log и сразу меняется.
Затем через интерактивный `mysql -uroot -p` создать:

- database `event_registration` с `utf8mb4_unicode_ci`;
- runtime user `event_app@127.0.0.1` только с
  `SELECT, INSERT, UPDATE, DELETE` на эту database;
- отдельного `event_migrate@127.0.0.1` с DML и
  `CREATE, ALTER, INDEX, REFERENCES` только на эту database.

Не передавать DB passwords в аргументах команд и не сохранять root credential
в application env. MySQL должен слушать только `127.0.0.1:3306`.

## 3. Установить приложение

Разместить проверенный Git tag/commit в `/opt/event-registration`. Создать
системного пользователя без shell и home:

```text
sudo useradd --system --no-create-home --shell /usr/sbin/nologin event-registration
python3.12 -m venv /opt/event-registration/backend/.venv
/opt/event-registration/backend/.venv/bin/python -m pip install /opt/event-registration/backend
corepack enable
cd /opt/event-registration
pnpm install --frozen-lockfile
VITE_API_BASE_URL=https://api.events.example.org pnpm build
```

Заменить пример API URL на реальный до сборки. Скопировать содержимое
`apps/web/dist` в `/var/www/event-registration/web`, а `apps/scanner/dist` — в
`/var/www/event-registration/scanner`. Каталоги должны быть read-only для
runtime-пользователей.

## 4. Настроить secrets и применить migrations

Скопировать `deploy/native.env.example` в
`/etc/event-registration/event-registration.env`, заменить все example/replace
значения и установить владельца `root:event-registration`, mode `0640`.
Cryptographic secrets должны быть независимыми и содержать минимум 32 random
bytes. В production допустимы только HTTPS browser URLs.

Для migration создать временную копию env с `DATABASE_URL` отдельного
`event_migrate`. Файл имеет mode `0600`. Запустить миграцию из transient unit,
чтобы secret не попадал в command line:

```text
sudo systemd-run --wait --pipe --collect \
  --property=User=event-registration \
  --property=WorkingDirectory=/opt/event-registration \
  --property=EnvironmentFile=/etc/event-registration/migration.env \
  /opt/event-registration/backend/.venv/bin/python -m event_api.migrate
sudo shred -u /etc/event-registration/migration.env
```

Migration checksum защищает уже применённые SQL-файлы. Runtime env после этого
содержит только `event_app` credential без DDL-прав.

## 5. Настроить Nginx и systemd

Скопировать API/worker units из `deploy/systemd`. В трёх файлах
`deploy/nginx/*` заменить домены и пути сертификатов, затем установить основной
шаблон как site config, а два security-файла — в `/etc/nginx/snippets/`.

До запуска выполнить:

```text
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now event-registration-api
sudo systemctl enable --now event-registration-email-worker
sudo systemctl reload nginx
```

`127.0.0.1:3000` не публикуется firewall. Nginx — единственный trusted proxy;
wildcard CORS и wildcard proxy trust запрещены.

## 6. Создать первого администратора

Bootstrap выполняется интерактивно, не через публичный endpoint:

```text
sudo systemd-run --pty --wait --collect \
  --property=User=event-registration \
  --property=WorkingDirectory=/opt/event-registration \
  --property=EnvironmentFile=/etc/event-registration/event-registration.env \
  /opt/event-registration/backend/.venv/bin/event-bootstrap-admin \
  --email admin@example.org
```

Пароль не передаётся в аргументах и не сохраняется в deployment-файлах.
Повторный bootstrap при существующем SUPER_ADMIN будет отклонён.

## 7. Приёмка

1. Проверить `/health/live` и `/health/ready` через HTTPS.
2. Убедиться, что docs, redoc и openapi.json возвращают 404.
3. Выполнить `docs/runbooks/mvp-acceptance.md` на тестовом Event.
4. Проверить invitation, reset и participant ticket на тестовых адресах.
5. Проверить Scanner на телефоне: камера, install, offline/reconnect.
6. Восстановить backup в отдельную пустую MySQL 8.1.0.
7. Проверить alerts и только затем открыть публичную регистрацию.

## 8. Обновление и rollback

- выпускать immutable Git tag/commit;
- до migration создавать recovery point;
- сначала staging, затем тот же commit production;
- не редактировать применённые SQL-файлы;
- frontend artifacts и Python package пересобирать из одного commit;
- rollback приложения выполняется установкой предыдущего commit и рестартом
  двух application units;
- rollback данных — только восстановлением по backup runbook;
- после каждого обновления повторять `nginx -t`, readiness и smoke checks.

Полный validation описан в README и `docs/14-testing.md`.
