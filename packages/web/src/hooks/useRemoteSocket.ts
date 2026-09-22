import { useState, useEffect, useRef, useCallback } from 'react';
import {
  InboundMessage,
  OutboundMessage,
  SendPromptMessage,
  PermissionMode,
  ProjectInfo,
  TransportMode,
  ActiveTransport,
} from '../types/protocol';

export const DEFAULT_AVAILABLE_MODELS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];

export interface SocketSettings {
  hubUrl: string;
  authToken: string;
  defaultCwd: string;
  transportMode?: TransportMode;
  availableModels?: string[];
}

const SETTINGS_KEY = 'ai_remote_settings_v1';

export function getDefaultSettings(): SocketSettings {
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const proto = isHttps ? 'wss:' : 'ws:';
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost:8090';
  
  // 現在のURLからサブパス（例: /ai/ など）を自動検出
  let subpath = '';
  if (typeof window !== 'undefined') {
    const pathname = window.location.pathname;
    const lastSlashIdx = pathname.lastIndexOf('/');
    if (lastSlashIdx > 0) {
      subpath = pathname.substring(0, lastSlashIdx);
      if (subpath === '/') subpath = '';
    }
  }

  // Nginx等からサーブされる場合は自動判定されたサブパス + /ws/client
  // Vite開発サーバー (5173等) の場合は直接 Nginx 8090 に向ける
  let defaultHubUrl = `${proto}//${host}${subpath}/ws/client`;
  if (typeof window !== 'undefined' && window.location.port === '5173') {
    defaultHubUrl = `${proto}//${window.location.hostname}:8090/ws/client`;
  }

  return {
    hubUrl: defaultHubUrl,
    authToken: '',
    defaultCwd: '',
    transportMode: 'auto',
    availableModels: [...DEFAULT_AVAILABLE_MODELS],
  };
}

/**
 * Hub の WebSocket URL から HTTP (SSE / API) URL を自動算出
 */
export function deriveHttpUrls(hubWsUrl: string, authToken: string) {
  try {
    const parsed = new URL(hubWsUrl);
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';

    let basePath = parsed.pathname;
    if (basePath.endsWith('/ws/client')) {
      basePath = basePath.substring(0, basePath.length - '/ws/client'.length);
    }
    if (basePath.endsWith('/')) {
      basePath = basePath.substring(0, basePath.length - 1);
    }

    const eventsUrl = new URL(parsed.toString());
    eventsUrl.pathname = `${basePath}/events`;
    if (authToken) eventsUrl.searchParams.set('token', authToken);

    const messageUrl = new URL(parsed.toString());
    messageUrl.pathname = `${basePath}/message`;
    if (authToken) messageUrl.searchParams.set('token', authToken);

    return {
      eventsUrl: eventsUrl.toString(),
      messageUrl: messageUrl.toString(),
    };
  } catch {
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const base = `${isHttps ? 'https:' : 'http:'}//${typeof window !== 'undefined' ? window.location.host : 'localhost:8090'}`;
    const tokenQuery = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
    return {
      eventsUrl: `${base}/events${tokenQuery}`,
      messageUrl: `${base}/message${tokenQuery}`,
    };
  }
}

export function loadSettings(): SocketSettings {
  let initial = getDefaultSettings();
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      initial = { ...initial, ...JSON.parse(saved) };
    }
    if (!initial.availableModels || !Array.isArray(initial.availableModels) || initial.availableModels.length === 0) {
      initial.availableModels = [...DEFAULT_AVAILABLE_MODELS];
    }
  } catch (e) {
    console.error('Failed to parse settings from localStorage', e);
  }

  // URL クエリパラメータ (?token=xxxx) が付与されている場合は最優先で自動ロード＆保存
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get('token');
      if (urlToken && urlToken.trim()) {
        initial.authToken = urlToken.trim();
        saveSettingsToStorage(initial);

        // URL をクリーンアップ (?token= を取り除く)
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    } catch {
      // ignore
    }
  }

  return initial;
}

