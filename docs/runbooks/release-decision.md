# Release decision runbook

Статус: **Release 1.0 required gate**

## Назначение

Команда `pnpm release:readiness` создаёт машиночитаемый итог решения о выпуске.
Она не заменяет проверки, а связывает их evidence с конкретным полным Git SHA.
Отчёт не читает и не сохраняет значения DB/application/SMTP secrets.

## Подготовка

1. Собрать релиз командой `pnpm build`.
2. Создать `deploy/release-evidence.json` из
   `deploy/release-evidence.example.json`. Файл исключён из Git.
3. Указать полный commit SHA и среду `staging` либо `production`.
4. Для каждого gate поставить `passed: true` только после фактической проверки и
   указать короткую ссылку/номер записи без PII и секретов.
5. `ci.evidence` должен быть URL успешного GitHub Actions run этого проекта.

Обязательные внешние gates:

- CI;
- юридическое согласование consent;
- принятие lifecycle-риска MySQL 8.1.0;
- контрольное восстановление backup;
- реальная доставка SMTP;
- browser/device E2E;
- security review;
- rehearsal отката;
- доставка monitoring alerts ответственному.

## Запуск

Из чистого checkout того же commit, который развёрнут на staging:

```text
pnpm release:readiness -- \
  --evidence deploy/release-evidence.json \
  --env /etc/event-registration/event-registration.env \
  --output .runtime/release-readiness.json
```

Команда дополнительно проверяет production env и TLS-файлы, чистоту Git,
совпадение SHA, версию приложения, наличие Web/Scanner artifacts и формирует
SHA-256 для каждой SQL migration. `READY` и exit code 0 возможны только при всех
автоматических и внешних gates. При `BLOCKED` отчёт всё равно создаётся и точно
показывает незавершённые пункты.

## Хранение результата

JSON из `.runtime` не коммитится. После проверки его прикладывают к закрытой
записи релиза организации вместе с результатами smoke и restore drill. Перед
прикреплением ответственный повторно убеждается, что ссылки evidence не содержат
PII, паролей, токенов или connection strings.
