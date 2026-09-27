import crypto from 'node:crypto';
import { UserCredentials } from './workspaceManager.js';

export interface AuthenticatedUser {
  username: string;       // サニタイズ済みユーザー名（例: "taro-tanaka"）
  rawUsername: string;    // 元のユーザー名（例: "taro_tanaka"）
  email?: string;
  name?: string;
  provider: 'gitlab' | 'github' | 'anonymous';
}

export interface AuthResult {
  success: boolean;
  user?: AuthenticatedUser;
  error?: string;
  statusCode?: number;
}

export interface CachedAuthUser {
  user: AuthenticatedUser;
  expiresAt: number;
}

export interface TokenAuthOptions {
  gitlabApiUrl?: string;
  githubApiUrl?: string;
  strictMode?: boolean;
  cacheTtlMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * トークンベース身元認証マネージャー (TokenAuthManager)
 * 
 * 社内GitLabのPAT（Personal Access Token）または GitHub Token をAPI経由で動的に検証し、
 * 第三のクレデンシャル（PIN等）を新設することなく正規の身元（Identity）を確定する。
 * 検証結果はインメモリ（SHA-256ハッシュキー）にキャッシュし、高スループット＆低遅延を実現。
 */
export class TokenAuthManager {
  public readonly gitlabApiUrl?: string;
  public readonly githubApiUrl: string;
  public readonly strictMode: boolean;
  public readonly cacheTtlMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly tokenCache = new Map<string, CachedAuthUser>();

  constructor(options?: TokenAuthOptions) {
    // 環境変数 または オプションから設定を解決
    const rawGitlabUrl = options?.gitlabApiUrl ?? (process.env.AUTH_GITLAB_API_URL || process.env.GITLAB_API_URL);
    if (rawGitlabUrl) {
      let trimmed = rawGitlabUrl.trim().replace(/\/+$/, '');
      if (!trimmed.endsWith('/api/v4')) {
        trimmed = `${trimmed}/api/v4`;
      }
      this.gitlabApiUrl = trimmed;
    }

    this.githubApiUrl = (options?.githubApiUrl ?? (process.env.AUTH_GITHUB_API_URL || 'https://api.github.com')).trim().replace(/\/+$/, '');

    // strictMode: 明示指定 > 環境変数 > gitlabApiUrl設定時はデフォルトtrue
    if (options?.strictMode !== undefined) {
      this.strictMode = options.strictMode;
    } else if (process.env.AUTH_STRICT_MODE !== undefined) {
      this.strictMode = process.env.AUTH_STRICT_MODE === 'true';
    } else {
      this.strictMode = Boolean(this.gitlabApiUrl);
    }

    this.cacheTtlMs = options?.cacheTtlMs ?? (
      process.env.AUTH_CACHE_TTL_MS
        ? parseInt(process.env.AUTH_CACHE_TTL_MS, 10)
        : 15 * 60 * 1000 // 15分
    );

    this.fetchFn = options?.fetchFn || globalThis.fetch;

    if (this.gitlabApiUrl) {
      console.log(`[TokenAuthManager] 🔐 GitLab PAT auth active (URL: ${this.gitlabApiUrl}, strict: ${this.strictMode}, cacheTTL: ${this.cacheTtlMs / 1000}s)`);
    } else {
      console.log(`[TokenAuthManager] ℹ️ GitLab API URL not set. Strict mode: ${this.strictMode}`);
    }
  }

  /**
   * トークンのSHA-256ハッシュを計算（キャッシュキー）
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  /**
   * ユーザー名文字列のサニタイズ（OS/ディレクトリ名制約準拠）
   */
  public sanitizeUserName(raw: string): string {
    const trimmed = raw.trim().toLowerCase();
    // メールアドレス形式の場合はローカルパートを抽出
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    let cleaned = isEmail ? trimmed.split('@')[0] : trimmed;
    cleaned = cleaned.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return cleaned || 'user';
  }

  /**
   * キャッシュから有効なユーザーを取得
   */
  public getCachedUser(token: string): AuthenticatedUser | undefined {
    const hash = this.hashToken(token);
    const cached = this.tokenCache.get(hash);
    if (!cached) return undefined;

    if (Date.now() > cached.expiresAt) {
      this.tokenCache.delete(hash);
      return undefined;
    }
    return cached.user;
  }

  /**
   * キャッシュにユーザーを保存
   */
  public setCachedUser(token: string, user: AuthenticatedUser) {
    const hash = this.hashToken(token);
    this.tokenCache.set(hash, {
      user,
      expiresAt: Date.now() + this.cacheTtlMs
    });
  }

  /**
   * キャッシュを全消去
   */
  public clearCache() {
    this.tokenCache.clear();
  }

