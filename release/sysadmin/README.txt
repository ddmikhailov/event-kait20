EVENT REGISTRATION 1.0 — COMPILED PACKAGE FOR THE ORGANISATION

Состав:
- frontend/web: готовый Web/Admin frontend для Apache;
- frontend/scanner: готовый Scanner PWA;
- backend/*.whl: CPython 3.12 bytecode-only backend без исходных `.py`;
- backend/requirements.txt: точные runtime-зависимости;
- config/backend.env.example: шаблон конфигурации приложения и MySQL;
- apache/: внутренние Apache HTTP virtual hosts;
- database/: SQL создания схемы MySQL 8.1.0 и отдельные migrations;
- MANIFEST.json: Git revision и SHA-256 каждого файла.

Сетевая схема:

  Internet -> внешний reverse proxy HTTPS :443 -> Apache HTTP :80
           -> /api/ -> FastAPI 127.0.0.1:3000 -> MySQL 8.1.0

Apache :80 доступен только доверенному внешнему proxy. Proxy сохраняет Host и
Origin, передаёт Cookie/Set-Cookie без изменения и запрещает публичный HTTP.
Он удаляет spoofed forwarding headers клиента и устанавливает корректный client
IP. Публичные URL в backend.env всегда используют HTTPS.

Не входят: MySQL binaries, Docker, systemd units, deployment/install scripts,
TLS keys, passwords, application secrets, Python sources и node_modules.

Требования:
- CPython ровно 3.12;
- предоставленная организацией MySQL ровно 8.1.0;
- Apache с proxy, proxy_http, headers и rewrite;
- внешний HTTPS reverse proxy и сертификаты;
- выбранный организацией process manager;
- SMTP STARTTLS для production email.

Backend:

  cd /opt/event-registration
  python3.12 -m venv .venv
  .venv/bin/python -m pip install -r backend/requirements.txt
  .venv/bin/python -m pip install --no-deps backend/*.whl

Значения config/backend.env.example перенести в защищённый файл, например
`/etc/event-registration/backend.env`. Шаблон нельзя использовать без замены
всех placeholder и нельзя размещать в DocumentRoot/Git. Три cryptographic
secrets должны быть разными. DATABASE_URL может указывать на отдельный сервер
MySQL; его runtime user должен быть разрешён именно с адреса backend-сервера.

Запуск API:

  EVENT_REGISTRATION_ENV_FILE=/etc/event-registration/backend.env \
    /opt/event-registration/.venv/bin/event-api

Запуск worker:

  EVENT_REGISTRATION_ENV_FILE=/etc/event-registration/backend.env \
    /opt/event-registration/.venv/bin/event-email-worker

Backend нельзя запускать как `python event_api/main.py`. После установки wheel
используются только entry points `event-api`, `event-email-worker` и
`event-bootstrap-admin`.

Database:
1. Для новой пустой базы выполнить database/00_create_database.sql.
2. Выполнить database/01_schema.sql.
3. Адаптировать database/02_users_and_grants.example.sql под реальные IP/hosts.
4. Не сохранять заполненные credentials в каталоге приложения.

Frontend:
- frontend/web разместить в DocumentRoot основного домена;
- frontend/scanner разместить в DocumentRoot Scanner;
- оба frontend уже обращаются к same-origin `/api`;
- адаптировать apache/event-registration-internal-http.conf.example;
- полностью заменять старые assets, не смешивая сборки.

Первый SUPER_ADMIN:

  EVENT_REGISTRATION_ENV_FILE=/etc/event-registration/backend.env \
    /opt/event-registration/.venv/bin/event-bootstrap-admin \
    --email admin@example.org

Команда выдаёт одноразовую внешнюю HTTPS-ссылку. Пароль задаёт администратор в
браузере; raw token и пароль в базе не сохраняются.

Проверка:

  curl http://127.0.0.1:3000/health/live
  curl http://127.0.0.1:3000/health/ready
  curl https://events.example.org/api/health/live
  curl https://scanner.example.org/api/health/live

После этого проверяются вход, Event, регистрация, email и Scanner на реальном
HTTPS-устройстве. MANIFEST.json сохраняется как evidence поставки.
