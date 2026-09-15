import http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT || '3001', 10);
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev-secret-token';
const PING_INTERVAL_MS = 30000;

// HTTP サーバーの作成（/health および WebSocket upgrade の受付）
const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  
  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      agentConnected: currentAgentWs !== null && currentAgentWs.readyState === WebSocket.OPEN,
      clientCount: clients.size,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// WebSocket サーバーインスタンス
const wssAgent = new WebSocketServer({ noServer: true });
const wssClient = new WebSocketServer({ noServer: true });

// 接続状態
let currentAgentWs = null;
const clients = new Set();

/**
 * 認証トークンを検証
 */
function authenticate(req) {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const queryToken = reqUrl.searchParams.get('token');
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

  const token = queryToken || bearerToken;
  return token === AUTH_TOKEN;
}

/**
 * 全 Client に Agent の接続ステータスを通知
 */
function broadcastAgentStatus() {
  const isConnected = currentAgentWs !== null && currentAgentWs.readyState === WebSocket.OPEN;
  const statusMsg = JSON.stringify({
    type: 'status',
    agentConnected: isConnected,
    timestamp: new Date().toISOString()
  });

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(statusMsg);
    }
  }
}

// HTTP Upgrade のハンドリング
server.on('upgrade', (req, socket, head) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // 認証チェック
  if (!authenticate(req)) {
    console.warn(`[Hub] Unauthorized connection attempt to ${pathname}`);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  if (pathname === '/ws/agent') {
    wssAgent.handleUpgrade(req, socket, head, (ws) => {
      wssAgent.emit('connection', ws, req);
    });
  } else if (pathname === '/ws/client') {
    wssClient.handleUpgrade(req, socket, head, (ws) => {
      wssClient.emit('connection', ws, req);
    });
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

// --- Agent WebSocket の処理 ---
wssAgent.on('connection', (ws) => {
  console.log('[Hub] Agent connected');

  // 既存の Agent 接続があれば安全に切断
  if (currentAgentWs && currentAgentWs.readyState === WebSocket.OPEN) {
    console.log('[Hub] Closing previous Agent connection');
    currentAgentWs.close(1000, 'New Agent connected');
  }

  currentAgentWs = ws;
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Client 群へ Agent 接続を通知
  broadcastAgentStatus();

  ws.on('message', (data, isBinary) => {
    // Agent からのメッセージ（ストリームJSON、ツール承認要求等）を全 Client に転送
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data, { binary: isBinary });
      }
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[Hub] Agent disconnected: ${code} ${reason}`);
    if (currentAgentWs === ws) {
      currentAgentWs = null;
    }
    broadcastAgentStatus();
  });

  ws.on('error', (err) => {
    console.error('[Hub] Agent socket error:', err.message);
  });
});

// --- Client WebSocket の処理 ---
wssClient.on('connection', (ws) => {
  console.log('[Hub] Client connected');
  clients.add(ws);
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // 接続直後の Client に現在の Agent 接続状態を即座に送信
  const isConnected = currentAgentWs !== null && currentAgentWs.readyState === WebSocket.OPEN;
  ws.send(JSON.stringify({
    type: 'status',
    agentConnected: isConnected,
    timestamp: new Date().toISOString()
  }));

  ws.on('message', (data, isBinary) => {
    // Client からのメッセージ（プロンプト送信、ツール承認応答等）を Agent に転送
    if (currentAgentWs && currentAgentWs.readyState === WebSocket.OPEN) {
      currentAgentWs.send(data, { binary: isBinary });
    } else {
      console.warn('[Hub] Client sent message but Agent is not connected');
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Agent is not currently connected to Hub.',
        code: 'AGENT_OFFLINE'
      }));
    }
  });

  ws.on('close', () => {
    console.log('[Hub] Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[Hub] Client socket error:', err.message);
    clients.delete(ws);
  });
});

// --- 死活監視ハートビート ---
const interval = setInterval(() => {
  // Agent のチェック
  if (currentAgentWs) {
    if (currentAgentWs.isAlive === false) {
      console.warn('[Hub] Terminating inactive Agent connection');
      currentAgentWs.terminate();
      currentAgentWs = null;
      broadcastAgentStatus();
    } else {
      currentAgentWs.isAlive = false;
      currentAgentWs.ping();
    }
  }

  // Client のチェック
  for (const client of clients) {
    if (client.isAlive === false) {
      console.warn('[Hub] Terminating inactive Client connection');
      client.terminate();
      clients.delete(client);
    } else {
      client.isAlive = false;
      client.ping();
    }
  }
}, PING_INTERVAL_MS);

server.on('close', () => {
  clearInterval(interval);
});

// サーバー起動
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Hub] Relay Hub listening on port ${PORT}`);
  console.log(`[Hub] WebSocket endpoints: /ws/agent, /ws/client (auth token: ${AUTH_TOKEN ? 'configured' : 'none'})`);
});
