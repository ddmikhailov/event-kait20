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

## Быстрая локальная демонстрация

Требуются Docker Desktop и Node.js 24:

    corepack enable
    pnpm install --frozen-lockfile
    pnpm demo:up

Команда запускает MySQL 8.1.0, API, Web/Admin, Scanner и worker, применяет
миграции и создаёт временные демонстрационные данные. Адреса и одноразовые
локальные пароли выводятся в терминал. Остановка: pnpm demo:down; полный
сброс локальных данных: pnpm demo:reset.

Подробности: docs/runbooks/local-demo.md.

## Проверка перед релизом

    pnpm install --frozen-lockfile
    pnpm format:check
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm build
    pnpm audit:dependencies

Python-тесты используют реальную одноразовую MySQL 8.1.0. Процедура приёмки:
docs/runbooks/mvp-acceptance.md.

## Развёртывание

Шаблон готового single-server контура находится в compose.production.yml,
а список переменных без секретов — в deploy/production.env.example.
Production-файл с секретами deploy/production.env исключён из Git.

Перед включением реальных участников организация обязана предоставить домены,
TLS/reverse proxy, юридически утверждённую ссылку согласия, SMTP-доступ,
резервное копирование и мониторинг. Пошаговая инструкция:
docs/15-deployment.md.

MySQL 8.1.0 оставлена точной целью по требованию существующего сервера. Это
завершившая жизненный цикл Innovation-ветка; риск отсутствия новых исправлений
MySQL должен компенсироваться изоляцией сети, ограничением доступа, backups и
решением владельца инфраструктуры.

## Документация

- AGENTS.md — обязательная инженерная политика;
- docs/01-product-spec.md — границы версии 1.0;
- docs/02-user-roles.md — роли и права;
- docs/04-architecture.md — архитектура;
- docs/06-database.md — схема и ограничения MySQL;
- docs/07-api-contracts.md — REST-контракты;
- docs/08-offline-sync.md — offline-протокол Scanner;
- docs/09-security.md — безопасность и персональные данные;
- docs/11-email.md — почта;
- docs/13-infrastructure.md — production-топология;
- docs/14-testing.md — проверки;
- docs/15-deployment.md — перенос на сервер и релиз;
- docs/19-mvp-release-status.md — фактический состав релиза;
- docs/adr/ — принятые архитектурные решения.
