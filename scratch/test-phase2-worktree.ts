import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { WorkspaceManager, UserCredentials } from '../packages/agent/src/workspaceManager.js';

const TEST_BASE_DIR = '/tmp/test-shared-ec2-base-repos';
const TEST_WS_DIR = '/tmp/test-shared-ec2-workspaces';

function setupTestEnvironment() {
  console.log('--- [Step 1] Initializing Test Base Repositories ---');
  fs.rmSync(TEST_BASE_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_WS_DIR, { recursive: true, force: true });

  fs.mkdirSync(TEST_BASE_DIR, { recursive: true });
  fs.mkdirSync(TEST_WS_DIR, { recursive: true });

  // 1. vault リポジトリ作成
  const vaultPath = path.join(TEST_BASE_DIR, 'vault');
  fs.mkdirSync(vaultPath);
  execSync('git init -b main', { cwd: vaultPath, stdio: 'pipe' });
  execSync('git config user.name "Test Admin"', { cwd: vaultPath, stdio: 'pipe' });
  execSync('git config user.email "admin@internal"', { cwd: vaultPath, stdio: 'pipe' });
  fs.writeFileSync(path.join(vaultPath, 'README.md'), '# Company Vault\nShared knowledge base.\n');
  execSync('git add . && git commit -m "feat: initial commit for vault"', { cwd: vaultPath, stdio: 'pipe' });

  // 2. iac リポジトリ作成
  const iacPath = path.join(TEST_BASE_DIR, 'iac');
  fs.mkdirSync(iacPath);
  execSync('git init -b main', { cwd: iacPath, stdio: 'pipe' });
  execSync('git config user.name "Test Admin"', { cwd: iacPath, stdio: 'pipe' });
  execSync('git config user.email "admin@internal"', { cwd: iacPath, stdio: 'pipe' });
  fs.writeFileSync(path.join(iacPath, 'main.tf'), '# Terraform Main\n');
  execSync('git add . && git commit -m "feat: initial commit for iac"', { cwd: iacPath, stdio: 'pipe' });

  console.log('✅ Base repositories (vault, iac) initialized successfully.');
}

