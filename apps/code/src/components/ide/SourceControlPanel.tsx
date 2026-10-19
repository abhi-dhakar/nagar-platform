"use client";

import { useEffect, useState } from "react";
import type { AgentClient } from "@/lib/agent/client";
import { useGit } from "@/lib/agent/useGit";

export function SourceControlPanel({
  client,
  workspaceId,
  onRefreshExplorer,
  notify,
}: {
  client: AgentClient | null;
  workspaceId: string | null;
  onRefreshExplorer: () => void;
  notify: (msg: string, kind?: "success" | "error" | "info") => void;
}) {
  const git = useGit(client, workspaceId);
  const [commitMsg, setCommitMsg] = useState("");
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [diffStaged, setDiffStaged] = useState(false);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [showBranchCreate, setShowBranchCreate] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [showMerge, setShowMerge] = useState(false);
  const [mergeBranch, setMergeBranch] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [busy, setBusy] = useState(false);

  // Load git config for author if available
  useEffect(() => {
    if (!client || !workspaceId) return;
    client.gitConfigGet(workspaceId).then((cfg) => {
      if (cfg.config) {
        if (cfg.config["user.name"]) setAuthorName(cfg.config["user.name"]);
        if (cfg.config["user.email"]) setAuthorEmail(cfg.config["user.email"]);
      }
    }).catch(() => {});
  }, [client, workspaceId, git.status]);

  const handleInit = async () => {
    setBusy(true);
    try {
      await git.init("main");
      notify("Initialized Git repository", "success");
      onRefreshExplorer();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify(msg, "error");
    } finally { setBusy(false); }
  };

  const handleStage = async (path: string) => {
    setBusy(true);
    try {
      await git.stage([path]);
      notify(`Staged ${path}`, "success");
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const handleStageAll = async () => {
    setBusy(true);
    try {
      await git.stage(["."]);
      notify("Staged all changes", "success");
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const handleUnstage = async (path: string) => {
    setBusy(true);
    try {
      await git.unstage([path]);
      notify(`Unstaged ${path}`, "success");
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const handleUnstageAll = async () => {
    if (!git.status) return;
    const stagedPaths = git.status.staged.map((f) => f.path);
    if (stagedPaths.length === 0) return;
    setBusy(true);
    try {
      await git.unstage(stagedPaths);
      notify("Unstaged all", "success");
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) { notify("Enter a commit message", "info"); return; }
    setBusy(true);
    try {
      await git.commit(commitMsg.trim(), authorName && authorEmail ? { name: authorName, email: authorEmail } : undefined);
      setCommitMsg("");
      notify("Committed", "success");
      onRefreshExplorer();
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const handleCheckout = async (branch: string) => {
    setBusy(true);
    try {
      await git.checkout(branch);
      notify(`Switched to ${branch}`, "success");
      onRefreshExplorer();
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    setBusy(true);
    try {
      await git.createBranch(newBranchName.trim(), true);
      setNewBranchName("");
      setShowBranchCreate(false);
      notify(`Created and switched to ${newBranchName.trim()}`, "success");
      onRefreshExplorer();
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const handleDeleteBranch = async (name: string) => {
    if (!confirm(`Delete branch "${name}"?`)) return;
    setBusy(true);
    try {
      await git.deleteBranch(name);
      notify(`Deleted branch ${name}`, "success");
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const handleMerge = async () => {
    if (!mergeBranch) { notify("Select a branch to merge", "info"); return; }
    setBusy(true);
    try {
      const result = await git.merge(mergeBranch);
      if (result.conflicted && result.conflicted.length > 0) {
        notify(`Merge conflict in: ${result.conflicted.join(", ")}`, "error");
      } else {
        notify(`Merged ${mergeBranch} into ${git.currentBranch}`, "success");
        onRefreshExplorer();
      }
      setShowMerge(false);
      setMergeBranch("");
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const handleDiscard = async (path: string) => {
    if (!confirm(`Discard changes in ${path}?`)) return;
    setBusy(true);
    try {
      await git.discard(path);
      notify(`Discarded ${path}`, "success");
      onRefreshExplorer();
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const handleViewDiff = async (path: string, staged: boolean) => {
    if (!client || !workspaceId) return;
    setDiffPath(path);
    setDiffStaged(staged);
    setDiffText("Loading…");
    try {
      const result = await git.diff(path, staged);
      setDiffText(result.diff || "(no diff)");
    } catch (e) {
      setDiffText(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePush = async () => {
    if (!client || !workspaceId) return;
    const useCreds = git.remotes.length > 0 && git.remotes[0]?.fetchUrl?.includes("localhost:4000");
    // For NagarHub push we need credentials; prompt if needed
    let credentials: { username: string; password: string } | undefined;
    if (useCreds) {
      const email = prompt("NagarHub email for push:");
      if (!email) return;
      const password = prompt("NagarHub password:");
      if (!password) return;
      credentials = { username: email, password };
    }
    setBusy(true);
    try {
      const result = await git.push({ ...(credentials ? { credentials } : {}) });
      notify(`Push succeeded: ${result.output || "ok"}`, "success");
      await git.refresh();
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const handlePull = async () => {
    if (!client || !workspaceId) return;
    let credentials: { username: string; password: string } | undefined;
    const useCreds = git.remotes.some(r => r.fetchUrl.includes("localhost:4000"));
    if (useCreds) {
      const email = prompt("NagarHub email for pull:");
      if (!email) return;
      const password = prompt("NagarHub password:");
      if (!password) return;
      credentials = { username: email, password };
    }
    setBusy(true);
    try {
      const result = await git.pull({ ...(credentials ? { credentials } : {}) });
      if (result.conflicted) notify(`Pull conflict: ${result.conflicted.join(", ")}`, "error");
      else notify(`Pull succeeded`, "success");
      await git.refresh();
      onRefreshExplorer();
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const handleFetch = async () => {
    setBusy(true);
    try {
      const result = await git.fetch({});
      notify(`Fetch: ${result.output || "ok"}`, "success");
      await git.refresh();
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const handleSaveConfig = async () => {
    if (!authorName.trim() || !authorEmail.trim()) { notify("Enter both name and email", "info"); return; }
    setBusy(true);
    try {
      await git.setConfig("user.name", authorName.trim());
      await git.setConfig("user.email", authorEmail.trim());
      notify("Saved Git config", "success");
      setShowConfig(false);
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  if (!workspaceId || !client) {
    return (
      <div className="ide-placeholder">
        <div className="ide-placeholder-icon">⎇</div>
        <h3 className="ide-placeholder-title">Source Control</h3>
        <p className="ide-placeholder-desc">
          Connect the local agent and open a workspace to use Git. Local Git works without a NagarHub account.
        </p>
      </div>
    );
  }

  if (git.loading && !git.status) {
    return <div className="ide-search-empty"><p className="ide-muted">Loading Git status…</p></div>;
  }

  if (git.error && !git.status) {
    return (
      <div className="ide-search-panel" style={{ padding: 12 }}>
        <div className="ide-error">{git.error}</div>
        <button className="ide-secondary-btn small" style={{ marginTop: 8 }} onClick={() => git.refresh()}>Retry</button>
      </div>
    );
  }

  if (!git.isRepo) {
    return (
      <div className="ide-scm-panel">
        <div className="ide-sidebar-header">
          <h2 className="ide-sidebar-title">Source Control</h2>
        </div>
        <div style={{ padding: 16, display: "grid", gap: 12 }}>
          <p className="ide-muted small">This workspace is not a Git repository.</p>
          <button className="ide-primary-btn" onClick={handleInit} disabled={busy}>
            {busy ? "Initializing…" : "Initialize Repository"}
          </button>
          <p className="ide-muted small">Creates a new Git repo with branch <code>main</code>. Works offline.</p>
          {git.error ? <div className="ide-error">{git.error}</div> : null}
        </div>
      </div>
    );
  }

  const staged = git.status?.staged ?? [];
  const unstaged = git.status?.unstaged ?? [];
  const untracked = git.status?.untracked ?? [];
  // Derive display: unstaged includes modified not staged + untracked? Our status splits.
  // For UI, show Unstaged as unstaged files + untracked

  return (
    <div className="ide-scm-panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="ide-sidebar-header">
        <h2 className="ide-sidebar-title">Source Control</h2>
        <span className="ide-sidebar-subtitle" title={git.currentBranch ?? ""}>
          {git.currentBranch ? `⎇ ${git.currentBranch}` : "detached"}
          {git.status?.ahead ? ` ↑${git.status.ahead}` : ""}
          {git.status?.behind ? ` ↓${git.status.behind}` : ""}
        </span>
      </div>

      <div style={{ padding: "8px 12px", display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid var(--ide-border)" }}>
        <button className="ide-secondary-btn small" onClick={handleFetch} disabled={busy}>Fetch</button>
        <button className="ide-secondary-btn small" onClick={handlePull} disabled={busy}>Pull</button>
        <button className="ide-secondary-btn small" onClick={handlePush} disabled={busy}>Push</button>
        <button className="ide-secondary-btn small" onClick={() => git.refresh()} disabled={busy}>Refresh</button>
      </div>

      {git.status?.conflicted && git.status.conflicted.length > 0 ? (
        <div style={{ margin: 12, padding: 10, background: "rgba(255,100,78,0.15)", border: "1px solid rgba(255,100,78,0.4)", borderRadius: 6 }}>
          <strong style={{ fontSize: 12, color: "#ffb3a8" }}>Merge conflicts</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12 }}>
            {git.status.conflicted.map((f) => <li key={f}>{f}</li>)}
          </ul>
          <p className="ide-muted small" style={{ marginTop: 6 }}>Resolve conflicts in the editor, then stage and commit.</p>
        </div>
      ) : null}

      {/* Commit box */}
      <div style={{ padding: 12, borderBottom: "1px solid var(--ide-border)", display: "grid", gap: 8 }}>
        <textarea
          className="ide-input"
          placeholder="Commit message"
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          rows={3}
          style={{ resize: "vertical", fontSize: 12 }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <button className="ide-primary-btn small" onClick={handleCommit} disabled={busy || !commitMsg.trim() || staged.length === 0}>
            Commit
          </button>
          <button className="ide-secondary-btn small" onClick={() => setShowConfig((v) => !v)}>
            Config
          </button>
          <span className="ide-muted small" style={{ marginLeft: "auto", alignSelf: "center" }}>
            {staged.length} staged
          </span>
        </div>
        {showConfig ? (
          <div style={{ display: "grid", gap: 6, padding: 8, background: "#0a0f0a", border: "1px solid var(--ide-border)", borderRadius: 6 }}>
            <label className="ide-field-label">user.name</label>
            <input className="ide-input small" value={authorName} onChange={(e) => setAuthorName(e.target.value)} placeholder="Your Name" />
            <label className="ide-field-label">user.email</label>
            <input className="ide-input small" value={authorEmail} onChange={(e) => setAuthorEmail(e.target.value)} placeholder="you@example.com" />
            <button className="ide-secondary-btn small" onClick={handleSaveConfig} disabled={busy}>Save</button>
          </div>
        ) : null}
        {staged.length === 0 ? <p className="ide-muted small">Stage changes to enable commit.</p> : null}
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Staged */}
        <div className="ide-search-group">
          <div className="ide-search-group-head">
            <span className="ide-search-path">Staged Changes</span>
            <div style={{ display: "flex", gap: 4 }}>
              <span className="ide-search-count">{staged.length}</span>
              {staged.length > 0 ? <button className="ide-secondary-btn small" onClick={handleUnstageAll} disabled={busy}>Unstage All</button> : null}
            </div>
          </div>
          {staged.length === 0 ? <div className="ide-muted small" style={{ padding: "8px 12px" }}>No staged changes</div> : staged.map((f) => (
            <div key={`staged-${f.path}`} className="ide-scm-file" style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", fontSize: 12 }}>
              <span style={{ width: 14, textAlign: "center", fontWeight: 700, color: f.staged === "A" ? "#baff69" : f.staged === "D" ? "#ff644e" : "#7aa2ff" }}>{f.staged}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.path}>{f.path}</span>
              <button className="ide-icon-btn" title="Unstage" onClick={() => handleUnstage(f.path)} disabled={busy} style={{ width: 22, height: 22, fontSize: 12 }}>−</button>
              <button className="ide-icon-btn" title="View diff" onClick={() => handleViewDiff(f.path, true)}>⋯</button>
            </div>
          ))}
        </div>

        {/* Unstaged + untracked */}
        <div className="ide-search-group">
          <div className="ide-search-group-head">
            <span className="ide-search-path">Changes</span>
            <div style={{ display: "flex", gap: 4 }}>
              <span className="ide-search-count">{unstaged.length + untracked.length}</span>
              {(unstaged.length + untracked.length) > 0 ? <button className="ide-secondary-btn small" onClick={handleStageAll} disabled={busy}>Stage All</button> : null}
            </div>
          </div>
          {untracked.map((path) => (
            <div key={`untracked-${path}`} className="ide-scm-file" style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", fontSize: 12 }}>
              <span style={{ width: 14, textAlign: "center", fontWeight: 700, color: "#ffb02e" }}>?</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{path}</span>
              <button className="ide-icon-btn" title="Stage" onClick={() => handleStage(path)} disabled={busy} style={{ width: 22, height: 22 }}>+</button>
            </div>
          ))}
          {unstaged.map((f) => (
            <div key={`unstaged-${f.path}`} className="ide-scm-file" style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", fontSize: 12 }}>
              <span style={{ width: 14, textAlign: "center", fontWeight: 700, color: f.unstaged === "M" ? "#ffb02e" : f.unstaged === "D" ? "#ff644e" : "#7aa2ff" }}>{f.unstaged}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.path}>{f.path}</span>
              <button className="ide-icon-btn" title="Stage" onClick={() => handleStage(f.path)} disabled={busy} style={{ width: 22, height: 22 }}>+</button>
              <button className="ide-icon-btn" title="Discard" onClick={() => handleDiscard(f.path)} disabled={busy} style={{ width: 22, height: 22 }}>↺</button>
              <button className="ide-icon-btn" title="View diff" onClick={() => handleViewDiff(f.path, false)}>⋯</button>
            </div>
          ))}
          {unstaged.length === 0 && untracked.length === 0 ? <div className="ide-muted small" style={{ padding: "8px 12px" }}>No changes — working tree clean</div> : null}
        </div>

        {/* Branches */}
        <div className="ide-search-group">
          <div className="ide-search-group-head">
            <span className="ide-search-path">Branches</span>
            <button className="ide-secondary-btn small" onClick={() => setShowBranchCreate((v) => !v)}>New</button>
          </div>
          {showBranchCreate ? (
            <div style={{ padding: 8, display: "flex", gap: 6 }}>
              <input className="ide-input small" placeholder="branch name" value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} style={{ flex: 1 }} />
              <button className="ide-primary-btn small" onClick={handleCreateBranch} disabled={busy || !newBranchName.trim()}>Create</button>
            </div>
          ) : null}
          {git.branches.map((b) => (
            <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", fontSize: 12, background: b.current ? "rgba(186,255,105,0.08)" : "transparent", borderLeft: b.current ? "2px solid var(--ide-accent)" : "2px solid transparent" }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: b.current ? 700 : 400 }}>{b.name} {b.current ? "(current)" : ""}</span>
              {!b.current ? <button className="ide-secondary-btn small" onClick={() => handleCheckout(b.name)} disabled={busy}>Checkout</button> : null}
              <button className="ide-icon-btn" title="Delete" onClick={() => handleDeleteBranch(b.name)} disabled={busy || b.current} style={{ opacity: b.current ? 0.3 : 1 }}>🗑</button>
            </div>
          ))}
          <div style={{ padding: 8, display: "flex", gap: 6 }}>
            <button className="ide-secondary-btn small" onClick={() => setShowMerge((v) => !v)}>Merge…</button>
            {showMerge ? (
              <>
                <select className="ide-select small" value={mergeBranch} onChange={(e) => setMergeBranch(e.target.value)} style={{ flex: 1 }}>
                  <option value="">Select branch</option>
                  {git.branches.filter((b) => !b.current).map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
                </select>
                <button className="ide-primary-btn small" onClick={handleMerge} disabled={busy || !mergeBranch}>Merge</button>
              </>
            ) : null}
          </div>
        </div>

        {/* Remotes */}
        <div className="ide-search-group">
          <div className="ide-search-group-head">
            <span className="ide-search-path">Remotes</span>
            <span className="ide-search-count">{git.remotes.length}</span>
          </div>
          {git.remotes.length === 0 ? <div className="ide-muted small" style={{ padding: "8px 12px" }}>No remotes</div> : git.remotes.map((r) => (
            <div key={r.name} style={{ padding: "6px 10px", fontSize: 11, display: "grid", gap: 2 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{r.name}</strong>
                <button className="ide-icon-btn" title="Remove" onClick={async () => { if (confirm(`Remove remote ${r.name}?`)) { setBusy(true); try { await git.removeRemote(r.name); notify(`Removed ${r.name}`, "success"); } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); } finally { setBusy(false); } } }} style={{ width: 20, height: 20 }}>×</button>
              </div>
              <div className="ide-muted small" style={{ wordBreak: "break-all" }}>{r.fetchUrl}</div>
            </div>
          ))}
          <div style={{ padding: 8 }}>
            <AddRemoteForm onAdd={async (name, url) => { setBusy(true); try { await git.addRemote(name, url); notify(`Added remote ${name}`, "success"); } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); } finally { setBusy(false); } }} />
          </div>
        </div>

        {/* Commit history */}
        <div className="ide-search-group">
          <div className="ide-search-group-head">
            <span className="ide-search-path">History</span>
            <span className="ide-search-count">{git.log?.commits.length ?? 0}{git.log?.hasMore ? "+" : ""}</span>
          </div>
          {!git.log || git.log.commits.length === 0 ? <div className="ide-muted small" style={{ padding: "8px 12px" }}>No commits</div> : git.log.commits.map((c) => (
            <div key={c.sha} style={{ padding: "6px 10px", borderBottom: "1px solid var(--ide-border)", fontSize: 11 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--ide-accent)", fontSize: 10 }}>{c.shortSha}</span>
                <span style={{ flex: 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message}</span>
              </div>
              <div className="ide-muted small" style={{ fontSize: 10 }}>{c.author} — {new Date(c.date).toLocaleString()}</div>
            </div>
          ))}
        </div>

        {git.error ? <div className="ide-error" style={{ margin: 12 }}>{git.error}</div> : null}
      </div>

      {/* Diff viewer */}
      {diffPath ? (
        <div style={{ borderTop: "1px solid var(--ide-border)", background: "#0a0f0a", padding: 8, maxHeight: 240, overflow: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <strong style={{ fontSize: 11 }}>{diffStaged ? "Staged" : "Unstaged"} diff: {diffPath}</strong>
            <button className="ide-icon-btn" onClick={() => setDiffPath(null)}>×</button>
          </div>
          <pre style={{ font: "11px ui-monospace, monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#070b07", padding: 8, borderRadius: 6, border: "1px solid var(--ide-border)", maxHeight: 180, overflow: "auto" }}>{diffText}</pre>
        </div>
      ) : null}
    </div>
  );
}

function AddRemoteForm({ onAdd }: { onAdd: (name: string, url: string) => void }) {
  const [name, setName] = useState("origin");
  const [url, setUrl] = useState("");
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input className="ide-input small" placeholder="name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 90 }} />
        <input className="ide-input small" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
      </div>
      <button className="ide-secondary-btn small" onClick={() => { if (name.trim() && url.trim()) { onAdd(name.trim(), url.trim()); setUrl(""); } }} disabled={!name.trim() || !url.trim()}>
        Add remote
      </button>
    </div>
  );
}
