import React, { useState, useEffect } from 'react';
import {
  X,
  Server,
  FolderGit2,
  Users,
  HardDrive,
  Download,
  Trash2,
  RefreshCw,
  GitBranch,
  Clock,
  CheckCircle2,
  AlertCircle,
  Key,
  Globe,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { AdminRepoItem, WorkspaceItem, DiskStats } from '../types/protocol';

interface AdminDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  baseRepos: AdminRepoItem[];
  workspaces: WorkspaceItem[];
  diskStats: DiskStats | null;
  isLoading: boolean;
  actionStatus: {
    type: 'clone' | 'cleanup';
    success: boolean;
    message: string;
    timestamp: number;
  } | null;
  onRequestBaseRepos: () => void;
  onRequestWorkspaces: () => void;
  onCloneBaseRepo: (repoUrl: string, deployToken?: string, deployUser?: string, name?: string) => void;
  onCleanupWorkspace: (userName: string) => void;
  isAgentConnected: boolean;
}

export const AdminDrawer: React.FC<AdminDrawerProps> = ({
  isOpen,
  onClose,
  baseRepos,
  workspaces,
  diskStats,
  isLoading,
  actionStatus,
  onRequestBaseRepos,
  onRequestWorkspaces,
  onCloneBaseRepo,
  onCleanupWorkspace,
  isAgentConnected,
}) => {
  const [activeTab, setActiveTab] = useState<'repos' | 'workspaces'>('repos');

  // Clone フォーム用ステート
  const [isCloneFormOpen, setIsCloneFormOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneDeployToken, setCloneDeployToken] = useState('');
  const [cloneDeployUser, setCloneDeployUser] = useState('deploy-token');
  const [cloneCustomName, setCloneCustomName] = useState('');

  // ワークスペース削除確認用
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<string | null>(null);

  // ドロワーを開いた時に最新情報を自動ロード
  useEffect(() => {
    if (isOpen && isAgentConnected) {
      onRequestBaseRepos();
      onRequestWorkspaces();
    }
  }, [isOpen, isAgentConnected, onRequestBaseRepos, onRequestWorkspaces]);

  if (!isOpen) return null;

  const handleCloneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneUrl.trim()) return;

    onCloneBaseRepo(
      cloneUrl.trim(),
      cloneDeployToken.trim() || undefined,
      cloneDeployUser.trim() || undefined,
      cloneCustomName.trim() || undefined
    );

    // フォームを閉じてリセット
    setCloneUrl('');
    setCloneDeployToken('');
    setCloneCustomName('');
    setIsCloneFormOpen(false);
  };

  const handleConfirmCleanup = (userName: string) => {
    onCleanupWorkspace(userName);
    setConfirmDeleteUser(null);
  };

  // バイト数を読みやすい形式に変換 (KB, MB, GB)
  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  // ディスク使用率
  const diskUsedPercent = diskStats && diskStats.totalBytes > 0
    ? Math.min(100, Math.round((diskStats.usedBytes / diskStats.totalBytes) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 背景オーバーレイ */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* ドロワー本体 */}
      <div className="relative w-full max-w-md bg-slate-900 border-l border-slate-800 h-full flex flex-col z-10 shadow-2xl safe-top safe-bottom select-none text-slate-200">
        {/* ヘッダー */}
        <div className="p-3.5 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-sky-500/20 border border-sky-500/40 flex items-center justify-center">
              <Server className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-100 flex items-center space-x-1.5">
                <span>共有EC2 マルチテナント管理</span>
              </h2>
              <p className="text-[10px] text-slate-400">大元リポジトリ ＆ メンバー利用状況</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* タブ切り替えバー */}
        <div className="flex bg-slate-950 p-1 border-b border-slate-800 text-xs shrink-0">
          <button
            onClick={() => setActiveTab('repos')}
            className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === 'repos'
                ? 'bg-slate-850 text-sky-300 shadow-sm border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5" />
            <span>大元リポジトリ ({baseRepos.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('workspaces')}
            className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === 'workspaces'
                ? 'bg-slate-850 text-purple-300 shadow-sm border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>メンバー ＆ ディスク ({workspaces.length})</span>
          </button>
        </div>

        {/* アクション結果バナー */}
        {actionStatus && (
          <div
            className={`px-3 py-2 text-xs flex items-center justify-between border-b shrink-0 animate-fadeIn ${
              actionStatus.success
                ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-200'
                : 'bg-rose-950/60 border-rose-800/80 text-rose-200'
            }`}
          >
            <div className="flex items-center space-x-1.5 min-w-0">
              {actionStatus.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span className="truncate">{actionStatus.message}</span>
            </div>
          </div>
        )}

        {/* オフライン警告 */}
        {!isAgentConnected && (
          <div className="p-3 bg-amber-950/40 border-b border-amber-800/60 text-amber-300 text-xs flex items-center space-x-2 shrink-0">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>EC2上の Agent がオフラインです。起動状態をご確認ください。</span>
          </div>
        )}

        {/* タブコンテンツ */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {activeTab === 'repos' ? (
            /* --- タブ①: 大元リポジトリ管理 --- */
            <div className="space-y-3">
              {/* コントロールヘッダー */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Base Repositories (/data/base-repos)
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={onRequestBaseRepos}
                    disabled={!isAgentConnected || isLoading}
                    className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800 disabled:opacity-40 transition-colors"
                    title="再取得"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => setIsCloneFormOpen(!isCloneFormOpen)}
                    disabled={!isAgentConnected}
                    className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium shadow-sm transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>+ 新規Clone</span>
                  </button>
                </div>
              </div>

              {/* 1クリック Clone 展開フォーム */}
              {isCloneFormOpen && (
                <form
                  onSubmit={handleCloneSubmit}
                  className="p-3 rounded-xl bg-slate-950 border border-sky-500/50 shadow-lg space-y-2.5 text-xs animate-fadeIn"
                >
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                    <span className="font-semibold text-sky-300 flex items-center space-x-1">
                      <Download className="w-3.5 h-3.5" />
                      <span>新規大元リポジトリのクローン</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsCloneFormOpen(false)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div>
                    <label className="block text-slate-400 font-medium mb-1 flex items-center space-x-1">
                      <Globe className="w-3 h-3 text-sky-400" />
                      <span>リポジトリ URL (必須)</span>
                    </label>
                    <input
                      type="text"
                      value={cloneUrl}
                      onChange={(e) => setCloneUrl(e.target.value)}
                      placeholder="https://gitlab.company.com/group/system-a.git"
                      required
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs outline-none focus:border-sky-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-400 font-medium mb-1 flex items-center space-x-1">
                        <Key className="w-3 h-3 text-amber-400" />
                        <span>Deploy Token (任意)</span>
                      </label>
                      <input
                        type="password"
                        value={cloneDeployToken}
                        onChange={(e) => setCloneDeployToken(e.target.value)}
                        placeholder="glpat-xxx or ghp-xxx"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 font-medium mb-1">
                        Deploy User (任意)
                      </label>
                      <input
                        type="text"
                        value={cloneDeployUser}
                        onChange={(e) => setCloneDeployUser(e.target.value)}
                        placeholder="deploy-token"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs outline-none focus:border-slate-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-400 font-medium mb-1">
                      カスタムフォルダ名 (任意 / 省略時はURLから自動抽出)
                    </label>
                    <input
                      type="text"
                      value={cloneCustomName}
                      onChange={(e) => setCloneCustomName(e.target.value)}
                      placeholder="例: system-a-iac"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs outline-none focus:border-slate-500"
                    />
                  </div>

                  <div className="pt-1 flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setIsCloneFormOpen(false)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
                    >
                      キャンセル
                    </button>
                    <button
                      type="submit"
                      disabled={isLoading || !cloneUrl.trim()}
                      className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium disabled:opacity-50 transition-colors flex items-center space-x-1"
                    >
                      {isLoading ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>クローン実行中...</span>
                        </>
                      ) : (
                        <span>クローン実行</span>
                      )}
                    </button>
                  </div>
                </form>
              )}

              {/* リポジトリ一覧 */}
              {baseRepos.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 rounded-xl border border-slate-800/80 bg-slate-950/40">
                  {isLoading ? 'リポジトリ一覧を取得中...' : '大元リポジトリはまだありません。上のボタンからCloneしてください。'}
                </div>
              ) : (
                <div className="space-y-2">
                  {baseRepos.map((repo) => (
                    <div
                      key={repo.name}
                      className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-slate-700 transition-all text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5 font-bold text-slate-100 min-w-0">
                          <FolderGit2 className="w-4 h-4 text-sky-400 shrink-0" />
                          <span className="truncate">{repo.name}</span>
                        </div>
                        <span className="font-mono text-[10px] text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 shrink-0">
                          {formatBytes(repo.sizeBytes)}
                        </span>
                      </div>

                      <div className="flex items-center space-x-3 text-[11px] text-slate-400">
                        <span className="flex items-center space-x-1">
                          <GitBranch className="w-3 h-3 text-emerald-400" />
                          <span className="font-mono text-emerald-300">{repo.branch}</span>
                        </span>
                        {repo.lastUpdated && (
                          <span className="flex items-center space-x-1 text-slate-500">
                            <Clock className="w-3 h-3" />
                            <span>{new Date(repo.lastUpdated).toLocaleDateString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          </span>
                        )}
                      </div>

                      {repo.lastCommit && (
                        <div className="text-[10px] font-mono text-slate-400 truncate bg-slate-900/60 p-1.5 rounded border border-slate-850">
                          {repo.lastCommit}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* --- タブ②: メンバー ＆ ディスク状況 --- */
            <div className="space-y-3">
              {/* ディスク容量カード */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between text-slate-300">
                  <div className="flex items-center space-x-1.5 font-semibold">
                    <HardDrive className="w-4 h-4 text-purple-400" />
                    <span>EC2 ディスク使用状況</span>
                  </div>
                  <span className="font-mono text-[11px] text-purple-300 font-bold">
                    {diskUsedPercent}% 使用中
                  </span>
                </div>

                {/* プログレスバー */}
                <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-500 ${
                      diskUsedPercent > 85 ? 'bg-rose-500' : diskUsedPercent > 70 ? 'bg-amber-500' : 'bg-purple-500'
                    }`}
                    style={{ width: `${diskUsedPercent}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>使用中: {diskStats ? formatBytes(diskStats.usedBytes) : '-'}</span>
                  <span>空き: {diskStats ? formatBytes(diskStats.freeBytes) : '-'}</span>
                  <span>総容量: {diskStats ? formatBytes(diskStats.totalBytes) : '-'}</span>
                </div>
              </div>

              {/* メンバー別ワークスペース一覧 */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Member Workspaces (/data/workspaces)
                </span>
                <button
                  onClick={onRequestWorkspaces}
                  disabled={!isAgentConnected || isLoading}
                  className="p-1 rounded text-slate-400 hover:text-purple-400 hover:bg-slate-800 disabled:opacity-40 transition-colors"
                  title="再取得"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {workspaces.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 rounded-xl border border-slate-800/80 bg-slate-950/40">
                  {isLoading ? 'ワークスペース一覧を取得中...' : '生成されたメンバーワークスペースはありません。メンバーが指示を送信すると自動生成されます。'}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {workspaces.map((ws) => (
                    <div
                      key={ws.userName}
                      className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5 font-bold text-slate-100 min-w-0">
                          <Users className="w-4 h-4 text-purple-400 shrink-0" />
                          <span className="truncate">{ws.userName}</span>
                        </div>

                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-[10px] text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                            {formatBytes(ws.sizeBytes)}
                          </span>

                          <button
                            onClick={() => setConfirmDeleteUser(ws.userName)}
                            className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                            title="ワークスペース削除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="text-[10px] text-slate-500 flex items-center space-x-1 font-mono">
                        <Clock className="w-3 h-3" />
                        <span>最終アクティブ: {new Date(ws.lastActive).toLocaleDateString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>

                      {/* Worktree リポジトリ一覧 */}
                      {ws.repos && ws.repos.length > 0 && (
                        <div className="pt-1 border-t border-slate-850 space-y-1">
                          <div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">
                            マウント中 Worktrees ({ws.repos.length})
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {ws.repos.map((r) => (
                              <span
                                key={r.name}
                                className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px]"
                              >
                                <GitBranch className="w-2.5 h-2.5 text-emerald-400" />
                                <span className="font-medium text-slate-200">{r.name}</span>
                                <span className="text-[9px] text-slate-400 font-mono">({r.branch})</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 削除確認インラインUI */}
                      {confirmDeleteUser === ws.userName && (
                        <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-200 text-xs space-y-1.5 animate-fadeIn">
                          <div className="flex items-center space-x-1.5 font-semibold text-rose-300">
                            <ShieldAlert className="w-4 h-4 shrink-0" />
                            <span>ワークスペース削除の確認</span>
                          </div>
                          <p className="text-[10px] text-rose-300/90 leading-relaxed">
                            メンバー「{ws.userName}」のワークスペースおよび関連する Git Worktree を安全に解除・削除します。よろしいですか？
                          </p>
                          <div className="flex justify-end space-x-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteUser(null)}
                              className="px-2 py-1 rounded bg-slate-800 text-slate-300 text-[10px]"
                            >
                              キャンセル
                            </button>
                            <button
                              type="button"
                              onClick={() => handleConfirmCleanup(ws.userName)}
                              className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-medium text-[10px] transition-colors"
                            >
                              削除を実行
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
