# 🚀 Ansible による共有EC2自動構築ガイド

会社EC2（Amazon Linux 2023 または Ubuntu 22.04/24.04 LTS）に流し込むだけで、`webapp-ai-remote` によるマルチテナントAI実行基盤（Docker, Docker Compose, Node.js 20, Git, Claude Code CLI, Copilot CLI, ディレクトリ構造, cron, systemd 常駐サービス）を約10分で完全自動セットアップするPlaybookです。

---

## 1. 会社EC2での実行手順（本番セットアップ）

素のEC2を起動後、EC2上で直接実行します。

### ① Ansible のインストール

- **Amazon Linux 2023 の場合**:
  ```bash
  sudo dnf install -y ansible-core python3 git
  ```
- **Ubuntu 22.04 / 24.04 の場合**:
  ```bash
  sudo apt update && sudo apt install -y ansible python3 git
  ```

### ② リポジトリの配置
```bash
# リポジトリを取得（git clone または SCP）
git clone <repo-url> /tmp/webapp-ai-remote
cd /tmp/webapp-ai-remote/infra/ansible
```

### ③ インベントリ作成 ＆ 実行
```bash
# インベントリ作成（EC2ローカル実行）
cp inventory/hosts.example inventory/hosts

# Playbook実行（ec2-user または ubuntu ユーザーで実行）
sudo ansible-playbook -i localhost, -c local playbook.yml

# ※ もし特定の実行ユーザーを指定したい場合:
# sudo ansible-playbook -i localhost, -c local playbook.yml -e app_user=ec2-user
```

### ④ 構築完了後の確認
Playbookの実行が完了すると、以下が自動的に構成・稼働します：
- **Docker & Docker Compose**: Nginx (ポート8090) と WebSocket Relay Hub (ポート3001) がコンテナ起動
- **Node.js 20 LTS & Claude Code CLI**: ホストOS上で稼働
- **データ領域**: `/data/base-repos`, `/data/workspaces`, `/data/logs` が生成
- **cron 同期**: 5分ごとに全ベースリポジトリが自動 `git fetch`
- **Bridge Agent サービス**: systemd ユニット `webapp-ai-remote-agent` が自動起動し、同機Hubへ接続

状態確認コマンド：
```bash
# Docker コンテナ状態
docker compose -f /opt/webapp-ai-remote/docker-compose.yml ps

# Agent サービス状態
sudo systemctl status webapp-ai-remote-agent

# Agent ログ確認
tail -f /data/logs/agent.log
```

---

## 2. 自宅Macでの自動検証（Docker環境）

自宅Mac上（Docker Desktop）で、本Playbookが正常に完走し、すべての構成が正しくセットアップされるかをワンコマンドで自動検証できます。

```bash
cd infra/ansible

# Ubuntu 22.04 コンテナで自動検証
./test/test-playbook.sh ubuntu:22.04

# Amazon Linux 2023 コンテナで自動検証
./test/test-playbook.sh amazonlinux:2023
```

テストスクリプトはコンテナを起動し、Playbookの実行、Node.js/Claude CLI/ディレクトリ/cron/systemd unitの存在チェック、および2回目実行での冪等性（Idempotency）までを全自動で検証します。
