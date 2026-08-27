# 13. Production infrastructure

Статус: **Release 1.0 organisation-managed hosting contract**

## Целевая схема

```text
Internet
  └── Apache :443 (TLS)
      ├── compiled Web static files
      ├── compiled Scanner PWA static files
      └── /api proxy → Python 3.12 API → organisation-managed MySQL 8.1.0
                                      └── email worker → SMTP
```

Организация самостоятельно предоставляет Apache, TLS, Python 3.12, способ
управления процессами, MySQL и резервное копирование. Пакет приложения не
содержит MySQL binaries, Docker, systemd units и deployment/install scripts.
Публичны только HTTPS endpoints Apache; API слушает loopback, MySQL доступен
только доверенным application/migration hosts.

## Пакет приложения

Команда `pnpm release:sysadmin` создаёт проверяемый каталог и `.tar.gz` в
`.runtime/`. В него входят готовые static artifacts Web/Scanner, CPython 3.12
bytecode-only wheel без backend `.py` files,
точные runtime dependencies, конфигурационные примеры, Apache-пример, SQL
шаблон чистой базы, отдельные migrations и SHA-256 manifest. Секреты и реальные
credentials в пакет не входят.

Apache завершает TLS и проксирует same-origin `/api/` на loopback API. Это
сохраняет cookie, CSRF и exact-origin protections без wildcard CORS. TLS private
keys и итоговая Apache configuration остаются в зоне ответственности
организации.

## MySQL policy

- production target: ровно MySQL 8.1.0;
- staging и integration tests: ровно MySQL 8.1.0;
- migrations обязаны сохранять совместимость с MySQL 8.1.0;
- application package не устанавливает и не обновляет MySQL;
- runtime user имеет только DML-права, DDL выполняет отдельный migration user;
- root credential не находится в конфигурации приложения.

## Эксплуатационные обязанности организации

Организация выбирает process manager и отвечает за restart, least privilege,
защищённое хранение env/secrets, журналирование без PII, MySQL backups,
off-host recovery copy, monitoring `/health/live` и `/health/ready`, SMTP и
обновление TLS certificates. Внутренние reference-материалы старого native
варианта не являются частью поставляемого sysadmin package.
