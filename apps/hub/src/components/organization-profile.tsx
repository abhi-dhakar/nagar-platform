"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { HubFrame } from "./hub-frame";

type Repo = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  updatedAt: string;
};
type Detail = {
  organization: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    members: {
      id: string;
      role: string;
      user: { id: string; name: string; username: string | null };
    }[];
    repositories: Repo[];
  };
  role: string;
};
export function OrganizationProfile({ slug }: { slug: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/organizations/${encodeURIComponent(slug)}`, {
        credentials: "include",
      });
      const payload = (await response.json()) as { data?: Detail; error?: { message?: string } };
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? "Couldn't load organization.");
      setDetail(payload.data);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load organization.");
    } finally {
      setLoading(false);
    }
  }, [slug]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <HubFrame>
      <main className="collab-page">
        <div className="collab-header">
          <div>
            <p className="eyebrow">
              <Link href="/organizations">ORGANIZATIONS</Link> / TEAM
            </p>
            <h1>{detail?.organization.name ?? `@${slug}`}</h1>
            <p className="muted">
              {detail?.organization.description ?? "An organization workspace on NagarHub."}
            </p>
          </div>
          {detail && <span className="collab-chip">YOUR ROLE · {detail.role}</span>}
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error} · <Link href="/login">Sign in</Link>
          </div>
        )}
        {loading ? (
          <div className="collab-empty">Loading organization…</div>
        ) : (
          detail && (
            <div className="collab-layout">
              <section className="collab-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">SHARED CODE</p>
                    <h2>
                      Repositories <span>{detail.organization.repositories.length}</span>
                    </h2>
                  </div>
                </div>
                {detail.organization.repositories.length === 0 ? (
                  <div className="collab-empty">This organization has no repositories yet.</div>
                ) : (
                  detail.organization.repositories.map((repo) => (
                    <article className="collab-row" key={repo.id}>
                      <div>
                        <h3>
                          <Link href={`/${detail.organization.slug}/${repo.slug}`}>
                            {detail.organization.slug}/{repo.slug}
                          </Link>
                        </h3>
                        <p>{repo.description ?? "No description yet."}</p>
                        <div className="collab-row-meta">
                          <span
                            className={`collab-chip ${repo.visibility === "PRIVATE" ? "blue" : ""}`}
                          >
                            {repo.visibility}
                          </span>
                          <span>updated {new Date(repo.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <Link
                        className="button-outline"
                        href={`/${detail.organization.slug}/${repo.slug}`}
                      >
                        Open →
                      </Link>
                    </article>
                  ))
                )}
              </section>
              <aside className="collab-card">
                <h2>People · {detail.organization.members.length}</h2>
                {detail.organization.members.map((member) => (
                  <div className="org-member" key={member.id}>
                    <span>
                      <strong>{member.user.name}</strong>
                      <small>@{member.user.username ?? "nagar-member"}</small>
                    </span>
                    <span className="access-badge">{member.role}</span>
                  </div>
                ))}
              </aside>
            </div>
          )
        )}
      </main>
    </HubFrame>
  );
}
