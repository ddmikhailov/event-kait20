# Backup and restore runbook

Статус: **Release baseline; provider console steps pending environment approval**

## Purpose and safety boundary

MySQL 8.1.0 остаётся source of truth. Production должна использовать ежедневные
зашифрованные backups и, если выбранный сервис поддерживает, point-in-time
recovery в пределах утверждённого retention. До первого production запуска
владелец утверждает провайдера, RPO, RTO, retention и ответственного за recovery.

Восстановление никогда не выполняется поверх действующей production БД. Сначала
создаётся новый изолированный MySQL 8.1.0 instance/database, проверяется
целостность, затем отдельно принимается решение о переключении приложения.

## Before a production migration

1. Убедиться, что последний managed backup завершён успешно.
2. Создать provider recovery point/snapshot, если сервис это поддерживает.
3. Зафиксировать commit SHA, migration list, время и ответственного.
4. На staging применить те же migrations к копии совместимой структуры.
5. Проверить `/health/ready` и критические smoke/E2E сценарии.

## Logical backup when required

Logical backup служит дополнительным переносимым слоем, а не заменой managed
backup. Connection strings поступают только из secret manager/локального
защищённого окружения и не записываются в shell history или репозиторий.

```text
mysqldump --single-transaction --routines --triggers --result-file=<protected-path> <database>
mysql --database=<isolated-target> --execute="SHOW TABLES"
```

Backup содержит персональные данные. Он хранится зашифрованно, с минимальным
доступом, утверждённым retention и обязательным удалением после истечения срока.

## Restore rehearsal

1. Создать пустую изолированную MySQL 8.1.0 database с отдельными credentials.
2. Восстановить backup только в неё:

```text
mysql --database=<isolated-target> < <protected-path>
```

3. Выполнить schema/migration inspection и read-only проверки количества Events,
   ACTIVE/ANNULLED Registrations, attendance events и pending email deliveries.
4. Запустить API с новой БД в закрытой staging/recovery среде.
5. Проверить readiness, авторизацию, регистрацию, ticket lookup и scanner sync на
   синтетических либо разрешённых тестовых данных.
6. Зафиксировать фактическое время восстановления и расхождение с RPO/RTO.
7. Удалить recovery environment и временные копии по утверждённой процедуре.

## Production recovery

При инциденте сначала остановить business writes либо вывести API из трафика.
Определить recovery point, восстановить новый instance/database и провести
проверки из rehearsal. Переключение connection secret и возврат трафика требуют
явного решения ответственного. Старую БД не удалять до завершения расследования
и подтверждения целостности новой среды.

Любая потеря/утечка backup, недоступность recovery point или провал restore drill
являются production blocker и инцидентом безопасности.