async function runTests() {
  setupTestEnvironment();

  console.log('\n--- [Step 2] Testing WorkspaceManager Initialization ---');
  const mgr = new WorkspaceManager({
    baseReposDir: TEST_BASE_DIR,
    workspacesDir: TEST_WS_DIR
  });

  if (!mgr.isMultiTenant) {
    throw new Error('Assertion failed: isMultiTenant should be true');
  }
  console.log('✅ WorkspaceManager initialized in multi-tenant mode.');

  console.log('\n--- [Step 3] Testing ensureUserWorkspace for Tanaka (Taro Tanaka) ---');
  const tanakaWs = mgr.ensureUserWorkspace('Taro Tanaka');
  console.log(`Sanitized user: ${tanakaWs.sanitizedUser}`);
  if (tanakaWs.sanitizedUser !== 'taro-tanaka') {
    throw new Error(`Assertion failed: expected 'taro-tanaka', got '${tanakaWs.sanitizedUser}'`);
  }

  if (tanakaWs.worktrees.length !== 2) {
    throw new Error(`Assertion failed: expected 2 worktrees, got ${tanakaWs.worktrees.length}`);
  }

  const tanakaVault = tanakaWs.worktrees.find(w => w.name === 'vault');
  const tanakaIac = tanakaWs.worktrees.find(w => w.name === 'iac');
  if (!tanakaVault || !tanakaIac) {
    throw new Error('Assertion failed: vault or iac worktree missing');
  }

  if (tanakaVault.branch !== 'user/taro-tanaka' || tanakaIac.branch !== 'user/taro-tanaka') {
    throw new Error(`Assertion failed: expected branch 'user/taro-tanaka'`);
  }

  // AGENTS.md の確認
  const agentsMd = fs.readFileSync(path.join(tanakaWs.userWorkspaceDir, 'AGENTS.md'), 'utf-8');
  if (!agentsMd.includes('AI Workspace Guide for taro-tanaka') || !agentsMd.includes('user/taro-tanaka')) {
    throw new Error('Assertion failed: AGENTS.md content is invalid');
  }
  console.log('✅ Tanaka workspace and worktrees created with branch user/taro-tanaka.');

  // 冪等性の検証（2回目の呼び出しでエラーなく同じ構成が返ること）
  const tanakaWs2 = mgr.ensureUserWorkspace('Taro Tanaka');
  if (tanakaWs2.worktrees.length !== 2) {
    throw new Error('Assertion failed: Idempotent call should return 2 worktrees');
  }
  console.log('✅ Idempotency test passed (second call returned existing worktrees).');

  console.log('\n--- [Step 4] Testing Multi-tenant Isolation (Tanaka vs Sato) ---');
  const satoWs = mgr.ensureUserWorkspace('jiro.sato@company.com');
  console.log(`Sanitized user: ${satoWs.sanitizedUser}`);
  if (satoWs.sanitizedUser !== 'jiro-sato') {
    throw new Error(`Assertion failed: expected 'jiro-sato', got '${satoWs.sanitizedUser}'`);
  }

  const satoVault = satoWs.worktrees.find(w => w.name === 'vault');
  if (!satoVault || satoVault.branch !== 'user/jiro-sato') {
    throw new Error(`Assertion failed: Sato vault worktree branch should be 'user/jiro-sato'`);
  }

  // 田中さんの worktree で作業・コミット
  fs.writeFileSync(path.join(tanakaVault.path, 'tanaka-note.md'), '# Tanaka Secret Notes\n');
  execSync('git add . && git commit -m "docs: add tanaka note"', { cwd: tanakaVault.path, stdio: 'pipe' });

  // 佐藤さんの worktree には tanaka-note.md が存在しないこと
  if (fs.existsSync(path.join(satoVault.path, 'tanaka-note.md'))) {
    throw new Error('CRITICAL FAILURE: Isolation breached! Tanaka note visible in Sato workspace');
  }

  // 大元の base-repos/vault にも tanaka-note.md が存在しないこと
  if (fs.existsSync(path.join(TEST_BASE_DIR, 'vault', 'tanaka-note.md'))) {
    throw new Error('CRITICAL FAILURE: Isolation breached! Tanaka note leaked to base-repo main branch');
  }
  console.log('✅ Multi-tenant isolation verified: Tanaka branch changes are completely isolated from Sato and base-repo.');

  console.log('\n--- [Step 5] Testing Dynamic Credentials & Environment Injection ---');
  const credentials: UserCredentials = {
    userName: 'Taro Tanaka',
    userEmail: 'tanaka@company.co.jp',
    copilotToken: 'ghp_mock_copilot_token_12345',
    claudeApiKey: 'sk-ant-mock-claude-key-67890',
    gitlabToken: 'glpat-mock-gitlab-token-abcde'
  };

  const childEnv = mgr.buildChildProcessEnv(credentials);
  if (childEnv.GIT_AUTHOR_NAME !== 'Taro Tanaka' || childEnv.GIT_COMMITTER_NAME !== 'Taro Tanaka') {
    throw new Error('Assertion failed: GIT_AUTHOR_NAME not injected');
  }
  if (childEnv.GIT_AUTHOR_EMAIL !== 'tanaka@company.co.jp' || childEnv.GIT_COMMITTER_EMAIL !== 'tanaka@company.co.jp') {
    throw new Error('Assertion failed: GIT_AUTHOR_EMAIL not injected');
  }
  if (childEnv.GH_TOKEN !== 'ghp_mock_copilot_token_12345' || childEnv.GITHUB_TOKEN !== 'ghp_mock_copilot_token_12345') {
    throw new Error('Assertion failed: GH_TOKEN not injected');
  }
  if (childEnv.ANTHROPIC_API_KEY !== 'sk-ant-mock-claude-key-67890') {
    throw new Error('Assertion failed: ANTHROPIC_API_KEY not injected');
  }
  if (childEnv.GITLAB_TOKEN !== 'glpat-mock-gitlab-token-abcde') {
    throw new Error('Assertion failed: GITLAB_TOKEN not injected');
  }

  // 親プロセス環境変数が汚染されていないことの確認
  if (process.env.GIT_AUTHOR_NAME !== undefined && process.env.GIT_AUTHOR_NAME === 'Taro Tanaka') {
    throw new Error('CRITICAL FAILURE: Parent process.env was contaminated!');
  }
  console.log('✅ Dynamic credentials injection verified: Child process env receives all tokens/identities while parent env remains pristine.');

  console.log('\n--- [Step 6] Testing scanUserProjects ---');
  const projectList = mgr.scanUserProjects('Taro Tanaka');
  console.log(`Found ${projectList.projects.length} projects for Taro Tanaka:`);
  projectList.projects.forEach(p => console.log(`  - [${p.id}] ${p.name} (${p.path})`));
  if (projectList.projects.length !== 3) { // 1 workspace-root + 2 worktrees (vault, iac)
    throw new Error(`Assertion failed: expected 3 projects, got ${projectList.projects.length}`);
  }
  console.log('✅ scanUserProjects verified.');

  console.log('\n--- [Step 7] Testing Admin API (listBaseRepos, listWorkspaces, cleanupWorkspace) ---');
  // 1. listBaseRepos
  const baseRepos = mgr.listBaseRepos();
  console.log(`Base repos count: ${baseRepos.length}`);
  if (baseRepos.length !== 2) {
    throw new Error(`Assertion failed: expected 2 base repos, got ${baseRepos.length}`);
  }
  console.log(`  - ${baseRepos[0].name} (branch: ${baseRepos[0].branch}, commit: ${baseRepos[0].lastCommit})`);
  console.log(`  - ${baseRepos[1].name} (branch: ${baseRepos[1].branch}, commit: ${baseRepos[1].lastCommit})`);

  // 2. listWorkspaces
  const wsList = mgr.listWorkspaces();
  console.log(`Workspaces count: ${wsList.workspaces.length}`);
  if (wsList.workspaces.length !== 2) {
    throw new Error(`Assertion failed: expected 2 workspaces, got ${wsList.workspaces.length}`);
  }
  console.log(`Disk stats: Total ${(wsList.diskStats.totalBytes / 1024 / 1024).toFixed(0)} MB, Free ${(wsList.diskStats.freeBytes / 1024 / 1024).toFixed(0)} MB`);

  // 3. cleanupWorkspace (佐藤さんのみクリーンアップ)
  console.log('Cleaning up Sato workspace...');
  const cleanupRes = mgr.cleanupWorkspace('jiro-sato');
  if (!cleanupRes.success) {
    throw new Error(`Assertion failed: cleanupWorkspace failed: ${cleanupRes.error}`);
  }

  const afterCleanupWs = mgr.listWorkspaces();
  if (afterCleanupWs.workspaces.length !== 1 || afterCleanupWs.workspaces[0].userName !== 'taro-tanaka') {
    throw new Error(`Assertion failed: Sato workspace should be removed, leaving only Tanaka`);
  }
  // 田中さんのワークスペースとファイルが健全であることを再確認
  if (!fs.existsSync(path.join(tanakaVault.path, 'tanaka-note.md'))) {
    throw new Error('Assertion failed: Tanaka workspace damaged during Sato cleanup');
  }
  console.log('✅ Admin API (listBaseRepos, listWorkspaces, cleanupWorkspace) verified.');

  // クリーンアップ
  fs.rmSync(TEST_BASE_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_WS_DIR, { recursive: true, force: true });
  console.log('\n🎉 ALL PHASE 2 TESTS PASSED PERFECTLY! 🎉\n');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
