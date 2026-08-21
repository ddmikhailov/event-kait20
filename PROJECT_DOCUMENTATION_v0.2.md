# PROJECT DOCUMENTATION v0.2 — Event Registration System

Сводная версия. Каноническими остаются отдельные файлы рядом с этим документом.



---

<!-- SOURCE: README.md -->

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
8. `docs/06-database.md` — финальная DB baseline перед Prisma.
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
21. `docs/adr/` — Architecture Decision Records.

## Зафиксированные фундаментальные решения

- Российское размещение: Yandex Cloud.
- Основная БД: PostgreSQL, не Google Sheets/Яндекс Таблицы.
- Backend: NestJS modular monolith.
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

Product scope, roles, architecture, domain baseline, database baseline, API surface, offline protocol и Codex rules готовы к scaffold проекта.

До production дополнительно закрываются provider-specific deployment details, юридическая ссылка согласия, домен, email provider и финальный security review.


---

<!-- SOURCE: AGENTS.md -->

# AGENTS.md — Event Registration System

This file is the root engineering policy for Codex and all contributors.

## 1. Read before changing code

For any non-trivial task, read the relevant files in `docs/`. Start with:
- `docs/01-product-spec.md`
- `docs/02-user-roles.md`
- `docs/04-architecture.md`
- `docs/05-domain-model.md`
- `docs/06-database.md`
- `docs/07-api-contracts.md`
- `docs/08-offline-sync.md` for scanner/offline work
- `docs/09-security.md` for auth/PII/QR/import work
- `docs/10-ui-design-system.md` for UI

If code and documentation conflict, do not guess. Treat approved product/ADR docs as the intended behavior and surface the conflict in the handoff; update docs in the same change when the task explicitly changes behavior.

## 2. Product boundaries

MVP facts that must not be silently changed:
- Participant has no account/dashboard.
- Staff roles in MVP: `SUPER_ADMIN`, `SCANNER`; `EVENT_ADMIN` is future.
- Only SUPER_ADMIN creates Events.
- QR is unique per Registration/Event and contains no plaintext PII.
- Scanner is an installable PWA. Do not introduce App Store/Google Play release work.
- PostgreSQL is the source of truth; spreadsheets are import/export only.
- Infrastructure target is Yandex Cloud.
- Scanner offline mode is required for prepared registrations/attendance.
- Brand-new onsite Registration is online-only in MVP.
- SCANNER cannot overbook capacity; SUPER_ADMIN may explicitly override and must be audited.
- Version 2.0 committed feature: mass Event email broadcasts. Do not pull it into MVP unless asked.

## 3. Architecture boundaries

Current stack:
- TypeScript monorepo, pnpm workspaces + Turborepo
- `apps/web`: React + Vite
- `apps/scanner`: React + Vite PWA
- `apps/api`: NestJS modular monolith
- `apps/email-worker`: background email processing
- PostgreSQL + Prisma
- shared Zod contracts
- Dexie/IndexedDB in scanner
- Yandex Cloud + Terraform

Do not introduce Next.js, GraphQL, microservices, Kubernetes, Supabase/Firebase or a second primary database without an explicit ADR/owner decision.

## 4. Domain invariants

Preserve these in DB constraints and tests where possible:
- `Person != Registration != StaffUser`.
- Registration stores a participant snapshot; editing Person must not rewrite history.
- One ACTIVE Registration per `(event_id, person_id)`.
- Capacity counts ACTIVE registrations only.
- FIO alone never auto-merges Person.
- Attendance is event-based and idempotent by `client_event_id`.
- First valid attendance time remains the primary `first_attended_at`.
- Email failure never rolls back a committed Registration.
- Offline bundle refresh must never delete unsynced attendance.

## 5. Security rules

- Never commit secrets or real credentials.
- Never put secrets in browser bundles.
- Do not log passwords, session/reset/invitation tokens, full QR payloads, registration request bodies, or unnecessary PII.
- Staff authorization is server-side for every protected endpoint.
- Use least privilege for service accounts and DB access.
- Passwords: Argon2id; sessions/tokens stored as hashes server-side.
- QR signing secret stays server-side.
- XLSX input is untrusted; validate and neutralize spreadsheet formula injection on export.
- Do not weaken CSP/CORS/CSRF/session protections to make a test pass.

## 6. Database/migrations

- All schema changes require a migration and relevant docs/contracts update.
- Do not use destructive production migrations without an explicit migration/rollback plan.
- Business history uses archive/annul/deactivate rather than hard delete.
- If Prisma cannot express a required PostgreSQL invariant (e.g. partial unique index), use a reviewed SQL migration rather than dropping the invariant.

## 7. API/contracts

- Define request/response schemas in shared `packages/contracts` before or with endpoint implementation.
- Clients must branch on stable machine-readable error codes, not message text.
- Do not expose extra PII because it is convenient for frontend development.
- Pagination/filter limits must be bounded.

## 8. Scanner/offline

- IndexedDB writes for bundle replacement and pending events must be transactional.
- Generate `client_event_id` before network send and persist it.
- On reconnect, sync pending attendance before replacing stale bundle data.
- Logout clears cached business data.
- App/service-worker updates must preserve pending attendance.
- Do not claim true offline revocation/security that browsers cannot provide; follow the documented lifecycle controls.

## 9. UI

Follow `docs/10-ui-design-system.md`:
- Montserrat typography
- white space, clear grid, blue-violet-purple brand axis
- official logo asset only; never redraw it
- scanner prioritizes speed/contrast over decoration
- accessible labels, focus states, keyboard behavior for admin forms

Do not add decorative complexity that harms registration speed or scanner readability.

## 10. Testing / Definition of Done

Every feature must have tests appropriate to its risk. At minimum before handoff:
- relevant unit/integration/API/E2E tests pass;
- lint passes;
- typecheck passes;
- no known authorization bypass;
- docs updated when behavior changed.

Critical concurrency/offline/security invariants require regression tests, not manual confidence.

Until repository scripts are scaffolded, do not invent command names. After scaffold, update this section with canonical commands (`pnpm ...`) from root `package.json`.

## 11. Dependencies

Prefer existing dependencies. Adding a dependency requires a clear reason and must not duplicate an existing capability. Avoid large framework changes for a small feature.

## 12. Working style

- Inspect before editing.
- Keep changes scoped to the task.
- Do not refactor unrelated areas opportunistically.
- Do not silently change product semantics.
- Do not delete failing tests to achieve green status.
- For ambiguous non-critical implementation details, choose the simplest option consistent with docs and mention it in handoff.
- For product/permission/privacy ambiguity, stop changing semantics and surface the issue.

## 13. Handoff format

At the end of a task report:
1. What changed.
2. Key files.
3. Tests/checks run and result.
4. Migrations/config changes.
5. Risks or follow-ups.

Keep handoffs concise and factual.


---

<!-- SOURCE: docs/00-project-overview.md -->

# 00. Project Overview

Статус: **Approved for MVP v1**

## 1. Проблема

Регистрация участников мероприятий сейчас выполняется разрозненно и часто вручную: участник подходит к стойке, сообщает ФИО/телефон, сотрудник ищет его в списке и вручную отмечает присутствие. При большом потоке это медленно и неудобно.

## 2. Цель

Создать централизованную систему, которая позволяет:

- создавать мероприятие и его регистрационную форму;
- собирать регистрации участников;
- автоматически генерировать персональный QR на конкретное мероприятие;
- отправлять QR участнику по email;
- сканировать QR на входе;
- фиксировать факт и время посещения;
- работать нескольким сканерам одновременно;
- продолжать сканирование при нестабильном интернете;
- вести статистику, импорт и экспорт Excel.

## 3. Пользовательский контур

Система состоит из трёх интерфейсов:

1. **Public Web** — страница мероприятия и регистрационная форма.
2. **Admin Web** — создание мероприятия, участники, импорт/экспорт, статистика и управление доступом.
3. **Scanner PWA** — мобильное сканирование online/offline.

Все интерфейсы используют единый backend и PostgreSQL.

## 4. Типичная нагрузка

- обычно: 100–150 участников на мероприятие;
- ожидаемый максимум MVP: до 1000 участников на мероприятие;
- мероприятия потенциально проводятся примерно раз в неделю;
- на одном мероприятии могут одновременно работать несколько сканеров.

## 5. Основной критерий успеха

На реальном мероприятии сотрудник должен быстро сканировать поток участников без ручного поиска по бумажным спискам, а SUPER_ADMIN должен сразу получать корректный список пришедших и статистику.


---

<!-- SOURCE: docs/01-product-spec.md -->

# 01. Product Specification — MVP v1

Статус: **Approved**

## 1. Публичная регистрация

Участник получает ссылку на мероприятие, видит его информацию и заполняет форму. Личный кабинет участника отсутствует.

Системные поля формы:

- фамилия;
- имя;
- отчество;
- email;
- телефон;
- учебная группа;
- статус участника;
- дата рождения;
- организация — условное системное поле.

Для публичной регистрации email обязателен. Телефон — российский номер. Для преподавателя учебная группа может быть скрыта, для студента — обязательна.

Возможные статусы:

