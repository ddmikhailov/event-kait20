# Локальная демонстрация MVP без Docker

## Требования

- Node.js 24, Corepack и pnpm;
- Python ровно 3.12;
- backend-зависимости (`pnpm backend:install`);
- официальный MySQL ровно 8.1.0.

Укажите `MYSQL_HOME` на распакованный каталог MySQL 8.1.0. На Windows сценарий
также автоматически ищет test-only пакет в
`%LOCALAPPDATA%\event-registration-test\mysql-8.1.0-winx64`. Проверка:

```text
pnpm demo:doctor
```

Сценарий проверяет фактическую версию `mysqld`; совместимая, но другая версия
не принимается.

## Запуск

Из корня проекта:

```text
pnpm install --frozen-lockfile
pnpm backend:install
pnpm demo:up
```

Команда создаёт локальную БД под `.runtime/native-demo`, запускает MySQL только
на `127.0.0.1:3307`, применяет migrations, создаёт отдельного DB-пользователя и
демо-данные. Web и Scanner собираются в production-режиме и раздаются локальными
preview-серверами, поэтому manifest/service worker Scanner доступны без Docker.

Случайные пароли SUPER_ADMIN и SCANNER печатаются в терминал. Секреты находятся
только в игнорируемом `.demo.env`; пустой root-пароль используется исключительно
в момент первичной инициализации и сразу заменяется через одноразовый init-файл.

Адреса:

- Web и административная панель: `http://localhost:5173`;
- Scanner PWA: `http://localhost:5174`;
- API readiness: `http://localhost:3000/health/ready`;
- публичное demo-мероприятие: `http://localhost:5173/events/demo-event`.

Терминал запуска остаётся открытым и показывает журналы сервисов.

## Остановка и сброс

Нажмите `Ctrl+C` в терминале запуска или выполните из другого терминала:

```text
pnpm demo:down
```

Демонстрационная БД сохраняется. Полный сброс локальной БД и локальных секретов:

```text
pnpm demo:reset
```

Reset удаляет только проверенный каталог `.runtime/native-demo` и `.demo.env`.
Production-данные и другие экземпляры MySQL команда не затрагивает.

Фактическая отправка email без SMTP не выполняется: durable delivery intents и
worker можно демонстрировать локально, но внешний провайдер остаётся production
input.
