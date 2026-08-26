# Backup and restore runbook

Статус: **Release 1.0 native operational runbook**

## Граница безопасности

MySQL ровно 8.1.0 остаётся source of truth. Backup содержит персональные данные
и всегда хранится зашифрованным. Секретный age identity находится вне сервера
приложения; на сервере хранится только публичный recipient. Восстановление
никогда не выполняется поверх production DB.

До запуска владелец утверждает RPO, RTO, срок хранения, off-host хранилище и
ответственных. Потеря backup, отсутствие off-host копии или неуспешная учебная
проверка восстановления являются production blocker.

## Установка и ежедневная проверка

1. Создать read-only `event_backup@127.0.0.1`.
2. Установить `/etc/event-registration/mysql-backup.cnf` из примера с владельцем
   `event-backup:event-backup` и mode `0400`.
3. Установить `/etc/event-registration/backup.env` с владельцем
   `root:event-backup` и mode `0640`. Указать public `AGE_RECIPIENT` и retention.
4. Запустить `event-registration-backup.service` вручную.
5. Проверить новый `.sql.gz.age`, его `.sha256` и журнал без секретов/PII.
6. Скопировать оба файла в утверждённое off-host хранилище.
7. Только после этого включить `event-registration-backup.timer`.

Скрипт `deploy/bin/backup-mysql.sh` проверяет точную версию клиента 8.1.0,
владельца и права credentials, шифрует поток `mysqldump | gzip` напрямую через
age и удаляет только файлы собственного строгого шаблона старше retention.

## Проверка восстановления

На изолированном сервере MySQL 8.1.0 создать пустую database с именем
`event_registration_restore_<идентификатор>`. Подготовить отдельные MySQL
credentials и age identity. Выполнить:

```text
deploy/bin/verify-backup.sh \
  --file /protected/event-registration-YYYYMMDDTHHMMSSZ.sql.gz.age \
  --database event_registration_restore_drill \
  --defaults-file /protected/restore-client.cnf \
  --identity /protected/age-identity.txt
```

Команда сначала проверяет SHA-256, точную версию клиента и пустоту целевой DB,
затем расшифровывает поток прямо в MySQL. Она проверяет migration registry и
основные таблицы, но намеренно сохраняет восстановленную DB для ручной приёмки.

После этого запустить API в закрытой recovery-среде и проверить readiness,
авторизацию, регистрацию, ticket lookup и scanner sync на разрешённых данных.
Зафиксировать фактическое время, RPO/RTO и результат; затем удалить recovery DB
по утверждённой процедуре.

## Перед migration и при аварии

Перед production migration нужен свежий успешный backup и подтверждённая
off-host копия. Записываются commit SHA, список migrations, время и ответственный.
Та же версия сначала применяется к staging-копии.

При аварии остановить business writes или убрать API из трафика. Восстановить
новую изолированную DB, выполнить все проверки и только по явному решению
ответственного изменить production connection secret. Старую DB не удалять до
завершения расследования и подтверждения целостности.
