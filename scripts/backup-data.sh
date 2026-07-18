#!/usr/bin/env bash
# ============================================================
# 魔因漫创 WebUI — 备份数据脚本
# ============================================================
set -euo pipefail

DATA_DIR="$HOME/Documents/moyin-creator/data"
BACKUP_DIR="$HOME/Documents/moyin-creator/data_backup_$(date +%Y%m%d_%H%M%S)"

if [ ! -d "$DATA_DIR" ]; then
  echo "❌ 未找到数据目录: $DATA_DIR"
  exit 1
fi

DATA_SIZE=$(du -sh "$DATA_DIR" 2>/dev/null | cut -f1)
echo "📋 备份数据 ($DATA_SIZE)..."
cp -r "$DATA_DIR" "$BACKUP_DIR"
echo "✅ 备份完成: $BACKUP_DIR"
