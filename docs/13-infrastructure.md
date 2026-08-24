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

### PostgreSQL version policy

- Production target: PostgreSQL 18.
- Staging and integration tests must use PostgreSQL 18.
- Patch and minor upgrades within PostgreSQL 18 are managed by the managed database service and are not an application-level compatibility target.
- PostgreSQL-specific migrations must remain compatible with PostgreSQL 18.
- Embedded PostgreSQL distributions are test-only tooling and must not be included in runtime or production dependencies or deployments.

## 3. Network

PostgreSQL не публикуется как клиентский endpoint. API получает доступ в контролируемой сети.

## 4. Secrets

Раздельные service accounts и минимальные IAM permissions. Secrets — Lockbox.

## 5. Staging/Production

Отдельные ресурсы и базы. Production secrets не используются в staging.

## 6. Backup

Production использует ежедневные managed backups. Перед миграциями дополнительно
создаётся проверенная точка восстановления. Процедура восстановления и её
безопасная репетиция зафиксированы в `docs/runbooks/backup-restore.md`; конкретные
retention/RPO/RTO утверждаются вместе с оплачиваемой конфигурацией среды.

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
- подтверждённый restore drill на созданном staging-окружении.
