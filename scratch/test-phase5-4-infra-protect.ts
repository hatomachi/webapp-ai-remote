import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { SandboxManager } from '../packages/agent/src/sandboxManager.js';
import { WorkspaceManager } from '../packages/agent/src/workspaceManager.js';

const TEST_ROOT = path.join(os.tmpdir(), `test-phase5-4-${Date.now()}`);
const TEST_BASE_DIR = path.join(TEST_ROOT, 'base-repos');
const TEST_WS_DIR = path.join(TEST_ROOT, 'workspaces');
const TEST_CRED_FILE = path.join(TEST_ROOT, '.git-credentials');

function setupTestEnvironment() {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_BASE_DIR, { recursive: true });
  fs.mkdirSync(TEST_WS_DIR, { recursive: true });
}

function cleanupTestEnvironment() {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function runPhase54Tests() {
  console.log('======================================================================');
  console.log('🛡️ Starting Phase 5-4: OS/AWS Infra Protection & Deploy Token Security');
  console.log('======================================================================\n');

  setupTestEnvironment();

  try {
    // -----------------------------------------------------------------
    // Part 1: Deploy Token Sanitization on Clone & Credential Storage
    // -----------------------------------------------------------------
    console.log('--- [Test 1] Deploy Token Sanitization on Clone ---');

    // リモート役の bare git リポジトリを作成
    const remoteRepoDir = path.join(TEST_ROOT, 'remote-vault.git');
    execSync(`git init --bare "${remoteRepoDir}"`, { stdio: 'pipe' });

    // 初期コミットを remote に push
    const initWorkDir = path.join(TEST_ROOT, 'init-work');
    fs.mkdirSync(initWorkDir);
    execSync('git init -b main', { cwd: initWorkDir, stdio: 'pipe' });
    execSync('git config user.name "GitLab Deploy"', { cwd: initWorkDir, stdio: 'pipe' });
    execSync('git config user.email "deploy@gitlab.internal"', { cwd: initWorkDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(initWorkDir, 'README.md'), '# Company Vault\n');
    execSync('git add . && git commit -m "init"', { cwd: initWorkDir, stdio: 'pipe' });
    execSync(`git remote add origin "${remoteRepoDir}"`, { cwd: initWorkDir, stdio: 'pipe' });
    execSync('git push origin main', { cwd: initWorkDir, stdio: 'pipe' });
    fs.rmSync(initWorkDir, { recursive: true, force: true });

    const wsManager = new WorkspaceManager({
      baseReposDir: TEST_BASE_DIR,
      workspacesDir: TEST_WS_DIR,
      credentialsFile: TEST_CRED_FILE
    });

    // Deploy Token を指定して cloneRepo を実行（HTTPS 形式の URL をシミュレート）
    const simulatedHttpsUrl = 'https://gitlab.example.com/company/confluence-vault.git';
    const deployToken = 'glpat-secret-deploy-token-12345';
    const deployUser = 'deploy-user-bot';

    // cloneRepo はローカルの remoteRepoDir をクローンするが、HTTPS URL とトークンのサニタイズロジックを検証
    // テスト用に saveDeployCredentials と cloneRepo の連携をテスト
    wsManager.saveDeployCredentials(simulatedHttpsUrl, deployToken, deployUser);

    assert(fs.existsSync(TEST_CRED_FILE), 'Credentials file was created');
    const credContent = fs.readFileSync(TEST_CRED_FILE, 'utf-8');
    assert(
      credContent.includes('https://deploy-user-bot:glpat-secret-deploy-token-12345@gitlab.example.com'),
      'Credentials file contains encoded token for gitlab.example.com'
    );

    // パーミッションの検証（POSIX 環境で 0600 になっていること）
    if (process.platform !== 'win32') {
      const stats = fs.statSync(TEST_CRED_FILE);
      const perm = (stats.mode & 0o777).toString(8);
      assert(perm === '600', `Credentials file has strict 0600 permissions (actual: ${perm})`);
    }

    // -----------------------------------------------------------------
    // Part 2: Automatic Sanitization of Existing Base Repos
    // -----------------------------------------------------------------
    console.log('\n--- [Test 2] Automatic Base Repo Token Sanitization ---');

    // 以前クローンされた設定で、.git/config に平文トークンが含まれてしまっているレガシーリポジトリをシミュレート
    const leakedRepoDir = path.join(TEST_BASE_DIR, 'leaked-project');
    execSync(`git clone "${remoteRepoDir}" "${leakedRepoDir}"`, { stdio: 'pipe' });
    // トークン入り URL をわざとセット
    const leakedUrl = 'https://leaked-bot:leaked-secret-99999@gitlab.example.com/company/leaked-project.git';
    execSync(`git remote set-url origin "${leakedUrl}"`, { cwd: leakedRepoDir, stdio: 'pipe' });

    // 設定前の .git/config にトークンが含まれていることを確認
    const preConfig = fs.readFileSync(path.join(leakedRepoDir, '.git', 'config'), 'utf-8');
    assert(preConfig.includes('leaked-secret-99999'), 'Pre-condition: .git/config contains leaked token');

    // sanitizeBaseRepoConfigs を実行
    const sanitizeResult = wsManager.sanitizeBaseRepoConfigs();
    assert(sanitizeResult.sanitizedCount === 1, 'Sanitized 1 leaked repository');
    assert(sanitizeResult.sanitizedRepos.includes('leaked-project'), 'Identified leaked-project');

    // サニタイズ後の .git/config を確認
    const postConfig = fs.readFileSync(path.join(leakedRepoDir, '.git', 'config'), 'utf-8');
    assert(!postConfig.includes('leaked-secret-99999'), 'Deploy token was completely removed from .git/config');
    assert(
      postConfig.includes('url = https://gitlab.example.com/company/leaked-project.git'),
      'Clean URL without token was preserved in .git/config'
    );

    // クレデンシャルストアに退避されたことを確認
    const updatedCreds = fs.readFileSync(TEST_CRED_FILE, 'utf-8');
    assert(updatedCreds.includes('leaked-secret-99999'), 'Leaked token was securely migrated to .git-credentials');

    // credential.helper が設定されたことを確認
    const helperConfig = execSync('git config credential.helper', { cwd: leakedRepoDir, encoding: 'utf-8' }).trim();
    assert(helperConfig.includes(TEST_CRED_FILE), `credential.helper points to secure credentials file: ${helperConfig}`);

    // -----------------------------------------------------------------
    // Part 3: Git Worktree Integrity without Access to Credentials File
    // -----------------------------------------------------------------
    console.log('\n--- [Test 3] Worktree Integrity when Credentials are Inaccessible ---');

    // leakedRepoDir から tanaka 用の worktree を作成
    const userWorkspace = wsManager.ensureUserWorkspace('tanaka');
    assert(userWorkspace.worktrees.length > 0, 'Created worktree for tanaka');

    const worktreePath = path.join(userWorkspace.userWorkspaceDir, 'leaked-project');
    assert(fs.existsSync(worktreePath), `Worktree path exists: ${worktreePath}`);

    // クレデンシャルファイルを chmod 000 にして非特権ユーザーから読めない状態を模倣
    if (process.platform !== 'win32') {
      fs.chmodSync(TEST_CRED_FILE, 0o000);
    }

    // worktree 内でローカル Git コマンドを実行
    execSync('git config user.name "Taro Tanaka"', { cwd: worktreePath, stdio: 'pipe' });
    execSync('git config user.email "tanaka@example.com"', { cwd: worktreePath, stdio: 'pipe' });
    fs.writeFileSync(path.join(worktreePath, 'feature.txt'), 'Tanaka secret work\n');

    let gitSuccess = false;
    try {
      execSync('git add feature.txt', { cwd: worktreePath, stdio: 'pipe' });
      execSync('git commit -m "feat: user work"', { cwd: worktreePath, stdio: 'pipe' });
      const statusOut = execSync('git status', { cwd: worktreePath, encoding: 'utf-8' });
      gitSuccess = statusOut.includes('nothing to commit');
    } catch (e: any) {
      console.error('Git error in worktree:', e.message);
    }
    assert(gitSuccess, 'Worktree git operations (add/commit/status) succeed even when credentials are unreadable');

    // 元に戻す
    if (process.platform !== 'win32') {
      fs.chmodSync(TEST_CRED_FILE, 0o600);
    }

    // -----------------------------------------------------------------
    // Part 4: AWS IMDS (169.254.169.254) Block Command Generation & Primary Group
    // -----------------------------------------------------------------
    console.log('\n--- [Test 4] AWS IMDS Block Command & Primary Group Generation ---');

    const sandbox = new SandboxManager({
      enabled: true,
      userPrefix: 'ai-',
      sharedGroup: 'ai-shared',
      executionMethod: 'sudo',
      forcePlatform: 'linux'
    });

    const imdsCmds = sandbox.getImdsBlockCommands();
    assert(imdsCmds.groupName === 'ai-shared', 'Uses configured shared group ai-shared');
    assert(
      imdsCmds.applyCmd.includes('iptables -A OUTPUT -m owner --gid-owner "ai-shared" -d 169.254.169.254 -j REJECT --reject-with icmp-port-unreachable'),
      'Generates correct iptables REJECT command matching group ai-shared'
    );
    assert(
      imdsCmds.checkCmd.includes('iptables -C OUTPUT -m owner --gid-owner "ai-shared" -d 169.254.169.254 -j REJECT'),
      'Generates correct iptables check command'
    );

    // diagnoseSandbox の確認
    const diag = sandbox.diagnoseSandbox();
    assert('imdsBlocked' in diag, 'SandboxDiagnostic includes imdsBlocked property');
    assert(typeof diag.imdsBlocked === 'boolean', 'imdsBlocked is boolean');

  } finally {
    cleanupTestEnvironment();
  }

  console.log('\n======================================================================');
  if (failed === 0) {
    console.log(`🎉 ALL ${passed} TESTS PASSED! Phase 5-4 requirements verified successfully.`);
  } else {
    console.error(`💥 ${failed} TESTS FAILED out of ${passed + failed}`);
    process.exit(1);
  }
  console.log('======================================================================');
}

runPhase54Tests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
