#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf 'Usage: %s --rendered-dir <directory> [--dry-run]\n' "$0" >&2
  exit 2
}

rendered_dir=
dry_run=false
while (($#)); do
  case "$1" in
    --rendered-dir) rendered_dir=${2:-}; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    *) usage ;;
  esac
done

fail() {
  printf 'Native installation refused: %s\n' "$1" >&2
  exit 1
}

run() {
  printf ' +'
  printf ' %q' "$@"
  printf '\n'
  if [[ "$dry_run" == false ]]; then "$@"; fi
}

[[ "$(uname -s)" == Linux ]] || fail 'Linux is required'
[[ "$rendered_dir" = /* && -d "$rendered_dir" && ! -L "$rendered_dir" ]] || fail 'rendered directory must be an absolute real directory'
for file in \
  nginx/event-registration.conf \
  nginx/event-registration-web-security.conf \
  nginx/event-registration-scanner-security.conf \
  mysql/event-registration.cnf \
  systemd/event-registration-api.service \
  systemd/event-registration-email-worker.service \
  systemd/event-registration-mysql.service \
  systemd/event-registration-backup.service \
  systemd/event-registration-backup.timer \
  systemd/event-registration-monitor.service \
  systemd/event-registration-monitor.timer; do
  [[ -f "$rendered_dir/$file" ]] || fail "rendered file is missing: $file"
done
grep -R -E '__[A-Z0-9_]+__|example\.(com|org|ru)|replace-with' "$rendered_dir" >/dev/null \
  && fail 'rendered deployment still contains a placeholder'

if [[ "$dry_run" == false ]]; then
  [[ $EUID -eq 0 ]] || fail 'run as root or use --dry-run'
  for command in systemctl nginx install getent useradd groupadd; do
    command -v "$command" >/dev/null || fail "$command is required"
  done
  mysql_binary=/opt/mysql-8.1.0/bin/mysqld
  [[ -x "$mysql_binary" ]] || fail 'MySQL 8.1.0 is not installed at /opt/mysql-8.1.0'
  "$mysql_binary" --version | grep -F 'Ver 8.1.0' >/dev/null || fail 'MySQL must be exactly 8.1.0'
fi

if ! getent group event-registration >/dev/null 2>&1; then
  run groupadd --system event-registration
fi
if ! id event-registration >/dev/null 2>&1; then
  run useradd --system --gid event-registration --no-create-home --shell /usr/sbin/nologin event-registration
fi
if ! getent group event-backup >/dev/null 2>&1; then
  run groupadd --system event-backup
fi
if ! id event-backup >/dev/null 2>&1; then
  run useradd --system --gid event-backup --no-create-home --shell /usr/sbin/nologin event-backup
fi

run install -d -o root -g event-registration -m 0750 /etc/event-registration
run install -d -o root -g root -m 0755 /opt/event-registration /opt/event-registration/releases
run install -d -o event-registration -g event-registration -m 0700 /var/lib/event-registration-build
run install -d -o event-backup -g event-backup -m 0700 /var/backups/event-registration
run install -d -o root -g root -m 0755 /etc/nginx/snippets /etc/nginx/conf.d /etc/mysql

run install -o root -g root -m 0644 "$rendered_dir/mysql/event-registration.cnf" /etc/mysql/event-registration.cnf
run install -o root -g root -m 0644 "$rendered_dir/nginx/event-registration.conf" /etc/nginx/conf.d/event-registration.conf
run install -o root -g root -m 0644 "$rendered_dir/nginx/event-registration-web-security.conf" /etc/nginx/snippets/event-registration-web-security.conf
run install -o root -g root -m 0644 "$rendered_dir/nginx/event-registration-scanner-security.conf" /etc/nginx/snippets/event-registration-scanner-security.conf
for unit in "$rendered_dir"/systemd/*; do
  run install -o root -g root -m 0644 "$unit" "/etc/systemd/system/$(basename "$unit")"
done

if [[ "$dry_run" == false ]]; then
  run systemctl daemon-reload
  run nginx -t
fi

printf '\nNative host templates installed. Configure protected env/backup files, initialize MySQL, then deploy a release.\n'
