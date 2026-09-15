import { WebSocket } from 'ws';

const BASE_WS_URL = 'ws://localhost:8090';
const TOKEN = 'dev-secret-token';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runE2ETest() {
  console.log('=== Connecting Client to Hub ===');
  const clientWs = new WebSocket(`${BASE_WS_URL}/ws/client?token=${TOKEN}`);

  let currentSessionId = null;
  const events = [];

  clientWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    events.push(msg);

    if (msg.type === 'status') {
      console.log(`[Client] Agent status: ${msg.agentConnected ? 'ONLINE' : 'OFFLINE'}`);
    } else if (msg.type === 'turn_start') {
      currentSessionId = msg.sessionId;
      console.log(`[Client] Turn started with session: ${currentSessionId}`);
    } else if (msg.type === 'claude_event') {
      const ev = msg.event;
      if (ev.type === 'system' && ev.subtype === 'init') {
        currentSessionId = ev.session_id;
        console.log(`[Client] Initialized session: ${currentSessionId}`);
      } else if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta') {
        process.stdout.write(ev.event.delta.text || '');
      } else if (ev.type === 'assistant') {
        const text = ev.message.content.map((c) => c.text).filter(Boolean).join('');
        console.log(`\n[Client Full Assistant Response]: "${text}"`);
      } else if (ev.type === 'result') {
        console.log(`[Client Result]: ${ev.subtype} (Cost: $${ev.total_cost_usd?.toFixed(4) || 0})`);
      }
    } else if (msg.type === 'turn_end') {
      console.log(`[Client] Turn completed with exitCode ${msg.exitCode}`);
    } else {
      console.log('[Client Other Event]', msg.type);
    }
  });

  await new Promise((resolve) => clientWs.on('open', resolve));
  console.log('Client connected to Hub.');

  // Agent が ONLINE になるまで待機
  console.log('Waiting for Agent to be online...');
  for (let i = 0; i < 10; i++) {
    const lastStatus = events.filter((e) => e.type === 'status').pop();
    if (lastStatus && lastStatus.agentConnected) {
      break;
    }
    await wait(500);
  }

  console.log('\n=== Turn 1: Send Initial Prompt ===');
  console.log('Prompt: "Say \'Antigravity rocks!\' and nothing else"');
  clientWs.send(JSON.stringify({
    type: 'prompt',
    text: "Say 'Antigravity rocks!' and nothing else"
  }));

  // Turn 1 完了を待つ (turn_end イベント)
  await waitForTurnEnd(events);
  console.log(`Turn 1 finished! Session ID: ${currentSessionId}`);

  console.log('\n=== Turn 2: Send Follow-up Prompt with Session Resume ===');
  console.log('Prompt: "Repeat what you just said"');
  const prevEventsCount = events.length;
  clientWs.send(JSON.stringify({
    type: 'prompt',
    text: 'Repeat what you just said',
    sessionId: currentSessionId
  }));

  // Turn 2 完了を待つ
  await waitForTurnEnd(events, prevEventsCount);
  console.log('Turn 2 finished!');

  clientWs.close();
  console.log('\n🎉 E2E Test Succeeded! Agent + Claude Code + Hub + Client verified!');
}

async function waitForTurnEnd(events, fromIndex = 0) {
  const start = Date.now();
  while (Date.now() - start < 30000) {
    const endEvent = events.slice(fromIndex).find((e) => e.type === 'turn_end');
    if (endEvent) return endEvent;
    await wait(200);
  }
  throw new Error('Timeout waiting for turn_end');
}

runE2ETest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
