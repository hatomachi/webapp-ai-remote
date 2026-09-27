import http from 'node:http';
import { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TokenAuthManager } from '../packages/agent/src/tokenAuthManager.js';
import {
  listSessions,
  getSessionMessages,
  saveSessionHistory,
  deleteSession,
} from '../packages/agent/src/sessionManager.js';
import { WorkspaceManager } from '../packages/agent/src/workspaceManager.js';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase53TokenAuthTests() {
  console.log('======================================================================');
  console.log('🚀 Starting Phase 5-3: GitLab PAT Dynamic Auth & Session Privacy Tests');
  console.log('======================================================================\n');

  // --- 1. モック GitLab & GitHub HTTP サーバーのセットアップ ---
  let gitlabCallCount = 0;
  let githubCallCount = 0;

  const mockServer = http.createServer((req, res) => {
    const url = req.url || '';
    const headers = req.headers;

    // モック GitLab API: GET /api/v4/user
    if (url === '/api/v4/user') {
      gitlabCallCount++;
      const token = headers['private-token'];
      if (token === 'glpat-tanaka-valid') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 101,
          username: 'taro.tanaka',
          name: 'Taro Tanaka',
          email: 'tanaka@company.co.jp',
          state: 'active'
        }));
      } else if (token === 'glpat-blocked-user') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 102,
          username: 'blocked_user',
          name: 'Blocked Person',
          state: 'blocked'
        }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: '401 Unauthorized' }));
      }
      return;
    }

    // モック GitHub API: GET /user
    if (url === '/user') {
      githubCallCount++;
      const auth = headers['authorization'];
      if (auth === 'Bearer ghp_sato_valid') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 201,
          login: 'sato-ken',
          name: 'Ken Sato',
          email: 'sato@company.co.jp'
        }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Bad credentials' }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => mockServer.listen(0, resolve));
  const serverPort = (mockServer.address() as AddressInfo).port;
  const mockGitlabUrl = `http://localhost:${serverPort}/api/v4`;
  const mockGithubUrl = `http://localhost:${serverPort}`;

  console.log(`[TestSetup] Mock Auth Server listening on port ${serverPort}`);

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

  try {
    // --- Test 1: GitLab PAT 正常検証とユーザー名サニタイズ ---
    console.log('\n--- Test 1: GitLab PAT 正常検証とユーザー名サニタイズ ---');
    const authManager = new TokenAuthManager({
      gitlabApiUrl: mockGitlabUrl,
      githubApiUrl: mockGithubUrl,
      strictMode: true,
      cacheTtlMs: 5000,
    });

    const result1 = await authManager.authenticate({
      gitlabToken: 'glpat-tanaka-valid',
      userName: 'imposter-user', // 自己申告名は偽装
    });

    assert(result1.success === true, 'GitLab PAT検証が成功すること');
    assert(result1.user?.username === 'taro-tanaka', `サニタイズされたユーザー名 'taro-tanaka' が確定すること (got: ${result1.user?.username})`);
    assert(result1.user?.rawUsername === 'taro.tanaka', '元のユーザー名 taro.tanaka が保持されること');
    assert(result1.user?.email === 'tanaka@company.co.jp', 'メールアドレスが取得されること');
    assert(result1.user?.provider === 'gitlab', 'プロバイダが gitlab であること');
    assert(gitlabCallCount === 1, `GitLab APIが1回呼ばれたこと (count: ${gitlabCallCount})`);

    // --- Test 2: インメモリキャッシュ（高速化・レート制限対策） ---
    console.log('\n--- Test 2: インメモリキャッシュ（API呼び出しスキップ） ---');
    const result2 = await authManager.authenticate({
      gitlabToken: 'glpat-tanaka-valid',
    });

    assert(result2.success === true, '2回目も認証成功すること');
    assert(result2.user?.username === 'taro-tanaka', 'キャッシュから正しいユーザー名が返ること');
    assert(gitlabCallCount === 1, `2回目はAPIが呼ばれずキャッシュが使われたこと (count: ${gitlabCallCount})`);

    // --- Test 3: 無効な GitLab PAT による 401 Unauthorized ---
    console.log('\n--- Test 3: 無効な GitLab PAT による 401 Unauthorized ---');
    const result3 = await authManager.authenticate({
      gitlabToken: 'glpat-invalid-token-xyz',
    });

    assert(result3.success === false, '無効なトークンが失敗すること');
    assert(result3.statusCode === 401, '401 ステータスコードが返ること');
    assert(result3.error?.includes('401') === true, '401 Unauthorized エラーメッセージが含まれること');

    // --- Test 4: 凍結・無効化された GitLab アカウントの拒否 ---
    console.log('\n--- Test 4: 凍結・無効化された GitLab アカウントの拒否 ---');
    const result4 = await authManager.authenticate({
      gitlabToken: 'glpat-blocked-user',
    });

    assert(result4.success === false, '凍結アカウントが拒否されること');
    assert(result4.statusCode === 403, '403 ステータスコードが返ること');
    assert(result4.error?.includes('無効な状態') === true, '凍結理由が含まれること');

    // --- Test 5: GitHub Copilot Token（サブプロバイダ）の検証 ---
    console.log('\n--- Test 5: GitHub Copilot Token（サブプロバイダ）の検証 ---');
    const result5 = await authManager.authenticate({
      copilotToken: 'ghp_sato_valid',
    });

    assert(result5.success === true, 'GitHub Token で認証成功すること');
    assert(result5.user?.username === 'sato-ken', `ユーザー名 sato-ken が確定すること (got: ${result5.user?.username})`);
    assert(result5.user?.provider === 'github', 'プロバイダが github であること');
    assert(githubCallCount === 1, 'GitHub API が1回呼ばれたこと');

    // --- Test 6: 厳格モード（strictMode）でのトークン未指定遮断 ---
    console.log('\n--- Test 6: 厳格モード（strictMode）でのトークン未指定遮断 ---');
    const result6 = await authManager.authenticate({
      userName: 'taro-tanaka', // トークンなし
    });

    assert(result6.success === false, 'トークンなしは拒否されること');
    assert(result6.statusCode === 401, '401 Unauthorized が返ること');

    // --- Test 7: 非厳格モード（自宅開発・ローカルフォールバック） ---
    console.log('\n--- Test 7: 非厳格モード（自宅開発・ローカルフォールバック） ---');
    const devAuthManager = new TokenAuthManager({
      strictMode: false,
    });

    const result7 = await devAuthManager.authenticate({
      userName: 'local-dev-user',
    });

    assert(result7.success === true, '非厳格モードでは自己申告が許可されること');
    assert(result7.user?.username === 'local-dev-user', '自己申告のユーザー名が設定されること');
    assert(result7.user?.provider === 'anonymous', 'プロバイダが anonymous であること');

    // --- Test 8: セッション履歴の所有者分離（listSessions, getSessionMessages, deleteSession） ---
    console.log('\n--- Test 8: セッション履歴の所有者分離 ---');

    // テストセッションを保存
    saveSessionHistory('session-tanaka-1', [
      { id: '1', role: 'user', content: '田中の機密プロンプト', timestamp: new Date().toISOString(), sessionId: 'session-tanaka-1' },
      { id: '2', role: 'assistant', content: '田中の回答', timestamp: new Date().toISOString(), sessionId: 'session-tanaka-1' }
    ], {
      cwd: '/tmp/test-tanaka',
      title: '田中のセッション',
      owner: 'taro-tanaka'
    });

    saveSessionHistory('session-sato-1', [
      { id: '1', role: 'user', content: '佐藤の機密プロンプト', timestamp: new Date().toISOString(), sessionId: 'session-sato-1' },
      { id: '2', role: 'assistant', content: '佐藤の回答', timestamp: new Date().toISOString(), sessionId: 'session-sato-1' }
    ], {
      cwd: '/tmp/test-sato',
      title: '佐藤のセッション',
      owner: 'sato-ken'
    });

    // 田中としてセッション一覧を取得
    const tanakaSessions = await listSessions(undefined, undefined, 'taro-tanaka');
    const hasTanakaSession = tanakaSessions.some(s => s.id === 'session-tanaka-1');
    const hasSatoSession = tanakaSessions.some(s => s.id === 'session-sato-1');

    assert(hasTanakaSession === true, '田中の一覧に田中のセッションが含まれること');
    assert(hasSatoSession === false, '田中の一覧に佐藤のセッションが含まれないこと（他者不可視化）');

    // 佐藤としてセッション一覧を取得
    const satoSessions = await listSessions(undefined, undefined, 'sato-ken');
    assert(satoSessions.some(s => s.id === 'session-sato-1') === true, '佐藤の一覧に佐藤のセッションが含まれること');
    assert(satoSessions.some(s => s.id === 'session-tanaka-1') === false, '佐藤の一覧に田中のセッションが含まれないこと');

    // 他人のセッションメッセージへの直接アクセス拒否
    const stolenMessages = await getSessionMessages('session-sato-1', undefined, 'taro-tanaka');
    assert(stolenMessages.length === 0, '田中が佐藤のセッションメッセージを取得しようとした場合、拒否（空）されること');

    const ownMessages = await getSessionMessages('session-tanaka-1', undefined, 'taro-tanaka');
    assert(ownMessages.length === 2, '田中のセッションメッセージは正常に取得できること');

    // 他人のセッション削除拒否
    const deleteAttempt = deleteSession('session-sato-1', 'taro-tanaka');
    assert(deleteAttempt === false, '田中による佐藤のセッション削除要求が拒否（false）されること');

    const satoSessionAfterAttempt = await getSessionMessages('session-sato-1', undefined, 'sato-ken');
    assert(satoSessionAfterAttempt.length === 2, '拒否後も佐藤のセッションデータが削除されず無事であること');

    // 本人によるセッション削除
    const ownDelete = deleteSession('session-tanaka-1', 'taro-tanaka');
    assert(ownDelete === true, '本人によるセッション削除が成功すること');

    // --- Test 9: ワークスペース初期化（cleanup_workspace）での認証統合 ---
    console.log('\n--- Test 9: ワークスペース初期化での認証統合（他者破壊防止） ---');
    const testDir = path.join(os.tmpdir(), `ai-remote-test-ws-${Date.now()}`);
    const workspacesDir = path.join(testDir, 'workspaces');
    fs.mkdirSync(workspacesDir, { recursive: true });

    const wsManager = new WorkspaceManager({
      baseReposDir: path.join(testDir, 'base-repos'),
      workspacesDir,
      sandboxOptions: { enabled: false }
    });

    wsManager.ensureUserWorkspace('taro-tanaka');
    wsManager.ensureUserWorkspace('sato-ken');

    // 田中のトークンで佐藤のワークスペースを初期化しようとする攻撃
    const attackerCreds = { gitlabToken: 'glpat-tanaka-valid', userName: 'sato-ken' };
    const attackerAuth = await authManager.authenticate(attackerCreds);

    // 認証により、送信者の正統な名前は 'taro-tanaka' と確定する
    const verifiedSender = attackerAuth.user?.username;
    const targetWorkspace = wsManager.sanitizeUserName('sato-ken');
    const isSelfCleanup = Boolean(verifiedSender && targetWorkspace && verifiedSender === targetWorkspace);

    assert(verifiedSender === 'taro-tanaka', `攻撃者の自称に関わらず正統なユーザー名 'taro-tanaka' が確定すること`);
    assert(isSelfCleanup === false, '他人のワークスペース自己初期化は不許可（isSelf = false）となること');

    // 自身のワークスペース初期化
    const ownTargetWorkspace = wsManager.sanitizeUserName('taro-tanaka');
    const isOwnCleanup = Boolean(verifiedSender && ownTargetWorkspace && verifiedSender === ownTargetWorkspace);
    assert(isOwnCleanup === true, '自身のワークスペース初期化は許可（isSelf = true）となること');

    // --- Test 10: WebSocket E2E メッセージ中継テスト ---
    console.log('\n--- Test 10: WebSocket E2E メッセージ中継テスト ---');
    const { WebSocketServer, WebSocket } = await import('ws');
    const wss = new WebSocketServer({ port: 0 });
    const wsPort = (wss.address() as AddressInfo).port;

    const receivedByClient: any[] = [];

    // Agent メッセージ処理のエミュレーション
    wss.on('connection', (clientWs) => {
      clientWs.on('message', async (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'verify_credentials') {
          const auth = await authManager.authenticate(msg.credentials);
          clientWs.send(JSON.stringify({
            type: 'verify_credentials_result',
            success: auth.success,
            user: auth.user,
            error: auth.error,
            targetClientId: msg.clientId,
            timestamp: new Date().toISOString()
          }));
        } else if (msg.type === 'prompt') {
          const auth = await authManager.authenticate(msg.credentials);
          if (!auth.success) {
            clientWs.send(JSON.stringify({
              type: 'turn_error',
              error: auth.error || '401 Unauthorized',
              targetClientId: msg.clientId,
              timestamp: new Date().toISOString()
            }));
          }
        } else if (msg.type === 'list_sessions') {
          const auth = await authManager.authenticate(msg.credentials);
          const owner = auth.success && auth.user ? auth.user.username : undefined;
          const sessions = await listSessions(msg.projectId, msg.cwd, owner);
          clientWs.send(JSON.stringify({
            type: 'sessions_list',
            sessions,
            targetClientId: msg.clientId,
            timestamp: new Date().toISOString()
          }));
        }
      });
    });

    const client = new WebSocket(`ws://localhost:${wsPort}`);
    await new Promise<void>((resolve) => client.on('open', resolve));

    client.on('message', (data) => {
      receivedByClient.push(JSON.parse(data.toString()));
    });

    // 10-1: verify_credentials 送信
    client.send(JSON.stringify({
      type: 'verify_credentials',
      credentials: { gitlabToken: 'glpat-tanaka-valid' },
      clientId: 'client-1'
    }));

    await wait(100);
    const verifyRes = receivedByClient.find(m => m.type === 'verify_credentials_result');
    assert(Boolean(verifyRes), 'verify_credentials_result を受信したこと');
    assert(verifyRes?.success === true, 'verify_credentials_result が成功であること');
    assert(verifyRes?.user?.username === 'taro-tanaka', `検証済みユーザー名が 'taro-tanaka' であること`);

    // 10-2: トークンなし prompt 送信での 401 turn_error 受信
    client.send(JSON.stringify({
      type: 'prompt',
      text: 'hello without token',
      credentials: {}, // トークン未指定
      clientId: 'client-1'
    }));

    await wait(100);
    const turnErrorRes = receivedByClient.find(m => m.type === 'turn_error');
    assert(Boolean(turnErrorRes), 'トークンなしプロンプトで turn_error を受信したこと');
    assert(turnErrorRes?.error?.includes('401') === true, 'エラーメッセージに 401 が含まれること');

    // 10-3: list_sessions での所有者限定フィルタリング
    client.send(JSON.stringify({
      type: 'list_sessions',
      credentials: { gitlabToken: 'glpat-tanaka-valid' },
      clientId: 'client-1'
    }));

    await wait(100);
    const sessionsListRes = receivedByClient.find(m => m.type === 'sessions_list');
    assert(Boolean(sessionsListRes), 'sessions_list を受信したこと');
    const returnedSessions = sessionsListRes?.sessions || [];
    assert(returnedSessions.some((s: any) => s.owner === 'sato-ken') === false, '佐藤のセッションが除外されていること');

    client.close();
    await new Promise<void>((resolve) => wss.close(resolve));

  } finally {
    mockServer.close();
  }

  console.log('\n======================================================================');
  console.log(`🎉 Phase 5-3 Tests Completed: ${passed} passed, ${failed} failed`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase53TokenAuthTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
