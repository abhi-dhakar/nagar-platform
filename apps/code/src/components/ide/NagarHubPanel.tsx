"use client";

import { useEffect, useState } from "react";
import { useNagarHub } from "@/lib/nagarhub/useNagarHub";
import { getRepository } from "@/lib/nagarhub/client";
import type { AgentClient } from "@/lib/agent/client";

export function NagarHubPanel({
  client,
  workspaceId,
  workspaceRoot,
  onOpenWorkspace,
  notify,
}: {
  client: AgentClient | null;
  workspaceId: string | null;
  workspaceRoot: string | null;
  onOpenWorkspace: (path: string) => Promise<void>;
  notify: (msg: string, kind?: "success" | "error" | "info") => void;
}) {
  const hub = useNagarHub();
  const [signInMode, setSignInMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [hubUrlInput, setHubUrlInput] = useState(hub.hubUrl);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDesc, setNewRepoDesc] = useState("");
  const [newRepoVisibility, setNewRepoVisibility] = useState<"PRIVATE" | "PUBLIC">("PRIVATE");
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [repoDetails, setRepoDetails] = useState<import("@/lib/nagarhub/types").NagarHubRepositoryDetails | null>(null);
  const [connectUrl, setConnectUrl] = useState("");
  const [cloneTarget, setCloneTarget] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [cloneBusy, setCloneBusy] = useState(false);

  useEffect(() => setHubUrlInput(hub.hubUrl), [hub.hubUrl]);

  const handleSaveHubUrl = () => {
    hub.updateHubUrl(hubUrlInput);
    notify(`NagarHub URL set to ${hubUrlInput}`, "success");
    void hub.refresh();
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password) { notify("Enter email and password", "info"); return; }
    const ok = await hub.signIn(email.trim(), password);
    if (ok) notify("Signed in to NagarHub", "success");
    else notify(hub.error ?? "Sign-in failed", "error");
  };

  const handleSignUp = async () => {
    if (!name.trim() || !email.trim() || !password || !username.trim()) { notify("Fill all fields", "info"); return; }
    const ok = await hub.signUp({ name: name.trim(), email: email.trim(), password, username: username.trim().toLowerCase() });
    if (ok) notify("Account created and signed in", "success");
    else notify(hub.error ?? "Sign-up failed", "error");
  };

  const handleCreateRepo = async () => {
    if (!newRepoName.trim()) { notify("Enter repository name", "info"); return; }
    try {
      const repo = await hub.createRepo({ name: newRepoName.trim(), ...(newRepoDesc.trim() ? { description: newRepoDesc.trim() } : {}), visibility: newRepoVisibility });
      notify(`Created repository ${repo.slug}`, "success");
      setNewRepoName("");
      setNewRepoDesc("");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const handleSelectRepo = async (owner: string, slug: string) => {
    const key = `${owner}/${slug}`;
    setSelectedRepo(key);
    try {
      const details = await getRepository(owner, slug);
      setRepoDetails(details);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied to clipboard", "success");
    } catch {
      notify("Copy failed", "error");
    }
  };

  const handleClone = async (cloneUrl: string) => {
    if (!client) { notify("Connect the local agent first", "info"); return; }
    // Determine target path: use cloneTarget if set, otherwise suggest from workspaceRoot parent + slug
    let targetPath = cloneTarget.trim();
    if (!targetPath) {
      if (!workspaceRoot) { notify("Enter a target path for clone", "info"); return; }
      // Suggest sibling: parent of workspaceRoot + repo slug
      const parts = cloneUrl.split("/");
      const slugPart = parts[parts.length - 1] ?? "repo";
      const slug = slugPart.replace(/\.git$/, "");
      targetPath = `${workspaceRoot.replace(/\/[^/]+$/, "")}/${slug}`;
    }
    setCloneBusy(true);
    try {
      // Need credentials if private; ask if needed
      let credentials: { username: string; password: string } | undefined;
      // If repo is private or we don't know, prompt for creds if user is authenticated private?
      // For simplicity, if hub user exists, ask for credentials to allow private clone
      const shouldAsk = hub.user && cloneUrl.includes("localhost:4000");
      if (shouldAsk) {
        const ask = confirm("This repository may be private. Provide NagarHub credentials for clone? (Cancel to try without auth)");
        if (ask) {
          const em = prompt("NagarHub email:");
          if (!em) { setCloneBusy(false); return; }
          const pw = prompt("NagarHub password:");
          if (!pw) { setCloneBusy(false); return; }
          credentials = { username: em, password: pw };
        }
      }
      const result = await client.gitClone(cloneUrl, targetPath, credentials ? { credentials } : {});
      notify(`Cloned to ${result.targetPath}`, "success");
      if (result.workspace) {
        await onOpenWorkspace(result.workspace.root);
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally { setCloneBusy(false); }
  };

  const handleConnect = async () => {
    if (!client || !workspaceId) { notify("Open a local workspace first", "info"); return; }
    if (!connectUrl.trim()) { notify("Enter a NagarHub clone URL", "info"); return; }
    try {
      await client.gitAddRemote(workspaceId, "origin", connectUrl.trim());
      notify(`Connected remote origin → ${connectUrl.trim()}`, "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const handlePullPush = async (action: "pull" | "push" | "fetch") => {
    if (!client || !workspaceId) { notify("Open a workspace first", "info"); return; }
    let credentials: { username: string; password: string } | undefined;
    // Always prompt for credentials when pushing/fetching private NagarHub remotes
    const promptCreds = hub.user !== null;
    if (promptCreds) {
      const em = email || prompt("NagarHub email for " + action + ":");
      if (!em) return;
      const pw = password || prompt("NagarHub password:");
      if (!pw) return;
      credentials = { username: em as string, password: pw as string };
    }
    setPushBusy(true);
    try {
      if (action === "push") {
        const result = await client.gitPush(workspaceId, { ...(credentials ? { credentials } : {}) });
        notify(`Push: ${result.output || "ok"}`, "success");
      } else if (action === "pull") {
        const result = await client.gitPull(workspaceId, { ...(credentials ? { credentials } : {}) });
        if (result.conflicted) notify(`Pull conflict: ${result.conflicted.join(", ")}`, "error");
        else notify(`Pull: ${result.output || "ok"}`, "success");
      } else {
        const result = await client.gitFetch(workspaceId, { ...(credentials ? { credentials } : {}) });
        notify(`Fetch: ${result.output || "ok"}`, "success");
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally { setPushBusy(false); }
  };

  if (!hub.initialChecked) {
    return <div className="ide-search-empty"><p className="ide-muted">Loading NagarHub…</p></div>;
  }

  return (
    <div className="ide-nagarhub-panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="ide-sidebar-header">
        <h2 className="ide-sidebar-title">NagarHub</h2>
        <span className="ide-sidebar-subtitle">{hub.isAuthenticated ? hub.user?.username : "not signed in"}</span>
      </div>

      <div style={{ flex: 1, overflow: "auto", display: "grid", gap: 12, padding: 12 }}>
        {/* Hub URL config */}
        <div style={{ display: "grid", gap: 6, padding: 10, background: "#0a0f0a", border: "1px solid var(--ide-border)", borderRadius: 6 }}>
          <label className="ide-field-label">NagarHub URL</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="ide-input small" value={hubUrlInput} onChange={(e) => setHubUrlInput(e.target.value)} placeholder="http://localhost:4000" style={{ flex: 1 }} />
            <button className="ide-secondary-btn small" onClick={handleSaveHubUrl}>Save</button>
          </div>
          <span className="ide-muted small">API base: {hub.hubUrl}/api/v1 — use http://localhost:4000 for local dev or your deployed API URL.</span>
          {hub.error ? <div className="ide-error" style={{ fontSize: 11 }}>{hub.error}</div> : null}
        </div>

        {/* Auth */}
        {!hub.isAuthenticated ? (
          <div style={{ padding: 10, border: "1px solid var(--ide-border)", borderRadius: 6, display: "grid", gap: 8, background: "#101610" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <button className={`ide-secondary-btn small ${signInMode === "signin" ? "active" : ""}`} style={{ background: signInMode === "signin" ? "var(--ide-accent)" : undefined, color: signInMode === "signin" ? "#0a0f0a" : undefined }} onClick={() => setSignInMode("signin")}>Sign in</button>
              <button className={`ide-secondary-btn small ${signInMode === "signup" ? "active" : ""}`} style={{ background: signInMode === "signup" ? "var(--ide-accent)" : undefined, color: signInMode === "signup" ? "#0a0f0a" : undefined }} onClick={() => setSignInMode("signup")}>Create account</button>
            </div>

            {signInMode === "signup" ? (
              <>
                <input className="ide-input small" placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
                <input className="ide-input small" placeholder="Username (a-z, 0-9, hyphen)" value={username} onChange={(e) => setUsername(e.target.value)} />
              </>
            ) : null}
            <input className="ide-input small" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="ide-input small" placeholder="Password (≥12 chars)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {signInMode === "signin" ? (
              <button className="ide-primary-btn small" onClick={handleSignIn} disabled={hub.loading}>{hub.loading ? "Signing in…" : "Sign in"}</button>
            ) : (
              <button className="ide-primary-btn small" onClick={handleSignUp} disabled={hub.loading}>{hub.loading ? "Creating…" : "Create account"}</button>
            )}
            <p className="ide-muted small">One Nagar identity across Hub, Code & Deploy. Private repos require authorization — enforced by the server.</p>
          </div>
        ) : (
          <div style={{ padding: 10, border: "1px solid var(--ide-border)", borderRadius: 6, background: "rgba(186,255,105,0.06)", display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 12 }}>{hub.user?.name} <span className="ide-muted">@{hub.user?.username}</span></strong>
              <button className="ide-secondary-btn small" onClick={() => hub.signOut()}>Sign out</button>
            </div>
            <div className="ide-muted small">{hub.user?.email}</div>
            <button className="ide-secondary-btn small" onClick={() => hub.refresh()} disabled={hub.loading}>Refresh</button>
          </div>
        )}

        {/* Repositories */}
        {hub.isAuthenticated ? (
          <>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Your repositories</h3>
                <button className="ide-secondary-btn small" onClick={() => hub.refresh()} disabled={hub.loading}>Reload</button>
              </div>

              {/* Create repo */}
              <div style={{ display: "grid", gap: 6, padding: 8, background: "#0a0f0a", border: "1px solid var(--ide-border)", borderRadius: 6 }}>
                <label className="ide-field-label">Create repository</label>
                <input className="ide-input small" placeholder="repository name" value={newRepoName} onChange={(e) => setNewRepoName(e.target.value)} />
                <input className="ide-input small" placeholder="description (optional)" value={newRepoDesc} onChange={(e) => setNewRepoDesc(e.target.value)} />
                <select className="ide-select small" value={newRepoVisibility} onChange={(e) => setNewRepoVisibility(e.target.value as "PRIVATE" | "PUBLIC")}>
                  <option value="PRIVATE">Private</option>
                  <option value="PUBLIC">Public</option>
                </select>
                <button className="ide-primary-btn small" onClick={handleCreateRepo} disabled={hub.loading || !newRepoName.trim()}>
                  Create repository
                </button>
                <span className="ide-muted small">Private repos are server-enforced — no client bypass.</span>
              </div>

              {/* List */}
              {hub.repositories.length === 0 ? (
                <div className="ide-muted small" style={{ padding: "8px 12px", border: "1px dashed var(--ide-border)", borderRadius: 6 }}>No repositories yet. Create one above.</div>
              ) : (
                hub.repositories.map((repo) => (
                  <div key={repo.id} style={{ padding: 8, border: "1px solid var(--ide-border)", borderRadius: 6, background: selectedRepo === `${repo.namespace}/${repo.slug}` ? "rgba(186,255,105,0.06)" : "#0e140f", display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                      <strong style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{repo.namespace}/{repo.slug}</strong>
                      <span className="ide-search-count" style={{ fontSize: 10 }}>{repo.visibility}</span>
                    </div>
                    {repo.description ? <div className="ide-muted small" style={{ fontSize: 11 }}>{repo.description}</div> : null}
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                      <button className="ide-secondary-btn small" onClick={() => handleSelectRepo(repo.namespace!, repo.slug)}>Details</button>
                      {repo.cloneUrl ? (
                        <>
                          <button className="ide-secondary-btn small" onClick={() => handleCopy(repo.cloneUrl!)}>Copy URL</button>
                          <button className="ide-primary-btn small" onClick={() => handleClone(repo.cloneUrl!)} disabled={cloneBusy || !client}>
                            Clone
                          </button>
                        </>
                      ) : null}
                    </div>
                    {repo.cloneUrl ? <div className="ide-muted small" style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, wordBreak: "break-all" }}>{repo.cloneUrl}</div> : null}
                  </div>
                ))
              )}
            </div>

            {/* Selected repo details */}
            {selectedRepo && repoDetails ? (
              <div style={{ padding: 10, border: "1px solid var(--ide-border)", borderRadius: 6, background: "#0e140f", display: "grid", gap: 6 }}>
                <h4 style={{ margin: 0, fontSize: 12 }}>{selectedRepo}</h4>
                <div className="ide-muted small" style={{ display: "grid", gap: 2 }}>
                  <span>Branch: {repoDetails.defaultBranch ?? "—"} • Branches: {repoDetails.branches?.join(", ") || "—"}</span>
                  <span>Files: {repoDetails.files?.length ?? 0} • Commits: {repoDetails.commits?.length ?? 0}</span>
                </div>
                {repoDetails.cloneUrl ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <code className="ide-inline-code" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{repoDetails.cloneUrl}</code>
                    <button className="ide-secondary-btn small" onClick={() => handleCopy(repoDetails.cloneUrl as string)}>Copy</button>
                  </div>
                ) : null}
                <button className="ide-secondary-btn small" onClick={() => { setSelectedRepo(null); setRepoDetails(null); }}>Close</button>
              </div>
            ) : null}

            {/* Connect existing local repo */}
            <div style={{ display: "grid", gap: 6, padding: 10, border: "1px solid var(--ide-border)", borderRadius: 6, background: "#0a0f0a" }}>
              <label className="ide-field-label">Connect local workspace to NagarHub</label>
              <input className="ide-input small" placeholder="https://.../namespace/repo.git" value={connectUrl} onChange={(e) => setConnectUrl(e.target.value)} />
              <button className="ide-secondary-btn small" onClick={handleConnect} disabled={!client || !workspaceId || !connectUrl.trim()}>Add as origin</button>
              <span className="ide-muted small">Adds a remote named “origin”. Credentials are never stored in the URL — they’re sent via secure header on push.</span>
            </div>

            {/* Clone arbitrary */}
            <div style={{ display: "grid", gap: 6, padding: 10, border: "1px solid var(--ide-border)", borderRadius: 6, background: "#0a0f0a" }}>
              <label className="ide-field-label">Clone repository</label>
              <input className="ide-input small" placeholder="Clone URL (from Details)" value={connectUrl} onChange={(e) => setConnectUrl(e.target.value)} />
              <input className="ide-input small" placeholder="Target path (absolute, inside allowed roots)" value={cloneTarget} onChange={(e) => setCloneTarget(e.target.value)} />
              <button className="ide-primary-btn small" onClick={() => handleClone(connectUrl)} disabled={cloneBusy || !connectUrl.trim() || !client}>
                {cloneBusy ? "Cloning…" : "Clone into target"}
              </button>
              <span className="ide-muted small">Clone uses real Git over HTTPS. Private repos require your NagarHub email + password.</span>
            </div>

            {/* Push/Pull/Fetch controls */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className="ide-secondary-btn small" onClick={() => handlePullPush("fetch")} disabled={pushBusy || !workspaceId}>Fetch</button>
              <button className="ide-secondary-btn small" onClick={() => handlePullPush("pull")} disabled={pushBusy || !workspaceId}>Pull</button>
              <button className="ide-primary-btn small" onClick={() => handlePullPush("push")} disabled={pushBusy || !workspaceId}>{pushBusy ? "Working…" : "Push"}</button>
            </div>
            {hub.error ? <div className="ide-error">{hub.error}</div> : null}
            {!client ? <div className="ide-muted small">Connect the local agent to clone/push/pull.</div> : null}
            {!workspaceId ? <div className="ide-muted small">Open a workspace to connect, push or pull.</div> : null}
          </>
        ) : (
          <div className="ide-muted small" style={{ padding: 12, border: "1px dashed var(--ide-border)", borderRadius: 6 }}>
            Sign in to view your repositories, create new ones, and clone. Local Git works without signing in.
          </div>
        )}

        <div style={{ padding: 10, borderTop: "1px dashed var(--ide-border)", marginTop: 4 }}>
          <p className="ide-muted small">
            NagarHub is our Git hosting platform — not GitHub. Clone URLs use <code>NAGAR_GIT_BASE_URL</code> and Git Basic auth with your Nagar email/password. Private repo access is enforced by the server. No credentials are written to frontend code, URLs, or logs.
          </p>
          <p className="ide-muted small">
            If the backend is unreachable, remote operations are disabled but local Git keeps working.
          </p>
        </div>
      </div>
    </div>
  );
}
