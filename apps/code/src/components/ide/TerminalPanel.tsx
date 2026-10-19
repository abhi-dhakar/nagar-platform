"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ShellInfo, TerminalSessionInfo } from "@nagar/agent-protocol";
import type { AgentClient } from "@/lib/agent/client";
import type { AgentState } from "@/lib/agent/useAgent";
import type { TerminalPatch } from "@/lib/agent/useTerminals";
import { IconCopy, IconPlus, IconTerminal, IconTrash } from "./Icons";
import { TerminalView, type TerminalViewHandle } from "./TerminalView";

type Props = {
  client: AgentClient | null;
  agentState: AgentState;
  agentUrl: string | null;
  workspaceName: string | null;
  sessions: TerminalSessionInfo[];
  activeId: string | null;
  shells: ShellInfo[];
  ptyAvailable: boolean;
  ptyReason?: string;
  creating: boolean;
  fontSize: number;
  fontFamily: string;
  lightTheme: boolean;
  onSelect: (id: string) => void;
  onNew: (shellId?: string) => void;
  onCloseSession: (id: string) => void;
  onSessionStatus: (id: string, patch: TerminalPatch) => void;
  onRefreshExplorer: () => void;
  onOpenAgent: () => void;
  onReconnect: () => void;
};

function statusLabel(session: TerminalSessionInfo): string {
  if (session.status === "running") return "running";
  if (session.signal) return `signal ${session.signal}`;
  if (session.exitCode !== null) return `exit ${session.exitCode}`;
  return "exited";
}

