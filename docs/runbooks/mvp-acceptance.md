# MVP release-candidate acceptance

Статус: **Required before first production promotion**

## Purpose

Этот прогон проверяет собранный MVP как единый продукт, а не повторяет unit и
integration tests. Он выполняется сначала на одноразовой локальной MySQL 8.1.0,
затем на staging с теми же immutable artifacts, которые предлагаются к
production promotion.

Используются только синтетические участники, тестовые адреса и разрешённые
почтовые получатели. Реальные персональные данные в acceptance fixtures запрещены.

## Automated gates

1. Зафиксировать release commit SHA и дождаться зелёного GitHub CI.
2. Применить migrations к пустой MySQL 8.1.0.
3. Выполнить из корня репозитория:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Browser E2E поднимает нативный локальный контур без Docker на MySQL 8.1.0 и
проверяет public registration → ticket, видимость участника администратору,
online scan, offline persistence после reload, reconnect/sync, mobile overflow и
critical/serious accessibility violations. Демо-реквизиты генерируются локально,
не выводятся в CI и не сохраняются в Git.

4. После deployment API, Web и Scanner выполнить:

```text
SMOKE_API_BASE_URL=https://<api> \
SMOKE_WEB_BASE_URL=https://<web> \
SMOKE_SCANNER_BASE_URL=https://<scanner> \
pnpm smoke:mvp
```

Smoke проверяет liveness/readiness MySQL, закрытые production API docs, точный
CORS для Web, отклонение mutation с постороннего Origin, security headers/CSP
после Nginx, обе application shells и production PWA manifest. Он не
авторизуется, не передаёт credentials и не создаёт business data.

Python integration tests автоматически запускают test-only MySQL 8.1.0 на
loopback и удаляют одноразовую БД после прогона. В CI можно передать локальный
`TEST_DATABASE_URL`; production credentials для этого не используются.

## Staging user journeys

### Administration and registration

1. CLI bootstrap создаёт первого SUPER_ADMIN; повторный bootstrap отклоняется.
2. SUPER_ADMIN входит, создаёт Event с будущими датами и открывает регистрацию.
3. Добавляет обязательное текстовое и choice-поле, затем проверяет public form.
4. Синтетический участник регистрируется и получает success/ticket page.
5. Повторная форма не создаёт вторую ACTIVE Registration и ставит resend intent.
6. Admin видит участника, historical snapshot, Person history и statistics.
7. Annulment освобождает capacity; новая регистрация после него разрешена.

### Staff and scanner

1. SUPER_ADMIN создаёт приглашение SCANNER; выбранный email provider доставляет
   ссылку, raw token отсутствует в БД и логах.
2. SCANNER принимает одноразовую ссылку, входит и видит только назначенный Event.
3. Unassigned Event недоступен прямым URL/API-запросом.
4. Scanner скачивает offline bundle, распознаёт ticket online и подтверждает вход.
5. Повторное сканирование сохраняет правильный первый attendance timestamp.
6. В offline режиме новое attendance остаётся после reload и синхронизируется
   после возврата сети до обновления bundle.
7. Logout очищает cached business data, не оставляя доступной PII.

### Excel and email

1. Preview XLSX не создаёт business rows; mapping/errors отображаются до commit.
2. Commit выполняется один раз, повтор не дублирует Registration.
3. Export открывается и не содержит исполняемых spreadsheet formulas.
4. Подтверждённая ticket batch создаёт idempotent delivery intents.
5. Email provider принимает письмо с delivery idempotency key; worker переводит
   запись в `SENT`, а ticket QR открывает Registration нужного Event.
6. Provider failure не откатывает Registration и приводит к ограниченному retry.

## Device and layout checks

- Web: актуальные desktop Chrome/Edge и mobile viewport без горизонтальной утечки;
- Scanner: разрешение камеры только после действия пользователя;
- installable PWA, offline reload, service-worker update с pending attendance;
- камера на фактическом Android-устройстве и минимум двух параллельных scanner
  devices;
- контраст SUCCESS/ERROR, keyboard focus и читаемость при ярком освещении.

## Release decision

Результат фиксируется как commit SHA, дата, среда, проверяющий и список
отклонений. Production promotion запрещён при незавершённых пунктах email,
offline/device, backup restore rehearsal, legal consent URL, domain/TLS или
security review. Waiver для критических security/data invariants не допускается.

После завершения проверок сформировать `.runtime/release-readiness.json` по
`docs/runbooks/release-decision.md`. Статус `READY` является обязательным, но не
заменяет явного решения ответственного за production promotion.