export function saveSettingsToStorage(settings: SocketSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function useRemoteSocket(onMessage: (msg: InboundMessage) => void) {
  const [settings, setSettings] = useState<SocketSettings>(loadSettings);
  const [isHubConnected, setIsHubConnected] = useState<boolean>(false);
  const [isAgentConnected, setIsAgentConnected] = useState<boolean>(false);
  const [agentHostname, setAgentHostname] = useState<string>('');
  const [agentCwd, setAgentCwd] = useState<string>('');
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [availableProjects, setAvailableProjects] = useState<ProjectInfo[]>([]);
  const [projectsBaseDir, setProjectsBaseDir] = useState<string>('');
  const [activeTransport, setActiveTransport] = useState<ActiveTransport>('none');

  const wsRef = useRef<WebSocket | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<any>(null);
  const fallbackTimerRef = useRef<any>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // メッセージ解析と共通ステート更新
  const handleInbound = useCallback((msg: InboundMessage, sendFn: (out: OutboundMessage) => void) => {
    if (msg.type === 'status') {
      setIsAgentConnected(msg.agentConnected);
      if (!msg.agentConnected) {
        setIsExecuting(false);
      }
    } else if (msg.type === 'agent_hello') {
      setIsAgentConnected(true);
      setAgentHostname(msg.hostname);
      setAgentCwd(msg.defaultCwd);
      sendFn({ type: 'list_projects' });
    } else if (msg.type === 'agent_status') {
      setIsAgentConnected(true);
      setAgentHostname(msg.hostname);
      setAgentCwd(msg.cwd);
      setIsExecuting(msg.isBusy);
      sendFn({ type: 'list_projects' });
    } else if (msg.type === 'projects_list') {
      setAvailableProjects(msg.projects);
      setProjectsBaseDir(msg.baseDir);
    } else if (msg.type === 'turn_start') {
      setIsExecuting(true);
    } else if (msg.type === 'turn_end' || msg.type === 'turn_error' || msg.type === 'execution_aborted') {
      setIsExecuting(false);
    }

    onMessageRef.current(msg);
  }, []);

  // HTTP POST でメッセージ送信
  const postHttpMessage = useCallback(async (msg: OutboundMessage, messageUrl: string) => {
    try {
      const res = await fetch(messageUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(msg),
      });
      if (!res.ok) {
        console.error('[RemoteSocket] POST message failed with status:', res.status);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[RemoteSocket] Failed to send HTTP POST message:', err);
      return false;
    }
  }, []);

  // 接続クリーンアップ
  const cleanupConnections = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.onerror = null;
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // HTTP (SSE + POST) 接続
  const connectHttp = useCallback(() => {
    cleanupConnections();
    const { hubUrl, authToken } = settings;
    if (!hubUrl) return;

    const { eventsUrl, messageUrl } = deriveHttpUrls(hubUrl, authToken);
    console.log('[RemoteSocket] Connecting via HTTP (SSE):', eventsUrl);

    try {
      const es = new EventSource(eventsUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        console.log('[RemoteSocket] Connected to Hub via SSE (HTTP)');
        setIsHubConnected(true);
        setActiveTransport('http');
        // 接続直後に初期状態リクエスト
        postHttpMessage({ type: 'get_status' }, messageUrl);
      };

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as InboundMessage;
          handleInbound(msg, (out) => postHttpMessage(out, messageUrl));
        } catch (err) {
          console.error('[RemoteSocket] Failed to parse SSE inbound message:', err);
        }
      };

      es.onerror = (err) => {
        console.warn('[RemoteSocket] SSE connection error/disconnected:', err);
        setIsHubConnected(false);
        setIsAgentConnected(false);
        setIsExecuting(false);
      };
    } catch (e) {
      console.error('[RemoteSocket] Failed to create EventSource connection:', e);
      reconnectTimerRef.current = setTimeout(connectHttp, 4000);
    }
  }, [settings, cleanupConnections, postHttpMessage, handleInbound]);

  // WebSocket 接続（auto モード時はエラー・タイムアウト時に connectHttp へフォールバック）
  const connectWs = useCallback(() => {
    cleanupConnections();
    const { hubUrl, authToken, transportMode = 'auto' } = settings;
    if (!hubUrl) return;

    try {
      const urlObj = new URL(hubUrl);
      if (authToken) {
        urlObj.searchParams.set('token', authToken);
      }

      console.log('[RemoteSocket] Connecting via WebSocket:', urlObj.toString());
      const ws = new WebSocket(urlObj.toString());
      wsRef.current = ws;

      // auto モード時: 3.5秒以内に WebSocket が open しない場合は HTTP (SSE) へフォールバック
      if (transportMode === 'auto') {
        fallbackTimerRef.current = setTimeout(() => {
          if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
            console.warn('[RemoteSocket] WebSocket handshake timeout (3.5s). Falling back to HTTP (SSE+POST)...');
            connectHttp();
          }
        }, 3500);
      }

      ws.onopen = () => {
        if (fallbackTimerRef.current) {
          clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
        console.log('[RemoteSocket] Connected to Hub via WebSocket');
        setIsHubConnected(true);
        setActiveTransport('ws');
        ws.send(JSON.stringify({ type: 'get_status' }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as InboundMessage;
          handleInbound(msg, (out) => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify(out));
            }
          });
        } catch (err) {
          console.error('[RemoteSocket] Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        console.warn('[RemoteSocket] WebSocket disconnected.');
        setIsHubConnected(false);
        setIsAgentConnected(false);
        setIsExecuting(false);
        setActiveTransport('none');
        wsRef.current = null;

        if (transportMode === 'auto') {
          console.log('[RemoteSocket] WebSocket closed in auto mode. Switching to HTTP (SSE+POST)...');
          connectHttp();
        } else {
          reconnectTimerRef.current = setTimeout(connectWs, 3000);
        }
      };

      ws.onerror = (err) => {
        console.error('[RemoteSocket] WebSocket error:', err);
        if (transportMode === 'auto') {
          if (fallbackTimerRef.current) {
            clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
          }
          console.log('[RemoteSocket] WebSocket error in auto mode. Switching to HTTP (SSE+POST)...');
          connectHttp();
        }
      };
    } catch (e) {
      console.error('[RemoteSocket] Failed to create WebSocket connection:', e);
      if (transportMode === 'auto') {
        connectHttp();
      } else {
        reconnectTimerRef.current = setTimeout(connectWs, 3000);
      }
    }
  }, [settings, cleanupConnections, connectHttp, handleInbound]);

  // 接続ディスパッチャー
  const connect = useCallback(() => {
    const mode = settings.transportMode || 'auto';
    if (mode === 'http') {
      connectHttp();
    } else {
      connectWs();
    }
  }, [settings.transportMode, connectHttp, connectWs]);

  useEffect(() => {
    connect();
    return () => {
      cleanupConnections();
    };
  }, [connect, cleanupConnections]);

  // モバイル画面復帰（visibilitychange）時の自動健全性チェック
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        console.log('[RemoteSocket] Page visible again. Checking connection...');
        if (!isHubConnected) {
          connect();
        } else if (activeTransport === 'http') {
          const { hubUrl, authToken } = settings;
          const { messageUrl } = deriveHttpUrls(hubUrl, authToken);
          postHttpMessage({ type: 'get_status' }, messageUrl);
        }
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [isHubConnected, activeTransport, connect, settings, postHttpMessage]);

  // 汎用メッセージ送信関数
  const send = useCallback((msg: OutboundMessage) => {
    if (activeTransport === 'ws' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    } else if (activeTransport === 'http') {
      const { hubUrl, authToken } = settings;
      const { messageUrl } = deriveHttpUrls(hubUrl, authToken);
      postHttpMessage(msg, messageUrl);
      return true;
    }
    return false;
  }, [activeTransport, settings, postHttpMessage]);

  const sendPrompt = useCallback((
    text: string,
    sessionId?: string,
    isResume?: boolean,
    cwd?: string,
    permissionMode: PermissionMode = 'acceptEdits',
    model?: string,
    engine?: AIEngine
  ) => {
    const payload: SendPromptMessage = {
      type: 'prompt',
      text,
      sessionId,
      isResume,
      cwd: cwd || settings.defaultCwd || agentCwd || undefined,
      permissionMode,
      model,
      engine,
    };
    const ok = send(payload);
    if (ok) {
      setIsExecuting(true);
    }
    return ok;
  }, [send, settings.defaultCwd, agentCwd]);

  const abort = useCallback(() => {
    return send({ type: 'abort' });
  }, [send]);

  const updateSettings = useCallback((newSettings: SocketSettings) => {
    saveSettingsToStorage(newSettings);
    setSettings(newSettings);
  }, []);

  const requestProjects = useCallback((rootPath?: string) => {
    return send({ type: 'list_projects', rootPath });
  }, [send]);

  const listSessions = useCallback((projectId?: string, cwd?: string) => {
    return send({ type: 'list_sessions', projectId, cwd });
  }, [send]);

  const getSessionMessages = useCallback((sessionId: string, cwd?: string) => {
    return send({ type: 'get_session_messages', sessionId, cwd });
  }, [send]);

  const deleteSession = useCallback((sessionId: string) => {
    return send({ type: 'delete_session', sessionId });
  }, [send]);

  const sendToolApproval = useCallback((
    requestId: string,
    behavior: 'allow' | 'deny',
    message?: string
  ) => {
    console.log(`[RemoteSocket] Sending tool approval: ${requestId} -> ${behavior}`);
    return send({
      type: 'tool_approval_response',
      requestId,
      behavior,
      message,
    });
  }, [send]);

  return {
    settings,
    updateSettings,
    isHubConnected,
    isAgentConnected,
    activeTransport,
    agentHostname,
    agentCwd,
    isExecuting,
    availableProjects,
    projectsBaseDir,
    requestProjects,
    listSessions,
    getSessionMessages,
    deleteSession,
    sendToolApproval,
    sendPrompt,
    abort,
    reconnect: connect,
  };
}
