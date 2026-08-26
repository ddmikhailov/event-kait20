FROM node:24-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS web-build
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm --filter "@event-registration/web" build

FROM dependencies AS scanner-build
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm --filter "@event-registration/scanner" build

FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS web
ENV NGINX_ENVSUBST_FILTER=^API_ORIGIN$
RUN apk upgrade --no-cache && apk del --no-cache curl
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS scanner
ENV NGINX_ENVSUBST_FILTER=^API_ORIGIN$
RUN apk upgrade --no-cache && apk del --no-cache curl
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=scanner-build /app/apps/scanner/dist /usr/share/nginx/html
EXPOSE 80
