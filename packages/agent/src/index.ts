import fs from 'node:fs';
import os from 'node:os';
import { spawn, execSync, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { WebSocket } from 'ws';
import {
  listSessions,
  getSessionMessages,
  saveSessionHistory,
  deleteSession,
  ChatMessage,
  AttachmentItem,
} from './sessionManager.js';
import { CopilotTurnRunner } from './copilotRunner.js';
import { WorkspaceManager, UserCredentials } from './workspaceManager.js';

// .env ファイルの自動読み込み (Node 20+ 標準機能 or 簡易パーサー)
function loadEnv() {
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../..', '.env')
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      try {
        if (typeof (process as any).loadEnvFile === 'function') {
          (process as any).loadEnvFile(envPath);
        } else {
          const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
              const key = trimmed.substring(0, eqIdx).trim();
              const val = trimmed.substring(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
              if (!process.env[key]) {
                process.env[key] = val;
              }
            }
          }
        }
        break;
      } catch (e) {
        // ignore
      }
    }
  }
}
loadEnv();

const workspaceManager = new WorkspaceManager();
const copilotRunner = new CopilotTurnRunner({ sandboxManager: workspaceManager.sandboxManager });

const isWindows = process.platform === 'win32';

// Linux / macOS 環境で PATH を自動拡張（~/.local/bin や node バイナリのディレクトリを自動追加）
function augmentPath() {
  const delimiter = isWindows ? ';' : ':';
  const existing = (process.env.PATH || '').split(delimiter).filter(Boolean);
  const nodeBinDir = path.dirname(process.execPath);
  
  const extras = isWindows ? [] : [
    nodeBinDir,
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.npm-global', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin'
  ];

  for (const p of extras) {
    if (fs.existsSync(p) && !existing.includes(p)) {
      existing.unshift(p);
    }
  }
  process.env.PATH = existing.join(delimiter);
}
augmentPath();

/**
 * 大文字小文字を問わずに環境変数を取得
 */
function getEnvCaseInsensitive(...keys: string[]): string | undefined {
  for (const k of keys) {
    if (process.env[k] !== undefined && process.env[k] !== '') {
      return process.env[k];
    }
  }
  for (const [envKey, val] of Object.entries(process.env)) {
    for (const k of keys) {
      if (envKey.toLowerCase() === k.toLowerCase() && val !== undefined && val !== '') {
        return val;
      }
    }
  }
  return undefined;
}

/**
 * パス文字列のチルダ (~) 展開とクォート除去
 */
function sanitizePath(raw: string): string {
  let cleaned = raw.trim().replace(/^['"]|['"]$/g, '');
  if (cleaned.startsWith('~/') || cleaned === '~') {
    cleaned = path.join(os.homedir(), cleaned.slice(1));
  }
  return cleaned;
}

/**
 * 実行環境 (Windows / Linux / macOS) に適した Claude Code バイナリパスを解決
 */
function resolveClaudeBin(): { binPath: string; exists: boolean; status: string } {
  const rawEnv = getEnvCaseInsensitive('CLAUDE_BIN', 'claude_bin');

  if (rawEnv) {
    const cleaned = sanitizePath(rawEnv);
    // 非Windows環境で誤って .cmd や .bat が指定されている場合は設定ミスとして自動フォールバック
    if (!isWindows && (cleaned.endsWith('.cmd') || cleaned.endsWith('.bat'))) {
      console.warn(`[Agent] ⚠️ 環境変数で '${rawEnv}' が指定されていますが、非Windows環境 (${process.platform}) のため無視し、Linux/macOS 向けバイナリを自動探索します。`);
    } else {
      const exists = fs.existsSync(cleaned);
      return {
        binPath: cleaned,
        exists,
        status: exists ? '環境変数指定 (有効)' : `⚠️ 環境変数指定 (ファイルが存在しません: ${cleaned})`
      };
    }
  }

  if (isWindows) {
    return { binPath: 'claude.cmd', exists: true, status: 'Windows デフォルト (claude.cmd)' };
  }

  // Linux / macOS: ~/.local/bin/claude, /usr/local/bin/claude 等を探索
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/usr/bin/claude'
  ];

  // nvm 配下のパスも探索
  try {
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir);
      for (const v of versions.reverse()) {
        candidates.push(path.join(nvmDir, v, 'bin', 'claude'));
      }
    }
  } catch {}

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { binPath: candidate, exists: true, status: `自動検出 (${candidate})` };
    }
  }

  // which claude を試行
  try {
    const whichRes = execSync('which claude 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (whichRes && fs.existsSync(whichRes)) {
      return { binPath: whichRes, exists: true, status: `which コマンドによる検出 (${whichRes})` };
    }
  } catch {}

  return { binPath: 'claude', exists: false, status: '⚠️ 未検出 (PATH または候補パスに見つかりません)' };
}

