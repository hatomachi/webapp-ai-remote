# 共有EC2マルチテナントAI実行基盤 設計仕様書 (Shared EC2 Platform Spec)

> **対象**: `webapp-ai-remote` (Hub / Agent / Web) ＋ `infra/ansible`  
> **更新日**: 2026-09-25  
> **ステータス**: 設計確定 ＆ 実装準備完了

---

## 1. 🎯 目的と背景

- **課題**:
  - `webapp-obsidian`（Confluence相当のVault）や各システムIaC・設計書リポジトリが巨大化。
  - メンバー全員が各自のPCに全量 `git clone` するとディスクが枯渇し、不経済。
- **解決方針**:
  - 会社用EC2（1台）に全リポジトリの大元（ベース）を集約。
  - メンバーは電車内スマホ（PWA）からアクセスし、各自のGitHub/Copilot/Claudeトークンで安全にAIを実行。
  - `git worktree` により、追加ディスク消費ゼロでメンバーごとの完全分離された作業ツリーを提供。
  - 自宅で作った Ansible Playbook により、会社EC2を「1コマンド・10分」で全自動セットアップ。
  - PWAの管理パネルから、スマホ完結で「新リポジトリのクローン」や「メンバー利用状況の把握」を行う。

---

## 2. 🏗️ ディレクトリ構造（EC2ホストOS）

```text
/data/
├── base-repos/                             # 【大元リポジトリ群】（GitLab Deploy Tokenでclone、Read-Only）
│   ├── confluence-vault/                   # 全社ナレッジ（Obsidian Vault）
│   ├── system-a-iac/                       # AWS/Terraform
│   ├── system-a-design/                    # API仕様・設計書
│   └── ...                                 # PWA管理パネルから動的追加可能
│
├── workspaces/                             # 【メンバー別作業領域】
│   ├── tanaka/                             # 田中さんの作業スペース（AIの cwd 起点）
│   │   ├── AGENTS.md                       # AI向けワークスペース全体案内
│   │   ├── confluence-vault/  (worktree)   # branch: user/tanaka
│   │   ├── system-a-iac/      (worktree)   # branch: user/tanaka
│   │   └── system-a-design/   (worktree)   # branch: user/tanaka
│   │
│   └── sato/                               # 佐藤さんの作業スペース（AIの cwd 起点）
│       ├── AGENTS.md
│       ├── confluence-vault/  (worktree)   # branch: user/sato
│       └── ...
│
└── logs/                                   # Hub/Agent ログ
```

---

## 3. 🛡️ セキュリティ ＆ 認証分離アーキテクチャ

### ① 大元リポジトリ（base-repos）の安全化
- **認証**: GitLab / GitHub の **Deploy Token / Deploy Key（`read_repository` スコープのみ）** を使用。
- **安全性**: 個人アカウントのPAT（強い権限）は一切EC2に保存しない。万一漏洩しても閲覧権限しかなく改ざん・Push不可。
- **自動同期**: cron により 5分おきに各リポジトリで `git fetch --all` をバックグラウンド実行。

### ② メンバー個人の認証・名義分離（プロセス動的注入）
- **保存場所**: メンバー個人のトークン（GitHub PAT, GitLab Token, Claude API Key, 氏名, Email）は、**個人の端末（PWAのlocalStorage）にのみ保存**。EC2のファイルには保存しない。
- **実行時注入**: プロンプト送信時（`SendPromptMessage`）のペイロードに `credentials` を含め、Agent が `child_process.spawn` を呼ぶ瞬間だけプロセスの環境変数に注入：
  ```ts
  const env = {
    ...process.env,
    GH_TOKEN: req.credentials?.copilotToken || process.env.GH_TOKEN,
    ANTHROPIC_API_KEY: req.credentials?.claudeApiKey || process.env.ANTHROPIC_API_KEY,
    GIT_AUTHOR_NAME: req.credentials?.userName || 'AI Remote User',
    GIT_AUTHOR_EMAIL: req.credentials?.userEmail || 'ai-remote@internal',
    GIT_COMMITTER_NAME: req.credentials?.userName || 'AI Remote User',
    GIT_COMMITTER_EMAIL: req.credentials?.userEmail || 'ai-remote@internal',
  };
  ```
- **Git Push時の認証**:
  - GitLab HTTPS通信時: `git -c "http.extraHeader=PRIVATE-TOKEN: ${gitlabToken}" push origin user/tanaka`
  - GitHub通信時: `GH_TOKEN` により自動認証

