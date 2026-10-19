/**
 * Wire protocol shared by the NagarCode web app and the local agent.
 *
 * This package intentionally contains types only. Importing it never pulls
 * Node.js or browser code into the other runtime.
 */

export const AGENT_PROTOCOL_VERSION = 1;
export const AGENT_NAME = "nagarcode-agent";
export const AGENT_WS_SUBPROTOCOL = "nagarcode-agent.v1";
export const AGENT_WS_TOKEN_PREFIX = "nagarcode-token.";

export type AgentErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN_ORIGIN"
  | "FORBIDDEN_HOST"
  | "FORBIDDEN_PATH"
  | "INVALID_REQUEST"
  | "INVALID_PATH"
  | "PATH_OUTSIDE_WORKSPACE"
  | "WORKSPACE_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "PERMISSION_DENIED"
  | "NOT_A_DIRECTORY"
  | "IS_A_DIRECTORY"
  | "FILE_TOO_LARGE"
  | "PAYLOAD_TOO_LARGE"
  | "TOO_MANY_REQUESTS"
  | "TOO_MANY_SESSIONS"
  | "SHELL_UNAVAILABLE"
  | "RUNTIME_UNAVAILABLE"
  | "COMPILE_ERROR"
  | "UNSUPPORTED_LANGUAGE"
  | "GIT_ERROR"
  | "GIT_CONFLICT"
  | "GIT_NOT_REPO"
  | "INTERNAL_ERROR";

export type AgentErrorBody = {
  error: {
    code: AgentErrorCode;
    message: string;
    details?: string[];
  };
};

export type RuntimeId = "javascript" | "typescript" | "python";

export type RuntimeAvailability = {
  id: RuntimeId;
  label: string;
  extensions: string[];
  available: boolean;
  /** Human-readable version, when detection succeeded. */
  version?: string;
  /** Resolved executable or strategy command. */
  command?: string;
  /** Example: "node", "tsx", "ts-node", "transpile". */
  strategy?: string;
  /** Why the runtime is unavailable, or a caveat when it is available. */
  reason?: string;
  /** Short, actionable install hint. */
  installHint?: string;
};

export type ShellFamily = "posix" | "powershell" | "cmd";

export type ShellInfo = {
  id: string;
  label: string;
  path: string;
  family: ShellFamily;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  /** Absolute, real path of the opened directory. */
  root: string;
  openedAt: string;
};

export type EntryKind = "file" | "directory";

export type AgentEntry = {
  name: string;
  /** Workspace-relative POSIX path, always starting with "/". */
  path: string;
  kind: EntryKind;
  size?: number;
  mtimeMs?: number;
};

export type AgentFile = {
  path: string;
  content: string;
  size: number;
  mtimeMs: number;
};

export type BrowseResult = {
  path: string;
  parent: string | null;
  roots: string[];
  dirs: { name: string; path: string }[];
};

export type AgentStatus = {
  name: string;
  version: string;
  protocolVersion: number;
  pid: number;
  platform: string;
  arch: string;
  nodeVersion: string;
  startedAt: string;
  ptyAvailable: boolean;
  ptyReason?: string;
  workspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  allowedRoots: string[];
  allowedOrigins: string[];
  runtimes: RuntimeAvailability[];
  shells: ShellInfo[];
  terminals: { active: number; limit: number };
};

export type AgentHealth = {
  ok: true;
  name: string;
  version: string;
  protocolVersion: number;
};

export type OpenWorkspaceRequest = {
  path: string;
};

export type WriteFileRequest = {
  path: string;
  content: string;
};

export type CreateFileRequest = {
  path: string;
  content?: string;
};

export type CreateFolderRequest = {
  path: string;
};

export type RenameRequest = {
  from: string;
  to: string;
};

export type RunRequest = {
  /** Workspace-relative path of the file to execute. */
  path: string;
  /** Optional cross-check; the agent derives the runtime from the extension. */
  runtime?: RuntimeId;
  /** Optional absolute or PATH-resolved Python interpreter for this run. */
  pythonPath?: string;
  cols?: number;
  rows?: number;
};

export type RunResult = {
  session: TerminalSessionInfo;
  runtime: RuntimeId;
  /** Display-only command line, derived from the real argv. */
  commandLine: string;
};

export type TerminalSessionKind = "shell" | "run";

export type TerminalSessionStatus = "running" | "exited";

