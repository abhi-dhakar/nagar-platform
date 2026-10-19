"use client";

import type { RuntimeAvailability } from "@nagar/agent-protocol";
import { getLanguageFromPath } from "@/lib/utils";
import type { AgentState } from "@/lib/agent/useAgent";
import type { Tab } from "./EditorTabs";
import { IconPlug, IconTerminal } from "./Icons";

export function StatusBar({
  activeTab,
  cursor,
  workspaceName,
  settingsSummary,
  onToggleBottom,
  bottomOpen,
  hasBottom,
  agentState,
  agentUrl,
  agentWorkspaceRoot,
  runtimes,
  terminalsActive,
  onOpenAgent,
}: {
  activeTab: Tab | null;
  cursor: { line: number; col: number } | null;
  workspaceName: string | null;
  settingsSummary: string;
  onToggleBottom: () => void;
  bottomOpen: boolean;
  hasBottom: boolean;
  agentState: AgentState;
  agentUrl: string | null;
  agentWorkspaceRoot: string | null;
  runtimes: RuntimeAvailability[];
  terminalsActive: number;
  onOpenAgent: () => void;
}) {
  const agentLabel =
    agentState === "connected"
      ? "Agent connected"
      : agentState === "connecting"
        ? "Agent connecting…"
        : agentState === "error"
          ? "Agent error"
          : "Agent offline";
  return (
    <div className="ide-statusbar" role="status" aria-label="Status bar">
      <div className="ide-status-left">
        <span className="ide-status-item brand">
          <span className="ide-status-mark">N</span> NagarCode
        </span>
        <span
          className="ide-status-item"
          title={agentWorkspaceRoot ?? workspaceName ?? "No workspace"}
        >
          {workspaceName ?? "No folder"}
        </span>
        {activeTab ? (
          <>
            <span className="ide-status-sep">›</span>
            <span className="ide-status-item mono" title={activeTab.path}>
              {activeTab.path}
            </span>
            <span className={`ide-status-item ${activeTab.isDirty ? "is-dirty" : "is-saved"}`}>
              {activeTab.isDirty ? "● Modified" : "✓ Saved"}
            </span>
          </>
        ) : null}
      </div>

      <div className="ide-status-right">
        <button
          className={`ide-status-agent ${agentState}`}
          onClick={onOpenAgent}
          title={
            agentState === "connected"
              ? `Local agent at ${agentUrl}. Files, terminals, and runtimes execute on this computer.`
              : "Connect the loopback-only local development agent."
          }
        >
          <span
            className={`ide-status-dot ${agentState === "connected" ? "ok" : agentState === "error" ? "bad" : "warn"}`}
          />
          <IconPlug width={11} height={11} />
          {agentLabel}
        </button>
        {agentState === "connected" ? (
          <span className="ide-status-runtimes" title="Runtime availability on the local agent">
            {runtimes.map((runtime) => (
              <span
                key={runtime.id}
                className={`ide-status-runtime ${runtime.available ? "ok" : "bad"}`}
                title={`${runtime.label}: ${runtime.available ? (runtime.version ?? "available") : (runtime.reason ?? "unavailable")}`}
              >
                {runtime.id === "javascript" ? "JS" : runtime.id === "typescript" ? "TS" : "PY"}
              </span>
            ))}
          </span>
        ) : null}
        <button
          className={`ide-status-terminals ${terminalsActive > 0 ? "active" : ""}`}
          onClick={onToggleBottom}
          title="Toggle the terminal panel"
        >
          <IconTerminal width={11} height={11} />{" "}
          {terminalsActive > 0 ? `${terminalsActive} running` : "Terminal"}
        </button>
        {activeTab ? (
          <>
            <span className="ide-status-sep">·</span>
            <span className="ide-status-item mono">{getLanguageFromPath(activeTab.path)}</span>
            <span className="ide-status-sep">·</span>
            <span className="ide-status-item mono">
              Ln {cursor?.line ?? 1}, Col {cursor?.col ?? 1}
            </span>
            <span className="ide-status-sep">·</span>
            <span className="ide-status-item" title={settingsSummary}>
              {settingsSummary}
            </span>
          </>
        ) : null}
        {hasBottom ? (
          <button
            className={`ide-status-toggle ${bottomOpen ? "active" : ""}`}
            onClick={onToggleBottom}
            aria-label={bottomOpen ? "Hide panel" : "Show panel"}
            title={bottomOpen ? "Hide panel" : "Show panel"}
          >
            {bottomOpen ? "⌄" : "⌃"} Panel
          </button>
        ) : null}
        <span className="ide-status-item hide-mobile">UTF-8</span>
        <span className="ide-status-item hide-mobile">LF</span>
      </div>
    </div>
  );
}
