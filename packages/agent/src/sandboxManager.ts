import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

export type SandboxExecutionMethod = 'auto' | 'sudo' | 'spawn_uid' | 'disabled';

export interface SandboxManagerOptions {
  enabled?: boolean;
  userPrefix?: string;
  sharedGroup?: string;
  executionMethod?: SandboxExecutionMethod;
  allowFallback?: boolean;
  forcePlatform?: NodeJS.Platform;
}

export interface SandboxSpawnConfig {
  command: string;
  args: string[];
  spawnOptions: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    uid?: number;
    gid?: number;
    shell?: boolean;
  };
  osUser: string;
  isSandboxed: boolean;
  methodUsed: SandboxExecutionMethod;
}

export interface SandboxDiagnostic {
  platform: string;
  currentUser: string;
  currentUid: number;
  enabled: boolean;
  executionMethod: SandboxExecutionMethod;
  canSudo: boolean;
  sharedGroupExists: boolean;
}

/**
 * Linux OS ユーザー分離 ＆ ワークスペース権限サンドボックスマネージャー
 * 
 * メンバーごとに専用の非特権 OS ユーザー（例: ai-tanaka）をマッピング/生成し、
 * 各自のワークスペース（/data/workspaces/<user>）を chmod 700 で他メンバーから完全隔離。
 * AI 実行（Claude Code / Copilot CLI）を非特権 OS ユーザー権限に降格してサンドボックス起動する。
 */
export class SandboxManager {
  public readonly enabled: boolean;
  public readonly userPrefix: string;
  public readonly sharedGroup: string;
  public readonly executionMethod: SandboxExecutionMethod;
  public readonly allowFallback: boolean;
  public readonly platform: NodeJS.Platform;

  constructor(options?: SandboxManagerOptions) {
    this.platform = options?.forcePlatform || process.platform;
    // 環境変数 または オプションから設定を読み込み
    const envEnabled = process.env.ENABLE_USER_SANDBOX === 'true';
    this.enabled = options?.enabled ?? (envEnabled || false);
    this.userPrefix = options?.userPrefix ?? (process.env.SANDBOX_USER_PREFIX || 'ai-');
    this.sharedGroup = options?.sharedGroup ?? (process.env.SANDBOX_SHARED_GROUP || 'ai-shared');
    this.executionMethod = options?.executionMethod ?? ((process.env.SANDBOX_EXEC_METHOD as SandboxExecutionMethod) || 'auto');
    this.allowFallback = options?.allowFallback ?? (process.env.SANDBOX_ALLOW_FALLBACK !== 'false');

    if (this.enabled) {
      console.log(`[SandboxManager] 🛡️ User Sandbox mode ACTIVE (platform: ${this.platform}, prefix: ${this.userPrefix}, group: ${this.sharedGroup}, method: ${this.executionMethod})`);
    } else {
      console.log(`[SandboxManager] User Sandbox mode inactive (disabled or not configured).`);
    }
  }

  /**
   * メンバー名（サニタイズ済み）を Linux OS ユーザー名にマッピング
   * Linux ユーザー名制約: 1〜32文字、英小文字・数字・ハイフン・アンダースコア
   * 例: "taro-tanaka" -> "ai-taro-tanaka"
   */
  public mapToOsUser(rawUser?: string): string {
    const raw = (rawUser || 'default').trim().toLowerCase();
    // メールアドレス形式（user@domain.com）の場合はローカルパートを抽出
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
    let cleaned = isEmail ? raw.split('@')[0] : raw;
    cleaned = cleaned.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!cleaned) cleaned = 'user';

