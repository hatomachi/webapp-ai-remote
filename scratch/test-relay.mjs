import { WebSocket } from 'ws';

const BASE_WS_URL = 'ws://localhost:8090';
const TOKEN = 'dev-secret-token';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('=== Step 1: Connect Client ===');
  const clientWs = new WebSocket(`${BASE_WS_URL}/ws/client?token=${TOKEN}`);
  
  const clientReceived = [];
  clientWs.on('message', (data) => {
    const parsed = JSON.parse(data.toString());
    console.log('[Client Recv]', parsed);
    clientReceived.push(parsed);
  });

  await new Promise((resolve) => clientWs.on('open', resolve));
  console.log('Client connected.');
  await wait(500);

  console.log('\n=== Step 2: Connect Agent ===');
  const agentWs = new WebSocket(`${BASE_WS_URL}/ws/agent?token=${TOKEN}`);
  
  const agentReceived = [];
  agentWs.on('message', (data) => {
    const parsed = JSON.parse(data.toString());
    console.log('[Agent Recv]', parsed);
    agentReceived.push(parsed);
  });

  await new Promise((resolve) => agentWs.on('open', resolve));
  console.log('Agent connected.');
  await wait(500);

  console.log('\n=== Step 3: Client sends Prompt to Agent ===');
  clientWs.send(JSON.stringify({ type: 'prompt', text: 'Hello Claude, please list files.' }));
  await wait(500);

  console.log('\n=== Step 4: Agent sends Stream & Tool Approval to Client ===');
  agentWs.send(JSON.stringify({
    type: 'tool_request',
    tool: 'Bash',
    command: 'ls -la',
    requestId: 'req-001'
  }));
  await wait(500);

  console.log('\n=== Step 5: Client sends Approval Response ===');
  clientWs.send(JSON.stringify({
    type: 'tool_response',
    requestId: 'req-001',
    approved: true
  }));
  await wait(500);

  console.log('\n=== Step 6: Agent disconnects ===');
  agentWs.close();
  await wait(500);

  clientWs.close();
  console.log('\n=== All Tests Finished Successfully! ===');
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
