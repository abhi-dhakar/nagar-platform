"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HubFrame } from "./hub-frame";

type PublicRepository = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  updatedAt: string;
};
type Profile = {
  id: string;
  name: string;
  username: string;
  bio: string | null;
  createdAt: string;
  repositories: PublicRepository[];
};

export function PublicProfile({ username }: { username: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/users/${encodeURIComponent(username)}`)
      .then(async (response) => {
        const body = (await response.json()) as {
          data?: { user: Profile };
          error?: { message?: string };
        };
        if (!response.ok || !body.data?.user)
          throw new Error(body.error?.message ?? "This profile isn't available.");
        if (active) setProfile(body.data.user);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Profile couldn't be loaded.");
      });
    return () => {
      active = false;
    };
  }, [username]);

  return (
    <HubFrame>
      <section className="profile-page">
        {error ? (
          <div className="error-banner">{error}</div>
        ) : !profile ? (
          <div className="empty-state">Loading profile…</div>
        ) : (
          <>
            <div className="public-profile-head">
              <div className="large-avatar">{profile.name.slice(0, 1).toUpperCase()}</div>
              <div>
                <p className="eyebrow">
                  <span>PUBLIC PROFILE</span> / NAGARHUB
                </p>
                <h1>{profile.name}</h1>
                <p className="profile-username">@{profile.username}</p>
                {profile.bio && <p className="profile-bio">{profile.bio}</p>}
                <span className="profile-date">
                  Joined{" "}
                  {new Date(profile.createdAt).toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              </div>
              <Link href="/signup" className="button-outline profile-join">
                Join Nagar ↗
              </Link>
            </div>
            <div className="section-heading">
              <div>
                <p className="eyebrow">OPEN SOURCE WORK</p>
                <h2>
                  Public repositories <span>{profile.repositories.length}</span>
                </h2>
              </div>
            </div>
            {profile.repositories.length ? (
              <div className="repo-list">
                {profile.repositories.map((repo) => (
                  <article key={repo.id} className="repo-row">
                    <div className="repo-avatar">⌘</div>
                    <div className="repo-row-main">
                      <Link href={`/${profile.username}/${repo.slug}`} className="repo-title">
                        {profile.username}/{repo.slug}
                      </Link>
                      <p>{repo.description || "No description yet."}</p>
                      <span>Updated {new Date(repo.updatedAt).toLocaleDateString()}</span>
                    </div>
                    <span className="visibility public">◎ Public</span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state compact-empty">No public repositories yet.</div>
            )}
          </>
        )}
      </section>
    </HubFrame>
  );
}
