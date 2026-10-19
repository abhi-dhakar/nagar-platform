"use client";

import { useEffect, useState, useCallback } from "react";
import type { WorkspaceEntry, WorkspaceService } from "@/lib/workspace/types";
import { getFileIcon } from "@/lib/utils";
import { IconChevron, IconFolder } from "./Icons";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

type Props = {
  workspace: WorkspaceService | null;
  expanded: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (entry: WorkspaceEntry) => void;
  onRefresh: () => void;
  onContextAction: (
    action: string,
    targetPath: string | null,
    targetKind?: "file" | "directory",
  ) => void;
};

export function FileTree({
  workspace,
  expanded,
  selectedPath,
  onToggle,
  onSelect,
  onContextAction,
}: Props) {
  const [ctx, setCtx] = useState<{
    x: number;
    y: number;
    path: string | null;
    kind?: "file" | "directory";
  } | null>(null);

  if (!workspace) {
    return <div className="ide-tree-empty">No folder opened</div>;
  }

  return (
    <div
      className="ide-filetree"
      onContextMenu={(e) => {
        // Empty area context
        const target = e.target as HTMLElement;
        if (target.closest(".ide-tree-row")) return;
        e.preventDefault();
        setCtx({ x: e.clientX, y: e.clientY, path: "/" });
      }}
    >
      <TreeLevel
        workspace={workspace}
        path="/"
        depth={0}
        expanded={expanded}
        selectedPath={selectedPath}
        onToggle={onToggle}
        onSelect={onSelect}
        onContext={setCtx}
      />
      {ctx ? (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={buildMenu(ctx.path, ctx.kind)}
          onSelect={(id) => onContextAction(id, ctx.path, ctx.kind)}
          onClose={() => setCtx(null)}
        />
      ) : null}
    </div>
  );
}

function buildMenu(path: string | null, kind?: "file" | "directory"): ContextMenuItem[] {
  const isRoot = path === "/" || path === null;
  if (isRoot) {
    return [
      { id: "newFile", label: "New File…", icon: "＋" },
      { id: "newFolder", label: "New Folder…", icon: "＋" },
      { id: "separator" },
      { id: "refresh", label: "Refresh Explorer" },
      { id: "separator" },
      { id: "collapseAll", label: "Collapse All" },
    ];
  }
  if (kind === "directory") {
    return [
      { id: "newFile", label: "New File…", icon: "＋" },
      { id: "newFolder", label: "New Folder…", icon: "＋" },
      { id: "separator" },
      { id: "rename", label: "Rename…", shortcut: "F2" },
      { id: "delete", label: "Delete", danger: true },
      { id: "separator" },
      { id: "copyPath", label: "Copy Path" },
      { id: "refresh", label: "Refresh" },
    ];
  }
  return [
    { id: "rename", label: "Rename…", shortcut: "F2" },
    { id: "delete", label: "Delete", danger: true },
    { id: "separator" },
    { id: "copyPath", label: "Copy Path" },
  ];
}

function TreeLevel({
  workspace,
  path,
  depth,
  expanded,
  selectedPath,
  onToggle,
  onSelect,
  onContext,
}: {
  workspace: WorkspaceService;
  path: string;
  depth: number;
  expanded: Set<string>;
  selectedPath: string | null;
  onToggle: (p: string) => void;
  onSelect: (e: WorkspaceEntry) => void;
  onContext: (c: {
    x: number;
    y: number;
    path: string | null;
    kind?: "file" | "directory";
  }) => void;
}) {
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await workspace.list(path);
      setEntries(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [workspace, path]);

  useEffect(() => {
    load();
  }, [load]);

  // Listen for refresh events via custom event
  useEffect(() => {
    const handler = () => load();
    window.addEventListener(`nagar:refresh:${path}`, handler);
    window.addEventListener("nagar:refresh:all", handler);
    return () => {
      window.removeEventListener(`nagar:refresh:${path}`, handler);
      window.removeEventListener("nagar:refresh:all", handler);
    };
  }, [path, load]);

  if (loading) {
    return (
      <div className="ide-tree-loading" style={{ paddingLeft: 12 + depth * 12 }}>
        <span className="ide-tree-loading-dot" /> Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="ide-tree-error" style={{ paddingLeft: 12 + depth * 12 }}>
        {error}
      </div>
    );
  }
  if (!entries || entries.length === 0) {
    if (depth === 0) {
      return (
        <div className="ide-tree-empty">This folder is empty. Right-click to create a file.</div>
      );
    }
    return null;
  }

  return (
    <>
      {entries.map((entry) => {
        const isExpanded = expanded.has(entry.path);
        const isSelected = selectedPath === entry.path;
        const isDir = entry.kind === "directory";
        const icon = getFileIcon(entry.path, entry.kind);
        return (
          <div key={entry.path}>
            <div
              className={`ide-tree-row ${isSelected ? "selected" : ""} ${isDir ? "is-dir" : "is-file"}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => {
                if (isDir) onToggle(entry.path);
                else onSelect(entry);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContext({ x: e.clientX, y: e.clientY, path: entry.path, kind: entry.kind });
              }}
              role="treeitem"
              aria-selected={isSelected}
              aria-expanded={isDir ? isExpanded : undefined}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (isDir) onToggle(entry.path);
                  else onSelect(entry);
                }
              }}
            >
              <span className="ide-tree-chevron">
                {isDir ? (
                  <IconChevron open={isExpanded} width={12} height={12} />
                ) : (
                  <span style={{ width: 12 }} />
                )}
              </span>
              <span className="ide-tree-icon" style={{ color: icon.color }} aria-hidden="true">
                {isDir ? (
                  <IconFolder width={14} height={14} open={isExpanded} />
                ) : (
                  <span className="ide-file-badge">{icon.icon}</span>
                )}
              </span>
              <span className="ide-tree-label" title={entry.path}>
                {entry.name}
              </span>
            </div>
            {isDir && isExpanded ? (
              <TreeLevel
                workspace={workspace}
                path={entry.path}
                depth={depth + 1}
                expanded={expanded}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelect={onSelect}
                onContext={onContext}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}
