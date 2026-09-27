import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { SandboxManager, SandboxManagerOptions } from './sandboxManager.js';

export interface GitLabHostCredential {
  host: string;    // 例: "gitlab-sub.internal.example.com"
  token: string;   // glpat-xxxx (サブGitLabのPAT)
}

export interface UserCredentials {
  userName?: string;
  userEmail?: string;
  copilotToken?: string;
  claudeApiKey?: string;
  gitlabToken?: string;
  extraGitlabTokens?: GitLabHostCredential[];
}

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
}

export interface AdminRepoItem {
  name: string;
  path: string;
  branch: string;
  lastCommit: string;
  lastUpdated: string;
  sizeBytes: number;
}

export interface WorkspaceRepoItem {
  name: string;
  branch: string;
  path: string;
}

export interface WorkspaceItem {
  userName: string;
  path: string;
  sizeBytes: number;
  lastActive: string;
  repos: WorkspaceRepoItem[];
}

export interface DiskStats {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
}

export interface WorkspaceManagerOptions {
  baseReposDir?: string;
  workspacesDir?: string;
  credentialsFile?: string;
  sandboxManager?: SandboxManager;
  sandboxOptions?: SandboxManagerOptions;
}

export class WorkspaceManager {
  public readonly baseReposDir: string;
  public readonly workspacesDir: string;
  public readonly credentialsFile: string;
  public readonly isMultiTenant: boolean;
  public readonly sandboxManager: SandboxManager;

  constructor(options?: WorkspaceManagerOptions) {
    const defaultDataDir = process.env.BASE_DATA_DIR || '/data';
    this.baseReposDir = options?.baseReposDir || process.env.BASE_REPOS_DIR || path.join(defaultDataDir, 'base-repos');
    this.workspacesDir = options?.workspacesDir || process.env.WORKSPACES_DIR || path.join(defaultDataDir, 'workspaces');
    this.credentialsFile = options?.credentialsFile || process.env.GIT_CREDENTIALS_FILE || path.join(defaultDataDir, '.git-credentials');
    this.sandboxManager = options?.sandboxManager || new SandboxManager(options?.sandboxOptions);

    // マルチテナントモードの判定: baseReposDir が存在するか、明示的に MULTI_TENANT=true の場合
    const envExplicit = process.env.MULTI_TENANT === 'true';
    const dirsExist = fs.existsSync(this.baseReposDir) && fs.existsSync(this.workspacesDir);
    this.isMultiTenant = Boolean(options?.baseReposDir || envExplicit || dirsExist);

    if (this.isMultiTenant) {
      console.log(`[WorkspaceManager] Multi-tenant mode ACTIVE.`);
      console.log(`[WorkspaceManager] Base repos dir: ${this.baseReposDir}`);
      console.log(`[WorkspaceManager] Workspaces dir: ${this.workspacesDir}`);
      console.log(`[WorkspaceManager] Credentials file: ${this.credentialsFile}`);

      // 既存の大元リポジトリの URL を検査し、トークンが平文保存されていれば自動サニタイズ
      this.sanitizeBaseRepoConfigs();
    } else {
      console.log(`[WorkspaceManager] Single-tenant / Standalone mode active.`);
    }
  }

  /**
   * ユーザー名をディレクトリ名およびGitブランチ名として安全な文字列にサニタイズ
   * 例: "Taro Tanaka" -> "taro-tanaka", "user@company.com" -> "user"
   */
  public sanitizeUserName(rawName?: string): string {
    if (!rawName || typeof rawName !== 'string') {
      return process.env.DEFAULT_USER || 'default';
    }

    // メールアドレスの場合はローカルパートを抽出
    let cleaned = rawName.includes('@') ? rawName.split('@')[0] : rawName;
    cleaned = cleaned.trim().toLowerCase();

    // 英数字・ハイフン・アンダースコア以外をハイフンに置換
    cleaned = cleaned.replace(/[^a-z0-9_-]+/g, '-');
    cleaned = cleaned.replace(/^-+|-+$/g, '');

    return cleaned || process.env.DEFAULT_USER || 'default';
  }

