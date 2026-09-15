import { useState, useEffect, useRef, useCallback } from 'react';
import { InboundMessage, OutboundMessage, SendPromptMessage, PermissionMode, ProjectInfo } from '../types/protocol';

interface SocketSettings {
  hubUrl: string;
  authToken: string;
  defaultCwd: string;
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
    authToken: 'dev-secret-token',
    defaultCwd: '',
  };
}

export function loadSettings(): SocketSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...getDefaultSettings(), ...parsed };
    }
  } catch (e) {
    console.error('Failed to parse settings from localStorage', e);
  }
  return getDefaultSettings();
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

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<any>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const { hubUrl, authToken } = settings;
    if (!hubUrl) return;

    try {
      const urlObj = new URL(hubUrl);
      if (authToken) {
        urlObj.searchParams.set('token', authToken);
      }

      console.log('[RemoteSocket] Connecting to:', urlObj.toString());
      const ws = new WebSocket(urlObj.toString());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[RemoteSocket] Connected to Hub');
        setIsHubConnected(true);
        // 接続直後にステータス確認
        ws.send(JSON.stringify({ type: 'get_status' }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as InboundMessage;
          // 内部状態の同期
          if (msg.type === 'status') {
            setIsAgentConnected(msg.agentConnected);
            if (!msg.agentConnected) {
              setIsExecuting(false);
            }
          } else if (msg.type === 'agent_hello') {
            setIsAgentConnected(true);
            setAgentHostname(msg.hostname);
            setAgentCwd(msg.defaultCwd);
            // Agent 接続時にプロジェクト候補を自動取得
            ws.send(JSON.stringify({ type: 'list_projects' }));
          } else if (msg.type === 'agent_status') {
            setIsAgentConnected(true);
            setAgentHostname(msg.hostname);
            setAgentCwd(msg.cwd);
            setIsExecuting(msg.isBusy);
            // プロジェクト候補の取得
            ws.send(JSON.stringify({ type: 'list_projects' }));
          } else if (msg.type === 'projects_list') {
            setAvailableProjects(msg.projects);
            setProjectsBaseDir(msg.baseDir);
          } else if (msg.type === 'turn_start') {
            setIsExecuting(true);
          } else if (msg.type === 'turn_end' || msg.type === 'turn_error' || msg.type === 'execution_aborted') {
            setIsExecuting(false);
          }

          onMessageRef.current(msg);
        } catch (err) {
          console.error('[RemoteSocket] Failed to parse inbound message:', err);
        }
      };

      ws.onclose = () => {
        console.warn('[RemoteSocket] Hub disconnected. Retrying in 3s...');
        setIsHubConnected(false);
        setIsAgentConnected(false);
        setIsExecuting(false);
        wsRef.current = null;
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('[RemoteSocket] WebSocket error:', err);
      };
    } catch (e) {
      console.error('[RemoteSocket] Failed to create WebSocket connection:', e);
      reconnectTimerRef.current = setTimeout(connect, 3000);
    }
  }, [settings]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const send = useCallback((msg: OutboundMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const sendPrompt = useCallback((
    text: string,
    sessionId?: string,
    isResume?: boolean,
    cwd?: string,
    permissionMode: PermissionMode = 'acceptEdits'
  ) => {
    const payload: SendPromptMessage = {
      type: 'prompt',
      text,
      sessionId,
      isResume,
      cwd: cwd || settings.defaultCwd || agentCwd || undefined,
      permissionMode,
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

  return {
    settings,
    updateSettings,
    isHubConnected,
    isAgentConnected,
    agentHostname,
    agentCwd,
    isExecuting,
    availableProjects,
    projectsBaseDir,
    requestProjects,
    sendPrompt,
    abort,
    reconnect: connect,
  };
}
