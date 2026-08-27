# 15. Передача системному администратору

Статус: **Release 1.0 current deployment runbook**  
Дата актуализации: **27 августа 2026**

## 1. Необходимый комплект

Из clean commit после полного validation:

```text
pnpm release:sysadmin
```

Результат: `.runtime/event-registration-1.0.0-sysadmin.tar.gz` с compiled
frontend, compiled CPython 3.12 backend wheel, requirements, Apache HTTP example,
env template, SQL и checksum manifest.

Source-backend вариант собирается отдельно:

```text
pnpm release:sysadmin-source
```

Для обычной переустановки backend используется compiled wheel. Source archive
нужен только если это прямо требует организация.

## 2. Размещение файлов

Рекомендуемая логическая структура, которую администратор может адаптировать:

```text
/opt/event-registration/
  backend/
  database/
  frontend/web/
  frontend/scanner/
  .venv/

/etc/event-registration/backend.env
```

Production env и secrets не копируются в каталог release и DocumentRoot.

## 3. MySQL

Приложение не устанавливает MySQL. Организация предоставляет ровно 8.1.0.

Для новой пустой database:

1. выполнить `database/00_create_database.sql`;
2. выполнить `database/01_schema.sql`;
3. адаптировать `database/02_users_and_grants.example.sql`;
4. удалить/защитить заполненный рабочий SQL с credentials.

Runtime account `event_app` получает `SELECT, INSERT, UPDATE, DELETE` только для
`event_registration.*`. Если MySQL находится на другом host, account создаётся
для фактического IP/hostname backend-сервера, а не для `%`:

```sql
CREATE USER 'event_app'@'APP_SERVER_IP' IDENTIFIED BY 'SECRET';
GRANT SELECT, INSERT, UPDATE, DELETE
ON event_registration.* TO 'event_app'@'APP_SERVER_IP';
```

## 4. Backend installation

Требуется CPython ровно 3.12:

```text
cd /opt/event-registration
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m pip install --no-deps backend/*.whl
```

При обновлении wheel:

```text
.venv/bin/python -m pip install --force-reinstall --no-deps backend/*.whl
```

Wheel содержит CPython 3.12 bytecode, а не native standalone executable. Python
runtime и dependencies остаются обязательными.

## 5. Configuration

Значения `config/backend.env.example` переносятся в защищённый файл организации,
например `/etc/event-registration/backend.env`. Все placeholders заменяются,
secrets генерируются независимо, reserved characters в DATABASE_URL
URL-encode. Заполненный env нельзя отправлять обратно или коммитить.

Backend запускается только с явным путём:

```text
EVENT_REGISTRATION_ENV_FILE=/etc/event-registration/backend.env \
  /opt/event-registration/.venv/bin/event-api
```

Worker:

```text
EVENT_REGISTRATION_ENV_FILE=/etc/event-registration/backend.env \
  /opt/event-registration/.venv/bin/event-email-worker
```

Нельзя запускать `python backend/src/event_api/main.py`: package-relative imports
рассчитаны на установленный package/entry points.

## 6. Frontend and Apache

`frontend/web` и `frontend/scanner` полностью заменяют соответствующие
DocumentRoot. Старые hashed assets удаляются, чтобы не смешивать releases.

Apache слушает internal HTTP :80. Пример:

```text
apache/event-registration-internal-http.conf.example
```

Оба virtual hosts:

- отдают свой frontend;
- проксируют `/api/` на `http://127.0.0.1:3000/`;
- сохраняют Host;
- передают `X-Forwarded-Proto: https`;
- имеют SPA fallback и security headers.

Внешний proxy организации завершает HTTPS, сохраняет Origin/Cookie/Set-Cookie и
является единственным сетевым источником, которому разрешён Apache :80.

## 7. First SUPER_ADMIN

После готовности HTTPS, API и database:

```text
EVENT_REGISTRATION_ENV_FILE=/etc/event-registration/backend.env \
  /opt/event-registration/.venv/bin/event-bootstrap-admin \
  --email admin@example.org
```

Команда не принимает пароль. Она создаёт одну одноразовую activation link;
предназначенный администратор открывает её через внешний HTTPS и задаёт пароль.
Повторный bootstrap после активации блокируется.

## 8. Verification

На сервере:

```text
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
```

Снаружи:

```text
curl -i https://events.example.org/api/health/live
curl -i https://events.example.org/api/health/ready
curl -i https://scanner.example.org/api/health/live
```

Затем проверяются login, Event CRUD, public registration, ticket, SMTP queue,
Scanner camera, EventAccess и offline sync. Scanner browser может потребовать
закрытия вкладок/очистки service worker после замены сборки.

## 9. Rollback and evidence

До обновления организация сохраняет предыдущий immutable archive, database
recovery point и текущий protected env. Rollback переключает application files
на предыдущий artifact; destructive database rollback без отдельного плана
запрещён. `MANIFEST.json`, Git SHA, CI URL, smoke и restore result сохраняются в
закрытой release record без secrets/PII.
