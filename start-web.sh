#!/bin/bash
# ═══════════════════════════════════════════════════════
# 魔因漫创 WebUI 启动脚本
# 同时启动：
#   1. 本地存储服务 (port 3001) — 数据存硬盘
#   2. Vite dev server  (port 5173) — 前端页面
# 两个都是独立进程，OpenClaw 重启不受影响
# ═══════════════════════════════════════════════════════

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

# 先关旧进程
lsof -ti :3001 | xargs kill -9 2>/dev/null
lsof -ti :5173 | xargs kill -9 2>/dev/null

echo "▶ 启动本地存储服务 (port 3001)..."
nohup node "$REPO_DIR/local-storage-server.mjs" > /tmp/moyin-storage-server.log 2>&1 &
sleep 1

echo "▶ 启动 Vite dev server (port 5173)..."
nohup npx vite --config vite.config.web.ts --host 0.0.0.0 > /tmp/moyin-webui-5173.log 2>&1 &
sleep 3

echo ""
echo "✅ 魔因漫创 WebUI 已启动"
echo "   前端:     http://192.168.3.180:5173/"
echo "   存储 API: http://127.0.0.1:3001/healthz"
echo "   数据目录: ~/Documents/moyin-creator/data/"
echo ""
echo "   日志:"
echo "   前端: tail -f /tmp/moyin-webui-5173.log"
echo "   存储: tail -f /tmp/moyin-storage-server.log"
