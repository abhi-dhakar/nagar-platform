"use client";

import { useState } from "react";
import type { WorkspaceEntry, WorkspaceService } from "@/lib/workspace/types";
import { FileTree } from "./FileTree";
import { IconNewFile, IconNewFolder, IconRefresh } from "./Icons";

export function Explorer({
  workspace,
  workspaceName,
  onOpenFolder,
  onSelectFile,
  expanded,
  onToggle,
  onCollapseAll,
  selectedPath,
  onAction,
  onRefresh,
  isSupported,
}: {
  workspace: WorkspaceService | null;
  workspaceName: string | null;
  onOpenFolder: () => void;
  onSelectFile: (entry: WorkspaceEntry) => void;
  expanded: Set<string>;
  onToggle: (p: string) => void;
  onCollapseAll: () => void;
  selectedPath: string | null;
  onAction: (action: string, targetPath: string | null, kind?: "file" | "directory") => void;
  onRefresh: () => void;
  isSupported: boolean;
}) {
  const [showTip, setShowTip] = useState(true);

  return (
    <div className="ide-explorer">
      <div className="ide-sidebar-header">
        <h2 className="ide-sidebar-title">Explorer</h2>
        <div className="ide-sidebar-actions">
          <button
            className="ide-icon-btn"
            title="New File…"
            aria-label="New File"
            onClick={() => onAction("newFile", "/")}
          >
            <IconNewFile width={16} height={16} />
          </button>
          <button
            className="ide-icon-btn"
            title="New Folder…"
            aria-label="New Folder"
            onClick={() => onAction("newFolder", "/")}
          >
            <IconNewFolder width={16} height={16} />
          </button>
          <button
            className="ide-icon-btn"
            title="Refresh Explorer"
            aria-label="Refresh"
            onClick={onRefresh}
            disabled={!workspace}
          >
            <IconRefresh width={16} height={16} />
          </button>
          <button
            className="ide-icon-btn"
            title="Collapse All"
            aria-label="Collapse All"
            onClick={onCollapseAll}
            disabled={!workspace}
          >
            <span aria-hidden="true">≪</span>
          </button>
        </div>
      </div>

      <div className="ide-explorer-workspace">
        <div className="ide-workspace-label">
          <span className="ide-workspace-name" title={workspaceName ?? "No folder selected"}>
            {workspaceName ?? "No folder selected"}
          </span>
          <span className={`ide-workspace-badge ${workspace?.isNative ? "native" : "memory"}`}>
            {workspace?.isNative ? "LOCAL" : workspace ? "MEMORY" : "—"}
          </span>
        </div>
        <button className="ide-open-folder-btn" onClick={onOpenFolder}>
          <span className="ide-open-folder-icon">⧉</span> Open Folder
        </button>
        {!isSupported && showTip ? (
          <div className="ide-tip">
            <div className="ide-tip-head">
              <strong>Browser tip</strong>
              <button
                className="ide-tip-close"
                onClick={() => setShowTip(false)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
            <p>
              Your browser doesn&apos;t support the File System Access API. NagarCode will use an
              in-memory workspace that persists in this tab. For full local file access, open in
              Chrome or Edge and use <em>Open Folder</em>.
            </p>
          </div>
        ) : null}
      </div>

      <div className="ide-explorer-tree">
        {workspace ? (
          <FileTree
            workspace={workspace}
            expanded={expanded}
            selectedPath={selectedPath}
            onToggle={onToggle}
            onSelect={onSelectFile}
            onRefresh={onRefresh}
            onContextAction={onAction}
          />
        ) : (
          <div className="ide-empty-state">
            <div className="ide-empty-icon">◰</div>
            <h3>No folder opened</h3>
            <p>
              Open a local folder to edit real files, or stay in the demo workspace and create files
              in memory.
            </p>
            <button className="ide-primary-btn" onClick={onOpenFolder}>
              Open Folder…
            </button>
            <div className="ide-empty-actions">
              <button className="ide-secondary-btn" onClick={() => onAction("newFile", "/")}>
                New untitled file
              </button>
            </div>
            <ul className="ide-empty-list">
              <li>
                <span className="ide-kbd">Ctrl</span> + <span className="ide-kbd">S</span> to save
              </li>
              <li>
                <span className="ide-kbd">Ctrl</span> + <span className="ide-kbd">⇧</span> +{" "}
                <span className="ide-kbd">P</span> commands
              </li>
              <li>Right-click for file actions</li>
            </ul>
          </div>
        )}
      </div>

      <div className="ide-sidebar-footer">
        <div className="ide-sidebar-footer-title">Timeline</div>
        <p className="ide-muted">Local history and outline will appear here in a future phase.</p>
      </div>
    </div>
  );
}
