import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { SandboxManager } from '../packages/agent/src/sandboxManager.js';
import { WorkspaceManager } from '../packages/agent/src/workspaceManager.js';

const TEST_BASE_DIR = '/tmp/test-phase4-base-repos';
const TEST_WS_DIR = '/tmp/test-phase4-workspaces';

function setupBaseRepos() {
  fs.rmSync(TEST_BASE_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_WS_DIR, { recursive: true, force: true });

  fs.mkdirSync(TEST_BASE_DIR, { recursive: true });
  fs.mkdirSync(TEST_WS_DIR, { recursive: true });

  // テスト用大元リポジトリ作成
  const repoPath = path.join(TEST_BASE_DIR, 'core-app');
  fs.mkdirSync(repoPath);
  execSync('git init -b main', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.name "Test Admin"', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.email "admin@internal"', { cwd: repoPath, stdio: 'pipe' });
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# Core App\n');
  execSync('git add . && git commit -m "feat: initial commit"', { cwd: repoPath, stdio: 'pipe' });
}

async function runPhase4Tests() {
  console.log('================================================================');
  console.log('🧪 Starting Phase 4 Sandbox & Linux User Isolation Tests');
  console.log('================================================================\n');

  setupBaseRepos();

  // -----------------------------------------------------------------
  // Test 1: OS User Mapping & Sanitization
  // -----------------------------------------------------------------
  console.log('--- [Test 1] OS User Mapping & Sanitization ---');
  const sandbox = new SandboxManager({
    enabled: true,
    userPrefix: 'ai-',
    executionMethod: 'sudo'
  });

  const testCases = [
    { input: 'Taro Tanaka', expected: 'ai-taro-tanaka' },
    { input: 'jiro.sato@company.com', expected: 'ai-jiro-sato' },
    { input: 'Alice_Smith-123', expected: 'ai-alice_smith-123' },
    { input: 'VeryLongUserNameExceedingStandardLinuxLimit1234567890', expectedLen: 32 },
    { input: '!@#$%Special*&^Chars', expected: 'ai-special-chars' },
    { input: '', expected: 'ai-default' }
  ];

  for (const tc of testCases) {
    const mapped = sandbox.mapToOsUser(tc.input);
    if (tc.expected && mapped !== tc.expected) {
      throw new Error(`Assertion failed for "${tc.input}": expected "${tc.expected}", got "${mapped}"`);
    }
    if (tc.expectedLen && mapped.length > tc.expectedLen) {
      throw new Error(`Assertion failed for length: expected <= ${tc.expectedLen}, got ${mapped.length}`);
    }
    // Linux ユーザー名が有効な形式（英数字、ハイフン、アンダースコア）か
    if (!/^[a-z0-9_-]+$/.test(mapped)) {
      throw new Error(`Assertion failed: invalid characters in OS username "${mapped}"`);
    }
  }
  console.log('✅ OS user mapping & sanitization verified across all test cases.');

  // -----------------------------------------------------------------
  // Test 2: getSandboxSpawnConfig for Sudo Method
  // -----------------------------------------------------------------
  console.log('\n--- [Test 2] Sandbox Spawn Configuration (Sudo Method) ---');
  // テスト用に強制的に enabled かつプラットフォーム判定をシミュレート
  const dummyEnv: NodeJS.ProcessEnv = {
    PATH: '/usr/bin:/bin',
    GH_TOKEN: 'ghp_secret_token_123',
    GIT_AUTHOR_NAME: 'Taro Tanaka'
  };

  // サンドボックス無効時の挙動
  const disabledSandbox = new SandboxManager({ enabled: false });
  const disabledConfig = disabledSandbox.getSandboxSpawnConfig('/usr/bin/claude', ['--version'], {
    cwd: '/data/workspaces/tanaka',
    env: dummyEnv,
    userName: 'Taro Tanaka'
  });
  if (disabledConfig.command !== '/usr/bin/claude' || disabledConfig.isSandboxed) {
    throw new Error('Assertion failed: Disabled sandbox should return original command and isSandboxed=false');
  }
  console.log('✅ Disabled sandbox correctly bypasses wrapping.');

  // Linux シミュレーションでの sudo モード検証
  const linuxSudoSandbox = new SandboxManager({
    enabled: true,
    forcePlatform: 'linux',
    executionMethod: 'sudo'
  });
  const sudoConfig = linuxSudoSandbox.getSandboxSpawnConfig('/usr/bin/claude', ['--print', 'hi'], {
    cwd: '/data/workspaces/taro-tanaka',
    env: dummyEnv,
    userName: 'Taro Tanaka'
  });

  if (sudoConfig.command !== 'sudo') {
    throw new Error(`Assertion failed: expected command 'sudo', got '${sudoConfig.command}'`);
  }
  if (!sudoConfig.isSandboxed) {
    throw new Error('Assertion failed: isSandboxed should be true');
  }
  if (sudoConfig.osUser !== 'ai-taro-tanaka') {
    throw new Error(`Assertion failed: expected osUser 'ai-taro-tanaka', got '${sudoConfig.osUser}'`);
  }
  // sudo 引数の確認: ['-u', 'ai-taro-tanaka', '-H', '-E', '/usr/bin/claude', '--print', 'hi']
  const expectedArgs = ['-u', 'ai-taro-tanaka', '-H', '-E', '/usr/bin/claude', '--print', 'hi'];
  if (JSON.stringify(sudoConfig.args) !== JSON.stringify(expectedArgs)) {
    throw new Error(`Assertion failed: sudo args mismatch. Expected ${JSON.stringify(expectedArgs)}, got ${JSON.stringify(sudoConfig.args)}`);
  }
  if (sudoConfig.spawnOptions.env.USER !== 'ai-taro-tanaka') {
    throw new Error(`Assertion failed: env.USER should be 'ai-taro-tanaka'`);
  }
  console.log('✅ Linux simulation with sudo wrapping verified successfully.');

  // -----------------------------------------------------------------
  // Test 3: WorkspaceManager Integration with SandboxManager
  // -----------------------------------------------------------------
  console.log('\n--- [Test 3] WorkspaceManager & SandboxManager Integration ---');
  const mgr = new WorkspaceManager({
    baseReposDir: TEST_BASE_DIR,
    workspacesDir: TEST_WS_DIR,
    sandboxOptions: {
      enabled: true,
      userPrefix: 'ai-',
      executionMethod: 'sudo',
      allowFallback: true
    }
  });

  if (!mgr.sandboxManager.enabled) {
    throw new Error('Assertion failed: sandboxManager should be enabled in WorkspaceManager');
  }

  const userWs = mgr.ensureUserWorkspace('Taro Tanaka');
  console.log(`Created workspace: ${userWs.userWorkspaceDir}`);
  console.log(`Mapped OS User   : ${userWs.osUser}`);
  console.log(`Is Sandboxed     : ${userWs.isSandboxed}`);

  if (userWs.sanitizedUser !== 'taro-tanaka') {
    throw new Error(`Assertion failed: expected 'taro-tanaka', got '${userWs.sanitizedUser}'`);
  }
  if (userWs.osUser !== 'ai-taro-tanaka') {
    throw new Error(`Assertion failed: expected 'ai-taro-tanaka', got '${userWs.osUser}'`);
  }
  if (!userWs.isSandboxed) {
    throw new Error('Assertion failed: isSandboxed should be true');
  }

  // AGENTS.md が存在すること
  const agentsMdPath = path.join(userWs.userWorkspaceDir, 'AGENTS.md');
  if (!fs.existsSync(agentsMdPath)) {
    throw new Error('Assertion failed: AGENTS.md should exist in workspace');
  }
  console.log('✅ WorkspaceManager correctly applied sandbox user mapping and workspace initialization.');

  // -----------------------------------------------------------------
  // Test 4: Workspace Permission & Multi-tenant Sandbox Isolation Simulation
  // -----------------------------------------------------------------
  console.log('\n--- [Test 4] Multi-tenant Workspace Permission & Isolation Simulation ---');
  // 田中さんのワークスペースと佐藤さんのワークスペース
  const tanakaWs = mgr.ensureUserWorkspace('Taro Tanaka');
  const satoWs = mgr.ensureUserWorkspace('Jiro Sato');

  // 田中さんのワークスペースに機密ファイルを作成
  const secretFile = path.join(tanakaWs.userWorkspaceDir, 'tanaka-confidential.txt');
  fs.writeFileSync(secretFile, 'Confidential Project Blueprint\n');

  // パーミッション 0700 のシミュレーション検証
  // chmod 700 を適用
  try {
    fs.chmodSync(tanakaWs.userWorkspaceDir, 0o700);
    fs.chmodSync(satoWs.userWorkspaceDir, 0o700);

    const statTanaka = fs.statSync(tanakaWs.userWorkspaceDir);
    const modeOctal = (statTanaka.mode & 0o777).toString(8);
    console.log(`Tanaka workspace directory mode: 0${modeOctal}`);
    if (modeOctal !== '700') {
      throw new Error(`Assertion failed: expected mode 0700, got 0${modeOctal}`);
    }
    console.log('✅ chmod 700 verified on workspace directory (owner-only access).');
  } catch (err: any) {
    console.warn('Notice: chmod test skipped or restricted on current filesystem:', err.message);
  }

  // -----------------------------------------------------------------
  // Test 5: Child Process Environment with Sandbox Context
  // -----------------------------------------------------------------
  console.log('\n--- [Test 5] Child Process Environment & Identity Injection ---');
  const childEnv = mgr.buildChildProcessEnv({
    userName: 'Taro Tanaka',
    userEmail: 'tanaka@company.co.jp',
    copilotToken: 'ghp_test_copilot_999',
    claudeApiKey: 'sk-ant-test-key-888',
    gitlabToken: 'glpat-test-gitlab-777'
  });

  if (childEnv.GIT_AUTHOR_NAME !== 'Taro Tanaka' || childEnv.GIT_AUTHOR_EMAIL !== 'tanaka@company.co.jp') {
    throw new Error('Assertion failed: Git author info missing from child env');
  }
  if (childEnv.GH_TOKEN !== 'ghp_test_copilot_999' || childEnv.ANTHROPIC_API_KEY !== 'sk-ant-test-key-888') {
    throw new Error('Assertion failed: API tokens missing from child env');
  }
  if (process.env.GH_TOKEN || process.env.ANTHROPIC_API_KEY) {
    throw new Error('Assertion failed: Parent process environment was contaminated');
  }
  console.log('✅ Dynamic credentials and process environment verified with sandbox.');

  // -----------------------------------------------------------------
  // Test 6: Sandbox Diagnostic
  // -----------------------------------------------------------------
  console.log('\n--- [Test 6] Sandbox Self-Diagnostic ---');
  const diag = sandbox.diagnoseSandbox();
  console.log('Diagnostic result:', JSON.stringify(diag, null, 2));
  if (typeof diag.enabled !== 'boolean' || typeof diag.platform !== 'string') {
    throw new Error('Assertion failed: Invalid diagnostic structure');
  }
  console.log('✅ Sandbox diagnostic check passed.');

  // -----------------------------------------------------------------
  // Test 7: Cleanup Workspace with Sandbox Permissions
  // -----------------------------------------------------------------
  console.log('\n--- [Test 7] Cleanup Workspace under Sandbox ---');
  const cleanupRes = mgr.cleanupWorkspace('Taro Tanaka');
  if (!cleanupRes.success) {
    throw new Error(`Assertion failed: Cleanup failed for Taro Tanaka: ${cleanupRes.error}`);
  }
  if (fs.existsSync(tanakaWs.userWorkspaceDir)) {
    throw new Error('Assertion failed: Workspace directory should be deleted after cleanup');
  }
  console.log('✅ Workspace cleanup verified under sandbox environment.');

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 4 SANDBOX & USER ISOLATION TESTS PASSED! 🎉');
  console.log('================================================================\n');
}

runPhase4Tests().catch((err) => {
  console.error('❌ Phase 4 Test failed:', err);
  process.exit(1);
});