    const maxSuffixLen = 32 - this.userPrefix.length;
    const safeSuffix = cleaned.slice(0, Math.max(1, maxSuffixLen));
    return `${this.userPrefix}${safeSuffix}`;
  }

  /**
   * 指定の OS ユーザーが存在するか確認
   */
  public userExists(osUser: string): boolean {
    if (this.platform !== 'linux') return false;
    try {
      execSync(`id -u "${osUser}"`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 共有グループ（ai-shared）の存在確認
   */
  public groupExists(groupName: string): boolean {
    if (this.platform !== 'linux') return false;
    try {
      execSync(`getent group "${groupName}"`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * OS ユーザーの作成・確保
   */
  public ensureOsUser(osUser: string): { success: boolean; created: boolean; error?: string } {
    if (!this.enabled || this.platform !== 'linux') {
      return { success: true, created: false };
    }

    if (this.userExists(osUser)) {
      return { success: true, created: false };
    }

    try {
      // 1. 共有グループが存在しなければ作成
      if (this.sharedGroup && !this.groupExists(this.sharedGroup)) {
        try {
          const groupCmd = process.getuid && process.getuid() === 0 ? 'groupadd' : 'sudo groupadd';
          execSync(`${groupCmd} "${this.sharedGroup}"`, { stdio: 'pipe' });
          console.log(`[SandboxManager] Created shared group: ${this.sharedGroup}`);
        } catch (gErr: any) {
          console.warn(`[SandboxManager] Could not create shared group ${this.sharedGroup}:`, gErr.message);
        }
      }

      // 2. ユーザーを作成 (ホームディレクトリ作成 -m, bashシェル -s /bin/bash)
      const isRoot = process.getuid && process.getuid() === 0;
      const sudoPrefix = isRoot ? '' : 'sudo ';
      const groupArg = (this.sharedGroup && this.groupExists(this.sharedGroup)) ? `-g "${this.sharedGroup}"` : '';

      const createCmd = `${sudoPrefix}useradd -m -s /bin/bash ${groupArg} "${osUser}"`.replace(/\s+/g, ' ');
      execSync(createCmd, { stdio: 'pipe' });
      console.log(`[SandboxManager] ✅ Created OS sandbox user: ${osUser}`);
      return { success: true, created: true };
    } catch (err: any) {
      console.warn(`[SandboxManager] ⚠️ Failed to create OS user '${osUser}':`, err.message);
      if (this.allowFallback) {
        return { success: false, created: false, error: err.message };
      }
      throw err;
    }
  }

  /**
   * ワークスペースディレクトリに OS ユーザーの所有権と chmod 700 を適用
   * これにより他メンバーからのワークスペース参照を物理的に完全遮断
   */
  public applyWorkspacePermissions(userWorkspaceDir: string, osUser: string): { success: boolean; error?: string } {
    if (!this.enabled || this.platform !== 'linux') {
      return { success: true };
    }

    if (!fs.existsSync(userWorkspaceDir)) {
      return { success: false, error: `Directory does not exist: ${userWorkspaceDir}` };
    }

    try {
      const isRoot = process.getuid && process.getuid() === 0;
      const sudoPrefix = isRoot ? '' : 'sudo ';

      // 1. ディレクトリ全体の所有者を osUser に変更
      execSync(`${sudoPrefix}chown -R "${osUser}:${osUser}" "${userWorkspaceDir}"`, { stdio: 'pipe' });

      // 2. パーミッションを 0700（所有者のみ rwx、グループ・他者は一切アクセス不可）に設定
      execSync(`${sudoPrefix}chmod 700 "${userWorkspaceDir}"`, { stdio: 'pipe' });

      console.log(`[SandboxManager] 🔒 Applied chmod 700 and chown ${osUser}:${osUser} to ${userWorkspaceDir}`);
      return { success: true };
    } catch (err: any) {
      console.warn(`[SandboxManager] ⚠️ Could not apply permissions to ${userWorkspaceDir}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * サンドボックス実行時の spawn コマンド・引数・環境変数を解決
   */
  public getSandboxSpawnConfig(
    binPath: string,
    args: string[],
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      userName?: string;
      isWindows?: boolean;
    }
  ): SandboxSpawnConfig {
    const osUser = this.mapToOsUser(options.userName);

    // サンドボックス無効時、または非Linux環境（macOS, Windows等）の場合は通常実行
    if (!this.enabled || this.platform !== 'linux') {
      return {
        command: binPath,
        args,
        spawnOptions: {
          cwd: options.cwd,
          env: options.env,
          shell: options.isWindows ?? (this.platform === 'win32')
        },
        osUser,
        isSandboxed: false,
        methodUsed: 'disabled'
      };
    }

    // 実行方式の決定 (auto / sudo / spawn_uid)
    const isRoot = process.getuid && process.getuid() === 0;
    let resolvedMethod = this.executionMethod;
    if (resolvedMethod === 'auto') {
      resolvedMethod = isRoot ? 'spawn_uid' : 'sudo';
    }

    const homeDir = `/home/${osUser}`;
    const childEnv: NodeJS.ProcessEnv = {
      ...options.env,
      USER: osUser,
      LOGNAME: osUser,
      HOME: fs.existsSync(homeDir) ? homeDir : (options.env.HOME || os.homedir())
    };

    if (resolvedMethod === 'spawn_uid') {
      // 親が root の場合は spawn の uid/gid を直接指定
      try {
        const uidStr = execSync(`id -u "${osUser}"`, { encoding: 'utf-8' }).trim();
        const gidStr = execSync(`id -g "${osUser}"`, { encoding: 'utf-8' }).trim();
        const uid = parseInt(uidStr, 10);
        const gid = parseInt(gidStr, 10);

        if (!isNaN(uid) && !isNaN(gid)) {
          return {
            command: binPath,
            args,
            spawnOptions: {
              cwd: options.cwd,
              env: childEnv,
              uid,
              gid,
              shell: false
            },
            osUser,
            isSandboxed: true,
            methodUsed: 'spawn_uid'
          };
        }
      } catch (err: any) {
        console.warn(`[SandboxManager] Failed to get uid/gid for ${osUser}:`, err.message);
      }
    }

    if (resolvedMethod === 'sudo') {
      // sudo -u <osUser> -H -E <binPath> <args...> で実行
      // -u: 実行ユーザー指定
      // -H: HOME=/home/<osUser> にセット
      // -E: 注入された環境変数（GH_TOKEN, ANTHROPIC_API_KEY等）を引き継ぐ
      return {
        command: 'sudo',
        args: ['-u', osUser, '-H', '-E', binPath, ...args],
        spawnOptions: {
          cwd: options.cwd,
          env: childEnv,
          shell: false
        },
        osUser,
        isSandboxed: true,
        methodUsed: 'sudo'
      };
    }

    // フォールバック: 通常起動
    return {
      command: binPath,
      args,
      spawnOptions: {
        cwd: options.cwd,
        env: childEnv,
        shell: options.isWindows ?? false
      },
      osUser,
      isSandboxed: false,
      methodUsed: 'disabled'
    };
  }

  /**
   * サンドボックス環境の自己診断
   */
  public diagnoseSandbox(): SandboxDiagnostic {
    const isLinux = this.platform === 'linux';
    let currentUser = 'unknown';
    let currentUid = -1;
    let canSudo = false;
    let sharedGroupExists = false;

    try {
      currentUid = process.getuid ? process.getuid() : -1;
    } catch {}

    try {
      currentUser = os.userInfo().username;
    } catch {}

    if (isLinux) {
      try {
        execSync('sudo -n true', { stdio: 'pipe' });
        canSudo = true;
      } catch {}

      try {
        sharedGroupExists = this.groupExists(this.sharedGroup);
      } catch {}
    }

    return {
      platform: this.platform,
      currentUser,
      currentUid,
      enabled: this.enabled,
      executionMethod: this.executionMethod,
      canSudo,
      sharedGroupExists
    };
  }
}
