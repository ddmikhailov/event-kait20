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
- Apache проксирует same-origin `/api/` на loopback FastAPI;
- SQL package создаёт схему на уже предоставленном MySQL ровно 8.1.0;
- CLI bootstrap создаёт только одноразовую invitation с hashed token, а пароль
  SUPER_ADMIN задаётся через HTTPS browser activation;
- release archive содержит checksum manifest и не содержит runtime software,
  process-manager definitions, deployment scripts или secrets.

## Последствия

Организация отвечает за Apache/TLS, Python 3.12, MySQL 8.1.0, process manager,
SMTP, backups и monitoring. Приложение сохраняет прежние security boundaries и
не открывает публичный bootstrap endpoint. ADR-011 больше не определяет формат
поставки, но остаётся историческим описанием предыдущего решения.
