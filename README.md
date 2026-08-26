# Event Registration System — документация проекта

Статус: **Documentation v0.2 — Codex Ready Baseline**  
Дата фиксации: **21 августа 2026**  
Организация: **КАИТ №20**  
Рабочее название: **Event Registration System**

Этот каталог — источник продуктовой и архитектурной истины проекта до и во время разработки.

## Порядок чтения

1. `AGENTS.md` — обязательные правила для Codex/разработчиков.
2. `docs/00-project-overview.md` — краткое описание проекта.
3. `docs/01-product-spec.md` — границы MVP.
4. `docs/02-user-roles.md` — роли и права.
5. `docs/03-user-flows.md` — ключевые сценарии.
6. `docs/04-architecture.md` — системная архитектура.
7. `docs/05-domain-model.md` — предметная модель.
8. `docs/06-database.md` — финальная MySQL DB baseline.
9. `docs/07-api-contracts.md` — API baseline v1.
10. `docs/08-offline-sync.md` — offline-first scanner protocol.
11. `docs/09-security.md` — security baseline.
12. `docs/10-ui-design-system.md` — UI и фирменный стиль КАИТ №20.
13. `docs/11-email.md` — почтовые сценарии.
14. `docs/12-excel-import-export.md` — импорт/экспорт XLSX.
15. `docs/13-infrastructure.md` — Yandex Cloud.
16. `docs/14-testing.md` — стратегия тестирования.
17. `docs/15-deployment.md` — staging/production и выкладка.
18. `docs/16-roadmap.md` — MVP и дальнейшие версии.
19. `docs/17-engineering-review.md` — решения engineering review v0.2.
20. `docs/18-codex-workflow.md` — способ разработки через Codex.
21. `docs/19-mvp-release-status.md` — фактическая готовность release candidate и внешние production gates.
22. `docs/adr/` — Architecture Decision Records.

## Зафиксированные фундаментальные решения

- Российское размещение: Yandex Cloud.
- Основная БД: MySQL 8.1.0, не Google Sheets/Яндекс Таблицы.
- Backend: Python 3.12 + FastAPI modular monolith.
- Web/Admin: React + Vite.
- Scanner: отдельное React/Vite PWA; App Store/Google Play не являются целью проекта.
- Участнику личный кабинет в MVP не нужен.
- QR индивидуален для Registration конкретного Event.
- Персональные данные не кодируются в QR в открытом виде.
- Offline scanner входит в MVP.
- Offline гарантирует работу с заранее загруженными Registration и attendance; создание нового onsite-участника требует online.
- Excel используется как импорт/экспорт, но не как источник истины.
- Массовые email-рассылки — обязательный backlog версии 2.0.
- Staging и production раздельны.

## Статус документации

MVP engineering baseline реализован последовательными feature milestones.
Актуальная матрица готовности и оставшиеся внешние решения зафиксированы в
`docs/19-mvp-release-status.md`.

До production дополнительно закрываются provider-specific deployment details,
юридическая ссылка согласия, домен, email provider, staging acceptance и
финальный security review.
