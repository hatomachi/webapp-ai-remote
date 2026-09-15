import React from 'react';
import { Settings, History, Terminal, Wifi, WifiOff } from 'lucide-react';

interface HeaderProps {
  isHubConnected: boolean;
  isAgentConnected: boolean;
  agentHostname: string;
  currentCwd: string;
  sessionTitle: string;
  isExecuting: boolean;
  onOpenDrawer: () => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isHubConnected,
  isAgentConnected,
  agentHostname,
  currentCwd,
  sessionTitle,
  isExecuting,
  onOpenDrawer,
  onOpenSettings,
}) => {
  // CWDから最後のディレクトリ名のみを抽出して短縮表示
  const shortCwd = currentCwd ? currentCwd.split('/').filter(Boolean).pop() || currentCwd : 'Default';

  return (
    <header className="safe-top bg-slate-900 border-b border-slate-800 px-3 py-2 flex items-center justify-between select-none shrink-0 z-10 shadow-sm">
      {/* 左: セッション履歴ボタン & アプリロゴ */}
      <div className="flex items-center space-x-2">
        <button
          onClick={onOpenDrawer}
          className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 active:scale-95 transition-all"
          title="セッション履歴"
        >
          <History className="w-5 h-5" />
        </button>
        <div>
          <div className="flex items-center space-x-1.5">
            <span className="font-bold text-sm tracking-tight bg-gradient-to-r from-sky-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
              AI Remote
            </span>
            {isExecuting && (
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-400 truncate max-w-[140px] xs:max-w-[180px]">
            {sessionTitle || '新規セッション'}
          </div>
        </div>
      </div>

      {/* 中央: プロジェクト名 & PCホスト名 */}
      <div
        onClick={onOpenDrawer}
        className="flex items-center space-x-1 text-xs text-slate-300 bg-slate-950/80 px-2.5 py-1 rounded-full border border-slate-800 hover:border-slate-700 active:scale-95 cursor-pointer transition-all"
        title="プロジェクト切り替え"
      >
        <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0" />
        <span className="font-semibold text-sky-200 truncate max-w-[120px] xs:max-w-[150px]">
          {shortCwd}
        </span>
        {agentHostname && (
          <>
            <span className="text-slate-600 hidden xs:inline">•</span>
            <span className="text-[10px] text-slate-400 hidden xs:inline truncate max-w-[70px]">
              {agentHostname}
            </span>
          </>
        )}
      </div>

      {/* 右: ステータスバッジ & 設定ボタン */}
      <div className="flex items-center space-x-2">
        {/* Hub & PC 状態 */}
        <div className="flex items-center space-x-1 text-[11px] px-2 py-1 rounded-md bg-slate-800/70 border border-slate-700/50">
          {/* Hub */}
          <span
            title={isHubConnected ? "Hub: 接続済み" : "Hub: 切断"}
            className="flex items-center"
          >
            {isHubConnected ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
            )}
          </span>

          <span className="text-slate-600">/</span>

          {/* Agent (PC) */}
          <span
            title={isAgentConnected ? `社内PC: オンライン (${agentHostname})` : "社内PC: オフライン"}
            className={`flex items-center font-medium ${
              isAgentConnected ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full mr-1 ${
                isAgentConnected ? "bg-emerald-400" : "bg-rose-500"
              }`}
            />
            {isAgentConnected ? "PC ON" : "PC OFF"}
          </span>
        </div>

        {/* 設定ボタン */}
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 active:scale-95 transition-all"
          title="設定"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};
