# ADR-012 — Organisation-managed sysadmin package

Статус: **Accepted**  
Дата: 2026-08-27

## Контекст

Системный администратор организации предоставляет собственные Apache, MySQL и
управление процессами. Ему нужны только готовые frontend/backend artifacts,
конфигурация подключения к базе и SQL template. MySQL binaries, systemd units и
deployment scripts в поставке запрещены. Пароль первой административной
учётной записи должен задаваться самим администратором при первом входе.

## Решение

- Web и Scanner поставляются скомпилированными static artifacts для Apache;
- backend поставляется как CPython 3.12 bytecode-only wheel без application
  `.py` sources и с exact dependency list;
- внешний reverse proxy организации завершает HTTPS и передаёт трафик на
  закрытый Apache HTTP :80; Apache проксирует same-origin `/api/` на loopback
  FastAPI;
- SQL package создаёт схему на уже предоставленном MySQL ровно 8.1.0;
- CLI bootstrap создаёт только одноразовую invitation с hashed token, а пароль
  SUPER_ADMIN задаётся через HTTPS browser activation;
- release archive содержит checksum manifest и не содержит runtime software,
  process-manager definitions, deployment scripts или secrets.
- compiled wheel является основным backend artifact; дополнительный
  source-backend archive допускается по прямому требованию организации;
- оба варианта используют `EVENT_REGISTRATION_ENV_FILE` и одинаковую proxy/
  security topology.

## Последствия

Организация отвечает за внешний HTTPS proxy, закрытый Apache HTTP, Python 3.12,
MySQL 8.1.0, process manager, SMTP, backups и monitoring. Приложение сохраняет
security boundaries и не открывает публичный bootstrap endpoint. ADR-001 и
ADR-011 больше не определяют production topology Release 1.0.
