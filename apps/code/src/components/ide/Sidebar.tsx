"use client";

import type { ActivityId } from "./ActivityBar";
import { Explorer } from "./Explorer";
import { SearchPanel } from "./SearchPanel";
import { SettingsPanel } from "./SettingsPanel";
import { Placeholder } from "./Placeholder";
import type { WorkspaceEntry, WorkspaceService } from "@/lib/workspace/types";

export function Sidebar({
  active,
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
  onOpenFile,
}: {
  active: ActivityId;
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
  onOpenFile: (path: string, line?: number) => void;
}) {
  return (
    <div className="ide-sidebar">
      {active === "explorer" ? (
        <Explorer
          workspace={workspace}
          workspaceName={workspaceName}
          onOpenFolder={onOpenFolder}
          onSelectFile={onSelectFile}
          expanded={expanded}
          onToggle={onToggle}
          onCollapseAll={onCollapseAll}
          selectedPath={selectedPath}
          onAction={onAction}
          onRefresh={onRefresh}
          isSupported={isSupported}
        />
      ) : null}
      {active === "search" ? <SearchPanel workspace={workspace} onOpenFile={onOpenFile} /> : null}
      {active === "scm" ? (
        <Placeholder
          icon="⎇"
          title="Source Control"
          description="Git status, staging, commit and push will live here. In Phase 1 this panel is a placeholder — no Git commands are executed."
          hint="Phase 2 will connect to NagarHub repositories and the workspace Git service."
        />
      ) : null}
      {active === "nagarhub" ? (
        <Placeholder
          icon="⬢"
          title="NagarHub"
          description="Clone, open and publish to NagarHub directly from NagarCode. This integration is planned — it will use your single Nagar identity."
          hint="For now, open any local folder with “Open Folder” in the Explorer."
          action={
            <a className="ide-secondary-btn" href="http://localhost:3000" target="_blank" rel="noreferrer">
              Open NagarHub
            </a>
          }
        />
      ) : null}
      {active === "settings" ? <SettingsPanel /> : null}
    </div>
  );
}
