# Event Registration System 1.0

Готовая система регистрации и контроля посещаемости мероприятий КАИТ №20.

Статус: **Release 1.0**  
Дата релиза: **26 августа 2026**  
Production-совместимость: **Python 3.12, Node.js 24, MySQL 8.1.0**

## Возможности

- публичная регистрация с настраиваемой формой, согласием и контролем вместимости;
- индивидуальный билет и QR без персональных данных внутри кода;
- кабинет SUPER_ADMIN: мероприятия, участники, сотрудники, импорт/экспорт XLSX и статистика;
- отдельная Scanner PWA с назначением доступа по мероприятиям, online/offline-проверкой и синхронизацией;
- безопасные приглашения, восстановление пароля и серверные сессии;
- email-worker с durable delivery, ограниченными повторами и SMTP;
- исторически безопасная MySQL-схема, audit log и идемпотентность посещений.

Участник не создаёт аккаунт. Роли версии 1.0: SUPER_ADMIN и SCANNER.

## Быстрая локальная демонстрация без Docker

Требуются Node.js 24, Python 3.12 и официальный MySQL ровно 8.1.0. Переменная
`MYSQL_HOME` должна указывать на распакованный каталог MySQL; на Windows также
автоматически проверяется ранее установленный test-only пакет в `%LOCALAPPDATA%`.

    corepack enable
    pnpm install --frozen-lockfile
    pnpm backend:install
    pnpm demo:doctor
    pnpm demo:up

Команда нативно запускает MySQL, API, Web/Admin, Scanner PWA и worker, применяет
миграции и создаёт демонстрационные данные. Терминал нужно оставить открытым;
остановка — `Ctrl+C` или `pnpm demo:down`, полный сброс — `pnpm demo:reset`.

Подробности: `docs/runbooks/local-demo.md`.

## Проверка перед релизом

    pnpm install --frozen-lockfile
    pnpm format:check
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm build
    pnpm audit:dependencies

Python-тесты используют реальную одноразовую MySQL 8.1.0. Процедура приёмки:
`docs/runbooks/mvp-acceptance.md`.

## Развёртывание без Docker

Production-шаблоны находятся в `deploy/systemd`, `deploy/nginx` и
`deploy/mysql`; список переменных без секретов — в `deploy/native.env.example`.
API и worker работают как изолированные systemd-службы, Web/Scanner раздаются
Nginx, а MySQL 8.1.0 слушает только loopback. Пошаговая инструкция:
`docs/15-deployment.md`.

Конфигурация проверяется и безопасно преобразуется в готовые шаблоны командами:

    pnpm deploy:check -- --env /etc/event-registration/event-registration.env --check-files
    pnpm deploy:render -- --env /etc/event-registration/event-registration.env --output /root/event-registration-rendered --check-files

Нативные скрипты поддерживают первичную установку шаблонов, неизменяемые релизы
по полному Git SHA, атомарный rollback application-кода и ежедневные потоковые
зашифрованные backup. Они не устанавливают Docker и не обновляют MySQL.

Перед включением реальных участников организация обязана предоставить домены,
TLS, юридически утверждённую ссылку согласия, SMTP-доступ, резервное копирование
и мониторинг.

MySQL 8.1.0 оставлена точной целью по требованию существующего сервера. Это
завершившая жизненный цикл Innovation-ветка; риск отсутствия новых исправлений
компенсируется сетевой изоляцией, минимальными правами, backups и формальным
решением владельца инфраструктуры.

## Документация

- `AGENTS.md` — обязательная инженерная политика;
- `docs/01-product-spec.md` — границы версии 1.0;
- `docs/04-architecture.md` — архитектура;
- `docs/06-database.md` — схема и ограничения MySQL;
- `docs/09-security.md` — безопасность и персональные данные;
- `docs/13-infrastructure.md` — production-топология;
- `docs/14-testing.md` — проверки;
- `docs/15-deployment.md` — перенос на сервер и релиз;
- `docs/19-mvp-release-status.md` — фактический состав релиза;
- `docs/adr/` — принятые архитектурные решения.
