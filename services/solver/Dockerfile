FROM golang:1.26-alpine AS build
WORKDIR /solver
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /usr/local/bin/solver .

# GridKit develop-perf: the solver reads its binary output.
FROM ghcr.io/birchfieldresearchgroup/gridkit:develop-perf
COPY --from=build /usr/local/bin/solver /usr/local/bin/solver
COPY licenses/ /opt/gridkit/share/licenses/
RUN useradd --uid 10001 --create-home --user-group app && install -d -o app -g app /data
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=2s --retries=5 CMD ["solver", "health"]
CMD ["solver"]
