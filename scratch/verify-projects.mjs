import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const BASE_WS_URL = 'ws://localhost:8090';
const TOKEN = 'dev-secret-token';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyProjectDiscovery() {
  console.log('=== Step 1: Launching Agent temporarily ===');
  const agent = spawn('npx', ['tsx', 'packages/agent/src/index.ts'], {
    env: {
      ...process.env,
      HUB_URL: `${BASE_WS_URL}/ws/agent`,
      AUTH_TOKEN: TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await wait(1500);

  console.log('=== Step 2: Client connecting to Hub ===');
  const clientWs = new WebSocket(`${BASE_WS_URL}/ws/client?token=${TOKEN}`);
  const messages = [];

  clientWs.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    messages.push(msg);
  });

  await new Promise((resolve) => clientWs.on('open', resolve));

  // Agent online 待機
  console.log('Waiting for Agent online...');
  for (let i = 0; i < 15; i++) {
    const st = messages.find((m) => m.type === 'status' && m.agentConnected);
    if (st) break;
    await wait(300);
  }

  console.log('Sending list_projects request...');
  clientWs.send(JSON.stringify({ type: 'list_projects' }));

  let found = null;
  for (let i = 0; i < 20; i++) {
    found = messages.find((m) => m.type === 'projects_list');
    if (found) break;
    await wait(200);
  }

  if (!found) {
    throw new Error('Timeout waiting for projects_list');
  }

  console.log('🎉 Successfully received projects_list from Agent!');
  console.log(`Base directory: ${found.baseDir}`);
  console.log(`Found ${found.projects.length} candidate projects:`);
  for (const p of found.projects.slice(0, 10)) {
    console.log(`  📁 [${p.isGit ? 'git' : 'dir'}] ${p.name} -> ${p.path}`);
  }

  clientWs.close();
  agent.kill('SIGINT');
  console.log('Test completed cleanly.');
}

verifyProjectDiscovery().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
