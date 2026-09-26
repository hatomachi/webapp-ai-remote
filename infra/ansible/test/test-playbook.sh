#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-ubuntu:22.04}"
CONTAINER_NAME="test-ai-remote-ansible"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# macOS の docker-credential-desktop ハングを回避するためクリーンな一時 DOCKER_CONFIG を使用
CLEAN_DOCKER_DIR=$(mktemp -d)
echo '{"auths":{}}' > "$CLEAN_DOCKER_DIR/config.json"
export DOCKER_CONFIG="$CLEAN_DOCKER_DIR"

cleanup() {
  echo "🧹 Cleaning up container $CONTAINER_NAME..."
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$CLEAN_DOCKER_DIR"
}
trap cleanup EXIT

cleanup

echo "1️⃣ Launching test container ($IMAGE)..."
docker run -d --name "$CONTAINER_NAME" "$IMAGE" sleep infinity

echo "2️⃣ Installing prerequisites inside container..."
if [[ "$IMAGE" == *"ubuntu"* ]] || [[ "$IMAGE" == *"debian"* ]]; then
  docker exec "$CONTAINER_NAME" bash -c "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ansible python3 sudo tar"
elif [[ "$IMAGE" == *"amazonlinux"* ]] || [[ "$IMAGE" == *"centos"* ]] || [[ "$IMAGE" == *"fedora"* ]]; then
  docker exec "$CONTAINER_NAME" bash -c "dnf install -y ansible-core python3 sudo tar"
else
  docker exec "$CONTAINER_NAME" bash -c "echo 'Unsupported image: $IMAGE' && exit 1"
fi

echo "3️⃣ Copying repository to container..."
# node_modules や .git などの巨大ディレクトリを除いて転送
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

echo "4️⃣ Running Ansible Playbook (First Run)..."
docker exec "$CONTAINER_NAME" bash -c "cd /tmp/webapp-ai-remote/infra/ansible && ansible-playbook -i localhost, -c local playbook.yml -e is_container=true -e app_user=root"

echo "5️⃣ Verifying Setup..."
echo "  - Checking Node.js version:"
NODE_VER=$(docker exec "$CONTAINER_NAME" node -v)
echo "    Node version: $NODE_VER"
if [[ "$NODE_VER" != v20* ]]; then
  echo "    ❌ ERROR: Node.js version is not v20.x!"
  exit 1
fi

echo "  - Checking Claude Code CLI:"
CLAUDE_PATH=$(docker exec "$CONTAINER_NAME" bash -c "command -v claude || which claude || true")
echo "    Claude path: $CLAUDE_PATH"
if [ -z "$CLAUDE_PATH" ]; then
  echo "    ❌ ERROR: claude binary not found in PATH!"
  exit 1
fi

echo "  - Checking Directories:"
for dir in /data /data/base-repos /data/workspaces /data/logs /opt/webapp-ai-remote; do
  docker exec "$CONTAINER_NAME" test -d "$dir"
  echo "    Directory $dir: OK"
done

echo "  - Checking Deployed PWA HTML:"
docker exec "$CONTAINER_NAME" test -f /opt/webapp-ai-remote/docker/nginx/html/index.html
echo "    Nginx HTML index.html: OK"

echo "  - Checking Cron Job:"
CRON_OUTPUT=$(docker exec "$CONTAINER_NAME" crontab -l)
echo "    Crontab configured: OK"
if ! echo "$CRON_OUTPUT" | grep -q "Sync all base-repos"; then
  echo "    ❌ ERROR: cron job not found!"
  exit 1
fi

echo "  - Checking Systemd Service Template:"
docker exec "$CONTAINER_NAME" test -f /etc/systemd/system/webapp-ai-remote-agent.service
echo "    Agent systemd unit: OK"

echo "  - Checking Agent .env:"
docker exec "$CONTAINER_NAME" test -f /opt/webapp-ai-remote/packages/agent/.env
echo "    Agent .env file: OK"

echo "6️⃣ Testing Idempotency (Second Run)..."
SECOND_RUN=$(docker exec "$CONTAINER_NAME" bash -c "cd /tmp/webapp-ai-remote/infra/ansible && ansible-playbook -i localhost, -c local playbook.yml -e is_container=true -e app_user=root")
echo "$SECOND_RUN" | tail -n 5

if echo "$SECOND_RUN" | grep -q "failed=[1-9]"; then
  echo "  ❌ ERROR: Second run failed!"
  exit 1
fi

echo "======================================================================"
echo "✅ All Ansible tests passed successfully on $IMAGE!"
echo "======================================================================"
