"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HubFrame } from "./hub-frame";

type TreeEntry = {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink" | "submodule";
  sha: string;
};
type Commit = {
  sha: string;
  shortSha: string;
  author: string;
  email: string;
  date: string;
  message: string;
};
type Repository = {
  id: string;
  name: string;
  slug: string;
  updatedAt: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  owner: { id: string; name: string; username: string | null };
  cloneUrl: string | null;
  namespaceType?: "USER" | "ORGANIZATION";
  defaultBranch: string | null;
  branch: string | null;
  branches: string[];
  files: TreeEntry[];
  commits: Commit[];
  readme: string | null;
};

async function apiJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const body = (await response.json()) as { data?: T; error?: { message?: string } };
  if (!response.ok || !body.data)
    throw new Error(body.error?.message ?? "Couldn't load this repository.");
  return body.data;
}

export function RepositoryBrowser({ username, slug }: { username: string; slug: string }) {
  const [repository, setRepository] = useState<Repository | null>(null);
  const [branch, setBranch] = useState("");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const loadRepository = useCallback(
    async (selectedBranch?: string) => {
      setLoading(true);
      setError("");
      try {
        const query = selectedBranch ? `?ref=${encodeURIComponent(selectedBranch)}` : "";
        const data = await apiJson<{ repository: Repository }>(
          `/api/v1/repositories/${encodeURIComponent(username)}/${encodeURIComponent(slug)}${query}`,
        );
        setRepository(data.repository);
        setBranch(data.repository.branch ?? data.repository.defaultBranch ?? "main");
        setPath("");
        setEntries(data.repository.files);
        setSelectedFile("");
        setFileContent("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Repository couldn't be loaded.");
      } finally {
        setLoading(false);
      }
    },
    [slug, username],
  );

  useEffect(() => {
    void loadRepository();
  }, [loadRepository]);

  async function openFolder(nextPath: string) {
    if (!branch) return;
    setError("");
    try {
      const query = new URLSearchParams({ ref: branch, path: nextPath });
      const data = await apiJson<{ entries: TreeEntry[] }>(
        `/api/v1/repositories/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/contents?${query}`,
      );
      setPath(nextPath);
      setEntries(data.entries);
      setSelectedFile("");
      setFileContent("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Folder couldn't be opened.");
    }
  }

  async function openFile(filePath: string) {
    if (!branch) return;
    setSelectedFile(filePath);
    setLoadingFile(true);
    setError("");
    try {
      const query = new URLSearchParams({ ref: branch, path: filePath });
      const data = await apiJson<{ content: string }>(
        `/api/v1/repositories/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/blob?${query}`,
      );
      setFileContent(data.content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "File couldn't be opened.");
    } finally {
      setLoadingFile(false);
    }
  }

  async function copyCloneUrl() {
    if (!repository?.cloneUrl) return;
    try {
      await navigator.clipboard.writeText(repository.cloneUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard access isn't available here. Select and copy the URL instead.");
    }
  }

  const breadcrumbs = path ? path.split("/") : [];
  const orderedEntries = [...entries].sort(
    (a, b) =>
      Number(b.kind === "directory") - Number(a.kind === "directory") ||
      a.name.localeCompare(b.name),
  );

  return (
    <HubFrame>
      <section className="repo-page">
        {loading && !repository ? (
          <div className="empty-state">Loading repository…</div>
        ) : error && !repository ? (
          <div className="error-banner">{error}</div>
        ) : repository ? (
          <>
            <div className="repo-heading">
              <p className="eyebrow">
                <Link
                  href={
                    repository.namespaceType === "ORGANIZATION"
                      ? `/organizations/${username}`
                      : `/${username}`
                  }
                  className="profile-crumb"
                >
                  {username}
                </Link>
                <span>/</span> REPOSITORY
              </p>
              <h1>
                {repository.slug}
                <span className={`visibility ${repository.visibility.toLowerCase()}`}>
                  {repository.visibility === "PRIVATE" ? "◉ Private" : "◎ Public"}
                </span>
              </h1>
              <p className="repo-description">
                {repository.description || "A project hosted on NagarHub."}
              </p>
              <div className="repo-heading-meta">
                <Link
                  href={
                    repository.namespaceType === "ORGANIZATION"
                      ? `/organizations/${username}`
                      : `/${username}`
                  }
                  className="owner-chip"
                >
                  <span>{repository.owner.name.slice(0, 1).toUpperCase()}</span>
                  {repository.owner.name}
                </Link>
                <span>Updated {new Date(repository.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="repo-toolbar">
              <div className="repo-tabs">
                <span className="active-tab">⌘ Code</span>
                <span>
                  ◷ Commits <b>{repository.commits.length}</b>
                </span>
                <span>
                  ⑂ Branches <b>{repository.branches.length}</b>
                </span>
              </div>
              <div className="clone-control">
                <span>HTTPS</span>
                <code>{repository.cloneUrl ?? "Git URL unavailable"}</code>
                <button
                  onClick={() => void copyCloneUrl()}
                  disabled={!repository.cloneUrl}
                  aria-label="Copy clone URL"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <nav className="collab-tabs repo-collab-nav" aria-label="Repository collaboration">
              <Link href={`/${username}/${slug}/issues`}>Issues →</Link>
              <Link href={`/${username}/${slug}/pulls`}>Pull requests →</Link>
              <Link href={`/${username}/${slug}/settings`}>Access & webhooks →</Link>
            </nav>
            {error && (
              <div className="error-banner compact-error" role="alert">
                {error}
              </div>
            )}
            <div className="repo-content-grid">
              <div className="repo-main-column">
                <div className="file-browser">
                  <div className="file-browser-head">
                    <label className="branch-select">
                      <span>⑂</span>
                      <select
                        aria-label="Select branch"
                        value={branch}
                        onChange={(event) => void loadRepository(event.target.value)}
                        disabled={!repository.branches.length}
                      >
                        {repository.branches.length ? (
                          repository.branches.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))
                        ) : (
                          <option value="main">main</option>
                        )}
                      </select>
                    </label>
                    <span className="file-path">
                      {repository.owner.username}/{repository.slug}
                      {path ? ` / ${path}` : ""}
                    </span>
                    <span className="file-count">{entries.length} items</span>
                  </div>
                  {breadcrumbs.length > 0 && (
                    <div className="breadcrumbs">
                      <button onClick={() => void openFolder("")}>root</button>
                      {breadcrumbs.map((part, index) => {
                        const target = breadcrumbs.slice(0, index + 1).join("/");
                        return (
                          <span key={target}>
                            <i>/</i>
                            <button onClick={() => void openFolder(target)}>{part}</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {orderedEntries.length > 0 ? (
                    <div className="file-list">
                      {orderedEntries.map((entry) => (
                        <button
                          key={entry.path}
                          className="file-row"
                          onClick={() =>
                            entry.kind === "directory"
                              ? void openFolder(entry.path)
                              : void openFile(entry.path)
                          }
                        >
                          <span className={`file-icon ${entry.kind}`}>
                            {entry.kind === "directory"
                              ? "▰"
                              : entry.kind === "symlink"
                                ? "↗"
                                : entry.kind === "submodule"
                                  ? "⬡"
                                  : "▤"}
                          </span>
                          <span className="file-name">{entry.name}</span>
                          <code>{entry.sha.slice(0, 7)}</code>
                          <span className="file-open">
                            {entry.kind === "directory" ? "Open →" : "View →"}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-files">
                      <span>⌁</span>
                      <b>
                        {repository.branches.length
                          ? "This directory is empty."
                          : "No commits yet."}
                      </b>
                      <p>
                        {repository.branches.length
                          ? "Add files and push a commit to this branch."
                          : "Clone this repository, commit your work, then push to main."}
                      </p>
                    </div>
                  )}
                </div>

                {selectedFile ? (
                  <section className="readme-card file-preview">
                    <div className="readme-title">
                      <span>▤</span>
                      <b>{selectedFile}</b>
                      <span>FILE</span>
                    </div>
                    {loadingFile ? (
                      <p className="muted">Loading file…</p>
                    ) : (
                      <pre className="source-preview">
                        <code>{fileContent}</code>
                      </pre>
                    )}
                  </section>
                ) : repository.readme ? (
                  <section className="readme-card">
                    <div className="readme-title">
                      <span>▤</span>
                      <b>README.md</b>
                      <span>PREVIEW</span>
                    </div>
                    <article className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{repository.readme}</ReactMarkdown>
                    </article>
                  </section>
                ) : null}
              </div>

              <aside className="repo-sidebar">
                <section className="side-card">
                  <p className="eyebrow">ABOUT</p>
                  <p>{repository.description || "No description provided."}</p>
                  <div className="side-stats">
                    <span>⑂ {repository.branches.length} branches</span>
                    <span>◷ {repository.commits.length} commits shown</span>
                  </div>
                </section>
                <section className="side-card">
                  <div className="side-title">
                    <p className="eyebrow">RECENT COMMITS</p>
                    <span>{branch}</span>
                  </div>
                  {repository.commits.length ? (
                    <div className="commit-list">
                      {repository.commits.slice(0, 8).map((commit) => (
                        <article key={commit.sha} className="commit-item">
                          <span className="commit-dot" />
                          <div>
                            <b>{commit.message || "(no commit message)"}</b>
                            <p>
                              {commit.author} · {new Date(commit.date).toLocaleDateString()}
                            </p>
                            <code>{commit.shortSha}</code>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="side-muted">Commits appear here after your first push.</p>
                  )}
                </section>
                <section className="side-tip">
                  <span>✳</span>
                  <div>
                    <b>Keep building.</b>
                    <p>
                      Clone, commit, and push from any Git client. Your repository view updates from
                      Git storage.
                    </p>
                  </div>
                </section>
              </aside>
            </div>
          </>
        ) : null}
      </section>
    </HubFrame>
  );
}
