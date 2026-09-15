# AI Agent Instruction Guide for AI Remote Cockpit (webapp-ai-remote)

このドキュメントは、AIエージェント（Antigravity / Claude / Pair Programmer）が本プロジェクトに参加した際に、**設計思想・開発動機・アーキテクチャ・セキュリティ方針・Claude Code連携仕様** を正確に理解し、ブレずに高品質な開発を継続するための総合ガイドです。

> [!IMPORTANT]
> **🎯 プロダクト作戦ノート & Next Actions (personal-vault)**:  
> 本プロダクトの全体ビジョン、現在地、ユーザーからの日常フィードバック、直近の Next Actions は [webapp-ai-remote.md](file:///Users/s-ikari/work/personal-vault/10_%E8%81%B7%E4%BA%BA%E3%83%BB%E7%99%BA%E6%98%8E%E5%AE%B6/webapp-ai-remote.md) に一元管理されています。実装着手・機能完了時は必ず確認・更新してください。

---

## 1. 🎯 プロジェクトの存在理由と開発動機

- **外出先（電車・移動中）からの社内AI開発**:
  - 自宅MacBookでの Antigravity remote や Claude cowork のように、外出先からスマホで手軽にAI開発を進めたい。
  - しかし会社環境では社内資産（社内DB、GitLab、社内認証、ローカルビルド環境等）へのアクセスが必須であり、社外SaaSトンネル（ngrokや各ツールの外部リモート機能）は社内ポリシー上利用できない。
- **社内PC ⇔ 社内AWS EC2 ⇔ 会社スマホ(Edge) の閉域リモート**:
  - 社内PCから社内EC2への「アウトバウンド通信」と、会社スマホEdgeからアクセス可能な社内AWS EC2（Nginx）を活用し、完全な社内閉域でリモート開発環境を構築する。
- **PTY（ターミナルエミュレーション）を捨て、Claude Code Agent SDKを活用**:
  - ターミナルを丸ごと中継する重厚な構成（PTY+tmux+xterm.js）ではなく、Claude Code の Agent SDK / `stream-json` と `--resume` をフル活用。
  - スマホ上ではChatGPT/Slackライクな「モダンなMarkdownチャットUI」を描画し、ツール実行要求（Bash, Edit）は「構造化された承認カード（ワンタップで許可/拒否）」として扱う。

---

## 2. 🛡️ コアアーキテクチャ原則（破ってはならないルール）

1. **外部クラウド/外部トンネルの不使用（完全閉域）**:
   - 通信は「会社PC ⇔ 社内AWS EC2 ⇔ 会社スマホ」の範囲内のみで完結させる。外部のプロキシやトンネルサービスに依存しない。
2. **社内PCからのアウトバウンド接続**:
   - 社内PCはファイアウォール・NATの内側にあるため、インバウンドポートを開放しない。社内PC側の常駐エージェント（Bridge Agent）から社内EC2のRelay Hubへ外向きWebSocket接続を張る。
3. **Claude Code ネイティブプロトコル（stream-json / Agent SDK）の遵守**:
   - ANSIターミナル文字列をパースするのではなく、改行区切りJSON（`stream-json`）またはAgent SDKのイベントストリームを使用する。
4. **セッション永続化と耐障害性**:
   - 電車移動などでの電波断（オフライン）を前提とし、Claude Code の `--resume <session_id>` を活用して復帰可能な設計とする。

---

## 3. 📦 システム構成案

- `packages/agent`: 社内PC常駐ブリッジ（Node.js / Claude Code SDK or CLI runner）
- `packages/hub`: 社内AWS EC2中継サーバ（軽量WebSocketリレー、Nginx裏）
- `packages/web`: 会社スマホ向けPWA（Vite + React + Tailwind + PWA、Edge最適化UI）