const HUB_URL = process.env.HUB_URL || 'ws://localhost:8090/ws/agent';
// 明示的に AUTH_TOKEN が指定されている場合はそれを尊重、未指定なら衝突しない一意なランダムUUIDを自動生成
const isAutoGeneratedToken = !process.env.AUTH_TOKEN;
const AUTH_TOKEN = process.env.AUTH_TOKEN || randomUUID();
const claudeInfo = resolveClaudeBin();
const CLAUDE_BIN = claudeInfo.binPath;
const currentDir = process.cwd();
const isAgentDir = path.basename(currentDir) === 'agent' || currentDir.endsWith(path.join('packages', 'agent'));
const DEFAULT_CWD = process.env.DEFAULT_CWD || (isAgentDir ? path.resolve(currentDir, '../..') : currentDir);
const HOSTNAME = process.env.HOSTNAME || process.env.COMPUTERNAME || os.hostname() || 'OfficePC';

let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let currentChildProcess: ChildProcess | null = null;

interface ExecutionContext {
  clientId?: string;
  userName?: string;
  sessionId?: string;
}

let currentExecution: ExecutionContext | null = null;

const pendingApprovals = new Map<string, {
  child: ChildProcess;
  toolUseId?: string;
  ownerClientId?: string;
  ownerUserName?: string;
}>();
const knownSessions = new Set<string>();

/**
 * Hub URL からスマホ PWA のアクセス・ペアリング URL を推定生成
 */
function getPwaPairingUrl(hubUrl: string, token: string): string {
  try {
    const parsed = new URL(hubUrl);
    const isWss = parsed.protocol === 'wss:';
    const httpProto = isWss ? 'https:' : 'http:';
    let basePath = parsed.pathname.replace(/\/ws\/agent\/?$/, '');
    if (!basePath.endsWith('/')) basePath += '/';
    return `${httpProto}//${parsed.host}${basePath}?token=${encodeURIComponent(token)}`;
  } catch {
    return `?token=${encodeURIComponent(token)}`;
  }
}

const pairingUrl = getPwaPairingUrl(HUB_URL, AUTH_TOKEN);

console.log('======================================================================');
console.log('🚀 AI Remote Bridge Agent Started');
console.log('======================================================================');
console.log(`💻 Hostname      : ${HOSTNAME}`);
console.log(`📂 Default CWD   : ${DEFAULT_CWD}`);
console.log(`🌐 Target Hub    : ${HUB_URL}`);
console.log(`🤖 Claude Binary : ${CLAUDE_BIN}`);
console.log(`   状態          : ${claudeInfo.status}`);
if (!claudeInfo.exists && !isWindows) {
  console.log('');
  console.log('⚠️ 【注意】Claude Code CLI が見つかりませんでした！');
  console.log('   ・インストール確認: which claude');
  console.log('   ・未インストールの場合は実行: npm install -g @anthropic-ai/claude-code');
  console.log('   ・または .env に絶対パスを指定: CLAUDE_BIN=/home/<user>/.../claude (チルダ ~ は不可)');
}
console.log(`🔑 Session Token : ${AUTH_TOKEN}${isAutoGeneratedToken ? ' (自動発行UUID)' : ' (環境変数指定)'}`);
console.log('');
console.log('📱 スマホで開いて即ペアリング (URLクエリで自動設定):');
console.log(`   ${pairingUrl}`);
console.log('');
console.log('※ PC起動ごとに一意なトークンが自動発行され、複数人でも混線せず安全に利用可能です。');
console.log('======================================================================');

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
      hostname: HOSTNAME,
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
 * 社内PC上のワークスペース/プロジェクト候補を走査
 */
function scanProjects(customRoot?: string) {
  const scanDir = customRoot || process.env.PROJECTS_ROOT || path.resolve(DEFAULT_CWD, '..');
  const projects: Array<{ id: string; name: string; path: string; isGit: boolean }> = [];

  try {
    if (fs.existsSync(scanDir)) {
      const entries = fs.readdirSync(scanDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const fullPath = path.join(scanDir, entry.name);
          const isGit = fs.existsSync(path.join(fullPath, '.git'));
          projects.push({
            id: entry.name,
            name: entry.name,
            path: fullPath,
            isGit
          });
        }
      }
    }
  } catch (err: any) {
    console.error('[Agent] Failed to scan projects directory:', err.message);
  }

  // もし DEFAULT_CWD が候補に含まれていなければ先頭に追加
  const currentName = path.basename(DEFAULT_CWD);
  if (!projects.some(p => p.path === DEFAULT_CWD)) {
    projects.unshift({
      id: currentName,
      name: currentName,
      path: DEFAULT_CWD,
      isGit: fs.existsSync(path.join(DEFAULT_CWD, '.git'))
    });
  }

  return {
    baseDir: scanDir,
    projects
  };
}

/**
 * Client からのメッセージ処理
 */