  /**
   * GitLab PAT の検証
   */
  private async verifyGitlabToken(token: string): Promise<AuthResult> {
    const cached = this.getCachedUser(token);
    if (cached) {
      return { success: true, user: cached };
    }

    if (!this.gitlabApiUrl) {
      return {
        success: false,
        error: 'GitLab API URL (AUTH_GITLAB_API_URL) が設定されていません',
        statusCode: 500
      };
    }

    try {
      const endpoint = `${this.gitlabApiUrl}/user`;
      const res = await this.fetchFn(endpoint, {
        method: 'GET',
        headers: {
          'PRIVATE-TOKEN': token.trim(),
          'Accept': 'application/json'
        }
      });

      if (res.status === 401 || res.status === 403) {
        return {
          success: false,
          error: 'GitLab PATが無効または期限切れです (401 Unauthorized)',
          statusCode: 401
        };
      }

      if (!res.ok) {
        return {
          success: false,
          error: `GitLab API エラー (HTTP ${res.status})`,
          statusCode: res.status
        };
      }

      const data = await res.json() as any;
      if (!data || !data.username) {
        return {
          success: false,
          error: 'GitLab API から有効なユーザー情報を取得できませんでした',
          statusCode: 502
        };
      }

      // アカウント凍結チェック
      if (data.state && data.state !== 'active') {
        return {
          success: false,
          error: `GitLab アカウントが無効な状態です (${data.state})`,
          statusCode: 403
        };
      }

      const user: AuthenticatedUser = {
        username: this.sanitizeUserName(data.username),
        rawUsername: data.username,
        email: data.email,
        name: data.name,
        provider: 'gitlab'
      };

      this.setCachedUser(token, user);
      return { success: true, user };
    } catch (err: any) {
      console.error('[TokenAuthManager] GitLab API fetch failed:', err.message);
      return {
        success: false,
        error: `GitLab 認証サーバーに接続できませんでした: ${err.message}`,
        statusCode: 503
      };
    }
  }

  /**
   * GitHub Token (Copilot) の検証
   */
  private async verifyGithubToken(token: string): Promise<AuthResult> {
    const cached = this.getCachedUser(token);
    if (cached) {
      return { success: true, user: cached };
    }

    try {
      const endpoint = `${this.githubApiUrl}/user`;
      const res = await this.fetchFn(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'webapp-ai-remote'
        }
      });

      if (res.status === 401 || res.status === 403) {
        return {
          success: false,
          error: 'GitHub Tokenが無効または期限切れです (401 Unauthorized)',
          statusCode: 401
        };
      }

      if (!res.ok) {
        return {
          success: false,
          error: `GitHub API エラー (HTTP ${res.status})`,
          statusCode: res.status
        };
      }

      const data = await res.json() as any;
      if (!data || !data.login) {
        return {
          success: false,
          error: 'GitHub API から有効なユーザー情報を取得できませんでした',
          statusCode: 502
        };
      }

      const user: AuthenticatedUser = {
        username: this.sanitizeUserName(data.login),
        rawUsername: data.login,
        email: data.email,
        name: data.name,
        provider: 'github'
      };

      this.setCachedUser(token, user);
      return { success: true, user };
    } catch (err: any) {
      console.error('[TokenAuthManager] GitHub API fetch failed:', err.message);
      return {
        success: false,
        error: `GitHub 認証サーバーに接続できませんでした: ${err.message}`,
        statusCode: 503
      };
    }
  }

  /**
   * 認証の総合エントリーポイント
   * 
   * 1. gitlabToken があれば GitLab で検証
   * 2. なければ copilotToken で GitHub 検証
   * 3. トークンなしの場合:
   *    - strictMode = true なら 401 拒否
   *    - strictMode = false（ローカル開発モード）なら自己申告 userName をフォールバック許可
   */
  public async authenticate(credentials?: UserCredentials): Promise<AuthResult> {
    const gitlabToken = credentials?.gitlabToken?.trim();
    const copilotToken = credentials?.copilotToken?.trim();

    // 1. GitLab PAT がある場合は最優先で検証
    if (gitlabToken) {
      return this.verifyGitlabToken(gitlabToken);
    }

    // 2. GitHub / Copilot Token がある場合は GitHub で検証
    if (copilotToken) {
      return this.verifyGithubToken(copilotToken);
    }

    // 3. トークン未指定時のハンドリング
    if (this.strictMode) {
      return {
        success: false,
        error: '個人認証トークン（GitLab PAT または GitHub Token）が必要です (401 Unauthorized)',
        statusCode: 401
      };
    }

    // 非厳格モード（自宅開発・テスト環境）: 自己申告をフォールバック許可
    const rawUser = credentials?.userName?.trim() || 'user';
    const fallbackUser: AuthenticatedUser = {
      username: this.sanitizeUserName(rawUser),
      rawUsername: rawUser,
      email: credentials?.userEmail?.trim(),
      provider: 'anonymous'
    };

    return {
      success: true,
      user: fallbackUser
    };
  }

  /**
   * 現在の認証設定ステータスを取得（ヘルスチェック・案内用）
   */
  public getStatus() {
    return {
      gitlabConfigured: Boolean(this.gitlabApiUrl),
      gitlabApiUrl: this.gitlabApiUrl,
      strictMode: this.strictMode,
      cacheTtlSeconds: this.cacheTtlMs / 1000,
      cachedTokensCount: this.tokenCache.size
    };
  }
}
