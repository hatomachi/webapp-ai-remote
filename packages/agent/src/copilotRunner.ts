import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { ChatMessage, ToolUseItem, saveSessionHistory, getSessionMessages } from './sessionManager.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isWindows = process.platform === 'win32';

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
 * 実行環境 (Windows / Linux / macOS) に適した GitHub Copilot CLI バイナリパスを解決
 */
export function resolveCopilotBin(): { binPath: string; exists: boolean; status: string } {
  const rawEnv = getEnvCaseInsensitive('COPILOT_BIN', 'copilot_bin');

  if (rawEnv) {
    const cleaned = sanitizePath(rawEnv);
    if (!isWindows && (cleaned.endsWith('.cmd') || cleaned.endsWith('.bat'))) {
      console.warn(`[CopilotRunner] ⚠️ 環境変数で '${rawEnv}' が指定されていますが、非Windows環境 (${process.platform}) のため無視し、Linux/macOS 向けバイナリを探索します。`);
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
    return { binPath: 'copilot.cmd', exists: true, status: 'Windows デフォルト (copilot.cmd)' };
  }

  // Linux / macOS: Homebrew, ~/.local/bin, /usr/local/bin, /usr/bin 等を探索
  const candidates = [
    '/opt/homebrew/bin/copilot',
    path.join(os.homedir(), '.local', 'bin', 'copilot'),
    path.join(os.homedir(), '.npm-global', 'bin', 'copilot'),
    '/usr/local/bin/copilot',
    '/usr/bin/copilot'
  ];

  // nvm 配下のパスも探索
  try {
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir);
      for (const v of versions.reverse()) {
        candidates.push(path.join(nvmDir, v, 'bin', 'copilot'));
      }
    }
  } catch {}

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return { binPath: p, exists: true, status: `自動検出 (${p})` };
    }
  }

  // PATH上のコマンド名フォールバック
  return { binPath: 'copilot', exists: false, status: 'PATH探索フォールバック (copilot)' };
}

export interface ExecuteCopilotParams {
  prompt: string;
  sessionId: string;
  isResume: boolean;
  workDir: string;
  permissionMode?: string;
  model?: string;
  reasoningEffort?: string;
  onSendToHub: (msg: any) => void;
  onTurnEnd: () => void;
}

export class CopilotTurnRunner {
  private currentChild: ChildProcess | null = null;
  private readonly copilotBin: string;

  constructor() {
    const resolved = resolveCopilotBin();
    this.copilotBin = resolved.binPath;
    console.log(`[CopilotRunner] Initialized. Binary: ${this.copilotBin} (${resolved.status})`);
  }

  public get isRunning(): boolean {
    return this.currentChild !== null;
  }

  public abort(): void {
    if (this.currentChild) {
      console.log('[CopilotRunner] Aborting current Copilot process...');
      this.currentChild.kill('SIGINT');
      this.currentChild = null;
    }
  }

