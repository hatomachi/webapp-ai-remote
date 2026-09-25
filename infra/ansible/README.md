# 🚀 Ansible による共有EC2自動構築ガイド

会社EC2に流し込むだけで、`webapp-ai-remote` によるマルチテナントAI開発基盤（Node.js, Git, Claude Code, Copilot CLI, ディレクトリ構造, cron）を10分で自動構築するPlaybookです。

---

## 1. 会社EC2での実行手順（本番）

素のEC2（Amazon Linux 2023 または Ubuntu 22.04/24.04）を起動後、EC2上で直接実行します。

```bash
# 1. Ansible のインストール (Amazon Linux 2023 の場合)
sudo dnf install -y ansible-core

# (Ubuntu の場合: sudo apt update && sudo apt install -y ansible)

# 2. リポジトリを配置（git clone または SCP）
cd /tmp/webapp-ai-remote/infra/ansible

# 3. インベントリ作成 & ローカル実行
cp inventory/hosts.example inventory/hosts
ansible-playbook -i localhost, -c local playbook.yml
```

---

## 2. 自宅Macでのローカル検証方法（Dockerコンテナ相手）

自宅で動作確認したい場合は、素のUbuntuコンテナをターゲットにしてAnsibleを実行できます。

```bash
# テスト用コンテナの起動
docker run -d --name test-ec2 -p 2222:22 ubuntu:22.04 sleep infinity

# コンテナ内でAnsibleテスト実行
docker exec -it test-ec2 bash -c "apt update && apt install -y ansible"
docker cp . test-ec2:/ansible
docker exec -it test-ec2 bash -c "cd /ansible && ansible-playbook -i localhost, -c local playbook.yml"

# 後片付け
docker rm -f test-ec2
```
