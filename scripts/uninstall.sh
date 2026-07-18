#!/usr/bin/env bash
# ============================================================
# 魔因漫创 WebUI — 卸载脚本
# 
# ⚠️ 此脚本只删除程序代码，不删除用户数据
#    用户数据在 ~/Documents/moyin-creator/data/
#    卸载后重新 npm install 即可恢复使用
# ============================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$HOME/Documents/moyin-creator"

echo "🗑️  魔因漫创 WebUI 卸载"
echo "━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. 停止运行中的服务 ──
echo "📦 停止运行中的服务..."
kill $(lsof -ti :3001) 2>/dev/null && echo "   存储服务(3001) 已停止" || echo "   存储服务(3001) 未运行"
kill $(lsof -ti :5174) 2>/dev/null && echo "   Vite(5174) 已停止" || echo "   Vite(5174) 未运行"
echo ""

# ── 2. 确认数据存储位置 ──
echo "📂 你的项目数据在这里（不会删除）："
echo "   $DATA_DIR/data/"
echo ""
if [ -d "$DATA_DIR/data" ]; then
  DATA_SIZE=$(du -sh "$DATA_DIR/data" 2>/dev/null | cut -f1)
  echo "   当前数据大小: $DATA_SIZE"
else
  echo "   ⚠️ 未找到数据目录"
fi
echo ""

# ── 3. 删除程序代码 ──
echo "🗑️  删除程序代码..."
echo "   目录: $PROJECT_DIR"

read -p $'   确认删除整个项目目录？(y/N): ' CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo ""
  echo "❌ 已取消"
  exit 0
fi

# cd 出去再删，避免当前脚本也被删除导致报错
cd /tmp
sleep 0.5
rm -rf "$PROJECT_DIR"
echo "   ✅ 程序代码已删除"
echo ""

echo "✅ 卸载完成！"
echo ""
echo "📋 保留的数据："
echo "   $DATA_DIR/data/   ← 你的所有项目数据"
echo "   $DATA_DIR/data_backup_*/   ← 备份（如有）"
echo ""
echo "🔁 重新安装："
echo "   cd ~/Projects"
echo "   git clone https://github.com/ilxu7z/moyin-creator-webui.git"
echo "   cd moyin-creator-webui"
echo "   npm install"
echo "   npm run dev"
