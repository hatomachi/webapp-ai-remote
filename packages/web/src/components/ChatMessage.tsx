import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Bot, User, AlertTriangle, Clock, DollarSign, Zap } from 'lucide-react';
import { ChatMessage as ChatMessageType } from '../types/protocol';
import { ToolUseCard } from './ToolUseCard';

interface ChatMessageProps {
  message: ChatMessageType;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center my-2 select-none">
        <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/60 text-[11px] text-slate-400">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex w-full my-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[92%] sm:max-w-[85%] ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start space-x-2`}>
        {/* アイコン */}
        <div
          className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs shadow-sm ${
            isUser
              ? 'bg-indigo-600 text-white ml-2'
              : 'bg-gradient-to-tr from-sky-600 to-indigo-600 text-white mr-2'
          }`}
        >
          {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
        </div>

        {/* メッセージ本体 */}
        <div className="min-w-0 flex-1">
          {/* 送信者名 & 時刻 */}
          <div
            className={`flex items-center space-x-1 text-[10px] text-slate-400 mb-1 px-1 select-none ${
              isUser ? 'justify-end' : 'justify-start'
            }`}
          >
            <span className="font-medium text-slate-300">
              {isUser ? 'You' : 'Claude Code'}
            </span>
            <span>•</span>
            <span>
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>

          {/* ツール呼び出し（Tool Uses）一覧 */}
          {message.toolUses && message.toolUses.length > 0 && (
            <div className="mb-2 space-y-1">
              {message.toolUses.map((tool) => (
                <ToolUseCard key={tool.id} tool={tool} />
              ))}
            </div>
          )}

          {/* テキストコンテンツ */}
          {(message.content || message.isStreaming) && (
            <div
              className={`p-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                isUser
                  ? 'bg-indigo-600 text-white rounded-tr-none'
                  : 'bg-slate-850 border border-slate-800 text-slate-100 rounded-tl-none'
              }`}
            >
              {isUser ? (
                <div className="whitespace-pre-wrap break-words">{message.content}</div>
              ) : (
                <div className="prose prose-invert prose-sm max-w-none break-words text-slate-100">
                  <ReactMarkdown>{message.content || ''}</ReactMarkdown>
                  {message.isStreaming && (
                    <span className="inline-block w-2 h-4 ml-1 bg-sky-400 animate-pulse align-middle" />
                  )}
                </div>
              )}
            </div>
          )}

          {/* エラー表示 */}
          {message.isError && (
            <div className="mt-1 flex items-center space-x-1 text-xs text-rose-400 px-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>実行エラーが発生しました</span>
            </div>
          )}

          {/* ターン完了のメタ情報 (Cost, Duration) */}
          {message.stats && (
            <div className="mt-1.5 flex items-center space-x-3 text-[10px] text-slate-400 px-1 select-none">
              {message.stats.durationMs && (
                <span className="flex items-center space-x-0.5">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span>{(message.stats.durationMs / 1000).toFixed(1)}s</span>
                </span>
              )}
              {typeof message.stats.costUsd === 'number' && (
                <span className="flex items-center space-x-0.5">
                  <DollarSign className="w-3 h-3 text-emerald-500" />
                  <span>${message.stats.costUsd.toFixed(4)}</span>
                </span>
              )}
              {message.stats.subtype && (
                <span className="text-slate-500 uppercase font-mono">
                  {message.stats.subtype}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
