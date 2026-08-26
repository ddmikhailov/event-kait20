#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf 'Usage: %s --release <full-git-sha> [--dry-run]\n' "$0" >&2
  exit 2
}

release_id=
dry_run=false
while (($#)); do
  case "$1" in
    --release) release_id=${2:-}; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    *) usage ;;
  esac
done

fail() {
  printf 'Rollback refused: %s\n' "$1" >&2
  exit 1
}

app_root=/opt/event-registration
release_root=$app_root/releases
current=$app_root/current
[[ "$release_id" =~ ^[0-9a-f]{40}$ ]] || fail 'release must be a full Git commit'
target=$release_root/$release_id
[[ "$target" == "$release_root"/* && -d "$target" && ! -L "$target" ]] || fail 'release directory does not exist'
[[ -x "$target/backend/.venv/bin/uvicorn" ]] || fail 'release backend is incomplete'
[[ -f "$target/apps/web/dist/index.html" && -f "$target/apps/scanner/dist/index.html" ]] || fail 'release frontend is incomplete'
if [[ "$dry_run" == false ]]; then [[ $EUID -eq 0 ]] || fail 'run as root or use --dry-run'; fi

printf 'Rollback only switches application files. Database migrations are never reversed automatically.\n'
if [[ "$dry_run" == true ]]; then
  printf 'Would atomically switch %s to %s and restart API/worker/Nginx.\n' "$current" "$target"
  exit 0
fi

nginx -t
ln -s "$target" "$app_root/.current.rollback.$$"
mv -Tf "$app_root/.current.rollback.$$" "$current"
systemctl restart event-registration-api event-registration-email-worker
systemctl reload nginx
curl --fail --silent --show-error --retry 20 --retry-delay 1 http://127.0.0.1:3000/health/ready >/dev/null
printf 'Application rollback completed: %s\n' "$release_id"