export function TerminalPanel({
  client,
  agentState,
  agentUrl,
  workspaceName,
  sessions,
  activeId,
  shells,
  ptyAvailable,
  ptyReason,
  creating,
  fontSize,
  fontFamily,
  lightTheme,
  onSelect,
  onNew,
  onCloseSession,
  onSessionStatus,
  onRefreshExplorer,
  onOpenAgent,
  onReconnect,
}: Props) {
  const [shellId, setShellId] = useState("");
  const activeSession = sessions.find((session) => session.id === activeId) ?? null;
  const viewRefs = useRef(new Map<string, TerminalViewHandle | null>());

  useEffect(() => {
    if (shells.length === 0) {
      setShellId("");
      return;
    }
    setShellId((current) =>
      current && shells.some((shell) => shell.id === current) ? current : shells[0]!.id,
    );
  }, [shells]);

  const getActiveView = () =>
    activeSession ? (viewRefs.current.get(activeSession.id) ?? null) : null;
  const connected = agentState === "connected" && Boolean(client);
  const shellOptions = useMemo(
    () => shells.map((shell) => ({ id: shell.id, label: `${shell.label} — ${shell.path}` })),
    [shells],
  );

  if (!connected) {
    return (
      <div className="ide-terminal-empty">
        <div className="ide-terminal-empty-card">
          <h4>Local agent {agentState === "connecting" ? "connecting…" : "not connected"}</h4>
          <p>
            NagarCode runs terminals through a separate loopback-only agent on your computer. Cloud
            containers are not used.
          </p>
          <div className="ide-terminal-empty-actions">
            {agentUrl ? (
              <button className="ide-primary-btn" onClick={onReconnect}>
                Reconnect to {agentUrl}
              </button>
            ) : (
              <button className="ide-primary-btn" onClick={onOpenAgent}>
                Connect local agent
              </button>
            )}
            <button className="ide-secondary-btn" onClick={onOpenAgent}>
              Agent settings
            </button>
          </div>
          <p className="ide-muted small">
            Start it with <code className="ide-inline-code">pnpm agent</code> and paste the token,
            or open the pairing link printed by the agent.
          </p>
        </div>
      </div>
    );
  }

  if (!workspaceName) {
    return (
      <div className="ide-terminal-empty">
        <div className="ide-terminal-empty-card">
          <h4>Open a local workspace</h4>
          <p>
            Terminals start inside an authorized workspace. Open a project folder through the agent
            first.
          </p>
          <div className="ide-terminal-empty-actions">
            <button className="ide-primary-btn" onClick={onOpenAgent}>
              Open workspace…
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ide-terminal-panel">
      <div className="ide-terminal-bar">
        <div className="ide-terminal-tabs" role="tablist" aria-label="Terminal sessions">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`ide-terminal-tab ${session.id === activeId ? "active" : ""} ${session.status === "exited" ? "exited" : ""}`}
              role="tab"
              aria-selected={session.id === activeId}
              onClick={() => onSelect(session.id)}
              title={`${session.title} — ${session.cwd}`}
            >
              <span className={`ide-terminal-dot ${session.status}`} aria-hidden="true" />
              <span className="ide-terminal-tab-label">{session.title}</span>
              <button
                className="ide-terminal-tab-close"
                aria-label={`Close ${session.title}`}
                title={session.status === "running" ? "Kill and close" : "Close"}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseSession(session.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
          {sessions.length === 0 ? (
            <span className="ide-terminal-tabs-empty">No terminals</span>
          ) : null}
        </div>

        <div className="ide-terminal-actions">
          <select
            className="ide-select tiny"
            aria-label="Shell for new terminal"
            value={shellId}
            onChange={(event) => setShellId(event.target.value)}
            title="Shell for the next terminal"
          >
            {shellOptions.length === 0 ? <option value="">No shell detected</option> : null}
            {shellOptions.map((shell) => (
              <option key={shell.id} value={shell.id}>
                {shell.label}
              </option>
            ))}
          </select>
          <button
            className="ide-terminal-action"
            onClick={() => onNew(shellId || undefined)}
            disabled={creating || shells.length === 0}
            title="New terminal"
          >
            <IconPlus width={14} height={14} /> New
          </button>
          <span className="ide-terminal-action-sep" />
          <button
            className="ide-terminal-action"
            disabled={!activeSession}
            onClick={() => void getActiveView()?.copy()}
            title="Copy selection (Ctrl+Shift+C)"
          >
            <IconCopy width={14} height={14} /> Copy
          </button>
          <button
            className="ide-terminal-action"
            disabled={!activeSession}
            onClick={() => void getActiveView()?.paste()}
            title="Paste (Ctrl+Shift+V)"
          >
            Paste
          </button>
          <button
            className="ide-terminal-action"
            disabled={!activeSession}
            onClick={() => getActiveView()?.clear()}
            title="Clear the terminal view"
          >
            Clear
          </button>
          <button
            className="ide-terminal-action danger"
            disabled={!activeSession}
            onClick={() => activeSession && onCloseSession(activeSession.id)}
            title={activeSession?.status === "running" ? "Kill the process" : "Remove the session"}
          >
            <IconTrash width={14} height={14} />{" "}
            {activeSession?.status === "running" ? "Kill" : "Remove"}
          </button>
        </div>
      </div>

      {activeSession ? (
        <div className="ide-terminal-meta">
          <span className="ide-terminal-meta-item">
            <IconTerminal width={12} height={12} /> {activeSession.title}
          </span>
          <span className="ide-terminal-meta-item mono" title={activeSession.commandLine}>
            {activeSession.cwd}
          </span>
          <span className="ide-terminal-meta-item">{activeSession.pty ? "PTY" : "pipes"}</span>
          <span className={`ide-terminal-meta-item status ${activeSession.status}`}>
            {statusLabel(activeSession)}
          </span>
          <span className="ide-terminal-meta-spacer" />
          <span className="ide-terminal-meta-item muted">
            {activeSession.cols}×{activeSession.rows}
          </span>
        </div>
      ) : null}

      <div className="ide-terminal-body">
        {sessions.length === 0 ? (
          <div className="ide-terminal-empty">
            <div className="ide-terminal-empty-card compact">
              <h4>No terminal sessions</h4>
              <p>
                Start a shell in <strong>{workspaceName}</strong>. Commands run as your user with
                your real permissions on this computer — only run code you trust.
              </p>
              <div className="ide-terminal-empty-actions">
                <button
                  className="ide-primary-btn"
                  onClick={() => onNew(shellId || undefined)}
                  disabled={creating || shells.length === 0}
                >
                  {creating ? "Starting…" : "New terminal"}
                </button>
              </div>
              {!ptyAvailable ? (
                <p className="ide-terminal-warning">
                  PTY unavailable: {ptyReason ?? "the native terminal module is not installed"}.
                  Commands still run, but resizing and job control are limited.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        {sessions.map((session) => (
          <TerminalView
            key={session.id}
            ref={(handle) => {
              if (handle) viewRefs.current.set(session.id, handle);
              else viewRefs.current.delete(session.id);
            }}
            client={client}
            session={session}
            active={session.id === activeId}
            fontSize={fontSize}
            fontFamily={fontFamily}
            lightTheme={lightTheme}
            onSessionStatus={(patch) => onSessionStatus(session.id, patch)}
            onRefreshExplorer={onRefreshExplorer}
          />
        ))}
      </div>
    </div>
  );
}
