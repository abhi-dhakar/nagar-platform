"use client";

import type { RuntimeAvailability, RuntimeId } from "@nagar/agent-protocol";
import type { AgentState } from "@/lib/agent/useAgent";
import { RUNTIME_LABELS, RUNTIME_SHORT_LABELS } from "@/lib/agent/runtime";
import type { Tab } from "./EditorTabs";
import { IconPlay, IconSave, IconStop } from "./Icons";

type Props = {
  activeTab: Tab | null;
  runtimeId: RuntimeId | null;
  runtime: RuntimeAvailability | null;
  agentState: AgentState;
  saving: boolean;
  running: boolean;
  onRun: () => void;
  onStop: () => void;
  onSave: () => void;
  onOpenAgent: () => void;
};

export function EditorToolbar({
  activeTab,
  runtimeId,
  runtime,
  agentState,
  saving,
  running,
  onRun,
  onStop,
  onSave,
  onOpenAgent,
}: Props) {
  if (!activeTab) {
    return (
      <div className="ide-editor-toolbar empty">
        <span className="ide-toolbar-hint">No file open — choose a file in the Explorer.</span>
      </div>
    );
  }

  const segments = activeTab.path.split("/").filter(Boolean);
  const file = segments[segments.length - 1] ?? activeTab.path;
  const folder = segments.slice(0, -1).join("/");
  const connected = agentState === "connected";
  const runtimeAvailable = Boolean(runtime?.available);
  const canRun = connected && Boolean(runtimeId) && runtimeAvailable && !saving;
  const runTitle = !runtimeId
    ? "Run supports JavaScript, TypeScript, and Python files in this phase."
    : !connected
      ? "Connect the local agent to execute code on this computer."
      : !runtimeAvailable
        ? (runtime?.reason ?? `${runtimeId} is not available on the local agent.`)
        : `Run ${file} with ${runtime?.label ?? RUNTIME_LABELS[runtimeId]}. The file is saved first if needed.`;

  return (
    <div className="ide-editor-toolbar">
      <div className="ide-toolbar-path" title={activeTab.path}>
        {folder ? <span className="ide-toolbar-folder">{folder}/</span> : null}
        <span className="ide-toolbar-file">{file}</span>
        {activeTab.isDirty ? <span className="ide-toolbar-dirty">modified</span> : null}
      </div>

      <div className="ide-toolbar-actions">
        {runtimeId ? (
          <button
            className={`ide-runtime-chip ${runtimeAvailable && connected ? "available" : "unavailable"}`}
            onClick={onOpenAgent}
            title={
              runtime
                ? `${runtime.label}${runtime.version ? ` ${runtime.version}` : ""}${runtime.strategy ? ` (${runtime.strategy})` : ""}. ${runtime.reason ?? ""}`
                : `${RUNTIME_LABELS[runtimeId]} status`
            }
          >
            <span className={`ide-status-dot ${runtimeAvailable && connected ? "ok" : "warn"}`} />
            {RUNTIME_SHORT_LABELS[runtimeId]}
            <span className="ide-runtime-chip-detail">
              {!connected
                ? "agent offline"
                : runtimeAvailable
                  ? (runtime?.version ?? "available")
                  : "unavailable"}
            </span>
          </button>
        ) : (
          <span
            className="ide-runtime-chip unavailable"
            title="Only JavaScript, TypeScript, and Python can run in this phase."
          >
            <span className="ide-status-dot warn" /> no runtime
          </span>
        )}

        {!connected ? (
          <button className="ide-secondary-btn small" onClick={onOpenAgent}>
            Connect agent
          </button>
        ) : null}

        <button
          className="ide-toolbar-btn"
          onClick={onSave}
          disabled={saving || !activeTab.isDirty}
          title="Save (Ctrl+S)"
        >
          <IconSave width={13} height={13} /> {saving ? "Saving…" : "Save"}
        </button>

        {running ? (
          <button className="ide-run-btn stop" onClick={onStop} title="Stop the running process">
            <IconStop width={12} height={12} /> Stop
          </button>
        ) : (
          <button className="ide-run-btn" onClick={onRun} disabled={!canRun} title={runTitle}>
            <IconPlay width={12} height={12} /> Run
          </button>
        )}
      </div>
    </div>
  );
}
