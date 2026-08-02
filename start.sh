#!/bin/bash
# start.sh — Fusion-Code API 服务启动脚本
# 供 Fusion-Studio UpstreamServiceManager 调用
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

PORT="${FUSION_CODE_PORT:-11441}"
AUTH="${FUSION_API_KEY:-}"

if [ ! -f ./fusion-code ]; then
    echo "[start.sh] Building fusion-code..."
    bun run build
fi

echo "[start.sh] Starting Fusion-Code API on port ${PORT}"
exec ./fusion-code --serve --port="${PORT}" --auth="${AUTH}"
