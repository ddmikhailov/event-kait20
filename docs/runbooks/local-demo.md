# Локальная демонстрация MVP

## Требования

- Windows с включённой аппаратной виртуализацией;
- WSL 2 и Virtual Machine Platform;
- Docker Desktop с Linux containers;
- Node.js 24, Corepack и pnpm.

## Запуск

Из корня проекта:

```text
pnpm install --frozen-lockfile
pnpm demo:up
```

Первый запуск скачивает MySQL 8.1.0 и базовые образы, поэтому занимает больше
времени. Команда ожидает готовности сервисов и печатает случайно созданные
пароли для SUPER_ADMIN и SCANNER. Секреты хранятся только в локальном
игнорируемом `.demo.env`.

Адреса:

- Web и административная панель: `http://localhost:5173`;
- Scanner PWA: `http://localhost:5174`;
- API readiness: `http://localhost:3000/health/ready`;
- публичное demo-мероприятие: `http://localhost:5173/events/demo-event`.

В панели SUPER_ADMIN доступны управление событиями и полями, участниками,
персоналом, Excel и статистикой. SCANNER уже назначен на демонстрационное
мероприятие. Публичная регистрация позволяет создать синтетического участника,
после чего билет и посещение можно проверить через Scanner.

## Остановка и сброс

```text
pnpm demo:down
pnpm demo:reset
```

`demo:down` останавливает контейнеры и сохраняет демонстрационную БД.
`demo:reset` удаляет только Docker volume этого demo-контура. Для полностью
новых паролей после reset также удалите локальный `.demo.env`; production или
другие Docker-проекты эти команды не затрагивают.

Фактическая отправка email не выполняется: durable delivery intents и worker
можно демонстрировать локально, но подключение внешнего почтового провайдера
остаётся production gate.
