"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeId, TerminalSessionInfo, WorkspaceSummary } from "@nagar/agent-protocol";
import { AgentClient, AgentClientError } from "./client";

export type TerminalPatch = Partial<
  Pick<TerminalSessionInfo, "status" | "exitCode" | "signal" | "cols" | "rows">
>;

export type UseTerminalsOptions = {
  client: AgentClient | null;
  workspace: WorkspaceSummary | null;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
};

export type TerminalController = {
  sessions: TerminalSessionInfo[];
  activeId: string | null;
  activeSession: TerminalSessionInfo | null;
  creating: boolean;
  select: (id: string | null) => void;
  createTerminal: (options?: {
    shellId?: string;
    cwd?: string;
  }) => Promise<TerminalSessionInfo | null>;
  runFile: (options: {
    path: string;
    runtime: RuntimeId;
    pythonPath?: string;
  }) => Promise<TerminalSessionInfo | null>;
  closeTerminal: (id: string) => Promise<void>;
  closeAll: () => Promise<void>;
  updateSession: (id: string, patch: TerminalPatch) => void;
  dismissAllLocal: () => void;
};

function messageFor(error: unknown): string {
  if (error instanceof AgentClientError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function useTerminals({
  client,
  workspace,
  notify,
}: UseTerminalsOptions): TerminalController {
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const workspaceId = workspace?.id ?? null;
  const workspaceIdRef = useRef<string | null>(workspaceId);
  workspaceIdRef.current = workspaceId;

  // Adopt sessions that already exist for this workspace (for example after a
  // browser reload) so their server-side scrollback can be attached again.
  useEffect(() => {
    if (!workspaceId) {
      setSessions([]);
      setActiveId(null);
      return;
    }
    setSessions([]);
    setActiveId(null);
    if (!client) return;
    let cancelled = false;
    void client
      .listTerminals(workspaceId)
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        setActiveId((current) => {
          if (current && list.some((session) => session.id === current)) return current;
          return list[list.length - 1]?.id ?? null;
        });
      })
      .catch(() => {
        // A disconnected agent is surfaced by the terminal view.
      });
    return () => {
      cancelled = true;
    };
  }, [client, workspaceId]);

  const addSession = useCallback((session: TerminalSessionInfo) => {
    setSessions((current) => [...current.filter((item) => item.id !== session.id), session]);
    setActiveId(session.id);
  }, []);

  const createTerminal = useCallback(
    async (
      options: { shellId?: string; cwd?: string } = {},
    ): Promise<TerminalSessionInfo | null> => {
      if (!client || !workspace) {
        notify("Open a workspace through the local agent before creating a terminal.", "info");
        return null;
      }
      setCreating(true);
      try {
        const session = await client.createTerminal({
          workspaceId: workspace.id,
          ...(options.shellId ? { shellId: options.shellId } : {}),
          ...(options.cwd ? { cwd: options.cwd } : {}),
          cols: 100,
          rows: 30,
        });
        addSession(session);
        return session;
      } catch (error) {
        notify(messageFor(error), "error");
        return null;
      } finally {
        setCreating(false);
      }
    },
    [addSession, client, notify, workspace],
  );

  const runFile = useCallback(
    async (options: {
      path: string;
      runtime: RuntimeId;
      pythonPath?: string;
    }): Promise<TerminalSessionInfo | null> => {
      if (!client || !workspace) {
        notify("Connect the local agent and open a workspace to run files.", "info");
        return null;
      }
      setCreating(true);
      try {
        const result = await client.runFile(workspace.id, {
          path: options.path,
          runtime: options.runtime,
          ...(options.pythonPath?.trim() ? { pythonPath: options.pythonPath.trim() } : {}),
          cols: 100,
          rows: 30,
        });
        addSession(result.session);
        return result.session;
      } finally {
        setCreating(false);
      }
    },
    [addSession, client, notify, workspace],
  );

  const closeTerminal = useCallback(
    async (id: string): Promise<void> => {
      const session = sessions.find((item) => item.id === id);
      try {
        if (client) await client.closeTerminal(id);
      } catch (error) {
        notify(messageFor(error), "error");
      } finally {
        setSessions((current) => {
          const next = current.filter((item) => item.id !== id);
          setActiveId((active) => {
            if (active !== id) return active;
            return next[next.length - 1]?.id ?? null;
          });
          return next;
        });
        if (session?.kind === "run") notify(`Stopped ${session.title}`, "info");
      }
    },
    [client, notify, sessions],
  );

  const closeAll = useCallback(async (): Promise<void> => {
    const current = sessions;
    setSessions([]);
    setActiveId(null);
    if (!client) return;
    await Promise.all(
      current.map((session) => client.closeTerminal(session.id).catch(() => undefined)),
    );
  }, [client, sessions]);

  const updateSession = useCallback((id: string, patch: TerminalPatch) => {
    setSessions((current) =>
      current.map((session) => (session.id === id ? { ...session, ...patch } : session)),
    );
  }, []);

  const dismissAllLocal = useCallback(() => {
    setSessions([]);
    setActiveId(null);
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [activeId, sessions],
  );

  return {
    sessions,
    activeId,
    activeSession,
    creating,
    select: setActiveId,
    createTerminal,
    runFile,
    closeTerminal,
    closeAll,
    updateSession,
    dismissAllLocal,
  };
}
