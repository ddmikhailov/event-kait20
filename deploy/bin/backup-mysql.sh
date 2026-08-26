#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
backup_dir=/var/backups/event-registration
database=event_registration
defaults_file=${MYSQL_BACKUP_DEFAULTS_FILE:-}
recipient=${AGE_RECIPIENT:-}
retention_days=${RETENTION_DAYS:-30}
temporary=

cleanup() {
  if [[ -n "$temporary" && -f "$temporary" ]]; then
    rm -f -- "$temporary"
  fi
}
trap cleanup EXIT

fail() {
  printf 'Backup refused: %s\n' "$1" >&2
  exit 1
}

[[ -n "$defaults_file" && "$defaults_file" = /* ]] || fail 'MYSQL_BACKUP_DEFAULTS_FILE must be an absolute path'
[[ -f "$defaults_file" ]] || fail 'MySQL backup client file is missing'
[[ "$(stat -c '%a' "$defaults_file")" == 400 ]] || fail 'MySQL backup client file must have mode 0400'
[[ "$(stat -c '%U' "$defaults_file")" == "$(id -un)" ]] || fail 'MySQL backup client file must belong to the backup user'
[[ "$recipient" == age1* || "$recipient" == ssh-* ]] || fail 'AGE_RECIPIENT must be an age or SSH public recipient'
[[ "$retention_days" =~ ^[0-9]+$ ]] || fail 'RETENTION_DAYS must be numeric'
((retention_days >= 1 && retention_days <= 3650)) || fail 'RETENTION_DAYS must be between 1 and 3650'
[[ -d "$backup_dir" && ! -L "$backup_dir" ]] || fail 'Backup directory is missing or is a symlink'
[[ "$(stat -c '%U' "$backup_dir")" == "$(id -un)" ]] || fail 'Backup directory must belong to the backup user'

for command in mysqldump gzip age sha256sum find; do
  command -v "$command" >/dev/null || fail "$command is required"
done
mysqldump --version | grep -F 'Ver 8.1.0' >/dev/null || fail 'mysqldump must be exactly MySQL 8.1.0'

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
final="$backup_dir/event-registration-$timestamp.sql.gz.age"
temporary=$(mktemp "$backup_dir/.event-registration-$timestamp.XXXXXX.pending")

mysqldump \
  --defaults-extra-file="$defaults_file" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  --hex-blob \
  --no-tablespaces \
  --set-gtid-purged=OFF \
  "$database" \
  | gzip -9 \
  | age --encrypt --recipient "$recipient" --output "$temporary"

[[ -s "$temporary" ]] || fail 'Encrypted backup is empty'
mv -- "$temporary" "$final"
temporary=
(
  cd "$backup_dir"
  sha256sum "$(basename "$final")" >"$(basename "$final").sha256"
)

find "$backup_dir" -maxdepth 1 -type f \
  \( -name 'event-registration-*.sql.gz.age' -o -name 'event-registration-*.sql.gz.age.sha256' \) \
  -mtime "+$retention_days" -delete

printf 'Encrypted backup completed: %s\n' "$(basename "$final")"
