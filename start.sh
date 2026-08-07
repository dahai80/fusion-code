#!/usr/bin/env bash
# start.sh — Fusion-Code API 服务启动脚本
# 供 Fusion-Studio UpstreamServiceManager 调用
# 支持 start|stop|status 子命令；start 后台 detach，避免被 Studio 30s 超时连带终止
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PORT="${FUSION_CODE_PORT:-11441}"
AUTH="${FUSION_API_KEY:-}"
PID_FILE="$DIR/.fusion-code.pid"
LOG_DIR="$DIR/logs"
STDOUT_LOG="$LOG_DIR/stdout.log"
STDERR_LOG="$LOG_DIR/stderr.log"

mkdir -p "$LOG_DIR"

is_running() {
    [ -f "$PID_FILE" ] || return 1
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    [ -n "$pid" ] || return 1
    kill -0 "$pid" 2>/dev/null
}

ensure_binary() {
    if [ ! -f ./fusion-code ]; then
        echo "[start.sh] Building fusion-code..."
        bun run build
    fi
}

do_start() {
    if is_running; then
        echo "[start.sh] fusion-code already running (pid $(cat "$PID_FILE"))"
        return 0
    fi
    ensure_binary
    echo "[start.sh] Starting Fusion-Code API on port ${PORT}"
    nohup ./fusion-code --serve --port="${PORT}" --auth="${AUTH}" \
        >> "$STDOUT_LOG" 2>> "$STDERR_LOG" &
    local pid=$!
    echo "$pid" > "$PID_FILE"
    sleep 1
    if is_running; then
        echo "[start.sh] fusion-code started (pid $pid, port $PORT)"
    else
        echo "[start.sh] fusion-code failed to start, see $STDERR_LOG" >&2
        rm -f "$PID_FILE"
        return 1
    fi
}

do_stop() {
    if ! is_running; then
        echo "[start.sh] fusion-code not running"
        rm -f "$PID_FILE"
        return 0
    fi
    local pid
    pid="$(cat "$PID_FILE")"
    echo "[start.sh] stopping fusion-code (pid $pid)"
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
        echo "[start.sh] force kill (pid $pid)"
        kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    echo "[start.sh] fusion-code stopped"
}

do_status() {
    if is_running; then
        echo "running (pid $(cat "$PID_FILE"), port $PORT)"
        return 0
    fi
    echo "stopped"
    return 1
}

ACTION="${1:-start}"
case "$ACTION" in
    start)  do_start ;;
    stop)   do_stop ;;
    status) do_status ;;
    restart) do_stop || true; do_start ;;
    *) echo "usage: $0 {start|stop|status|restart}" >&2; exit 1 ;;
esac
