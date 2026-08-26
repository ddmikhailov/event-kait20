# 15. Перенос на сервер и релиз без Docker

Статус: **Release 1.0 native runbook**

## 1. Границы и требования

Production работает на одном Linux x86_64 сервере с systemd. Нужны Python
ровно 3.12, Node.js 24, Corepack/pnpm, Nginx, `rsync`, `age` и официальный
MySQL ровно 8.1.0 в `/opt/mysql-8.1.0`. Публично открываются только 80/443 и
ограниченный административный SSH. API и MySQL слушают loopback.

До установки организация предоставляет три разных домена Web, Scanner и API,
TLS-сертификат, юридически утверждённую HTTPS-ссылку согласия, SMTP-доступ и
публичный age recipient для резервных копий. Секретный age identity хранится
вне сервера приложения.

Проверка версии обязательна:

```text
/opt/mysql-8.1.0/bin/mysqld --version
```

Вывод обязан содержать `Ver 8.1.0`. Скрипты намеренно отклоняют другую версию.

## 2. Подготовить и проверить конфигурацию

Создать закрытый файл из `deploy/native.env.example`, заполнить значения и
установить `root:event-registration`, mode `0640`. Три cryptographic secrets
должны быть независимыми и содержать не менее 32 random bytes. Пароли с
зарезервированными символами в `DATABASE_URL` URL-кодируются.

Runtime использует только `event_app`, migration — только `event_migrate`.
Проверка не выводит секреты:

```text
node scripts/deploy-config.mjs check \
  --env /etc/event-registration/event-registration.env --check-files
node scripts/deploy-config.mjs check \
  --env /etc/event-registration/migration.env --check-files --migration
```

Создать проверенные Nginx/systemd/MySQL-файлы:

```text
node scripts/deploy-config.mjs render \
  --env /etc/event-registration/event-registration.env \
  --output /root/event-registration-rendered --check-files
sudo deploy/bin/install-native.sh \
  --rendered-dir /root/event-registration-rendered
```

Installer создаёт непривилегированных пользователей, защищённые каталоги и
устанавливает только шаблоны. Он не инициализирует MySQL, не запускает
приложение и не копирует секреты. Сначала доступен безопасный `--dry-run`.

## 3. Инициализировать MySQL

Для нового пустого сервера:

```text
sudo -u mysql /opt/mysql-8.1.0/bin/mysqld \
  --defaults-file=/etc/mysql/event-registration.cnf --initialize
sudo systemctl enable --now event-registration-mysql
```

Временный root password берётся из закрытого error log и сразу меняется. Через
интерактивный `mysql -uroot -p` создать database `event_registration` с
`utf8mb4_unicode_ci` и три loopback-учётные записи:

- `event_app@127.0.0.1`: `SELECT, INSERT, UPDATE, DELETE` на application DB;
- `event_migrate@127.0.0.1`: DML плюс `CREATE, ALTER, INDEX, REFERENCES`;
- `event_backup@127.0.0.1`: только права чтения, необходимые `mysqldump`.

Root credential не попадает в env приложения. MySQL слушает только
`127.0.0.1:3306`.

## 4. Выпустить первый релиз или обновление

Исходный checkout должен быть чистым и указывать на проверенный полный commit
SHA. Скрипт создаёт неизменяемый каталог `/opt/event-registration/releases/SHA`,
устанавливает зависимости, собирает backend и оба frontend из одного commit,
применяет migration через transient systemd unit, атомарно переключает
`/opt/event-registration/current` и проверяет readiness:

```text
sudo deploy/bin/deploy-release.sh \
  --source /srv/event-registration-source \
  --release <полный-40-символьный-commit-SHA> \
  --env /etc/event-registration/event-registration.env \
  --migration-env /etc/event-registration/migration.env
```

Сначала выполнить ту же команду с `--dry-run`. Migration env — защищённая копия
runtime env, в которой изменён только `DATABASE_URL` на `event_migrate`; mode
`0640` или строже. Скрипт не редактирует применённые SQL migrations. При ошибке
после активации он возвращает предыдущую application-ссылку, но не откатывает
схему данных.

## 5. Создать первого администратора

Bootstrap не имеет публичного endpoint и выполняется интерактивно:

```text
sudo systemd-run --pty --wait --collect \
  --property=User=event-registration \
  --property=WorkingDirectory=/opt/event-registration/current \
  --property=EnvironmentFile=/etc/event-registration/event-registration.env \
  /opt/event-registration/current/backend/.venv/bin/event-bootstrap-admin \
  --email admin@example.org
```

Пароль не передаётся аргументом и не сохраняется. Повторный bootstrap при
существующем SUPER_ADMIN отклоняется.

## 6. Резервное копирование

Установить `/etc/event-registration/mysql-backup.cnf` из
`deploy/mysql/backup-client.cnf.example` владельцем `event-backup`, mode `0400`.
Создать `/etc/event-registration/backup.env` из `deploy/backup.env.example`
владельцем `root:event-backup`, mode `0640`. Включить timer только после ручного
успешного запуска и проверки off-host копирования:

```text
sudo systemctl start event-registration-backup.service
sudo systemctl enable --now event-registration-backup.timer
systemctl list-timers event-registration-backup.timer
```

На диске не создаётся открытый SQL: `mysqldump` сразу сжимается и шифруется age.
SHA-256 sidecar проверяет целостность. Локальный retention не заменяет off-host
копию. Полная процедура: `docs/runbooks/backup-restore.md`.

## 7. Приёмка и откат приложения

После релиза проверить HTTPS `/health/live` и `/health/ready`, отсутствие
публичных docs/redoc/openapi, затем пройти `docs/runbooks/mvp-acceptance.md`.
Нужно отдельно проверить invitation/reset, email worker, Scanner camera,
offline/reconnect и восстановление резервной копии в изолированную БД.

Для отката только application-кода:

```text
sudo deploy/bin/rollback-release.sh \
  --release <полный-SHA-предыдущего-релиза>
```

Перед выполнением доступен `--dry-run`. Скрипт не выполняет reverse migration.
Если новая migration несовместима с прошлым кодом, восстановление данных
проводится только по backup runbook с отдельным решением ответственного.
