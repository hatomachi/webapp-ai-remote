#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-ubuntu:22.04}"
SIMULATOR_IMAGE="ec2-simulator:latest"
CONTAINER_NAME="ec2-simulator"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

CLEAN_DOCKER_DIR=$(mktemp -d)
echo '{"auths":{}}' > "$CLEAN_DOCKER_DIR/config.json"
export DOCKER_CONFIG="$CLEAN_DOCKER_DIR"

cleanup() {
  rm -rf "$CLEAN_DOCKER_DIR"
}
trap cleanup EXIT

echo "======================================================================"
echo "🚀 共有EC2シミュレータ起動スクリプト (Docker + Ansible)"
echo "======================================================================"

echo "🧹 既存のシミュレータコンテナを確認・削除中..."
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

# すでにビルド済みのイメージがあるか確認
if docker image inspect "$SIMULATOR_IMAGE" >/dev/null 2>&1 && [ "${REBUILD:-false}" != "true" ]; then
  echo "⚡ ビルド済みイメージ ($SIMULATOR_IMAGE) を検出しました！"
  echo "   Ansible 実行をスキップして高速起動します..."
  
  docker run -d \
    --name "$CONTAINER_NAME" \
    --add-host=host.docker.internal:host-gateway \
    "$SIMULATOR_IMAGE" sleep infinity

  echo "🔄 最新ソースコードを仮想EC2コンテナへ同期中..."
  TMP_TAR=$(mktemp)
  COPYFILE_DISABLE=1 tar --no-xattrs -C "$REPO_ROOT" \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='packages/*/node_modules' \
    -cf "$TMP_TAR" packages infra docs scratch package.json
  docker cp "$TMP_TAR" "$CONTAINER_NAME":/tmp/src-update.tar
  docker exec "$CONTAINER_NAME" tar -xf /tmp/src-update.tar -C /opt/webapp-ai-remote
  docker exec "$CONTAINER_NAME" rm -f /tmp/src-update.tar
  rm -f "$TMP_TAR"

  # サンドボックス用グループとsudoersの存在を保証
  docker exec "$CONTAINER_NAME" bash -c "groupadd -f ai-shared && mkdir -p /etc/sudoers.d && echo 'root ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/webapp-ai-remote && chmod 0440 /etc/sudoers.d/webapp-ai-remote"
else
  echo "1️⃣ 仮想EC2コンテナを起動中 ($IMAGE)..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    --add-host=host.docker.internal:host-gateway \
    "$IMAGE" sleep infinity

  echo "2️⃣ コンテナ内に前提パッケージ (Ansible, Python3, sudo, git) をインストール中..."
  if [[ "$IMAGE" == *"ubuntu"* ]] || [[ "$IMAGE" == *"debian"* ]]; then
    docker exec "$CONTAINER_NAME" bash -c "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ansible python3 sudo git tar"
  else
    docker exec "$CONTAINER_NAME" bash -c "dnf install -y ansible-core python3 sudo git tar"
  fi

  echo "3️⃣ リポジトリを仮想EC2コンテナへ転送中..."
  TMP_TAR=$(mktemp)
  COPYFILE_DISABLE=1 tar --no-xattrs -C "$REPO_ROOT" \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='packages/*/node_modules' \
    -cf "$TMP_TAR" .
  docker exec "$CONTAINER_NAME" mkdir -p /tmp/webapp-ai-remote
  docker cp "$TMP_TAR" "$CONTAINER_NAME":/tmp/repo.tar
  docker exec "$CONTAINER_NAME" tar -xf /tmp/repo.tar -C /tmp/webapp-ai-remote
  docker exec "$CONTAINER_NAME" rm -f /tmp/repo.tar
  rm -f "$TMP_TAR"

  echo "4️⃣ Ansible Playbook を仮想EC2コンテナ内で実行中 (約1分)..."
  docker exec "$CONTAINER_NAME" bash -c "cd /tmp/webapp-ai-remote/infra/ansible && ansible-playbook -i localhost, -c local playbook.yml -e is_container=true -e app_user=root -e hub_url=ws://host.docker.internal:8090/ws/agent"

  echo "💾 次回高速起動用にイメージを保存中 ($SIMULATOR_IMAGE)..."
  docker commit "$CONTAINER_NAME" "$SIMULATOR_IMAGE" >/dev/null
fi

echo "======================================================================"
echo "✅ 仮想EC2の準備が完了しました！"
echo "  - ディレクトリ: /data/base-repos, /data/workspaces, /data/logs"
echo "  - Node.js: $(docker exec "$CONTAINER_NAME" node -v)"
echo "  - Claude CLI: $(docker exec "$CONTAINER_NAME" bash -c 'command -v claude || echo installed')"
echo "======================================================================"
echo ""
echo "🚀 仮想EC2のコンテナ内で Bridge Agent を起動します..."
echo "※ 起動ログに表示されたURL (http://localhost:8090/?token=...) をブラウザで開いてください。"
echo "※ 終了したいときは Ctrl+C を押してください。"
echo "======================================================================"
echo ""

# コンテナ内で Agent を対話起動 (フォアグラウンド)
docker exec -it \
  -e HUB_URL="ws://host.docker.internal:8090/ws/agent" \
  -e BASE_DATA_DIR="/data" \
  -e ENABLE_USER_SANDBOX="true" \
  -e SANDBOX_USER_PREFIX="ai-" \
  -e SANDBOX_SHARED_GROUP="ai-shared" \
  -w /opt/webapp-ai-remote \
  "$CONTAINER_NAME" npm run agent
