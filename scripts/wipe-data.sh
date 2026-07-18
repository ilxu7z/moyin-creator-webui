#!/usr/bin/env bash
# ============================================================
# 魔因漫创 WebUI — 删除数据脚本
# 
# ⛔ 警告：此操作不可逆！将永久删除所有项目数据！
#    只有在你完全确认时才执行。
# ============================================================
set -euo pipefail

DATA_DIR="$HOME/Documents/moyin-creator"
BACKUP_DIR="$HOME/Documents/moyin-creator-deleted-$(date +%Y%m%d_%H%M%S)"

echo "⛔ 魔因漫创 WebUI — 删除所有数据"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. 停止服务 ──
echo "📦 检查运行中的服务..."
STORAGE_DEAD=0
VITE_DEAD=0
kill $(lsof -ti :3002) 2>/dev/null && STORAGE_DEAD=1
kill $(lsof -ti :5174) 2>/dev/null && VITE_DEAD=1
if [ $STORAGE_DEAD -eq 1 ] || [ $VITE_DEAD -eq 1 ]; then
  echo "   已停止运行中的服务"
  sleep 1
fi
echo ""

# ── 2. 展示将要删除的内容 ──
if [ ! -d "$DATA_DIR/data" ]; then
  echo "❌ 未找到数据目录: $DATA_DIR/data/"
  echo "   没有数据可删除"
  exit 0
fi

echo "📂 将要删除的数据目录："
echo "   $DATA_DIR/"
echo ""
echo "   包含："
du -sh "$DATA_DIR/data" 2>/dev/null | awk '{printf "   - data/          (%s)\n", $1}'
for backup in "$DATA_DIR"/data_backup_*/; do
  [ -d "$backup" ] && du -sh "$backup" 2>/dev/null | awk '{printf "   - %s (%s)\n", $NF, $1}'
done

# 列出项目信息
echo ""
echo "   项目目录："
for pid_dir in "$DATA_DIR"/data/_p/*/; do
  if [ -d "$pid_dir" ]; then
    pid=$(basename "$pid_dir")
    file_count=$(find "$pid_dir" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$file_count" -gt 0 ]; then
      echo "   ✅ $pid ($file_count files)"
    else
      echo "   ⚠️ $pid (空)"
    fi
  fi
done
echo ""

# ── 3. 三重确认 ──
echo "⛔⛔⛔ 警告 ⛔⛔⛔"
echo "   此操作将永久删除你的所有项目数据！"
echo "   删除后无法恢复！"
echo ""

# 第一重
read -p $'   输入 "确认删除数据" 继续: ' CONFIRM1
if [ "$CONFIRM1" != "确认删除数据" ]; then
  echo ""
  echo "❌ 已取消（第一次确认未通过）"
  exit 0
fi

echo ""

# 第二重
echo "   最后一次确认：删除 $DATA_DIR/ 下所有数据"
read -p $'   输入 "yes" 执行删除: ' CONFIRM2
if [ "$CONFIRM2" != "yes" ]; then
  echo ""
  echo "❌ 已取消（第二次确认未通过）"
  exit 0
fi

# ── 4. 先备份再删除 ──
echo ""
echo "📋 最后备份: $BACKUP_DIR"
mv "$DATA_DIR" "$BACKUP_DIR"
echo "   ✅ 数据已移至: $BACKUP_DIR"
echo ""

# ── 5. 重建空的数据目录 ──
mkdir -p "$DATA_DIR/data"
echo "📂 已创建空白数据目录: $DATA_DIR/data/"

echo ""
echo "✅ 数据已删除"
echo ""
echo "📋 备份位置: $BACKUP_DIR"
echo "   如需恢复：mv $BACKUP_DIR $DATA_DIR"
echo "   彻底删除：rm -rf $BACKUP_DIR"
echo ""
echo "🔁 重新启动："
echo "   npm run dev"
