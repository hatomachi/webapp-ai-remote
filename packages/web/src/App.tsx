import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Square, AlertCircle, ShieldAlert, Cpu } from 'lucide-react';
import { Header } from './components/Header';
import { ChatMessage } from './components/ChatMessage';
import { QuickActions } from './components/QuickActions';
import { SessionDrawer } from './components/SessionDrawer';
import { SettingsModal } from './components/SettingsModal';
import { useRemoteSocket } from './hooks/useRemoteSocket';
import {
  InboundMessage,
  ChatMessage as ChatMessageType,
  SessionInfo,
  PermissionMode,
  ToolUseItem,
  ProjectInfo,
} from './types/protocol';

const SESSIONS_STORAGE_KEY = 'ai_remote_sessions_v1';
const PROJECTS_STORAGE_KEY = 'ai_remote_projects_v1';
const MESSAGES_STORAGE_PREFIX = 'ai_remote_msgs_';

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function App() {
  // --- プロジェクト一覧 & カレントプロジェクト ---
  const [projects, setProjects] = useState<ProjectInfo[]>(() => {
    try {
      const saved = localStorage.getItem(PROJECTS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(() => {
    try {
      const saved = localStorage.getItem(PROJECTS_STORAGE_KEY);
      if (saved) {
        const list = JSON.parse(saved);
        if (list.length > 0) return list[0];
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  });

  // --- セッション一覧 & カレントセッション ---
  const [sessions, setSessions] = useState<SessionInfo[]>(() => {
    try {
      const saved = localStorage.getItem(SESSIONS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    return generateUUID();
  });

  const [currentCwd, setCurrentCwd] = useState<string>('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('acceptEdits');

  // --- メッセージ履歴 ---
  const [messages, setMessages] = useState<ChatMessageType[]>([]);

  // --- UI状態 ---
  const [inputText, setInputText] = useState('');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabled = useRef(true);

  // --- セッション変更時にローカルストレージからメッセージ復元 ---
  useEffect(() => {
    try {
      const savedMsgs = localStorage.getItem(`${MESSAGES_STORAGE_PREFIX}${currentSessionId}`);
      if (savedMsgs) {
        setMessages(JSON.parse(savedMsgs));
      } else {
        setMessages([]);
      }
    } catch (e) {
      console.error('Failed to load session messages', e);
      setMessages([]);
    }
  }, [currentSessionId]);

  // --- メッセージ更新時にローカルストレージに永続化 ---
  useEffect(() => {
    if (messages.length === 0) return;
    try {
      localStorage.setItem(
        `${MESSAGES_STORAGE_PREFIX}${currentSessionId}`,
        JSON.stringify(messages)
      );

      // セッションリストのメタ情報（更新日時・発言数）も更新
      setSessions((prev) => {
        const title =
          messages.find((m) => m.role === 'user')?.content.slice(0, 30) || '無題のセッション';
        const exists = prev.some((s) => s.id === currentSessionId);
        let updated: SessionInfo[];
        if (exists) {
          updated = prev.map((s) =>
            s.id === currentSessionId
              ? {
                  ...s,
                  title: s.title || title,
                  updatedAt: new Date().toISOString(),
                  messageCount: messages.length,
                }
              : s
          );
        } else {
          updated = [
            {
              id: currentSessionId,
              title,
              cwd: currentProject?.path || currentCwd,
              projectId: currentProject?.id || (currentCwd ? currentCwd.split('/').filter(Boolean).pop() : undefined),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              messageCount: messages.length,
            },
            ...prev,
          ];
        }
        localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    } catch (e) {
      console.error('Failed to save session messages', e);
    }
  }, [messages, currentSessionId, currentCwd, currentProject]);

  // --- 受信イベントのディスパッチ処理 ---
  const handleInboundMessage = useCallback(
    (msg: InboundMessage) => {
      console.log('[App] Inbound event:', msg.type);

      if (msg.type === 'turn_start') {
        // 新規ターンのアシスタント吹き出しを用意（ストリーミング待機）
        const newMsgId = `assistant-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: newMsgId,
            role: 'assistant',
            content: '',
            timestamp: msg.timestamp,
            sessionId: msg.sessionId,
            isStreaming: true,
            toolUses: [],
          },
        ]);
      } else if (msg.type === 'claude_event') {
        const ev = msg.event;

        // 1) システム初期化でセッションIDが割り振られた場合
        if (ev.type === 'system' && ev.subtype === 'init') {
          if (ev.session_id && ev.session_id !== currentSessionId) {
            console.log('[App] Session ID established by Claude:', ev.session_id);
            setCurrentSessionId(ev.session_id);
          }
        }

        // 2) ストリーミングテキスト delta (文字の追記)
        if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta') {
          const deltaText = ev.event.delta?.text || '';
          if (deltaText) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== 'assistant') return prev;
              return [
                ...prev.slice(0, -1),
                {
                  ...last,
                  content: last.content + deltaText,
                  isStreaming: true,
                },
              ];
            });
          }
        }

        // 3) アシスタントメッセージのブロック受領（テキストや tool_use）
        if (ev.type === 'assistant' && ev.message?.content) {
          const blocks = ev.message.content;
          const textBlocks = blocks.filter((b: any) => b.type === 'text');
          const toolBlocks = blocks.filter((b: any) => b.type === 'tool_use');

          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') return prev;

            const newTools: ToolUseItem[] = toolBlocks.map((tb: any) => ({
              id: tb.id || generateUUID(),
              name: tb.name,
              input: tb.input,
              isRunning: true,
            }));

            // 既存の toolUses に新規ツールを追加（重複回避）
            const existingToolIds = new Set((last.toolUses || []).map((t) => t.id));
            const mergedTools = [...(last.toolUses || [])];
            for (const t of newTools) {
              if (!existingToolIds.has(t.id)) {
                mergedTools.push(t);
              }
            }

            const combinedText = textBlocks.map((b: any) => b.text).join('') || last.content;

            return [
              ...prev.slice(0, -1),
              {
                ...last,
                content: combinedText,
                toolUses: mergedTools,
              },
            ];
          });
        }

        // 4) ツール実行結果（user メッセージの tool_result）
        if (ev.type === 'user' && ev.message?.content) {
          const toolResults = ev.message.content.filter((b: any) => b.type === 'tool_result');
          if (toolResults.length > 0) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== 'assistant' || !last.toolUses) return prev;

              const updatedTools = last.toolUses.map((tool) => {
                const result = toolResults.find((r: any) => r.tool_use_id === tool.id);
                if (result) {
                  return {
                    ...tool,
                    isRunning: false,
                    isError: result.is_error || false,
                    output:
                      typeof result.content === 'string'
                        ? result.content
                        : JSON.stringify(result.content),
                  };
                }
                return tool;
              });

              return [
                ...prev.slice(0, -1),
                {
                  ...last,
                  toolUses: updatedTools,
                },
              ];
            });
          }
        }

        // 5) ターン結果（Result stats）
        if (ev.type === 'result') {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') return prev;

            // 残っている tool を完了状態に
            const finalizedTools = (last.toolUses || []).map((t) =>
              t.isRunning ? { ...t, isRunning: false } : t
            );

            return [
              ...prev.slice(0, -1),
              {
                ...last,
                isStreaming: false,
                toolUses: finalizedTools,
                stats: {
                  costUsd: ev.total_cost_usd,
                  durationMs: ev.duration_ms,
                  numTurns: ev.num_turns,
                  subtype: ev.subtype,
                },
              },
            ];
          });
        }
      } else if (msg.type === 'turn_end') {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const finalizedTools = (last.toolUses || []).map((t) =>
            t.isRunning ? { ...t, isRunning: false } : t
          );
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              isStreaming: false,
              toolUses: finalizedTools,
            },
          ];
        });
      } else if (msg.type === 'turn_error') {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') {
            return [
              ...prev,
              {
                id: `error-${Date.now()}`,
                role: 'system',
                content: `エラー: ${msg.error}`,
                timestamp: msg.timestamp,
                sessionId: currentSessionId,
                isError: true,
              },
            ];
          }
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              content: last.content ? `${last.content}\n\n⚠️ エラー: ${msg.error}` : `⚠️ エラー: ${msg.error}`,
              isStreaming: false,
              isError: true,
            },
          ];
        });
      } else if (msg.type === 'execution_aborted') {
        setMessages((prev) => [
          ...prev,
          {
            id: `abort-${Date.now()}`,
            role: 'system',
            content: '🛑 タスクの実行を中断しました。',
            timestamp: msg.timestamp,
            sessionId: currentSessionId,
          },
        ]);
      } else if (msg.type === 'error') {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'system',
            content: `システム警告 (${msg.code}): ${msg.message}`,
            timestamp: new Date().toISOString(),
            sessionId: currentSessionId,
            isError: true,
          },
        ]);
      }
    },
    [currentSessionId]
  );

  // --- WebSocket / HTTP ハイブリッドフック ---
  const {
    settings,
    updateSettings,
    isHubConnected,
    isAgentConnected,
    activeTransport,
    agentHostname,
    agentCwd,
    isExecuting,
    availableProjects,
    projectsBaseDir,
    requestProjects,
    sendPrompt,
    abort,
  } = useRemoteSocket(handleInboundMessage);

  // PC側から利用可能なプロジェクト候補が取得された時、未登録なら自動登録
  useEffect(() => {
    if (availableProjects.length > 0 && projects.length === 0) {
      setProjects(availableProjects);
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(availableProjects));
      if (!currentProject) {
        setCurrentProject(availableProjects[0]);
        setCurrentCwd(availableProjects[0].path);
      }
    }
  }, [availableProjects, projects.length, currentProject]);

  // 初回に agentCwd または defaultCwd から currentProject を補正
  useEffect(() => {
    if (!currentProject && (agentCwd || settings.defaultCwd)) {
      const activePath = agentCwd || settings.defaultCwd;
      const name = activePath.split('/').filter(Boolean).pop() || 'Project';
      const initialProj: ProjectInfo = { id: name, name, path: activePath };
      setCurrentProject(initialProj);
      setCurrentCwd(activePath);
      setProjects((prev) => {
        if (!prev.some((p) => p.path === activePath)) {
          const next = [initialProj, ...prev];
          localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(next));
          return next;
        }
        return prev;
      });
    }
  }, [agentCwd, settings.defaultCwd, currentProject]);

  // --- プロジェクト操作 ---
  const handleSelectProject = (project: ProjectInfo) => {
    setCurrentProject(project);
    setCurrentCwd(project.path);
    // そのプロジェクトの既存セッションを探す
    const existing = sessions.find((s) => s.projectId === project.id || s.cwd === project.path);
    if (existing) {
      setCurrentSessionId(existing.id);
    } else {
      handleNewSession(project.path);
    }
  };

  const handleAddProject = (project: ProjectInfo) => {
    setProjects((prev) => {
      if (prev.some((p) => p.path === project.path)) return prev;
      const next = [project, ...prev];
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleRemoveProject = (projectId: string) => {
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== projectId);
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(next));
      if (currentProject?.id === projectId && next.length > 0) {
        handleSelectProject(next[0]);
      }
      return next;
    });
  };

  // --- 自動スクロール ---
  const scrollToBottom = useCallback((force = false) => {
    if (chatContainerRef.current) {
      if (force || isAutoScrollEnabled.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleScroll = () => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      // 最下部から 40px 以内にいる場合は自動スクロール有効
      isAutoScrollEnabled.current = scrollHeight - scrollTop - clientHeight < 40;
    }
  };

  // --- 送信処理 ---
  const handleSubmitPrompt = (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || isExecuting) return;

    // ユーザーメッセージを追加
    const userMsg: ChatMessageType = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      sessionId: currentSessionId,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    isAutoScrollEnabled.current = true;
    scrollToBottom(true);

    const isResume = messages.some((m) => m.role === 'assistant' && !m.isError);

    // WebSocket で Agent に送信
    sendPrompt(text, currentSessionId, isResume, currentCwd || currentProject?.path || undefined, permissionMode);
  };

  // --- 新規セッション開始 ---
  const handleNewSession = (newCwd?: string) => {
    const newId = generateUUID();
    setCurrentSessionId(newId);
    const targetCwd = newCwd || currentProject?.path || currentCwd;
    if (targetCwd) setCurrentCwd(targetCwd);
    setMessages([]);
  };

  // --- セッション削除 ---
  const handleDeleteSession = (id: string) => {
    try {
      localStorage.removeItem(`${MESSAGES_STORAGE_PREFIX}${id}`);
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      if (id === currentSessionId) {
        handleNewSession();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const activeSessionTitle =
    sessions.find((s) => s.id === currentSessionId)?.title ||
    messages.find((m) => m.role === 'user')?.content.slice(0, 25) ||
    '新規セッション';

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* ヘッダー */}
      <Header
        isHubConnected={isHubConnected}
        isAgentConnected={isAgentConnected}
        activeTransport={activeTransport}
        agentHostname={agentHostname}
        currentCwd={currentCwd}
        sessionTitle={activeSessionTitle}
        isExecuting={isExecuting}
        onOpenDrawer={() => setIsDrawerOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* メインチャットタイムライン */}
      <main
        ref={chatContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-4 space-y-2 select-text"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8 select-none">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 border border-slate-800 flex items-center justify-center mb-3">
              <Cpu className="w-8 h-8 text-sky-400" />
            </div>
            <h3 className="text-base font-semibold text-slate-200 mb-1">
              AI Remote Cockpit 準備完了
            </h3>
            <p className="text-xs text-slate-400 max-w-xs mb-4">
              社内PCの Claude Code をモバイルから安全に操作できます。指示を入力するか、下のクイックアクションをお試しください。
            </p>

            {!isAgentConnected && (
              <div className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-300 text-xs max-w-sm">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>社内PCの Bridge Agent がオフラインです。PC側の常駐プロセスを起動してください。</span>
              </div>
            )}
          </div>
        ) : (
          messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
        )}
      </main>

      {/* 電車内向けクイックアクションバー */}
      <QuickActions
        onSelectAction={(prompt) => handleSubmitPrompt(prompt)}
        disabled={isExecuting || !isAgentConnected}
      />

      {/* フッター（プロンプト入力 & 送信 / 中断） */}
      <footer className="safe-bottom bg-slate-900 border-t border-slate-800 p-2.5 shrink-0 select-none">
        {/* 権限モードの選択トグル */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 mb-2">
          <div className="flex items-center space-x-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-sky-400" />
            <span>Mode:</span>
            <select
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
              className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-200 outline-none"
            >
              <option value="acceptEdits">acceptEdits (編集自動承認)</option>
              <option value="bypassPermissions">bypassPermissions (全自動)</option>
              <option value="default">default (手動承認)</option>
            </select>
          </div>

          {currentCwd && (
            <div className="truncate max-w-[140px] font-mono text-[10px] text-slate-500">
              {currentCwd.split('/').pop()}
            </div>
          )}
        </div>

        {/* 入力フォーム */}
        <div className="flex items-end space-x-2">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmitPrompt();
              }
            }}
            placeholder={
              !isAgentConnected
                ? '社内PCがオフラインです...'
                : isExecuting
                ? 'Claude Code が実行中です...'
                : 'Claude Code への指示を入力 (Enterで送信)...'
            }
            disabled={!isAgentConnected && !isExecuting}
            rows={Math.min(4, Math.max(1, inputText.split('\n').length))}
            className="flex-1 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none resize-none transition-colors max-h-24 disabled:opacity-50"
          />

          {isExecuting ? (
            <button
              onClick={abort}
              className="p-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-950/50 active:scale-95 transition-all shrink-0"
              title="中断"
            >
              <Square className="w-5 h-5 fill-current" />
            </button>
          ) : (
            <button
              onClick={() => handleSubmitPrompt()}
              disabled={!inputText.trim() || !isAgentConnected}
              className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-950/50 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all shrink-0"
              title="送信"
            >
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>
      </footer>

      {/* セッション & プロジェクト履歴ドロワー */}
      <SessionDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        projects={projects}
        currentProject={currentProject}
        onSelectProject={handleSelectProject}
        onAddProject={handleAddProject}
        onRemoveProject={handleRemoveProject}
        availableProjects={availableProjects}
        projectsBaseDir={projectsBaseDir}
        onRequestScanProjects={requestProjects}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={(id) => setCurrentSessionId(id)}
        onNewSession={() => handleNewSession()}
        onDeleteSession={handleDeleteSession}
        isAgentConnected={isAgentConnected}
      />

      {/* 設定モーダル */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentSettings={settings}
        onSave={updateSettings}
      />
    </div>
  );
}

export default App;
