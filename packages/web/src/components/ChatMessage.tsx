import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { AlertTriangle, Clock, DollarSign, Zap, Copy, Check } from 'lucide-react';
import { ChatMessage as ChatMessageType } from '../types/protocol';
import { ToolUseCard } from './ToolUseCard';

interface ChatMessageProps {
  message: ChatMessageType;
  onToolApprove?: (requestId: string) => void;
  onToolDeny?: (requestId: string) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  onToolApprove,
  onToolDeny,
}) => {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  const handleCopy = () => {
    if (!message.content) return;
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isSystem) {
    return (
      <div className="flex justify-center my-2 select-none">
        <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  // ユーザーメッセージ：全幅の角丸カード（Antigravity Mobile風）
  if (isUser) {
    return (
      <div className="w-full my-3">
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/80 px-3.5 py-3 shadow-sm">
          <div className="text-[15px] leading-[1.6] text-slate-100 whitespace-pre-wrap break-words">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  // アシスタント（AI）メッセージ：吹き出しなしの全幅フラット表示（Antigravity Mobile風）
  return (
    <div className="w-full my-3">
      {/* ツール呼び出し（Tool Uses）一覧 */}
      {message.toolUses && message.toolUses.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {message.toolUses.map((tool) => (
            <ToolUseCard
              key={tool.id}
              tool={tool}
              onApprove={onToolApprove}
              onDeny={onToolDeny}
            />
          ))}
        </div>
      )}

      {/* 本文マークダウン（モバイル最適化タイポグラフィ: 15px, leading-[1.6]） */}
      {(message.content || message.isStreaming) && (
        <div className="w-full text-slate-200">
          <ReactMarkdown
            components={{
              h1: ({ node, ...props }) => (
                <h1 className="text-[17px] font-bold text-slate-100 mt-3.5 mb-1.5 leading-snug" {...props} />
              ),
              h2: ({ node, ...props }) => (
                <h2 className="text-[16px] font-bold text-slate-100 mt-3 mb-1.5 leading-snug" {...props} />
              ),
              h3: ({ node, ...props }) => (
                <h3 className="text-[15px] font-semibold text-slate-200 mt-2.5 mb-1 leading-snug" {...props} />
              ),
              p: ({ node, ...props }) => (
                <p className="text-[15px] leading-[1.6] text-slate-200 my-1.5 break-words" {...props} />
              ),
              ul: ({ node, ...props }) => (
                <ul className="text-[15px] leading-[1.6] text-slate-200 my-1.5 pl-5 list-disc space-y-0.5" {...props} />
              ),
              ol: ({ node, ...props }) => (
                <ol className="text-[15px] leading-[1.6] text-slate-200 my-1.5 pl-5 list-decimal space-y-0.5" {...props} />
              ),
              li: ({ node, ...props }) => <li className="my-0.5" {...props} />,
              blockquote: ({ node, ...props }) => (
                <blockquote className="border-l-2 border-slate-600 pl-3 my-2 text-slate-400 italic text-[14px]" {...props} />
              ),
              code: ({ node, inline, className, children, ...props }: any) => {
                if (inline) {
                  return (
                    <code className="bg-slate-800/90 text-sky-300 px-1.5 py-0.5 rounded font-mono text-[13px] break-all border border-slate-700/50" {...props}>
                      {children}
                    </code>
                  );
                }
                return (
                  <code className="font-mono text-[12.5px] leading-relaxed block overflow-x-auto" {...props}>
                    {children}
                  </code>
                );
              },
              pre: ({ node, ...props }) => (
                <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 my-2 overflow-x-auto text-[12.5px]" {...props} />
              ),
              a: ({ node, ...props }) => (
                <a className="text-sky-400 underline hover:text-sky-300 transition-colors break-all" target="_blank" rel="noreferrer" {...props} />
              ),
              hr: ({ node, ...props }) => <hr className="border-slate-800 my-3" {...props} />,
            }}
          >
            {message.content || ''}
          </ReactMarkdown>

          {message.isStreaming && (
            <span className="inline-block w-1.5 h-3.5 ml-1 bg-sky-400 animate-pulse align-middle" />
          )}
        </div>
      )}

      {/* エラー表示 */}
      {message.isError && (
        <div className="mt-2 flex items-center space-x-1.5 text-xs text-rose-400 bg-rose-950/30 border border-rose-900/50 rounded-lg p-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>実行エラーが発生しました</span>
        </div>
      )}

      {/* フッターアクション & 統計メタ情報 */}
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 select-none">
        <div className="flex items-center space-x-3">
          {message.stats?.durationMs && (
            <span className="flex items-center space-x-1">
              <Clock className="w-3 h-3 text-slate-500" />
              <span>{(message.stats.durationMs / 1000).toFixed(1)}s</span>
            </span>
          )}
          {typeof message.stats?.costUsd === 'number' && (
            <span className="flex items-center space-x-1">
              <DollarSign className="w-3 h-3 text-emerald-500" />
              <span>${message.stats.costUsd.toFixed(4)}</span>
            </span>
          )}
          {message.stats?.subtype && (
            <span className="uppercase font-mono text-[10px] text-slate-500">
              {message.stats.subtype}
            </span>
          )}
        </div>

        {/* コピーボタン */}
        {message.content && !message.isStreaming && (
          <button
            onClick={handleCopy}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors flex items-center space-x-1"
            title="メッセージをコピー"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[10px] text-emerald-400">コピー完了</span>
              </>
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
};

