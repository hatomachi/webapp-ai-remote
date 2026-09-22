import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  projectId?: string;
  engine?: 'claude' | 'copilot';
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ToolUseItem {
  id: string;
  name: string;
  input: Record<string, any> | string;
  output?: string;
  isRunning: boolean;
  isError?: boolean;
}

export interface ResultStats {
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  subtype?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  sessionId: string;
  engine?: 'claude' | 'copilot';
  isStreaming?: boolean;
  isError?: boolean;
  toolUses?: ToolUseItem[];
  stats?: ResultStats;
}

const STORAGE_DIR = path.join(os.homedir(), '.ai-remote', 'sessions');
const INDEX_FILE = path.join(STORAGE_DIR, 'index.json');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * 保存先ディレクトリを初期化
 */
function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

/**
 * 内部インデックス（~/.ai-remote/sessions/index.json）を読み込み
 */
function loadInternalIndex(): Map<string, SessionInfo> {
  ensureStorageDir();
  const map = new Map<string, SessionInfo>();
  if (fs.existsSync(INDEX_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && item.id) {
            map.set(item.id, item);
          }
        }
      }
    } catch (err: any) {
      console.warn('[SessionManager] Failed to read index.json:', err.message);
    }
  }
  return map;
}

/**
 * 内部インデックスを保存
 */
function saveInternalIndex(map: Map<string, SessionInfo>) {
  ensureStorageDir();
  const array = Array.from(map.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  fs.writeFileSync(INDEX_FILE, JSON.stringify(array, null, 2), 'utf-8');
}

/**
 * パスから Claude Code のプロジェクトフォルダ名を推定
 */
function pathToClaudeDirName(dirPath: string): string {
  // 例: /Users/s-ikari/work/webapp-ai-remote -> -Users-s-ikari-work-webapp-ai-remote
  return dirPath.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Claude Code の projects ディレクトリを探索し、指定 cwd（または全プロジェクト）のセッション一覧を抽出
 */
async function scanClaudeProjects(targetCwd?: string): Promise<SessionInfo[]> {
  const result: SessionInfo[] = [];
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return result;
  }

  try {
    const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });

    // targetCwd が指定されている場合はマッチするプロジェクトフォルダを特定
    const targetDirName = targetCwd ? pathToClaudeDirName(targetCwd) : null;

    for (const pDir of projectDirs) {
      if (!pDir.isDirectory()) continue;
      // targetCwd がある場合は完全一致または後方一致でフィルタ
      if (targetDirName && pDir.name !== targetDirName && !pDir.name.endsWith(targetDirName)) {
        continue;
      }

      const pDirPath = path.join(CLAUDE_PROJECTS_DIR, pDir.name);
      const files = fs.readdirSync(pDirPath, { withFileTypes: true });

      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
        const sessionId = f.name.replace(/\.jsonl$/, '');
        const filePath = path.join(pDirPath, f.name);

        try {
          const stats = fs.statSync(filePath);
          // ファイルの要約情報（ai-title や最初の user メッセージ）を高速抽出
          const summary = await extractSummaryFromClaudeJsonl(filePath);

          result.push({
            id: sessionId,
            title: summary.title || '無題のセッション',
            cwd: targetCwd || summary.cwd || '',
            projectId: summary.cwd ? path.basename(summary.cwd) : undefined,
            createdAt: stats.birthtime.toISOString() || stats.mtime.toISOString(),
            updatedAt: stats.mtime.toISOString(),
            messageCount: summary.messageCount,
          });
        } catch (e) {
          // ignore error for single file
        }
      }
    }
  } catch (err: any) {
    console.warn('[SessionManager] Failed to scan Claude projects:', err.message);
  }

  return result;
}

/**
 * Claude Code の JSONL ファイルから要約情報（タイトル、CWD、メッセージ数）を抽出
 */
