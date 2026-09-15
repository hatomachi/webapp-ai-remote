import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const BASE_WS_URL = 'ws://localhost:8090';
const TOKEN = 'dev-secret-token';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runFullStackTest() {
  console.log('=== Step 1: Spawning Bridge Agent ===');
  const agentProcess = spawn('npx', ['tsx', 'packages/agent/src/index.ts'], {
    env: {
      ...process.env,
      HUB_URL: `${BASE_WS_URL}/ws/agent`,
      AUTH_TOKEN: TOKEN,
      HOSTNAME: 'Test-MacBook-Pro',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  agentProcess.stdout.on('data', (d) => {
    // console.log('[Agent stdout]', d.toString().trim());
  });
  agentProcess.stderr.on('data', (d) => {
    console.error('[Agent stderr]', d.toString().trim());
  });

  // Hub への接続を少し待つ
  await wait(1500);

  console.log('\n=== Step 2: Connecting Client WebSocket (simulating PWA) ===');
  const clientWs = new WebSocket(`${BASE_WS_URL}/ws/client?token=${TOKEN}`);
  const receivedMessages = [];

  clientWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    receivedMessages.push(msg);
    console.log(`[Client Received] Type: ${msg.type}`);
  });

  await new Promise((resolve, reject) => {
    clientWs.on('open', resolve);
    clientWs.on('error', reject);
  });

  console.log('Client connected to Hub.');

  // Agent が ONLINE になるまで待機
  console.log('Waiting for Agent status = online...');
  let isOnline = false;
  for (let i = 0; i < 20; i++) {
    const statusMsg = receivedMessages.find((m) => m.type === 'status' && m.agentConnected);
    if (statusMsg) {
      isOnline = true;
      break;
    }
    await wait(300);
  }

  if (!isOnline) {
    throw new Error('Agent failed to connect or report ONLINE');
  }
  console.log('✅ Agent is ONLINE!');

  // Step 3: PWA からの get_status 要求テスト
  console.log('\n=== Step 3: Testing get_status protocol ===');
  clientWs.send(JSON.stringify({ type: 'get_status' }));

  let agentStatusMsg = null;
  for (let i = 0; i < 20; i++) {
    agentStatusMsg = receivedMessages.find((m) => m.type === 'agent_status');
    if (agentStatusMsg) break;
    await wait(200);
  }

  if (!agentStatusMsg) {
    throw new Error('Failed to receive agent_status response from Agent');
  }
  console.log('✅ Received agent_status:', {
    hostname: agentStatusMsg.hostname,
    cwd: agentStatusMsg.cwd,
    isBusy: agentStatusMsg.isBusy,
  });

  // Step 4: クライアントからの prompt 送信（新規セッションID付き）
  const testSessionId = (await import('node:crypto')).randomUUID();
  console.log(`\n=== Step 4: Testing prompt execution with brand new sessionId (${testSessionId}) ===`);
  clientWs.send(JSON.stringify({
    type: 'prompt',
    text: "Echo exactly 'Hello from AI Remote Cockpit' and nothing else.",
    sessionId: testSessionId,
    isResume: false,
  }));

  // turn_end を待機
  let turnEndMsg = null;
  const startTime = Date.now();
  while (Date.now() - startTime < 45000) {
    turnEndMsg = receivedMessages.find((m) => m.type === 'turn_end');
    if (turnEndMsg) break;
    await wait(300);
  }

  if (!turnEndMsg) {
    throw new Error('Timeout waiting for turn_end');
  }

  const claudeEvents = receivedMessages.filter((m) => m.type === 'claude_event');
  console.log(`✅ Turn completed! Received ${claudeEvents.length} claude_event items.`);

  // クリーンアップ
  clientWs.close();
  agentProcess.kill('SIGINT');
  console.log('\n🎉 Full-stack verification test PASSED successfully!');
}

runFullStackTest().catch((err) => {
  console.error('❌ Full stack test failed:', err);
  process.exit(1);
});
