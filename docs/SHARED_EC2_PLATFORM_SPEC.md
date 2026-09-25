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
  - `roles/common`: `git`, `ripgrep`, `curl`, `jq`, `tmux`, `cron` のインストール
  - `roles/docker`: Docker ＆ Docker Compose の導入
  - `roles/ai_tools`: Node.js 20 LTS, Claude Code CLI, Copilot CLI
  - `roles/webapp_remote`:
    - ディレクトリ生成（`/data/base-repos`, `/data/workspaces`, `/data/logs`）
    - 定期 `git fetch` cron ジョブ登録
    - Nginx ＆ Hub コンテナ起動（Docker Compose）
    - Agent サービスの起動（systemd unit）
