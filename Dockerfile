FROM node:24-bookworm-slim AS frontend

WORKDIR /src
RUN npm install --global pnpm@11.22.0
COPY . .
RUN pnpm install --frozen-lockfile
ENV VITE_API_BASE_URL=/api \
    VITE_SCANNER_BASE_PATH=/scanner/
RUN pnpm exec turbo run build --filter=@event-registration/web --filter=@event-registration/scanner

FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install --no-install-recommends -y apache2 supervisor \
    && rm -rf /var/lib/apt/lists/* \
    && a2enmod proxy proxy_http headers rewrite \
    && a2dissite 000-default \
    && printf 'Listen 8080\n' > /etc/apache2/ports.conf

COPY backend/pyproject.toml /build/backend/pyproject.toml
COPY backend/src /build/backend/src
RUN pip install --no-cache-dir /build/backend \
    && rm -rf /build

COPY backend/migrations /opt/event-registration/migrations
COPY --from=frontend /src/apps/web/dist /srv/eventki20/web
COPY --from=frontend /src/apps/scanner/dist /srv/eventki20/scanner
COPY deploy/amvera/apache.conf /etc/apache2/sites-available/eventki20.conf
COPY deploy/amvera/supervisor.conf /etc/supervisor/conf.d/eventki20.conf
COPY deploy/amvera/worker.conf /opt/event-registration/worker.conf
COPY deploy/amvera/start.sh /usr/local/bin/eventki20-start
RUN a2ensite eventki20 \
    && chmod 755 /usr/local/bin/eventki20-start \
    && apache2ctl -t

WORKDIR /opt/event-registration
ENV NODE_ENV=production \
    API_HOST=127.0.0.1 \
    API_PORT=3000 \
    MIGRATIONS_DIR=/opt/event-registration/migrations \
    MEDIA_ROOT=/data/media
EXPOSE 8080
CMD ["/usr/local/bin/eventki20-start"]