async function handleClientMessage(msg: any) {
  console.log('[Agent] Received from Client:', msg.type);

  if (msg.type === 'prompt') {
    if (msg.engine === 'copilot') {
      executeCopilotTurn(msg);
    } else {
      executeClaudeTurn(msg);
    }
  } else if (msg.type === 'abort') {
    abortCurrentTurn(msg.clientId, msg.userName || msg.credentials?.userName);
  } else if (msg.type === 'get_status') {
    sendToHub({
      type: 'agent_status',
      hostname: HOSTNAME,
      cwd: DEFAULT_CWD,
      isBusy: currentChildProcess !== null || copilotRunner.isRunning,
      targetClientId: msg.clientId,
      timestamp: new Date().toISOString()
    });
  } else if (msg.type === 'list_projects') {
    let result;
    if (workspaceManager.isMultiTenant) {
      result = workspaceManager.scanUserProjects(msg.userName, DEFAULT_CWD);
    } else {
      result = scanProjects(msg.rootPath);
    }
    sendToHub({
      type: 'projects_list',
      baseDir: result.baseDir,
      projects: result.projects,
      targetClientId: msg.clientId,
      timestamp: new Date().toISOString()
    });
  } else if (msg.type === 'list_sessions') {
    const sessions = await listSessions(msg.projectId, msg.cwd);
    sendToHub({
      type: 'sessions_list',
      sessions,
      projectId: msg.projectId,
      targetClientId: msg.clientId,
      timestamp: new Date().toISOString()
    });
  } else if (msg.type === 'get_session_messages') {
    const messages = await getSessionMessages(msg.sessionId, msg.cwd);
    sendToHub({
      type: 'session_messages',
      sessionId: msg.sessionId,
      messages,
      targetClientId: msg.clientId,
      timestamp: new Date().toISOString()
    });
  } else if (msg.type === 'delete_session') {
    deleteSession(msg.sessionId);
    const sessions = await listSessions(undefined, msg.cwd);
    sendToHub({
      type: 'sessions_list',
      sessions,
      targetClientId: msg.clientId,
      timestamp: new Date().toISOString()
    });
  } else if (msg.type === 'tool_approval_response') {
    handleToolApprovalResponse({
      ...msg,
      clientId: msg.clientId,
      userName: msg.userName || msg.credentials?.userName
    });
  } else if (msg.type === 'admin:list_repos') {
    const repos = workspaceManager.listBaseRepos();
    sendToHub({
      type: 'admin:repos_list',
      repos,
      targetClientId: msg.clientId,
      timestamp: new Date().toISOString()
    });
  } else if (msg.type === 'admin:clone_repo') {
    const result = workspaceManager.cloneRepo(msg.repoUrl, msg.deployToken, msg.deployUser, msg.name);
    sendToHub({
      type: 'admin:clone_repo_result',
      ...result,
      targetClientId: msg.clientId,
      timestamp: new Date().toISOString()
    });
  } else if (msg.type === 'admin:list_workspaces') {
    const result = workspaceManager.listWorkspaces();
    sendToHub({
      type: 'admin:workspaces_list',
      ...result,
      targetClientId: msg.clientId,
      timestamp: new Date().toISOString()
    });
  } else if (msg.type === 'admin:cleanup_workspace') {
    const result = workspaceManager.cleanupWorkspace(msg.userName);
    sendToHub({
      type: 'admin:cleanup_workspace_result',
      ...result,
      targetClientId: msg.clientId,
      timestamp: new Date().toISOString()
    });
  } else {
    console.log('[Agent] Unhandled message type:', msg.type);
  }
}

/**
 * ツール承認レスポンスを Claude Code プロセスの stdin へ返送
 */
