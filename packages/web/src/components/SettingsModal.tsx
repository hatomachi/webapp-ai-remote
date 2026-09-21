import React, { useState } from 'react';
import { X, Save, RotateCcw, ShieldCheck, Server, Folder, Radio, RefreshCw } from 'lucide-react';
import { getDefaultSettings, SocketSettings } from '../hooks/useRemoteSocket';
import { TransportMode } from '../types/protocol';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSettings: SocketSettings;
  onSave: (settings: SocketSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  currentSettings,
  onSave,
}) => {
  const [hubUrl, setHubUrl] = useState(currentSettings.hubUrl);
  const [authToken, setAuthToken] = useState(currentSettings.authToken);
  const [defaultCwd, setDefaultCwd] = useState(currentSettings.defaultCwd);
  const [transportMode, setTransportMode] = useState<TransportMode>(
    currentSettings.transportMode || 'auto'
  );
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [clearStatus, setClearStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      hubUrl: hubUrl.trim(),
      authToken: authToken.trim(),
      defaultCwd: defaultCwd.trim(),
      transportMode,
    });
    onClose();
  };

  const handleReset = () => {
    const def = getDefaultSettings();
    setHubUrl(def.hubUrl);
    setAuthToken(def.authToken);
    setDefaultCwd(def.defaultCwd);
    setTransportMode(def.transportMode || 'auto');
  };

  const handleClearCache = async () => {
    if (isClearingCache) return;
    setIsClearingCache(true);
    setClearStatus('キャッシュとService Workerを削除中...');

    try {
      // 1. Service Worker の登録解除
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }

      // 2. CacheStorage の完全消去
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const key of keys) {
          await caches.delete(key);
        }
      }

      setClearStatus('キャッシュ削除完了。最新版を再読み込みします...');
      setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set('_t', Date.now().toString());
        window.location.href = url.toString();
      }, 500);
    } catch (err: any) {
      console.error('Failed to clear cache:', err);
      setClearStatus('再読み込み中...');
      setTimeout(() => {
        window.location.reload();
      }, 500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景オーバーレイ */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* モーダル本体 */}
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 z-10 select-none text-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center space-x-2">
            <Server className="w-5 h-5 text-sky-400" />
            <h2 className="font-bold text-base text-slate-100">接続設定</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 text-xs">
          {/* Hub URL */}
          <div>
            <label className="block text-slate-400 font-medium mb-1 flex items-center space-x-1">
              <Server className="w-3.5 h-3.5 text-slate-400" />
              <span>Hub WebSocket URL</span>
            </label>
            <input
              type="text"
              value={hubUrl}
              onChange={(e) => setHubUrl(e.target.value)}
              placeholder="ws://localhost:8090/ws/client"
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono outline-none focus:border-sky-500 transition-colors"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              社内EC2 (Nginx) の WebSocket エンドポイント（/ws/client）を指定
            </p>
          </div>

          {/* 認証トークン */}
          <div>
            <label className="block text-slate-400 font-medium mb-1 flex items-center space-x-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>セッショントークン (Session Token)</span>
            </label>
            <input
              type="text"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="会社PC起動時に表示されたUUID"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono outline-none focus:border-emerald-500 transition-colors"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              会社PCの起動ログに表示されたUUIDを入力するか、表示されたURLをスマホで開くと自動入力されます
            </p>
          </div>

          {/* デフォルト CWD */}
          <div>
            <label className="block text-slate-400 font-medium mb-1 flex items-center space-x-1">
              <Folder className="w-3.5 h-3.5 text-amber-400" />
              <span>デフォルト作業ディレクトリ (任意)</span>
            </label>
            <input
              type="text"
              value={defaultCwd}
              onChange={(e) => setDefaultCwd(e.target.value)}
              placeholder="/path/to/work/... or C:\work\..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono outline-none focus:border-amber-500 transition-colors"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              空欄の場合は社内PC常駐 Agent の起動時ディレクトリが使用されます
            </p>
          </div>

          {/* 通信プロトコル */}
          <div>
            <label className="block text-slate-400 font-medium mb-1.5 flex items-center space-x-1">
              <Radio className="w-3.5 h-3.5 text-sky-400" />
              <span>通信プロトコル (Transport Mode)</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'auto', label: '自動 (推奨)', desc: 'WS ➔ HTTPフォールバック' },
                { id: 'http', label: 'HTTP (SSE)', desc: '社内プロキシ・ALB向け' },
                { id: 'ws', label: 'WebSocket', desc: '高速・常時双方向接続' },
              ].map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setTransportMode(mode.id as TransportMode)}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    transportMode === mode.id
                      ? 'bg-sky-500/15 border-sky-500 text-sky-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="font-semibold text-[11px] leading-tight">{mode.label}</div>
                  <div className="text-[9px] text-slate-500 mt-0.5 leading-tight">{mode.desc}</div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              社内プロキシや ZTNA で WebSocket が遮断されるスマホ（Edge等）では「自動」または「HTTP」をお選びください
            </p>
          </div>

          {/* ボタングループ */}
          <div className="pt-3.5 flex items-center justify-between gap-2 border-t border-slate-800">
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center space-x-1 px-2.5 py-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 text-xs transition-colors shrink-0"
              title="初期値に戻す"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>初期値に戻す</span>
            </button>

            <button
              type="button"
              onClick={handleClearCache}
              disabled={isClearingCache}
              className="flex items-center space-x-1 px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/40 border border-slate-700 hover:border-rose-500/50 text-rose-300 text-xs font-medium transition-all active:scale-95 disabled:opacity-50 shrink-0"
              title="Service WorkerとPWAキャッシュを全消去して最新版を再読み込み"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isClearingCache ? 'animate-spin' : ''}`} />
              <span>{isClearingCache ? '更新中...' : 'キャッシュ更新'}</span>
            </button>

            <button
              type="submit"
              className="flex items-center space-x-1 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium shadow-md shadow-sky-950/50 active:scale-95 transition-all shrink-0"
            >
              <Save className="w-3.5 h-3.5" />
              <span>保存して再接続</span>
            </button>
          </div>

          {clearStatus && (
            <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-800/40 text-rose-200 text-[10px] text-center font-mono animate-pulse">
              {clearStatus}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
