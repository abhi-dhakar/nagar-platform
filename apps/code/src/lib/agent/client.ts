"use client";

import type {
  AgentEntry,
  AgentFile,
  AgentHealth,
  AgentStatus,
  BrowseResult,
  CreateTerminalRequest,
  ListEntriesResponse,
  ListFilesResponse,
  ListTerminalsResponse,
  ListWorkspacesResponse,
  OpenWorkspaceRequest,
  RenameRequest,
  RunRequest,
  RunResult,
  RuntimesResponse,
  TerminalSessionInfo,
  WorkspaceSummary,
  WriteFileRequest,
} from "@nagar/agent-protocol";

export class AgentClientError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly details: string[] | undefined;

  constructor(code: string, message: string, status?: number, details?: string[]) {
    super(message);
    this.name = "AgentClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{24,256}$/;

export function assertAgentToken(token: string): string {
  const value = token.trim();
  if (!TOKEN_PATTERN.test(value)) {
    throw new AgentClientError(
      "BAD_TOKEN",
      "That token does not look right. Copy the full token printed by the agent (or open its pairing link).",
    );
  }
  return value;
}

/** Normalize and validate an agent URL. Only loopback http URLs are accepted. */
export function normalizeAgentUrl(raw: string): string {
  let value = raw.trim();
  if (!value)
    throw new AgentClientError(
      "BAD_URL",
      "Enter the local agent URL, for example http://127.0.0.1:47821.",
    );
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AgentClientError("BAD_URL", "That agent URL is not valid.");
  }
  if (url.protocol !== "http:") {
    throw new AgentClientError(
      "BAD_URL",
      "The local agent uses plain http on loopback (http://127.0.0.1:47821).",
    );
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new AgentClientError(
      "BAD_URL",
      "The agent URL must be a loopback address (127.0.0.1 or localhost). NagarCode refuses non-local agent URLs.",
    );
  }
  if (url.username || url.password) {
    throw new AgentClientError("BAD_URL", "Agent URLs cannot include credentials.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new AgentClientError("BAD_URL", "Use the agent root URL without a path.");
  }
  return `${url.protocol}//${url.host}`;
}

export function isLoopbackPage(): boolean {
  if (typeof window === "undefined") return false;
  return LOOPBACK_HOSTS.has(window.location.hostname);
}

type RequestOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export class AgentClient {
  readonly baseUrl: string;
  readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = normalizeAgentUrl(baseUrl);
    this.token = assertAgentToken(token);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
      });
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "The local agent did not respond in time."
          : `Could not reach the local agent at ${this.baseUrl}. Is it running?`;
      throw new AgentClientError("AGENT_UNREACHABLE", message);
    } finally {
      globalThis.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    }

    let payload: unknown = null;
    const text = await response.text().catch(() => "");
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const errorPayload = payload as {
        error?: { code?: unknown; message?: unknown; details?: unknown };
      } | null;
      const code =
        typeof errorPayload?.error?.code === "string"
          ? errorPayload.error.code
          : `HTTP_${response.status}`;
      const message =
        typeof errorPayload?.error?.message === "string"
          ? errorPayload.error.message
          : response.status === 401
            ? "The agent rejected this token."
            : `The local agent returned HTTP ${response.status}.`;
      const details = Array.isArray(errorPayload?.error?.details)
        ? errorPayload.error.details.filter((item): item is string => typeof item === "string")
        : undefined;
      throw new AgentClientError(code, message, response.status, details);
    }
    return payload as T;
  }

  health(): Promise<AgentHealth> {
    return this.request<AgentHealth>("GET", "/api/health", undefined, { timeoutMs: 8_000 });
  }

  status(): Promise<AgentStatus> {
    return this.request<AgentStatus>("GET", "/api/status");
  }

  listWorkspaces(): Promise<WorkspaceSummary[]> {
    return this.request<ListWorkspacesResponse>("GET", "/api/workspaces").then(
      (result) => result.workspaces,
    );
  }

  openWorkspace(path: string): Promise<WorkspaceSummary> {
    const body: OpenWorkspaceRequest = { path };
    return this.request<{ workspace: WorkspaceSummary }>("POST", "/api/workspaces", body).then(
      (result) => result.workspace,
    );
  }

  closeWorkspace(id: string): Promise<void> {
    return this.request<{ ok: true }>("DELETE", `/api/workspaces/${encodeURIComponent(id)}`).then(
      () => undefined,
    );
  }

  listEntries(workspaceId: string, path: string): Promise<AgentEntry[]> {
    return this.request<ListEntriesResponse>(
      "GET",
      `/api/workspaces/${encodeURIComponent(workspaceId)}/entries?path=${encodeURIComponent(path)}`,
    ).then((result) => result.entries);
  }

  readFile(workspaceId: string, path: string): Promise<AgentFile> {
    return this.request<AgentFile>(
      "GET",
      `/api/workspaces/${encodeURIComponent(workspaceId)}/file?path=${encodeURIComponent(path)}`,
    );
  }

  writeFile(workspaceId: string, path: string, content: string): Promise<AgentEntry> {
    const body: WriteFileRequest = { path, content };
    return this.request<{ entry: AgentEntry }>(
      "PUT",
      `/api/workspaces/${encodeURIComponent(workspaceId)}/file`,
      body,
    ).then((result) => result.entry);
  }

  createFile(workspaceId: string, path: string, content = ""): Promise<AgentEntry> {
    return this.request<{ entry: AgentEntry }>(
      "POST",
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files`,
      { path, content },
    ).then((result) => result.entry);
  }

  createFolder(workspaceId: string, path: string): Promise<AgentEntry> {
    return this.request<{ entry: AgentEntry }>(
      "POST",
      `/api/workspaces/${encodeURIComponent(workspaceId)}/folders`,
      { path },
    ).then((result) => result.entry);
  }

  rename(workspaceId: string, from: string, to: string): Promise<AgentEntry> {
    const body: RenameRequest = { from, to };
    return this.request<{ entry: AgentEntry }>(
      "POST",
      `/api/workspaces/${encodeURIComponent(workspaceId)}/rename`,
      body,
    ).then((result) => result.entry);
  }

  deleteEntry(workspaceId: string, path: string, recursive = false): Promise<void> {
    return this.request<{ ok: true }>(
      "DELETE",
      `/api/workspaces/${encodeURIComponent(workspaceId)}/entries?path=${encodeURIComponent(path)}&recursive=${recursive ? "1" : "0"}`,
    ).then(() => undefined);
  }

  stat(workspaceId: string, path: string): Promise<AgentEntry | null> {
    return this.request<{ entry: AgentEntry | null }>(
      "GET",
      `/api/workspaces/${encodeURIComponent(workspaceId)}/stat?path=${encodeURIComponent(path)}`,
    ).then((result) => result.entry);
  }

  exists(workspaceId: string, path: string): Promise<boolean> {
    return this.request<{ exists: boolean }>(
      "GET",
      `/api/workspaces/${encodeURIComponent(workspaceId)}/exists?path=${encodeURIComponent(path)}`,
    ).then((result) => result.exists);
  }

  getAllFiles(workspaceId: string): Promise<ListFilesResponse> {
    return this.request<ListFilesResponse>(
      "GET",
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files`,
    );
  }

  browse(path?: string): Promise<BrowseResult> {
    const suffix = path ? `?path=${encodeURIComponent(path)}` : "";
    return this.request<BrowseResult>("GET", `/api/browse${suffix}`);
  }

  runtimes(workspaceId?: string | null, pythonPath?: string): Promise<RuntimesResponse> {
    const query = new URLSearchParams();
    if (workspaceId) query.set("workspaceId", workspaceId);
    if (pythonPath?.trim()) query.set("pythonPath", pythonPath.trim());
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return this.request<RuntimesResponse>("GET", `/api/runtimes${suffix}`);
  }

  runFile(workspaceId: string, request: RunRequest): Promise<RunResult> {
    return this.request<RunResult>(
      "POST",
      `/api/workspaces/${encodeURIComponent(workspaceId)}/runs`,
      request,
      { timeoutMs: 30_000 },
    );
  }

  listTerminals(workspaceId?: string): Promise<TerminalSessionInfo[]> {
    const suffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    return this.request<ListTerminalsResponse>("GET", `/api/terminals${suffix}`).then(
      (result) => result.sessions,
    );
  }

  createTerminal(request: CreateTerminalRequest): Promise<TerminalSessionInfo> {
    return this.request<{ session: TerminalSessionInfo }>("POST", "/api/terminals", request).then(
      (result) => result.session,
    );
  }

  getTerminal(id: string): Promise<TerminalSessionInfo> {
    return this.request<{ session: TerminalSessionInfo }>(
      "GET",
      `/api/terminals/${encodeURIComponent(id)}`,
    ).then((result) => result.session);
  }

  resizeTerminal(id: string, cols: number, rows: number): Promise<TerminalSessionInfo> {
    return this.request<{ session: TerminalSessionInfo }>(
      "PATCH",
      `/api/terminals/${encodeURIComponent(id)}`,
      { cols, rows },
    ).then((result) => result.session);
  }

  interruptTerminal(id: string): Promise<void> {
    return this.request<{ ok: true }>(
      "POST",
      `/api/terminals/${encodeURIComponent(id)}/interrupt`,
    ).then(() => undefined);
  }

  closeTerminal(id: string): Promise<void> {
    return this.request<{ ok: true }>("DELETE", `/api/terminals/${encodeURIComponent(id)}`).then(
      () => undefined,
    );
  }

  terminalWebSocketUrl(id: string): string {
    const url = new URL(this.baseUrl);
    url.protocol = "ws:";
    url.pathname = `/api/terminals/${encodeURIComponent(id)}/ws`;
    return url.toString();
  }

  terminalProtocols(): string[] {
    return ["nagarcode-agent.v1", `nagarcode-token.${this.token}`];
  }
}
