EVENT REGISTRATION 1.0 — APACHE HTTP + PYTHON SOURCE BACKEND

Состав:
- frontend/web: готовый production frontend для Apache;
- frontend/scanner: готовый production Scanner PWA;
- backend/src: исходные Python-файлы backend;
- backend/requirements.txt: точные runtime dependencies;
- backend/migrations: SQL migrations;
- config/backend.env.example: конфигурация приложения и подключения к БД;
- apache/: Apache :80 virtual hosts для внутреннего reverse-proxy контура;
- database/: SQL создания и полной схемы MySQL 8.1.0;
- MANIFEST.json: SHA-256 и исходный Git commit.

Локальный demo seed, тесты и frontend sources в production archive не входят.

Сетевая схема:

  Internet -> внешний reverse proxy HTTPS :443 -> Apache HTTP :80
           -> /api/ -> FastAPI 127.0.0.1:3000 -> MySQL 8.1.0

Apache :80 нельзя открывать пользователям или интернету. Firewall/ACL разрешает
его только с адресов доверенного внешнего reverse proxy. Внешний proxy обязан
сохранять исходные Host и Origin, передавать ответы Set-Cookie без изменения и
не допускать HTTP-доступа пользователя. Proxy удаляет spoofed forwarding
headers и устанавливает корректный client IP. Apache принудительно передаёт backend
заголовок X-Forwarded-Proto: https. Публичные URL в конфигурации всегда HTTPS.

Требования:
- CPython ровно 3.12;
- MySQL ровно 8.1.0, предоставленный организацией;
- Apache с proxy, proxy_http, headers и rewrite;
- внешний HTTPS reverse proxy и действующие TLS certificates;
- выбранный организацией process manager;
- SMTP для писем production.

Подготовка backend:

  cd /opt/event-registration
  python3.12 -m venv .venv
  .venv/bin/python -m pip install -r backend/requirements.txt
  .venv/bin/python -m pip install --no-deps ./backend

Скопировать config/backend.env.example в защищённый файл, например
`/etc/event-registration/backend.env`, заполнить реальные значения и ограничить
чтение пользователем backend. Файл нельзя размещать в DocumentRoot, Git или
отправлять пользователям. Три secrets должны быть разными.

Если database/01_schema.sql уже выполнен, повторно применять его не нужно. Для
новой пустой БД выполнить database/00_create_database.sql, затем
database/01_schema.sql административной учётной записью MySQL.

Контрольный запуск API из установленного source package:

  cd /opt/event-registration
  EVENT_REGISTRATION_ENV_FILE=/etc/event-registration/backend.env \
    .venv/bin/event-api

Проверка на сервере:

  curl http://127.0.0.1:3000/health/live
  curl http://127.0.0.1:3000/health/ready

Email worker запускается отдельным процессом из того же каталога:

  EVENT_REGISTRATION_ENV_FILE=/etc/event-registration/backend.env \
    .venv/bin/event-email-worker

Первый SUPER_ADMIN создаётся после запуска HTTPS и API:

  EVENT_REGISTRATION_ENV_FILE=/etc/event-registration/backend.env \
    .venv/bin/event-bootstrap-admin \
    --email admin@example.org

Команда выдаёт одноразовую внешнюю HTTPS-ссылку для задания первого пароля.
Публичного bootstrap endpoint нет, пароль и raw token в базе не сохраняются.

Нельзя запускать `python backend/src/event_api/main.py`: файлы используют
корректные package-relative imports (`from .config ...`). Установка `./backend`
создаёт безопасные entry points выше и устраняет неоднозначность import paths.
`EVENT_REGISTRATION_ENV_FILE` однозначно указывает на закрытый конфигурационный
файл и не зависит от текущего рабочего каталога process manager.

Frontend:
- frontend/web скопировать в /var/www/event-registration/web;
- frontend/scanner скопировать в /var/www/event-registration/scanner;
- адаптировать Apache example под реальные HTTPS host names;
- внешний proxy должен направлять оба HTTPS host names на Apache :80 с
  сохранением Host.

Для production API и worker должны работать от непривилегированного пользователя
под process manager организации. В комплекте нет MySQL binaries, Docker,
systemd units, deployment/install scripts, паролей, TLS keys и secrets.
