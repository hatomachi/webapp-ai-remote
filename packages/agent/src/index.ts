import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { WebSocket } from 'ws';

const HUB_URL = process.env.HUB_URL || 'ws://localhost:8090/ws/agent';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev-secret-token';
const CLAUDE_BIN = process.env.CLAUDE_BIN || '/Users/s-ikari/.local/bin/claude';
const DEFAULT_CWD = process.env.DEFAULT_CWD || process.cwd();

let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let currentChildProcess: ChildProcess | null = null;

console.log('=== AI Remote Bridge Agent ===');
console.log(`Target Hub: ${HUB_URL}`);
console.log(`Claude Binary: ${CLAUDE_BIN}`);
console.log(`Default CWD: ${DEFAULT_CWD}`);

/**
 * Hub への WebSocket 接続を確立
 */
function connectToHub() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const url = `${HUB_URL}?token=${encodeURIComponent(AUTH_TOKEN)}`;
  console.log(`[Agent] Connecting to Hub at ${HUB_URL}...`);
  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('[Agent] Successfully connected to Relay Hub!');
    
    // Agent 初期情報を Hub (および接続中 Client) へ送信
    sendToHub({
      type: 'agent_hello',
      hostname: process.env.HOSTNAME || 'MacBook',
      defaultCwd: DEFAULT_CWD,
      timestamp: new Date().toISOString()
    });
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleClientMessage(msg);
    } catch (err: any) {
      console.error('[Agent] Failed to parse message from Hub:', err.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.warn(`[Agent] Disconnected from Hub (${code}: ${reason.toString()}). Reconnecting in 3s...`);
    ws = null;
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[Agent] WebSocket error:', err.message);
  });
}

function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setTimeout(connectToHub, 3000);
  }
}

function sendToHub(payload: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * Client からのメッセージ処理
 */
function handleClientMessage(msg: any) {
  console.log('[Agent] Received from Client:', msg.type);

  if (msg.type === 'prompt') {
    executeClaudeTurn(msg);
  } else if (msg.type === 'abort') {
    abortCurrentTurn();
  } else if (msg.type === 'get_status') {
    sendToHub({
      type: 'agent_status',
      hostname: process.env.HOSTNAME || 'MacBook',
      cwd: DEFAULT_CWD,
      isBusy: currentChildProcess !== null,
      timestamp: new Date().toISOString()
    });
  } else {
    console.log('[Agent] Unhandled message type:', msg.type);
  }
}

/**
 * 現在実行中の Claude プロセスを中断
 */
function abortCurrentTurn() {
  if (currentChildProcess) {
    console.log('[Agent] Aborting current Claude process...');
    currentChildProcess.kill('SIGINT');
    sendToHub({
      type: 'execution_aborted',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Claude Code の 1 ターンを実行
 */
function executeClaudeTurn(params: {
  text: string;
  sessionId?: string;
  cwd?: string;
  permissionMode?: string;
}) {
  if (currentChildProcess) {
    sendToHub({
      type: 'error',
      message: 'Claude Code is already running a task. Please wait or abort.',
      code: 'BUSY'
    });
    return;
  }

  const prompt = params.text;
  const isResume = Boolean(params.sessionId);
  const activeSessionId = params.sessionId || randomUUID();
  const workDir = params.cwd || DEFAULT_CWD;
  const permissionMode = params.permissionMode || 'acceptEdits';

  const args: string[] = [
    '-p',
    prompt,
    '--output-format=stream-json',
    '--include-partial-messages',
    '--verbose',
    `--permission-mode=${permissionMode}`
  ];

  if (isResume) {
    args.push('--resume', activeSessionId);
  } else {
    args.push('--session-id', activeSessionId);
  }

  console.log(`[Agent] Launching Claude: ${CLAUDE_BIN} ${args.join(' ')}`);
  console.log(`[Agent] Session ID: ${activeSessionId} (isResume: ${isResume})`);
  console.log(`[Agent] Working dir: ${workDir}`);

  sendToHub({
    type: 'turn_start',
    prompt,
    sessionId: activeSessionId,
    cwd: workDir,
    timestamp: new Date().toISOString()
  });

  try {
    const child = spawn(CLAUDE_BIN, args, {
      cwd: workDir,
      env: {
        ...process.env,
        FORCE_COLOR: '0'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    currentChildProcess = child;
    let capturedSessionId = activeSessionId;

    // stdout を 1 行ずつ JSON パースして Hub へ転送
    const readlineStdout = createInterface({ input: child.stdout });
    readlineStdout.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const event = JSON.parse(trimmed);

        // session_id の自動キャッチ
        if (event.session_id && !capturedSessionId) {
          capturedSessionId = event.session_id;
        }

        // Hub 経由で Client へ生イベントを転送
        sendToHub({
          type: 'claude_event',
          sessionId: capturedSessionId,
          event
        });
      } catch (err) {
        // 万が一非JSON行が出力された場合はログとして送信
        console.warn('[Agent] Non-JSON stdout line:', trimmed);
        sendToHub({
          type: 'claude_raw_log',
          stream: 'stdout',
          text: trimmed
        });
      }
    });

    // stderr の収集
    const readlineStderr = createInterface({ input: child.stderr });
    readlineStderr.on('line', (line) => {
      console.warn('[Agent] stderr:', line);
      sendToHub({
        type: 'claude_raw_log',
        stream: 'stderr',
        text: line
      });
    });

    child.on('close', (code, signal) => {
      console.log(`[Agent] Claude process exited with code ${code}, signal ${signal}`);
      currentChildProcess = null;

      sendToHub({
        type: 'turn_end',
        sessionId: capturedSessionId,
        exitCode: code,
        signal,
        timestamp: new Date().toISOString()
      });
    });

    child.on('error', (err) => {
      console.error('[Agent] Failed to spawn Claude process:', err);
      currentChildProcess = null;

      sendToHub({
        type: 'turn_error',
        error: err.message,
        timestamp: new Date().toISOString()
      });
    });

  } catch (err: any) {
    console.error('[Agent] Execution exception:', err);
    currentChildProcess = null;
    sendToHub({
      type: 'turn_error',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
}

// 起動
connectToHub();

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  if (currentChildProcess) {
    currentChildProcess.kill('SIGINT');
  }
  if (ws) {
    ws.close();
  }
  process.exit(0);
});
