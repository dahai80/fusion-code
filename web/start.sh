#!/usr/bin/env bash
# fusion-code-web lifecycle script (#233).
# start | stop | restart | status — same convention as fusion-code/start.sh and
# the rest of the fleet, so fusion-supervisor can manage this service like any
# other (it resolves <service-dir>/start.sh).
#
# Environment:
#   FUSION_CODE_WEB_PORT          port (default 11482, port-registry fusion-code-web)
#   FUSION_CODE_WEB_ENV_FILE      optional env file sourced before start
#                                 (default ~/.fusion-code/web.env) — put
#                                 FUSION_SHELL_GATEWAY_URL / FUSION_ADMIN_KEY
#                                 here for gateway self-registration.
#   FUSION_SKIP_REGISTRY_CHECK=1  bypass port-registry self-check
set -u

SERVICE="fusion-code-web"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${FUSION_CODE_WEB_PORT:-11482}"
PID_FILE="$SCRIPT_DIR/run/${SERVICE}.pid"
STDOUT_LOG="$SCRIPT_DIR/logs/stdout.log"
STDERR_LOG="$SCRIPT_DIR/logs/stderr.log"

log() { echo "[start.sh] $*"; }

is_running() {
    [ -f "$PID_FILE" ] || return 1
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null)" || return 1
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

ensure_bun() {
    if ! command -v bun >/dev/null 2>&1; then
        log "error: bun not found in PATH — install bun first" >&2
        exit 1
    fi
}

ensure_dist() {
    if [ ! -f "$SCRIPT_DIR/dist/index.html" ]; then
        log "dist/ missing — building SPA (bun run build)"
        (cd "$SCRIPT_DIR" && bun run build) >> "$STDOUT_LOG" 2>> "$STDERR_LOG" || {
            log "error: SPA build failed — see $STDERR_LOG" >&2
            exit 1
        }
    fi
}

# Register-then-start self-check: refuse to start on a port not declared in
# the workspace port registry.
check_port_registry() {
    local registry="${FUSION_REGISTRY:-$HOME/fusion/architecture/port-registry.yaml}"
    if [ ! -f "$registry" ]; then
        log "warn: port-registry.yaml not found at $registry — registry self-check skipped" >&2
    elif ! grep -A3 "^  ${SERVICE}:" "$registry" 2>/dev/null | grep -q "port: $PORT$"; then
        if [ "${FUSION_SKIP_REGISTRY_CHECK:-}" != "1" ]; then
            log "port $PORT for ${SERVICE} not registered in $registry — refusing to start" >&2
            exit 1
        fi
        log "warn: registry check bypassed (FUSION_SKIP_REGISTRY_CHECK=1)" >&2
    fi
}

load_env_file() {
    local env_file="${FUSION_CODE_WEB_ENV_FILE:-$HOME/.fusion-code/web.env}"
    if [ -f "$env_file" ]; then
        # set -a: sourced assignments must be exported, or the child bun
        # process never sees them.
        set -a
        # shellcheck disable=SC1090
        . "$env_file"
        set +a
        log "loaded env file: $env_file"
    fi
}

do_start() {
    if is_running; then
        log "$SERVICE already running (pid $(cat "$PID_FILE"))"
        return 0
    fi
    ensure_bun
    ensure_dist
    check_port_registry
    load_env_file
    mkdir -p "$SCRIPT_DIR/run" "$SCRIPT_DIR/logs"
    log "starting $SERVICE on port $PORT"
    nohup env FUSION_CODE_WEB_PORT="$PORT" bun run "$SCRIPT_DIR/server/index.ts" \
        >> "$STDOUT_LOG" 2>> "$STDERR_LOG" &
    local pid=$!
    echo "$pid" > "$PID_FILE"
    sleep 1
    if ! kill -0 "$pid" 2>/dev/null; then
        log "error: $SERVICE exited immediately — see $STDERR_LOG" >&2
        rm -f "$PID_FILE"
        exit 1
    fi
    log "$SERVICE started (pid $pid, logs $STDOUT_LOG)"
}

do_stop() {
    if ! is_running; then
        log "$SERVICE not running"
        rm -f "$PID_FILE"
        return 0
    fi
    local pid
    pid="$(cat "$PID_FILE")"
    log "stopping $SERVICE (pid $pid)"
    kill "$pid" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
        log "process still alive after 10s — sending SIGKILL"
        kill -9 "$pid" 2>/dev/null
    fi
    rm -f "$PID_FILE"
    log "$SERVICE stopped"
}

do_status() {
    if is_running; then
        log "$SERVICE running (pid $(cat "$PID_FILE"), port $PORT)"
        return 0
    fi
    log "$SERVICE not running"
    return 1
}

case "${1:-status}" in
    start) do_start ;;
    stop) do_stop ;;
    restart) do_stop; do_start ;;
    status) do_status ;;
    *)
        echo "usage: $0 {start|stop|restart|status}" >&2
        exit 2
        ;;
esac
