"use client";

import type { ActivityId } from "./ActivityBar";
import { Explorer } from "./Explorer";
import { SearchPanel } from "./SearchPanel";
import { SettingsPanel } from "./SettingsPanel";
import { SourceControlPanel } from "./SourceControlPanel";
import { NagarHubPanel } from "./NagarHubPanel";
import { PreviewPanel } from "./PreviewPanel";
import type { WorkspaceEntry, WorkspaceService } from "@/lib/workspace/types";
import type { AgentClient } from "@/lib/agent/client";

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
  agentClient,
  workspaceId,
  workspaceRoot,
  onOpenWorkspace,
  notify,
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
  agentClient: AgentClient | null;
  workspaceId: string | null;
  workspaceRoot: string | null;
  onOpenWorkspace: (path: string) => Promise<void>;
  notify: (msg: string, kind?: "success" | "error" | "info") => void;
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
        <SourceControlPanel client={agentClient} workspaceId={workspaceId} onRefreshExplorer={onRefresh} notify={notify} />
      ) : null}
      {active === "nagarhub" ? (
        <NagarHubPanel
          client={agentClient}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          onOpenWorkspace={onOpenWorkspace}
          notify={notify}
        />
      ) : null}
      {active === "preview" ? <PreviewPanel /> : null}
      {active === "settings" ? <SettingsPanel /> : null}
    </div>
  );
}