- студент КАИТ №20;
- преподаватель КАИТ №20;
- студент другой образовательной организации;
- преподаватель другой образовательной организации.

Если выбран участник КАИТ №20, организация устанавливается автоматически. Для внешнего участника появляется обязательное поле образовательной организации.

## 2. Дополнительные вопросы

SUPER_ADMIN может добавить к конкретному мероприятию вопросы типов:

- короткий текст;
- длинный текст;
- одиночный выбор;
- множественный выбор;
- да/нет.

Загрузка файлов и специализированный числовой тип в MVP не нужны.

## 3. Согласие на обработку персональных данных

Перед отправкой формы обязателен checkbox согласия со ссылкой на юридический текст колледжа. Система должна фиксировать факт и время согласия, а также ссылку/версию текста.

## 4. Мероприятие

Поля:

- название;
- описание;
- дата;
- время начала;
- время окончания;
- место;
- обложка;
- дедлайн регистрации;
- лимит мест;
- статус.

Только SUPER_ADMIN создаёт мероприятия в MVP.

Многодневные программы моделируются отдельными событиями: «День 1», «День 2» и т. п.

## 5. Capacity

При заполнении лимита публичные регистрации прекращаются. Контроль выполняется транзакционно на сервере.

Импортированные через Excel участники также занимают места.

SUPER_ADMIN может изменить лимит и вручную добавить человека сверх лимита после предупреждения.

## 6. QR и билет

Каждая регистрация получает отдельный QR. Один человек может иметь разные QR на разных мероприятиях.

QR не содержит ФИО, телефона, email или других персональных данных в открытом виде.

После регистрации участник получает email с QR и кнопкой «Открыть билет». Страница билета содержит название мероприятия, ФИО, дату, время, место и крупный QR.

## 7. Посещение

Scanner показывает:

- ФИО;
- группу;
- статус;
- организацию;
- телефон.

Есть два режима:

- ручное подтверждение после сканирования;
- быстрый режим с автоматической фиксацией.

Повторное сканирование не создаёт новое основное посещение и показывает время первого входа.

## 8. Ручной поиск

SCANNER может искать участника по:

- ФИО;
- телефону;
- email;
- группе.

## 9. Регистрация на месте

SUPER_ADMIN и SCANNER могут создать участника на месте. Для служебной регистрации email может отсутствовать. Создание новой onsite-регистрации в MVP выполняется только при наличии соединения с API: сервер должен проверить дедупликацию и capacity.

Если capacity заполнен, SCANNER не может создать запись сверх лимита. SUPER_ADMIN может увеличить capacity либо явно выполнить административное добавление сверх лимита.

Доступны действия:

- зарегистрировать;
- зарегистрировать и сразу отметить присутствие.

## 10. Excel

MVP поддерживает:

- импорт `.xlsx` внутрь выбранного мероприятия;
- preview до записи;
- выявление ошибок и дублей;
- экспорт `.xlsx`;
- кнопку массовой отправки QR после импорта;
- повторную отправку письма одному участнику.

## 11. Общая база участников

SUPER_ADMIN имеет доступ к простому глобальному каталогу Person: поиск по ФИО, email, телефону и группе; карточка Person показывает актуальные данные и историю регистраций по мероприятиям. Исторические Registration snapshots при редактировании Person не переписываются.

## 12. Статистика

Минимум:

- лимит;
- зарегистрировано;
- свободно;
- пришло;
- не пришло;
- процент посещаемости;
- динамика прихода по времени.

## 13. Хранение

Серверные данные автоматически не удаляются. Завершённые мероприятия архивируются. Удаление регистраций из обычного интерфейса — мягкое (soft delete/annulment) с сохранением истории.

## 14. Не входит в MVP

- личный кабинет участника;
- самостоятельная отмена регистрации;
- самостоятельное редактирование регистрации;
- App Store/Google Play приложение;
- массовые информационные рассылки;
- автоматические напоминания;
- загрузка файлов;
- проверка личности;
- waitlist;
- EVENT_ADMIN как обязательная роль.


---

<!-- SOURCE: docs/02-user-roles.md -->

# 02. User Roles & Permissions

Статус: **Approved for MVP**

## 1. Participant

Не имеет аккаунта.

Может:
- открыть публичную страницу;
- зарегистрироваться;
- получить email и QR;
- открыть билет.

Не может:
- видеть других участников;
- смотреть базу;
- самостоятельно редактировать или отменять регистрацию;
- входить в служебную часть.

## 2. SUPER_ADMIN

В MVP — основной администратор всей системы.

Может:
- создавать и редактировать мероприятия;
- управлять формой;
- менять capacity;
- добавлять человека сверх лимита;
- редактировать данные участников;
- аннулировать регистрацию;
- импортировать/экспортировать Excel;
- отправлять и повторно отправлять QR;
- назначать SCANNER;
- вручную отмечать посещение;
- регистрировать на месте;
- видеть статистику;
- просматривать компактный audit log;
- видеть архив мероприятий;
- просматривать глобальный каталог Person и историю регистраций.

## 3. SCANNER

Получает доступ только к назначенным мероприятиям.

Может:
- открыть scanner;
- скачать offline bundle;
- сканировать QR;
- видеть разрешённые данные участника;
- подтверждать посещение;
- использовать быстрый режим;
- искать участника вручную;
- видеть список участников своего мероприятия;
- регистрировать участника на месте при наличии internet/API;
- синхронизировать offline-отметки.

Не может:
- создавать onsite-регистрацию полностью offline;
- обходить capacity или добавлять сверх лимита;
- создавать мероприятия;
- менять настройки события;
- менять capacity;
- назначать сотрудников;
- видеть не назначенные мероприятия.

## 4. EVENT_ADMIN — future

Не входит в обязательный MVP. Архитектура должна позволить добавить роль без перестройки модели доступа.

Планируемые права:
- управлять назначенным мероприятием;
- редактировать информацию о нём;
- управлять участниками;
- смотреть статистику;
- экспортировать Excel;
- назначать сканеров.

Создание новых мероприятий остаётся правом SUPER_ADMIN.


---

<!-- SOURCE: docs/03-user-flows.md -->

# 03. User Flows

Статус: **Approved core flows**

## Flow A — публичная регистрация

1. Участник получает ссылку.
2. Открывает страницу мероприятия.
3. Видит название, описание, дату, время и место.
4. Заполняет системные и дополнительные поля.
5. Ставит checkbox согласия на обработку ПД.
6. Отправляет форму.
7. Backend проверяет deadline, статус события и capacity.
8. Выполняется дедупликация Person.
9. Создаётся или переиспользуется Person.
10. Создаётся Registration на конкретный Event.
11. Создаётся QR-билет.
12. Email ставится в очередь.
13. Участник видит экран успеха.
14. Письмо содержит QR и кнопку открытия билета.

## Flow B — повторная регистрация

1. Человек повторно отправляет форму на то же мероприятие.
2. Система уверенно сопоставляет Person.
3. Существующая активная Registration обнаруживается.
4. Новая запись Registration не создаётся.
5. При допустимом сценарии актуализируются корректируемые поля.
6. Билет повторно ставится в email-очередь.

## Flow C — ручное сканирование

1. Сотрудник входит.
2. Выбирает назначенное мероприятие.
3. PWA подготавливает offline bundle.
4. Сотрудник открывает камеру.
5. Сканирует QR.
6. Система находит Registration.
7. Показывает разрешённые данные.
8. Сотрудник нажимает «Подтвердить посещение».
9. AttendanceEvent сохраняется online либо в локальную очередь.
10. Показывается крупный SUCCESS.

## Flow D — быстрый scanner

1. Сотрудник включает fast mode.
2. Каждый валидный QR автоматически фиксирует посещение.
3. Экран кратко показывает SUCCESS / ALREADY ATTENDED / INVALID.
4. Scanner сразу готов к следующему QR.

## Flow E — повторное сканирование

1. QR уже посещавшего участника сканируется снова.
2. Основное посещение не дублируется.
3. Scanner показывает «Уже зарегистрирован» и время первого посещения.
4. Техническое повторное событие может сохраняться для диагностики.

## Flow F — ручной поиск

1. Сотрудник открывает список/поиск.
2. Ищет по ФИО, телефону, email или группе.
3. Открывает найденную регистрацию.
4. Подтверждает посещение вручную.

## Flow G — регистрация на месте

1. SCANNER/SUPER_ADMIN нажимает «Добавить участника».
2. Этот flow требует online-доступа к API.
3. Заполняются основные поля; email допускается пустым.
4. Backend выполняет deduplication и проверяет capacity.
5. SCANNER при заполненном capacity получает `CAPACITY_FULL` и не может его обойти.
6. SUPER_ADMIN может предварительно увеличить capacity либо выполнить явный administrative override.
7. Система создаёт Person/Registration.
8. Можно сразу отметить присутствие.

## Flow H — Excel import

1. SUPER_ADMIN выбирает мероприятие.
2. Загружает `.xlsx`.
3. Система разбирает строки и предлагает mapping колонок.
4. Показывает preview: новые, существующие, сомнительные, ошибки.
5. Администратор подтверждает.
6. Участники записываются и занимают capacity.
7. После импорта доступна отдельная кнопка «Отправить QR участникам».

