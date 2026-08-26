# 13. Production infrastructure

Статус: **Release 1.0 deployment contract**

## Целевая схема

Первая production-установка рассчитана на один сервер организации или одну VM
в Yandex Cloud:

    TLS reverse proxy
      ├── Web 127.0.0.1:8080
      ├── Scanner 127.0.0.1:8081
      └── API 127.0.0.1:3000
            ├── MySQL 8.1.0 в private Docker network
            └── отдельный email-worker

compose.production.yml не публикует MySQL. Внешний reverse proxy — единственная
публичная точка входа; он завершает TLS и передаёт запросы на loopback-порты.
Kubernetes, Redis и message broker для нагрузки MVP не требуются.

## MySQL policy

- production target: ровно MySQL 8.1.0;
- staging и integration tests: ровно MySQL 8.1.0;
- миграции обязаны сохранять совместимость с MySQL 8.1.0;
- приложение не выполняет автоматическое обновление версии сервера;
- production container сохраняет mysqld 8.1.0, но обновляет Oracle Linux
  packages, удаляет ненужный mysql-shell/Python toolchain и пересобирает gosu;
- из-за завершённого lifecycle сервер изолируется, регулярно резервируется и
  не получает публичный сетевой endpoint.

## Secrets и доступ

- production secrets находятся вне Git (Lockbox или защищённый env-файл);
- DB runtime user ограничен одной application database;
- root credential используется только для администрирования/инициализации;
- SMTP использует отдельный app password, не пароль личной почты;
- SESSION_SECRET, AUTH_LINK_SECRET и QR_SIGNING_SECRET уникальны;
- доступ к хосту и backups выдаётся по минимальным правам.

## Надёжность

- restart policy включена для runtime services;
- liveness и readiness доступны на API;
- MySQL data хранится в отдельном persistent volume;
- ежедневный encrypted backup выносится за пределы VM;
- перед каждой миграцией создаётся проверенная recovery point;
- monitoring контролирует доступность, свободное место, ошибки API/worker,
  очередь FAILED/QUEUED email и срок сертификатов.

## Yandex Cloud

Проект сохраняет российское размещение. Для переноса нужны folder ID, сеть,
зона, VM size, домены, бюджет и IAM-схема организации. Фиктивный Terraform
scaffold удалён из релиза: он создавал ложное впечатление готовой инфраструктуры.
Terraform добавляется отдельным проверенным изменением после получения реальных
организационных параметров; платные ресурсы код приложения не создаёт.
