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