async function extractSummaryFromClaudeJsonl(filePath: string): Promise<{
  title?: string;
  cwd?: string;
  messageCount: number;
}> {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let title: string | undefined;
  let firstUserPrompt: string | undefined;
  let cwd: string | undefined;
  let messageCount = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.type === 'ai-title' && obj.aiTitle) {
        title = obj.aiTitle;
      }
      if (obj.type === 'user' && obj.message?.content) {
        messageCount++;
        if (!firstUserPrompt) {
          const content = obj.message.content;
          if (typeof content === 'string') {
            firstUserPrompt = content;
          } else if (Array.isArray(content)) {
            const textBlock = content.find((b: any) => b.type === 'text');
            if (textBlock && textBlock.text) firstUserPrompt = textBlock.text;
          }
        }
        if (obj.cwd && !cwd) {
          cwd = obj.cwd;
        }
      }
      if (obj.type === 'assistant' && obj.message) {
        messageCount++;
      }
    } catch {
      // ignore
    }
  }

  return {
    title: title || (firstUserPrompt ? firstUserPrompt.slice(0, 30) : undefined),
    cwd,
    messageCount,
  };
}

/**
 * Claude Code の JSONL ファイルをパースして ChatMessage[] に変換
 */
export async function parseClaudeJsonlToMessages(filePath: string, sessionId: string): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  if (!fs.existsSync(filePath)) return messages;

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const obj = JSON.parse(trimmed);

      // 1) ユーザーメッセージ
      if (obj.type === 'user' && obj.message?.content) {
        const rawContent = obj.message.content;
        // tool_result が含まれる場合、直前のアシスタントの toolUses を更新
        if (Array.isArray(rawContent)) {
          const toolResults = rawContent.filter((b: any) => b.type === 'tool_result');
          if (toolResults.length > 0 && messages.length > 0) {
            const last = messages[messages.length - 1];
            if (last.role === 'assistant' && last.toolUses) {
              last.toolUses = last.toolUses.map((tool) => {
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

          const textBlocks = rawContent.filter((b: any) => b.type === 'text');
          if (textBlocks.length > 0) {
            messages.push({
              id: obj.uuid || `user-${Date.now()}-${Math.random()}`,
              role: 'user',
              content: textBlocks.map((b: any) => b.text).join(''),
              timestamp: obj.timestamp || new Date().toISOString(),
              sessionId,
            });
          }
        } else if (typeof rawContent === 'string') {
          messages.push({
            id: obj.uuid || `user-${Date.now()}-${Math.random()}`,
            role: 'user',
            content: rawContent,
            timestamp: obj.timestamp || new Date().toISOString(),
            sessionId,
          });
        }
      }

      // 2) アシスタントメッセージ
      if (obj.type === 'assistant' && obj.message?.content) {
        const blocks = Array.isArray(obj.message.content) ? obj.message.content : [];
        const textBlocks = blocks.filter((b: any) => b.type === 'text');
        const toolBlocks = blocks.filter((b: any) => b.type === 'tool_use');

        const toolUses: ToolUseItem[] = toolBlocks.map((tb: any) => ({
          id: tb.id,
          name: tb.name,
          input: tb.input,
          isRunning: false,
        }));

        const contentText = textBlocks.map((b: any) => b.text).join('');

        messages.push({
          id: obj.uuid || obj.message.id || `assistant-${Date.now()}-${Math.random()}`,
          role: 'assistant',
          content: contentText,
          timestamp: obj.timestamp || new Date().toISOString(),
          sessionId,
          toolUses: toolUses.length > 0 ? toolUses : undefined,
        });
      }

      // 3) ターン完了統計
      if (obj.type === 'result' && messages.length > 0) {
        const last = messages[messages.length - 1];
        if (last.role === 'assistant') {
          last.stats = {
            costUsd: obj.total_cost_usd,
            durationMs: obj.duration_ms,
            numTurns: obj.num_turns,
            subtype: obj.subtype,
          };
        }
      }
    } catch {
      // ignore JSON parse error for malformed lines
    }
  }

  return messages;
}

/**
 * 統合セッション一覧を取得
 */
export async function listSessions(projectId?: string, cwd?: string): Promise<SessionInfo[]> {
  const internalMap = loadInternalIndex();
  const claudeSessions = await scanClaudeProjects(cwd);

  // マージ: internalMap を優先し、Claude Code 由来で未登録のものを追加
  for (const cs of claudeSessions) {
    if (!internalMap.has(cs.id)) {
      internalMap.set(cs.id, cs);
    }
  }

  let list = Array.from(internalMap.values());

  // プロジェクトや cwd でフィルタリング
  if (cwd) {
    list = list.filter((s) => s.cwd === cwd || s.cwd.endsWith(path.basename(cwd)));
  } else if (projectId) {
    list = list.filter((s) => s.projectId === projectId || (s.cwd && path.basename(s.cwd) === projectId));
  }

  // 最新更新日時の降順でソート
  list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return list;
}

/**
 * 特定セッションのメッセージ履歴を取得
 */
export async function getSessionMessages(sessionId: string, cwd?: string): Promise<ChatMessage[]> {
  ensureStorageDir();
  const sessionFilePath = path.join(STORAGE_DIR, `${sessionId}.json`);

  // 1) 内部ストアに完全なメッセージがあれば最優先で返す
  if (fs.existsSync(sessionFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(sessionFilePath, 'utf-8'));
      if (Array.isArray(data)) {
        return data;
      }
    } catch (err: any) {
      console.warn(`[SessionManager] Failed to read ${sessionId}.json:`, err.message);
    }
  }

  // 2) Claude Code の JSONL を探してパース
  if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    try {
      const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
      const targetDirName = cwd ? pathToClaudeDirName(cwd) : null;

      for (const pDir of projectDirs) {
        if (!pDir.isDirectory()) continue;
        if (targetDirName && pDir.name !== targetDirName && !pDir.name.endsWith(targetDirName)) {
          continue;
        }

        const jsonlPath = path.join(CLAUDE_PROJECTS_DIR, pDir.name, `${sessionId}.jsonl`);
        if (fs.existsSync(jsonlPath)) {
          const parsed = await parseClaudeJsonlToMessages(jsonlPath, sessionId);
          if (parsed.length > 0) {
            // 次回用に内部ストアにもキャッシュ保存
            try {
              fs.writeFileSync(sessionFilePath, JSON.stringify(parsed, null, 2), 'utf-8');
            } catch {}
            return parsed;
          }
        }
      }
    } catch (err: any) {
      console.warn(`[SessionManager] Failed to find Claude JSONL for ${sessionId}:`, err.message);
    }
  }

  return [];
}

