import React, { useState } from 'react';
import { X, Save, RotateCcw, ShieldCheck, Server, Folder, Radio, RefreshCw, Cpu, Plus, Trash2, ArrowUp } from 'lucide-react';
import { getDefaultSettings, SocketSettings, DEFAULT_AVAILABLE_MODELS } from '../hooks/useRemoteSocket';
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
  const [models, setModels] = useState<string[]>(
    currentSettings.availableModels && currentSettings.availableModels.length > 0
      ? currentSettings.availableModels
      : [...DEFAULT_AVAILABLE_MODELS]
  );
  const [newModel, setNewModel] = useState('');
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [clearStatus, setClearStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAddModel = () => {
    const trimmed = newModel.trim();
    if (!trimmed) return;
    if (models.includes(trimmed)) {
      setNewModel('');
      return;
    }
    setModels((prev) => [...prev, trimmed]);
    setNewModel('');
  };

  const handleRemoveModel = (index: number) => {
    setModels((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMoveToTop = (index: number) => {
    if (index === 0) return;
    setModels((prev) => {
      const target = prev[index];
      const rest = prev.filter((_, i) => i !== index);
      return [target, ...rest];
    });
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      hubUrl: hubUrl.trim(),
      authToken: authToken.trim(),
      defaultCwd: defaultCwd.trim(),
      transportMode,
      availableModels: models.length > 0 ? models : [...DEFAULT_AVAILABLE_MODELS],
    });
    onClose();
  };

  const handleReset = () => {
    const def = getDefaultSettings();
    setHubUrl(def.hubUrl);
    setAuthToken(def.authToken);
    setDefaultCwd(def.defaultCwd);
    setTransportMode(def.transportMode || 'auto');
    setModels([...DEFAULT_AVAILABLE_MODELS]);
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
      <div className="relative w-full max-w-md max-h-[90vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 z-10 select-none text-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4 shrink-0">
          <div className="flex items-center space-x-2">
            <Server className="w-5 h-5 text-sky-400" />
            <h2 className="font-bold text-base text-slate-100">接続・動作設定</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 text-xs overflow-y-auto pr-1 flex-1">
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

          {/* 利用可能モデル管理 */}
          <div>
            <label className="block text-slate-400 font-medium mb-1.5 flex items-center justify-between">
              <div className="flex items-center space-x-1">
                <Cpu className="w-3.5 h-3.5 text-purple-400" />
                <span>利用可能モデル (先頭がデフォルト)</span>
              </div>
              <span className="text-[10px] text-slate-500 font-normal">
                社内Bedrock制約対応
              </span>
            </label>

            {/* 新規モデル追加インプット */}
            <div className="flex items-center space-x-1.5 mb-2">
              <input
                type="text"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddModel();
                  }
                }}
                placeholder="例: claude-opus-4-7"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs outline-none focus:border-purple-500 transition-colors"
              />
              <button
                type="button"
                onClick={handleAddModel}
                disabled={!newModel.trim()}
                className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium disabled:opacity-40 disabled:pointer-events-none transition-all shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>追加</span>
              </button>
            </div>

            {/* 登録済みモデル一覧リスト */}
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
              {models.map((modelName, index) => {
                const isDefault = index === 0;
                return (
                  <div
                    key={modelName}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs ${
                      isDefault
                        ? 'bg-purple-950/30 border-purple-800/60 text-purple-200'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate min-w-0">
                      <span className="font-mono truncate">{modelName}</span>
                      {isDefault && (
                        <span className="text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/40 px-1.5 py-0.5 rounded font-medium shrink-0">
                          デフォルト
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-1 shrink-0 ml-2">
                      {!isDefault && (
                        <button
                          type="button"
                          onClick={() => handleMoveToTop(index)}
                          className="flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[10px] text-slate-400 hover:text-purple-300 hover:bg-purple-950/50 transition-colors"
                          title="先頭に移動してデフォルトにする"
                        >
                          <ArrowUp className="w-3 h-3" />
                          <span>先頭へ</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveModel(index)}
                        disabled={models.length <= 1}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                        title="削除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              チャット画面のプルダウンに反映されます。社内Bedrockで許可されているモデル名を登録してください。
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
