export type PermissionMode = 'acceptEdits' | 'bypassPermissions' | 'default';
export type AIEngine = 'claude' | 'copilot';

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

export interface AttachmentItem {
  id: string;
  name: string;
  type: string;
  size: number;
  data: string;
  thumbnailData?: string;
  localPath?: string;
}

export interface TurnStartMessage {
  type: 'turn_start';
  prompt: string;
  sessionId: string;
  cwd: string;
  engine?: AIEngine;
  attachments?: AttachmentItem[];
  timestamp: string;
}

export interface ClaudeEventMessage {
  type: 'claude_event';
  sessionId: string;
  event: any; // Raw Claude stream-json event or normalized engine event
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

export interface UserCredentials {
  userName?: string;        // 例: "Taro Tanaka" (コミット名義・worktree名)
  userEmail?: string;       // 例: "tanaka@company.co.jp"
  copilotToken?: string;    // ghp_xxxx
  claudeApiKey?: string;    // sk-ant-xxxx
  gitlabToken?: string;     // glpat-xxxx
}

export interface AdminRepoItem {
  name: string;
  path: string;
  branch: string;
  lastCommit: string;
  lastUpdated: string;
  sizeBytes: number;
}

export interface AdminReposListMessage {
  type: 'admin:repos_list';
  repos: AdminRepoItem[];
  timestamp: string;
}

export interface AdminCloneRepoResultMessage {
  type: 'admin:clone_repo_result';
  success: boolean;
  repoName?: string;
  error?: string;
  timestamp: string;
}

export interface WorkspaceRepoItem {
  name: string;
  branch: string;
  path: string;
}

export interface WorkspaceItem {
  userName: string;
  path: string;
  sizeBytes: number;
  lastActive: string;
  repos: WorkspaceRepoItem[];
}

export interface DiskStats {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
}

export interface AdminWorkspacesListMessage {
  type: 'admin:workspaces_list';
  workspaces: WorkspaceItem[];
  diskStats: DiskStats;
  timestamp: string;
}

export interface AdminCleanupWorkspaceResultMessage {
  type: 'admin:cleanup_workspace_result';
  success: boolean;
  userName: string;
  error?: string;
  timestamp: string;
}

export interface BaseMessage {
  clientId?: string;
  targetClientId?: string;
}

export type InboundMessage = (
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
  | ToolApprovalRequestMessage
  | AdminReposListMessage
  | AdminCloneRepoResultMessage
  | AdminWorkspacesListMessage
  | AdminCleanupWorkspaceResultMessage
) & BaseMessage;

// --- Outbound Messages ---

export interface SendPromptMessage {
  type: 'prompt';
  text: string;
  sessionId?: string;
  isResume?: boolean;
  cwd?: string;
  permissionMode?: PermissionMode;
  model?: string;
  engine?: AIEngine;
  reasoningEffort?: string;
  attachments?: AttachmentItem[];
  credentials?: UserCredentials;
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
  userName?: string;
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

export interface AdminListReposMessage {
  type: 'admin:list_repos';
}

export interface AdminCloneRepoMessage {
  type: 'admin:clone_repo';
  repoUrl: string;
  deployToken?: string;
  deployUser?: string;
  name?: string;
}

export interface AdminListWorkspacesMessage {
  type: 'admin:list_workspaces';
}

export interface AdminCleanupWorkspaceMessage {
  type: 'admin:cleanup_workspace';
  userName: string;
}

export type OutboundMessage = (
  | SendPromptMessage
  | AbortMessage
  | GetStatusMessage
  | ListProjectsMessage
  | ListSessionsMessage
  | GetSessionMessagesMessage
  | DeleteSessionMessage
  | ToolApprovalResponseMessage
  | AdminListReposMessage
  | AdminCloneRepoMessage
  | AdminListWorkspacesMessage
  | AdminCleanupWorkspaceMessage
) & BaseMessage;

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
  engine?: AIEngine;
  isStreaming?: boolean;
  isError?: boolean;
  toolUses?: ToolUseItem[];
  stats?: ResultStats;
  attachments?: AttachmentItem[];
}

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  projectId?: string;
  engine?: AIEngine;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export type TransportMode = 'auto' | 'ws' | 'http';
export type ActiveTransport = 'ws' | 'http' | 'none';

