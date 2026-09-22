# 🧪 無停止・並行検証ガイド (Blue-Green / Canary Test Guide)

このドキュメントは、**現在稼働中の本番リモート回線（Claude Code 中継ライン）を 1 秒も停止・変更せず**、横に独立した検証用ライン（GitHub Copilot CLI 中継ライン）を並行構築して、スマホや開発機からの動作確認を安全に行うための手順書です。

---

## 🏗️ 全体アーキテクチャ（並行中継ライン）

既存のメイン回線とは別に、ポート・URLサブパス・常駐プロセスを完全に独立させた検証用ラインを立ち上げます。

```text
【現行メインライン（Claude Code）: 変更なし・無停止稼働】
📱 クライアント端末 (PWA: /ai/)
       │
       ▼ Nginx (リバースプロキシ)
  /ai/ ───> Hub 1 (Port 3001) <──[アウトバウンド]── Agent 1 (Claude Code)
                                                      (実行マシン)

────────────────────────────────────────────────────────────────────────

【新規検証ライン（GitHub Copilot）: 完全独立・お試し用】
📱 クライアント端末 (PWA: /copilot/)
       │
       ▼ Nginx (リバースプロキシ)
  /copilot/ ──> Hub 2 (Port 3002) <──[アウトバウンド]── Agent 2 (Copilot CLI)
                                                          (実行マシン)
```

### 💡 なぜ安全なのか？
1. **実行マシン（開発機）側のポート競合がゼロ**:
   - Agent は外部へのアウトバウンド（外向き WebSocket / HTTP）接続のみを行うため、待ち受けポートを開きません。同じマシン上で 2 つの Agent を並行起動しても競合しません。
2. **中継サーバー側の Nginx は無停止**:
   - Nginx に新しい `location /copilot/` を追記して `nginx -s reload` を実行するだけなので、メインラインの接続を切断しません。
3. **PWA はサブパス自動検出に対応済み**:
   - ビルド成果物を `/usr/share/nginx/html/copilot/` などのサブディレクトリに配置するだけで、自動的に `/copilot/` 配下のパスを認識して動作します。

---

## 📋 構築手順（3ステップ）

### ステップ 1: 中継サーバー（リバースプロキシ・Hub側）の設定

中継サーバー（EC2等）上で、検証用 Hub コンテナと Nginx パスを追加します。

#### 1) `docker-compose.yml` に検証用 Hub サービスを追加
既存の `hub` を残したまま、`hub-copilot`（Port 3002）を追加します。
```yaml
services:
  hub:
    # 既存のメインHub (Port 3001) はそのまま維持
    image: node:20-alpine
    working_dir: /app
    volumes: [".:/app"]
    command: node packages/hub/src/index.js
    environment: [PORT=3001]
    expose: ["3001"]

  hub-copilot:
    # 🆕 新設の検証用Hub (Port 3002)
    image: node:20-alpine
    working_dir: /app
    volumes: [".:/app"]
    command: node packages/hub/src/index.js
    environment: [PORT=3002]
    expose: ["3002"]
    restart: unless-stopped

  nginx:
    # ...既存のNginx定義
```

コンテナを起動・反映します（既存コンテナは停止しません）：
```bash
docker compose up -d hub-copilot
```

#### 2) `nginx.conf` に検証用パス `/copilot/` を追加
既存の `upstream` と `server` ブロックに追記します。
```nginx
upstream hub_copilot_backend {
    server hub-copilot:3002;
}

server {
    listen 80; # または 443 ssl
    # ...既存設定...

    # 🆕 検証用 PWA 静的ファイル配信
    location /copilot/ {
        alias /usr/share/nginx/html/copilot/;
        try_files $uri $uri/ /copilot/index.html;
    }

    # 🆕 検証用 HTTP / SSE 中継
    location ~ ^/copilot/(api/|events|message) {
        rewrite ^/copilot/(.*)$ /$1 break;
        proxy_pass http://hub_copilot_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        chunked_transfer_encoding on;
    }

    # 🆕 検証用 WebSocket 中継 (/copilot/ws/agent, /copilot/ws/client)
    location /copilot/ws/ {
        rewrite ^/copilot/ws/(.*)$ /ws/$1 break;
        proxy_pass http://hub_copilot_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

#### 3) 検証用 PWA のビルドと配置
最新のコードから PWA をビルドし、`/copilot/` ディレクトリに配備します。
```bash
npm run web:build
mkdir -p docker/nginx/html/copilot
cp -r packages/web/dist/* docker/nginx/html/copilot/
```

Nginx 設定をリロードします（ダウンタイムなし）：
```bash
docker compose exec nginx nginx -s reload
```

---

### ステップ 2: 実行マシン（開発PC / サーバー側）の準備

#### 1) GitHub Copilot CLI のインストールと疎通確認
実行マシンに GitHub Copilot CLI が入っているか確認し、未セットアップの場合はログインします。
```bash
# バージョン確認
copilot --version

# ログイン（初回のみ、ブラウザまたはデバイスコードで認証）
copilot login

# 非対話テスト実行（疎通確認）
copilot -p "echo Copilot CLI OK" --allow-all-tools
```

#### 2) 検証用 Agent の起動
既存の Agent を起動したまま、別のターミナルで検証用 Hub に向けて起動します。
```bash
# WebSocket 接続の場合:
HUB_URL=wss://<YOUR_HOST_OR_IP>/copilot/ws/agent npm run agent

# 社内プロキシ・ZTNA等で HTTP (SSE+POST) を使用する場合:
HUB_URL=https://<YOUR_HOST_OR_IP>/copilot npm run agent
```

起動すると、ターミナルに以下のような接続用 URL が表示されます：
```text
[Agent] 🔗 Mobile Pairing URL:
https://<YOUR_HOST_OR_IP>/copilot/?token=<ランダムUUID>&transport=auto
```

---

### ステップ 3: クライアント端末（スマホ等）からの動作確認

1. **メイン回線の確認**:
   - 既存のホーム画面アイコンや `/ai/` の URL は、そのまま Claude Code と接続された状態で稼働しています。
2. **検証用 URL のオープン**:
   - スマホのブラウザ（Edge / Safari / Chrome）で、ステップ 2 で表示された `https://<YOUR_HOST_OR_IP>/copilot/?token=...` を開きます。
3. **Engine の選択と実行テスト**:
   - チャット画面フッターの操作バーにある **`Engine:`** プルダウンを確認します。
   - `GitHub Copilot` を選択します。
   - プロンプト入力欄に「`現在のディレクトリの構成を教えて`」等を入力して送信します。
   - **Copilot によるリアルタイムテキスト描画** および **ツール実行（ToolUseCard: glob, ls, view 等）** が画面上に美しく展開されれば並行検証は成功です！

---

## 🧹 撤収手順（テスト完了後）

検証が完了し、元の 1 本構成に戻す場合は以下を実行するだけで安全に片付けられます。

1. 実行マシン側: 検証用 Agent プロセスを `Ctrl+C` で終了。
2. 中継サーバー側:
   - `docker compose stop hub-copilot && docker compose rm -f hub-copilot`
   - `nginx.conf` から追加した `/copilot/` ブロックを削除し、`nginx -s reload`
   - `rm -rf docker/nginx/html/copilot/`
