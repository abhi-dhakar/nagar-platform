"use client";

import type { ComponentProps } from "react";
import { IconOutput, IconTerminal } from "./Icons";
import { TerminalPanel } from "./TerminalPanel";

export type BottomTabId = "terminal" | "output" | "problems";

export function BottomPanel({
  open,
  onClose,
  height,
  onHeightChange,
  activeTab,
  onTabChange,
  terminal,
}: {
  open: boolean;
  onClose: () => void;
  height: number;
  onHeightChange: (h: number) => void;
  activeTab: BottomTabId;
  onTabChange: (tab: BottomTabId) => void;
  terminal: ComponentProps<typeof TerminalPanel>;
}) {
  if (!open) return null;

  const running = terminal.sessions.filter((session) => session.status === "running").length;

  return (
    <div className="ide-bottom-panel" style={{ height }} role="region" aria-label="Panel">
      <div
        className="ide-bottom-resizer"
        onMouseDown={(e) => {
          const startY = e.clientY;
          const startH = height;
          const onMove = (ev: MouseEvent) => {
            const delta = startY - ev.clientY;
            const next = Math.max(120, Math.min(480, startH + delta));
            onHeightChange(next);
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }}
        aria-hidden="true"
      />
      <div className="ide-bottom-tabs">
        <button
          className={`ide-bottom-tab ${activeTab === "terminal" ? "active" : ""}`}
          onClick={() => onTabChange("terminal")}
        >
          <IconTerminal width={14} height={14} /> Terminal
          {terminal.sessions.length > 0 ? (
            <span className={`ide-bottom-badge ${running > 0 ? "live" : ""}`}>
              {running > 0 ? `${running} running` : terminal.sessions.length}
            </span>
          ) : null}
        </button>
        <button
          className={`ide-bottom-tab ${activeTab === "output" ? "active" : ""}`}
          onClick={() => onTabChange("output")}
        >
          <IconOutput width={14} height={14} /> Output
        </button>
        <button
          className={`ide-bottom-tab ${activeTab === "problems" ? "active" : ""}`}
          onClick={() => onTabChange("problems")}
        >
          <span aria-hidden="true">⚠</span> Problems
        </button>
        <div className="ide-bottom-spacer" />
        <button
          className="ide-bottom-close"
          onClick={onClose}
          aria-label="Hide panel"
          title="Hide panel"
        >
          ×
        </button>
      </div>

      <div className={`ide-bottom-content ${activeTab === "terminal" ? "terminal" : ""}`}>
        {activeTab === "terminal" ? <TerminalPanel {...terminal} /> : null}
        {activeTab === "output" ? (
          <div className="ide-bottom-log">
            <div className="ide-log-line">[NagarCode] Workspace service initialized.</div>
            <div className="ide-log-line">
              [NagarCode] Editor ready. Press Ctrl+Shift+P for commands.
            </div>
            <div className="ide-log-line">
              [NagarCode]{" "}
              {terminal.agentState === "connected"
                ? `Local agent connected at ${terminal.agentUrl}`
                : "Local agent is not connected."}
            </div>
            <div className="ide-log-line ide-muted">
              stdout/stderr from real processes appear in the Terminal tab, not here.
            </div>
          </div>
        ) : null}
        {activeTab === "problems" ? (
          <div className="ide-bottom-placeholder">
            <div className="ide-bottom-placeholder-card">
              <h4>No problems detected</h4>
              <p className="ide-muted">
                Syntax errors from TypeScript runs appear in the terminal with their file, line, and
                column.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