---

## 4. 🔄 通信プロトコル拡張仕様（`protocol.ts`）

### A. ユーザープロファイル ＆ 認証情報（Prompt送信時）
```ts
export interface UserCredentials {
  userName?: string;        // 例: "Taro Tanaka" (コミット名義・worktree名)
  userEmail?: string;       // 例: "tanaka@company.co.jp"
  copilotToken?: string;    // ghp_xxxx
  claudeApiKey?: string;    // sk-ant-xxxx
  gitlabToken?: string;     // glpat-xxxx
}

export interface SendPromptMessage {
  type: 'prompt';
  text: string;
  sessionId?: string;
  isResume?: boolean;
  cwd?: string;
  permissionMode?: PermissionMode;
  model?: string;
  engine?: AIEngine;
  reasoningEffort?: string;
  attachments?: AttachmentItem[];
  credentials?: UserCredentials; // ★ 追加
}
```

### B. 管理者パネル用メッセージ（Admin Protocol）
```ts
// --- リポジトリ管理 ---
export interface AdminListReposMessage { type: 'admin:list_repos'; }
export interface AdminReposListMessage {
  type: 'admin:repos_list';
  repos: {
    name: string;
    path: string;
    branch: string;
    lastCommit: string;
    lastUpdated: string;
    sizeBytes: number;
  }[];
}

export interface AdminCloneRepoMessage {
  type: 'admin:clone_repo';
  repoUrl: string;
  deployToken?: string;
  deployUser?: string;
  name?: string;
}

// --- メンバー・Worktree管理 ---
export interface AdminListWorkspacesMessage { type: 'admin:list_workspaces'; }
export interface AdminWorkspacesListMessage {
  type: 'admin:workspaces_list';
  workspaces: {
    userName: string;
    path: string;
    sizeBytes: number;
    lastActive: string;
    repos: { name: string; branch: string }[];
  }[];
  diskStats: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
  };
}

export interface AdminCleanupWorkspaceMessage {
  type: 'admin:cleanup_workspace';
  userName: string;
}
```

---

## 5. 🚀 Ansible 構成設計（`infra/ansible/`）

- **実行方式**: 素のEC2上で `ansible-playbook -i localhost, -c local playbook.yml`（ローカル実行モード）
- **Roles構成**:
  - `roles/common`: `git`, `ripgrep`, `curl`, `jq`, `tmux`, `cron`, `sudo` のインストール
  - `roles/docker`: Docker ＆ Docker Compose の導入
  - `roles/ai_tools`: Node.js 20 LTS, Claude Code CLI, Copilot CLI
  - `roles/webapp_remote`:
    - ディレクトリ生成（`/data/base-repos`, `/data/workspaces`, `/data/logs`）
    - 定期 `git fetch` cron ジョブ登録
    - Nginx ＆ Hub コンテナ起動（Docker Compose）
    - Agent サービスの起動（systemd unit）
    - 共有グループ（`ai-shared`）および権限降格用 `sudoers` 設定（`/etc/sudoers.d/webapp-ai-remote`）

---

## 6. 🔒 Linuxユーザー分離 ＆ ワークスペース権限サンドボックス（Phase 4）

### ① 脅威モデルと分離の必要性
- 共有EC2上で複数メンバーが同時にAI CLI（Claude Code / Copilot CLI）を実行する際、AIのBash実行ツールにより他人のワークスペースを閲覧・改ざんしたり、ホストOSを侵害するリスクを排除する。

### ② アーキテクチャと実装方針
1. **OSユーザー自動マッピング**:
   - メンバー名（例: `Taro Tanaka`）に基づき、一意な非特権Linuxユーザー（例: `ai-taro-tanaka`）を自動マッピング・生成（POSIX規格準拠、最大32文字、英数字・ハイフン）。
   - 共通グループ `ai-shared` に所属させ、大元リポジトリ（`base-repos`）への読み取り権限（Read-only）を確保。
2. **ワークスペース権限サンドボックス (`chmod 700`)**:
   - 各メンバーの作業ツリー `/data/workspaces/<user>` は所有者を `ai-<user>` に設定し、パーミッションを `chmod 700`（所有者のみアクセス可能）に制限。
   - 他メンバー（`ai-sato`）からは `taro-tanaka` のワークスペースはディレクトリ進入すら拒否（`Permission denied`）され、物理的に完全隔離。
