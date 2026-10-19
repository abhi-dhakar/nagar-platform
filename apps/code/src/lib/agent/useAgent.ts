"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentStatus, RuntimeAvailability, WorkspaceSummary } from "@nagar/agent-protocol";
import {
  AgentClient,
  AgentClientError,
  assertAgentToken,
  isLoopbackPage,
  normalizeAgentUrl,
} from "./client";
import { AgentWorkspace } from "./workspace";
import {
  clearAgentConfig,
  loadAgentConfig,
  loadLastWorkspacePath,
  loadPythonPath,
  pushRecentWorkspace,
  saveAgentConfig,
  saveLastWorkspacePath,
  savePythonPath,
  type StoredAgentConfig,
} from "./storage";

export type AgentState = "disconnected" | "connecting" | "connected" | "error";

export type AgentNotice = {
  message: string;
  kind: "info" | "success" | "error";
};

export type UseAgentOptions = {
  notify: (message: string, kind?: AgentNotice["kind"]) => void;
};

export type AgentController = {
  state: AgentState;
  client: AgentClient | null;
  status: AgentStatus | null;
  workspace: WorkspaceSummary | null;
  service: AgentWorkspace | null;
  config: StoredAgentConfig | null;
  pythonPath: string;
  error: string | null;
  errorCode: string | null;
  errorHint: string | null;
  connecting: boolean;
  connect: (url: string, token: string) => Promise<boolean>;
  reconnect: () => Promise<boolean>;
  disconnect: (options?: { forget?: boolean }) => Promise<void>;
  refresh: (silent?: boolean) => Promise<void>;
  openWorkspace: (path: string) => Promise<WorkspaceSummary | null>;
  closeWorkspace: () => Promise<void>;
  refreshRuntimes: (pythonPath?: string) => Promise<void>;
  setPythonPath: (value: string) => void;
  runtimes: RuntimeAvailability[];
};

