# The library image: Caddy answering, as its Caddyfile says, with the files mounted read-only at /data. It holds no files.
FROM caddy:2.11.7-alpine
RUN setcap -r /usr/bin/caddy \
    && addgroup -g 10001 app && adduser -D -u 10001 -G app app
COPY Caddyfile /etc/caddy/Caddyfile
ENV XDG_DATA_HOME=/tmp/caddy/data XDG_CONFIG_HOME=/tmp/caddy/config
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
    CMD ["curl", "--fail", "--silent", "--max-time", "2", "http://127.0.0.1:8080/health"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
