"use client";

import { getLanguageFromPath } from "@/lib/utils";
import type { Tab } from "./EditorTabs";

export function StatusBar({
  activeTab,
  cursor,
  workspaceName,
  settingsSummary,
  onToggleBottom,
  bottomOpen,
  hasBottom,
}: {
  activeTab: Tab | null;
  cursor: { line: number; col: number } | null;
  workspaceName: string | null;
  settingsSummary: string;
  onToggleBottom: () => void;
  bottomOpen: boolean;
  hasBottom: boolean;
}) {
  return (
    <div className="ide-statusbar" role="status" aria-label="Status bar">
      <div className="ide-status-left">
        <span className="ide-status-item brand">
          <span className="ide-status-mark">N</span> NagarCode
        </span>
        <span className="ide-status-item" title={workspaceName ?? "No workspace"}>
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
        {activeTab ? (
          <>
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
