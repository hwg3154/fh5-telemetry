# syntax=docker/dockerfile:1
FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/fh5-telemetry . \
    && mkdir -p /out/data

FROM scratch
COPY --from=build /out/fh5-telemetry /fh5-telemetry
# /data holds car-styles.json. A named volume copies this directory's owner,
# so the non-root user can write to it.
COPY --from=build --chown=65534:65534 /out/data /data
ENV DATA_DIR=/data
USER 65534:65534
EXPOSE 8080/tcp 5300/udp
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD ["/fh5-telemetry", "healthcheck"]
ENTRYPOINT ["/fh5-telemetry"]
