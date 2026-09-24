# EventKI20 beta on Amvera

This runbook applies only to the isolated EventKI20 beta. The approved
organisation-managed production topology in `docs/13-infrastructure.md` and
`docs/15-deployment.md` remains the release target.

## Scope and data boundary

- Application: `EventKI20`, Moscow-0, `Начальный Плюс` (490 ₽ / 30 days).
- Database: `EventKI20BetaDB`, Moscow-0, MySQL 8.1.0, `Начальный`
  (290 ₽ / 30 days). No database backup service is included.
- Combined base tariffs: 780 ₽ / 30 days. Check the Amvera balance and any
  usage-based charges separately before keeping the services running.
- The free Amvera HTTPS domain hosts Web at `/` and Scanner at `/scanner/`.
  This shares one browser origin, including cookies and storage isolation
  boundaries. **Use only fictional participant data and test staff accounts.**
  Never import real participant data or conduct a real Event on this beta.
- Do not use `eventki20.ru` until DNS and the two-origin production security
  topology have been configured and reviewed.

## Deployment contents

The Amvera repository receives the scoped deployment branch. `Dockerfile`
builds both frontends with `/api` as their API base, and mounts Scanner under
`/scanner/`. Apache listens on port 8080 and proxies `/api/` to a loopback
FastAPI process. `/data/media` is the persistent upload directory. The
container starts the email worker only when `SMTP_HOST` is configured.

`deploy/amvera/start.sh` verifies that `DATABASE_URL` targets the dedicated
`EventKI20BetaDB` host, `event_registration` schema and `event_app` user, then
connects to verify MySQL version 8.1.0 and the selected schema. The app exits
before a migration or HTTP listener starts if this check fails.

## Amvera environment variables

Add these in the **EventKI20 application**, not in the database service and not
in Git. The person who knows the database password enters `DATABASE_URL`
directly in Amvera. URL-encode reserved characters in the password. Generate
three different strong random values for the cryptographic secrets and enter
them directly in Amvera; never send them through chat.

| Name | Beta value |
| --- | --- |
| `DATABASE_URL` | `mysql://event_app:<URL-encoded password>@amvera-ddmikhailov-run-eventki20betadb:3306/event_registration` |
| `CORS_ORIGINS` | `https://eventki20-ddmikhailov.amvera.io` |
| `SESSION_SECRET` | Unique random secret, at least 32 characters |
| `AUTH_LINK_SECRET` | Different random secret, at least 32 characters |
| `QR_SIGNING_SECRET` | Third random secret, at least 32 characters |
| `AUTH_LINK_BASE_URL` | `https://eventki20-ddmikhailov.amvera.io/auth` |
| `PUBLIC_WEB_BASE_URL` | `https://eventki20-ddmikhailov.amvera.io` |
| `CONSENT_URL` | `https://static.mskobr.ru/docs/soglasie_na_obrabotku_pnd.pdf` |
| `PRIVACY_POLICY_URL` | `https://st.educom.ru/eduoffices/gateways/get_file.php?id={C6751185-7D3C-F320-3D87-C704B3683104}&name=politika_v_otnoshenii_pd_rkait20.pdf` |
| `CONSENT_VERSION` | `amvera-beta-synthetic-2026-09` |

The image supplies `NODE_ENV=production`, `API_HOST`, `API_PORT`,
`MIGRATIONS_DIR` and `MEDIA_ROOT`. Leave SMTP variables unset until a dedicated
test SMTP with STARTTLS is available. Email messages will remain queued and
email-dependent registration, recovery and invitation flows are unverified.

## First start

1. Add the variables above. Keep application replicas at zero until the values
   are present and the image build succeeds.
2. Set `RUN_BETA_MIGRATIONS=1` for the initial deployment. This applies only
   reviewed `backend/migrations/*.sql` after the dedicated database gate.
3. Start one application replica. Verify build and runtime logs, then
   `https://eventki20-ddmikhailov.amvera.io/api/health/live` and
   `/api/health/ready`. Both should return success before functional checks.
4. Remove `RUN_BETA_MIGRATIONS` after the migration has completed. Future schema
   changes require another controlled migration run.
5. Bootstrap the first test `SUPER_ADMIN` with `event-bootstrap-admin` in the
   Amvera application console. Its one-time activation link is a secret: the
   intended administrator opens it directly, sets the password, and does not
   paste the link into chat or logs.
6. Test Web, Scanner login, camera, offline cache/sync and representative
   registration flows using fictional identities only. Mark email-dependent
   checks blocked until test SMTP is configured.

## Limits before any real use

The `Начальный` MySQL tariff has no managed backups. The one-origin beta does
not preserve the documented Web/Scanner origin separation. Confirm database
runtime grants, backup/restore, SMTP, DNS, HTTPS, and the production security
gate before any real participant data or Event is entered.
