#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf 'Usage: %s --source <checkout> --env <app.env> --migration-env <migration.env> [--release <git-sha>] [--dry-run]\n' "$0" >&2
  exit 2
}

source_dir=
env_file=
migration_env=
release_id=
dry_run=false
while (($#)); do
  case "$1" in
    --source) source_dir=${2:-}; shift 2 ;;
    --env) env_file=${2:-}; shift 2 ;;
    --migration-env) migration_env=${2:-}; shift 2 ;;
    --release) release_id=${2:-}; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    *) usage ;;
  esac
done

fail() {
  printf 'Release deployment refused: %s\n' "$1" >&2
  exit 1
}

run() {
  printf ' +'
  printf ' %q' "$@"
  printf '\n'
  if [[ "$dry_run" == false ]]; then "$@"; fi
}

app_root=/opt/event-registration
release_root=$app_root/releases
current=$app_root/current
[[ "$(uname -s)" == Linux ]] || fail 'Linux is required'
[[ "$source_dir" = /* && -d "$source_dir/.git" && -f "$source_dir/package.json" ]] || fail 'source must be an absolute Git checkout'
[[ "$env_file" = /* && -f "$env_file" ]] || fail 'application env file is required'
[[ "$migration_env" = /* && -f "$migration_env" ]] || fail 'migration env file is required'
if [[ -z "$release_id" ]]; then release_id=$(git -C "$source_dir" rev-parse HEAD); fi
[[ "$release_id" =~ ^[0-9a-f]{40}$ ]] || fail 'release must be a full 40-character Git commit'
[[ "$(git -C "$source_dir" rev-parse HEAD)" == "$release_id" ]] || fail 'source checkout does not match release commit'
[[ -z "$(git -C "$source_dir" status --porcelain)" ]] || fail 'source checkout must be clean'

target=$release_root/$release_id
[[ "$target" == "$release_root"/* ]] || fail 'unsafe release target'
[[ ! -e "$target" ]] || fail 'release already exists; use rollback instead of overwriting it'

for command in node python3.12 pnpm rsync systemctl systemd-run nginx curl runuser git; do
  command -v "$command" >/dev/null || fail "$command is required"
done
node "$source_dir/scripts/deploy-config.mjs" check --env "$env_file" --check-files
node "$source_dir/scripts/deploy-config.mjs" check --env "$migration_env" --check-files --migration
summary=$(node "$source_dir/scripts/deploy-config.mjs" check --env "$env_file" --check-files --json)
public_api_url=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).publicApiBaseUrl)' "$summary")
[[ "$public_api_url" == https://* ]] || fail 'validated API URL is unavailable'
if [[ "$dry_run" == false ]]; then [[ $EUID -eq 0 ]] || fail 'run as root or use --dry-run'; fi

previous=
activated=false
rollback_on_error() {
  status=$?
  if [[ "$activated" == true ]]; then
    if [[ -n "$previous" && -d "$previous" ]]; then
      printf 'Deployment failed after activation; restoring previous application symlink.\n' >&2
      ln -s "$previous" "$app_root/.current.rollback.$$"
      mv -Tf "$app_root/.current.rollback.$$" "$current"
    elif [[ -L "$current" && "$(readlink -f "$current")" == "$target" ]]; then
      printf 'First deployment failed after activation; removing the failed application symlink.\n' >&2
      unlink "$current"
    fi
    systemctl restart event-registration-api event-registration-email-worker || true
  fi
  exit "$status"
}
trap rollback_on_error ERR

run install -d -o event-registration -g event-registration -m 0750 "$target"
run rsync --archive \
  --chown event-registration:event-registration \
  --exclude .git/ --exclude node_modules/ --exclude backend/.venv/ \
  --exclude .runtime/ --exclude .env --exclude '.env.*' --exclude deploy/native.env \
  --exclude apps/web/dist/ --exclude apps/scanner/dist/ \
  "$source_dir/" "$target/"

if [[ "$dry_run" == false ]]; then
  run runuser -u event-registration -- env HOME=/var/lib/event-registration-build python3.12 -m venv "$target/backend/.venv"
  run runuser -u event-registration -- env HOME=/var/lib/event-registration-build "$target/backend/.venv/bin/python" -m pip install "$target/backend"
  run runuser -u event-registration -- env HOME=/var/lib/event-registration-build pnpm --dir "$target" install --frozen-lockfile
  run runuser -u event-registration -- env HOME=/var/lib/event-registration-build VITE_API_BASE_URL="$public_api_url" pnpm --dir "$target" build
  run chown -R root:root "$target"
  run chmod -R go-w "$target"
  run chmod 0755 "$target"

  run systemd-run --wait --pipe --collect \
    --property=User=event-registration \
    --property="WorkingDirectory=$target" \
    --property="EnvironmentFile=$migration_env" \
    "$target/backend/.venv/bin/python" -m event_api.migrate

  if [[ -L "$current" ]]; then previous=$(readlink -f "$current"); fi
  ln -s "$target" "$app_root/.current.next.$$"
  mv -Tf "$app_root/.current.next.$$" "$current"
  activated=true
  nginx -t
  systemctl restart event-registration-api event-registration-email-worker
  systemctl reload nginx
  curl --fail --silent --show-error --retry 20 --retry-delay 1 http://127.0.0.1:3000/health/ready >/dev/null
  activated=false
else
  printf ' + build frontend with VITE_API_BASE_URL=%q\n' "$public_api_url"
  printf ' + apply checksum-protected migrations using %q\n' "$migration_env"
  printf ' + atomically activate %q and restart application services\n' "$target"
fi

printf 'Release deployed: %s\n' "$release_id"
if [[ -n "$previous" ]]; then printf 'Previous release retained: %s\n' "$previous"; fi