## Flow I — offline sync

1. Scanner теряет интернет.
2. QR проверяются по IndexedDB.
3. AttendanceEvent сохраняются локально с UUID.
4. PWA показывает количество ожидающих синхронизации событий.
5. Интернет появляется.
6. Сначала отправляются pending attendance.
7. После подтверждения удаляются локальные pending records.
8. Затем проверяется версия offline bundle и при необходимости скачивается новая.


---

<!-- SOURCE: docs/04-architecture.md -->

# 04. System Architecture

Статус: **Approved high-level architecture**

## 1. Архитектурный стиль

Используется **модульный монолит** для backend, а не микросервисы.

Причины:
- нагрузка MVP умеренная;
- единая предметная модель;
- проще транзакции регистрации/capacity;
- проще разработка и сопровождение;
- проще параллельная работа Codex по доменным модулям.

Отдельно выносится только email worker/background processing. Надёжная постановка email после business commit должна использовать idempotent delivery/outbox-equivalent boundary, чтобы сбой между DB commit и queue publish не терял письмо.

## 2. Приложения

### `apps/web`
React + Vite.

Содержит:
- public registration;
- ticket page;
- admin web.

### `apps/scanner`
Отдельное React + Vite PWA.

Причина разделения — собственный service worker, offline storage, lifecycle камеры и синхронизация.

### `apps/api`
NestJS backend.

Модули:
- auth;
- people;
- events;
- forms;
- registrations;
- attendance;
- staff;
- imports;
- statistics;
- audit.

### `apps/email-worker`
Получает задачи отправки писем из очереди.

## 3. Общая схема

```text
Public/Admin Web ─┐
Scanner PWA ──────┼── HTTPS ──> NestJS API ──> PostgreSQL
                  │                  │
                  │                  ├──> Object Storage
                  │                  └──> Message Queue ──> Email Worker ──> SMTP/API
                  │
                  └── Scanner local: IndexedDB/Dexie
```

## 4. Технологический стек

Предварительно зафиксирован:

- TypeScript;
- pnpm workspaces;
- Turborepo;
- React + Vite;
- Tailwind CSS + собственная design system;
- NestJS;
- Zod;
- PostgreSQL;
- Prisma;
- Dexie/IndexedDB;
- TanStack Query;
- React Hook Form;
- Terraform;
- GitHub Actions;
- Yandex Cloud.

Версии пакетов фиксируются lockfile и обновляются только контролируемо. Shared Zod request/response schemas живут в `packages/contracts`; API и клиенты не поддерживают параллельные самодельные типы одного контракта.

## 5. Backend доступ к БД

Frontend и Scanner не получают прямой доступ к PostgreSQL. Вся работа идёт через API и server-side authorization.

## 6. Staging и Production

Два независимых окружения с отдельными БД и секретами. Staging используется для тестовых мероприятий, миграций и проверки offline/email.


---

<!-- SOURCE: docs/05-domain-model.md -->

# 05. Domain Model

Статус: **Approved core model — v0.2**

## 1. Базовые сущности

### Person
Реальный человек в общей базе. Один Person может участвовать в нескольких мероприятиях.

### Event
Отдельное мероприятие/день мероприятия.

### EventFormField
Дополнительный вопрос конкретного Event.

### Registration
Связь Person с конкретным Event. Хранит snapshot базовых персональных данных на момент регистрации и отдельный QR.

### RegistrationAnswer
Ответ Registration на конкретный EventFormField. Ответы вынесены из Registration, чтобы изменение формы не превращало исторические данные в бесструктурный JSON.

### AttendanceEvent
Факт/попытка отметки посещения. Модель событийная, а не boolean-only.

### StaffUser
Служебный аккаунт сотрудника.

### EventAccess
Права сотрудника на конкретное мероприятие.

## 2. Person ≠ Registration ≠ StaffUser

Преподаватель может быть Person/Participant одного события и StaffUser/Scanner другого.

## 3. Registration snapshot

Registration повторяет ключевые поля Person на момент участия:

- ФИО;
- дата рождения;
- email;
- телефон;
- группа;
- тип участника;
- организация.

Это сохраняет исторически корректный отчёт, даже если Person позже поменял группу или контактные данные.

## 4. QR

QR принадлежит Registration, а не Person. Для каждого Event — отдельный QR. Payload состоит из случайного `public_id` Registration и серверной подписи. Персональные данные в payload не помещаются.

## 5. Дедупликация

Автоматическое объединение только по ФИО запрещено.

Для публичной/onsite регистрации сильным совпадением считается одно из условий при совпадающем нормализованном ФИО:

1. тот же `email_normalized`;
2. тот же `phone_normalized`;
3. та же дата рождения.

Если сильные идентификаторы указывают на разных Person, автоматическое объединение запрещено: создаётся отдельная запись и ситуация помечается для административной проверки, чтобы не повредить данные другого человека.

Для Excel строки с `ФИО + группа + организация` без сильного идентификатора показываются как вероятное совпадение на preview и не объединяются молча.

## 6. Повторная регистрация на тот же Event

После уверенного Person match сервер проверяет активную Registration `(event_id, person_id)`. Если она уже существует:

- новая Registration не создаётся;
- snapshot может быть актуализирован данными повторно отправленной формы;
- билет повторно ставится в email queue при наличии email.

## 7. Attendance

Основной факт посещения определяется как первое валидное событие. Повторные scans могут храниться, но не меняют `first_attended_at`.

## 8. Capacity

Capacity считают только активные Registration. `ANNULLED` не занимает место. Участник сам отменить Registration не может, но SUPER_ADMIN может аннулировать ошибочную/дублирующую запись и тем самым освободить место.

SCANNER не имеет права административного overbooking.

## 9. Global Person directory

SUPER_ADMIN может искать Person глобально и видеть историю Registration. Редактирование актуального Person не переписывает snapshots прошлых Registration.


---

<!-- SOURCE: docs/06-database.md -->

# 06. PostgreSQL Database Specification

Статус: **Approved baseline for first Prisma schema — v0.2**

## 1. Таблицы MVP

1. `persons`
2. `events`
3. `event_form_fields`
4. `registrations`
5. `registration_answers`
6. `attendance_events`
7. `staff_users`
8. `event_access`
9. `staff_invitations`
10. `sessions`
11. `password_reset_tokens`
12. `email_deliveries`
13. `import_jobs`
14. `audit_log`

## 2. Common conventions

- Primary identifiers: UUID.
- Business timestamps: `timestamptz`, persisted in UTC.
- Event timezone stored separately; default `Europe/Moscow`.
- All tables with mutable records use `created_at` / `updated_at` where applicable.
- Hard delete is avoided for business entities referenced by history.

## 3. `persons`

- `id uuid PK`
- `last_name varchar not null`
- `first_name varchar not null`
- `middle_name varchar null`
- `birth_date date null`
- `email varchar null`
- `email_normalized varchar null`
- `phone varchar null`
- `phone_normalized varchar null`
- `person_type enum not null`
- `organization varchar null`
- `study_group varchar null`
- `dedup_review_required boolean default false`
- `merged_into_id uuid null FK persons(id)` — reserved for future/manual reconciliation
- timestamps

Normalization:
- phone → `+7XXXXXXXXXX`;
- email → trim + lowercase;
- names → trim, collapse repeated spaces, case-normalized comparison value in application logic.

Do not impose global `UNIQUE(email_normalized)` or `UNIQUE(phone_normalized)`: bad imports/shared contacts must not prevent preserving data. Use indexes and application-level matching.

## 4. `events`

- `id uuid PK`
- `title varchar not null`
- `slug varchar not null unique`
- `description text null`
- `cover_object_key varchar null`
- `start_at timestamptz not null`
- `end_at timestamptz not null`
- `timezone varchar not null default 'Europe/Moscow'`
- `location varchar not null`
- `registration_deadline timestamptz not null`
- `capacity integer not null check capacity > 0`
- `status enum not null`
- `created_by uuid FK staff_users(id)`
- `offline_data_version bigint not null default 1`
- `archived_at timestamptz null`
- timestamps

Event status: `DRAFT`, `REGISTRATION_OPEN`, `REGISTRATION_CLOSED`, `ACTIVE`, `COMPLETED`, `ARCHIVED`.

Business validation additionally requires `end_at >= start_at` and deadline rules in API.

## 5. `event_form_fields`

- `id uuid PK`
- `event_id uuid FK events(id)`
- `type enum not null`
- `label varchar not null`
- `required boolean not null default false`
- `sort_order integer not null`
- `options jsonb null` — only option configuration, not participant answers
- `active boolean not null default true`
- timestamps

Types: `SHORT_TEXT`, `LONG_TEXT`, `SINGLE_CHOICE`, `MULTI_CHOICE`, `BOOLEAN`.

Changes after registrations are allowed but audited. Existing RegistrationAnswer rows preserve field label/type snapshots. New required fields only apply to subsequent submissions.

## 6. `registrations`

