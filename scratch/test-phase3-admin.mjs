import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { WorkspaceManager } from '../packages/agent/dist/workspaceManager.js';

console.log('--- Phase 3 Multi-tenant & Admin Protocol Integration Test ---');

const tmpDir = path.join(os.tmpdir(), `test-phase3-${Date.now()}`);
const baseReposDir = path.join(tmpDir, 'base-repos');
const workspacesDir = path.join(tmpDir, 'workspaces');

fs.mkdirSync(baseReposDir, { recursive: true });
fs.mkdirSync(workspacesDir, { recursive: true });

try {
  const manager = new WorkspaceManager({ baseReposDir, workspacesDir });

  // 1. 大元リポジトリ一覧の取得テスト (admin:list_repos)
  console.log('[Test 1] Testing listBaseRepos...');
  const initialRepos = manager.listBaseRepos();
  assert(Array.isArray(initialRepos), 'Repos should be an array');
  assert.strictEqual(initialRepos.length, 0, 'Initial repos should be empty');
  console.log('✓ listBaseRepos passed (empty)');

  // 2. 新規リポジトリクローンのシミュレーション (ローカルGitリポジトリをbase-reposに作成)
  console.log('[Test 2] Simulating base repo creation...');
  const testRepoPath = path.join(baseReposDir, 'system-a-iac');
  fs.mkdirSync(testRepoPath, { recursive: true });
  fs.mkdirSync(path.join(testRepoPath, '.git'), { recursive: true });
  fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# System A IaC');

  const reposAfter = manager.listBaseRepos();
  assert.strictEqual(reposAfter.length, 1, 'Should find 1 base repo');
  assert.strictEqual(reposAfter[0].name, 'system-a-iac');
  console.log('✓ Base repo recognized in listBaseRepos');

  // 3. メンバーワークスペース一覧 & ディスク容量取得テスト (admin:list_workspaces)
  console.log('[Test 3] Testing listWorkspaces & diskStats...');
  const wsResult = manager.listWorkspaces();
  assert(Array.isArray(wsResult.workspaces), 'Workspaces should be an array');
  assert(wsResult.diskStats, 'diskStats should exist');
  assert(typeof wsResult.diskStats.totalBytes === 'number', 'totalBytes should be number');
  assert(typeof wsResult.diskStats.freeBytes === 'number', 'freeBytes should be number');
  console.log(`✓ listWorkspaces passed (diskStats: total=${(wsResult.diskStats.totalBytes / (1024*1024*1024)).toFixed(1)}GB)`);

  // 4. 個人認証トークン・コミット名義の環境変数動的注入テスト
  console.log('[Test 4] Testing buildChildProcessEnv with UserCredentials...');
  const credentials = {
    userName: 'Taro Tanaka',
    userEmail: 'tanaka@company.co.jp',
    copilotToken: 'ghp_secret_copilot_token_12345',
    claudeApiKey: 'sk-ant-secret_claude_key_67890',
    gitlabToken: 'glpat-secret_gitlab_token_abcde',
  };

  const childEnv = manager.buildChildProcessEnv(credentials);

  assert.strictEqual(childEnv.GIT_AUTHOR_NAME, 'Taro Tanaka');
  assert.strictEqual(childEnv.GIT_COMMITTER_NAME, 'Taro Tanaka');
  assert.strictEqual(childEnv.GIT_AUTHOR_EMAIL, 'tanaka@company.co.jp');
  assert.strictEqual(childEnv.GIT_COMMITTER_EMAIL, 'tanaka@company.co.jp');
  assert.strictEqual(childEnv.GH_TOKEN, 'ghp_secret_copilot_token_12345');
  assert.strictEqual(childEnv.GITHUB_TOKEN, 'ghp_secret_copilot_token_12345');
  assert.strictEqual(childEnv.ANTHROPIC_API_KEY, 'sk-ant-secret_claude_key_67890');
  assert.strictEqual(childEnv.GITLAB_TOKEN, 'glpat-secret_gitlab_token_abcde');

  // 親プロセスの process.env は一切汚染されていないことを検証
  assert.notStrictEqual(process.env.GH_TOKEN, 'ghp_secret_copilot_token_12345');
  assert.notStrictEqual(process.env.GIT_AUTHOR_NAME, 'Taro Tanaka');
  console.log('✓ Child process env injection passed (no parent env pollution)');

  // 5. ワークスペースの安全クリーンアップテスト (admin:cleanup_workspace)
  console.log('[Test 5] Testing cleanupWorkspace...');
  const userDir = path.join(workspacesDir, 'taro-tanaka');
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, 'dummy.txt'), 'hello');

  const cleanupRes = manager.cleanupWorkspace('Taro Tanaka');
  assert.strictEqual(cleanupRes.success, true);
  assert.strictEqual(cleanupRes.userName, 'taro-tanaka');
  assert(!fs.existsSync(userDir), 'Workspace directory should be removed');
  console.log('✓ cleanupWorkspace passed');

  console.log('\n========================================');
  console.log('🎉 ALL PHASE 3 INTEGRATION TESTS PASSED!');
  console.log('========================================\n');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
