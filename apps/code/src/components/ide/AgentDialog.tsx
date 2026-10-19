"use client";

import { useEffect, useMemo, useState } from "react";
import type { BrowseResult, RuntimeAvailability } from "@nagar/agent-protocol";
import { isLoopbackPage } from "@/lib/agent/client";
import type { AgentController } from "@/lib/agent/useAgent";
import { loadRecentWorkspaces, type PairingDetails } from "@/lib/agent/storage";
import { IconClose, IconPlug, IconTerminal } from "./Icons";

type Props = {
  open: boolean;
  onClose: () => void;
  agent: AgentController;
  initialPairing: PairingDetails | null;
  onOpenWorkspace: (path: string) => void | Promise<void>;
  onCloseWorkspace: () => void | Promise<void>;
  onDisconnect: () => Promise<void>;
  onForget: () => Promise<void>;
  onBrowserFallback: () => void;
  onShowTerminals: () => void;
};

function runtimeState(runtime: RuntimeAvailability): { label: string; className: string } {
  if (runtime.available) return { label: "available", className: "ok" };
  return { label: "unavailable", className: "bad" };
}

export function AgentDialog({
  open,
  onClose,
  agent,
  initialPairing,
  onOpenWorkspace,
  onCloseWorkspace,
  onDisconnect,
  onForget,
  onBrowserFallback,
  onShowTerminals,
}: Props) {
  const [url, setUrl] = useState("http://127.0.0.1:47821");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [pythonDraft, setPythonDraft] = useState(agent.pythonPath);
  const [savingPython, setSavingPython] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRecents(loadRecentWorkspaces());
    const nextUrl = initialPairing?.url ?? agent.config?.url ?? "http://127.0.0.1:47821";
    const nextToken = initialPairing?.token ?? agent.config?.token ?? "";
    setUrl(nextUrl);
    setToken(nextToken);
    setLocalError(null);
    setBrowse(null);
    setWorkspacePath(agent.workspace?.root ?? loadRecentWorkspaces()[0] ?? "");
    setPythonDraft(agent.pythonPath);
    // Only reinitialize when the dialog opens or a pairing link arrives.
  }, [open, initialPairing?.url, initialPairing?.token]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, open]);

  const connected = agent.state === "connected" && Boolean(agent.status);
  const busy = agent.connecting;
  const loopbackPage = useMemo(() => isLoopbackPage(), []);
  const error = localError ?? agent.error;
  const currentWorkspace = agent.workspace;

  const submitConnect = async () => {
    setLocalError(null);
    const ok = await agent.connect(url, token);
    if (!ok) setLocalError(agent.error ?? "Could not connect to the local agent.");
  };

  const startBrowse = async (target?: string) => {
    if (!agent.client) return;
    setBrowseLoading(true);
    setLocalError(null);
    try {
      const result = await agent.client.browse(target);
      setBrowse(result);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBrowseLoading(false);
    }
  };

  const submitWorkspace = async (path: string) => {
    if (!path.trim()) return;
    setLocalError(null);
    await onOpenWorkspace(path.trim());
  };

  const savePython = async () => {
    agent.setPythonPath(pythonDraft);
    setSavingPython(true);
    setLocalError(null);
    try {
      await agent.refreshRuntimes(pythonDraft);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingPython(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="ide-agent-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="ide-agent-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Local development agent"
      >
        <div className="ide-agent-header">
          <div className="ide-agent-title">
            <span
              className={`ide-agent-status-dot ${connected ? "connected" : agent.state === "connecting" ? "connecting" : "offline"}`}
            />
            <div>
              <h2>Local development agent</h2>
              <p>Files, terminals, and runtimes on this computer. Loopback only.</p>
            </div>
          </div>
          <button className="ide-agent-close" onClick={onClose} aria-label="Close agent dialog">
            <IconClose width={16} height={16} />
          </button>
        </div>

        <div className="ide-agent-body">
          {!connected ? (
            <>
              <section className="ide-agent-section">
                <h3>
                  <IconPlug width={14} height={14} /> Connect to your agent
                </h3>
                <p className="ide-muted small">
                  The agent is a separate process. It binds only to{" "}
                  <code className="ide-inline-code">127.0.0.1</code>, requires a bearer token,
                  checks the browser origin, and never exposes a public port.
                </p>
                <div className="ide-agent-form">
                  <label className="ide-field">
                    <span className="ide-field-label">Agent URL</span>
                    <input
                      className="ide-input"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="http://127.0.0.1:47821"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>
                  <label className="ide-field">
                    <span className="ide-field-label">Token</span>
                    <div className="ide-agent-token-row">
                      <input
                        className="ide-input"
                        type={showToken ? "text" : "password"}
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        placeholder="Token printed by `pnpm agent`"
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button
                        className="ide-secondary-btn small"
                        onClick={() => setShowToken((value) => !value)}
                      >
                        {showToken ? "Hide" : "Show"}
                      </button>
                    </div>
                  </label>
                  <div className="ide-agent-form-actions">
                    <button
                      className="ide-primary-btn"
                      onClick={() => void submitConnect()}
                      disabled={busy || !token.trim()}
                    >
                      {busy ? "Connecting…" : "Connect"}
                    </button>
                    {agent.config ? (
                      <button
                        className="ide-secondary-btn"
                        onClick={() => void agent.reconnect()}
                        disabled={busy}
                      >
                        Reconnect
                      </button>
                    ) : null}
                  </div>
                </div>
                {error ? <div className="ide-error">{error}</div> : null}
                {agent.errorHint ? <p className="ide-agent-hint">{agent.errorHint}</p> : null}
              </section>

              <section className="ide-agent-section">
                <h3>Start the agent</h3>
                <pre className="ide-agent-code">{`# once per checkout
pnpm install
pnpm agent:build

# every session (keep this terminal open)
pnpm --filter @nagar/agent start`}</pre>
                <p className="ide-muted small">
                  Or run the TypeScript entry directly with{" "}
                  <code className="ide-inline-code">pnpm agent</code>. The agent prints the URL, a
                  token, and a one-click pairing link. Pairing links keep the token in the URL
                  fragment, so it never reaches a server.
                </p>
                <p className="ide-muted small">
                  Shut it down with <kbd className="ide-kbd">Ctrl+C</kbd> in the agent terminal. All
                  terminal sessions are closed first.
                </p>
                {!loopbackPage ? (
                  <div className="ide-agent-warning">
                    This page is not running on your computer. A remote preview page cannot reach
                    your machine&apos;s loopback agent, and the agent must be explicitly started
                    with{" "}
                    <code className="ide-inline-code">
                      --allow-origin{" "}
                      {typeof window !== "undefined" ? window.location.origin : "<origin>"}
                    </code>
                    . Run NagarCode locally at{" "}
                    <code className="ide-inline-code">http://localhost:3001</code> for the intended
                    flow.
                  </div>
                ) : null}
              </section>

              <section className="ide-agent-section">
                <h3>Browser folder fallback</h3>
                <p className="ide-muted small">
                  If you only need files, Chrome/Edge can still grant direct File System Access to a
                  folder. The terminal and Run features require the agent.
                </p>
                <button className="ide-secondary-btn" onClick={onBrowserFallback}>
                  Open a folder in this browser instead
                </button>
              </section>
            </>
          ) : (
            <>
              <section className="ide-agent-section">
                <div className="ide-agent-summary">
                  <div>
                    <span className="ide-field-label">Agent</span>
                    <span className="ide-agent-summary-value mono">{agent.config?.url}</span>
                  </div>
                  <div>
                    <span className="ide-field-label">Workspace</span>
                    <span className="ide-agent-summary-value">
                      {currentWorkspace?.name ?? "none open"}
                    </span>
                  </div>
                  <div>
                    <span className="ide-field-label">Terminals</span>
                    <span className="ide-agent-summary-value">
                      {agent.status?.terminals.active ?? 0} / {agent.status?.terminals.limit ?? 0}{" "}
                      active
                    </span>
                  </div>
                  <div>
                    <span className="ide-field-label">PTY</span>
                    <span
                      className={`ide-agent-summary-value ${agent.status?.ptyAvailable ? "ok" : "warn"}`}
                    >
                      {agent.status?.ptyAvailable ? "available" : "pipe fallback"}
                    </span>
                  </div>
                </div>
                <p className="ide-muted small">
                  {agent.status?.name} {agent.status?.version} · {agent.status?.platform}/
                  {agent.status?.arch} · Node {agent.status?.nodeVersion}
                </p>
                {agent.status?.ptyReason ? (
                  <p className="ide-agent-hint">{agent.status.ptyReason}</p>
                ) : null}
                {error ? <div className="ide-error">{error}</div> : null}
                {agent.errorHint ? <p className="ide-agent-hint">{agent.errorHint}</p> : null}
                <div className="ide-agent-form-actions">
                  <button
                    className="ide-secondary-btn small"
                    onClick={() => void agent.refresh(false)}
                  >
                    Refresh status
                  </button>
                  <button className="ide-secondary-btn small" onClick={onShowTerminals}>
                    <IconTerminal width={13} height={13} /> Show terminals
                  </button>
                  <button className="ide-secondary-btn small" onClick={() => void onDisconnect()}>
                    Disconnect
                  </button>
                  <button
                    className="ide-secondary-btn small danger"
                    onClick={() => void onForget()}
                  >
                    Forget token
                  </button>
                </div>
              </section>

              <section className="ide-agent-section">
                <h3>Workspaces</h3>
                {currentWorkspace ? (
                  <div className="ide-agent-workspace current">
                    <div>
                      <strong>{currentWorkspace.name}</strong>
                      <div className="ide-agent-path mono">{currentWorkspace.root}</div>
                    </div>
                    <div className="ide-agent-workspace-actions">
                      <button className="ide-secondary-btn small" onClick={() => onShowTerminals()}>
                        Terminals
                      </button>
                      <button
                        className="ide-secondary-btn small"
                        onClick={() => void onCloseWorkspace()}
                      >
                        Close workspace
                      </button>
                    </div>
                  </div>
                ) : null}
                {(agent.status?.workspaces ?? [])
                  .filter((workspace) => workspace.id !== currentWorkspace?.id)
                  .map((workspace) => (
                    <div className="ide-agent-workspace" key={workspace.id}>
                      <div>
                        <strong>{workspace.name}</strong>
                        <div className="ide-agent-path mono">{workspace.root}</div>
                      </div>
                      <button
                        className="ide-secondary-btn small"
                        onClick={() => void submitWorkspace(workspace.root)}
                      >
                        Use workspace
                      </button>
                    </div>
                  ))}

                <div className="ide-agent-open-row">
                  <input
                    className="ide-input"
                    value={workspacePath}
                    onChange={(event) => setWorkspacePath(event.target.value)}
                    placeholder="/absolute/path/to/project"
                    spellCheck={false}
                    list="agent-recent-workspaces"
                  />
                  <datalist id="agent-recent-workspaces">
                    {recents.map((recent) => (
                      <option key={recent} value={recent} />
                    ))}
                  </datalist>
                  <button
                    className="ide-primary-btn"
                    disabled={!workspacePath.trim()}
                    onClick={() => void submitWorkspace(workspacePath)}
                  >
                    Open
                  </button>
                  <button
                    className="ide-secondary-btn"
                    onClick={() => void startBrowse(workspacePath || currentWorkspace?.root)}
                    disabled={browseLoading}
                  >
                    {browseLoading ? "Browsing…" : "Browse…"}
                  </button>
                </div>
                {recents.length > 0 ? (
                  <div className="ide-agent-recents">
                    {recents.map((recent) => (
                      <button
                        key={recent}
                        className="ide-agent-recent"
                        onClick={() => setWorkspacePath(recent)}
                      >
                        {recent}
                      </button>
                    ))}
                  </div>
                ) : null}

                {browse ? (
                  <div className="ide-agent-browser">
                    <div className="ide-agent-browser-head">
                      <button
                        className="ide-secondary-btn small"
                        disabled={!browse.parent}
                        onClick={() => void startBrowse(browse.parent ?? undefined)}
                      >
                        ↑ Up
                      </button>
                      <span className="ide-agent-path mono">{browse.path}</span>
                      <button
                        className="ide-primary-btn small"
                        onClick={() => void submitWorkspace(browse.path)}
                      >
                        Open this folder
                      </button>
                    </div>
                    <div className="ide-agent-browser-roots">
                      {browse.roots.map((root) => (
                        <button
                          key={root}
                          className="ide-agent-recent"
                          onClick={() => void startBrowse(root)}
                        >
                          {root}
                        </button>
                      ))}
                    </div>
                    <div className="ide-agent-browser-list">
                      {browse.dirs.length === 0 ? (
                        <p className="ide-muted small">No subdirectories.</p>
                      ) : (
                        browse.dirs.map((directory) => (
                          <button
                            key={directory.path}
                            className="ide-agent-browser-dir"
                            onClick={() => void startBrowse(directory.path)}
                            title={directory.path}
                          >
                            <span aria-hidden="true">▸</span> {directory.name}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
                <p className="ide-muted small">
                  Allowed roots:{" "}
                  <span className="mono">{agent.status?.allowedRoots.join(", ")}</span>
                </p>
              </section>

              <section className="ide-agent-section">
                <h3>Runtimes</h3>
                <div className="ide-agent-runtimes">
                  {(agent.runtimes.length > 0 ? agent.runtimes : []).map((runtime) => {
                    const state = runtimeState(runtime);
                    return (
                      <div className={`ide-agent-runtime ${state.className}`} key={runtime.id}>
                        <span className={`ide-status-dot ${state.className}`} />
                        <div className="ide-agent-runtime-main">
                          <strong>{runtime.label}</strong>
                          <span className="ide-agent-runtime-meta">
                            {runtime.version ?? state.label}
                            {runtime.strategy ? ` · ${runtime.strategy}` : ""}
                            {runtime.command ? ` · ${runtime.command}` : ""}
                          </span>
                          {runtime.reason ? (
                            <span className="ide-agent-runtime-note">{runtime.reason}</span>
                          ) : null}
                          {!runtime.available && runtime.installHint ? (
                            <span className="ide-agent-runtime-note warn">
                              {runtime.installHint}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="ide-agent-python">
                  <label className="ide-field">
                    <span className="ide-field-label">Python interpreter (optional)</span>
                    <div className="ide-agent-token-row">
                      <input
                        className="ide-input"
                        value={pythonDraft}
                        onChange={(event) => setPythonDraft(event.target.value)}
                        placeholder="/usr/bin/python3 or C:\\Python312\\python.exe"
                        spellCheck={false}
                      />
                      <button
                        className="ide-secondary-btn small"
                        onClick={() => void savePython()}
                        disabled={savingPython}
                      >
                        {savingPython ? "Checking…" : "Check & save"}
                      </button>
                    </div>
                    <span className="ide-field-hint">
                      Saved locally in this browser and sent with each Python run. Leave empty to
                      let the agent detect python3/python (or py -3 on Windows).
                    </span>
                  </label>
                </div>
              </section>

              <section className="ide-agent-section">
                <h3>Shells</h3>
                <div className="ide-agent-shells">
                  {(agent.status?.shells ?? []).map((shell) => (
                    <span
                      key={`${shell.id}-${shell.path}`}
                      className="ide-agent-shell mono"
                      title={shell.path}
                    >
                      {shell.label}
                    </span>
                  ))}
                  {(agent.status?.shells ?? []).length === 0 ? (
                    <span className="ide-muted small">No shells detected.</span>
                  ) : null}
                </div>
                <p className="ide-muted small">
                  Allowed origins:{" "}
                  <span className="mono">{agent.status?.allowedOrigins.join(", ")}</span>
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
