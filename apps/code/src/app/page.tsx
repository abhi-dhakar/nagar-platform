"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityBar, type ActivityId } from "@/components/ide/ActivityBar";
import { Sidebar } from "@/components/ide/Sidebar";
import { EditorTabs, type Tab } from "@/components/ide/EditorTabs";
import { MonacoEditor } from "@/components/ide/MonacoEditor";
import { StatusBar } from "@/components/ide/StatusBar";
import { BottomPanel } from "@/components/ide/BottomPanel";
import { CommandPalette, type Command } from "@/components/ide/CommandPalette";
import { SettingsProvider, useSettings } from "@/lib/settings/context";
import { isFsAccessSupported, openNativeFolder } from "@/lib/workspace/fs-access";
import { createDemoWorkspace, createEmptyMemoryWorkspace } from "@/lib/workspace/memory";
import type { WorkspaceEntry, WorkspaceService } from "@/lib/workspace/types";
import { normalizePath, joinPath, dirname, basename } from "@/lib/workspace/types";
import { getLanguageFromPath } from "@/lib/utils";
import { pushRecent, loadRecent } from "@/lib/recentFiles";

type Toast = { id: string; message: string; kind: "success" | "error" | "info" };

function IDEInner() {
  const { settings } = useSettings();

  // Workspace
  const [workspace, setWorkspace] = useState<WorkspaceService | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);

  // Explorer state
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["/"]));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [activeActivity, setActiveActivity] = useState<ActivityId>("explorer");

  // Tabs
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Editor cursor
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(null);
  const editorRef = useRef<unknown>(null);
  const monacoRef = useRef<unknown>(null);

  // UI state
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [bottomHeight, setBottomHeight] = useState(220);
  const [commandOpen, setCommandOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modal, setModal] = useState<
    | null
    | { type: "prompt"; title: string; message: string; placeholder?: string; defaultValue?: string; onConfirm: (v: string) => void }
    | { type: "confirm"; title: string; message: string; onConfirm: () => void }
  >(null);

  const isSupported = useMemo(() => isFsAccessSupported(), []);

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId]);

  const pushToast = useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  // Initialize with demo workspace
  useEffect(() => {
    const demo = createDemoWorkspace();
    setWorkspace(demo);
    setWorkspaceName(demo.name);
    // Expand src by default
    setExpanded(new Set(["/", "/src", "/src/components"]));
  }, []);

  const refreshAll = useCallback(() => {
    window.dispatchEvent(new Event("nagar:refresh:all"));
  }, []);

  const handleOpenFolder = useCallback(async () => {
    if (isFsAccessSupported()) {
      try {
        const ws = await openNativeFolder();
        if (!ws) return; // cancelled
        setWorkspace(ws);
        setWorkspaceName(ws.name);
        setExpanded(new Set(["/"]));
        setSelectedPath("/");
        pushToast(`Opened “${ws.name}”`, "success");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Permission")) {
          pushToast("Permission denied for folder access", "error");
        } else {
          pushToast(`Could not open folder: ${msg}`, "error");
        }
      }
    } else {
      // Fallback: if already has workspace, just show info; else create empty memory
      if (workspace && !workspace.isNative) {
        pushToast("Your browser uses the in-memory workspace. Use Chrome or Edge for local folder access.", "info");
        return;
      }
      const mem = createDemoWorkspace();
      setWorkspace(mem);
      setWorkspaceName(mem.name);
      pushToast("Using in-memory workspace (this tab). Open in Chrome/Edge for real folder access.", "info");
    }
  }, [pushToast, workspace]);

  const openFile = useCallback(
    async (path: string, _line?: number) => {
      if (!workspace) return;
      const normalized = normalizePath(path);
      // Check if tab already open
      const existing = tabs.find((t) => t.path === normalized);
      if (existing) {
        setActiveId(existing.id);
        setSelectedPath(normalized);
        pushRecent(normalized);
        return;
      }
      try {
        const content = await workspace.readFile(normalized);
        const language = getLanguageFromPath(normalized);
        const id = `${normalized}-${Date.now()}`;
        const newTab: Tab = {
          id,
          path: normalized,
          content,
          savedContent: content,
          isDirty: false,
          language,
        };
        setTabs((prev) => [...prev, newTab]);
        setActiveId(id);
        setSelectedPath(normalized);
        pushRecent(normalized);
      } catch (e) {
        pushToast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [workspace, tabs, pushToast],
  );

  const handleSelectFile = useCallback(
    (entry: WorkspaceEntry) => {
      if (entry.kind === "file") {
        openFile(entry.path);
      } else {
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(entry.path)) next.delete(entry.path);
          else next.add(entry.path);
          return next;
        });
      }
    },
    [openFile],
  );

  const handleCreateFile = useCallback(
    async (targetDir: string, name: string, content = "") => {
      if (!workspace) {
        // Create untitled file in memory
        const mem = createEmptyMemoryWorkspace("Untitled");
        const path = `/${name || "untitled.ts"}`;
        await mem.createFile(path, content);
        setWorkspace(mem);
        setWorkspaceName(mem.name);
        setExpanded(new Set(["/"]));
        refreshAll();
        openFile(path);
        return;
      }
      const dir = normalizePath(targetDir);
      const full = normalizePath(joinPath(dir, name));
      try {
        await workspace.createFile(full, content);
        refreshAll();
        // Expand parent
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const p of parentChain(dir)) next.add(p);
          return next;
        });
        openFile(full);
        pushToast(`Created ${full}`, "success");
      } catch (e) {
        pushToast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [workspace, openFile, pushToast, refreshAll],
  );

  const handleCreateFolder = useCallback(
    async (targetDir: string, name: string) => {
      if (!workspace) {
        pushToast("Open a folder first or create a file to initialize workspace", "info");
        return;
      }
      const dir = normalizePath(targetDir);
      const full = normalizePath(joinPath(dir, name));
      try {
        await workspace.createFolder(full);
        refreshAll();
        setExpanded((prev) => {
          const next = new Set(prev);
          next.add(full);
          for (const p of parentChain(dir)) next.add(p);
          return next;
        });
        pushToast(`Created folder ${full}`, "success");
      } catch (e) {
        pushToast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [workspace, pushToast, refreshAll],
  );

  const handleRename = useCallback(
    async (oldPath: string, newName: string) => {
      if (!workspace) return;
      const oldN = normalizePath(oldPath);
      const dir = dirname(oldN);
      const newPath = normalizePath(joinPath(dir, newName));
      try {
        await workspace.rename(oldN, newPath);
        refreshAll();
        // Update tabs
        setTabs((prev) =>
          prev.map((t) => {
            if (t.path === oldN) return { ...t, path: newPath };
            // For nested files under a renamed folder, we need to update paths too
            if (t.path.startsWith(oldN + "/")) {
              return { ...t, path: newPath + t.path.slice(oldN.length) };
            }
            return t;
          }),
        );
        if (selectedPath === oldN) setSelectedPath(newPath);
        pushToast(`Renamed to ${newName}`, "success");
      } catch (e) {
        pushToast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [workspace, selectedPath, pushToast, refreshAll],
  );

  const handleDelete = useCallback(
    async (path: string) => {
      if (!workspace) return;
      const n = normalizePath(path);
      try {
        const stat = await workspace.stat(n);
        const isDir = stat?.kind === "directory";
        await workspace.delete(n, { recursive: isDir });
        refreshAll();
        // Close tabs for deleted path
        setTabs((prev) => prev.filter((t) => t.path !== n && !t.path.startsWith(n + "/")));
        if (selectedPath === n || (selectedPath && selectedPath.startsWith(n + "/"))) setSelectedPath(null);
        pushToast(`Deleted ${path}`, "success");
      } catch (e) {
        pushToast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [workspace, selectedPath, pushToast, refreshAll],
  );

  const handleSave = useCallback(async () => {
    if (!workspace || !activeTab) {
      pushToast("No file to save", "info");
      return;
    }
    try {
      await workspace.writeFile(activeTab.path, activeTab.content);
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, savedContent: t.content, isDirty: false } : t)),
      );
      pushToast(`Saved ${activeTab.path}`, "success");
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [workspace, activeTab, pushToast]);

  const handleEditorChange = useCallback(
    (val: string) => {
      if (!activeId) return;
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id === activeId) {
            const isDirty = val !== t.savedContent;
            return { ...t, content: val, isDirty };
          }
          return t;
        }),
      );
    },
    [activeId],
  );

  const handleCloseTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      if (tab.isDirty) {
        setModal({
          type: "confirm",
          title: "Unsaved changes",
          message: `${tab.path} has unsaved changes. Close without saving?`,
          onConfirm: () => {
            setTabs((prev) => {
              const next = prev.filter((t) => t.id !== id);
              if (activeId === id) {
                const idx = prev.findIndex((t) => t.id === id);
                const fallback = next[idx] ?? next[idx - 1] ?? null;
                setActiveId(fallback ? fallback.id : null);
              }
              return next;
            });
            setModal(null);
          },
        });
        return;
      }
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (activeId === id) {
          const idx = prev.findIndex((t) => t.id === id);
          const fallback = next[idx] ?? next[idx - 1] ?? null;
          setActiveId(fallback ? fallback.id : null);
        }
        return next;
      });
    },
    [tabs, activeId],
  );

  const handleContextAction = useCallback(
    (action: string, targetPath: string | null, kind?: "file" | "directory") => {
      const basePath = targetPath ?? "/";
      const isFile = kind === "file";
      const targetDir = isFile ? dirname(basePath) : normalizePath(basePath);

      switch (action) {
        case "newFile": {
          setModal({
            type: "prompt",
            title: "New file",
            message: `Create a new file in ${targetDir}`,
            placeholder: "filename.ts",
            onConfirm: (v) => {
              if (!v.trim()) return;
              handleCreateFile(targetDir, v.trim());
              setModal(null);
            },
          });
          break;
        }
        case "newFolder": {
          setModal({
            type: "prompt",
            title: "New folder",
            message: `Create a new folder in ${targetDir}`,
            placeholder: "my-folder",
            onConfirm: (v) => {
              if (!v.trim()) return;
              handleCreateFolder(targetDir, v.trim());
              setModal(null);
            },
          });
          break;
        }
        case "rename": {
          if (!targetPath || targetPath === "/") {
            pushToast("Cannot rename this", "error");
            break;
          }
          const current = basename(targetPath);
          setModal({
            type: "prompt",
            title: "Rename",
            message: `Rename ${targetPath}`,
            defaultValue: current,
            placeholder: current,
            onConfirm: (v) => {
              if (!v.trim() || v.trim() === current) {
                setModal(null);
                return;
              }
              handleRename(targetPath, v.trim());
              setModal(null);
            },
          });
          break;
        }
        case "delete": {
          if (!targetPath || targetPath === "/") {
            pushToast("Cannot delete this", "error");
            break;
          }
          setModal({
            type: "confirm",
            title: "Delete",
            message: `Delete ${targetPath}? This cannot be undone.`,
            onConfirm: () => {
              handleDelete(targetPath);
              setModal(null);
            },
          });
          break;
        }
        case "copyPath": {
          if (targetPath) {
            navigator.clipboard.writeText(targetPath).then(
              () => pushToast(`Copied ${targetPath}`, "success"),
              () => pushToast("Clipboard not available", "error"),
            );
          }
          break;
        }
        case "refresh":
          refreshAll();
          pushToast("Refreshed", "info");
          break;
        case "collapseAll":
          setExpanded(new Set(["/"]));
          break;
        default:
          break;
      }
    },
    [handleCreateFile, handleCreateFolder, handleRename, handleDelete, pushToast, refreshAll],
  );

  // Auto-save effect
  useEffect(() => {
    if (!settings.autoSave || !workspace || !activeTab || !activeTab.isDirty) return;
    const t = setTimeout(() => {
      workspace
        .writeFile(activeTab.path, activeTab.content)
        .then(() => {
          setTabs((prev) => prev.map((c) => (c.id === activeTab.id ? { ...c, savedContent: c.content, isDirty: false } : c)));
        })
        .catch(() => {
          // ignore
        });
    }, 800);
    return () => clearTimeout(t);
  }, [settings.autoSave, workspace, activeTab]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      // Ctrl+S
      if (isMod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      }
      // Ctrl+Shift+P
      if (isMod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
      // Ctrl+W close tab
      if (isMod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (activeId) handleCloseTab(activeId);
      }
      // Ctrl+, settings
      if (isMod && e.key === ",") {
        e.preventDefault();
        setActiveActivity("settings");
      }
      // Ctrl+Shift+E explorer
      if (isMod && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setActiveActivity("explorer");
      }
      // Ctrl+Shift+F search
      if (isMod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setActiveActivity("search");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, activeId, handleCloseTab]);

  // Prevent unload if dirty
  useEffect(() => {
    const hasDirty = tabs.some((t) => t.isDirty);
    const handler = (e: BeforeUnloadEvent) => {
      if (hasDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [tabs]);

  // Commands
  const commands: Command[] = useMemo(
    () => [
      {
        id: "file.new",
        label: "New File…",
        category: "File",
        shortcut: "—",
        run: () => handleContextAction("newFile", selectedPath ? dirname(selectedPath) : "/", undefined),
      },
      {
        id: "file.openFolder",
        label: "Open Folder…",
        category: "File",
        run: handleOpenFolder,
      },
      {
        id: "file.save",
        label: "Save",
        category: "File",
        shortcut: "Ctrl+S",
        run: handleSave,
      },
      {
        id: "file.saveAll",
        label: "Save All",
        category: "File",
        run: async () => {
          if (!workspace) return;
          for (const t of tabs.filter((x) => x.isDirty)) {
            try {
              await workspace.writeFile(t.path, t.content);
            } catch {
              // ignore
            }
          }
          setTabs((prev) => prev.map((t) => ({ ...t, savedContent: t.content, isDirty: false })));
          pushToast("Saved all files", "success");
        },
      },
      {
        id: "view.explorer",
        label: "Show Explorer",
        category: "View",
        shortcut: "Ctrl+Shift+E",
        run: () => setActiveActivity("explorer"),
      },
      {
        id: "view.search",
        label: "Show Search",
        category: "View",
        shortcut: "Ctrl+Shift+F",
        run: () => setActiveActivity("search"),
      },
      {
        id: "view.settings",
        label: "Show Settings",
        category: "View",
        shortcut: "Ctrl+,",
        run: () => setActiveActivity("settings"),
      },
      {
        id: "view.toggleMinimap",
        label: settings.minimap ? "Hide Minimap" : "Show Minimap",
        category: "View",
        run: () => {
          // This will be handled via settings context update from outside
          // We need to get updater — but we have it via hook in child, here we can dispatch event
          window.dispatchEvent(new CustomEvent("nagar:toggle-minimap"));
        },
      },
      {
        id: "view.wordWrap",
        label: settings.wordWrap === "off" ? "Enable Word Wrap" : "Disable Word Wrap",
        category: "View",
        run: () => window.dispatchEvent(new CustomEvent("nagar:toggle-wordwrap")),
      },
      {
        id: "view.commandPalette",
        label: "Show Command Palette",
        category: "View",
        shortcut: "Ctrl+Shift+P",
        run: () => setCommandOpen(true),
      },
      {
        id: "view.togglePanel",
        label: bottomOpen ? "Hide Panel" : "Show Panel",
        category: "View",
        run: () => setBottomOpen((v) => !v),
      },
      {
        id: "explorer.refresh",
        label: "Refresh Explorer",
        category: "Explorer",
        run: () => refreshAll(),
      },
      {
        id: "explorer.collapse",
        label: "Collapse All",
        category: "Explorer",
        run: () => setExpanded(new Set(["/"])),
      },
      {
        id: "editor.close",
        label: "Close Editor",
        category: "Editor",
        shortcut: "Ctrl+W",
        run: () => activeId && handleCloseTab(activeId),
      },
      {
        id: "editor.closeAll",
        label: "Close All Editors",
        category: "Editor",
        run: () => {
          const dirty = tabs.filter((t) => t.isDirty);
          if (dirty.length > 0) {
            pushToast("Close dirty files first or save all", "info");
            return;
          }
          setTabs([]);
          setActiveId(null);
        },
      },
      {
        id: "help.welcome",
        label: "Show Welcome",
        category: "Help",
        run: () => {
          setTabs([]);
          setActiveId(null);
        },
      },
    ],
    [handleOpenFolder, handleSave, tabs, activeId, handleCloseTab, refreshAll, settings.minimap, settings.wordWrap, bottomOpen, pushToast, handleContextAction, selectedPath],
  );

  // Listen for toggle events from command palette
  useEffect(() => {
    const onToggleMini = () => {
      // We need settings context updater — we have it via hook but not here? Use custom event to update from settings panel
      // Instead, directly update via localStorage and reload? Better to handle via SettingsUpdater component.
      // For now, just show toast — actual toggle is done by SettingsUpdater
    };
    window.addEventListener("nagar:toggle-minimap", onToggleMini);
    return () => window.removeEventListener("nagar:toggle-minimap", onToggleMini);
  }, []);

  // Recent files
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(loadRecent()), [tabs]);

  const settingsSummary = `${settings.tabSize} spaces · ${settings.wordWrap === "off" ? "no wrap" : "wrap"} · ${settings.minimap ? "minimap" : "no minimap"}`;

  return (
    <div className="ide-root">
      <div className="ide-workspace">
        <ActivityBar active={activeActivity} onSelect={setActiveActivity} />

        <div className="ide-sidebar-wrap" style={{ width: sidebarWidth }}>
          <Sidebar
            active={activeActivity}
            workspace={workspace}
            workspaceName={workspaceName}
            onOpenFolder={handleOpenFolder}
            onSelectFile={handleSelectFile}
            expanded={expanded}
            onToggle={(p) =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(p)) next.delete(p);
                else next.add(p);
                return next;
              })
            }
            onCollapseAll={() => setExpanded(new Set(["/"]))}
            selectedPath={selectedPath}
            onAction={handleContextAction}
            onRefresh={refreshAll}
            isSupported={isSupported}
            onOpenFile={openFile}
          />
          <div
            className="ide-sidebar-resizer"
            onMouseDown={(e) => {
              const startX = e.clientX;
              const startW = sidebarWidth;
              const onMove = (ev: MouseEvent) => {
                const next = Math.max(200, Math.min(560, startW + ev.clientX - startX));
                setSidebarWidth(next);
              };
              const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
          />
        </div>

        <div className="ide-main">
          <EditorTabs
            tabs={tabs}
            activeId={activeId}
            onSelect={setActiveId}
            onClose={handleCloseTab}
            onCloseAll={() => {
              const dirty = tabs.filter((t) => t.isDirty);
              if (dirty.length > 0) {
                pushToast("Save or close dirty files before closing all", "info");
                return;
              }
              setTabs([]);
              setActiveId(null);
            }}
          />

          <div className="ide-editor-area">
            {activeTab ? (
              <MonacoEditor
                path={activeTab.path}
                language={getLanguageFromPath(activeTab.path)}
                value={activeTab.content}
                onChange={handleEditorChange}
                onSave={handleSave}
                onMount={(editor, monaco) => {
                  editorRef.current = editor;
                  monacoRef.current = monaco;
                  // Track cursor
                  const ed = editor as { onDidChangeCursorPosition: (cb: (e: { position: { lineNumber: number; column: number } }) => void) => void };
                  if (ed?.onDidChangeCursorPosition) {
                    ed.onDidChangeCursorPosition((e) => setCursor({ line: e.position.lineNumber, col: e.position.column }));
                  }
                }}
              />
            ) : (
              <div className="ide-welcome">
                <div className="ide-welcome-card">
                  <h1>
                    Welcome to <span>NagarCode</span>
                  </h1>
                  <p>
                    A desktop-first, keyboard-focused editor for the Nagar platform. Open a local folder to work with
                    real files, or explore the demo workspace. Your edits survive tab switching and are saved through
                    the workspace service.
                  </p>

                  <div className="ide-welcome-grid">
                    <div className="ide-welcome-tile">
                      <h4>Explorer</h4>
                      <p>Open Folder, create, rename, delete. Right-click for context menus. Supports nested folders.</p>
                    </div>
                    <div className="ide-welcome-tile">
                      <h4>Editor</h4>
                      <p>Monaco with JS/TS/Python, folding, minimap, word wrap, themes, find &amp; replace (Ctrl+F).</p>
                    </div>
                    <div className="ide-welcome-tile">
                      <h4>Search</h4>
                      <p>Local workspace search with regex, case and whole-word toggles. Service-based architecture.</p>
                    </div>
                  </div>

                  <div className="ide-welcome-actions">
                    <button className="ide-primary-btn" onClick={handleOpenFolder}>
                      Open Folder…
                    </button>
                    <button
                      className="ide-secondary-btn"
                      onClick={() => {
                        if (!workspace) {
                          const mem = createDemoWorkspace();
                          setWorkspace(mem);
                          setWorkspaceName(mem.name);
                        }
                        openFile("/src/index.ts");
                      }}
                    >
                      Open demo file
                    </button>
                    <button className="ide-secondary-btn" onClick={() => setCommandOpen(true)}>
                      Command palette <span className="ide-kbd">Ctrl+Shift+P</span>
                    </button>
                  </div>

                  {recent.length > 0 ? (
                    <div style={{ marginTop: 16 }}>
                      <h4 style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>Recent</h4>
                      <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
                        {recent.slice(0, 6).map((p) => (
                          <button
                            key={p}
                            className="ide-secondary-btn"
                            style={{ textAlign: "left", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
                            onClick={() => openFile(p)}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <p className="ide-muted small" style={{ marginTop: 16 }}>
                    Dark theme by default • File System Access API where supported, memory fallback otherwise • All
                    panels are resizable • <a href="http://localhost:3000" target="_blank" rel="noreferrer">NagarHub</a>{" "}
                    integration reserved for Phase 2.
                  </p>
                </div>
              </div>
            )}
          </div>

          <BottomPanel open={bottomOpen} onClose={() => setBottomOpen(false)} height={bottomHeight} onHeightChange={setBottomHeight} />
        </div>
      </div>

      <StatusBar
        activeTab={activeTab}
        cursor={cursor}
        workspaceName={workspaceName}
        settingsSummary={settingsSummary}
        onToggleBottom={() => setBottomOpen((v) => !v)}
        bottomOpen={bottomOpen}
        hasBottom
      />

      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} commands={commands} />

      {/* Settings updater for command palette toggles */}
      <SettingsUpdater />

      <div className="ide-toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`ide-toast ${t.kind}`}>
            <span>{t.message}</span>
            <button className="ide-toast-close" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>

      {modal ? (
        <div className="ide-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="ide-modal" role="dialog" aria-modal="true">
            <h3>{modal.title}</h3>
            <p>{modal.message}</p>
            {modal.type === "prompt" ? (
              <PromptContent modal={modal} onCancel={() => setModal(null)} />
            ) : (
              <div className="ide-modal-actions">
                <button className="ide-secondary-btn" onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button className="ide-primary-btn" onClick={modal.onConfirm}>
                  Confirm
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PromptContent({
  modal,
  onCancel,
}: {
  modal: { type: "prompt"; title: string; message: string; placeholder?: string; defaultValue?: string; onConfirm: (v: string) => void };
  onCancel: () => void;
}) {
  const [val, setVal] = useState(modal.defaultValue ?? "");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <>
      <input
        ref={ref}
        className="ide-input"
        placeholder={modal.placeholder}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") modal.onConfirm(val);
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="ide-modal-actions">
        <button className="ide-secondary-btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="ide-primary-btn" onClick={() => modal.onConfirm(val)} disabled={!val.trim()}>
          Create
        </button>
      </div>
    </>
  );
}

function parentChain(path: string): string[] {
  const n = normalizePath(path);
  const parts = n.split("/").filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    cur += `/${p}`;
    out.push(cur);
  }
  return out;
}

// Helper to handle command palette toggles via settings
function SettingsUpdater() {
  const { settings, update } = useSettings();
  useEffect(() => {
    const onMini = () => update({ minimap: !settings.minimap });
    const onWrap = () => update({ wordWrap: settings.wordWrap === "off" ? "on" : "off" });
    window.addEventListener("nagar:toggle-minimap", onMini);
    window.addEventListener("nagar:toggle-wordwrap", onWrap);
    return () => {
      window.removeEventListener("nagar:toggle-minimap", onMini);
      window.removeEventListener("nagar:toggle-wordwrap", onWrap);
    };
  }, [settings.minimap, settings.wordWrap, update]);
  return null;
}

export default function Page() {
  return (
    <SettingsProvider>
      <IDEInner />
    </SettingsProvider>
  );
}