- `id uuid PK`
- `public_id uuid not null unique`
- `event_id uuid FK events(id)`
- `person_id uuid FK persons(id)`
- `source enum not null`
- `status enum not null default ACTIVE`
- snapshot: `last_name`, `first_name`, `middle_name`, `birth_date`, `email`, `phone`, `study_group`, `person_type`, `organization`
- `consent_accepted boolean not null`
- `consent_version varchar null`
- `consent_url varchar null`
- `consent_accepted_at timestamptz null`
- `registered_at timestamptz not null`
- `first_attended_at timestamptz null`
- `annulled_at timestamptz null`
- `annulled_by uuid null FK staff_users(id)`
- timestamps

Sources: `PUBLIC_FORM`, `EXCEL_IMPORT`, `ONSITE`, `ADMIN_MANUAL`.

Status: `ACTIVE`, `ANNULLED`.

Critical constraint: partial unique index on `(event_id, person_id)` where `status = 'ACTIVE'`.

Capacity counts only `ACTIVE` registrations.

## 7. `registration_answers`

- `id uuid PK`
- `registration_id uuid FK registrations(id)`
- `field_id uuid FK event_form_fields(id)`
- `field_label_snapshot varchar not null`
- `field_type_snapshot enum not null`
- `answer jsonb not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Constraint: `UNIQUE(registration_id, field_id)`.

`answer` uses a typed JSON value according to field type: string, boolean or string array. Validation is performed through shared Zod contracts before persistence.

## 8. `attendance_events`

- `id uuid PK`
- `client_event_id uuid not null unique`
- `event_id uuid FK events(id)`
- `registration_id uuid FK registrations(id)`
- `scanner_user_id uuid null FK staff_users(id)`
- `device_id uuid null`
- `mode enum not null`
- `source enum not null`
- `device_scanned_at timestamptz not null`
- `estimated_scanned_at timestamptz not null`
- `received_at timestamptz not null`
- `duplicate boolean not null default false`
- `created_at timestamptz not null`

Modes: `MANUAL_CONFIRM`, `FAST_SCAN`, `MANUAL_SEARCH`, `ONSITE_REGISTRATION`.

Source may distinguish `ONLINE` and `OFFLINE_SYNC`.

## 9. `staff_users`

- `id uuid PK`
- `person_id uuid null FK persons(id)`
- `email varchar not null`
- `email_normalized varchar not null unique`
- `password_hash varchar not null`
- `system_role enum not null`
- `active boolean not null default true`
- `last_login_at timestamptz null`
- `password_changed_at timestamptz not null`
- timestamps

MVP roles: `SUPER_ADMIN`, `SCANNER`.

## 10. `event_access`

- `id uuid PK`
- `event_id uuid FK events(id)`
- `user_id uuid FK staff_users(id)`
- `role enum not null`
- `created_by uuid FK staff_users(id)`
- `created_at timestamptz not null`

Constraint: `UNIQUE(event_id, user_id)`.

## 11. Auth support tables

### `staff_invitations`
- `id`, `email_normalized`, `token_hash unique`, `invited_by`, optional `event_id`, role, `expires_at`, `accepted_at`, `created_at`.

### `sessions`
- `id`, `user_id`, `token_hash unique`, `expires_at`, `created_at`, `last_used_at`, `revoked_at`, optional diagnostic metadata.

### `password_reset_tokens`
- `id`, `user_id`, `token_hash unique`, `expires_at`, `used_at`, `created_at`.

Raw invitation/session/reset tokens are never persisted.

## 12. `email_deliveries`

- `id uuid PK`
- `idempotency_key varchar not null unique`
- `type enum not null`
- `recipient_email varchar not null`
- optional `event_id`, `registration_id`, `staff_user_id`
- `status enum not null`
- `attempts integer not null default 0`
- `last_error_code varchar null`
- `provider_message_id varchar null`
- `queued_at`, `sent_at`, `created_at`, `updated_at`

MVP types: `REGISTRATION_TICKET`, `STAFF_INVITATION`, `PASSWORD_RESET`.

## 13. `import_jobs`

- `id`, `event_id`, `created_by`, status;
- total/valid/error/duplicate rows;
- `result_summary jsonb` containing aggregate counts only, not a second permanent copy of all PII;
- timestamps.

## 14. `audit_log`

- `id uuid PK`
- `actor_user_id uuid null`
- `action varchar not null`
- `entity_type varchar not null`
- `entity_id uuid null`
- `metadata jsonb null`
- `created_at timestamptz not null`

By default metadata contains changed field names and operational context, not full duplicated PII values.

## 15. Capacity transaction

Public and normal onsite registration:

1. begin transaction;
2. lock target Event row (`SELECT ... FOR UPDATE` equivalent);
3. verify state/deadline as appropriate;
4. count active registrations;
5. reject with `CAPACITY_FULL` if no capacity;
6. deduplicate/create Person;
7. enforce active `(event_id, person_id)` uniqueness;
8. create/update Registration and answers;
9. commit.

SUPER_ADMIN administrative overbooking is a separate explicit action/flag and must be audit logged.

## 16. Delete policies

- Event with business history: `RESTRICT`, use archive.
- Registration: annul, not hard delete.
- Person referenced by Registration: `RESTRICT`; future merge uses `merged_into_id`.
- EventFormField referenced by answers: soft deactivate, never destructive delete.
- StaffUser: deactivate, retain audit references.

## 17. Required indexes

- `persons(email_normalized)`
- `persons(phone_normalized)`
- name search index strategy chosen during Prisma/PostgreSQL implementation
- `persons(birth_date)`
- `registrations(event_id, status)`
- `registrations(event_id, last_name)`
- `registrations(event_id, phone)`
- `registrations(event_id, email)`
- `registrations(event_id, study_group)`
- `registrations(person_id)`
- `registration_answers(registration_id)`
- `attendance_events(registration_id)`
- `attendance_events(event_id, estimated_scanned_at)`
- `event_access(user_id)`
- `email_deliveries(status)`

## 18. Remaining implementation choices

These do not block scaffold but must be resolved in the first DB task:

- exact Prisma enum identifiers;
- PostgreSQL extension/index for tolerant Cyrillic name search (if needed after baseline LIKE/ILIKE testing);
- timestamp precision standard;
- exact migration implementation of partial unique index if Prisma schema cannot express it directly.


---

<!-- SOURCE: docs/07-api-contracts.md -->

# 07. API Contracts v1

Статус: **Approved API surface baseline — request/response schemas become code in `packages/contracts`**

## 1. Conventions

- REST + JSON; XLSX endpoints return/accept binary multipart/file responses where stated.
- Shared Zod schemas are the canonical request/response contracts.
- Staff authentication: server-side session cookie.
- All staff authorization is enforced by API, never only by UI.
- Error envelope is stable:

```json
{
  "error": {
    "code": "CAPACITY_FULL",
    "message": "Human-readable message",
    "requestId": "...",
    "details": {}
  }
}
```

- Never place full QR payloads, passwords, session tokens or sensitive PII in server logs.
- Collection endpoints use cursor or page/limit pagination consistently; initial implementation may use `page`, `pageSize` with hard maximum 100.

## 2. Public Event

### `GET /public/events/:slug`
Auth: public.

Returns only data needed to render registration:
- title/description/cover;
- start/end/timezone/location;
- registration availability (`OPEN`, `CLOSED`, `FULL`);
- system form configuration;
- active custom fields;
- consent URL/version.

Exact participant counts are not required in public response.

### `POST /public/events/:slug/register`
Auth: public. Rate limited.

Request:
- standard participant fields;
- `customAnswers[]` keyed by `fieldId`;
- `consentAccepted: true`;
- consent version from rendered form.

Transaction validates event state, deadline, capacity, dynamic answers and deduplication.

Success variants:
- `201 REGISTERED` with `ticketUrl` and registration reference;
- `200 ALREADY_REGISTERED` with neutral confirmation and resend queued when email exists.

Errors include: `VALIDATION_ERROR`, `REGISTRATION_CLOSED`, `CAPACITY_FULL`, `EVENT_NOT_FOUND`, `FORM_VERSION_INVALID`, rate limit.

## 3. Ticket

### `GET /tickets/:publicId/:signature`
Auth: possession of unguessable signed URL.

Returns minimum ticket data: Event name/date/time/location, participant full name and QR payload/rendering data.

Security headers: `Referrer-Policy: no-referrer`; endpoint/path logging must mask token/signature components.

Invalid/annulled ticket returns generic not-valid response without exposing participant data.

## 4. Auth

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/session`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `POST /auth/invitations/:token/accept` — set initial password and activate invitation.

Mutating cookie-authenticated routes require CSRF/origin protection according to `09-security.md`.

## 5. Admin — Events

- `GET /admin/events`
- `POST /admin/events`
- `GET /admin/events/:eventId`
- `PATCH /admin/events/:eventId`
- `POST /admin/events/:eventId/archive`

Permission: SUPER_ADMIN in MVP.

Important errors: `INVALID_EVENT_STATE`, `INVALID_TIME_RANGE`, `CAPACITY_BELOW_ACTIVE_REGISTRATIONS`.

## 6. Admin — Form fields

- `GET /admin/events/:eventId/form-fields`
- `POST /admin/events/:eventId/form-fields`
- `PATCH /admin/events/:eventId/form-fields/:fieldId`
- `DELETE /admin/events/:eventId/form-fields/:fieldId` — soft deactivate.

