#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf 'Usage: %s --file <backup.age> --database <event_registration_restore_name> --defaults-file <client.cnf> --identity <age-key>\n' "$0" >&2
  exit 2
}

backup_file=
database=
defaults_file=
identity=
while (($#)); do
  case "$1" in
    --file) backup_file=${2:-}; shift 2 ;;
    --database) database=${2:-}; shift 2 ;;
    --defaults-file) defaults_file=${2:-}; shift 2 ;;
    --identity) identity=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done

fail() {
  printf 'Restore verification refused: %s\n' "$1" >&2
  exit 1
}

[[ "$backup_file" = /* && -f "$backup_file" && "$backup_file" == *.sql.gz.age ]] || fail 'an absolute encrypted backup file is required'
[[ "$database" =~ ^event_registration_restore_[a-z0-9_]+$ ]] || fail 'database name must use the restore-only prefix'
[[ "$defaults_file" = /* && -f "$defaults_file" ]] || fail 'an absolute MySQL client file is required'
[[ "$identity" = /* && -f "$identity" ]] || fail 'an absolute age identity file is required'
[[ -f "$backup_file.sha256" ]] || fail 'backup checksum file is missing'

for command in mysql age gzip sha256sum; do
  command -v "$command" >/dev/null || fail "$command is required"
done
mysql --version | grep -F 'Ver 8.1.0' >/dev/null || fail 'mysql client must be exactly MySQL 8.1.0'

(
  cd "$(dirname "$backup_file")"
  sha256sum --check --strict "$(basename "$backup_file.sha256")"
)

version=$(mysql --defaults-extra-file="$defaults_file" --batch --skip-column-names --execute='SELECT VERSION()')
[[ "$version" == 8.1.0* ]] || fail 'restore server must be exactly MySQL 8.1.0'
table_count=$(mysql --defaults-extra-file="$defaults_file" --batch --skip-column-names \
  --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$database'")
[[ "$table_count" == 0 ]] || fail 'restore database must exist and be empty'

age --decrypt --identity "$identity" "$backup_file" \
  | gzip --decompress \
  | mysql --defaults-extra-file="$defaults_file" "$database"

migration_count=$(mysql --defaults-extra-file="$defaults_file" --batch --skip-column-names "$database" \
  --execute='SELECT COUNT(*) FROM schema_migrations')
[[ "$migration_count" =~ ^[1-9][0-9]*$ ]] || fail 'schema_migrations was not restored'
for table in persons events registrations attendance_events staff_users audit_log; do
  mysql --defaults-extra-file="$defaults_file" --batch --skip-column-names "$database" \
    --execute="SELECT 1 FROM $table LIMIT 1" >/dev/null
done

printf 'Backup restore verification passed in %s. The database was intentionally retained for review.\n' "$database"
