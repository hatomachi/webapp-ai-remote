import React from 'react';
import { GitBranch, FileCode, CheckSquare, MessageSquarePlus, Sparkles, Terminal } from 'lucide-react';

interface QuickActionsProps {
  onSelectAction: (promptText: string) => void;
  disabled?: boolean;
}

interface ActionItem {
  id: string;
  label: string;
  prompt: string;
  icon: React.ReactNode;
}

const ACTIONS: ActionItem[] = [
  {
    id: 'git-status',
    label: 'git status',
    prompt: 'git status を確認して現状を報告してください。',
    icon: <GitBranch className="w-3.5 h-3.5 text-emerald-400" />,
  },
  {
    id: 'git-diff',
    label: 'git diff (直前の変更)',
    prompt: 'git diff --stat および直前の変更内容の要約を教えてください。',
    icon: <FileCode className="w-3.5 h-3.5 text-sky-400" />,
  },
  {
    id: 'run-test',
    label: 'テスト実行',
    prompt: 'プロジェクトのテストを実行し、結果を報告してください。',
    icon: <CheckSquare className="w-3.5 h-3.5 text-purple-400" />,
  },
  {
    id: 'commit-msg',
    label: 'コミット作成',
    prompt: '現在の未コミット変更に対して、適切なコミットメッセージを提案またはコミットを作成してください。',
    icon: <MessageSquarePlus className="w-3.5 h-3.5 text-amber-400" />,
  },
  {
    id: 'check-error',
    label: 'エラー原因の調査',
    prompt: '直近のエラーやログを解析し、原因と対策を提示してください。',
    icon: <Sparkles className="w-3.5 h-3.5 text-rose-400" />,
  },
  {
    id: 'npm-build',
    label: 'ビルド検証',
    prompt: 'ビルドコマンドを実行し、エラーなくビルドが通るか確認してください。',
    icon: <Terminal className="w-3.5 h-3.5 text-indigo-400" />,
  },
];

export const QuickActions: React.FC<QuickActionsProps> = ({ onSelectAction, disabled }) => {
  return (
    <div className="flex items-center space-x-1.5 overflow-x-auto py-1 px-3 no-scrollbar select-none shrink-0 bg-slate-950/60 border-t border-slate-800/60">
      <span className="text-[10px] text-slate-500 uppercase font-semibold shrink-0 mr-1">
        Quick:
      </span>
      {ACTIONS.map((action) => (
        <button
          key={action.id}
          disabled={disabled}
          onClick={() => onSelectAction(action.prompt)}
          className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-300 text-xs whitespace-nowrap hover:bg-slate-800 hover:text-white active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all"
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
};
