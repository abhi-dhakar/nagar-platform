"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HubFrame } from "./hub-frame";
import { RepositoryNav } from "./repository-nav";

type Commit = {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  message: string;
};
type HistoryPage = {
  ref: string | null;
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
  commits: Commit[];
};
type Branch = { name: string; isDefault: boolean };

async function api<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json()) as { data?: T; error?: { message?: string } };
  if (!response.ok || !payload.data)
    throw new Error(payload.error?.message ?? "Couldn't load commit history.");
  return payload.data;
}

export function CommitHistory({
  username,
  repository,
  branch,
  page,
}: {
  username: string;
  repository: string;
  branch?: string;
  page: number;
}) {
  const base = `/api/v1/repositories/${encodeURIComponent(username)}/${encodeURIComponent(repository)}`;
  const pageBase = `/${encodeURIComponent(username)}/${encodeURIComponent(repository)}/commits`;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void api<{ branches: Branch[] }>(`${base}/branches`)
      .then((data) => active && setBranches(data.branches))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [base]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const query = new URLSearchParams({ page: String(page) });
    if (branch) query.set("ref", branch);
    void api<HistoryPage>(`${base}/commits?${query}`)
      .then((data) => {
        if (!active) return;
        setHistory(data);
        setError("");
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Couldn't load history.");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [base, branch, page]);

  const current = history?.ref ?? branch ?? "";
  const link = (nextPage: number) => {
    const query = new URLSearchParams();
    if (current) query.set("branch", current);
    if (nextPage > 1) query.set("page", String(nextPage));
    const text = query.toString();
    return text ? `${pageBase}?${text}` : pageBase;
  };
  const first = history ? (history.page - 1) * history.perPage + 1 : 0;

  return (
    <HubFrame>
      <main className="collab-page">
        <div className="collab-header">
          <div>
            <p className="eyebrow">
              <Link href={`/${username}/${repository}`}>
                {username}/{repository}
              </Link>{" "}
              / HISTORY
            </p>
            <h1>Commit history.</h1>
            <p className="muted">Every change on a branch, newest first.</p>
          </div>
          {branches.length > 0 && (
            <form className="branch-select history-branch" method="get" action={pageBase}>
              <span>⑂</span>
              <select
                name="branch"
                aria-label="Select branch"
                value={current}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
              >
                {branches.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                    {item.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </form>
          )}
        </div>
        <RepositoryNav username={username} repository={repository} active="commits" />
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <section className="collab-card">
          {loading && !history ? (
            <div className="collab-empty">Loading history…</div>
          ) : history && history.commits.length === 0 ? (
            <div className="collab-empty">
              No commits yet. Push to this repository and its history will appear here.
            </div>
          ) : history ? (
            <>
              <h2>
                {history.total} commit{history.total === 1 ? "" : "s"} on <code>{history.ref}</code>
                <span className="collab-chip">
                  {first}–{first + history.commits.length - 1}
                </span>
              </h2>
              <div className="collab-list" aria-busy={loading}>
                {history.commits.map((commit) => (
                  <article className="collab-row" key={commit.sha}>
                    <div>
                      <h3>{commit.message || "(no commit message)"}</h3>
                      <div className="collab-row-meta">
                        <span>{commit.author}</span>
                        <span>committed {new Date(commit.date).toLocaleString()}</span>
                      </div>
                    </div>
                    <code className="sha-chip" title={commit.sha}>
                      {commit.shortSha}
                    </code>
                  </article>
                ))}
              </div>
              <nav className="pager" aria-label="Commit pages">
                {history.page > 1 ? (
                  <Link className="button-outline" href={link(history.page - 1)}>
                    ← Newer
                  </Link>
                ) : (
                  <span />
                )}
                <span className="muted">Page {history.page}</span>
                {history.hasMore ? (
                  <Link className="button-outline" href={link(history.page + 1)}>
                    Older →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            </>
          ) : null}
        </section>
      </main>
    </HubFrame>
  );
}
