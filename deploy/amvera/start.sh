#!/bin/sh
set -eu

python -m event_api.amvera_beta

if [ "${RUN_BETA_MIGRATIONS:-0}" = "1" ]; then
    python -m event_api.migrate
fi

if [ -n "${SMTP_HOST:-}" ]; then
    cp /opt/event-registration/worker.conf /etc/supervisor/conf.d/worker.conf
else
    rm -f /etc/supervisor/conf.d/worker.conf
fi

exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