function handleToolApprovalResponse(msg: {
  requestId: string;
  behavior: 'allow' | 'deny';
  message?: string;
  clientId?: string;
  userName?: string;
}) {
  const pending = pendingApprovals.get(msg.requestId);
  if (!pending) {
    console.warn(`[Agent] No pending approval found for requestId: ${msg.requestId}`);
    return;
  }

  // 権限チェック: リクエスト発行者 (ownerClientId または ownerUserName) と一致しているか検証
  const isMatchClient = pending.ownerClientId && msg.clientId && pending.ownerClientId === msg.clientId;
  const isMatchUser = pending.ownerUserName && msg.userName && pending.ownerUserName === msg.userName;
  const isUnrestricted = !pending.ownerClientId && !pending.ownerUserName;

  if (!isMatchClient && !isMatchUser && !isUnrestricted) {
    console.warn(`[Agent] ⚠️ Unauthorized tool approval attempt: owner=[${pending.ownerClientId}/${pending.ownerUserName}], caller=[${msg.clientId}/${msg.userName}]`);
    sendToHub({
      type: 'turn_error',
      error: 'ツール承認の操作権限がありません（リクエスト発行者または同一ユーザーのみ操作可能です）',
      targetClientId: msg.clientId,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (pending.child && !pending.child.killed) {
    console.log(`[Agent] ➡️ Forwarding tool approval to Claude: ${msg.requestId} -> ${msg.behavior}`);
    const responsePayload = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: msg.requestId,
        response: msg.behavior === 'allow'
          ? { behavior: 'allow' }
          : {
              behavior: 'deny',
              message: msg.message || 'Permission denied by user via mobile cockpit'
            }
      }
    };
    try {
      pending.child.stdin?.write(JSON.stringify(responsePayload) + '\n');
    } catch (err: any) {
      console.error('[Agent] Failed to write control response to child stdin:', err.message);
    }
    pendingApprovals.delete(msg.requestId);
  }
}

/**
 * 作業ディレクトリの検証とOSパス不一致の自動フォールバック
 */
function validateWorkDir(rawCwd?: string): string {
  let workDir = rawCwd || DEFAULT_CWD;
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(workDir);
  const isUnixPath = workDir.startsWith('/');

  let pathInvalidReason = '';
  if (!isWindows && isWindowsPath) {
    pathInvalidReason = `非Windows環境 (${process.platform}) にWindows形式のパス (${workDir}) が指定されました`;
  } else if (isWindows && isUnixPath) {
    pathInvalidReason = `Windows環境にUnix形式のパス (${workDir}) が指定されました`;
  } else if (!fs.existsSync(workDir)) {
    pathInvalidReason = `指定された作業ディレクトリ '${workDir}' が存在しません`;
  }

  if (pathInvalidReason) {
    console.warn(`[Agent] ⚠️ ${pathInvalidReason}。(前回の別環境/PCのパスの可能性があります)`);
    console.warn(`[Agent] ➡️ 安全のため、エージェントのデフォルト作業ディレクトリ '${DEFAULT_CWD}' に自動フォールバックします。`);
    workDir = DEFAULT_CWD;
  }
  return workDir;
}

/**
 * 現在実行中の AI プロセス (Claude / Copilot) を中断
 */
function abortCurrentTurn(callerClientId?: string, callerUserName?: string) {
  if (!currentChildProcess && !copilotRunner.isRunning) {
    return;
  }

  // 権限チェック: 実行中タスクの所有者 (ownerClientId または ownerUserName) と一致しているか検証
  if (currentExecution) {
    const isMatchClient = currentExecution.clientId && callerClientId && currentExecution.clientId === callerClientId;
    const isMatchUser = currentExecution.userName && callerUserName && currentExecution.userName === callerUserName;
    const isUnrestricted = !currentExecution.clientId && !currentExecution.userName;

    if (!isMatchClient && !isMatchUser && !isUnrestricted) {
      console.warn(`[Agent] ⚠️ Unauthorized abort attempt: owner=[${currentExecution.clientId}/${currentExecution.userName}], caller=[${callerClientId}/${callerUserName}]`);
      sendToHub({
        type: 'turn_error',
        error: '実行中タスクの中断権限がありません（タスク実行者または同一ユーザーのみ操作可能です）',
        targetClientId: callerClientId,
        timestamp: new Date().toISOString()
      });
      return;
    }
  }

  const targetClientId = currentExecution?.clientId || callerClientId;

  if (currentChildProcess) {
    console.log('[Agent] Aborting current Claude process...');
    currentChildProcess.kill('SIGINT');
    pendingApprovals.clear();
    sendToHub({
      type: 'execution_aborted',
      targetClientId,
      timestamp: new Date().toISOString()
    });
  } else if (copilotRunner.isRunning) {
    console.log('[Agent] Aborting current Copilot process...');
    copilotRunner.abort();
    sendToHub({
      type: 'execution_aborted',
      targetClientId,
      timestamp: new Date().toISOString()
    });
  }
  currentExecution = null;
}

/**
 * 添付ファイルを PC 側の一時ディレクトリ (~/.ai-remote/uploads/<sessionId>/) に保存
 */
function saveAttachments(
  attachments: AttachmentItem[] | undefined,
  sessionId: string
): AttachmentItem[] {
  if (!attachments || attachments.length === 0) return [];

  const uploadsDir = path.join(os.homedir(), '.ai-remote', 'uploads', sessionId);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const result: AttachmentItem[] = [];

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    try {
      const originalName = att.name || `file_${i + 1}`;
      const safeName = path.basename(originalName).replace(/[^\w\.\-\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf]/g, '_');
      let targetPath = path.join(uploadsDir, safeName);

      if (fs.existsSync(targetPath)) {
        const ext = path.extname(safeName);
        const base = path.basename(safeName, ext);
        targetPath = path.join(uploadsDir, `${base}_${Date.now()}_${i}${ext}`);
      }

      const rawBase64 = (att.data || '').replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(rawBase64, 'base64');
      fs.writeFileSync(targetPath, buffer);

      console.log(`[Agent] 📎 Saved attachment: ${att.name} -> ${targetPath} (${buffer.length} bytes)`);

      result.push({
        ...att,
        localPath: targetPath,
      });
    } catch (err: any) {
      console.warn(`[Agent] Failed to save attachment ${att.name}:`, err.message);
      result.push(att);
    }
  }

  return result;
}

