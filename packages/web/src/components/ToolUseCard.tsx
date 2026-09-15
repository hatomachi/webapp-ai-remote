import React, { useState } from 'react';
import { Terminal, FileEdit, FileSearch, Eye, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { ToolUseItem } from '../types/protocol';

interface ToolUseCardProps {
  tool: ToolUseItem;
}

export const ToolUseCard: React.FC<ToolUseCardProps> = ({ tool }) => {
  const [isOpen, setIsOpen] = useState(false);

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
    <div className="my-2 rounded-lg border border-slate-800 bg-slate-900/90 overflow-hidden text-xs shadow-sm">
      {/* カードヘッダー */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between p-2.5 cursor-pointer hover:bg-slate-850 transition-colors select-none"
      >
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <div className="p-1 rounded bg-slate-950 border border-slate-800">
            {meta.icon}
          </div>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${meta.badgeColor}`}>
            {meta.label}
          </span>
          <span className="font-mono text-slate-300 truncate max-w-[200px] xs:max-w-[260px]">
            {summaryText}
          </span>
        </div>

        <div className="flex items-center space-x-1.5 ml-2 shrink-0">
          {tool.isRunning ? (
            <span className="flex items-center text-amber-400 text-[11px] space-x-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="hidden xs:inline">実行中</span>
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
        <div className="p-2.5 border-t border-slate-800/80 bg-slate-950/80 space-y-2 text-[11px]">
          {/* Tool Input */}
          <div>
            <div className="text-[10px] uppercase font-semibold text-slate-500 mb-1">
              Tool Input:
            </div>
            <pre className="text-slate-300 font-mono text-[11px] p-2 rounded bg-slate-900 border border-slate-800 overflow-x-auto max-h-48">
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
              <pre className="text-slate-300 font-mono text-[11px] p-2 rounded bg-slate-900 border border-slate-800 overflow-x-auto max-h-56 whitespace-pre-wrap break-all">
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
