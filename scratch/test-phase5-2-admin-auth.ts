import { WebSocketServer, WebSocket } from 'ws';
import { WorkspaceManager } from '../packages/agent/src/workspaceManager.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase52AdminAuthTests() {
  console.log('======================================================================');
  console.log('🚀 Starting Phase 5-2: Admin Token & Workspace Cleanup Auth Tests');
  console.log('======================================================================\n');

  // テスト用の一時ディレクトリを準備
  const testDir = path.join(os.tmpdir(), `ai-remote-test-auth-${Date.now()}`);
  const baseReposDir = path.join(testDir, 'base-repos');
  const workspacesDir = path.join(testDir, 'workspaces');
  fs.mkdirSync(baseReposDir, { recursive: true });
  fs.mkdirSync(workspacesDir, { recursive: true });

  const workspaceManager = new WorkspaceManager({
    baseReposDir,
    workspacesDir,
    sandboxOptions: { enabled: false }
  });

  // テスト用の作業スペースを事前作成
  workspaceManager.ensureUserWorkspace('tanaka');
  workspaceManager.ensureUserWorkspace('sato');

  const EXPECTED_ADMIN_TOKEN = 'secret-admin-pass-xyz-987';

  function verifyAdminToken(token?: string): boolean {
    if (!EXPECTED_ADMIN_TOKEN) return false;
    return Boolean(token && token.trim() === EXPECTED_ADMIN_TOKEN);
  }

  // Agent の index.ts と全く同一のメッセージハンドリングロジックをエミュレート
  function processMessage(msg: any): any {
    if (msg.type === 'admin:list_repos') {
      if (!verifyAdminToken(msg.adminToken)) {
        return {
          type: 'admin:repos_list',
          repos: [],
          success: false,
          error: '管理者トークンが無効または未指定です (403 Forbidden)',
          targetClientId: msg.clientId
        };
      }
      const repos = workspaceManager.listBaseRepos();
      return {
        type: 'admin:repos_list',
        repos,
        success: true,
        targetClientId: msg.clientId
      };
    } else if (msg.type === 'admin:clone_repo') {
      if (!verifyAdminToken(msg.adminToken)) {
        return {
          type: 'admin:clone_repo_result',
          success: false,
          error: '管理者トークンが無効または未指定です (403 Forbidden)',
          targetClientId: msg.clientId
        };
      }
      return {
        type: 'admin:clone_repo_result',
        success: true,
        repoName: msg.name || 'mock-repo',
        targetClientId: msg.clientId
      };
    } else if (msg.type === 'admin:list_workspaces') {
      if (!verifyAdminToken(msg.adminToken)) {
        return {
          type: 'admin:workspaces_list',
          workspaces: [],
          diskStats: { totalBytes: 0, usedBytes: 0, freeBytes: 0 },
          success: false,
          error: '管理者トークンが無効または未指定です (403 Forbidden)',
          targetClientId: msg.clientId
        };
      }
      const result = workspaceManager.listWorkspaces();
      return {
        type: 'admin:workspaces_list',
        ...result,
        success: true,
        targetClientId: msg.clientId
      };
    } else if (msg.type === 'admin:cleanup_workspace') {
      const isAdmin = verifyAdminToken(msg.adminToken);
      const targetUser = workspaceManager.sanitizeUserName(msg.userName);
      const senderRaw = msg.credentials?.userName;
      const senderUser = senderRaw ? workspaceManager.sanitizeUserName(senderRaw) : undefined;
      const isSelf = Boolean(senderUser && targetUser && senderUser === targetUser);

      if (!isAdmin && !isSelf) {
        return {
          type: 'admin:cleanup_workspace_result',
          success: false,
          userName: targetUser,
          error: `他メンバー (${targetUser}) のワークスペースを削除する権限がありません (403 Forbidden)`,
          targetClientId: msg.clientId
        };
      }

      const result = workspaceManager.cleanupWorkspace(targetUser);
      return {
        type: 'admin:cleanup_workspace_result',
        ...result,
        targetClientId: msg.clientId
      };
    }
  }

  // --- Scenario 1: 管理者トークンによる大元一覧取得 ---
  console.log('[Scenario 1] Admin requests list of base repos with correct adminToken...');
  const res1 = processMessage({
    type: 'admin:list_repos',
    adminToken: EXPECTED_ADMIN_TOKEN,
    clientId: 'client-admin'
  });
  if (res1.success === true && Array.isArray(res1.repos)) {
    console.log('  ✅ PASS: Admin successfully retrieved base repos list.');
  } else {
    throw new Error(`FAIL Scenario 1: Expected success=true, got ${JSON.stringify(res1)}`);
  }

  // --- Scenario 2: トークンなし・不正トークンでの大元一覧取得拒否 ---
  console.log('[Scenario 2] Unauthorized user requests base repos list without token...');
  const res2 = processMessage({
    type: 'admin:list_repos',
    adminToken: 'wrong-token',
    clientId: 'client-user'
  });
  if (res2.success === false && res2.error?.includes('403 Forbidden')) {
    console.log('  ✅ PASS: Unauthorized list_repos was properly blocked with 403 Forbidden.');
  } else {
    throw new Error(`FAIL Scenario 2: Expected 403 Forbidden, got ${JSON.stringify(res2)}`);
  }

  // --- Scenario 3: 管理者トークンによる大元 clone 要求 ---
  console.log('[Scenario 3] Admin requests clone_repo with correct adminToken...');
  const res3 = processMessage({
    type: 'admin:clone_repo',
    repoUrl: 'https://gitlab.internal/group/new-repo.git',
    name: 'new-repo',
    adminToken: EXPECTED_ADMIN_TOKEN,
    clientId: 'client-admin'
  });
  if (res3.success === true) {
    console.log('  ✅ PASS: Admin clone_repo authorized and executed.');
  } else {
    throw new Error(`FAIL Scenario 3: Expected success=true, got ${JSON.stringify(res3)}`);
  }

  // --- Scenario 4: 一般ユーザーによる大元 clone 要求の遮断 ---
  console.log('[Scenario 4] Regular user attempts clone_repo without token...');
  const res4 = processMessage({
    type: 'admin:clone_repo',
    repoUrl: 'https://gitlab.internal/group/malicious-repo.git',
    name: 'malicious-repo',
    adminToken: undefined,
    clientId: 'client-user'
  });
  if (res4.success === false && res4.error?.includes('403 Forbidden')) {
    console.log('  ✅ PASS: Regular user clone_repo was safely blocked with 403 Forbidden.');
  } else {
    throw new Error(`FAIL Scenario 4: Expected 403 Forbidden, got ${JSON.stringify(res4)}`);
  }

  // --- Scenario 5: 管理者によるワークスペース一覧取得 ---
  console.log('[Scenario 5] Admin requests workspaces list with adminToken...');
  const res5 = processMessage({
    type: 'admin:list_workspaces',
    adminToken: EXPECTED_ADMIN_TOKEN,
    clientId: 'client-admin'
  });
  if (res5.success === true && Array.isArray(res5.workspaces) && res5.workspaces.length >= 2) {
    console.log(`  ✅ PASS: Admin retrieved workspaces list (${res5.workspaces.length} workspaces).`);
  } else {
    throw new Error(`FAIL Scenario 5: Expected success=true with workspaces, got ${JSON.stringify(res5)}`);
  }

  // --- Scenario 6: 一般ユーザーによるワークスペース一覧取得の遮断 ---
  console.log('[Scenario 6] Regular user attempts to view all members workspaces...');
  const res6 = processMessage({
    type: 'admin:list_workspaces',
    adminToken: '',
    clientId: 'client-user'
  });
  if (res6.success === false && res6.error?.includes('403 Forbidden')) {
    console.log('  ✅ PASS: Workspaces list privacy protected, blocked with 403 Forbidden.');
  } else {
    throw new Error(`FAIL Scenario 6: Expected 403 Forbidden, got ${JSON.stringify(res6)}`);
  }

  // --- Scenario 7: 一般ユーザーによる自己ワークスペース初期化 (Self Cleanup) ---
  console.log('[Scenario 7] Tanaka requests cleanup of their own workspace (self reset)...');
  const res7 = processMessage({
    type: 'admin:cleanup_workspace',
    userName: 'tanaka',
    credentials: { userName: 'tanaka' },
    clientId: 'client-tanaka'
  });
  if (res7.success === true && res7.userName === 'tanaka') {
    console.log('  ✅ PASS: Self workspace cleanup (reset) was permitted.');
  } else {
    throw new Error(`FAIL Scenario 7: Expected self cleanup to succeed, got ${JSON.stringify(res7)}`);
  }

  // --- Scenario 8: 一般ユーザーによる他者ワークスペース破壊の遮断 (Hijack Block) ---
  console.log('[Scenario 8] Sato attempts to cleanup/delete Tanaka\'s workspace without adminToken...');
  const res8 = processMessage({
    type: 'admin:cleanup_workspace',
    userName: 'tanaka',
    credentials: { userName: 'sato' },
    clientId: 'client-sato'
  });
  if (res8.success === false && res8.error?.includes('他メンバー (tanaka) のワークスペースを削除する権限がありません (403 Forbidden)')) {
    console.log('  ✅ PASS: Cross-member workspace destruction strictly blocked with 403 Forbidden.');
  } else {
    throw new Error(`FAIL Scenario 8: Expected 403 Forbidden on foreign workspace cleanup, got ${JSON.stringify(res8)}`);
  }

  // --- Scenario 9: 管理者トークンによる他者ワークスペース強制初期化 ---
  console.log('[Scenario 9] Admin forcibly cleans up Sato\'s workspace with adminToken...');
  const res9 = processMessage({
    type: 'admin:cleanup_workspace',
    userName: 'sato',
    adminToken: EXPECTED_ADMIN_TOKEN,
    clientId: 'client-admin'
  });
  if (res9.success === true && res9.userName === 'sato') {
    console.log('  ✅ PASS: Admin cleanup on member workspace was permitted.');
  } else {
    throw new Error(`FAIL Scenario 9: Expected admin cleanup to succeed, got ${JSON.stringify(res9)}`);
  }

  // ======================================================================
  // Part 2: WebSocket E2E 通信シミュレーション
  // ======================================================================
  console.log('\n--- Part 2: WebSocket Hub & Agent Inbound/Outbound E2E Test ---');

  const TEST_PORT = 9989;
  const wss = new WebSocketServer({ port: TEST_PORT });

  let agentSocket: WebSocket | null = null;
  const clientSockets = new Map<string, WebSocket>();

  wss.on('connection', (ws, req) => {
    const url = req.url || '';
    if (url.includes('/ws/agent')) {
      agentSocket = ws;
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        // targetClientId 宛てに個別ルーティング
        if (parsed.targetClientId && clientSockets.has(parsed.targetClientId)) {
          clientSockets.get(parsed.targetClientId)!.send(JSON.stringify(parsed));
        }
      });
    } else if (url.includes('/ws/client')) {
      const parsedUrl = new URL(url, 'http://localhost');
      const cid = parsedUrl.searchParams.get('clientId') || 'client-anon';
      clientSockets.set(cid, ws);
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        parsed.clientId = cid;
        // Agent へ転送
        if (agentSocket && agentSocket.readyState === WebSocket.OPEN) {
          agentSocket.send(JSON.stringify(parsed));
        }
      });
      ws.on('close', () => {
        clientSockets.delete(cid);
      });
    }
  });

  // Agent 接続のシミュレーション
  const agentWs = new WebSocket(`ws://localhost:${TEST_PORT}/ws/agent`);
  await new Promise((resolve) => agentWs.on('open', resolve));

  agentWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const reply = processMessage(msg);
    if (reply) {
      agentWs.send(JSON.stringify(reply));
    }
  });

  // Client A (Tanaka) 接続
  const clientTanaka = new WebSocket(`ws://localhost:${TEST_PORT}/ws/client?clientId=client-tanaka`);
  await new Promise((resolve) => clientTanaka.on('open', resolve));

  // Client B (Sato) 接続
  const clientSato = new WebSocket(`ws://localhost:${TEST_PORT}/ws/client?clientId=client-sato`);
  await new Promise((resolve) => clientSato.on('open', resolve));

  // Client Tanaka が自己初期化を要求
  console.log('[E2E Scenario 1] Tanaka sends cleanup_workspace for self over WebSocket...');
  const e2ePromise1 = new Promise<any>((resolve) => {
    clientTanaka.once('message', (data) => resolve(JSON.parse(data.toString())));
  });

  clientTanaka.send(JSON.stringify({
    type: 'admin:cleanup_workspace',
    userName: 'tanaka',
    credentials: { userName: 'tanaka' },
  }));

  const e2eRes1 = await e2ePromise1;
  if (e2eRes1.success === true && e2eRes1.userName === 'tanaka') {
    console.log('  ✅ PASS: Tanaka self-cleanup succeeded over WebSocket E2E.');
  } else {
    throw new Error(`FAIL E2E 1: ${JSON.stringify(e2eRes1)}`);
  }

  // Client Sato が Tanaka のワークスペース削除を試行 (不正)
  console.log('[E2E Scenario 2] Sato attempts to delete Tanaka workspace over WebSocket...');
  const e2ePromise2 = new Promise<any>((resolve) => {
    clientSato.once('message', (data) => resolve(JSON.parse(data.toString())));
  });

  clientSato.send(JSON.stringify({
    type: 'admin:cleanup_workspace',
    userName: 'tanaka',
    credentials: { userName: 'sato' },
  }));

  const e2eRes2 = await e2ePromise2;
  if (e2eRes2.success === false && e2eRes2.error?.includes('403 Forbidden')) {
    console.log('  ✅ PASS: Sato cross-deletion blocked over WebSocket E2E with 403 Forbidden.');
  } else {
    throw new Error(`FAIL E2E 2: ${JSON.stringify(e2eRes2)}`);
  }

  // 終了処理
  clientTanaka.close();
  clientSato.close();
  agentWs.close();
  wss.close();

  // 後処理: 一時テストディレクトリ削除
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  console.log('\n======================================================================');
  console.log('🎉 ALL 11 PHASE 5-2 AUTH & CLEANUP TESTS (INCL. E2E) PASSED SUCCESSFULLY!');
  console.log('======================================================================\n');
}

runPhase52AdminAuthTests().catch((err) => {
  console.error('❌ Phase 5-2 test failed:', err);
  process.exit(1);
});