  public async execute(params: ExecuteCopilotParams): Promise<void> {
    const { prompt, sessionId, isResume, workDir, permissionMode, model, onSendToHub, onTurnEnd } = params;

    // Copilot CLI は正規の UUID v4 形式を厳格に要求するため、不正形式の場合は自動生成
    const effectiveSessionId = UUID_REGEX.test(sessionId) ? sessionId : randomUUID();
    if (effectiveSessionId !== sessionId) {
      console.log(`[CopilotRunner] Replaced non-UUID sessionId '${sessionId}' with '${effectiveSessionId}'`);
    }

    const effectivePermissionMode = permissionMode || 'acceptEdits';

    const args: string[] = [
      '-p', prompt,
      '--output-format', 'json',
      '--stream', 'on'
    ];

    if (effectivePermissionMode === 'bypassPermissions') {
      // bypassPermissions: ツール実行、ファイルパス制限、URLアクセスの全権限を自動承認
      args.push('--allow-all');
    } else {
      // acceptEdits / default: 非対話モードでの安全なツール自動実行
      args.push('--allow-all-tools');
    }

    // Copilot CLI に明示的な Copilot モデル名（例: gpt-5.4）以外（claude-*, gemini-*, default, auto 等）は付与せず、Copilot CLI 既定の自動最適モデルに任せる
    const isExplicitCopilotModel = model && /^gpt-5/i.test(model.trim());
    const effectiveModel = isExplicitCopilotModel ? model.trim() : undefined;

    if (effectiveModel) {
      args.push('--model', effectiveModel);
    }

    // --reasoning-effort の付与（パラメータ指定 > 環境変数 COPILOT_REASONING_EFFORT）
    const explicitReasoning = params.reasoningEffort || getEnvCaseInsensitive('COPILOT_REASONING_EFFORT', 'copilot_reasoning_effort');
    if (explicitReasoning && explicitReasoning.toLowerCase() !== 'off' && explicitReasoning.toLowerCase() !== 'none') {
      args.push('--reasoning-effort', explicitReasoning.trim());
    }

    if (isResume) {
      args.push(`--resume=${effectiveSessionId}`);
    } else {
      args.push(`--session-id=${effectiveSessionId}`);
    }

    console.log(`[CopilotRunner] Launching Copilot: ${this.copilotBin} ${args.join(' ')}`);
    console.log(`[CopilotRunner] Session ID: ${effectiveSessionId} (isResume: ${isResume})`);
    console.log(`[CopilotRunner] Permission: ${effectivePermissionMode} (${effectivePermissionMode === 'bypassPermissions' ? '--allow-all' : '--allow-all-tools'})`);
    if (model) {
      console.log(`[CopilotRunner] Model     : ${model.trim()}`);
    }
    if (explicitReasoning && explicitReasoning.toLowerCase() !== 'off' && explicitReasoning.toLowerCase() !== 'none') {
      console.log(`[CopilotRunner] Reasoning : ${explicitReasoning}`);
    }
    console.log(`[CopilotRunner] Working dir: ${workDir}`);

    onSendToHub({
      type: 'turn_start',
      prompt,
      sessionId: effectiveSessionId,
      cwd: workDir,
      engine: 'copilot',
      timestamp: new Date().toISOString()
    });

    // PWA側にセッションID確定を通知（Claude互換 init イベント）
    onSendToHub({
      type: 'claude_event',
      sessionId: effectiveSessionId,
      event: {
        type: 'system',
        subtype: 'init',
        session_id: effectiveSessionId
      }
    });

    const turnUserMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
      sessionId: effectiveSessionId,
      engine: 'copilot'
    };

    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      sessionId: effectiveSessionId,
      engine: 'copilot',
      toolUses: []
    };

    let existingMessages: ChatMessage[] = [];
    try {
      existingMessages = await getSessionMessages(effectiveSessionId, workDir);
    } catch {}

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      FORCE_COLOR: '0'
    };
    if (effectivePermissionMode === 'bypassPermissions') {
      childEnv.COPILOT_ALLOW_ALL = 'true';
    }

    const child = spawn(this.copilotBin, args, {
      cwd: workDir,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWindows
    });

    this.currentChild = child;
    let hasOutput = false;
    let capturedSessionId = sessionId;

    // stdout を 1 行ずつ JSON パース
    const readlineStdout = createInterface({ input: child.stdout });
    readlineStdout.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const event = JSON.parse(trimmed);
        hasOutput = true;

        if (event.sessionId && !capturedSessionId) {
          capturedSessionId = event.sessionId;
        }

        // --- 1. テキスト差分 (assistant.message_delta) ---
        if (event.type === 'assistant.message_delta') {
          const deltaText = event.data?.deltaContent || '';
          if (deltaText) {
            assistantMsg.content += deltaText;

            // 既存 PWA (App.tsx) がそのまま解釈できる互換イベントを発行
            onSendToHub({
              type: 'claude_event',
              sessionId: capturedSessionId,
              event: {
                type: 'stream_event',
                event: {
                  type: 'content_block_delta',
                  delta: {
                    type: 'text_delta',
                    text: deltaText
                  }
                }
              }
            });
          }
        }

        // --- 1b. 完成メッセージ (assistant.message) のフォールバック ---
        if (event.type === 'assistant.message') {
          const fullContent = event.data?.content || '';
          if (fullContent && !assistantMsg.content) {
            assistantMsg.content = fullContent;
            onSendToHub({
              type: 'claude_event',
              sessionId: capturedSessionId,
              event: {
                type: 'stream_event',
                event: {
                  type: 'content_block_delta',
                  delta: {
                    type: 'text_delta',
                    text: fullContent
                  }
                }
              }
            });
          }
        }

        // --- 2. ツール実行開始 (tool.execution_start) ---
        if (event.type === 'tool.execution_start') {
          const tData = event.data || {};
          const toolId = tData.toolCallId || `copilot-tool-${Date.now()}`;
          const toolName = tData.toolName || 'tool';
          const toolInput = tData.arguments || {};

          const currentTools = assistantMsg.toolUses || [];
          currentTools.push({
            id: toolId,
            name: toolName,
            input: toolInput,
            isRunning: true
          });
          assistantMsg.toolUses = currentTools;

          // 既存 PWA (App.tsx) 互換イベントを発行（ToolUseCard が描画される）
          onSendToHub({
            type: 'claude_event',
            sessionId: capturedSessionId,
            event: {
              type: 'assistant',
              message: {
                content: [
                  {
                    type: 'tool_use',
                    id: toolId,
                    name: toolName,
                    input: toolInput
                  }
                ]
              }
            }
          });
        }

        // --- 3. ツール実行完了 (tool.execution_complete) ---
        if (event.type === 'tool.execution_complete') {
          const tData = event.data || {};
          const toolId = tData.toolCallId;
          const isError = tData.success === false;
          const rawResult = tData.result?.content || (tData.error ? tData.error.message : '');

          if (assistantMsg.toolUses) {
            assistantMsg.toolUses = assistantMsg.toolUses.map((t) => {
              if (t.id === toolId) {
                return {
                  ...t,
                  isRunning: false,
                  isError,
                  output: typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult)
                };
              }
              return t;
            });
          }

          // 既存 PWA 互換イベントを発行（ToolUseCard の実行完了・結果更新）
          onSendToHub({
            type: 'claude_event',
            sessionId: capturedSessionId,
            event: {
              type: 'user',
              message: {
                content: [
                  {
                    type: 'tool_result',
                    tool_use_id: toolId,
                    is_error: isError,
                    content: rawResult
                  }
                ]
              }
            }
          });
        }

        // --- 4. ターン完了 / 統計 (result) ---
        if (event.type === 'result') {
          const usage = event.usage || {};
          if (assistantMsg.toolUses) {
            assistantMsg.toolUses = assistantMsg.toolUses.map((t) =>
              t.isRunning ? { ...t, isRunning: false } : t
            );
          }
          assistantMsg.stats = {
            durationMs: usage.totalApiDurationMs || usage.sessionDurationMs,
            numTurns: 1,
            subtype: `exit_${event.exitCode ?? 0}`
          };
        }

        // 生イベントも Copilot イベントとして透過送信
        onSendToHub({
          type: 'copilot_event',
          sessionId: capturedSessionId,
          event
        });

      } catch (err) {
        console.warn('[CopilotRunner] Non-JSON stdout line:', trimmed);
        onSendToHub({
          type: 'claude_raw_log',
          stream: 'stdout',
          text: trimmed
        });
      }
    });

    let resumeNotFound = false;
    let modelUnavailable = false;
    let lastStderr = '';

    // stderr の収集
    const readlineStderr = createInterface({ input: child.stderr });
    readlineStderr.on('line', (line) => {
      console.warn('[CopilotRunner] stderr:', line);
      lastStderr = line;
      if (line.includes('No session, task, or name matched')) {
        resumeNotFound = true;
      }
      if (line.includes('from --model flag is not available')) {
        modelUnavailable = true;
      }
      onSendToHub({
        type: 'claude_raw_log',
        stream: 'stderr',
        text: line
      });
    });

    child.on('close', async (code, signal) => {
      console.log(`[CopilotRunner] Process exited with code: ${code}, signal: ${signal}`);
      this.currentChild = null;

      // 1. もし --model で未対応モデル名が渡されて即終了した場合、モデル指定なし（Copilot 自動最適）で自動フォールバック再試行！
      if (modelUnavailable && params.model && !hasOutput) {
        console.warn(`[CopilotRunner] Model '${params.model}' not available. Automatically retrying with Copilot default optimal model...`);
        this.execute({ ...params, model: undefined });
        return;
      }

      // 2. もし --resume で過去セッションが見つからずに即終了した場合、--session-id で自動フォールバック再試行！
      if (isResume && resumeNotFound && !hasOutput) {
        console.warn(`[CopilotRunner] Session ${effectiveSessionId} not found to resume. Falling back to fresh --session-id...`);
        this.execute({ ...params, isResume: false });
        return;
      }

      if (!hasOutput && code !== 0) {
        const errorDetail = lastStderr
          ? `Copilot CLI エラー: ${lastStderr}`
          : `Copilot CLI が異常終了しました (exit code: ${code})。バイナリパスや認証 (copilot login) をご確認ください。`;
        onSendToHub({
          type: 'turn_error',
          error: errorDetail,
          timestamp: new Date().toISOString()
        });
      } else {
        // 会話履歴の保存
        try {
          const updated = [...existingMessages, turnUserMessage, assistantMsg];
          saveSessionHistory(capturedSessionId, updated, { cwd: workDir, engine: 'copilot' });
        } catch (saveErr: any) {
          console.error('[CopilotRunner] Failed to save session history:', saveErr.message);
        }
      }

      onSendToHub({
        type: 'turn_end',
        sessionId: capturedSessionId,
        exitCode: code,
        signal,
        engine: 'copilot',
        timestamp: new Date().toISOString()
      });

      onTurnEnd();
    });

    child.on('error', (err: any) => {
      console.error('[CopilotRunner] Failed to spawn Copilot CLI:', err);
      this.currentChild = null;

      let errorMsg = `Copilot CLI の起動に失敗しました: ${err.message}`;
      if (err.code === 'ENOENT') {
        errorMsg = `Copilot CLI (${this.copilotBin}) が見つかりませんでした。インストールまたは環境変数 COPILOT_BIN をご確認ください。`;
      }

      onSendToHub({
        type: 'turn_error',
        error: errorMsg,
        timestamp: new Date().toISOString()
      });

      onTurnEnd();
    });
  }
}