function messageFor(error: unknown): string {
  if (error instanceof AgentClientError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function codeFor(error: unknown): string | null {
  return error instanceof AgentClientError ? error.code : null;
}

export function useAgent({ notify }: UseAgentOptions): AgentController {
  const [state, setState] = useState<AgentState>("disconnected");
  const [client, setClient] = useState<AgentClient | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [config, setConfig] = useState<StoredAgentConfig | null>(null);
  const [pythonPath, setPythonPathState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const pythonPathRef = useRef("");
  const autoConnectStarted = useRef(false);
  const offlineNotified = useRef(false);

  const service = useMemo(
    () => (client && workspace ? new AgentWorkspace(client, workspace) : null),
    [client, workspace],
  );

  const setPythonPath = useCallback((value: string) => {
    setPythonPathState(value);
    pythonPathRef.current = value;
    savePythonPath(value);
  }, []);

  const connect = useCallback(
    async (url: string, token: string, silent = false): Promise<boolean> => {
      setState("connecting");
      setError(null);
      setErrorCode(null);
      offlineNotified.current = false;
      let nextClient: AgentClient;
      try {
        nextClient = new AgentClient(normalizeAgentUrl(url), assertAgentToken(token));
      } catch (caught) {
        setState("error");
        setError(messageFor(caught));
        setErrorCode(codeFor(caught));
        if (!silent) notify(messageFor(caught), "error");
        return false;
      }
      try {
        const nextStatus = await nextClient.status();
        const lastPath = loadLastWorkspacePath();
        const selected =
          (lastPath ? nextStatus.workspaces.find((item) => item.root === lastPath) : undefined) ??
          nextStatus.workspace ??
          null;
        setClient(nextClient);
        setConfig({ url: nextClient.baseUrl, token: nextClient.token });
        saveAgentConfig({ url: nextClient.baseUrl, token: nextClient.token });
        setStatus(nextStatus);
        setWorkspace(selected);
        if (selected) saveLastWorkspacePath(selected.root);
        setState("connected");
        if (pythonPathRef.current.trim()) {
          try {
            const runtimes = await nextClient.runtimes(selected?.id ?? null, pythonPathRef.current);
            setStatus((current) =>
              current ? { ...current, runtimes: runtimes.runtimes } : current,
            );
          } catch {
            // The default runtimes from status are still usable.
          }
        }
        if (!silent) notify(`Connected to the local agent at ${nextClient.baseUrl}`, "success");
        return true;
      } catch (caught) {
        setState("error");
        setError(messageFor(caught));
        setErrorCode(codeFor(caught));
        if (!silent) notify(messageFor(caught), "error");
        return false;
      }
    },
    [notify],
  );

  const refreshStatus = useCallback(
    async (silent = true): Promise<void> => {
      if (!client) return;
      try {
        const nextStatus = await client.status();
        setStatus(nextStatus);
        setError(null);
        setErrorCode(null);
        offlineNotified.current = false;
        setWorkspace((current) => {
          if (!current) return current;
          const fresh = nextStatus.workspaces.find((item) => item.id === current.id);
          return fresh ?? current;
        });
      } catch (caught) {
        setState("disconnected");
        setError(messageFor(caught));
        setErrorCode(codeFor(caught));
        if (!silent) notify(messageFor(caught), "error");
        else if (!offlineNotified.current) {
          offlineNotified.current = true;
          notify(
            "Lost the connection to the local agent. Reconnect when it is available.",
            "error",
          );
        }
      }
    },
    [client, notify],
  );

  // Restore a previously paired agent once, after hydration.
  useEffect(() => {
    if (autoConnectStarted.current) return;
    autoConnectStarted.current = true;
    const stored = loadAgentConfig();
    const savedPython = loadPythonPath();
    if (savedPython) {
      pythonPathRef.current = savedPython;
      setPythonPathState(savedPython);
    }
    // A pairing link in the URL fragment takes precedence over stored settings;
    // the page strips the fragment and connects explicitly.
    if (typeof window !== "undefined" && window.location.hash.includes("agent=")) return;
    if (stored) {
      setConfig(stored);
      void connect(stored.url, stored.token, true);
    }
  }, [connect]);

  // Keep status, runtime availability, and workspace metadata fresh.
  useEffect(() => {
    if (state !== "connected" || !client) return;
    const timer = window.setInterval(() => {
      void refreshStatus(true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [client, refreshStatus, state]);

  const reconnect = useCallback(async (): Promise<boolean> => {
    if (!config) {
      notify("No saved agent configuration. Connect with a URL and token first.", "info");
      return false;
    }
    return connect(config.url, config.token, false);
  }, [config, connect, notify]);

  const disconnect = useCallback(async (options: { forget?: boolean } = {}): Promise<void> => {
    setClient(null);
    setState("disconnected");
    setStatus(null);
    setWorkspace(null);
    setError(null);
    setErrorCode(null);
    offlineNotified.current = false;
    if (options.forget) {
      clearAgentConfig();
      setConfig(null);
      saveLastWorkspacePath(null);
    }
  }, []);

  const refreshRuntimes = useCallback(
    async (override?: string): Promise<void> => {
      if (!client) return;
      const requested = override ?? pythonPathRef.current;
      const result = await client.runtimes(workspace?.id ?? null, requested);
      setStatus((current) => (current ? { ...current, runtimes: result.runtimes } : current));
    },
    [client, workspace?.id],
  );

  const openWorkspace = useCallback(
    async (path: string): Promise<WorkspaceSummary | null> => {
      if (!client) {
        notify("Connect the local agent before opening a local workspace.", "info");
        return null;
      }
      try {
        const summary = await client.openWorkspace(path);
        const previous = workspace;
        setWorkspace(summary);
        setStatus((current) => {
          if (!current) return current;
          const workspaces = [
            summary,
            ...current.workspaces.filter((item) => item.id !== summary.id),
          ];
          return { ...current, workspace: summary, workspaces };
        });
        saveLastWorkspacePath(summary.root);
        pushRecentWorkspace(summary.root);
        if (previous && previous.id !== summary.id) {
          void client.closeWorkspace(previous.id).catch(() => undefined);
        }
        try {
          const runtimes = await client.runtimes(summary.id, pythonPathRef.current);
          setStatus((current) => (current ? { ...current, runtimes: runtimes.runtimes } : current));
        } catch {
          // Keep the detected runtimes from status.
        }
        return summary;
      } catch (caught) {
        notify(messageFor(caught), "error");
        return null;
      }
    },
    [client, notify, workspace],
  );

  const closeWorkspace = useCallback(async (): Promise<void> => {
    if (!client || !workspace) return;
    try {
      await client.closeWorkspace(workspace.id);
    } catch (caught) {
      notify(messageFor(caught), "error");
    }
    setWorkspace(null);
    saveLastWorkspacePath(null);
    setStatus((current) =>
      current
        ? {
            ...current,
            workspace: null,
            workspaces: current.workspaces.filter((item) => item.id !== workspace.id),
          }
        : current,
    );
  }, [client, notify, workspace]);

  const errorHint = useMemo(() => {
    if (!error) return null;
    if (errorCode === "FORBIDDEN_ORIGIN") {
      return "The agent rejects this page's origin. Restart it with --allow-origin <this origin> and reconnect.";
    }
    if (errorCode === "UNAUTHORIZED") {
      return "The saved token is no longer valid. Agents generate a new token each start; copy the current one.";
    }
    if (errorCode === "AGENT_UNREACHABLE") {
      return isLoopbackPage()
        ? "Start the agent with `pnpm agent` in the NagarCode repository and keep that terminal open."
        : "This page is not served from your computer, so it cannot reach your local agent. Run NagarCode locally at http://localhost:3001 or allow this origin and use a local browser.";
    }
    return null;
  }, [error, errorCode]);

  return {
    state,
    client,
    status,
    workspace,
    service,
    config,
    pythonPath,
    error,
    errorCode,
    errorHint,
    connecting: state === "connecting",
    connect: (url, token) => connect(url, token, false),
    reconnect,
    disconnect,
    refresh: refreshStatus,
    openWorkspace,
    closeWorkspace,
    refreshRuntimes,
    setPythonPath,
    runtimes: status?.runtimes ?? [],
  };
}
