import React, { useState, useEffect } from 'react';
import {
  X,
  Save,
  RotateCcw,
  ShieldCheck,
  Server,
  Folder,
  Radio,
  RefreshCw,
  Cpu,
  Plus,
  Trash2,
  ArrowUp,
  Type,
  User,
  Mail,
  Key,
  Eye,
  EyeOff,
  Lock,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Shield,
} from 'lucide-react';
import { getDefaultSettings, SocketSettings, DEFAULT_AVAILABLE_MODELS } from '../hooks/useRemoteSocket';
import { TransportMode, UserCredentials } from '../types/protocol';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSettings: SocketSettings;
  onSave: (settings: SocketSettings) => void;
  onResetMyWorkspace?: (userName: string) => void;
  onVerifyCredentials?: (credentials: UserCredentials) => void;
  authStatus?: {
    verified: boolean;
    user?: {
      username: string;
      rawUsername: string;
      email?: string;
      name?: string;
      provider: 'gitlab' | 'github' | 'anonymous';
    };
    error?: string;
  } | null;
  fontSize?: number;
  onChangeFontSize?: (size: number) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  currentSettings,
  onSave,
  onResetMyWorkspace,
  onVerifyCredentials,
  authStatus,
  fontSize = 15,
  onChangeFontSize,
}) => {
  const [hubUrl, setHubUrl] = useState(currentSettings.hubUrl);
  const [authToken, setAuthToken] = useState(currentSettings.authToken);
  const [adminToken, setAdminToken] = useState(currentSettings.adminToken || '');
  const [defaultCwd, setDefaultCwd] = useState(currentSettings.defaultCwd);
  const [transportMode, setTransportMode] = useState<TransportMode>(
    currentSettings.transportMode || 'auto'
  );
  const [models, setModels] = useState<string[]>(
    currentSettings.availableModels && currentSettings.availableModels.length > 0
      ? currentSettings.availableModels
      : [...DEFAULT_AVAILABLE_MODELS]
  );
  const [selectedFontSize, setSelectedFontSize] = useState<number>(fontSize);
  const [newModel, setNewModel] = useState('');
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [clearStatus, setClearStatus] = useState<string | null>(null);

  // --- 個人プロファイル ＆ 認証トークン (Phase 3: 共有EC2マルチテナント) ---
  const [userName, setUserName] = useState(currentSettings.userCredentials?.userName || '');
  const [userEmail, setUserEmail] = useState(currentSettings.userCredentials?.userEmail || '');
  const [copilotToken, setCopilotToken] = useState(currentSettings.userCredentials?.copilotToken || '');
  const [claudeApiKey, setClaudeApiKey] = useState(currentSettings.userCredentials?.claudeApiKey || '');
  const [gitlabToken, setGitlabToken] = useState(currentSettings.userCredentials?.gitlabToken || '');
  const [showTokens, setShowTokens] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // --- Phase 5-2: 管理者設定アコーディオン & ワークスペース自己初期化 ---
  const [isAdminAccordionOpen, setIsAdminAccordionOpen] = useState(Boolean(currentSettings.adminToken));
  const [isConfirmingResetWorkspace, setIsConfirmingResetWorkspace] = useState(false);

  useEffect(() => {
    setSelectedFontSize(fontSize);
  }, [fontSize]);

  // トークン検証結果が届いたらユーザー名・メールアドレスを自動補完
  useEffect(() => {
    if (authStatus) {
      setIsVerifying(false);
      if (authStatus.verified && authStatus.user) {
        if (authStatus.user.username) {
          setUserName(authStatus.user.username);
        }
        if (authStatus.user.email && !userEmail) {
          setUserEmail(authStatus.user.email);
        }
      }
    }
  }, [authStatus]);

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
      adminToken: adminToken.trim(),
      defaultCwd: defaultCwd.trim(),
      transportMode,
      availableModels: models.length > 0 ? models : [...DEFAULT_AVAILABLE_MODELS],
      userCredentials: {
        userName: userName.trim(),
        userEmail: userEmail.trim(),
        copilotToken: copilotToken.trim(),
        claudeApiKey: claudeApiKey.trim(),
        gitlabToken: gitlabToken.trim(),
      },
    });
    onClose();
  };

  const handleReset = () => {
    const def = getDefaultSettings();
    setHubUrl(def.hubUrl);
    setAuthToken(def.authToken);
    setAdminToken('');
    setDefaultCwd(def.defaultCwd);
    setTransportMode(def.transportMode || 'auto');
    setModels([...DEFAULT_AVAILABLE_MODELS]);
    setSelectedFontSize(15);
    onChangeFontSize?.(15);
    setUserName('');
    setUserEmail('');
    setCopilotToken('');
    setClaudeApiKey('');
    setGitlabToken('');
    setIsAdminAccordionOpen(false);
    setIsConfirmingResetWorkspace(false);
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

          {/* 個人プロファイル ＆ 認証情報 (共有EC2マルチテナント) */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/80">
              <div className="flex items-center space-x-1.5">
                <User className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold text-slate-200 text-xs">個人プロファイル ＆ 認証情報</span>
              </div>
              <button
                type="button"
                onClick={() => setShowTokens(!showTokens)}
                className="flex items-center space-x-1 text-[10px] text-slate-400 hover:text-emerald-300 transition-colors"
                title={showTokens ? 'トークンを伏字にする' : 'トークンを表示する'}
              >
                {showTokens ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showTokens ? '伏字にする' : '表示する'}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* メンバー名 */}
              <div>
                <label className="block text-slate-400 font-medium mb-1 flex items-center space-x-1">
                  <User className="w-3 h-3 text-emerald-400" />
                  <span>メンバー名</span>
                  {authStatus?.verified && authStatus.user && (
                    <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1 py-0.2 rounded font-mono">
                      認証済
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="例: taro-tanaka (PATから自動判定)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              {/* メールアドレス */}
              <div>
                <label className="block text-slate-400 font-medium mb-1 flex items-center space-x-1">
                  <Mail className="w-3 h-3 text-emerald-400" />
                  <span>メールアドレス</span>
                </label>
                <input
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="例: user@internal"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>

            {/* GitHub PAT / Copilot Token */}
            <div>
              <label className="block text-slate-400 font-medium mb-1 flex items-center space-x-1">
                <Key className="w-3 h-3 text-sky-400" />
                <span>GitHub / Copilot Token (GH_TOKEN)</span>
              </label>
              <input
                type={showTokens ? 'text' : 'password'}
                value={copilotToken}
                onChange={(e) => setCopilotToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs outline-none focus:border-sky-500 transition-colors"
              />
            </div>

            {/* Claude API Key */}
            <div>
              <label className="block text-slate-400 font-medium mb-1 flex items-center space-x-1">
                <Lock className="w-3 h-3 text-purple-400" />
                <span>Claude API Key (ANTHROPIC_API_KEY)</span>
              </label>
              <input
                type={showTokens ? 'text' : 'password'}
                value={claudeApiKey}
                onChange={(e) => setClaudeApiKey(e.target.value)}
                placeholder="sk-ant-xxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs outline-none focus:border-purple-500 transition-colors"
              />
            </div>

            {/* GitLab Private Token */}
            <div>
              <label className="block text-slate-400 font-medium mb-1 flex items-center space-x-1">
                <Key className="w-3 h-3 text-amber-400" />
                <span>GitLab Private Token (メインGitLab・個人認証兼用)</span>
              </label>
              <input
                type={showTokens ? 'text' : 'password'}
                value={gitlabToken}
                onChange={(e) => setGitlabToken(e.target.value)}
                placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs outline-none focus:border-amber-500 transition-colors"
              />
            </div>

            {/* トークン検証ボタン & 認証結果インライン表示 */}
            {onVerifyCredentials && (gitlabToken.trim() || copilotToken.trim()) && (
              <div className="flex items-center justify-between pt-1 pb-1">
                <button
                  type="button"
                  disabled={isVerifying}
                  onClick={() => {
                    setIsVerifying(true);
                    onVerifyCredentials({
                      gitlabToken: gitlabToken.trim(),
                      copilotToken: copilotToken.trim(),
                      userName: userName.trim(),
                      userEmail: userEmail.trim(),
                    });
                  }}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 text-[11px] font-medium transition-colors flex items-center space-x-1 disabled:opacity-50"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                  <span>{isVerifying ? '検証中...' : 'トークンを検証 ＆ メンバー名取得'}</span>
                </button>

                {authStatus && (
                  <span className={`text-[10px] ${authStatus.verified ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {authStatus.verified
                      ? `✓ 認証成功 (${authStatus.user?.username})`
                      : `✕ 失敗: ${authStatus.error || '無効なトークン'}`}
                  </span>
                )}
              </div>
            )}

            <div className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-800/40 text-[10px] text-emerald-300 leading-relaxed">
              🛡️ <strong>安全保護</strong>: トークンや名義はEC2上に一切保存されず、あなたのスマホ（localStorage）にのみ安全に保存されます。メインGitLabのPATで正規の身元を自動確定し、プロンプト実行時にのみ一時プロセス環境変数へ注入されます。
            </div>

            {/* ワークスペース自己初期化 (Git Worktree リセット) */}
            {onResetMyWorkspace && userName.trim() && (
              <div className="pt-2 border-t border-slate-800/80">
                {!isConfirmingResetWorkspace ? (
                  <button
                    type="button"
                    onClick={() => setIsConfirmingResetWorkspace(true)}
                    className="w-full flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-rose-950/30 border border-slate-800 hover:border-rose-800/50 text-slate-400 hover:text-rose-300 text-xs transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>マイスペースを初期化 (Worktree リセット)</span>
                  </button>
                ) : (
                  <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 space-y-2">
                    <div className="flex items-start space-x-1.5 text-rose-200 text-xs">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div className="leading-tight">
                        <strong className="block text-rose-300 mb-0.5">ワークスペース初期化の確認</strong>
                        <span>
                          <code>{userName.trim()}</code> の作業領域をクリーンアップし、大元から worktree を再生成します。個人ブランチの未コミット作業は失われます。
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-end space-x-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsConfirmingResetWorkspace(false)}
                        className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onResetMyWorkspace(userName.trim());
                          setIsConfirmingResetWorkspace(false);
                          onClose();
                        }}
                        className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs shadow transition-colors"
                      >
                        初期化を実行する
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 管理者設定 (Admin Token) アコーディオン */}
          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
            <button
              type="button"
              onClick={() => setIsAdminAccordionOpen(!isAdminAccordionOpen)}
              className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-900/60 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <Shield className="w-4 h-4 text-sky-400" />
                <span className="font-semibold text-slate-200 text-xs">管理者設定 (Admin Token)</span>
                {adminToken.trim() ? (
                  <span className="text-[9px] bg-sky-500/20 text-sky-300 border border-sky-500/40 px-1.5 py-0.5 rounded font-mono">
                    設定済み
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500 font-normal">任意</span>
                )}
              </div>
              {isAdminAccordionOpen ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {isAdminAccordionOpen && (
              <div className="p-3 pt-0 border-t border-slate-800/60 space-y-2 mt-2">
                <div>
                  <label className="block text-slate-400 font-medium mb-1 flex items-center space-x-1">
                    <Key className="w-3 h-3 text-sky-400" />
                    <span>管理者トークン (ADMIN_TOKEN)</span>
                  </label>
                  <input
                    type={showTokens ? 'text' : 'password'}
                    value={adminToken}
                    onChange={(e) => setAdminToken(e.target.value)}
                    placeholder="EC2側 .env で設定した ADMIN_TOKEN"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs outline-none focus:border-sky-500 transition-colors"
                  />
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  管理者トークンを設定すると、ヘッダーに「共有EC2マルチテナント管理」ボタンが表示され、大元リポジトリのcloneや全メンバーの利用状況一覧・強制クリーンアップが可能になります。
                </p>
              </div>
            )}
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

          {/* 表示文字サイズ */}
          <div>
            <label className="block text-slate-400 font-medium mb-1.5 flex items-center justify-between">
              <div className="flex items-center space-x-1">
                <Type className="w-3.5 h-3.5 text-sky-400" />
                <span>表示文字サイズ (一括スケーリング)</span>
              </div>
              <span className="text-[10px] text-slate-500 font-normal">
                画面の文字密度を調整
              </span>
            </label>
            <select
              value={selectedFontSize}
              onChange={(e) => {
                const val = Number(e.target.value);
                setSelectedFontSize(val);
                onChangeFontSize?.(val);
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono outline-none focus:border-sky-500 transition-colors"
            >
              <option value={12}>12px (極小 - 画面に最大密度で表示)</option>
              <option value={13}>13px (小 - 情報量重視)</option>
              <option value={14}>14px (やや小 - バランス)</option>
              <option value={15}>15px (標準 / デフォルト)</option>
              <option value={16}>16px (やや大)</option>
              <option value={17}>17px (大)</option>
              <option value={18}>18px (特大 - 視認性重視)</option>
            </select>
            <p className="text-[10px] text-slate-500 mt-1">
              数値を小さくすると画面にたくさんの文字が表示されます。チャット画面下部のプルダウンからも即座に変更可能です。
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
