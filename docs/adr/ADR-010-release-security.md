# ADR-010 — Release 1.0 security hardening

Статус: **Accepted**  
Дата: 2026-08-26

## Контекст

Process-local rate limits не защищают несколько API workers, production
OpenAPI раскрывает лишнюю техническую поверхность, а durable email intents без
transport не завершают пользовательские invitation/reset/ticket сценарии.

## Решение

- хранить HMACed rate-limit buckets в MySQL и применять их по IP/account;
- не добавлять Redis для текущей нагрузки;
- отключить Swagger/ReDoc/OpenAPI в production;
- добавить CSP, frame, referrer, MIME, cache и HSTS policy;
- запрещать demo seed вне development;
- отправлять durable email intents отдельным SMTP worker с retries;
- хранить production secrets только вне репозитория.

## Последствия

API workers получают единое ограничение попыток без нового external service.
MySQL становится частью auth availability path; при недоступной БД login и так
не может создать server-side session. SMTP outage не откатывает business data.
