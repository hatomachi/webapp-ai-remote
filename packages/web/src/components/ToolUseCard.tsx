import React, { useState } from 'react';
import {
  Terminal,
  FileEdit,
  FileSearch,
  Eye,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Wrench,
  ShieldAlert,
  Check,
  X
} from 'lucide-react';
import { ToolUseItem } from '../types/protocol';

interface ToolUseCardProps {
  tool: ToolUseItem;
  onApprove?: (requestId: string) => void;
  onDeny?: (requestId: string) => void;
}

export const ToolUseCard: React.FC<ToolUseCardProps> = ({ tool, onApprove, onDeny }) => {
  const isPendingApproval = tool.approvalState === 'pending' && Boolean(tool.approvalRequestId);
  // 承認待ちの時はデフォルトで詳細も開いておく
  const [isOpen, setIsOpen] = useState(isPendingApproval);

  // ツールに応じたアイコンとカラーを決定
  const getToolMeta = (name: string) => {
    switch (name.toLowerCase()) {
      case 'bash':
        return {
          icon: <Terminal className="w-4 h-4 text-emerald-400" />,
          label: 'Bash Command',
          badgeColor: 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300',
        };
      case 'fileedit':
      case 'edit':
      case 'strreplace':
        return {
          icon: <FileEdit className="w-4 h-4 text-amber-400" />,
          label: 'File Edit',
          badgeColor: 'bg-amber-950/60 border-amber-800/80 text-amber-300',
        };
      case 'fileview':
      case 'view':
      case 'readfile':
        return {
          icon: <Eye className="w-4 h-4 text-sky-400" />,
          label: 'Read File',
          badgeColor: 'bg-sky-950/60 border-sky-800/80 text-sky-300',
        };
      case 'glob':
      case 'grep':
        return {
          icon: <FileSearch className="w-4 h-4 text-purple-400" />,
          label: 'Search Files',
          badgeColor: 'bg-purple-950/60 border-purple-800/80 text-purple-300',
        };
      default:
        return {
          icon: <Wrench className="w-4 h-4 text-slate-400" />,
          label: name,
          badgeColor: 'bg-slate-800 border-slate-700 text-slate-300',
        };
    }
  };

  const meta = getToolMeta(tool.name);

  // 入力パラメータから代表的な表示テキスト（コマンドやファイルパス）を取得
  const getSummary = () => {
    if (typeof tool.input === 'string') return tool.input;
    if (tool.input?.command) return tool.input.command;
    if (tool.input?.file_path) return tool.input.file_path;
    if (tool.input?.path) return tool.input.path;
    if (tool.input?.pattern) return tool.input.pattern;
    return JSON.stringify(tool.input);
  };

  const summaryText = getSummary();

  return (
    <div
      className={`my-2 rounded-xl border overflow-hidden text-xs w-full transition-all ${
        isPendingApproval
          ? 'border-amber-500/80 bg-amber-950/20 shadow-md shadow-amber-950/40'
          : 'border-slate-800/80 bg-slate-900/60 shadow-sm'
      }`}
    >
      {/* カードヘッダー */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors select-none ${
          isPendingApproval ? 'hover:bg-amber-950/40' : 'hover:bg-slate-800/50'
        }`}
      >
        <div className="flex items-center space-x-2 min-w-0 flex-1 mr-2">
          <div
            className={`p-1 rounded-md border shrink-0 ${
              isPendingApproval
                ? 'bg-amber-950/80 border-amber-700/80'
                : 'bg-slate-950 border-slate-800/80'
            }`}
          >
            {isPendingApproval ? (
              <ShieldAlert className="w-4 h-4 text-amber-400 animate-pulse" />
            ) : (
              meta.icon
            )}
          </div>
          <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-mono border shrink-0 ${meta.badgeColor}`}>
            {meta.label}
          </span>
          <span className="font-mono text-slate-300 truncate text-[12px] flex-1">
            {summaryText}
          </span>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          {isPendingApproval ? (
            <span className="flex items-center text-amber-400 text-[11px] space-x-1 font-semibold px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-700/80 animate-pulse">
              <span>承認待ち</span>
            </span>
          ) : tool.isRunning ? (
            <span className="flex items-center text-amber-400 text-[11px] space-x-1 font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>実行中</span>
            </span>
          ) : tool.isError ? (
            <AlertCircle className="w-4 h-4 text-rose-400" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          )}

          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          )}
        </div>
      </div>

      {/* アコーディオン詳細展開 */}
      {isOpen && (
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/70 space-y-2.5 text-[11.5px]">
          {/* Tool Input */}
          <div>
            <div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">
              Tool Input:
            </div>
            <pre className="text-slate-300 font-mono text-[11.5px] p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 overflow-x-auto max-h-48 leading-relaxed">
              {typeof tool.input === 'string'
                ? tool.input
                : JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>

          {/* Tool Output (あれば) */}
          {tool.output && (
            <div>
              <div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">
                Tool Output:
              </div>
              <pre className="text-slate-300 font-mono text-[11.5px] p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 overflow-x-auto max-h-56 whitespace-pre-wrap break-all leading-relaxed">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* 承認要求アクションバー (承認待ち時) */}
      {isPendingApproval && (
        <div className="px-3 py-2.5 bg-amber-950/40 border-t border-amber-900/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 select-none">
          <div className="flex items-center space-x-1.5 text-amber-300 text-[12px] font-medium">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <span>このツールの実行を許可しますか？</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (tool.approvalRequestId && onDeny) onDeny(tool.approvalRequestId);
              }}
              className="flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-800/80 text-[11.5px] font-medium transition-colors flex items-center justify-center space-x-1 active:scale-95"
            >
              <X className="w-3.5 h-3.5" />
              <span>拒否 (Deny)</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (tool.approvalRequestId && onApprove) onApprove(tool.approvalRequestId);
              }}
              className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11.5px] shadow-sm transition-colors flex items-center justify-center space-x-1 active:scale-95"
            >
              <Check className="w-3.5 h-3.5" />
              <span>許可する (Allow)</span>
            </button>
          </div>
        </div>
      )}

      {/* 許可済み / 拒否済みステータスフッター */}
      {tool.approvalState === 'allowed' && (
        <div className="px-3 py-1 bg-emerald-950/40 border-t border-emerald-900/50 text-[10.5px] text-emerald-400 flex items-center space-x-1">
          <Check className="w-3 h-3" />
          <span>ユーザーにより許可されました</span>
        </div>
      )}
      {tool.approvalState === 'denied' && (
        <div className="px-3 py-1 bg-rose-950/40 border-t border-rose-900/50 text-[10.5px] text-rose-400 flex items-center space-x-1">
          <X className="w-3 h-3" />
          <span>ユーザーにより拒否されました</span>
        </div>
      )}
    </div>
  );
};

