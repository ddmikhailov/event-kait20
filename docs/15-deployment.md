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
