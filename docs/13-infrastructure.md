# 13. Production Infrastructure

Статус: **Release 1.0 organisation-managed hosting contract**  
Дата актуализации: **27 августа 2026**

## Целевая схема

```text
Internet
  -> organisation HTTPS reverse proxy :443
  -> Apache HTTP :80 (private/trusted network only)
       |-- compiled Web static files
       |-- compiled Scanner PWA static files
       `-- /api/ -> Python 3.12 FastAPI 127.0.0.1:3000
                       |-- MySQL 8.1.0
                       `-- email worker -> SMTP STARTTLS
```

Внешний reverse proxy завершает TLS. Apache не завершает пользовательский TLS и
не имеет прямого публичного доступа. Firewall/ACL разрешает Apache :80 только с
адресов доверенного proxy. FastAPI слушает loopback.

Proxy сохраняет public `Host` и `Origin`, передаёт Cookie/Set-Cookie без
изменения и не разрешает внешний HTTP. Apache выставляет backend
`X-Forwarded-Proto: https`. Все browser-facing origins и links в конфигурации
остаются HTTPS.

Trusted proxy chain удаляет пользовательские spoofed forwarding headers и сам
устанавливает корректный client IP. FastAPI не должен доверять forwarded headers
от любого публичного источника; единственный непосредственный peer API —
loopback Apache.

## Application package

Основной воспроизводимый комплект:

```text
pnpm release:sysadmin
```

Он содержит:

- compiled Web and Scanner static artifacts с API base `/api`;
- CPython 3.12 bytecode-only wheel без backend `.py`;
- exact runtime requirements;
- защищённый env template без реальных secrets;
- Apache internal HTTP example;
- SQL new-database template и отдельные migrations;
- `MANIFEST.json` с source SHA и SHA-256 файлов.

Если правила организации требуют backend sources:

```text
pnpm release:sysadmin-source
```

Этот вариант заменяет wheel на устанавливаемый Python source package. Сетевая,
конфигурационная и security topology у двух комплектов одинакова.

В поставку не входят MySQL binaries, Docker, systemd units, Nginx, process
manager definitions, deployment/install scripts, TLS keys, passwords и secrets.

## Runtime ownership

Организация предоставляет и сопровождает:

- внешний HTTPS reverse proxy, DNS и certificates;
- Apache и закрытый доступ к его HTTP :80;
- CPython ровно 3.12 и выбранный process manager;
- MySQL ровно 8.1.0;
- SMTP STARTTLS credential и sender;
- protected configuration storage;
- backup/restore, monitoring, alert delivery и rollback procedure.

Приложение не устанавливает и не обновляет это runtime software.

## MySQL policy

- production и staging target: ровно MySQL 8.1.0;
- integration tests: ровно MySQL 8.1.0;
- migrations совместимы с MySQL 8.1.0;
- application user `event_app` получает только DML-права;
- schema operations выполняются отдельным controlled account;
- MySQL не публикуется пользователям/в Интернет;
- для отдельного DB host разрешается только адрес backend-сервера;
- root credential не используется приложением.

Версия 8.1.0 завершила lifecycle, но зафиксирована владельцем для существующего
сервера. Компенсирующие controls: сетевой allowlist, минимальные права,
monitoring, encrypted backup и проверяемое восстановление.

## Protected configuration

Application configuration хранится, например, в:

```text
/etc/event-registration/backend.env
```

Process manager передаёт только путь:

```text
EVENT_REGISTRATION_ENV_FILE=/etc/event-registration/backend.env
```

Файл находится вне Git и Apache DocumentRoot, не передаётся в release archive и
доступен только runtime identity backend. `DATABASE_URL` может указывать на
локальный или отдельный MySQL host; MySQL grant должен соответствовать реальному
source IP/hostname backend-сервера.

## Health and operations

- `/health/live` подтверждает работу процесса;
- `/health/ready` дополнительно проверяет MySQL;
- снаружи endpoints доступны как `/api/health/live` и `/api/health/ready`;
- мониторинг email queue, disk, MySQL, TLS, backup age и process restart реализует
  организация выбранными средствами;
- application logs не содержат auth bodies, cookies, raw tokens или unnecessary
  PII.

Исторические native Nginx/systemd материалы ADR-011 не являются текущей
production topology и не входят в sysadmin package.
