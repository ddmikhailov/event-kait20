# 13. Infrastructure — Yandex Cloud

Статус: **Approved platform / Draft resource sizing**

## 1. Принцип

Целевое российское размещение сохраняется, MySQL 8.1.0 — источник истины. Провайдер базы должен быть утверждён отдельно: совместимость с точной устаревшей версией 8.1.0 нельзя предполагать у managed-сервисов.

## 2. Компоненты

Предварительно:

- изолированный MySQL 8.1.0 service;
- Serverless Containers / подходящий container runtime для API;
- отдельный email worker;
- Object Storage;
- Message Queue;
- Lockbox;
- Container Registry;
- Logging/Monitoring;
- Certificate Manager/CDN после появления домена;
- Terraform.

### MySQL version policy

- Application production target: MySQL 8.1.0 exactly.
- Staging and integration tests must use MySQL 8.1.0.
- MySQL-specific migrations must remain compatible with MySQL 8.1.0.
- MySQL 8.1 is an expired Innovation release. A security-maintained hosting approach and approved upgrade path are mandatory production gates.
- The downloaded MySQL archive is test-only tooling and is cached outside the repository; it must not be included in application runtime dependencies or images.

## 3. Network

MySQL не публикуется как клиентский endpoint. API получает доступ в контролируемой сети.

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
- exact deployment topology после proof-of-concept application runtime + MySQL 8.1.0 connectivity;
- production hosting decision for unsupported MySQL 8.1.0 and a supported-version upgrade plan;
- outbox/idempotent queue publication implementation choice for email delivery.
- подтверждённый restore drill на созданном staging-окружении.
