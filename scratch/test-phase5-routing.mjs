import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTestSuite() {
  console.log('🚀 Starting Phase 5 Session 5-1 Verification Tests (Hub Routing & Security Guard)...\n');

  const TEST_PORT = 3099;
  const TOKEN = 'test-token-phase5';

  // 1. Hub プロセスを起動
  console.log(`[Step 1] Spawning test Hub on port ${TEST_PORT}...`);
  const hubProcess = spawn('node', ['packages/hub/src/index.js'], {
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  hubProcess.stdout.on('data', (d) => {
    // console.log('[Hub]', d.toString().trim());
  });
  hubProcess.stderr.on('data', (d) => {
    console.error('[Hub Error]', d.toString().trim());
  });

  // Hub 起動待ち
  await wait(1000);

  try {
    const hubWsUrl = `ws://localhost:${TEST_PORT}`;

    // 2. Agent 接続
    console.log('[Step 2] Connecting Agent WebSocket...');
    const agentWs = new WebSocket(`${hubWsUrl}/ws/agent?token=${TOKEN}`);
    const agentReceived = [];
    agentWs.on('message', (d) => {
      try {
        agentReceived.push(JSON.parse(d.toString()));
      } catch {}
    });
    await new Promise((resolve, reject) => {
      agentWs.on('open', resolve);
      agentWs.on('error', reject);
    });
    console.log('  ✅ Agent connected.');

    // 3. Client A 接続 (clientId: client-A)
    console.log('[Step 3] Connecting Client A (clientId: client-A)...');
    const clientAWs = new WebSocket(`${hubWsUrl}/ws/client?token=${TOKEN}&clientId=client-A`);
    const clientAReceived = [];
    clientAWs.on('message', (d) => {
      try {
        clientAReceived.push(JSON.parse(d.toString()));
      } catch {}
    });
    await new Promise((resolve, reject) => {
      clientAWs.on('open', resolve);
      clientAWs.on('error', reject);
    });
    console.log('  ✅ Client A connected.');

    // 4. Client B 接続 (clientId: client-B)
    console.log('[Step 4] Connecting Client B (clientId: client-B)...');
    const clientBWs = new WebSocket(`${hubWsUrl}/ws/client?token=${TOKEN}&clientId=client-B`);
    const clientBReceived = [];
    clientBWs.on('message', (d) => {
      try {
        clientBReceived.push(JSON.parse(d.toString()));
      } catch {}
    });
    await new Promise((resolve, reject) => {
      clientBWs.on('open', resolve);
      clientBWs.on('error', reject);
    });
    console.log('  ✅ Client B connected.');

    await wait(300);
    // 初期 status メッセージをクリア
    clientAReceived.length = 0;
    clientBReceived.length = 0;

    // --- TEST 1: 個別ルーティング（targetClientId）の検証 ---
    console.log('\n[Test 1] Testing individual routing via targetClientId...');
    agentWs.send(JSON.stringify({
      type: 'claude_event',
      sessionId: 'sess-123',
      targetClientId: 'client-A',
      event: { type: 'text_delta', text: 'Hello only to Client A' }
    }));

    await wait(300);

    const clientAGotA = clientAReceived.some(
      (m) => m.type === 'claude_event' && m.event?.text === 'Hello only to Client A'
    );
    const clientBGotA = clientBReceived.some(
      (m) => m.type === 'claude_event' && m.event?.text === 'Hello only to Client A'
    );

    if (clientAGotA && !clientBGotA) {
      console.log('  ✅ PASS: Message was successfully routed ONLY to Client A. Client B did not receive it.');
    } else {
      throw new Error(`FAIL: Target routing failed. clientAGotA=${clientAGotA}, clientBGotA=${clientBGotA}`);
    }

    // --- TEST 2: 全体ブロードキャスト（targetClientId なし）の検証 ---
    console.log('\n[Test 2] Testing broadcast routing when targetClientId is omitted...');
    agentWs.send(JSON.stringify({
      type: 'agent_status',
      hostname: 'test-host',
      cwd: '/test/cwd',
      isBusy: false,
      timestamp: new Date().toISOString()
    }));

    await wait(300);

    const clientAGotStatus = clientAReceived.some((m) => m.type === 'agent_status');
    const clientBGotStatus = clientBReceived.some((m) => m.type === 'agent_status');

    if (clientAGotStatus && clientBGotStatus) {
      console.log('  ✅ PASS: Broadcast message was delivered to both Client A and Client B.');
    } else {
      throw new Error(`FAIL: Broadcast routing failed. clientAGotStatus=${clientAGotStatus}, clientBGotStatus=${clientBGotStatus}`);
    }

    // --- TEST 3: SSE クライアントへの個別ルーティング検証 ---
    console.log('\n[Test 3] Testing SSE Client individual routing...');
    const sseReceived = [];
    const sseReq = http.request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/events?token=${TOKEN}&clientId=client-SSE`,
      method: 'GET',
    }, (res) => {
      res.on('data', (chunk) => {
        const text = chunk.toString();
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              sseReceived.push(JSON.parse(line.substring(6)));
            } catch {}
          }
        }
      });
    });
    sseReq.end();

    await wait(500);

    // Agent から client-SSE 宛てに送信
    agentWs.send(JSON.stringify({
      type: 'tool_approval_request',
      requestId: 'req-sse-1',
      toolName: 'Bash',
      targetClientId: 'client-SSE',
      timestamp: new Date().toISOString()
    }));

    await wait(300);

    const sseGotRequest = sseReceived.some((m) => m.type === 'tool_approval_request' && m.requestId === 'req-sse-1');
    const clientAGotSseReq = clientAReceived.some((m) => m.type === 'tool_approval_request' && m.requestId === 'req-sse-1');
    const clientBGotSseReq = clientBReceived.some((m) => m.type === 'tool_approval_request' && m.requestId === 'req-sse-1');

    if (sseGotRequest && !clientAGotSseReq && !clientBGotSseReq) {
      console.log('  ✅ PASS: SSE client received targeted message, WebSocket clients were not polluted.');
    } else {
      throw new Error(`FAIL: SSE routing failed. sseGot=${sseGotRequest}, clientAGot=${clientAGotSseReq}, clientBGot=${clientBGotSseReq}`);
    }

    // クリーンアップ
    sseReq.destroy();
    clientAWs.close();
    clientBWs.close();
    agentWs.close();

    console.log('\n=============================================');
    console.log('🎉 ALL PHASE 5-1 ROUTING TESTS PASSED!');
    console.log('=============================================\n');

  } finally {
    hubProcess.kill('SIGTERM');
  }
}

runTestSuite().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
