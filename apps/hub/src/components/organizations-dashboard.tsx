"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { HubFrame } from "./hub-frame";

type Member = {
  id: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  createdAt: string;
  user: { id: string; name: string; username: string | null };
};
type Organization = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  members: Member[];
  repositories: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    visibility: "PUBLIC" | "PRIVATE";
    updatedAt: string;
  }[];
  role?: string;
  _count?: { members: number };
};
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const payload = (await response.json()) as { data?: T; error?: { message?: string } };
  if (!response.ok || !payload.data)
    throw new Error(payload.error?.message ?? "Organization request failed.");
  return payload.data;
}

export function OrganizationsDashboard() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [memberName, setMemberName] = useState<Record<string, string>>({});
  const [repositoryName, setRepositoryName] = useState<Record<string, string>>({});
  const [repositoryVisibility, setRepositoryVisibility] = useState<Record<string, string>>({});
  const [newRole, setNewRole] = useState<Record<string, string>>({});
  const [roleDraft, setRoleDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ organizations: Organization[] }>("/api/v1/organizations");
      const details = await Promise.all(
        data.organizations.map((org) =>
          api<{ organization: Organization; role: string }>(
            `/api/v1/organizations/${encodeURIComponent(org.slug)}`,
          ),
        ),
      );
      setOrganizations(details.map((detail) => ({ ...detail.organization, role: detail.role })));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load organizations.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api("/api/v1/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, slug: slug || undefined, description }),
      });
      setName("");
      setSlug("");
      setDescription("");
      setNotice("Organization created. You are its owner.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't create organization.");
    } finally {
      setSaving(false);
    }
  }

  async function addMember(org: Organization, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/organizations/${encodeURIComponent(org.slug)}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: memberName[org.id], role: newRole[org.id] ?? "MEMBER" }),
      });
      setMemberName((value) => ({ ...value, [org.id]: "" }));
      setNotice("Member added and notified.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't add member.");
    } finally {
      setSaving(false);
    }
  }

  async function createRepository(org: Organization, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/organizations/${encodeURIComponent(org.slug)}/repositories`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: repositoryName[org.id],
          visibility: repositoryVisibility[org.id] ?? "PRIVATE",
        }),
      });
      setRepositoryName((value) => ({ ...value, [org.id]: "" }));
      setNotice("Organization repository created.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't create organization repository.");
    } finally {
      setSaving(false);
    }
  }

  async function updateMember(org: Organization, member: Member, method: "PATCH" | "DELETE") {
    setSaving(true);
    setError("");
    try {
      await api(
        `/api/v1/organizations/${encodeURIComponent(org.slug)}/members/${encodeURIComponent(member.user.username ?? "")}`,
        {
          method,
          ...(method === "PATCH"
            ? {
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ role: roleDraft[member.id] ?? member.role }),
              }
            : {}),
        },
      );
      setNotice(method === "DELETE" ? "Member removed." : "Member role updated.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't update organization member.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <HubFrame>
      <main className="collab-page">
        <div className="collab-header">
          <div>
            <p className="eyebrow">NAGARHUB / TEAMS</p>
            <h1>Build as a team.</h1>
            <p className="muted">
              Create an organization, give members clear roles, and bring your Nagar collaboration
              into one shared space.
            </p>
          </div>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        <div className="collab-layout">
          <section className="collab-stack">
            <div className="section-heading">
              <div>
                <p className="eyebrow">YOUR TEAMS</p>
                <h2>
                  Organizations <span>{organizations.length}</span>
                </h2>
              </div>
            </div>
            {loading ? (
              <div className="collab-empty">Loading organizations…</div>
            ) : organizations.length === 0 ? (
              <div className="collab-empty">
                No organizations yet. Create one to invite your team.
              </div>
            ) : (
              <div className="org-grid">
                {organizations.map((org) => (
                  <article className="org-card" key={org.id}>
                    <div className="org-card-heading">
                      <span className="org-avatar">{org.name.slice(0, 1).toUpperCase()}</span>
                      <div>
                        <h2>
                          <Link href={`/organizations/${org.slug}`}>{org.name}</Link>
                        </h2>
                        <code>@{org.slug}</code>
                      </div>
                      <span className="collab-chip">{org.role}</span>
                    </div>
                    {org.description && <p>{org.description}</p>}
                    <div className="org-repositories">
                      <h3>Repositories · {org.repositories.length}</h3>
                      {org.repositories.map((repo) => (
                        <Link
                          key={repo.id}
                          href={`/${org.slug}/${repo.slug}`}
                          className="org-repo-link"
                        >
                          {org.slug}/{repo.slug}
                          <span>{repo.visibility}</span>
                        </Link>
                      ))}
                      <form
                        className="collab-form"
                        onSubmit={(event) => void createRepository(org, event)}
                      >
                        <label>
                          New organization repository
                          <input
                            value={repositoryName[org.id] ?? ""}
                            onChange={(event) =>
                              setRepositoryName((value) => ({
                                ...value,
                                [org.id]: event.target.value,
                              }))
                            }
                            required
                            placeholder="platform-api"
                          />
                        </label>
                        <label>
                          Visibility
                          <select
                            value={repositoryVisibility[org.id] ?? "PRIVATE"}
                            onChange={(event) =>
                              setRepositoryVisibility((value) => ({
                                ...value,
                                [org.id]: event.target.value,
                              }))
                            }
                          >
                            <option value="PRIVATE">Private</option>
                            <option value="PUBLIC">Public</option>
                          </select>
                        </label>
                        <button className="collab-action" disabled={saving}>
                          Create repository +
                        </button>
                      </form>
                    </div>
                    <h3>Members · {org.members.length}</h3>
                    <div className="org-members">
                      {org.members.map((member) => (
                        <div className="org-member" key={member.id}>
                          <span>
                            <strong>{member.user.name}</strong>
                            <small>@{member.user.username ?? "no-username"}</small>
                          </span>
                          {member.role === "OWNER" ? (
                            <span className="access-badge">OWNER</span>
                          ) : (
                            <div className="org-member-controls">
                              <select
                                aria-label={`Role for ${member.user.name}`}
                                value={roleDraft[member.id] ?? member.role}
                                onChange={(event) =>
                                  setRoleDraft((value) => ({
                                    ...value,
                                    [member.id]: event.target.value,
                                  }))
                                }
                              >
                                <option value="MEMBER">Member</option>
                                <option value="ADMIN">Admin</option>
                              </select>
                              {org.role === "OWNER" && (
                                <button
                                  className="org-small-button"
                                  disabled={
                                    saving || (roleDraft[member.id] ?? member.role) === member.role
                                  }
                                  onClick={() => void updateMember(org, member, "PATCH")}
                                >
                                  Save
                                </button>
                              )}
                              {(org.role === "OWNER" ||
                                (org.role === "ADMIN" && member.role === "MEMBER")) && (
                                <button
                                  className="org-small-button remove"
                                  disabled={saving}
                                  onClick={() => void updateMember(org, member, "DELETE")}
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {(org.role === "OWNER" || org.role === "ADMIN") && (
                      <form
                        className="collab-form org-invite"
                        onSubmit={(event) => void addMember(org, event)}
                      >
                        <label>
                          Add a Nagar username
                          <input
                            value={memberName[org.id] ?? ""}
                            onChange={(event) =>
                              setMemberName((value) => ({ ...value, [org.id]: event.target.value }))
                            }
                            required
                            placeholder="e.g. sam-dev"
                          />
                        </label>
                        <label>
                          Team role
                          <select
                            value={newRole[org.id] ?? "MEMBER"}
                            onChange={(event) =>
                              setNewRole((value) => ({ ...value, [org.id]: event.target.value }))
                            }
                          >
                            <option value="MEMBER">Member</option>
                            <option value="ADMIN">Admin</option>
                          </select>
                        </label>
                        <button className="collab-action" disabled={saving}>
                          Add member +
                        </button>
                      </form>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
          <aside className="collab-card">
            <h2>Create an organization</h2>
            <form className="collab-form" onSubmit={(event) => void create(event)}>
              <label>
                Organization name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  required
                  placeholder="Nagar Studio"
                />
              </label>
              <label>
                Slug
                <input
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  maxLength={39}
                  placeholder="nagar-studio (optional)"
                />
              </label>
              <label>
                Description
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={280}
                  placeholder="What does your team build?"
                />
              </label>
              <button className="collab-action" disabled={saving}>
                {saving ? "Creating…" : "Create organization →"}
              </button>
            </form>
            <p className="muted">
              Roles: Owners control the team. Admins manage members. Members collaborate and receive
              activity notifications.
            </p>
          </aside>
        </div>
      </main>
    </HubFrame>
  );
}
