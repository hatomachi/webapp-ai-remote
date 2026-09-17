import http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT || '3001', 10);
const PING_INTERVAL_MS = 30000;

// 動的ルーム管理 (Map<token, { agentWs: WebSocket | null, clients: Set<WebSocket> }>)
const rooms = new Map();

/**
 * トークンに対応するルームを取得または新規作成
 */
function getOrCreateRoom(token) {
  let room = rooms.get(token);
  if (!room) {
    room = {
      agentWs: null,
      clients: new Set()
    };
    rooms.set(token, room);
  }
  return room;
}

/**
 * 空になったルーム（AgentもClientも未接続）を解放
 */
function cleanupRoomIfEmpty(token) {
  const room = rooms.get(token);
  if (room && room.agentWs === null && room.clients.size === 0) {
    rooms.delete(token);
  }
}

/**
 * ログ出力用にトークンをマスク（先頭4文字 + 末尾4文字）
 */
function maskToken(token) {
  if (!token) return 'null';
  if (token.length <= 8) return '****';
  return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
}

/**
 * ルーム内の Client 全員に Agent 接続ステータスを通知
 */
function broadcastAgentStatus(room) {
  if (!room) return;
  const isConnected = room.agentWs !== null && room.agentWs.readyState === WebSocket.OPEN;
  const statusMsg = JSON.stringify({
    type: 'status',
    agentConnected: isConnected,
    timestamp: new Date().toISOString()
  });

  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(statusMsg);
    }
  }
}

/**
 * リクエストからトークンを抽出（クエリパラメータまたは Authorization ヘッダー）
 */
function extractToken(req) {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const queryToken = reqUrl.searchParams.get('token');
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

  const token = (queryToken || bearerToken || '').trim();
  return token || null;
}

// HTTP サーバーの作成（/health および WebSocket upgrade の受付）
const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  
  if (reqUrl.pathname === '/health' || reqUrl.pathname.endsWith('/health')) {
    let totalAgents = 0;
    let totalClients = 0;
    for (const room of rooms.values()) {
      if (room.agentWs && room.agentWs.readyState === WebSocket.OPEN) {
        totalAgents++;
      }
      totalClients += room.clients.size;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      activeRooms: rooms.size,
      totalAgents,
      totalClients,
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

// HTTP Upgrade のハンドリング
server.on('upgrade', (req, socket, head) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // トークン抽出（空トークンは拒否）
  const token = extractToken(req);
  if (!token) {
    console.warn(`[Hub] Unauthorized connection attempt (missing token) to ${pathname}`);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  req.token = token;

  if (pathname === '/ws/agent' || pathname.endsWith('/ws/agent')) {
    wssAgent.handleUpgrade(req, socket, head, (ws) => {
      wssAgent.emit('connection', ws, req);
    });
  } else if (pathname === '/ws/client' || pathname.endsWith('/ws/client')) {
    wssClient.handleUpgrade(req, socket, head, (ws) => {
      wssClient.emit('connection', ws, req);
    });
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

// --- Agent WebSocket の処理 ---
wssAgent.on('connection', (ws, req) => {
  const token = req.token;
  const room = getOrCreateRoom(token);
  const masked = maskToken(token);

  console.log(`[Hub] Agent connected to room [${masked}]`);

  // 同じトークンの既存 Agent があれば切断（同一PCでの再起動/再接続）
  if (room.agentWs && room.agentWs.readyState === WebSocket.OPEN) {
    console.log(`[Hub] Closing previous Agent connection in room [${masked}]`);
    room.agentWs.close(1000, 'New Agent connected');
  }

  room.agentWs = ws;
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // 当該ルームの Client 群へ Agent 接続ステータスを通知
  broadcastAgentStatus(room);

  ws.on('message', (data, isBinary) => {
    // 当該ルームの Client 全員にメッセージを転送
    for (const client of room.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data, { binary: isBinary });
      }
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[Hub] Agent disconnected from room [${masked}]: ${code} ${reason}`);
    if (room.agentWs === ws) {
      room.agentWs = null;
    }
    broadcastAgentStatus(room);
    cleanupRoomIfEmpty(token);
  });

  ws.on('error', (err) => {
    console.error(`[Hub] Agent socket error in room [${masked}]:`, err.message);
  });
});

// --- Client WebSocket の処理 ---
wssClient.on('connection', (ws, req) => {
  const token = req.token;
  const room = getOrCreateRoom(token);
  const masked = maskToken(token);

  console.log(`[Hub] Client connected to room [${masked}]`);
  room.clients.add(ws);
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // 接続直後の Client に、当該ルームの Agent 接続状態を即座に送信
  const isConnected = room.agentWs !== null && room.agentWs.readyState === WebSocket.OPEN;
  ws.send(JSON.stringify({
    type: 'status',
    agentConnected: isConnected,
    timestamp: new Date().toISOString()
  }));

  ws.on('message', (data, isBinary) => {
    // 当該ルームの Agent にメッセージを転送
    if (room.agentWs && room.agentWs.readyState === WebSocket.OPEN) {
      room.agentWs.send(data, { binary: isBinary });
    } else {
      console.warn(`[Hub] Client sent message but Agent is not connected in room [${masked}]`);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Agent is not currently connected to Hub in this room.',
        code: 'AGENT_OFFLINE'
      }));
    }
  });

  ws.on('close', () => {
    console.log(`[Hub] Client disconnected from room [${masked}]`);
    room.clients.delete(ws);
    cleanupRoomIfEmpty(token);
  });

  ws.on('error', (err) => {
    console.error(`[Hub] Client socket error in room [${masked}]:`, err.message);
    room.clients.delete(ws);
    cleanupRoomIfEmpty(token);
  });
});

// --- 死活監視ハートビート ---
const interval = setInterval(() => {
  for (const [token, room] of rooms.entries()) {
    // Agent のチェック
    if (room.agentWs) {
      if (room.agentWs.isAlive === false) {
        console.warn(`[Hub] Terminating inactive Agent in room [${maskToken(token)}]`);
        room.agentWs.terminate();
        room.agentWs = null;
        broadcastAgentStatus(room);
      } else {
        room.agentWs.isAlive = false;
        room.agentWs.ping();
      }
    }

    // Client のチェック
    for (const client of room.clients) {
      if (client.isAlive === false) {
        console.warn(`[Hub] Terminating inactive Client in room [${maskToken(token)}]`);
        client.terminate();
        room.clients.delete(client);
      } else {
        client.isAlive = false;
        client.ping();
      }
    }

    cleanupRoomIfEmpty(token);
  }
}, PING_INTERVAL_MS);

server.on('close', () => {
  clearInterval(interval);
});

// サーバー起動
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Hub] Dynamic Relay Hub listening on port ${PORT}`);
  console.log(`[Hub] Multi-tenant room routing enabled (per token)`);
});
