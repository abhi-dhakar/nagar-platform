"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { HubFrame } from "./hub-frame";

type Collaborator = {
  id: string;
  role: "READ" | "WRITE" | "ADMIN";
  user: { id: string; name: string; username: string | null };
};
type Webhook = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  deliveries: {
    id: string;
    event: string;
    status: "PENDING" | "SUCCEEDED" | "FAILED";
    statusCode: number | null;
    attemptCount: number;
    lastError: string | null;
    createdAt: string;
  }[];
};
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const payload = (await response.json()) as { data?: T; error?: { message?: string } };
  if (!response.ok || !payload.data)
    throw new Error(payload.error?.message ?? "Settings request failed.");
  return payload.data;
}

export function RepositorySettings({
  username,
  repository,
}: {
  username: string;
  repository: string;
}) {
  const base = `/api/v1/repositories/${encodeURIComponent(username)}/${encodeURIComponent(repository)}`;
  const [owner, setOwner] = useState<{ id: string; name: string; username: string | null } | null>(
    null,
  );
  const [members, setMembers] = useState<Collaborator[]>([]);
  const [organizationMembers, setOrganizationMembers] = useState<
    { id: string; role: string; user: { id: string; name: string; username: string | null } }[]
  >([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [supportedEvents, setSupportedEvents] = useState<string[]>([]);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState("WRITE");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [collabData, webhookData] = await Promise.all([
        api<{
          owner: { id: string; name: string; username: string | null };
          members: Collaborator[];
          organizationMembers: {
            id: string;
            role: string;
            user: { id: string; name: string; username: string | null };
          }[];
        }>(`${base}/collaborators`),
        api<{ webhooks: Webhook[]; availableEvents: string[] }>(`${base}/webhooks`),
      ]);
      setOwner(collabData.owner);
      setMembers(collabData.members);
      setOrganizationMembers(collabData.organizationMembers);
      setWebhooks(webhookData.webhooks);
      setSupportedEvents(webhookData.availableEvents);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load repository settings.");
    } finally {
      setLoading(false);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`${base}/collaborators`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: inviteUsername, role: inviteRole }),
      });
      setInviteUsername("");
      setNotice("Collaborator added and notified.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't add collaborator.");
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(member: Collaborator, role: string) {
    setSaving(true);
    setError("");
    try {
      await api(`${base}/collaborators/${encodeURIComponent(member.user.username ?? "")}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      setNotice(`Updated ${member.user.name}'s repository access.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't change collaborator role.");
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(member: Collaborator) {
    setSaving(true);
    setError("");
    try {
      await api(`${base}/collaborators/${encodeURIComponent(member.user.username ?? "")}`, {
        method: "DELETE",
      });
      setNotice("Collaborator access removed.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't remove collaborator.");
    } finally {
      setSaving(false);
    }
  }

  async function createWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSecret("");
    try {
      const data = await api<{ webhook: Webhook; secret: string }>(`${base}/webhooks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, events }),
      });
      setWebhookUrl("");
      setSecret(data.secret);
      setNotice("Webhook created. Copy its signing secret now; it will not be shown again.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't create webhook.");
    } finally {
      setSaving(false);
    }
  }

  async function removeWebhook(id: string) {
    setSaving(true);
    setError("");
    try {
      await api(`${base}/webhooks/${id}`, { method: "DELETE" });
      setNotice("Webhook removed.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't remove webhook.");
    } finally {
      setSaving(false);
    }
  }

  async function retryDelivery(webhookId: string, deliveryId: string) {
    setSaving(true);
    setError("");
    try {
      await api(`${base}/webhooks/${webhookId}/deliveries/${deliveryId}/retry`, { method: "POST" });
      setNotice("Delivery retry completed.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't retry webhook delivery.");
    } finally {
      setSaving(false);
    }
  }

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setNotice("Signing secret copied.");
    } catch {
      setError("Clipboard is unavailable. Select and copy the secret manually.");
    }
  }

  return (
    <HubFrame>
      <main className="collab-page">
        <div className="collab-header">
          <div>
            <p className="eyebrow">
              <Link href={`/${username}/${repository}`}>
                {username}/{repository}
              </Link>{" "}
              / SETTINGS
            </p>
            <h1>Access & events.</h1>
            <p className="muted">Manage repository roles and signed webhook deliveries.</p>
          </div>
        </div>
        <nav className="collab-tabs" aria-label="Repository collaboration">
          <Link href={`/${username}/${repository}/issues`}>Issues</Link>
          <Link href={`/${username}/${repository}/pulls`}>Pull requests</Link>
          <Link className="active" href={`/${username}/${repository}/settings`}>
            Access & webhooks
          </Link>
        </nav>
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
        {loading && <div className="collab-empty">Loading repository settings…</div>}
        {!loading && (
          <div className="collab-layout">
            <section className="collab-stack">
              <div className="collab-card">
                <h2>Collaborators</h2>
                <p className="muted">
                  READ can clone and browse, WRITE can push and collaborate, ADMIN can manage access
                  and webhooks.
                </p>
                <div className="collab-list">
                  <div className="collab-row">
                    <div>
                      <h3>
                        {owner?.name} <span className="access-badge">OWNER</span>
                      </h3>
                      <span>@{owner?.username}</span>
                    </div>
                    <span className="collab-chip">ADMIN</span>
                  </div>
                  {members.map((member) => (
                    <div className="collab-row" key={member.id}>
                      <div>
                        <h3>{member.user.name}</h3>
                        <span>@{member.user.username}</span>
                      </div>
                      <div className="collab-actions">
                        <select
                          aria-label={`Role for ${member.user.name}`}
                          value={member.role}
                          disabled={saving}
                          onChange={(event) => void changeRole(member, event.target.value)}
                        >
                          <option value="READ">Read</option>
                          <option value="WRITE">Write</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                        <button
                          className="button-secondary collab-action"
                          disabled={saving}
                          onClick={() => void removeMember(member)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  {members.length === 0 && (
                    <div className="collab-empty">No direct collaborators have been added.</div>
                  )}
                  {organizationMembers.length > 0 && (
                    <div className="org-inherited">
                      <p className="eyebrow">INHERITED FROM ORGANIZATION</p>
                      {organizationMembers.map((member) => (
                        <div className="collab-row" key={member.id}>
                          <div>
                            <h3>{member.user.name}</h3>
                            <span>@{member.user.username}</span>
                          </div>
                          <span className="access-badge">
                            {member.role === "MEMBER" ? "WRITE" : "ADMIN"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <form
                  className="collab-form collaborator-form"
                  onSubmit={(event) => void invite(event)}
                >
                  <label>
                    Nagar username
                    <input
                      value={inviteUsername}
                      onChange={(event) => setInviteUsername(event.target.value)}
                      required
                      placeholder="e.g. sam-dev"
                    />
                  </label>
                  <label>
                    Repository role
                    <select
                      value={inviteRole}
                      onChange={(event) => setInviteRole(event.target.value)}
                    >
                      <option value="READ">Read</option>
                      <option value="WRITE">Write</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </label>
                  <button className="collab-action" disabled={saving}>
                    Add collaborator +
                  </button>
                </form>
              </div>
              <div className="collab-card">
                <h2>Delivery history</h2>
                {webhooks.flatMap((hook) =>
                  hook.deliveries.map((delivery) => ({
                    ...delivery,
                    webhookId: hook.id,
                    webhookUrl: hook.url,
                  })),
                ).length === 0 ? (
                  <div className="collab-empty">
                    Webhook deliveries appear here after repository events.
                  </div>
                ) : (
                  webhooks
                    .flatMap((hook) =>
                      hook.deliveries.map((delivery) => ({
                        ...delivery,
                        webhookId: hook.id,
                        webhookUrl: hook.url,
                      })),
                    )
                    .map((delivery) => (
                      <div className="collab-row" key={delivery.id}>
                        <div>
                          <h3>
                            {delivery.event} ·{" "}
                            <span className="collab-chip">{delivery.status}</span>
                          </h3>
                          <p>{delivery.webhookUrl}</p>
                          <small>
                            {delivery.statusCode
                              ? `HTTP ${delivery.statusCode}`
                              : (delivery.lastError ?? "Waiting")}{" "}
                            · {new Date(delivery.createdAt).toLocaleString()}
                          </small>
                        </div>
                        {delivery.status === "FAILED" && (
                          <button
                            className="collab-action"
                            disabled={saving}
                            onClick={() => void retryDelivery(delivery.webhookId, delivery.id)}
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    ))
                )}
              </div>
            </section>
            <aside className="collab-stack">
              <section className="collab-card">
                <h2>Add a webhook</h2>
                <p className="muted">
                  Only public HTTPS endpoints are accepted. Requests include an HMAC-SHA256
                  signature.
                </p>
                <form className="collab-form" onSubmit={(event) => void createWebhook(event)}>
                  <label>
                    Endpoint URL
                    <input
                      type="url"
                      value={webhookUrl}
                      onChange={(event) => setWebhookUrl(event.target.value)}
                      required
                      placeholder="https://example.com/hooks/nagar"
                    />
                  </label>
                  <fieldset className="webhook-events">
                    <legend>Events</legend>
                    {supportedEvents.map((eventName) => (
                      <label key={eventName}>
                        <input
                          type="checkbox"
                          checked={events.includes(eventName)}
                          onChange={() =>
                            setEvents((current) =>
                              current.includes(eventName)
                                ? current.filter((item) => item !== eventName)
                                : [...current, eventName],
                            )
                          }
                        />
                        {eventName}
                      </label>
                    ))}
                  </fieldset>
                  <button className="collab-action" disabled={saving || events.length === 0}>
                    Create webhook
                  </button>
                </form>
              </section>
              {secret && (
                <section className="collab-card">
                  <h2>Copy secret now</h2>
                  <p className="muted">
                    This value is shown once. Nagar stores only the encrypted secret.
                  </p>
                  <code className="webhook-secret">{secret}</code>
                  <button className="collab-action" onClick={() => void copySecret()}>
                    Copy signing secret
                  </button>
                </section>
              )}
              <section className="collab-card">
                <h2>Endpoints</h2>
                {webhooks.length === 0 ? (
                  <div className="collab-empty">No active webhook endpoints.</div>
                ) : (
                  webhooks.map((hook) => (
                    <article className="webhook-card" key={hook.id}>
                      <h3>{hook.url}</h3>
                      <p>{hook.events.join(" · ")}</p>
                      <small>
                        Created {new Date(hook.createdAt).toLocaleDateString()} ·{" "}
                        {hook.deliveries.length} recent deliveries
                      </small>
                      <button
                        className="button-secondary collab-action"
                        disabled={saving}
                        onClick={() => void removeWebhook(hook.id)}
                      >
                        Delete endpoint
                      </button>
                    </article>
                  ))
                )}
              </section>
            </aside>
          </div>
        )}
      </main>
    </HubFrame>
  );
}
