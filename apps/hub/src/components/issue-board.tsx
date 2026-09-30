"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { HubFrame } from "./hub-frame";

type Label = { id: string; name: string; color: string; description: string | null };
type Issue = {
  id: string;
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string; username: string | null };
  labels: { label: Label }[];
};
type Envelope<T> = { data?: T; error?: { message?: string } };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const envelope = (await response.json()) as Envelope<T>;
  if (!response.ok || !envelope.data) throw new Error(envelope.error?.message ?? "Request failed.");
  return envelope.data;
}

export function IssueBoard({ username, repository }: { username: string; repository: string }) {
  const base = `/api/v1/repositories/${encodeURIComponent(username)}/${encodeURIComponent(repository)}`;
  const [issues, setIssues] = useState<Issue[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState("EDFF00");
  const [showClosed, setShowClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [issueData, labelData] = await Promise.all([
        api<{ issues: Issue[] }>(`${base}/issues?state=${showClosed ? "CLOSED" : "OPEN"}`),
        api<{ labels: Label[] }>(`${base}/labels`),
      ]);
      setIssues(issueData.issues);
      setLabels(labelData.labels);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load repository issues.");
    } finally {
      setLoading(false);
    }
  }, [base, showClosed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`${base}/issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body, labelIds }),
      });
      setTitle("");
      setBody("");
      setLabelIds([]);
      setNotice("Issue opened.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't open the issue.");
    } finally {
      setSaving(false);
    }
  }

  async function createLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`${base}/labels`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: labelName, color: labelColor }),
      });
      setLabelName("");
      setNotice("Label created.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't create label.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleIssue(issue: Issue) {
    setError("");
    try {
      await api(`${base}/issues/${issue.number}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: issue.state === "OPEN" ? "CLOSED" : "OPEN" }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't update issue.");
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
              / TRACK WORK
            </p>
            <h1>Issues, in the open.</h1>
            <p className="muted">Collect bugs, ideas, and next steps where the code lives.</p>
          </div>
          <div className="collab-actions">
            <button
              className="collab-action"
              onClick={() => {
                setShowClosed(!showClosed);
                setNotice("");
              }}
            >
              {showClosed ? "Show open" : "Show closed"}
            </button>
            <Link className="button-outline" href={`/${username}/${repository}/pulls`}>
              Pull requests →
            </Link>
          </div>
        </div>
        <nav className="collab-tabs" aria-label="Repository collaboration">
          <Link className="active" href={`/${username}/${repository}/issues`}>
            Issues <span>{issues.length}</span>
          </Link>
          <Link href={`/${username}/${repository}/pulls`}>Pull requests</Link>
          <Link href={`/${username}/${repository}/settings`}>Access & webhooks</Link>
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
        <div className="collab-layout">
          <section className="collab-card">
            <h2>
              {showClosed ? "Closed issues" : "Open issues"}{" "}
              <span className="collab-chip">{issues.length}</span>
            </h2>
            {loading ? (
              <div className="collab-empty">Loading issues…</div>
            ) : issues.length === 0 ? (
              <div className="collab-empty">
                Nothing to track here yet. Open the first issue or switch to closed issues.
              </div>
            ) : (
              <div className="collab-list">
                {issues.map((issue) => (
                  <article className="collab-row" key={issue.id}>
                    <div>
                      <h3>
                        #{issue.number} · {issue.title}
                      </h3>
                      {issue.body && <p>{issue.body}</p>}
                      <div className="collab-row-meta">
                        <span>
                          {issue.author.username ? `@${issue.author.username}` : issue.author.name}
                        </span>
                        <span>opened {new Date(issue.createdAt).toLocaleDateString()}</span>
                        {issue.labels.map(({ label }) => (
                          <span
                            key={label.id}
                            className="collab-chip"
                            style={{ backgroundColor: `#${label.color}` }}
                          >
                            {label.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      className="button-secondary collab-action"
                      onClick={() => void toggleIssue(issue)}
                    >
                      {issue.state === "OPEN" ? "Close" : "Reopen"}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
          <aside className="collab-stack">
            <section className="collab-card">
              <h2>Open an issue</h2>
              <form className="collab-form" onSubmit={(event) => void createIssue(event)}>
                <label>
                  Title
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={180}
                    required
                    placeholder="What needs attention?"
                  />
                </label>
                <label>
                  Description
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    maxLength={20_000}
                    placeholder="Add details, context, or steps to reproduce…"
                  />
                </label>
                {labels.length > 0 && (
                  <fieldset className="label-choice-list">
                    <legend>Labels</legend>
                    {labels.map((label) => (
                      <label key={label.id}>
                        <input
                          type="checkbox"
                          checked={labelIds.includes(label.id)}
                          onChange={() =>
                            setLabelIds((current) =>
                              current.includes(label.id)
                                ? current.filter((id) => id !== label.id)
                                : [...current, label.id],
                            )
                          }
                        />
                        <span
                          className="collab-chip"
                          style={{ backgroundColor: `#${label.color}` }}
                        >
                          {label.name}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
                <button className="collab-action" disabled={saving}>
                  {saving ? "Saving…" : "Open issue →"}
                </button>
              </form>
            </section>
            <section className="collab-card">
              <h2>Labels</h2>
              <div className="collab-row-meta">
                {labels.map((label) => (
                  <span
                    key={label.id}
                    className="collab-chip"
                    style={{ backgroundColor: `#${label.color}` }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
              <form
                className="collab-form label-create-form"
                onSubmit={(event) => void createLabel(event)}
              >
                <label>
                  New label
                  <input
                    value={labelName}
                    onChange={(event) => setLabelName(event.target.value)}
                    maxLength={40}
                    required
                    placeholder="bug, docs, idea…"
                  />
                </label>
                <label>
                  Label color
                  <input
                    aria-label="Label color"
                    type="color"
                    value={`#${labelColor}`}
                    onChange={(event) => setLabelColor(event.target.value.slice(1).toUpperCase())}
                  />
                </label>
                <button className="collab-action" disabled={saving}>
                  Create label
                </button>
              </form>
            </section>
          </aside>
        </div>
      </main>
    </HubFrame>
  );
}