/**
 * セッションメッセージを保存し、メタデータを更新
 */
export function saveSessionHistory(
  sessionId: string,
  messages: ChatMessage[],
  meta: {
    cwd: string;
    projectId?: string;
    title?: string;
    engine?: 'claude' | 'copilot';
  }
) {
  if (!sessionId) return;
  ensureStorageDir();

  const sessionFilePath = path.join(STORAGE_DIR, `${sessionId}.json`);
  fs.writeFileSync(sessionFilePath, JSON.stringify(messages, null, 2), 'utf-8');

  // インデックスを更新
  const index = loadInternalIndex();
  const existing = index.get(sessionId);

  const defaultTitle =
    messages.find((m) => m.role === 'user')?.content.slice(0, 30) || '無題のセッション';

  const updated: SessionInfo = {
    id: sessionId,
    title: meta.title || existing?.title || defaultTitle,
    cwd: meta.cwd || existing?.cwd || '',
    projectId: meta.projectId || existing?.projectId || (meta.cwd ? path.basename(meta.cwd) : undefined),
    engine: meta.engine || existing?.engine || 'claude',
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: messages.length,
  };

  index.set(sessionId, updated);
  saveInternalIndex(index);
}

/**
 * セッションを削除
 */
export function deleteSession(sessionId: string): boolean {
  ensureStorageDir();
  const sessionFilePath = path.join(STORAGE_DIR, `${sessionId}.json`);
  if (fs.existsSync(sessionFilePath)) {
    try {
      fs.unlinkSync(sessionFilePath);
    } catch {}
  }

  const index = loadInternalIndex();
  const deleted = index.delete(sessionId);
  if (deleted) {
    saveInternalIndex(index);
  }
  return deleted;
}
