"use client";

import { useState } from "react";
import { IconOutput, IconTerminal } from "./Icons";

export type BottomTabId = "terminal" | "output" | "problems";

export function BottomPanel({
  open,
  onClose,
  height,
  onHeightChange,
}: {
  open: boolean;
  onClose: () => void;
  height: number;
  onHeightChange: (h: number) => void;
}) {
  const [active, setActive] = useState<BottomTabId>("terminal");

  if (!open) return null;

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
        <button className={`ide-bottom-tab ${active === "terminal" ? "active" : ""}`} onClick={() => setActive("terminal")}>
          <IconTerminal width={14} height={14} /> Terminal
        </button>
        <button className={`ide-bottom-tab ${active === "output" ? "active" : ""}`} onClick={() => setActive("output")}>
          <IconOutput width={14} height={14} /> Output
        </button>
        <button className={`ide-bottom-tab ${active === "problems" ? "active" : ""}`} onClick={() => setActive("problems")}>
          <span aria-hidden="true">⚠</span> Problems
        </button>
        <div className="ide-bottom-spacer" />
        <button className="ide-bottom-close" onClick={onClose} aria-label="Hide panel" title="Hide panel">
          ×
        </button>
      </div>

      <div className="ide-bottom-content">
        {active === "terminal" ? (
          <div className="ide-bottom-placeholder">
            <div className="ide-bottom-placeholder-card">
              <h4>Terminal — reserved for Phase 2</h4>
              <p>
                A real integrated terminal needs an isolated workspace agent. For now this area is a placeholder — no
                shell is executed.
              </p>
              <p className="ide-muted">
                Next step: connect to a local agent that can spawn a pty inside the workspace container and stream
                through WebSockets (xterm.js on the frontend).
              </p>
              <code className="ide-code-block">$ npm run dev — not executed in this phase</code>
            </div>
          </div>
        ) : null}
        {active === "output" ? (
          <div className="ide-bottom-log">
            <div className="ide-log-line">[NagarCode] Workspace service initialized.</div>
            <div className="ide-log-line">[NagarCode] Editor ready. Press Ctrl+Shift+P for commands.</div>
            <div className="ide-log-line ide-muted">Output channel is ready for extension logs in a future phase.</div>
          </div>
        ) : null}
        {active === "problems" ? (
          <div className="ide-bottom-placeholder">
            <div className="ide-bottom-placeholder-card">
              <h4>No problems detected</h4>
              <p className="ide-muted">Diagnostics from the language server will appear here when connected.</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
