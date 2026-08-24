# 15. Deployment & Environments

Статус: **Approved release-process baseline / Provider-specific deployment pending**

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

GitHub Actions выполняет обязательные проверки pull request и `main`: frozen
install, formatting, lint, typecheck, полный test suite, build и сборку API
container без публикации. Рабочие изменения проходят feature branch и review
перед merge в `main`. Production release создаётся только из уже проверенного
commit SHA; среда не собирает отличающийся исходный код повторно.

## 3. Database migrations

- миграции version-controlled;
- production migration перед app rollout либо совместимая expand/contract стратегия;
- destructive migration без backup/plan запрещена.

Каноническая команда controlled migration из корня репозитория:

```text
DATABASE_URL=<environment database URL> pnpm db:migrate:deploy
```

Команда выполняется отдельным release job до rollout API. Для production перед
ней должна существовать проверенная точка восстановления. PostgreSQL-specific
SQL остаётся совместимым с PostgreSQL 18; staging и migration rehearsal также
используют PostgreSQL 18.

## 4. Frontend

Static build → Object Storage/CDN after domain setup.

Scanner PWA update strategy должна учитывать service worker cache, чтобы устройство не застревало на несовместимой версии.

## 5. Rollback

Нужен план rollback приложения отдельно от rollback DB. Нельзя считать «откатить контейнер» достаточным при необратимой миграции.

API image именуется immutable commit SHA, например
`event-registration-api:<git-sha>`. Rollback приложения переключает runtime на
предыдущий проверенный SHA. Миграции проектируются backward-compatible; rollback
БД не выполняется автоматически. При повреждении данных используется
контролируемое восстановление по `docs/runbooks/backup-restore.md`.

## 6. Health and smoke checks

- `GET /health/live` проверяет, что процесс API отвечает, и не зависит от БД;
- `GET /health/ready` выполняет минимальный `SELECT 1` в PostgreSQL и возвращает
  `503 SERVICE_UNAVAILABLE`, пока экземпляр нельзя включать в трафик;
- `GET /health` сохранён как backward-compatible liveness endpoint;
- после staging rollout запускается `SMOKE_BASE_URL=https://<staging-api> pnpm smoke`.

Runtime использует liveness для перезапуска процесса и readiness для включения
в балансировку. Smoke не передаёт credentials и не затрагивает business data.
После выкладки всех трёх приложений выполняется общий `pnpm smoke:mvp`, а затем
scenarios из `docs/runbooks/mvp-acceptance.md`.

## 7. Current release gates

API имеет воспроизводимый OCI/Docker build. Web и Scanner остаются static Vite
artifacts для Object Storage/CDN после утверждения доменов.

Email worker пока не считается production-deployable: persistence, claim/retry,
idempotency boundary и message construction реализованы, но SMTP/API provider и
его idempotent transport не выбраны. Нельзя подменять этот gate transport-ом,
который отмечает письмо отправленным без фактической provider acceptance.

## 8. TODO

- domain/certificates;
- Yandex Cloud runtime topology, IAM, sizing and budget;
- email provider and production-safe transport;
- monitoring alerts and log retention;
- incident contacts/escalation and first staging deployment rehearsal.