/**
 * テキスト・コード・設定ファイルかどうか判定
 */
function isTextAttachment(att: AttachmentItem): boolean {
  if (
    att.type.startsWith('text/') ||
    att.type === 'application/json' ||
    att.type === 'application/javascript' ||
    att.type === 'application/typescript' ||
    att.type === 'application/xml'
  ) {
    return true;
  }
  const textExts = [
    '.txt', '.log', '.csv', '.tsv', '.json', '.md', '.ts', '.tsx', '.js', '.jsx',
    '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.sh', '.bat', '.cmd',
    '.ps1', '.yml', '.yaml', '.xml', '.html', '.css', '.scss', '.sql', '.diff', '.patch',
    '.env', '.conf', '.ini', '.toml'
  ];
  const ext = path.extname(att.name || '').toLowerCase();
  return textExts.includes(ext);
}

/**
 * プロンプトに添付ファイル情報（保存先パス ＆ テキストファイル内容展開）を付加
 */
function formatPromptWithAttachments(
  prompt: string,
  attachments: AttachmentItem[]
): string {
  if (!attachments || attachments.length === 0) return prompt;

  const notices: string[] = [];
  notices.push('【添付ファイル】');

  for (const att of attachments) {
    const sizeKb = (att.size / 1024).toFixed(1);
    const pathStr = att.localPath ? att.localPath : att.name;
    notices.push(`- ファイル名: ${att.name} (${sizeKb} KB) | 保存先: ${pathStr}`);

    // テキストファイルで、50KB 未満なら内容をプロンプト内にインライン展開
    if (isTextAttachment(att) && att.localPath && fs.existsSync(att.localPath)) {
      try {
        const stats = fs.statSync(att.localPath);
        if (stats.size <= 50 * 1024) {
          const content = fs.readFileSync(att.localPath, 'utf-8');
          const ext = path.extname(att.name).slice(1) || 'text';
          notices.push(`\`\`\`${ext}\n// --- 添付ファイル内容: ${att.name} ---\n${content}\n\`\`\``);
        }
      } catch (err: any) {
        console.warn(`[Agent] Failed to read text attachment content:`, err.message);
      }
    }
  }

  return `${notices.join('\n')}\n\n${prompt}`;
}

/**
 * GitHub Copilot CLI の 1 ターンを実行
 */
async function executeCopilotTurn(params: {
  text: string;
  sessionId?: string;
  isResume?: boolean;
  cwd?: string;
  permissionMode?: string;
  model?: string;
  reasoningEffort?: string;
  attachments?: AttachmentItem[];
  credentials?: UserCredentials;
  clientId?: string;
}) {
  if (currentChildProcess || copilotRunner.isRunning) {
    sendToHub({
      type: 'error',
      message: 'AI agent is already running a task. Please wait or abort.',
      code: 'BUSY',
      targetClientId: params.clientId
    });
    return;
  }

  const activeSessionId = params.sessionId || randomUUID();
  const initialResume = params.isResume !== undefined
    ? params.isResume
    : Boolean(params.sessionId && knownSessions.has(params.sessionId));

  let targetCwd = params.cwd;
  if (workspaceManager.isMultiTenant && (!targetCwd || targetCwd === DEFAULT_CWD)) {
    const userWs = workspaceManager.ensureUserWorkspace(params.credentials?.userName);
    targetCwd = userWs.userWorkspaceDir;
  }
  const workDir = validateWorkDir(targetCwd);

  knownSessions.add(activeSessionId);
  currentExecution = {
    clientId: params.clientId,
    userName: params.credentials?.userName,
    sessionId: activeSessionId
  };

  // 添付ファイルを保存
  const savedAttachments = saveAttachments(params.attachments, activeSessionId);
  const fullPrompt = formatPromptWithAttachments(params.text, savedAttachments);

  // 既存メッセージ履歴の読み込み
  let existingMessages: ChatMessage[] = [];
  try {
    existingMessages = await getSessionMessages(activeSessionId, workDir);
  } catch (err: any) {
    console.warn('[Agent] Could not load prior session messages for Copilot:', err.message);
  }

  // 今回のターンで記録するメッセージ
  const turnUserMessage: ChatMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    content: params.text,
    timestamp: new Date().toISOString(),
    sessionId: activeSessionId,
    engine: 'copilot',
    attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
  };

  try {
    await copilotRunner.execute({
      prompt: fullPrompt,
      sessionId: activeSessionId,
      isResume: initialResume,
      workDir,
      permissionMode: params.permissionMode,
      model: params.model,
      reasoningEffort: params.reasoningEffort,
      credentials: params.credentials,
      sandboxManager: workspaceManager.sandboxManager,
      onSendToHub: (msg) => {
        // turn_start メッセージに attachments を付与して Hub 経由で PWA へ通知
        if (msg.type === 'turn_start' && savedAttachments.length > 0) {
          msg.attachments = savedAttachments;
        }
        if (params.clientId && !msg.targetClientId) {
          msg.targetClientId = params.clientId;
        }
        sendToHub(msg);
      },
      onTurnEnd: () => {
        // セッション履歴に保存
        try {
          const updatedHistory = [...existingMessages, turnUserMessage];
          saveSessionHistory(activeSessionId, updatedHistory, {
            cwd: workDir,
            projectId: path.basename(workDir),
            engine: 'copilot',
          });
        } catch (err: any) {
          console.warn('[Agent] Failed to persist Copilot session messages:', err.message);
        }
      }
    });
  } finally {
    currentExecution = null;
  }
}

