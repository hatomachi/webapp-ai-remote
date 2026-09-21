export type PermissionMode = 'acceptEdits' | 'bypassPermissions' | 'default';

// --- WebSocket Protocol Messages ---

export interface HubStatusMessage {
  type: 'status';
  agentConnected: boolean;
  timestamp: string;
}

export interface HubErrorMessage {
  type: 'error';
  message: string;
  code: string;
}

export interface AgentHelloMessage {
  type: 'agent_hello';
  hostname: string;
  defaultCwd: string;
  timestamp: string;
}

export interface AgentStatusResponseMessage {
  type: 'agent_status';
  hostname: string;
  cwd: string;
  isBusy: boolean;
  timestamp: string;
}

export interface TurnStartMessage {
  type: 'turn_start';
  prompt: string;
  sessionId: string;
  cwd: string;
  timestamp: string;
}

export interface ClaudeEventMessage {
  type: 'claude_event';
  sessionId: string;
  event: any; // Raw Claude stream-json event
}

export interface ClaudeRawLogMessage {
  type: 'claude_raw_log';
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface TurnEndMessage {
  type: 'turn_end';
  sessionId: string;
  exitCode: number | null;
  signal: string | null;
  timestamp: string;
}

export interface TurnErrorMessage {
  type: 'turn_error';
  error: string;
  timestamp: string;
}

export interface ExecutionAbortedMessage {
  type: 'execution_aborted';
  timestamp: string;
}

export interface ProjectsListMessage {
  type: 'projects_list';
  baseDir: string;
  projects: ProjectInfo[];
  timestamp: string;
}

export interface SessionsListMessage {
  type: 'sessions_list';
  sessions: SessionInfo[];
  projectId?: string;
  timestamp: string;
}

export interface SessionMessagesMessage {
  type: 'session_messages';
  sessionId: string;
  messages: ChatMessage[];
  timestamp: string;
}

export interface ToolApprovalRequestMessage {
  type: 'tool_approval_request';
  requestId: string;
  toolUseId?: string;
  toolName: string;
  input: any;
  description?: string;
  decisionReason?: string;
  timestamp: string;
}

export type InboundMessage =
  | HubStatusMessage
  | HubErrorMessage
  | AgentHelloMessage
  | AgentStatusResponseMessage
  | ProjectsListMessage
  | SessionsListMessage
  | SessionMessagesMessage
  | TurnStartMessage
  | ClaudeEventMessage
  | ClaudeRawLogMessage
  | TurnEndMessage
  | TurnErrorMessage
  | ExecutionAbortedMessage
  | ToolApprovalRequestMessage;

// --- Outbound Messages ---

export interface SendPromptMessage {
  type: 'prompt';
  text: string;
  sessionId?: string;
  isResume?: boolean;
  cwd?: string;
  permissionMode?: PermissionMode;
  model?: string;
}

export interface AbortMessage {
  type: 'abort';
}

export interface GetStatusMessage {
  type: 'get_status';
}

export interface ListProjectsMessage {
  type: 'list_projects';
  rootPath?: string;
}

export interface ListSessionsMessage {
  type: 'list_sessions';
  projectId?: string;
  cwd?: string;
}

export interface GetSessionMessagesMessage {
  type: 'get_session_messages';
  sessionId: string;
  cwd?: string;
}

export interface DeleteSessionMessage {
  type: 'delete_session';
  sessionId: string;
}

export interface ToolApprovalResponseMessage {
  type: 'tool_approval_response';
  requestId: string;
  behavior: 'allow' | 'deny';
  message?: string;
}

export type OutboundMessage =
  | SendPromptMessage
  | AbortMessage
  | GetStatusMessage
  | ListProjectsMessage
  | ListSessionsMessage
  | GetSessionMessagesMessage
  | DeleteSessionMessage
  | ToolApprovalResponseMessage;

// --- App State Types ---

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  isGit?: boolean;
}

export interface ToolUseItem {
  id: string;
  name: string;
  input: Record<string, any> | string;
  output?: string;
  isRunning: boolean;
  isError?: boolean;
  approvalState?: 'pending' | 'allowed' | 'denied';
  approvalRequestId?: string;
}

export interface ResultStats {
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  subtype?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  sessionId: string;
  isStreaming?: boolean;
  isError?: boolean;
  toolUses?: ToolUseItem[];
  stats?: ResultStats;
}

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export type TransportMode = 'auto' | 'ws' | 'http';
export type ActiveTransport = 'ws' | 'http' | 'none';

