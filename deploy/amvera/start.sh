#!/bin/sh
set -eu

python -m event_api.amvera_beta

# One release only: apply the reviewed additive audit migration before this
# version starts writing audit_log.request_id. Remove after verifying Amvera.
python -m event_api.migrate

if [ "${RUN_BETA_MIGRATIONS:-0}" = "1" ]; then
    python -m event_api.migrate
fi

if [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ]; then
    python -m event_api.bootstrap --email "$BOOTSTRAP_ADMIN_EMAIL" \
        --output-file /data/first-admin-activation.txt
fi

if [ -n "${SMTP_HOST:-}" ]; then
    cp /opt/event-registration/worker.conf /etc/supervisor/conf.d/worker.conf
else
    rm -f /etc/supervisor/conf.d/worker.conf
fi

exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
