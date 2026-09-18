#!/usr/bin/env bash
set -e

echo "========================================================"
echo "  AI Remote Bridge Agent (Linux / macOS)"
echo "========================================================"
echo ""

# .env が存在しない場合、.env.example から自動作成
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo "[.env が見つかりません] .env.example をコピーして .env を作成します..."
    cp .env.example .env
    echo ".env を作成しました。必要に応じて EC2 の接続先 URL を編集してください。"
    echo ""
  fi
fi

echo "Agent を起動します..."
npm run agent
