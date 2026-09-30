"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HubFrame } from "./hub-frame";
import { RepositoryNav } from "./repository-nav";

type Branch = {
  name: string;
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  message: string;
  isDefault: boolean;
};

export function BranchList({ username, repository }: { username: string; repository: string }) {
  const apiBase = `/api/v1/repositories/${encodeURIComponent(username)}/${encodeURIComponent(repository)}`;
  const pageBase = `/${encodeURIComponent(username)}/${encodeURIComponent(repository)}`;
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/branches`, { credentials: "include" });
        const payload = (await response.json()) as {
          data?: { branches: Branch[] };
          error?: { message?: string };
        };
        if (!response.ok || !payload.data)
          throw new Error(payload.error?.message ?? "Couldn't load branches.");
        if (active) setBranches(payload.data.branches);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Couldn't load branches.");
      }
    })();
    return () => {
      active = false;
    };
  }, [apiBase]);

  return (
    <HubFrame>
      <main className="collab-page">
        <div className="collab-header">
          <div>
            <p className="eyebrow">
              <Link href={pageBase}>
                {username}/{repository}
              </Link>{" "}
              / BRANCHES
            </p>
            <h1>Branches.</h1>
            <p className="muted">Where work is happening, and how recently.</p>
          </div>
        </div>
        <RepositoryNav username={username} repository={repository} active="branches" />
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <section className="collab-card">
          {!branches && !error ? (
            <div className="collab-empty">Loading branches…</div>
          ) : branches && branches.length === 0 ? (
            <div className="collab-empty">
              No branches yet. Push a commit to create <code>main</code>.
            </div>
          ) : branches ? (
            <>
              <h2>
                All branches <span className="collab-chip">{branches.length}</span>
              </h2>
              <div className="collab-list">
                {branches.map((branch) => (
                  <article className="collab-row" key={branch.name}>
                    <div>
                      <h3>
                        <Link href={`${pageBase}?ref=${encodeURIComponent(branch.name)}`}>
                          {branch.name}
                        </Link>{" "}
                        {branch.isDefault && <span className="access-badge">DEFAULT</span>}
                      </h3>
                      <p>{branch.message || "(no commit message)"}</p>
                      <div className="collab-row-meta">
                        <span>{branch.author}</span>
                        <span>{new Date(branch.date).toLocaleString()}</span>
                        <code className="sha-chip" title={branch.sha}>
                          {branch.shortSha}
                        </code>
                      </div>
                    </div>
                    <div className="collab-actions">
                      <Link
                        className="button-outline"
                        href={`${pageBase}?ref=${encodeURIComponent(branch.name)}`}
                      >
                        Browse
                      </Link>
                      <Link
                        className="button-outline"
                        href={`${pageBase}/commits?branch=${encodeURIComponent(branch.name)}`}
                      >
                        History
                      </Link>
                      {!branch.isDefault && (
                        <Link
                          className="button-outline"
                          href={`${pageBase}/pulls?head=${encodeURIComponent(branch.name)}`}
                        >
                          Open pull request
                        </Link>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </section>
      </main>
    </HubFrame>
  );
}