Permission: SUPER_ADMIN.

Structural changes are audited. Existing RegistrationAnswer snapshots remain historical.

## 7. Admin — Global People

- `GET /admin/people?query=&page=&pageSize=`
- `GET /admin/people/:personId`
- `PATCH /admin/people/:personId`

Person detail returns current canonical data and Registration history. Updating Person does not rewrite existing Registration snapshots.

Manual merge endpoint is intentionally deferred until merge UX/rules are designed.

## 8. Admin — Registrations

- `GET /admin/events/:eventId/registrations`
- `GET /admin/events/:eventId/registrations/:registrationId`
- `PATCH /admin/events/:eventId/registrations/:registrationId`
- `POST /admin/events/:eventId/registrations/:registrationId/annul`
- `POST /admin/events/:eventId/registrations/:registrationId/resend-ticket`
- `POST /admin/events/:eventId/registrations/onsite`

`onsite` requires online API. Standard call respects capacity.

For SUPER_ADMIN only, request may contain explicit `capacityOverride: true`; this is audit logged. SCANNER endpoint never accepts this flag.

## 9. Excel

### `POST /admin/events/:eventId/import/preview`
Multipart `.xlsx`. Returns `importJobId`, column mapping proposal and row categories/errors. No business records committed.

### `POST /admin/events/:eventId/import/:importJobId/commit`
Commits the validated preview. If Event capacity changed since preview, server re-checks and may return `CAPACITY_FULL`/capacity conflict.

### `GET /admin/events/:eventId/export.xlsx`
Returns sanitized XLSX.

### `POST /admin/events/:eventId/send-tickets`
Queues registration-ticket emails for selected/imported active registrations with email. Requires explicit confirmation in UI.

## 10. Statistics

### `GET /admin/events/:eventId/statistics`
Returns capacity, active registrations, free places, attended, absent, attendance percentage and time-bucket arrival series.

## 11. Staff & access

- `GET /admin/staff`
- `POST /admin/staff/invitations`
- `POST /admin/staff/:userId/deactivate`
- `GET /admin/events/:eventId/access`
- `POST /admin/events/:eventId/access`
- `DELETE /admin/events/:eventId/access/:userId`

SUPER_ADMIN only in MVP.

## 12. Scanner — event access

### `GET /scanner/events`
Returns only assigned Event summaries.

### `GET /scanner/events/:eventId/offline-bundle`
Requires active session + EventAccess. Returns bundle version, expiry metadata and minimum participant dataset.

### `POST /scanner/events/:eventId/resolve-qr`
Online scan lookup. QR payload is in JSON body, not URL, to reduce secret exposure in access logs.

Returns participant display data and attendance state. Does not itself create attendance unless request explicitly includes supported fast-mode confirmation; preferred implementation can call sync endpoint immediately after resolve.

### `GET /scanner/events/:eventId/registrations/search`
Search by name/phone/email/group within assigned Event.

### `POST /scanner/events/:eventId/registrations/onsite`
Online only. Permission: assigned SCANNER or SUPER_ADMIN. SCANNER cannot overbook.

## 13. Scanner — attendance sync

### `POST /scanner/events/:eventId/attendance/sync`
Used for both online single-event confirmation and offline batch reconnect.

Request includes:
- `deviceId`;
- array of events with unique `clientEventId`;
- `registrationId`;
- mode;
- device timestamp;
- estimated server-adjusted timestamp/clock metadata when available.

Per item response:
- `ACCEPTED`
- `ALREADY_PROCESSED`
- `REGISTRATION_ALREADY_ATTENDED`
- `INVALID_REGISTRATION`
- `REGISTRATION_ANNULLED`
- `ACCESS_DENIED`

The whole batch is not failed because one item is duplicate/invalid; return per-item results.

## 14. Shared business error codes

Baseline:
- `UNAUTHENTICATED`
- `FORBIDDEN`
- `VALIDATION_ERROR`
- `NOT_FOUND`
- `EVENT_NOT_FOUND`
- `REGISTRATION_NOT_FOUND`
- `REGISTRATION_CLOSED`
- `CAPACITY_FULL`
- `ALREADY_REGISTERED`
- `REGISTRATION_ANNULLED`
- `INVALID_QR`
- `FORM_VERSION_INVALID`
- `IMPORT_INVALID`
- `IMPORT_EXPIRED`
- `RATE_LIMITED`
- `CONFLICT`

HTTP status is meaningful but client behavior keys off stable code.

## 15. Transaction/audit boundaries

- Registration creation/duplicate resolution: one DB transaction for capacity + Person/Registration/answers.
- Email queue publication occurs after successful business commit using an outbox/idempotent delivery strategy or equivalent implementation preventing lost/duplicate user-visible sends.
- Attendance item processing is idempotent by `client_event_id`.
- Admin mutations that change Event, Registration, access or capacity write compact audit records.

## 16. Contract implementation rule

Before implementing an endpoint, create its Zod request/response schema in `packages/contracts` and API tests for success + authorization + key business errors. The TypeScript contract is allowed to add exact field names, but may not change product semantics in this document without updating docs/ADR.


---

<!-- SOURCE: docs/08-offline-sync.md -->

# 08. Offline Scanner & Synchronization

Статус: **Approved protocol baseline — v0.2**

## 1. Guaranteed offline scope

MVP guarantees that after successful preparation SCANNER can without internet:
- open the assigned prepared Event;
- resolve QR for registrations present in the downloaded bundle;
- see minimum participant data;
- search cached participants;
- create pending AttendanceEvent records;
- recognize locally known already-attended state.

MVP does **not** guarantee creation of a brand-new onsite Registration while fully offline. New onsite participant creation requires API access because deduplication and capacity are server invariants.

## 2. Local storage

IndexedDB through Dexie.

Local tables conceptually:
- `prepared_events`;
- `offline_registrations`;
- `pending_attendance`;
- `sync_state`;
- optional device metadata.

Stored participant fields:
- registrationId;
- QR payload hash/lookup value;
- ФИО;
- группа;
- статус;
- организация;
- телефон;
- firstAttendedAt.

Do not cache birth date, email or custom answers unless a future approved use case requires them.

## 3. QR offline lookup

Server QR payload is `publicId.signature`. Scanner never receives QR signing secret.

Offline bundle contains a cryptographic hash of the expected QR payload associated with registrationId. On scan, PWA hashes scanned payload and performs local lookup.

Online scanner uses `POST /scanner/events/:eventId/resolve-qr`.

## 4. Preparation

After Event selection, while online:
1. verify current staff session and EventAccess;
2. request bundle metadata/version;
3. download full bundle;
4. write new bundle to IndexedDB transactionally;
5. verify row count/checksum/basic integrity;
6. atomically mark prepared version active;
7. show `Готово к офлайн-работе`.

A partial download must never replace the previously usable bundle.

## 5. Bundle version

Event has monotonic `offline_data_version`.

Increase version for changes that affect scanner dataset, e.g.:
- new/annulled Registration;
- changes to scanner-visible snapshot fields;
- attendance state synchronized from server.

At 100–1000 registrations, MVP downloads a full replacement bundle when version differs. No differential sync.

## 6. Offline access lifecycle

Prepared data was obtained after authenticated authorization. While disconnected, backend cannot instantly revoke access already cached on the device; this is an explicit MVP limitation.

Controls:
- logout immediately clears all offline business data;
- automatic cache expiry default: 24h after Event `end_at`;
- reconnect revalidates session/EventAccess before refreshing bundle or syncing new activity;
- deactivated staff cannot sync or download after reconnect.

Do not claim browser storage is secure against a person who controls/unlocks the device. Risk is reduced through data minimization and short retention.

## 7. Pending attendance

Every local attendance action is assigned `client_event_id UUID` before network transmission and persisted transactionally.

Status locally:
- `PENDING`;
- `SYNCING`;
- `CONFIRMED` (then removable from pending store);
- `REJECTED` requiring visible resolution.

## 8. Reconnect order

1. Revalidate session/access.
2. Submit pending attendance batch.
3. Apply per-item server results.
4. Remove only confirmed/idempotently processed items.
5. Keep rejected items with error state for operator visibility.
6. Check server `offline_data_version`.
7. Download and transactionally swap bundle if stale.

Pending events are never erased merely because a bundle refresh starts.

## 9. Multiple devices

No distributed locking between phones.

If two devices scan the same participant while disconnected, both local events can exist. Server accepts idempotent client event IDs and determines first valid attendance. Later event is marked repeated/duplicate but retained according to attendance/audit policy.

## 10. Time

Store:
- `device_scanned_at`;
- last known device-to-server clock offset/measurement metadata;
- `estimated_scanned_at`;
- server `received_at`.

Use server-adjusted estimate for arrival analytics when credible. Received time remains available for diagnostics. Absurd clock offsets must not silently rewrite event history; implementation can clamp/flag suspicious values.

## 11. Offline UX states

Required:
- `ONLINE / синхронизировано`;
- `OFFLINE READY`;
- `OFFLINE / N ожидают синхронизации`;
- `SYNCING`;
- `OFFLINE DATA OUTDATED`;
- `SYNC ERROR`;
- `ACCESS REVALIDATION REQUIRED`.

