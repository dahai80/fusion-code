# Dockerfile — Fusion-Code API service for containerized business-plane deployment.
# Issue #215. Multi-stage: build the compiled Bun binary in a linux/arm64 builder,
# ship it on a slim runtime. Builder arch matches the runtime arch (M5 Docker Desktop
# containers are linux/arm64), so --target bun (native) suffices — no cross-compile.
#
# Build:  docker build -t fusion-code .
# Run:    docker run -p 11441:11441 \
#           -e FUSION_MLX_URL=http://host.docker.internal:11434 \
#           -e FUSION_CODE_NO_AUTH=1 fusion-code
# Smoke:  curl -sf http://localhost:11441/api/model/status  # 200 = live
#         (no dedicated /health route; /api/model/status is the liveness probe.
#          With FUSION_CODE_NO_AUTH unset, pass Authorization: Bearer <token>.)

# ---------- builder ----------
FROM oven/bun:1.1 AS builder
WORKDIR /app

# Install deps first (cached layer). Lockfile keeps the build reproducible.
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Source + build the compiled binary. `bun run compile` runs scripts/build.ts
# with --compile (produces ./dist/fusion-code, a self-contained Bun executable).
COPY . .
RUN bun run compile

# ---------- runtime ----------
# Bun --compile binaries embed the Bun runtime, but still need a compatible libc.
# debian:bookworm-slim (glibc) matches the bun:1.1 build base. ~80MB base + ~74MB
# binary ≈ 154MB, under the 200MB acceptance ceiling.
FROM debian:bookworm-slim AS runtime
WORKDIR /app

# Minimal runtime: ca-certificates for https:// to the MLX host, curl for smoke.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist/fusion-code ./fusion-code

# Config dir must be writable (server.token / history land here).
ENV FUSION_CODE_CONFIG_DIR=/data
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 11441

# --host 0.0.0.0 binds inside the container; host-maps to 11441.
# Env passthrough: FUSION_MLX_URL (reach bare-metal MLX via host.docker.internal),
# FUSION_CODE_NO_AUTH (disables per-instance token — dev/smoke only).
ENTRYPOINT ["./fusion-code", "--serve", "--port", "11441", "--host", "0.0.0.0"]
