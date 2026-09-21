import React, { useState } from 'react';
import {
  X,
  Plus,
  FolderGit2,
  Trash2,
  Clock,
  Check,
  FolderPlus,
  GitBranch,
  RefreshCw,
  Folder,
} from 'lucide-react';
import { SessionInfo, ProjectInfo } from '../types/protocol';

interface SessionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectInfo[];
  currentProject: ProjectInfo | null;
  onSelectProject: (project: ProjectInfo) => void;
  onAddProject: (project: ProjectInfo) => void;
  onRemoveProject: (projectId: string) => void;
  availableProjects: ProjectInfo[];
  projectsBaseDir: string;
  onRequestScanProjects: () => void;
  sessions: SessionInfo[];
  currentSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onRefreshSessions?: () => void;
  isAgentConnected: boolean;
}

export const SessionDrawer: React.FC<SessionDrawerProps> = ({
  isOpen,
  onClose,
  projects,
  currentProject,
  onSelectProject,
  onAddProject,
  onRemoveProject,
  availableProjects,
  projectsBaseDir,
  onRequestScanProjects,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRefreshSessions,
  isAgentConnected,
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [customName, setCustomName] = useState('');

  if (!isOpen) return null;

  // カレントプロジェクトに紐づくセッションを抽出
  const filteredSessions = sessions.filter((s) => {
    if (!currentProject) return true;
    return s.projectId === currentProject.id || s.cwd === currentProject.path;
  });

  const handleSelectFromCandidate = (candidate: ProjectInfo) => {
    onAddProject(candidate);
    onSelectProject(candidate);
    setIsAddModalOpen(false);
  };

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPath.trim()) return;
    const name = customName.trim() || customPath.trim().split('/').filter(Boolean).pop() || 'Project';
    const newProj: ProjectInfo = {
      id: name,
      name,
      path: customPath.trim(),
    };
    onAddProject(newProj);
    onSelectProject(newProj);
    setCustomPath('');
    setCustomName('');
    setIsAddModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* 背景オーバーレイ */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* ドロワー本体 */}
      <div className="relative w-4/5 max-w-sm bg-slate-900 border-r border-slate-800 h-full flex flex-col z-10 shadow-2xl safe-top safe-bottom select-none">
        {/* ヘッダー */}
        <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FolderGit2 className="w-5 h-5 text-sky-400" />
            <h2 className="font-bold text-sm text-slate-100">プロジェクト & セッション</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 1. プロジェクト選択セクション */}
        <div className="p-3 bg-slate-950/70 border-b border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold uppercase text-[10px] tracking-wider text-slate-400">
              プロジェクト一覧 ({projects.length})
            </span>
            <button
              onClick={() => {
                onRequestScanProjects();
                setIsAddModalOpen(true);
              }}
              className="flex items-center space-x-1 text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>PCから追加</span>
            </button>
          </div>

          {/* 登録済みプロジェクトリスト */}
          <div className="flex space-x-2 overflow-x-auto py-1 no-scrollbar">
            {projects.map((proj) => {
              const isSelected = currentProject?.path === proj.path;
              return (
                <div
                  key={proj.path}
                  onClick={() => onSelectProject(proj)}
                  className={`group relative shrink-0 flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-sky-950/70 border-sky-500/80 text-sky-200 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850'
                  }`}
                >
                  {proj.isGit ? (
                    <GitBranch className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <Folder className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                  <span className="font-medium truncate max-w-[130px]">{proj.name}</span>

                  {projects.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveProject(proj.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-rose-400 transition-opacity ml-1"
                      title="プロジェクト登録解除"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* 選択中プロジェクトのフルパス表示 */}
          {currentProject && (
            <div className="text-[10px] font-mono text-slate-400 truncate px-1">
              📁 {currentProject.path}
            </div>
          )}
        </div>

        {/* 2. 新規セッション開始ボタン */}
        <div className="p-3 border-b border-slate-800">
          <button
            onClick={() => {
              onNewSession();
              onClose();
            }}
            className="w-full flex items-center justify-center space-x-2 py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md shadow-indigo-950/50 active:scale-[0.98] transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>このプロジェクトで新規セッション</span>
          </button>
        </div>

        {/* 3. セッション履歴一覧 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase px-1">
            <span>セッション履歴 ({filteredSessions.length})</span>
            {onRefreshSessions && (
              <button
                onClick={onRefreshSessions}
                disabled={!isAgentConnected}
                className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800 disabled:opacity-40 transition-colors"
                title="セッション一覧を再読み込み"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {filteredSessions.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">
              このプロジェクトのセッションはありません
            </div>
          ) : (
            filteredSessions.map((session) => {
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
                  onClick={() => {
                    onSelectSession(session.id);
                    onClose();
                  }}
                  className={`group flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                    isActive
                      ? 'bg-indigo-950/50 border-indigo-500/60 text-indigo-100 shadow-sm'
                      : 'bg-slate-850/50 border-slate-800/80 hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  <div className="min-w-0 flex-1 mr-2">
                    <div className="flex items-center space-x-1.5">
                      {isActive && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                      <span className="text-xs font-medium truncate">
                        {session.title || '無題のセッション'}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2 text-[10px] text-slate-400 mt-1">
                      <span className="flex items-center space-x-0.5">
                        <Clock className="w-3 h-3 text-slate-400" />
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
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
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

      {/* プロジェクト追加モーダル (社内PCフォルダ候補) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setIsAddModalOpen(false)}
          />

          <div className="relative w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-4 z-10 select-none text-slate-200 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-800 mb-3">
              <div className="flex items-center space-x-1.5">
                <FolderPlus className="w-4 h-4 text-sky-400" />
                <h3 className="font-bold text-sm text-slate-100">社内PCのフォルダを追加</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* PC候補一覧 */}
            <div className="flex-1 overflow-y-auto space-y-2 mb-3 pr-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>PC候補 ({projectsBaseDir || '~/work'})</span>
                <button
                  onClick={onRequestScanProjects}
                  className="flex items-center space-x-0.5 text-sky-400 hover:underline"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>再取得</span>
                </button>
              </div>

              {!isAgentConnected ? (
                <div className="text-center py-4 text-xs text-amber-400/80">
                  PCがオフラインのため候補を取得できません
                </div>
              ) : availableProjects.length === 0 ? (
                <div className="text-center py-4 text-xs text-slate-500">
                  候補フォルダの読み込み中...
                </div>
              ) : (
                availableProjects.map((p) => {
                  const isAlreadyAdded = projects.some((ep) => ep.path === p.path);
                  return (
                    <div
                      key={p.path}
                      onClick={() => handleSelectFromCandidate(p)}
                      className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer ${
                        isAlreadyAdded
                          ? 'bg-slate-900/50 border-slate-800/60 opacity-60'
                          : 'bg-slate-950 border-slate-800 hover:border-sky-500/60 hover:bg-slate-900'
                      }`}
                    >
                      <div className="min-w-0 flex-1 mr-2">
                        <div className="flex items-center space-x-1.5">
                          {p.isGit ? (
                            <GitBranch className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <Folder className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          )}
                          <span className="text-xs font-medium text-slate-200 truncate">
                            {p.name}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 truncate mt-0.5">
                          {p.path}
                        </div>
                      </div>

                      <span className="text-[10px] px-2 py-1 rounded bg-sky-950/80 text-sky-400 border border-sky-800/60 shrink-0">
                        {isAlreadyAdded ? '選択' : '追加'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* カスタム手動入力フォーム */}
            <form onSubmit={handleAddCustom} className="pt-2.5 border-t border-slate-800 space-y-2">
              <div className="text-[10px] font-semibold text-slate-400 uppercase">
                またはパスを直接入力:
              </div>
              <input
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="/path/to/my-project or C:\work\my-project"
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono outline-none focus:border-sky-500"
              />
              <button
                type="submit"
                className="w-full py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors"
              >
                手動パスで追加
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
