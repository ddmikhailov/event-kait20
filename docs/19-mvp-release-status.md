# 19. Release 1.0 status

Дата: **26 августа 2026**  
Статус: **application release 1.0**

## Состав релиза

- Python 3.12 / FastAPI API и MySQL 8.1.0 persistence;
- SUPER_ADMIN и SCANNER, Argon2id, server-side sessions, invitations и reset;
- распределённый между API-процессами MySQL rate limit для auth;
- Event, form fields, EventAccess, участники, tickets и onsite registration;
- Scanner PWA, offline bundle, idempotent attendance sync;
- безопасный XLSX preview/commit/export;
- статистика, audit log и ticket batches;
- SMTP worker с durable intents, one-time auth links, retries и stale-lease recovery;
- sysadmin package с Apache static/proxy example, Python wheel, SQL template,
  health/readiness и runbook без MySQL binaries/systemd/deployment scripts.

## Релизные свойства

- production OpenAPI/Swagger отключены;
- admin API всегда проверяет серверную роль; знание URL доступа не даёт;
- cookie: HttpOnly, Secure в production, SameSite=Lax, явный срок;
- mutations: exact Origin + session-bound CSRF;
- frontend CSP/frame/referrer/content-type headers включены;
- API чувствительные ответы получают Cache-Control: no-store;
- demo seed запрещён вне development;
- raw session, reset, invitation и QR secrets не хранятся и не логируются;
- dependency audits входят в CI.

## Что предоставляет организация при переносе

Код не может безопасно придумать production-секреты и внешние реквизиты. До
открытия реальных регистраций должны быть заполнены:

1. три домена, DNS и TLS reverse proxy;
2. юридически утверждённые consent URL и version;
3. SMTP host, отдельный app password и подтверждённый sender;
4. уникальные DB/session/auth-link/QR secrets;
5. backup schedule, проверка восстановления, monitoring и ответственные;
6. решение владельца инфраструктуры о принятии риска MySQL 8.1.0.

Это deployment inputs, а не незавершённые функции приложения.

## Ограничение MySQL

Production и integration target остаётся **ровно MySQL 8.1.0** по требованию
существующего сервера. Версия завершила жизненный цикл и не получает новые
security updates. База не публикуется в Интернет; доступ разрешается только API
и worker в закрытой сети. Риск должен быть письменно принят владельцем сервера.

## Следующая версия

Версия 2.0: массовые произвольные сообщения участникам выбранного Event.
В 1.0 реализована только отправка билетов и служебных auth-писем.