3. **AIプロセスのサンドボックス起動**:
   - Agent（管理デーモン）から AI CLI を `spawn` する際、`sudo -u <osUser> -H -E ...` または `spawn` の `uid`/`gid` オプションにより、非特権 OS ユーザー権限に降格して実行。
   - `HOME=/home/<osUser>`, `USER=<osUser>` を設定し、AI CLI の設定・キャッシュ（`~/.claude/`, `~/.copilot/`）もメンバーごとに完全分離。
   - 非Linux環境（macOS/Windows）やサンドボックス無効時は、安全に通常実行へフォールバック（Graceful Fallback）。

---

## 7. 🛡️ 権限分離・ユーザー認証・インフラ保護（Phase 5）

### ① Session 5-1: Hub 個別ルーティング ＆ ツール承認・Abort の所有者限定化
- **Hub 個別配信**: `clientId` に基づくルーティングにより、ストリーミングやイベントの他クライアントへの誤送信・混線を完全防止。
- **Agent 操作認可**: ツール承認（`tool_approval_response`）および中断（`abort`）を実行元クライアント／ユーザー名（`userName`）に紐付け、他者による操作横取りを防止（同一ユーザーの別端末引き継ぎは安全に許可）。

### ② Session 5-2: Admin 機能のトークン保護 ＆ ワークスペース自己初期化認可
- **Admin Token**: `ADMIN_TOKEN` 環境変数による管理者保護。大元 clone（`admin:clone_repo`）や全メンバー一覧（`admin:list_workspaces`）を管理者専用に制限（403 Forbidden）。
- **ワークスペース削除の認可分離**: 一般メンバーは自己のワークスペース（`userName` 一致）の Worktree リセットのみ許可し、他人の領域削除をブロック。

### ③ Session 5-3: メインGitLab PAT動的検証による個人認証 ＆ セッション履歴の本人限定化
- **動的個人認証（GitLab API検証）**: `gitlabToken`（`/api/v4/user`）を API 検証し、公式の `username` を動的確定・身元バインド。自己申告のなりすましを排除（SHA-256 キャッシュにより 0ms 高速化）。
- **セッション履歴の本人限定化**: セッションに `owner` を記録し、一覧・詳細取得・削除を本人のみに限定。

### ④ Session 5-4: OS/AWS インフラ保護 ＆ リポジトリ Deploy Token 保護
- **AWS メタデータ（IMDS）のカーネルレベル遮断**:
  - 脅威: AI CLI（Claude Code / Copilot CLI）の Bash 実行により、EC2 メタデータエンドポイント（`http://169.254.169.254/latest/meta-data/`）から IAM ロール一時クレデンシャルが窃取されるリスク。
  - 対策:
    - サンドボックスユーザー作成時、プライマリグループを `ai-shared` に設定（ソケットの実効 GID を統一）。
    - `iptables` により、`ai-shared` グループからの `169.254.169.254` への送信パケットを即座に `REJECT`（Connection Refused）。管理プロセス（root / app_user）の通信は阻害せず、AI 実行プロセスのみ確実に遮断。
    - AWS IMDSv2（ホップリミット 1）を推奨設定とし多層防御。
- **大元リポジトリ Deploy Token の平文露出防止 ＆ クレデンシャル分離**:
  - 脅威: 大元リポジトリ（`/data/base-repos/*`）の `.git/config` に Deploy Token（`https://user:token@gitlab...`）が記録されると、Worktree 内で作業する非特権メンバー（`ai-*`）からトークンが閲覧・窃取されるリスク。
  - 対策:
    - `WorkspaceManager.cloneRepo`: クローン完了直後に `git remote set-url origin <cleanUrl>` を実行し、大元の `.git/config` からトークンを完全に除去（サニタイズ）。
    - 認証情報は所有者のみアクセス可能なセキュアファイル（`/data/.git-credentials`、パーミッション `0600`）に隔離保存。
    - 大元リポジトリに `credential.helper = "store --file=/data/.git-credentials"` を設定し、管理プロセスの定期 fetch cron は支障なく動作。
    - 非特権ユーザー（`ai-*`）はクレデンシャルファイルへの読み取り権限を持たない（`Permission denied`）ためトークン漏洩を防止しつつ、Worktree でのローカル Git 操作（`git status`, `git commit` 等）は 100% 正常動作。
    - `sanitizeBaseRepoConfigs()` により、既存の大元リポジトリ群も起動時に全自動でトークン除去・セキュア化。


