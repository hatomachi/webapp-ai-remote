import { WebSocket } from 'ws';

const BASE_WS_URL = 'ws://localhost:8090';
const TOKEN = 'dev-secret-token';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testListProjects() {
  console.log('=== Connecting Client to Hub ===');
  const clientWs = new WebSocket(`${BASE_WS_URL}/ws/client?token=${TOKEN}`);
  const messages = [];

  clientWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    messages.push(msg);
    console.log('[Received]', msg.type);
  });

  await new Promise((resolve, reject) => {
    clientWs.on('open', resolve);
    clientWs.on('error', reject);
  });

  console.log('Client connected. Sending list_projects...');
  clientWs.send(JSON.stringify({ type: 'list_projects' }));

  // projects_list が返るか待機
  const start = Date.now();
  let found = null;
  while (Date.now() - start < 5000) {
    found = messages.find((m) => m.type === 'projects_list');
    if (found) break;
    await wait(200);
  }

  if (found) {
    console.log('✅ Received projects_list from Agent!');
    console.log('Base directory:', found.baseDir);
    console.log(`Discovered ${found.projects.length} projects:`);
    found.projects.forEach((p) => {
      console.log(`  - [${p.isGit ? 'GIT' : 'DIR'}] ${p.name} (${p.path})`);
    });
  } else {
    console.log('ℹ️ Agent did not reply in 5s (Agent may be restarted or offline). Status messages:', messages.map(m => m.type));
  }

  clientWs.close();
}

testListProjects().catch(console.error);
