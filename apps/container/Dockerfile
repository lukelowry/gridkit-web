# The editor image: Caddy serving the built editor and mounting its services, the solver and the library, at api/<name>/.
FROM node:25-bookworm-slim AS build
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/editor/package.json packages/editor/
COPY packages/library/package.json packages/library/
COPY packages/solver/package.json packages/solver/
# Only the editor and what it uses; nothing it uses needs an install script.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --filter @gridkit/editor... --ignore-scripts
COPY packages packages
COPY apps/container apps/container
RUN pnpm -F @gridkit/editor build && node apps/container/headers.ts > headers.caddy

FROM caddy:2.11.7-alpine
RUN setcap -r /usr/bin/caddy \
    && addgroup -g 10001 app && adduser -D -u 10001 -G app app
COPY apps/container/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /build/headers.caddy /etc/caddy/headers.caddy
COPY --from=build /build/packages/editor/dist/ /srv/
ENV XDG_DATA_HOME=/tmp/caddy/data XDG_CONFIG_HOME=/tmp/caddy/config
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
    CMD ["curl", "--fail", "--silent", "--max-time", "2", "http://127.0.0.1:8080/health"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
