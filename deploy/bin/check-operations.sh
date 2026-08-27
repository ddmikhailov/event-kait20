#!/usr/bin/env bash
set -Eeuo pipefail

backup_dir=${BACKUP_DIRECTORY:-/var/backups/event-registration}
defaults_file=${MYSQL_BACKUP_DEFAULTS_FILE:-}
api_url=${OPERATIONS_API_URL:-}
certificate_file=${TLS_CERTIFICATE_FILE:-}
backup_max_age_hours=${BACKUP_MAX_AGE_HOURS:-30}
disk_min_free_percent=${DISK_MIN_FREE_PERCENT:-15}
email_queue_max_age_seconds=${EMAIL_QUEUE_MAX_AGE_SECONDS:-900}
alert_webhook=${OPERATIONS_ALERT_WEBHOOK_URL:-}
failures=()

record_failure() {
  failures+=("$1")
  printf 'FAILED %s\n' "$1" >&2
}

for command in systemctl curl mysql sha256sum find stat df openssl awk sort date basename dirname; do
  command -v "$command" >/dev/null || record_failure "command:$command"
done
if ((${#failures[@]})); then exit 1; fi

[[ "$backup_dir" = /* && -d "$backup_dir" && ! -L "$backup_dir" ]] \
  || record_failure 'backup:directory'
[[ "$defaults_file" = /* && -f "$defaults_file" ]] \
  || record_failure 'mysql:credentials'
[[ "$api_url" == https://* ]] || record_failure 'api:url'
[[ "$certificate_file" = /* && -f "$certificate_file" ]] \
  || record_failure 'tls:certificate-file'
[[ "$backup_max_age_hours" =~ ^[0-9]+$ && "$backup_max_age_hours" -ge 1 ]] \
  || record_failure 'backup:max-age-config'
[[ "$disk_min_free_percent" =~ ^[0-9]+$ && "$disk_min_free_percent" -ge 1 && "$disk_min_free_percent" -le 90 ]] \
  || record_failure 'disk:threshold-config'
[[ "$email_queue_max_age_seconds" =~ ^[0-9]+$ && "$email_queue_max_age_seconds" -ge 60 ]] \
  || record_failure 'email:threshold-config'
[[ -z "$alert_webhook" || "$alert_webhook" == https://* ]] \
  || record_failure 'alert:webhook-url'
[[ "$alert_webhook" != *$'\n'* && "$alert_webhook" != *$'\r'* && "$alert_webhook" != *'"'* && "$alert_webhook" != *$'\\'* ]] \
  || record_failure 'alert:webhook-characters'

for unit in event-registration-mysql.service event-registration-api.service \
  event-registration-email-worker.service event-registration-backup.timer; do
  systemctl is-active --quiet "$unit" || record_failure "systemd:$unit"
done

curl --fail --silent --show-error --max-time 10 "$api_url" >/dev/null \
  || record_failure 'api:readiness'
openssl x509 -in "$certificate_file" -noout -checkend 604800 >/dev/null \
  || record_failure 'tls:expires-within-7-days'

free_percent=$(df -Pk "$backup_dir" | awk 'NR==2 {gsub(/%/, "", $5); print 100-$5}')
[[ "$free_percent" =~ ^[0-9]+$ && "$free_percent" -ge "$disk_min_free_percent" ]] \
  || record_failure 'disk:free-space'

latest_backup=$(find "$backup_dir" -maxdepth 1 -type f \
  -name 'event-registration-*.sql.gz.age' -printf '%T@ %p\n' \
  | sort -nr | awk 'NR==1 {$1=""; sub(/^ /, ""); print}')
if [[ -z "$latest_backup" || ! -f "$latest_backup.sha256" ]]; then
  record_failure 'backup:missing'
else
  age_seconds=$(( $(date +%s) - $(stat -c %Y "$latest_backup") ))
  ((age_seconds <= backup_max_age_hours * 3600)) \
    || record_failure 'backup:stale'
  (
    cd "$(dirname "$latest_backup")"
    sha256sum --check --strict "$(basename "$latest_backup.sha256")" >/dev/null
  ) || record_failure 'backup:checksum'
fi

if [[ -f "$defaults_file" ]]; then
  version=$(mysql --defaults-extra-file="$defaults_file" --batch --skip-column-names \
    --execute='SELECT VERSION()' 2>/dev/null) || version=
  [[ "$version" == 8.1.0* ]] || record_failure 'mysql:version-or-connectivity'
  queue=$(mysql --defaults-extra-file="$defaults_file" --batch --skip-column-names \
    event_registration --execute="SELECT
      COALESCE(SUM(status='FAILED'),0),
      COALESCE(MAX(CASE WHEN status='QUEUED' THEN TIMESTAMPDIFF(SECOND,queued_at,UTC_TIMESTAMP()) ELSE 0 END),0)
      FROM email_deliveries" 2>/dev/null) || queue=
  if [[ "$queue" =~ ^([0-9]+)[[:space:]]+([0-9]+)$ ]]; then
    ((BASH_REMATCH[1] == 0)) || record_failure 'email:failed-deliveries'
    ((BASH_REMATCH[2] <= email_queue_max_age_seconds)) \
      || record_failure 'email:stale-queue'
  else
    record_failure 'email:queue-query'
  fi
fi

if ((${#failures[@]})); then
  if [[ -n "$alert_webhook" && "$alert_webhook" == https://* ]]; then
    checks=$(IFS=,; printf '%s' "${failures[*]}")
    curl --fail --silent --show-error --max-time 10 \
      --header 'Content-Type: application/json' \
      --data "{\"status\":\"FAILED\",\"checks\":\"$checks\"}" \
      --config <(printf 'url = "%s"\n' "$alert_webhook") >/dev/null \
      || printf 'FAILED alert:delivery\n' >&2
  fi
  exit 1
fi

printf 'Operational checks passed: services, readiness, TLS, disk, backup, MySQL and email queue.\n'