## 12. Service worker update safety

PWA application-shell updates must not delete pending attendance. Schema migrations for IndexedDB must be backward-safe and tested. A new release cannot force-clear local business data just to fix cache issues.


---

<!-- SOURCE: docs/09-security.md -->

# 09. Security & Personal Data

Статус: **Engineering security baseline v0.2 — final production review still mandatory**

> Документ описывает технические меры и не является юридическим заключением по 152-ФЗ.

## 1. Data classification

System processes PII including ФИО, email, phone, birth date, study group and organization. Production logs, metrics, audit and error reporting must avoid duplicating this data without necessity.

## 2. Hosting

Production business data and primary infrastructure are placed in Yandex Cloud in the Russian deployment selected for the project. Legal/organizational compliance is separately verified by the college before launch.

## 3. Consent

Public registration requires explicit checkbox. Persist:
- accepted=true;
- timestamp;
- consent URL;
- consent version identifier.

Final legal URL is an external project input still pending.

## 4. QR security/privacy

- No PII in QR payload.
- Registration-specific random public ID + server HMAC signature (or cryptographically equivalent approved implementation).
- Signing secret never reaches web/scanner.
- Annulled Registration makes ticket invalid.
- Online scanner sends QR payload in POST body, not URL.
- Ticket URL route uses `Referrer-Policy: no-referrer`; logs must redact/mask signature/token segments.

## 5. Authentication

Staff only:
- invitation-controlled account creation;
- email + password;
- Argon2id password hash;
- server-side sessions;
- random opaque session token in `HttpOnly; Secure` cookie;
- DB stores only token hash;
- login/session rotation on authentication and password change;
- password reset token one-time + short TTL;
- invitation token one-time + TTL.

## 6. Cookie/CSRF/CORS model

Preferred deployment uses application subdomains under one parent domain (e.g. web/scanner/api). Configure exact CORS allowlist, `credentials` only for trusted origins and never wildcard with credentials.

Mutating cookie-authenticated requests require explicit Origin/Referer validation and CSRF protection appropriate to chosen same-site topology. Exact implementation is frozen during auth scaffold and covered by integration tests.

## 7. Authorization

Backend policy:
- SUPER_ADMIN: full MVP administrative scope;
- SCANNER: assigned Event only;
- public: no participant lists.

Every protected handler has explicit permission guard. UI hiding is not authorization.

SCANNER cannot overbook capacity. Administrative capacity override belongs to SUPER_ADMIN and is audited.

## 8. Offline PII

Scanner caches minimum fields only. Cache lifecycle:
- prepared only after authorization;
- clear on logout;
- auto-expire default 24h after Event end;
- access revalidated on reconnect.

Browser storage is not treated as encrypted trusted storage against an unlocked/compromised device. Minimize stored fields instead of relying on ineffective client-side secret encryption.

## 9. Database/network

- PostgreSQL not publicly exposed to client apps.
- API/worker use least-privilege service accounts/connectivity.
- TLS for service connections where supported/required.
- DB migrations run with controlled credentials separate from runtime when practical.

## 10. Secrets

Yandex Lockbox/environment secret injection for DB, session, QR, SMTP/API and storage credentials.

Rules:
- never commit `.env` secrets;
- `.env.example` contains names only;
- no secrets in browser bundles;
- no primary mailbox password in repository/chat/config;
- rotate secrets with documented process.

## 11. Rate limiting / abuse

At minimum:
- login;
- forgot/reset flows;
- public register;
- public ticket endpoint where needed;
- invitation acceptance.

Return generic authentication/reset responses to reduce account enumeration.

## 12. Logging/audit

Operational logs:
- requestId;
- route template, not secret path values;
- status/latency;
- internal error code.

Do not log request bodies for registration/auth by default.

Audit log records significant admin actions but should store field names/compact context rather than a second full copy of sensitive before/after PII.

## 13. XLSX security

- extension + MIME/content validation;
- hard file size and row limits;
- reject/neutralize unsupported formulas/macros;
- never execute formulas server-side;
- exports escape cells that could become spreadsheet formulas (`=`, `+`, `-`, `@` prefixes) when data is user-controlled;
- temporary import object retention is short and access private.

## 14. Web security headers

Production baseline includes:
- CSP appropriate for Vite apps and QR/camera needs;
- HSTS after domain/HTTPS validation;
- `X-Content-Type-Options: nosniff`;
- frame protection via CSP `frame-ancestors`;
- `Referrer-Policy`;
- secure cache policy for ticket/admin responses.

## 15. Backups

Daily production DB backups. Backup retention and restore test are deployment decisions that must be documented before real PII launch. Backups receive same access discipline as primary DB.

## 16. Production security gate

Before first live Event, explicitly review/test:
- CSRF/CORS/session behavior;
- brute force/rate limits;
- QR enumeration/forgery tests;
- authorization matrix;
- PII leakage in logs/errors;
- XLSX malicious inputs/formula injection;
- Object Storage ACL;
- backup/restore access;
- secret rotation;
- dependency/security scan;
- PWA offline data cleanup/logout.


---

<!-- SOURCE: docs/10-ui-design-system.md -->

# 10. UI / Design System — КАИТ №20

Статус: **Source-grounded from supplied brandbook context**

Источник: пользовательский файл `Контекст_Брендбук_КАИТ20.docx`, выжимка актуальна на 21 августа 2026 года.

## 1. Характер бренда

КАИТ №20 позиционируется как современная технологическая образовательная среда. Ассоциации: развитие вверх, мастерство, цифровая культура, автоматизация, молодость и экспериментальность.

Основная визуальная ось:
- глубокий синий → фиолетовый → пурпурный градиент;
- белая основа;
- много свободного пространства;
- асимметрия;
- один доминирующий акцент;
- модульная сетка;
- диагональная геометрия;
- декор у краёв.

Интерфейс должен ощущаться технологичным и современным, но в студенческой коммуникации — дружелюбным, понятным и человечным.

## 2. Логотип

Использовать только официальный готовый исходник. Не перерисовывать.

Запрещено:
- менять взаимное расположение элементов;
- искажать пропорции;
- наклонять;
- менять слоган/его шрифт;
- добавлять тени, обводки, glow;
- случайно перекрашивать.

На тёмном фоне — официальная белая версия.

## 3. Основные цвета

Подтверждённые значения из переданного контекста:

- сине-сиреневый `#83639D`;
- красный `#CB3334`;
- ультрамариново-синий `#2B2C7C`;
- ярко-оранжевый `#FFA421`;
- сигнальный зелёный `#0F8558`.

В общеинституциональном UI ведущими являются синий, фиолетовый, пурпурный, их градиент и белый.

При расхождениях кодов приоритет:
1. официальный готовый исходник;
2. digital-таблица цветов;
3. RGB;
4. визуальный образец PDF.

## 4. Typography

Фирменный шрифт — Montserrat:
- Bold — заголовки;
- SemiBold — подзаголовки/акценты;
- Medium — основной UI;
- Regular — длинный справочный текст при необходимости.

Minion Pro не включается в web design system.

## 5. UI composition

- преимущественно левое выравнивание;
- короткие заголовки;
- ясная иерархия;
- карточки/таблицы/списки при строгой сетке;
- декоративные элементы не должны мешать data-heavy экранам;
- QR рассматривается как полноценный функциональный элемент композиции.

## 6. Декор

Допустимы дозированно:
- угловатые градиентные плоскости;
- ломаные линии;
- точки-узлы;
- шестиугольники;
- пиксельные сетки;
- диагональные полупрозрачные квадраты;
- геометрия фирменного знака.

Киберпанк из moodboard не является обязательным стилем интерфейса.

## 7. Scanner-specific UX

Scanner должен жертвовать декоративностью ради скорости:
- крупный QR viewport;
- крупные кнопки;
- высокий контраст;
- мгновенно различимые состояния SUCCESS / ALREADY / INVALID / OFFLINE;
- один доминирующий action;
- минимум текста во время потока.

Сигнальный зелёный может использоваться для SUCCESS; красный — для ошибки. Основной фирменный цвет при этом остаётся сине-фиолетовым.

## 8. TODO

Перед UI production:
- получить официальный logo asset;
- сверить точный основной gradient по digital assets;
- сформировать design tokens;
- подготовить web-safe подключение Montserrat без передачи/публикации исходных font-файлов в документации.


---

<!-- SOURCE: docs/11-email.md -->

# 11. Email Specification

Статус: **Approved MVP scenarios / Draft provider setup**

## 1. Архитектура

Регистрация не должна ждать SMTP.

```text
Registration committed
→ email job queued
→ response success to participant
→ worker sends email
```

Ошибки email не откатывают регистрацию.

## 2. Типы писем MVP

- `REGISTRATION_TICKET`
- `STAFF_INVITATION`
- `PASSWORD_RESET`

## 3. Registration email

Содержит:
- название мероприятия;
- дату;
- время;
- место;
- ФИО;
- QR прямо в письме;
- кнопку «Открыть билет»;
- короткую инструкцию.

Финальный текст и визуальный шаблон будут утверждены отдельно.

## 4. Imported participants

После XLSX import письма автоматически не рассылаются. SUPER_ADMIN отдельно нажимает «Отправить QR участникам».

