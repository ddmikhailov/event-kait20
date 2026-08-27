# 15. Передача системному администратору

Статус: **Release 1.0 sysadmin artifact runbook**

## 1. Собрать и проверить комплект

Из чистого проверенного commit выполнить полный validation suite, затем:

```text
pnpm release:sysadmin
```

Результат: `.runtime/event-registration-1.0.0-sysadmin.tar.gz`. Внутренний
`MANIFEST.json` фиксирует source commit и SHA-256 каждого файла. Комплект не
содержит MySQL binaries, исходники, Docker, systemd, deployment scripts,
пароли, TLS keys и реальные secrets.

## 2. База данных

Системный администратор предоставляет MySQL ровно 8.1.0 и выполняет:

1. `database/00_create_database.sql`;
2. `database/01_schema.sql`;
3. адаптированный `database/02_users_and_grants.example.sql` при необходимости.

Итоговый файл с passwords нельзя сохранять в каталоге приложения. Для runtime
и migrations используются разные MySQL users. Индивидуальные SQL migrations
тоже включены для будущих контролируемых обновлений.

## 3. Backend и конфигурация

На сервере нужен CPython ровно 3.12. Изолированная среда устанавливает
`backend/requirements.txt`, затем `backend/*.whl` с `--no-deps`. Значения из
`config/backend.env.example` переносятся в защищённое хранилище организации.
`DATABASE_URL` содержит адрес предоставленной MySQL database. Три
cryptographic secrets генерируются независимо и не попадают в файлы поставки.

Организация запускает `event-api` и `event-email-worker` выбранным process
manager. API слушает только `127.0.0.1:3000`. Проект не навязывает systemd и не
поставляет сценарии запуска.

Wheel содержит скомпилированный CPython 3.12 bytecode приложения без backend
`.py` files. Это не самостоятельный native executable: CPython и перечисленные
runtime dependencies предоставляет организация.

## 4. Frontend и Apache

Каталоги `frontend/web` и `frontend/scanner` уже скомпилированы с API base
`/api`. Apache раздаёт их как два HTTPS virtual hosts и проксирует `/api/` на
`http://127.0.0.1:3000/`. Пример находится в `apache/`, но TLS certificate
директивы и реальные пути определяет организация.

## 5. Первый администратор

После запуска HTTPS, API и базы системный администратор выполняет в защищённом
backend environment:

```text
event-bootstrap-admin --email admin@example.org
```

Пароль в консоль не вводится. Команда выводит временную одноразовую HTTPS-ссылку
и сохраняет только её hash. Администратор открывает ссылку и задаёт пароль при
первом входе. До этого SUPER_ADMIN account не существует. Повторная активная
ссылка и создание второго первого администратора блокируются.

## 6. Приёмка

Проверяются `/api/health/live`, `/api/health/ready`, вход SUPER_ADMIN, создание
тестового события, регистрация участника, email queue и Scanner на реальном
HTTPS устройстве. Затем организация включает собственные backup, monitoring и
process restart controls.