  /**
   * メンバー別ワークスペースと git worktree をオンデマンドで自動生成・確保
   */
  public ensureUserWorkspace(userName?: string): {
    userWorkspaceDir: string;
    sanitizedUser: string;
    worktrees: WorktreeInfo[];
    osUser?: string;
    isSandboxed: boolean;
  } {
    const sanitizedUser = this.sanitizeUserName(userName);
    const userWorkspaceDir = path.join(this.workspacesDir, sanitizedUser);

    if (!fs.existsSync(userWorkspaceDir)) {
      fs.mkdirSync(userWorkspaceDir, { recursive: true });
      console.log(`[WorkspaceManager] Created workspace directory: ${userWorkspaceDir}`);
    }

    const worktrees: WorktreeInfo[] = [];

    // base-repos ディレクトリが存在する場合のみ Git リポジトリを走査して worktree を生成
    if (fs.existsSync(this.baseReposDir)) {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(this.baseReposDir, { withFileTypes: true });
      } catch (err: any) {
        console.warn(`[WorkspaceManager] Failed to read baseReposDir (${this.baseReposDir}):`, err.message);
      }

      const branchName = `user/${sanitizedUser}`;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const repoName = entry.name;
        const baseRepoPath = path.join(this.baseReposDir, repoName);
        const isGit = fs.existsSync(path.join(baseRepoPath, '.git')) || fs.existsSync(path.join(baseRepoPath, 'HEAD'));
        if (!isGit) continue;

      const targetPath = path.join(userWorkspaceDir, repoName);

      // すでに worktree が存在するか確認
      let worktreeReady = false;
      if (fs.existsSync(targetPath)) {
        const dotGit = path.join(targetPath, '.git');
        if (fs.existsSync(dotGit)) {
          worktreeReady = true;
        } else {
          // 不完全なディレクトリがある場合は削除して再生成
          try {
            fs.rmSync(targetPath, { recursive: true, force: true });
          } catch {}
        }
      }

      if (!worktreeReady) {
        try {
          // 孤立した古い worktree 参照をクリーンアップ
          try {
            execSync('git worktree prune', { cwd: baseRepoPath, stdio: 'pipe' });
          } catch {}

          // 該当ブランチが既に存在するか確認
          let hasBranch = false;
          try {
            const branches = execSync('git branch --list', { cwd: baseRepoPath, encoding: 'utf-8' });
            hasBranch = branches.split('\n').some(b => b.replace(/^\*?\s+/, '').trim() === branchName);
          } catch {}

          if (hasBranch) {
            execSync(`git worktree add "${targetPath}" "${branchName}"`, {
              cwd: baseRepoPath,
              stdio: 'pipe'
            });
          } else {
            execSync(`git worktree add -B "${branchName}" "${targetPath}" HEAD`, {
              cwd: baseRepoPath,
              stdio: 'pipe'
            });
          }

          console.log(`[WorkspaceManager] Successfully added worktree for '${repoName}' at: ${targetPath} (branch: ${branchName})`);
          worktreeReady = true;
        } catch (err: any) {
          console.error(`[WorkspaceManager] Failed to create worktree for ${repoName}:`, err.message);
        }
      }

      if (worktreeReady) {
        worktrees.push({
          name: repoName,
          path: targetPath,
          branch: branchName
        });
      }
    }
  }

    // ワークスペース直下に AGENTS.md がなければ自動生成
    const agentsMdPath = path.join(userWorkspaceDir, 'AGENTS.md');
    if (!fs.existsSync(agentsMdPath)) {
      try {
        const content = this.generateAgentsMd(sanitizedUser, worktrees);
        fs.writeFileSync(agentsMdPath, content, 'utf-8');
      } catch (err: any) {
        console.warn(`[WorkspaceManager] Failed to write AGENTS.md for ${sanitizedUser}:`, err.message);
      }
    }

    // サンドボックス権限の適用（OSユーザー確保 & chmod 700 & chown）
    let osUser: string | undefined;
    let isSandboxed = false;
    if (this.sandboxManager.enabled) {
      osUser = this.sandboxManager.mapToOsUser(sanitizedUser);
      this.sandboxManager.ensureOsUser(osUser);
      this.sandboxManager.applyWorkspacePermissions(userWorkspaceDir, osUser);
      isSandboxed = true;
    }

    return {
      userWorkspaceDir,
      sanitizedUser,
      worktrees,
      osUser,
      isSandboxed
    };
  }

  /**
   * ワークスペース用 AGENTS.md の生成
   */
  private generateAgentsMd(userName: string, worktrees: WorktreeInfo[]): string {
    const repoList = worktrees.length > 0
      ? worktrees.map(w => `- **${w.name}** (\`${w.name}/\`): branch \`${w.branch}\``).join('\n')
      : '- *(現在ベースリポジトリは登録されていません)*';

    return `# AI Workspace Guide for ${userName}

このディレクトリは、共有EC2環境上でメンバー専用に自動生成された作業スペース（Git Worktree）です。

## 📁 含まれるリポジトリ
${repoList}

## 🛡️ ルール ＆ ガイドライン
1. **個人ブランチでの作業**:
   - 各リポジトリは \`user/${userName}\` ブランチにチェックアウトされています。
   - 変更は自由にコミット・テスト可能です。大元リポジトリや他メンバーの作業には一切影響しません。
2. **プッシュ時の注意事項**:
   - 社内GitLab/GitHubへのPush時は、自身の個人ブランチ \`user/${userName}\` に対して行ってください。
3. **コミット名義**:
   - プロンプト実行時に指定したユーザー名・メールアドレスで自動コミットされます。
`;
  }

  /**
   * ユーザー向けプロジェクト一覧の走査
   */
  public scanUserProjects(userName?: string, fallbackCwd?: string): {
    baseDir: string;
    projects: { id: string; name: string; path: string; isGit: boolean }[];
  } {
    if (!this.isMultiTenant) {
      return {
        baseDir: fallbackCwd || process.cwd(),
        projects: []
      };
    }

    const { userWorkspaceDir, sanitizedUser, worktrees } = this.ensureUserWorkspace(userName);

    const projects: { id: string; name: string; path: string; isGit: boolean }[] = [];

    // 1. ワークスペースルート自身を最上位プロジェクトとして登録（全体を俯瞰して作業したい場合）
    projects.push({
      id: `workspace-${sanitizedUser}`,
      name: `[Workspace] ${sanitizedUser}`,
      path: userWorkspaceDir,
      isGit: false
    });

    // 2. 各 worktree を個別のプロジェクトとして登録
    for (const wt of worktrees) {
      projects.push({
        id: `repo-${wt.name}`,
        name: wt.name,
        path: wt.path,
        isGit: true
      });
    }

    return {
      baseDir: userWorkspaceDir,
      projects
    };
  }

  /**
   * リクエストごとの環境変数を動的構築（認証・コミット名義の注入）
   * 親プロセスの process.env は一切汚染しない
   */
  public buildChildProcessEnv(credentials?: UserCredentials): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FORCE_COLOR: '0'
    };

    if (!credentials) return env;

    // コミット名義の動的注入
    if (credentials.userName && credentials.userName.trim()) {
      env.GIT_AUTHOR_NAME = credentials.userName.trim();
      env.GIT_COMMITTER_NAME = credentials.userName.trim();
    }
    if (credentials.userEmail && credentials.userEmail.trim()) {
      env.GIT_AUTHOR_EMAIL = credentials.userEmail.trim();
      env.GIT_COMMITTER_EMAIL = credentials.userEmail.trim();
    }

    // GitHub PAT / Copilot Token
    if (credentials.copilotToken && credentials.copilotToken.trim()) {
      env.GH_TOKEN = credentials.copilotToken.trim();
      env.GITHUB_TOKEN = credentials.copilotToken.trim();
    }

    // Claude API Key
    if (credentials.claudeApiKey && credentials.claudeApiKey.trim()) {
      env.ANTHROPIC_API_KEY = credentials.claudeApiKey.trim();
    }

    // GitLab Token
    if (credentials.gitlabToken && credentials.gitlabToken.trim()) {
      env.GITLAB_TOKEN = credentials.gitlabToken.trim();
    }

    return env;
  }

  /**
   * 【Admin API】大元リポジトリ（base-repos）の一覧取得
   */
  public listBaseRepos(): AdminRepoItem[] {
    if (!fs.existsSync(this.baseReposDir)) {
      return [];
    }

    const repos: AdminRepoItem[] = [];
    const entries = fs.readdirSync(this.baseReposDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const repoPath = path.join(this.baseReposDir, entry.name);
      const isGit = fs.existsSync(path.join(repoPath, '.git')) || fs.existsSync(path.join(repoPath, 'HEAD'));
      if (!isGit) continue;

      let branch = 'unknown';
      let lastCommit = '';
      let lastUpdated = '';
      let sizeBytes = 0;

      try {
        branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
      } catch {}

      try {
        lastCommit = execSync('git log -1 --pretty=format:"%h - %s"', { cwd: repoPath, encoding: 'utf-8' }).trim();
        lastUpdated = execSync('git log -1 --pretty=format:"%cI"', { cwd: repoPath, encoding: 'utf-8' }).trim();
      } catch {}

      try {
        sizeBytes = this.calculateDirSize(repoPath);
      } catch {}

      repos.push({
        name: entry.name,
        path: repoPath,
        branch,
        lastCommit,
        lastUpdated,
        sizeBytes
      });
    }

    return repos;
  }

  /**
   * Deploy Token を安全な git-credentials ファイル（chmod 600）に保存
   * 非特権ユーザーからの閲覧を遮断しつつ、管理プロセスの git fetch を可能にする
   */
  public saveDeployCredentials(repoUrl: string, deployToken: string, deployUser?: string): void {
    try {
      const parentDir = path.dirname(this.credentialsFile);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      const user = deployUser || 'deploy-token';
      // URLからプロトコルとホスト名を抽出
      let host = '';
      let protocol = 'https';
      try {
        const parsed = new URL(repoUrl);
        host = parsed.host;
        protocol = parsed.protocol.replace(':', '');
      } catch {
        const match = repoUrl.match(/^(?:https?:\/\/)?([^/:]+)/);
        host = match ? match[1] : 'gitlab.internal';
      }

      // エントリ形式: https://user:token@host
      const newEntry = `${protocol}://${encodeURIComponent(user)}:${encodeURIComponent(deployToken)}@${host}`;

      let entries: string[] = [];
      if (fs.existsSync(this.credentialsFile)) {
        try {
          const content = fs.readFileSync(this.credentialsFile, 'utf-8');
          entries = content.split('\n').filter(line => line.trim().length > 0);
        } catch {}
      }

      // 同一ホスト・同一ユーザーのエントリを更新、無ければ追加
      const prefix = `${protocol}://${encodeURIComponent(user)}:`;
      const hostSuffix = `@${host}`;
      const existingIdx = entries.findIndex(e => e.startsWith(prefix) && e.includes(hostSuffix));

      if (existingIdx >= 0) {
        entries[existingIdx] = newEntry;
      } else {
        entries.push(newEntry);
      }

      fs.writeFileSync(this.credentialsFile, entries.join('\n') + '\n', { mode: 0o600 });
      try {
        fs.chmodSync(this.credentialsFile, 0o600);
      } catch {}
      console.log(`[WorkspaceManager] 🔑 Saved deploy credentials for ${host} to ${this.credentialsFile} (mode 0600)`);
    } catch (err: any) {
      console.warn(`[WorkspaceManager] Failed to save deploy credentials to ${this.credentialsFile}:`, err.message);
    }
  }

  /**
   * base-repos ディレクトリ内の全大元リポジトリをスキャンし、
   * .git/config の remote.origin.url にトークンが含まれていれば自動除去して安全化
   */
  public sanitizeBaseRepoConfigs(): { sanitizedCount: number; sanitizedRepos: string[] } {
    if (!fs.existsSync(this.baseReposDir)) {
      return { sanitizedCount: 0, sanitizedRepos: [] };
    }

    const sanitizedRepos: string[] = [];
    try {
      const entries = fs.readdirSync(this.baseReposDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const repoPath = path.join(this.baseReposDir, entry.name);
        const isGit = fs.existsSync(path.join(repoPath, '.git')) || fs.existsSync(path.join(repoPath, 'HEAD'));
        if (!isGit) continue;

        try {
          const originUrl = execSync('git remote get-url origin', { cwd: repoPath, encoding: 'utf-8' }).trim();
          // URL にユーザー名:トークンが含まれているかチェック (https://user:token@host/...)
          const match = originUrl.match(/^(https?:\/\/)([^:]+):([^@]+)@([^/]+)(.*)$/);
          if (match) {
            const [, scheme, user, token, host, pathname] = match;
            const cleanUrl = `${scheme}${host}${pathname}`;
            const decodedUser = decodeURIComponent(user);
            const decodedToken = decodeURIComponent(token);

            // 1. クレデンシャルファイルに退避
            this.saveDeployCredentials(cleanUrl, decodedToken, decodedUser);

            // 2. remote URL をサニタイズ
            execSync(`git remote set-url origin "${cleanUrl}"`, { cwd: repoPath, stdio: 'pipe' });

            // 3. credential.helper を設定
            execSync(`git config credential.helper "store --file=\\"${this.credentialsFile}\\""`, {
              cwd: repoPath,
              stdio: 'pipe'
            });

            sanitizedRepos.push(entry.name);
            console.log(`[WorkspaceManager] 🛡️ Sanitized leaked token in existing base repo: ${entry.name}`);
          }
        } catch {}
      }
    } catch (err: any) {
      console.warn(`[WorkspaceManager] Failed to sanitize base repo configs:`, err.message);
    }

    return {
      sanitizedCount: sanitizedRepos.length,
      sanitizedRepos
    };
  }

  /**
   * 【Admin API】新規大元リポジトリを base-repos に安全に clone
   */
  public cloneRepo(repoUrl: string, deployToken?: string, deployUser?: string, customName?: string): { success: boolean; repoName?: string; error?: string } {
    if (!fs.existsSync(this.baseReposDir)) {
      fs.mkdirSync(this.baseReposDir, { recursive: true });
    }

    // リポジトリ名を抽出
    let name = customName?.trim();
    if (!name) {
      const match = repoUrl.match(/\/([^/]+?)(?:\.git)?$/);
      name = match ? match[1] : `repo-${Date.now()}`;
    }

    const targetPath = path.join(this.baseReposDir, name);
    if (fs.existsSync(targetPath)) {
      return { success: false, error: `Repository '${name}' already exists at ${targetPath}` };
    }

    try {
      let finalUrl = repoUrl;
      const isHttps = repoUrl.startsWith('https://');

      // Deploy Token を URL に挿入（HTTPSの場合）
      if (deployToken && isHttps) {
        const user = deployUser || 'deploy-token';
        finalUrl = repoUrl.replace('https://', `https://${encodeURIComponent(user)}:${encodeURIComponent(deployToken)}@`);
      }

      console.log(`[WorkspaceManager] Cloning repository into ${targetPath}...`);
      execSync(`git clone "${finalUrl}" "${targetPath}"`, {
        cwd: this.baseReposDir,
        stdio: 'pipe'
      });

      // 【Session 5-4: Deploy Token 保護】
      // クローン完了直後に、大元リポジトリの .git/config からトークンを完全に除去（サニタイズ）
      if (deployToken && isHttps) {
        try {
          // 1. remote URL をトークンなしの素の repoUrl に置き換え
          execSync(`git remote set-url origin "${repoUrl}"`, { cwd: targetPath, stdio: 'pipe' });

          // 2. クレデンシャルを安全な credential-store ファイル（chmod 600）に保存
          this.saveDeployCredentials(repoUrl, deployToken, deployUser);

          // 3. 大元リポジトリに credential.helper を設定（管理者/cronでの fetch 用）
          execSync(`git config credential.helper "store --file=\\"${this.credentialsFile}\\""`, {
            cwd: targetPath,
            stdio: 'pipe'
          });

          console.log(`[WorkspaceManager] 🔒 Secured origin URL for '${name}' (token removed from .git/config, saved to ${this.credentialsFile})`);
        } catch (secErr: any) {
          console.warn(`[WorkspaceManager] Warning: Failed to sanitize origin URL for ${name}:`, secErr.message);
        }
      }

      return { success: true, repoName: name };
    } catch (err: any) {
      console.error(`[WorkspaceManager] Failed to clone ${repoUrl}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 【Admin API】メンバー別ワークスペース一覧およびディスク使用量の取得
   */
  public listWorkspaces(): { workspaces: WorkspaceItem[]; diskStats: DiskStats } {
    const workspaces: WorkspaceItem[] = [];
    if (fs.existsSync(this.workspacesDir)) {
      const entries = fs.readdirSync(this.workspacesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const userDir = path.join(this.workspacesDir, entry.name);
        const repos: WorkspaceRepoItem[] = [];

        try {
          const subEntries = fs.readdirSync(userDir, { withFileTypes: true });
          for (const sub of subEntries) {
            if (!sub.isDirectory()) continue;
            const repoPath = path.join(userDir, sub.name);
            if (fs.existsSync(path.join(repoPath, '.git'))) {
              let branch = 'unknown';
              try {
                branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
              } catch {}
              repos.push({
                name: sub.name,
                branch,
                path: repoPath
              });
            }
          }
        } catch {}

        let stat: fs.Stats | null = null;
        try {
          stat = fs.statSync(userDir);
        } catch {}

        workspaces.push({
          userName: entry.name,
          path: userDir,
          sizeBytes: this.calculateDirSize(userDir),
          lastActive: stat ? stat.mtime.toISOString() : new Date().toISOString(),
          repos
        });
      }
    }

    const diskStats = this.getDiskStats(this.workspacesDir);

    return { workspaces, diskStats };
  }

  /**
   * 【Admin API】指定メンバーのワークスペースおよび worktree の安全クリーンアップ
   */
  public cleanupWorkspace(userName: string): { success: boolean; userName: string; error?: string } {
    const sanitized = this.sanitizeUserName(userName);
    const userWorkspaceDir = path.join(this.workspacesDir, sanitized);

    if (!fs.existsSync(userWorkspaceDir)) {
      return { success: true, userName: sanitized };
    }

    try {
      // 1. 各 worktree を削除
      if (fs.existsSync(this.baseReposDir)) {
        const baseEntries = fs.readdirSync(this.baseReposDir, { withFileTypes: true });
        for (const baseEntry of baseEntries) {
          if (!baseEntry.isDirectory()) continue;
          const baseRepoPath = path.join(this.baseReposDir, baseEntry.name);
          const worktreePath = path.join(userWorkspaceDir, baseEntry.name);
          if (fs.existsSync(worktreePath)) {
            try {
              execSync(`git worktree remove --force "${worktreePath}"`, { cwd: baseRepoPath, stdio: 'pipe' });
            } catch {}
          }
          try {
            execSync('git worktree prune', { cwd: baseRepoPath, stdio: 'pipe' });
          } catch {}
        }
      }

      // 2. ディレクトリ全体を削除（権限制限がある場合は sudo rm -rf にフォールバック）
      try {
        fs.rmSync(userWorkspaceDir, { recursive: true, force: true });
      } catch (rmErr: any) {
        if (process.platform === 'linux') {
          const isRoot = process.getuid && process.getuid() === 0;
          const sudoPrefix = isRoot ? '' : 'sudo ';
          execSync(`${sudoPrefix}rm -rf "${userWorkspaceDir}"`, { stdio: 'pipe' });
        } else {
          throw rmErr;
        }
      }
      console.log(`[WorkspaceManager] Cleaned up workspace for ${sanitized} at: ${userWorkspaceDir}`);
      return { success: true, userName: sanitized };
    } catch (err: any) {
      console.error(`[WorkspaceManager] Failed to cleanup workspace for ${sanitized}:`, err.message);
      return { success: false, userName: sanitized, error: err.message };
    }
  }

  /**
   * ディレクトリサイズの概算計算（バイト単位）
   */
  private calculateDirSize(dirPath: string): number {
    let total = 0;
    try {
      const files = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const file of files) {
        const fullPath = path.join(dirPath, file.name);
        if (file.isDirectory()) {
          // .git ディレクトリは深すぎる場合があるため一部抑制
          if (file.name === '.git') {
            try {
              total += fs.statSync(fullPath).size;
            } catch {}
          } else {
            total += this.calculateDirSize(fullPath);
          }
        } else if (file.isFile()) {
          try {
            total += fs.statSync(fullPath).size;
          } catch {}
        }
      }
    } catch {}
    return total;
  }

  /**
   * ディスク容量の取得
   */
  private getDiskStats(targetPath: string): DiskStats {
    try {
      const checkPath = fs.existsSync(targetPath) ? targetPath : os.homedir();
      const output = execSync(`df -k "${checkPath}"`, { encoding: 'utf-8' });
      const lines = output.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[lines.length - 1].split(/\s+/);
        if (parts.length >= 4) {
          const totalBytes = parseInt(parts[1], 10) * 1024;
          const usedBytes = parseInt(parts[2], 10) * 1024;
          const freeBytes = parseInt(parts[3], 10) * 1024;
          return { totalBytes, usedBytes, freeBytes };
        }
      }
    } catch {}

    return {
      totalBytes: 100 * 1024 * 1024 * 1024,
      usedBytes: 10 * 1024 * 1024 * 1024,
      freeBytes: 90 * 1024 * 1024 * 1024
    };
  }
}
