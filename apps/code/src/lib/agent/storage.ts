"use client";

export type StoredAgentConfig = {
  url: string;
  token: string;
};

const CONFIG_KEY = "nagarcode:agent:v1";
const RECENT_WORKSPACES_KEY = "nagarcode:agent:recent-workspaces:v1";
const LAST_WORKSPACE_KEY = "nagarcode:agent:last-workspace:v1";
const PYTHON_KEY = "nagarcode:agent:python:v1";
const TRUST_KEY = "nagarcode:trust-ack:v1";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage can be unavailable in privacy modes; the UI degrades to per-tab state.
  }
}

export function loadAgentConfig(): StoredAgentConfig | null {
  const raw = read(CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAgentConfig>;
    if (typeof parsed.url === "string" && typeof parsed.token === "string") {
      return { url: parsed.url, token: parsed.token };
    }
  } catch {
    // ignore invalid stored config
  }
  return null;
}

export function saveAgentConfig(config: StoredAgentConfig): void {
  write(CONFIG_KEY, JSON.stringify({ url: config.url, token: config.token }));
}

export function clearAgentConfig(): void {
  try {
    window.localStorage.removeItem(CONFIG_KEY);
    window.localStorage.removeItem(LAST_WORKSPACE_KEY);
  } catch {
    // ignore
  }
}

export function loadLastWorkspacePath(): string | null {
  return read(LAST_WORKSPACE_KEY);
}

export function saveLastWorkspacePath(path: string | null): void {
  if (path) write(LAST_WORKSPACE_KEY, path);
  else {
    try {
      window.localStorage.removeItem(LAST_WORKSPACE_KEY);
    } catch {
      // ignore
    }
  }
}

export function loadRecentWorkspaces(): string[] {
  const raw = read(RECENT_WORKSPACES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string").slice(0, 8);
    }
  } catch {
    // ignore
  }
  return [];
}

export function pushRecentWorkspace(path: string): void {
  const next = [path, ...loadRecentWorkspaces().filter((item) => item !== path)].slice(0, 8);
  write(RECENT_WORKSPACES_KEY, JSON.stringify(next));
}

export function loadPythonPath(): string {
  return read(PYTHON_KEY) ?? "";
}

export function savePythonPath(path: string): void {
  if (path.trim()) write(PYTHON_KEY, path.trim());
  else {
    try {
      window.localStorage.removeItem(PYTHON_KEY);
    } catch {
      // ignore
    }
  }
}

export function hasAcknowledgedLocalExecution(): boolean {
  return read(TRUST_KEY) === "1";
}

export function acknowledgeLocalExecution(): void {
  write(TRUST_KEY, "1");
}

export type PairingDetails = { url: string; token: string };

/**
 * Pairing links look like:
 *   http://localhost:3001/#agent=http%3A%2F%2F127.0.0.1%3A47821&token=<token>
 * The fragment never reaches a server.
 */
export function parsePairingHash(hash: string): PairingDetails | null {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!value) return null;
  const params = new URLSearchParams(value);
  const url = params.get("agent");
  const token = params.get("token");
  if (!url || !token) return null;
  return { url, token };
}
