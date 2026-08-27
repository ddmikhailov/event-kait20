# 17. Frontend / Backend Integration

Статус: **Release 1.0 deployment contract**  
Дата актуализации: **27 августа 2026**

## 1. Топология

```text
Browser HTTPS :443
  -> organisation reverse proxy
  -> Apache HTTP :80
       |-- / and /assets/* -> compiled Web or Scanner files
       `-- /api/* -> FastAPI 127.0.0.1:3000/*
                         `-> MySQL 8.1.0
```

Apache :80 доступен только доверенному reverse proxy. FastAPI слушает только
loopback. Frontend и Scanner никогда не подключаются к MySQL напрямую.

## 2. Frontend artifacts

- `frontend/web` содержит публичную регистрацию, ticket и SUPER_ADMIN UI;
- `frontend/scanner` содержит Scanner PWA, IndexedDB и offline sync;
- обе сборки используют `VITE_API_BASE_URL=/api`;
- старые и новые hashed assets нельзя смешивать при обновлении DocumentRoot.

Web и Scanner публикуются на разных HTTPS origins. Отдельный публичный API-домен
не используется: каждый Apache virtual host проксирует свой same-origin `/api` к
одному backend.

## 3. Apache contract

Обязательная конфигурация:

```apache
ProxyPreserveHost On
ProxyPass        /api/ http://127.0.0.1:3000/
ProxyPassReverse /api/ http://127.0.0.1:3000/
RequestHeader set X-Forwarded-Proto "https"
```

Внешний proxy сохраняет исходные `Host` и `Origin`, передаёт Cookie/Set-Cookie и
не открывает пользовательский HTTP. Завершающие `/` в `ProxyPass` снимают
внешний `/api/`: `/api/health/live` становится `/health/live` в FastAPI.
Proxy также удаляет входящие от пользователя spoofed forwarding headers и
формирует доверенный client IP для rate limiting/audit.

## 4. REST and errors

Обычные запросы и ответы используют JSON. Frontend проверяет ответы shared Zod
contracts, backend проверяет входные данные Pydantic-моделями. Ошибки имеют
стабильную форму:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Описание"
  }
}
```

Binary XLSX export является отдельным ответом-файлом.

## 5. Session and CSRF

После staff login backend создаёт серверную запись Session и возвращает
host-only cookie `staff_session` с `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`
и явным expiry. В MySQL хранится только SHA-256 hash session token. Frontend
выполняет запросы с `credentials: include` и не читает cookie JavaScript-кодом.

Login и `GET /auth/session` возвращают session-bound CSRF token. Для staff
mutations frontend передаёт `X-CSRF-Token`. Backend отдельно проверяет точный
`Origin` из `CORS_ORIGINS`. Знание URL или наличие CSRF token без действующей
session не даёт доступ.

Так как Web и Scanner имеют разные host-only cookies, вход в одном домене не
создаёт cookie для другого. Это ожидаемое безопасное поведение.

## 6. Authorization

Все права проверяются FastAPI:

- SUPER_ADMIN получает административный scope версии 1.0;
- SCANNER видит только Event с актуальным EventAccess;
- публичные endpoints не возвращают staff/participant lists;
- скрытие элемента интерфейса не является authorization control.

## 7. Scanner offline flow

Scanner после online authorization загружает минимальный offline bundle в
IndexedDB. При отсутствии сети QR/search работают по bundle, а attendance с
уникальным `clientEventId` остаётся в pending queue. После возврата сети Scanner
сначала отправляет pending batches, применяет per-item результаты и только затем
обновляет bundle. Service-worker update и bundle cleanup не удаляют pending
attendance.

## 8. Configuration relationships

Связанные production values:

```env
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=3000
CORS_ORIGINS=https://events.example.org,https://scanner.example.org
PUBLIC_WEB_BASE_URL=https://events.example.org
AUTH_LINK_BASE_URL=https://events.example.org/auth
CONSENT_URL=https://events.example.org/privacy
```

Публичные values всегда HTTPS, хотя внутренний Apache принимает HTTP. Backend
читает закрытый файл независимо от текущего каталога:

```text
EVENT_REGISTRATION_ENV_FILE=/etc/event-registration/backend.env event-api
```

## 9. Acceptance checks

```text
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
curl https://events.example.org/api/health/live
curl https://events.example.org/api/health/ready
curl https://scanner.example.org/api/health/live
```

Typical failure mapping:

| Status | Meaning |
|---|---|
| 401 | cookie отсутствует, истекла или session отозвана |
| 403 ORIGIN_REJECTED | внешний Origin не совпадает с `CORS_ORIGINS` |
| 403 CSRF_REJECTED | отсутствует/устарел CSRF token |
| 404 на `/api/*` | неверен Apache `ProxyPass` |
| 502 | API не слушает `127.0.0.1:3000` |
| 503 ready | backend не подключился к MySQL |
