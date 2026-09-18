# AI Remote Cockpit (webapp-ai-remote) 📱⚡

会社PCで稼働する **Claude Code** を、電車の中から **会社スマホ（Edge PWA）** で安全・快適に遠隔操作するためのモバイル開発コックピットです。

---

## 🌟 特徴

- 🚇 **電車・移動中からスマホでAI開発**: 移動時間・スキマ時間に社内PC上の Claude Code に指示を出し、開発を前進させられます。
- 🏢 **社内資産へのフルアクセス**: 社内PC上で直接Claude Codeが動作するため、社内リポジトリ、社内DB、ローカルビルド環境をそのまま活用可能。
- 💬 **ネイティブチャット＆カードUI**: PTY/ターミナルエミュレータを捨て、Claude Code の Agent SDK / `stream-json` による構造化UI（Markdown表示・シンタックスハイライト・ツール承認カード）。
- 🔒 **完全社内閉域**: 社外トンネルを使わず、社内PC（アウトバウンド） ⇔ 社内AWS EC2（Nginx） ⇔ 会社スマホ（社内VPN/Edge）のみで完結。
- 🔄 **セッション復帰（圏外対応）**: Claude Code の `--resume` 機能と連動し、地下鉄などの電波断でもシームレスに再接続。

---

## 🏛️ アーキテクチャ

```text
[会社スマホ (Edge / PWA)]
        │ HTTPS / WSS (社内VPN経由)
        ▼
[社内AWS EC2 (Nginx + Relay Hub)]
        │
        ▲ WSS (アウトバウンド常時接続)
[社内開発PC (常時起動)]
   └─ packages/agent (Bridge Agent)
   └─ Claude Code (Agent SDK / CLI stream-json)
```

---

## 📁 ディレクトリ構成

- `packages/agent/`: 社内PC上で常駐するエージェント（EC2への接続、Claude Codeの実行制御）
- `packages/hub/`: 社内EC2上で稼働する軽量WebSocket / HTTP中継サーバ
- `packages/web/`: スマホEdgeブラウザ向けPWA（React + Tailwind CSS）

---

## 🚀 クイックスタート

### 社内PC (Bridge Agent) の起動
```bash
# Windows 11 の場合
start-agent.bat
# または
npm run agent

# Linux / macOS の場合
./start-agent.sh
# または
npm run agent
```
※ 初回起動時に `.env` が自動生成されます。必要に応じて `HUB_URL` を社内 EC2 の接続先（例: `ws://<EC2_IP>:3001/ws/agent` など）に合わせて編集してください。
※ Claude Code CLI（`claude` または `claude.cmd`）がインストールされている必要があります。