export type TerminalSessionInfo = {
  id: string;
  kind: TerminalSessionKind;
  title: string;
  workspaceId: string;
  /** Absolute working directory the process was started in. */
  cwd: string;
  /** Workspace-relative POSIX form of `cwd`. */
  cwdRel: string;
  shellId: string;
  shellLabel: string;
  cols: number;
  rows: number;
  /** False when the agent had to fall back to plain pipes. */
  pty: boolean;
  createdAt: string;
  status: TerminalSessionStatus;
  exitCode: number | null;
  signal: string | null;
  runtime?: RuntimeId;
  filePath?: string;
  commandLine?: string;
};

export type CreateTerminalRequest = {
  workspaceId: string;
  shellId?: string;
  /** Workspace-relative directory; defaults to the workspace root. */
  cwd?: string;
  cols?: number;
  rows?: number;
};

export type TerminalClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "interrupt" }
  | { type: "ping" };

export type TerminalServerMessage =
  | { type: "ready"; session: TerminalSessionInfo; replayed: number }
  | { type: "data"; data: string }
  | { type: "exit"; exitCode: number | null; signal: string | null }
  | { type: "error"; code: AgentErrorCode; message: string }
  | { type: "pong" };

export type ListWorkspacesResponse = {
  workspaces: WorkspaceSummary[];
};

export type ListEntriesResponse = {
  entries: AgentEntry[];
};

export type ListFilesResponse = {
  files: string[];
  truncated: boolean;
};

export type ListTerminalsResponse = {
  sessions: TerminalSessionInfo[];
};

export type RuntimesResponse = {
  runtimes: RuntimeAvailability[];
};

// ─────────────────────────────────────────────────────────────
// Git types — workspace-local Git via the agent's `git` binary
// ─────────────────────────────────────────────────────────────

export type GitCredentials = {
  username?: string;
  password?: string;
};

export type GitStatusFile = {
  path: string;
  /** Original path for renames/copies */
  originalPath?: string;
  staged: string; // e.g. "M", "A", "D", "R", " ", "?"
  unstaged: string;
  status: string; // combined XY code
};

export type GitStatus = {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: GitStatusFile[];
  unstaged: GitStatusFile[];
  untracked: string[];
  conflicted: string[];
  hasChanges: boolean;
};

export type GitBranch = {
  name: string;
  current: boolean;
  upstream?: string | null;
  commit: string;
  commitMessage: string;
};

export type GitCommit = {
  sha: string;
  shortSha: string;
  author: string;
  email: string;
  date: string;
  message: string;
  parents: string[];
};

export type GitLogResponse = {
  commits: GitCommit[];
  hasMore: boolean;
  total?: number;
};

export type GitRemote = {
  name: string;
  fetchUrl: string;
  pushUrl: string;
};

export type GitDiff = {
  path: string;
  diff: string;
  truncated: boolean;
};

export type GitInitResponse = {
  initialized: boolean;
  branch: string | null;
};

export type GitCommitResponse = {
  sha: string;
  message: string;
};

export type GitMergeResponse = {
  sha?: string;
  merged: boolean;
  conflicted?: string[];
  message?: string;
};

export type GitCloneRequest = {
  url: string;
  targetPath: string;
  credentials?: GitCredentials;
  branch?: string;
};

export type GitCloneResponse = {
  ok: boolean;
  targetPath: string;
  workspace: WorkspaceSummary | null;
};

export type GitFetchResponse = {
  output: string;
};

export type GitPullResponse = {
  output: string;
  conflicted?: string[];
};

export type GitPushResponse = {
  output: string;
};

export type GitRemoteAddRequest = {
  name: string;
  url: string;
};

export type GitBranchCreateRequest = {
  name: string;
  checkout?: boolean;
  startPoint?: string;
};

export type GitCheckoutRequest = {
  name: string;
  create?: boolean;
};

export type GitCommitRequest = {
  message: string;
  authorName?: string;
  authorEmail?: string;
};

export type GitStageRequest = {
  paths: string[];
};

export type GitDiffRequest = {
  path?: string;
  staged?: boolean;
};

export type GitMergeRequest = {
  branch: string;
  message?: string;
};

export type GitFetchRequest = {
  remote?: string;
  branch?: string;
  credentials?: GitCredentials;
};

export type GitPushRequest = {
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
  credentials?: GitCredentials;
  force?: boolean;
};

export type GitPullRequest = {
  remote?: string;
  branch?: string;
  credentials?: GitCredentials;
  rebase?: boolean;
};