У конкретной регистрации есть «Повторно отправить письмо».

## 5. Failure policy

Email delivery имеет состояния:
- queued;
- sending;
- sent;
- failed.

Worker выполняет ограниченные retries. Ошибка после retries должна быть видна администратору.

## 6. Credentials

Не использовать основной пароль почтового аккаунта в коде. Используется отдельный SMTP app password/API credential, сохранённый как server secret.

## 7. Версия 2.0

Обязательный backlog: массовые email-рассылки участникам выбранного мероприятия (перенос, изменение места, объявление и т. п.).

Архитектура MVP должна позволять добавить `EVENT_BROADCAST` без изменения Registration model.

Автоматические reminders — future capability, не MVP.


---

<!-- SOURCE: docs/12-excel-import-export.md -->

# 12. Excel Import / Export

Статус: **Approved workflow / Draft validation details**

## 1. Import scope

XLSX импортируется только внутрь выбранного Event. Импорт людей в общую базу без регистрации не нужен.

## 2. Email

Email у импортируемой записи может отсутствовать. Такая запись всё равно считается Registration и занимает capacity.

## 3. Workflow

1. Выбор Event.
2. Upload `.xlsx`.
3. Mapping колонок.
4. Server validation.
5. Preview.
6. Admin confirmation.
7. Transactional import.
8. Result summary.
9. Отдельная массовая отправка QR при наличии email.

## 4. Preview categories

- новые;
- уже зарегистрированные;
- вероятные совпадения;
- ошибки;
- строки без email;
- итоговое влияние на capacity.

## 5. Temporary file

Исходный XLSX не должен храниться постоянно без необходимости. Предпочтительно temporary Object Storage с автоматическим удалением, например через 24 часа.

## 6. Export

Экспорт выбранного Event в `.xlsx` включает минимум:
- фамилия;
- имя;
- отчество;
- дата рождения;
- статус;
- группа;
- организация;
- телефон;
- email;
- дата регистрации;
- источник регистрации;
- пришёл/не пришёл;
- время первого посещения;
- дополнительные ответы формы.

## 7. Security/validation baseline

- extension + MIME/content validation;
- configurable hard file-size and row-count limit;
- formulas/macros are not executed and unsupported formula cells are rejected or treated as inert values;
- exported user strings starting with spreadsheet formula prefixes are escaped/neutralized;
- merged cells are not part of the recommended template and require deterministic rejection/normalization;
- empty rows are ignored;
- commit re-checks capacity even after successful preview.

## 8. TODO before Excel feature implementation

- publish exact recommended XLSX template;
- choose initial file/row limits based on staging tests;
- exact accepted Russian column aliases.


---

<!-- SOURCE: docs/13-infrastructure.md -->

# 13. Infrastructure — Yandex Cloud

Статус: **Approved platform / Draft resource sizing**

## 1. Принцип

Основная инфраструктура размещается в Yandex Cloud. PostgreSQL — источник истины.

## 2. Компоненты

Предварительно:

- Managed PostgreSQL;
- Serverless Containers / подходящий container runtime для API;
- отдельный email worker;
- Object Storage;
- Message Queue;
- Lockbox;
- Container Registry;
- Logging/Monitoring;
- Certificate Manager/CDN после появления домена;
- Terraform.

## 3. Network

PostgreSQL не публикуется как клиентский endpoint. API получает доступ в контролируемой сети.

## 4. Secrets

Раздельные service accounts и минимальные IAM permissions. Secrets — Lockbox.

## 5. Staging/Production

Отдельные ресурсы и базы. Production secrets не используются в staging.

## 6. Backup

Ежедневные production backups. Необходимо заранее документировать restore procedure и периодически её проверять.

## 7. Sizing

Целевая нагрузка MVP — 100–1000 участников на Event. Не использовать Kubernetes без нового обоснования: текущая нагрузка его не требует.

## 8. Terraform

Инфраструктура описывается кодом, чтобы staging/production были воспроизводимыми.

## 9. TODO

- конкретные resource sizes и budget estimate;
- зоны доступности;
- backup retention;
- log retention;
- домены/DNS;
- SMTP provider;
- monitoring alerts;
- exact deployment topology после proof-of-concept Serverless Containers + PostgreSQL connectivity;
- outbox/idempotent queue publication implementation choice for email delivery.


---

<!-- SOURCE: docs/14-testing.md -->

# 14. Testing Strategy

Статус: **Approved baseline required from first feature**

## 1. Critical invariants

Tests must prove:
- concurrent registration cannot exceed capacity;
- SCANNER cannot administrative-overbook;
- one Person cannot have two ACTIVE registrations for same Event after confident match;
- ANNULLED does not count toward capacity;
- QR for wrong Event cannot create attendance;
- forged/modified QR signature fails;
- duplicate `client_event_id` is idempotent;
- two offline devices can sync same participant without changing first attendance incorrectly;
- SCANNER cannot access unassigned Event;
- failed email does not roll back Registration;
- Person edit does not mutate Registration snapshot;
- form edits do not corrupt historical RegistrationAnswer snapshots.

## 2. Unit tests

- email/phone/name normalization;
- dedup matching and conflict cases;
- dynamic field validation;
- QR signing/verification and offline payload hashing;
- RBAC policies;
- statistics;
- XLSX row mapping/sanitization;
- offline clock/duplicate resolution.

## 3. Integration tests — real PostgreSQL

- registration transaction;
- capacity race with parallel requests;
- partial unique active-registration constraint;
- annulment/re-registration;
- RegistrationAnswer persistence;
- session/invitation/reset token lifecycle;
- attendance idempotency;
- EventAccess;
- email delivery idempotency/outbox-equivalent boundary.

## 4. API contract tests

Every implemented endpoint gets:
- valid success;
- schema validation failure;
- unauthenticated/forbidden where applicable;
- relevant business errors;
- no unexpected PII in error payload.

High-priority codes: `CAPACITY_FULL`, `ALREADY_REGISTERED`, `REGISTRATION_CLOSED`, `INVALID_QR`, `REGISTRATION_ANNULLED`.

## 5. Frontend E2E

- public registration → success/ticket;
- duplicate registration → no duplicate row + resend behavior;
- admin Event create/edit;
- global Person search/history;
- participant list/edit/annul;
- scanner online resolve → confirm;
- manual search → confirm;
- onsite registration online;
- Excel preview → commit;
- invitation → initial password → login.

## 6. Offline E2E

- prepare bundle;
- incomplete bundle download does not replace prior bundle;
- network off → QR resolve;
- pending attendance persists across PWA reload;
- reconnect → sync;
- retry same batch;
- bundle refresh after pending sync;
- two devices same participant;
- logout clears offline business data;
- expired cache becomes unusable/cleared per policy;
- app/service-worker update preserves pending events.

## 7. Security tests before production

- CSRF/origin/CORS;
- session rotation/logout/revocation;
- role matrix;
- QR tamper/enumeration resistance;
- rate limits;
- malicious XLSX/formula injection;
- log redaction;
- storage ACL assumptions.

## 8. Load/concurrency test

Before first large Event, staging scenario around 1000 registrations and multiple parallel scanner clients. Focus on transaction races, sync batches and email queue behavior rather than synthetic extreme RPS.

## 9. Definition of Done

A feature is not complete until:
- acceptance criteria satisfied;
- contracts/types updated;
- authorization explicit;
- unit/integration/E2E tests appropriate to risk pass;
- lint + typecheck pass;
- migrations are reviewed and reversible/operationally safe;
- docs/ADR updated when behavior or architecture changes;
- no secrets/PII accidentally added to source/log fixtures.


---

<!-- SOURCE: docs/15-deployment.md -->

# 15. Deployment & Environments

Статус: **Draft**

## 1. Environments

### Staging
- фиктивные мероприятия;
- тестовая БД;
- безопасные test email recipients/provider settings;
- проверка миграций;
- offline tests;
- интеграционные проверки.

### Production
- реальные участники;
- реальные ПД;
- production DB;
- production email;
- backups и monitoring.

## 2. Deployment principle

Предпочтительно автоматизированный pipeline:

1. lint/typecheck/tests;
2. build apps;
3. build container images;
4. apply migrations controlled step;
5. deploy staging;
6. smoke tests;
7. manual production promotion для значимых релизов.

## 3. Database migrations

- миграции version-controlled;
- production migration перед app rollout либо совместимая expand/contract стратегия;
- destructive migration без backup/plan запрещена.

## 4. Frontend

Static build → Object Storage/CDN after domain setup.

Scanner PWA update strategy должна учитывать service worker cache, чтобы устройство не застревало на несовместимой версии.

## 5. Rollback

Нужен план rollback приложения отдельно от rollback DB. Нельзя считать «откатить контейнер» достаточным при необратимой миграции.

## 6. TODO

- конкретный CI provider/repository;
- branches/release policy;
- container image naming;
- migration tool commands;
- health checks;
- smoke test endpoints;
- domain/certificates;
- incident/runbook.


---

<!-- SOURCE: docs/16-roadmap.md -->

# 16. Roadmap

Статус: **Approved MVP boundary + v2 commitment**

## MVP v1

