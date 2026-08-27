#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf 'Recovery drill failed: %s\n' "$1" >&2
  exit 1
}

[[ "$(uname -s)" == Linux ]] || fail 'Linux is required'
[[ -n "${MYSQL_HOME:-}" && "$MYSQL_HOME" = /* ]] || fail 'MYSQL_HOME must be an absolute MySQL 8.1.0 directory'
export PATH="$MYSQL_HOME/bin:$MYSQL_HOME/sbin:$PATH"

mysqld=
for candidate in "$MYSQL_HOME/sbin/mysqld" "$MYSQL_HOME/bin/mysqld"; do
  if [[ -x "$candidate" ]]; then mysqld=$candidate; break; fi
done
[[ -n "$mysqld" ]] || fail 'mysqld was not found under MYSQL_HOME'
for command in mysql mysqladmin mysqldump age age-keygen gzip sha256sum python; do
  command -v "$command" >/dev/null || fail "$command is required"
done
"$mysqld" --version | grep -F 'Ver 8.1.0' >/dev/null || fail 'mysqld must be exactly MySQL 8.1.0'
mysql --version | grep -F 'Ver 8.1.0' >/dev/null || fail 'mysql client must be exactly MySQL 8.1.0'

runtime=$(mktemp -d "${RUNNER_TEMP:-/tmp}/event-recovery-drill.XXXXXX")
data="$runtime/data"
backup_dir="$runtime/backups"
socket="$runtime/mysql.sock"
log="$runtime/mysql.log"
mkdir -p "$backup_dir"
server_pid=

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    mysqladmin --defaults-extra-file="$runtime/client.cnf" shutdown >/dev/null 2>&1 || kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf -- "$runtime"
}
trap cleanup EXIT

diagnose_error() {
  local status=$?
  printf '::error title=Encrypted recovery drill::failed at line %s (exit %s)\n' \
    "${BASH_LINENO[0]}" "$status"
  if [[ -f "$log" ]]; then
    printf '%s\n' 'Last MySQL diagnostics:' >&2
    tail -n 20 "$log" >&2
  fi
  exit "$status"
}
trap diagnose_error ERR

port=$(python - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)
layout_options=()
if [[ -d "$MYSQL_HOME/share/mysql-8.1" ]]; then
  layout_options+=("--lc-messages-dir=$MYSQL_HOME/share/mysql-8.1")
fi
if [[ -d "$MYSQL_HOME/lib/mysql/plugin" ]]; then
  layout_options+=("--plugin-dir=$MYSQL_HOME/lib/mysql/plugin")
fi

"$mysqld" --no-defaults --basedir="$MYSQL_HOME" --datadir="$data" \
  "${layout_options[@]}" --initialize-insecure --console >"$log" 2>&1
"$mysqld" --no-defaults --basedir="$MYSQL_HOME" --datadir="$data" \
  "${layout_options[@]}" --socket="$socket" --port="$port" --bind-address=127.0.0.1 --mysqlx=0 \
  --skip-log-bin --default-time-zone=+00:00 --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_unicode_ci >"$log" 2>&1 &
server_pid=$!

cat >"$runtime/client.cnf" <<EOF
[client]
user=root
host=127.0.0.1
port=$port
protocol=tcp
EOF
chmod 0400 "$runtime/client.cnf"

for _ in {1..200}; do
  if mysqladmin --defaults-extra-file="$runtime/client.cnf" ping --silent; then break; fi
  sleep 0.1
done
mysqladmin --defaults-extra-file="$runtime/client.cnf" ping --silent \
  || fail "MySQL did not start; inspect $log"

mysql --defaults-extra-file="$runtime/client.cnf" --execute="
  CREATE DATABASE event_registration CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE DATABASE event_registration_restore_ci CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

export DATABASE_URL="mysql://root@127.0.0.1:$port/event_registration"
export NODE_ENV=test
export CORS_ORIGINS=http://localhost:5173
export SESSION_SECRET AUTH_LINK_SECRET QR_SIGNING_SECRET
SESSION_SECRET=$(python -c 'import secrets; print(secrets.token_urlsafe(32))')
AUTH_LINK_SECRET=$(python -c 'import secrets; print(secrets.token_urlsafe(32))')
QR_SIGNING_SECRET=$(python -c 'import secrets; print(secrets.token_urlsafe(32))')
export AUTH_LINK_BASE_URL=http://localhost:5173/auth
export PUBLIC_WEB_BASE_URL=http://localhost:5173
export CONSENT_URL=http://localhost:5173/consent
export CONSENT_VERSION=recovery-drill
python -m event_api.migrate
mysql --defaults-extra-file="$runtime/client.cnf" event_registration --execute="
  INSERT INTO staff_users
    (id,email,email_normalized,password_hash,system_role,active,password_changed_at,created_at,updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000001','recovery@example.invalid',
     'recovery@example.invalid','synthetic-non-login-hash','SUPER_ADMIN',FALSE,
     UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));"

age-keygen --output "$runtime/age-identity.txt" >/dev/null 2>&1
recipient=$(age-keygen -y "$runtime/age-identity.txt")
started=$(date +%s)
BACKUP_DIRECTORY="$backup_dir" \
MYSQL_BACKUP_DEFAULTS_FILE="$runtime/client.cnf" \
AGE_RECIPIENT="$recipient" \
RETENTION_DAYS=1 \
  deploy/bin/backup-mysql.sh
backup_file=$(find "$backup_dir" -maxdepth 1 -type f -name 'event-registration-*.sql.gz.age' -print -quit)
[[ -n "$backup_file" ]] || fail 'encrypted backup was not created'

deploy/bin/verify-backup.sh \
  --file "$backup_file" \
  --database event_registration_restore_ci \
  --defaults-file "$runtime/client.cnf" \
  --identity "$runtime/age-identity.txt"

source_tables=$(mysql --defaults-extra-file="$runtime/client.cnf" --batch --skip-column-names \
  --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='event_registration'")
restored_tables=$(mysql --defaults-extra-file="$runtime/client.cnf" --batch --skip-column-names \
  --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='event_registration_restore_ci'")
restored_admins=$(mysql --defaults-extra-file="$runtime/client.cnf" --batch --skip-column-names \
  event_registration_restore_ci --execute='SELECT COUNT(*) FROM staff_users')
[[ "$source_tables" == "$restored_tables" ]] || fail 'restored table count differs from source'
[[ "$restored_admins" == 1 ]] || fail 'control row was not restored'
duration=$(( $(date +%s) - started ))

report_path=${RECOVERY_REPORT_PATH:-.runtime/recovery-drill.json}
mkdir -p "$(dirname "$report_path")"
RECOVERY_DURATION="$duration" RECOVERY_TABLES="$restored_tables" RECOVERY_REPORT="$report_path" python - <<'PY'
import json
import os
from datetime import UTC, datetime
from pathlib import Path

report = {
    "generatedAt": datetime.now(UTC).isoformat(),
    "mysqlVersion": "8.1.0",
    "encrypted": True,
    "checksumVerified": True,
    "restoredTables": int(os.environ["RECOVERY_TABLES"]),
    "durationSeconds": int(os.environ["RECOVERY_DURATION"]),
    "result": "PASSED",
}
path = Path(os.environ["RECOVERY_REPORT"])
path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
PY

printf 'Encrypted backup/restore drill passed; report: %s\n' "$report_path"
