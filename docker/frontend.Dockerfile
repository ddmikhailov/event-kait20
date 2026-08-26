FROM node:24-bookworm-slim AS dependencies
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

FROM nginx:1.29-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

FROM nginx:1.29-alpine AS scanner
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=scanner-build /app/apps/scanner/dist /usr/share/nginx/html
EXPOSE 80
