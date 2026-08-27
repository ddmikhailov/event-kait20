# Backup and restore runbook

Статус: **Release 1.0 organisation-managed operational contract**

## Граница безопасности

MySQL ровно 8.1.0 остаётся source of truth. Backup содержит персональные данные
и всегда хранится зашифрованным. Секретный age identity находится вне сервера
приложения; на сервере хранится только публичный recipient. Восстановление
никогда не выполняется поверх production DB.

До запуска владелец утверждает RPO, RTO, срок хранения, off-host хранилище и
ответственных. Потеря backup, отсутствие off-host копии или неуспешная учебная
проверка восстановления являются production blocker.

## Организация backup

1. Создать отдельного read-only MySQL backup user только с необходимого host.
2. Хранить его credential в защищённом механизме организации.
3. Ежедневно создавать consistent dump средствами, совместимыми с MySQL 8.1.0.
4. Шифровать backup до помещения в постоянное/off-host хранилище.
5. Сохранять SHA-256, время, source database и aggregate result без PII.
6. Проверять свежесть backup и доставлять alert ответственному.
7. Регулярно восстанавливать копию в отдельную пустую database.

Reference scripts `deploy/bin/backup-mysql.sh` и `verify-backup.sh` используются
только инженерным CI recovery drill и не входят в sysadmin package. Организация
может реализовать эквивалентные controls собственными approved средствами; проект
не устанавливает timers/services и не навязывает конкретный process manager.

CI выполняет `scripts/ci-backup-restore.sh`: поднимает одноразовую MySQL 8.1.0,
применяет migrations, создаёт временную age identity, делает зашифрованный
backup, проверяет SHA-256 и восстанавливает его в отдельную database. Identity,
credentials, обе database и backup удаляются после процесса. Агрегатный отчёт
без данных и секретов записывается в `.runtime/recovery-drill.json`. Эта проверка
доказывает работоспособность инструментов, но не заменяет restore drill реальной
production-копии на изолированном сервере.

## Проверка восстановления

На изолированном сервере MySQL 8.1.0 создать пустую database с именем
`event_registration_restore_<идентификатор>`. Подготовить отдельные MySQL
credentials и decrypt identity. Утверждённая процедура организации должна:

1. проверить SHA-256 и точную версию restore client/server;
2. подтвердить, что target database пустая и не является production;
3. расшифровать backup без создания незашифрованной постоянной копии;
4. восстановить данные в target database;
5. проверить `schema_migrations` и основные таблицы;
6. сохранить database для ручной application-приёмки до формального завершения
   drill.

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

## Monitoring и проверка alert

Monitoring организации регулярно проверяет process manager, внешний HTTPS
readiness, срок TLS, свободное место, возраст и SHA-256 последнего backup, точную
MySQL 8.1.0, FAILED deliveries и возраст QUEUED email. Пороговые значения и
получатели alert находятся в защищённой operational configuration.

Во внешний monitoring channel уходят только стабильные имена failed checks без
PII, credentials и connection strings. Перед production обязательно выполнить
тестовую доставку alert и сохранить ссылку на evidence.
