# 13. Production infrastructure

Статус: **Release 1.0 native deployment contract**

## Целевая схема

Первая production-установка рассчитана на один Linux-сервер организации или
одну VM в Yandex Cloud и не требует Docker:

```text
Internet
  └── Nginx :443 (TLS)
      ├── Web static files
      ├── Scanner PWA static files
      └── API proxy → 127.0.0.1:3000 (systemd, 2 workers)
                         ├── MySQL 8.1.0 → 127.0.0.1:3306
                         └── email-worker (отдельная systemd-служба) → SMTP
```

Публичны только 80/443 и ограниченный административный SSH. API и MySQL не
слушают внешний интерфейс. Nginx является единственной публичной точкой входа,
завершает TLS, ограничивает XLSX body до 10 MB и передаёт proxy-заголовки только
с loopback. Kubernetes, Redis и message broker для нагрузки MVP не требуются.

## Runtime

- API и email worker запускаются от непривилегированного пользователя
  `event-registration`;
- MySQL запускается от отдельного пользователя `mysql`;
- systemd включает restart и filesystem/kernel hardening;
- Web/Scanner являются read-only static artifacts под `/var/www`;
- secrets находятся в root-owned env-файле с mode `0600`;
- Nginx раздаёт CSP, HSTS, MIME, frame, referrer и cache policy;
- demo seed и локальные credentials не переносятся на сервер.

Проверяемые шаблоны находятся в `deploy/systemd`, `deploy/nginx` и
`deploy/mysql`.

## MySQL policy

- production target: ровно MySQL 8.1.0;
- staging и integration tests: ровно MySQL 8.1.0;
- миграции обязаны сохранять совместимость с MySQL 8.1.0;
- приложение не обновляет версию сервера автоматически;
- официальный native binary проверяется командой `mysqld --version` до запуска;
- из-за завершённого lifecycle сервер изолируется, регулярно резервируется и
  не получает публичный сетевой endpoint.

Runtime DB user ограничен одной application database и DML-операциями. DDL
выполняет отдельный migration user только во время контролируемого deployment;
root credential не находится в application environment.

## Надёжность и эксплуатация

- liveness и readiness доступны на API;
- MySQL data находится в `/var/lib/mysql-8.1`, не в каталоге приложения;
- ежедневный encrypted backup выносится за пределы VM;
- перед каждой миграцией создаётся и проверяется recovery point;
- monitoring контролирует доступность systemd units, свободное место, ошибки
  API/worker, очередь FAILED/QUEUED email и срок TLS-сертификатов;
- журналы обслуживаются journald/logrotate и не содержат секреты/PII.

## Yandex Cloud

Проект сохраняет российское размещение. Для переноса нужны folder ID, сеть,
зона, VM size, домены, бюджет и IAM-схема организации. Платные ресурсы код
приложения не создаёт. Terraform добавляется отдельным проверенным изменением
после получения реальных организационных параметров.
