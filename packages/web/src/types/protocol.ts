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

export type InboundMessage =
  | HubStatusMessage
  | HubErrorMessage
  | AgentHelloMessage
  | AgentStatusResponseMessage
  | ProjectsListMessage
  | TurnStartMessage
  | ClaudeEventMessage
  | ClaudeRawLogMessage
  | TurnEndMessage
  | TurnErrorMessage
  | ExecutionAbortedMessage;

// --- Outbound Messages ---

export interface SendPromptMessage {
  type: 'prompt';
  text: string;
  sessionId?: string;
  isResume?: boolean;
  cwd?: string;
  permissionMode?: PermissionMode;
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

export type OutboundMessage = SendPromptMessage | AbortMessage | GetStatusMessage | ListProjectsMessage;

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