Обязательно:
- SUPER_ADMIN;
- SCANNER invitations/auth;
- Event CRUD;
- configurable form;
- consent checkbox;
- public registration;
- capacity;
- Person deduplication;
- Registration-specific QR;
- ticket email;
- ticket page;
- participant list/search;
- manual/fast scan;
- offline PWA;
- onsite registration;
- Excel import/export;
- basic statistics;
- minimal audit log;
- staging/production;
- backups.

## Version 2.0 — committed feature

**Mass email broadcasts to participants of a selected Event.**

Use cases:
- перенос;
- изменение места;
- изменение времени;
- организационные сообщения;
- объявления.

Необходимо использовать уже существующие Registration recipients, Email Service и queue.

## Future candidates, not committed to 2.0

- automatic reminders;
- EVENT_ADMIN;
- waitlist;
- richer analytics;
- entry/exit and zones;
- additional form field types;
- offline creation of brand-new onsite participants (only if operationally needed);
- integrations with other college systems;
- controlled anonymization/data retention tools.

## Explicit non-goal

Scanner остаётся PWA. Релиз через App Store не является целевым направлением проекта.


---

<!-- SOURCE: docs/17-engineering-review.md -->

# 17. Engineering Review v0.2

Статус: **Completed — 21 August 2026**

## Purpose

Review Documentation v0.1 for contradictions and unresolved implementation blockers before repository scaffold.

## Decisions closed

### 1. Dynamic answers
Changed from ambiguous `registrations.custom_answers JSONB` vs separate entity to explicit `registration_answers` table. Each answer stores field label/type snapshot plus typed JSON value.

### 2. Capacity
Only ACTIVE Registration counts. ANNULLED frees capacity. Normal public/onsite operations cannot exceed capacity. Only SUPER_ADMIN may explicitly overbook; SCANNER cannot.

### 3. Onsite offline boundary
New onsite participant creation is online-only in MVP because server must enforce deduplication and capacity. Offline scope remains strong for prepared participants and attendance.

### 4. Online QR resolution
Added `POST /scanner/events/:eventId/resolve-qr`. Secret QR payload is sent in POST body instead of URL.

### 5. Invitation acceptance
Added missing `POST /auth/invitations/:token/accept`.

### 6. Person directory
Added simple SUPER_ADMIN global People directory because owner requires access to the common participant database, not only per-Event lists.

### 7. Deduplication
Made matching conservative and deterministic. FIO alone never merges. Excel medium-confidence matches require preview/admin decision.

### 8. Offline authorization limitation
Documented that already-downloaded browser data cannot be instantly revoked while device is truly offline. Mitigation: minimal fields, logout clear, expiry, revalidation on reconnect.

### 9. Email idempotency
Added delivery idempotency key and requirement for post-commit reliable enqueue/outbox-equivalent behavior.

### 10. Security
Added explicit CSRF/CORS/session/logging/XLSX requirements and production security gate.

## Remaining non-blocking external inputs

- final legal consent URL/text version;
- official logo asset used in implementation;
- final product name;
- domain/subdomains;
- email provider and server credentials configured as secrets;
- exact Yandex Cloud sizing/budget.

None blocks repository scaffold or core domain implementation.

## Ready gate

Project is ready for scaffold when root `AGENTS.md` accompanies this documentation and the initial repository uses the documented stack without introducing alternative frameworks/services.


---

<!-- SOURCE: docs/18-codex-workflow.md -->

# 18. Codex Development Workflow

Статус: **Approved baseline**

## 1. Principle

Codex receives bounded engineering tasks against documented contracts; it is not asked to invent product behavior from scratch.

Current OpenAI model guidance favors lean instructions: state rules once, expose only relevant tools/context, and keep reusable policy in one place. Root `AGENTS.md` is therefore concise and points to canonical docs instead of duplicating the full product spec.

## 2. Task format

Every substantial task should state:

- Goal
- Allowed scope/files
- Relevant docs/contracts
- Requirements/invariants
- Acceptance criteria
- Required tests
- Explicit non-goals

## 3. Work decomposition

Good parallel workstreams only after interfaces are fixed, e.g.:
- database schema/migrations;
- contracts;
- API module;
- web UI consuming an already-defined contract;
- scanner local DB/sync;
- tests/review.

Do not parallelize two agents that both need to invent the same contract.

## 4. Change discipline

Codex should:
1. read `AGENTS.md` and relevant docs;
2. inspect existing code before editing;
3. make the smallest coherent change;
4. run targeted checks during implementation;
5. run full project checks before handoff when feasible;
6. summarize changed files, tests and remaining risks.

## 5. Architecture changes

A task must not silently replace PostgreSQL, Yandex Cloud, PWA scanner, modular monolith, React/Vite or NestJS. Architecture changes require an updated ADR and explicit owner approval.

## 6. Documentation as code

When behavior changes, update the narrowest canonical doc in the same change. Do not leave implementation and docs knowingly contradictory.

## 7. Codex model selection

Use the strongest available Codex/agent configuration for architecture, concurrency, security and offline-sync work; cheaper/faster configurations are suitable for repetitive isolated tasks after contracts are fixed. Model names change over time, so repository policy should not hard-code a deprecated model as a product dependency.

## 8. Review tasks

Use separate review passes for:
- correctness against product spec;
- security/privacy;
- concurrency/idempotency;
- offline behavior;
- UI/design-system adherence.

A reviewing agent should not automatically rewrite broad areas unless the review task explicitly permits fixes.


---

<!-- SOURCE: docs/adr/ADR-001-yandex-cloud.md -->

# ADR-001 — Yandex Cloud as primary infrastructure

Status: **Accepted**

## Context
Проекту принципиально важно российское размещение. Требуются PostgreSQL, object storage, secrets, queue, backups, staging/production.

## Decision
Использовать Yandex Cloud как основную инфраструктурную платформу.

## Consequences
- IaC ориентируется на Yandex Cloud.
- Managed PostgreSQL — основной database service.
- Перед production требуется отдельная юридическая проверка требований к ПД; выбор облака сам по себе не является доказательством compliance.


---

<!-- SOURCE: docs/adr/ADR-002-postgresql.md -->

# ADR-002 — PostgreSQL as source of truth

Status: **Accepted**

## Context
Нужны транзакционные capacity checks, уникальные constraints, несколько scanners, offline synchronization, роли, audit и история посещений.

## Decision
Использовать PostgreSQL. Google Sheets/Яндекс Таблицы не являются основной БД.

## Consequences
Excel/таблицы используются только как импорт/экспорт или дополнительное представление данных.


---

<!-- SOURCE: docs/adr/ADR-003-pwa-scanner.md -->

# ADR-003 — Scanner as PWA

Status: **Accepted**

## Context
Scanner используется на обычных iPhone/Android, должен работать с камерой и offline cache. App Store/Google Play публикация создаёт лишнюю стоимость и задержки.

## Decision
Отдельное устанавливаемое PWA на React/Vite с IndexedDB.

## Consequences
- не планировать обязательный App Store release;
- service worker/offline lifecycle тестируется отдельно;
- PWA имеет отдельный frontend lifecycle от admin/public web.


---

<!-- SOURCE: docs/adr/ADR-004-modular-monolith.md -->

# ADR-004 — Modular monolith backend

Status: **Accepted**

## Context
Нагрузка невысокая, но предметная логика имеет сильные транзакционные связи. Микросервисы усложнили бы deployment, data consistency и разработку.

## Decision
Один NestJS API как модульный монолит. Email worker — отдельный background component из-за очереди.

## Consequences
Доменные границы сохраняются через NestJS modules/packages. Выделение отдельного сервиса в будущем возможно только при реальной необходимости.


---

<!-- SOURCE: docs/adr/ADR-005-registration-qr.md -->

# ADR-005 — QR belongs to Registration, not Person

Status: **Accepted**

## Context
Один человек регистрируется на разные мероприятия. Требуется раздельная история и возможность аннулировать конкретную регистрацию.

## Decision
Каждая Registration получает собственный QR. Персональные данные в QR открыто не кодируются.

## Consequences
Повторная отправка билета относится к Registration. Scanner всегда валидирует QR в контексте конкретного Event.


---

<!-- SOURCE: docs/adr/ADR-006-registration-answers.md -->

# ADR-006 — Registration answers as rows

Status: **Accepted**

## Decision
Store dynamic participant answers in `registration_answers` rather than one `registrations.custom_answers` JSONB object.

## Why
- preserves a stable relation to each form field;
- supports field label/type snapshots;
- simpler historical export and validation;
- avoids rewriting one opaque JSON document for individual answer changes.

The answer value itself may be JSON typed value (string/boolean/string array).


---

<!-- SOURCE: docs/adr/ADR-007-onsite-online-boundary.md -->

# ADR-007 — New onsite registrations require online API in MVP

Status: **Accepted**

## Decision
Offline scanner supports prepared registrations and attendance. Creating a brand-new onsite participant/Registration requires network access to API in MVP.

## Why
Server must enforce Person deduplication, active-registration uniqueness and Event capacity across multiple devices. Allowing offline creation would require a substantially more complex distributed conflict model.

## Future
Offline walk-in creation may be reconsidered if real event operations prove it necessary.
