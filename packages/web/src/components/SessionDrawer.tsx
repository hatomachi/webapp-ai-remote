import React, { useState } from 'react';
import { X, Plus, FolderGit2, Trash2, MessageSquare, Clock, Check } from 'lucide-react';
import { SessionInfo } from '../types/protocol';

interface SessionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: SessionInfo[];
  currentSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: (cwd: string) => void;
  onDeleteSession: (id: string) => void;
  currentCwd: string;
  defaultCwd: string;
}

export const SessionDrawer: React.FC<SessionDrawerProps> = ({
  isOpen,
  onClose,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  currentCwd,
  defaultCwd,
}) => {
  const [customCwd, setCustomCwd] = useState(currentCwd || defaultCwd || '');
  const [isEditingCwd, setIsEditingCwd] = useState(false);

  if (!isOpen) return null;

  const handleStartNewSession = () => {
    onNewSession(customCwd);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* 背景オーバーレイ */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* ドロワーコンテンツ */}
      <div className="relative w-4/5 max-w-sm bg-slate-900 border-r border-slate-800 h-full flex flex-col z-10 shadow-2xl safe-top safe-bottom select-none">
        {/* ヘッダー */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <MessageSquare className="w-5 h-5 text-indigo-400" />
            <h2 className="font-bold text-sm text-slate-100">セッション & プロジェクト</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* CWD (作業ディレクトリ) 設定 */}
        <div className="p-3 bg-slate-950/60 border-b border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="flex items-center space-x-1">
              <FolderGit2 className="w-3.5 h-3.5 text-sky-400" />
              <span>作業ディレクトリ (CWD)</span>
            </span>
            <button
              onClick={() => setIsEditingCwd(!isEditingCwd)}
              className="text-[11px] text-sky-400 hover:underline"
            >
              {isEditingCwd ? '完了' : '変更'}
            </button>
          </div>

          {isEditingCwd ? (
            <input
              type="text"
              value={customCwd}
              onChange={(e) => setCustomCwd(e.target.value)}
              placeholder="/Users/username/work/project"
              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500 font-mono"
            />
          ) : (
            <div className="text-xs font-mono text-slate-300 truncate bg-slate-900/80 p-2 rounded border border-slate-800/80">
              {customCwd || defaultCwd || 'Default Working Directory'}
            </div>
          )}
        </div>

        {/* 新規セッションボタン */}
        <div className="p-3 border-b border-slate-800">
          <button
            onClick={handleStartNewSession}
            className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium shadow-md shadow-indigo-950/50 active:scale-[0.98] transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>新規セッションを開始</span>
          </button>
        </div>

        {/* セッション履歴リスト */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <div className="text-[11px] font-semibold text-slate-500 uppercase px-1">
            履歴 ({sessions.length})
          </div>

          {sessions.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">
              保存されたセッションはありません
            </div>
          ) : (
            sessions.map((session) => {
              const isActive = session.id === currentSessionId;
              const dateStr = new Date(session.updatedAt).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={session.id}
                  className={`group flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                    isActive
                      ? 'bg-indigo-950/40 border-indigo-500/50 text-indigo-200 shadow-sm'
                      : 'bg-slate-850/50 border-slate-800 hover:bg-slate-800/70 text-slate-300'
                  }`}
                  onClick={() => {
                    onSelectSession(session.id);
                    onClose();
                  }}
                >
                  <div className="min-w-0 flex-1 mr-2">
                    <div className="flex items-center space-x-1.5">
                      {isActive && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                      <span className="text-xs font-medium truncate">
                        {session.title || '無題のセッション'}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2 text-[10px] text-slate-500 mt-1">
                      <span className="flex items-center space-x-0.5">
                        <Clock className="w-3 h-3" />
                        <span>{dateStr}</span>
                      </span>
                      <span>•</span>
                      <span>{session.messageCount} 発言</span>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 opacity-80 hover:opacity-100 transition-colors"
                    title="セッション削除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
