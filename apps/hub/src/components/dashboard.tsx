"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { partitionRepositories } from "../lib/repositories";
import { HubFrame } from "./hub-frame";

type User = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  bio: string | null;
};
type Repository = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  updatedAt: string;
  owner: string | null;
  cloneUrl: string | null;
  namespaceType: "USER" | "ORGANIZATION";
  role: "READ" | "WRITE" | "ADMIN" | null;
};

export function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const meResponse = await fetch("/api/v1/me", { credentials: "include" });
        if (meResponse.status === 401) {
          router.replace("/login");
          return;
        }
        if (!meResponse.ok) throw new Error("Couldn't load your account.");
        const me = (await meResponse.json()) as { data: { user: User } };
        const reposResponse = await fetch("/api/v1/repositories", { credentials: "include" });
        if (!reposResponse.ok) throw new Error("Couldn't load your repositories.");
        const repos = (await reposResponse.json()) as { data: { repositories: Repository[] } };
        if (active) {
          setUser(me.data.user);
          setRepositories(repos.data.repositories);
        }
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "NagarHub couldn't reach the API.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  const { mine, shared } = partitionRepositories(repositories, user?.username);

  function renderRepositories(items: Repository[]) {
    return (
      <div className="repo-list">
        {items.map((repo) => (
          <article key={repo.id} className="repo-row">
            <div className="repo-avatar">{repo.name.slice(0, 1).toUpperCase()}</div>
            <div className="repo-row-main">
              <Link href={`/${repo.owner}/${repo.slug}`} className="repo-title">
                {repo.owner}/{repo.slug}
              </Link>
              <p>{repo.description || "No description yet."}</p>
              <span>Updated {new Date(repo.updatedAt).toLocaleDateString()}</span>
            </div>
            {repo.namespaceType === "ORGANIZATION" && <span className="access-badge">ORG</span>}
            {repo.role && repo.role !== "ADMIN" && (
              <span className="access-badge" title="Your access to this repository">
                {repo.role}
              </span>
            )}
            <span className={`visibility ${repo.visibility.toLowerCase()}`}>
              {repo.visibility === "PRIVATE" ? "◉ Private" : "◎ Public"}
            </span>
          </article>
        ))}
      </div>
    );
  }

  return (
    <HubFrame>
      <section className="dashboard-main">
        <div className="dashboard-heading">
          <div>
            <p className="eyebrow">
              <span>YOUR WORKSPACE</span> / DASHBOARD
            </p>
            <h1>
              {user ? `Good to see you, ${user.name.split(" ")[0]}.` : "Your work, at a glance."}
            </h1>
            <p className="muted">
              Repositories you own, and the ones you collaborate on through teammates or
              organizations.
            </p>
          </div>
          <div className="dashboard-actions">
            <Link href="/settings/profile" className="button-outline">
              Profile settings
            </Link>
            <Link href="/new" className="button-primary">
              New repository <span>＋</span>
            </Link>
            <button
              className="signout-button"
              onClick={async () => {
                await fetch("/api/auth/sign-out", {
                  method: "POST",
                  credentials: "include",
                  headers: { "content-type": "application/json" },
                  body: "{}",
                });
                router.replace("/");
                router.refresh();
              }}
            >
              Sign out
            </button>
          </div>
        </div>
        {user && !user.username && (
          <div className="notice">
            <span>Complete your public profile to create a repository.</span>
            <Link href="/settings/profile">Choose a username →</Link>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR REPOSITORIES</p>
            <h2>
              Projects <span>{mine.length}</span>
            </h2>
          </div>
          <Link href={user?.username ? `/${user.username}` : "/settings/profile"}>
            View profile ↗
          </Link>
        </div>
        {loading ? (
          <div className="empty-state">Loading your Nagar workspace…</div>
        ) : repositories.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">⌘</span>
            <h3>Your first repository starts here.</h3>
            <p>
              Create a repository, clone it locally, then push a commit to see your code and history
              appear.
            </p>
            <Link href="/new" className="button-primary">
              Create repository <span>↗</span>
            </Link>
          </div>
        ) : (
          <>
            {mine.length > 0 ? (
              renderRepositories(mine)
            ) : (
              <div className="empty-state compact-empty">
                You don&apos;t own a repository yet.{" "}
                <Link href="/new">Create your first one →</Link>
              </div>
            )}
            {shared.length > 0 && (
              <>
                <div className="section-heading shared-heading">
                  <div>
                    <p className="eyebrow">SHARED WITH YOU</p>
                    <h2>
                      Collaborations <span>{shared.length}</span>
                    </h2>
                  </div>
                  <Link href="/organizations">Organizations ↗</Link>
                </div>
                {renderRepositories(shared)}
              </>
            )}
          </>
        )}
        <div className="dashboard-footnote">
          <span>ONE IDENTITY</span>
          <i>·</i>
          <span>GIT AT THE CENTER</span>
          <i>·</i>
          <span>BUILT TO GROW</span>
        </div>
      </section>
    </HubFrame>
  );
}