/**
 * Claude Code の 1 ターンを実行
 */
async function executeClaudeTurn(params: {
  text: string;
  sessionId?: string;
  isResume?: boolean;
  cwd?: string;
  permissionMode?: string;
  model?: string;
  attachments?: AttachmentItem[];
  credentials?: UserCredentials;
  clientId?: string;
}) {
  if (currentChildProcess || copilotRunner.isRunning) {
    sendToHub({
      type: 'error',
      message: 'AI agent is already running a task. Please wait or abort.',
      code: 'BUSY',
      targetClientId: params.clientId
    });
    return;
  }

  const prompt = params.text;
  const activeSessionId = params.sessionId || randomUUID();
  currentExecution = {
    clientId: params.clientId,
    userName: params.credentials?.userName,
    sessionId: activeSessionId
  };
  // isResume が明示されていなければ knownSessions にあるか判定（未記録なら初回なので false）
  const initialResume = params.isResume !== undefined
    ? params.isResume
    : Boolean(params.sessionId && knownSessions.has(params.sessionId));

  let targetCwd = params.cwd;
  if (workspaceManager.isMultiTenant && (!targetCwd || targetCwd === DEFAULT_CWD)) {
    const userWs = workspaceManager.ensureUserWorkspace(params.credentials?.userName);
    targetCwd = userWs.userWorkspaceDir;
  }
  // 作業ディレクトリの検証とOSパス不一致の自動フォールバック
  const workDir = validateWorkDir(targetCwd);

  const permissionMode = params.permissionMode || 'acceptEdits';

  // 添付ファイルを保存
  const savedAttachments = saveAttachments(params.attachments, activeSessionId);
  const fullPrompt = formatPromptWithAttachments(prompt, savedAttachments);

  // 既存メッセージ履歴の読み込み
  let existingMessages: ChatMessage[] = [];
  try {
    existingMessages = await getSessionMessages(activeSessionId, workDir);
  } catch (err: any) {
    console.warn('[Agent] Could not load prior session messages:', err.message);
  }

  const runProcess = (resumeMode: boolean) => {
    const args: string[] = [
      '--print',
      '--output-format=stream-json',
      '--input-format=stream-json',
      '--include-partial-messages',
      '--verbose',
      `--permission-mode=${permissionMode}`,
      '--permission-prompt-tool=stdio'
    ];

    if (params.model && params.model.trim()) {
      args.push('--model', params.model.trim());
    }

    if (resumeMode) {
      args.push('--resume', activeSessionId);
    } else {
      args.push('--session-id', activeSessionId);
    }

    console.log(`[Agent] Launching Claude: ${CLAUDE_BIN} ${args.join(' ')}`);
    console.log(`[Agent] Session ID: ${activeSessionId} (isResume: ${resumeMode})`);
    if (params.model) {
      console.log(`[Agent] Model     : ${params.model.trim()}`);
    }
    console.log(`[Agent] Working dir: ${workDir}`);

    sendToHub({
      type: 'turn_start',
      prompt,
      sessionId: activeSessionId,
      cwd: workDir,
      attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
      targetClientId: params.clientId,
      timestamp: new Date().toISOString()
    });

    let hasOutput = false;
    let resumeNotFound = false;
    let sessionAlreadyInUse = false;

    // 今回のターンで記録するメッセージ
    const turnUserMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
      sessionId: activeSessionId,
      attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
    };

    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      sessionId: activeSessionId,
      toolUses: [],
    };

    const childEnv = workspaceManager.buildChildProcessEnv(params.credentials);
    const sandboxConfig = workspaceManager.sandboxManager.getSandboxSpawnConfig(
      CLAUDE_BIN,
      args,
      {
        cwd: workDir,
        env: childEnv,
        userName: params.credentials?.userName,
        isWindows
      }
    );

    if (sandboxConfig.isSandboxed) {
      console.log(`[Agent] 🛡️ Running Claude Code in OS sandbox user: ${sandboxConfig.osUser} (method: ${sandboxConfig.methodUsed})`);
    }

    const child = spawn(sandboxConfig.command, sandboxConfig.args, {
      ...sandboxConfig.spawnOptions,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // EPIPE 防止: 子プロセスが即座に終了した際の未捕捉例外クラッシュを防止
    child.stdin?.on('error', (err: any) => {
      console.warn('[Agent] child.stdin error handled (EPIPE prevented):', err.message);
    });

    currentChildProcess = child;
    let capturedSessionId = activeSessionId;

    // stdin への初期ユーザープロンプト投入（画像がある場合はマルチモーダル content blocks）
    const imageAttachments = savedAttachments.filter((a) => a.type && a.type.startsWith('image/'));
    let initialUserContent: any = fullPrompt;

    if (imageAttachments.length > 0) {
      const contentBlocks: any[] = [];
      contentBlocks.push({
        type: 'text',
        text: fullPrompt
      });
      for (const img of imageAttachments) {
        const rawBase64 = (img.data || '').replace(/^data:[^;]+;base64,/, '');
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.type || 'image/png',
            data: rawBase64
          }
        });
      }
      initialUserContent = contentBlocks;
    }

    const initialUserMsg = {
      type: 'user',
      message: {
        role: 'user',
        content: initialUserContent
      }
    };
    try {
      child.stdin?.write(JSON.stringify(initialUserMsg) + '\n');
    } catch (err: any) {
      console.error('[Agent] Failed to write initial prompt to child stdin:', err.message);
    }

    // stdout を 1 行ずつ JSON パースして Hub へ転送 & メッセージ蓄積
    const readlineStdout = createInterface({ input: child.stdout });
    readlineStdout.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const event = JSON.parse(trimmed);
        hasOutput = true;

        if (event.session_id && !capturedSessionId) {
          capturedSessionId = event.session_id;
        }
        knownSessions.add(capturedSessionId);

        // 蓄積: テキスト delta
        if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
          const deltaText = event.event.delta?.text || '';
          if (deltaText) {
            assistantMsg.content += deltaText;
          }
        }

        // 蓄積: アシスタントブロック (text / tool_use)
        if (event.type === 'assistant' && event.message?.content) {
          const blocks = Array.isArray(event.message.content) ? event.message.content : [];
          const textBlocks = blocks.filter((b: any) => b.type === 'text');
          const toolBlocks = blocks.filter((b: any) => b.type === 'tool_use');

          if (textBlocks.length > 0 && !assistantMsg.content) {
            assistantMsg.content = textBlocks.map((b: any) => b.text).join('');
          }

          if (toolBlocks.length > 0) {
            const currentTools = assistantMsg.toolUses || [];
            const existingIds = new Set(currentTools.map((t) => t.id));
            for (const tb of toolBlocks) {
              if (!existingIds.has(tb.id)) {
                currentTools.push({
                  id: tb.id,
                  name: tb.name,
                  input: tb.input,
                  isRunning: true,
                });
              }
            }
            assistantMsg.toolUses = currentTools;
          }
        }

        // 蓄積: ツール実行結果
        if (event.type === 'user' && event.message?.content) {
          const rawContent = event.message.content;
          if (Array.isArray(rawContent) && assistantMsg.toolUses) {
            const toolResults = rawContent.filter((b: any) => b.type === 'tool_result');
            if (toolResults.length > 0) {
              assistantMsg.toolUses = assistantMsg.toolUses.map((tool) => {
                const tr = toolResults.find((r: any) => r.tool_use_id === tool.id);
                if (tr) {
                  return {
                    ...tool,
                    isRunning: false,
                    isError: tr.is_error || false,
                    output: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
                  };
                }
                return tool;
              });
            }
          }
        }

        // 承認要求: control_request (can_use_tool)
        if (event.type === 'control_request' && event.request?.subtype === 'can_use_tool') {
          const req = event.request;
          const reqId = event.request_id;
          pendingApprovals.set(reqId, {
            child,
            toolUseId: req.tool_use_id,
            ownerClientId: params.clientId,
            ownerUserName: params.credentials?.userName
          });
          console.log(`[Agent] ⚠️ Tool approval requested: ${req.tool_name} (request_id: ${reqId})`);

          // 蓄積メッセージの該当ツールを pending に更新
          if (req.tool_use_id && assistantMsg.toolUses) {
            assistantMsg.toolUses = assistantMsg.toolUses.map((t) => {
              if (t.id === req.tool_use_id) {
                return { ...t, approvalState: 'pending', approvalRequestId: reqId };
              }
              return t;
            });
          }

          sendToHub({
            type: 'tool_approval_request',
            requestId: reqId,
            toolUseId: req.tool_use_id,
            toolName: req.tool_name,
            input: req.input,
            description: req.description,
            decisionReason: req.decision_reason,
            targetClientId: params.clientId,
            timestamp: new Date().toISOString()
          });
        }

        // 蓄積: 統計
        if (event.type === 'result') {
          try {
            child.stdin?.end();
          } catch {}
          if (assistantMsg.toolUses) {
            assistantMsg.toolUses = assistantMsg.toolUses.map((t) =>
              t.isRunning ? { ...t, isRunning: false } : t
            );
          }
          assistantMsg.stats = {
            costUsd: event.total_cost_usd,
            durationMs: event.duration_ms,
            numTurns: event.num_turns,
            subtype: event.subtype,
          };
        }

        sendToHub({
          type: 'claude_event',
          sessionId: capturedSessionId,
          event,
          targetClientId: params.clientId
        });
      } catch (err) {
        console.warn('[Agent] Non-JSON stdout line:', trimmed);
        sendToHub({
          type: 'claude_raw_log',
          stream: 'stdout',
          text: trimmed,
          targetClientId: params.clientId
        });
      }
    });

    // stderr の収集
    const readlineStderr = createInterface({ input: child.stderr });
    readlineStderr.on('line', (line) => {
      console.warn('[Agent] stderr:', line);
      if (line.includes('No conversation found with session ID')) {
        resumeNotFound = true;
      }
      if (line.includes('is already in use')) {
        sessionAlreadyInUse = true;
      }
      sendToHub({
        type: 'claude_raw_log',
        stream: 'stderr',
        text: line,
        targetClientId: params.clientId
      });
    });

    child.on('close', (code, signal) => {
      console.log(`[Agent] Claude process exited with code ${code}, signal ${signal}`);
      currentChildProcess = null;
      currentExecution = null;
      pendingApprovals.clear();

      // 1. もし --session-id で「すでに存在する」と言われた場合、--resume で自動再試行！
      if (!resumeMode && sessionAlreadyInUse && !hasOutput) {
        console.warn(`[Agent] Session ${activeSessionId} is already in use. Automatically falling back to --resume...`);
        knownSessions.add(activeSessionId);
        runProcess(true);
        return;
      }

      // 2. もし --resume で過去セッションが見つからずに即終了した場合、--session-id で自動フォールバック再試行！
      if (resumeMode && resumeNotFound && !hasOutput) {
        console.warn(`[Agent] Session ${activeSessionId} not found to resume. Falling back to fresh --session-id...`);
        knownSessions.delete(activeSessionId);
        runProcess(false);
        return;
      }

      if (code === 0) {
        knownSessions.add(capturedSessionId);
      }

      // セッションメッセージの永続化
      try {
        if (assistantMsg.toolUses) {
          assistantMsg.toolUses = assistantMsg.toolUses.map((t) => ({ ...t, isRunning: false }));
        }
        const updatedHistory = [...existingMessages, turnUserMessage, assistantMsg];
        saveSessionHistory(capturedSessionId, updatedHistory, {
          cwd: workDir,
          projectId: path.basename(workDir),
        });
      } catch (err: any) {
        console.warn('[Agent] Failed to persist session messages:', err.message);
      }

      sendToHub({
        type: 'turn_end',
        sessionId: capturedSessionId,
        exitCode: code,
        signal,
        targetClientId: params.clientId,
        timestamp: new Date().toISOString()
      });

      // 最新セッション一覧をブロードキャストして Client 側のドロワーを即時最新化
      listSessions(undefined, workDir)
        .then((sessions) => {
          sendToHub({
            type: 'sessions_list',
            sessions,
            timestamp: new Date().toISOString(),
          });
        })
        .catch(() => {});
    });

    child.on('error', (err: any) => {
      console.error('[Agent] Failed to spawn Claude process:', err);
      currentChildProcess = null;
      currentExecution = null;
      pendingApprovals.clear();

      let errorDetail = err.message;
      if (err.code === 'ENOENT') {
        errorDetail = `Claude Code CLI ('${CLAUDE_BIN}') が見つかりません (ENOENT)。\n` +
          `【考えられる原因と対処】\n` +
          `1. パスにチルダ (~) が使われていた場合は /home/<ユーザー>/... のフル絶対パスで指定してください。\n` +
          `2. 環境変数は大文字で 'CLAUDE_BIN' と指定してください。\n` +
          `3. Claude Code が未インストールの場合は 'npm install -g @anthropic-ai/claude-code' を実行してください。\n` +
          `4. 確認用: ターミナルで 'which claude' または 'ls -la ${CLAUDE_BIN}' を実行してください。`;
      }

      sendToHub({
        type: 'turn_error',
        error: errorDetail,
        targetClientId: params.clientId,
        timestamp: new Date().toISOString()
      });
    });
  };

  try {
    runProcess(initialResume);
  } catch (err: any) {
    console.error('[Agent] Execution exception:', err);
    currentChildProcess = null;
    currentExecution = null;
    sendToHub({
      type: 'turn_error',
      error: err.message,
      targetClientId: params.clientId,
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
