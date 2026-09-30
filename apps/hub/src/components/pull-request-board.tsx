"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { HubFrame } from "./hub-frame";

type Review = {
  id: string;
  state: "APPROVED" | "COMMENTED" | "CHANGES_REQUESTED";
  body: string;
  createdAt: string;
  reviewer: { id: string; name: string; username: string | null };
};
type PullRequest = {
  id: string;
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  baseBranch: string;
  headBranch: string;
  mergeCommitSha: string | null;
  createdAt: string;
  author: { id: string; name: string; username: string | null };
  reviews: Review[];
};
type Envelope<T> = { data?: T; error?: { message?: string } };
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const envelope = (await response.json()) as Envelope<T>;
  if (!response.ok || !envelope.data) throw new Error(envelope.error?.message ?? "Request failed.");
  return envelope.data;
}

export function PullRequestBoard({
  username,
  repository,
}: {
  username: string;
  repository: string;
}) {
  const base = `/api/v1/repositories/${encodeURIComponent(username)}/${encodeURIComponent(repository)}`;
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [baseBranch, setBaseBranch] = useState("");
  const [headBranch, setHeadBranch] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reviewState, setReviewState] = useState<Review["state"]>("APPROVED");
  const [reviewBody, setReviewBody] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ pullRequests: PullRequest[]; branches: string[] }>(`${base}/pulls`);
      setPullRequests(data.pullRequests);
      setBranches(data.branches);
      const defaultBase = data.branches.includes("main") ? "main" : (data.branches[0] ?? "");
      setBaseBranch((current) => current || defaultBase);
      setHeadBranch(
        (current) => current || data.branches.find((branch) => branch !== defaultBase) || "",
      );
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load pull requests.");
    } finally {
      setLoading(false);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  async function createPullRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`${base}/pulls`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body, baseBranch, headBranch }),
      });
      setTitle("");
      setBody("");
      setNotice("Pull request opened.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't open pull request.");
    } finally {
      setSaving(false);
    }
  }

  async function submitReview(pull: PullRequest) {
    setSaving(true);
    setError("");
    try {
      await api(`${base}/pulls/${pull.number}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: reviewState, body: reviewBody }),
      });
      setReviewBody("");
      setNotice(`Review submitted for #${pull.number}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't submit review.");
    } finally {
      setSaving(false);
    }
  }

  async function updateState(pull: PullRequest, state: "CLOSED" | "MERGED") {
    setSaving(true);
    setError("");
    try {
      const result = await api<{ pullRequest: PullRequest }>(`${base}/pulls/${pull.number}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      });
      setNotice(
        state === "MERGED"
          ? `Merged as ${result.pullRequest.mergeCommitSha?.slice(0, 7) ?? "a merge commit"}.`
          : `Pull request #${pull.number} closed.`,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't update pull request.");
    } finally {
      setSaving(false);
    }
  }

  const visible = pullRequests.filter((pull) =>
    showClosed ? pull.state !== "OPEN" : pull.state === "OPEN",
  );
  const labelForReview = (state: Review["state"]) =>
    state === "APPROVED"
      ? "Approved"
      : state === "CHANGES_REQUESTED"
        ? "Changes requested"
        : "Commented";

  return (
    <HubFrame>
      <main className="collab-page">
        <div className="collab-header">
          <div>
            <p className="eyebrow">
              <Link href={`/${username}/${repository}`}>
                {username}/{repository}
              </Link>{" "}
              / REVIEW CHANGES
            </p>
            <h1>Pull requests.</h1>
            <p className="muted">
              Propose a branch merge, review it with your collaborators, then merge the approved
              changes.
            </p>
          </div>
          <div className="collab-actions">
            <button className="collab-action" onClick={() => setShowClosed(!showClosed)}>
              {showClosed ? "Show open" : "Show closed"}
            </button>
            <Link className="button-outline" href={`/${username}/${repository}/issues`}>
              Issues →
            </Link>
          </div>
        </div>
        <nav className="collab-tabs" aria-label="Repository collaboration">
          <Link href={`/${username}/${repository}/issues`}>Issues</Link>
          <Link className="active" href={`/${username}/${repository}/pulls`}>
            Pull requests <span>{pullRequests.filter((item) => item.state === "OPEN").length}</span>
          </Link>
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
              {showClosed ? "Closed and merged" : "Open for review"}{" "}
              <span className="collab-chip">{visible.length}</span>
            </h2>
            {loading ? (
              <div className="collab-empty">Loading pull requests…</div>
            ) : visible.length === 0 ? (
              <div className="collab-empty">
                No {showClosed ? "closed" : "open"} pull requests. Open one from a branch pair to
                start collaborating.
              </div>
            ) : (
              <div className="collab-list">
                {visible.map((pull) => {
                  const latest = pull.reviews[0];
                  const approved = latest?.state === "APPROVED";
                  return (
                    <article className="collab-row pull-row" key={pull.id}>
                      <div className="pull-content">
                        <h3>
                          #{pull.number} · {pull.title}
                        </h3>
                        {pull.body && <p>{pull.body}</p>}
                        <div className="collab-row-meta">
                          <span
                            className={`collab-chip ${pull.state === "MERGED" ? "blue" : pull.state === "CLOSED" ? "coral" : ""}`}
                          >
                            {pull.state}
                          </span>
                          <span>
                            <code>{pull.headBranch}</code> → <code>{pull.baseBranch}</code>
                          </span>
                          <span>
                            by{" "}
                            {pull.author.username ? `@${pull.author.username}` : pull.author.name}
                          </span>
                          <span>
                            {pull.reviews.length} review{pull.reviews.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        {latest && (
                          <div className="latest-review">
                            <strong>{labelForReview(latest.state)}</strong> by{" "}
                            {latest.reviewer.username
                              ? `@${latest.reviewer.username}`
                              : latest.reviewer.name}
                            {latest.body ? ` — ${latest.body}` : ""}
                          </div>
                        )}
                        {pull.state === "OPEN" && (
                          <form
                            className="review-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void submitReview(pull);
                            }}
                          >
                            <select
                              aria-label="Review decision"
                              value={reviewState}
                              onChange={(event) =>
                                setReviewState(event.target.value as Review["state"])
                              }
                            >
                              <option value="APPROVED">Approve</option>
                              <option value="COMMENTED">Comment</option>
                              <option value="CHANGES_REQUESTED">Request changes</option>
                            </select>
                            <input
                              aria-label="Review note"
                              value={reviewBody}
                              onChange={(event) => setReviewBody(event.target.value)}
                              maxLength={10_000}
                              placeholder="Leave a note (optional)"
                            />
                            <button className="collab-action" disabled={saving}>
                              Submit review
                            </button>
                          </form>
                        )}
                      </div>
                      {pull.state === "OPEN" && (
                        <div className="collab-actions pull-actions">
                          <button
                            className="button-secondary collab-action"
                            disabled={saving}
                            onClick={() => void updateState(pull, "CLOSED")}
                          >
                            Close
                          </button>
                          <button
                            className="collab-action merge-action"
                            disabled={saving || !approved}
                            title={
                              !approved
                                ? "An approval from another collaborator is required."
                                : "Merge this pull request"
                            }
                            onClick={() => void updateState(pull, "MERGED")}
                          >
                            Merge approved PR
                          </button>
                        </div>
                      )}
                      {pull.mergeCommitSha && (
                        <code className="merge-sha">merge {pull.mergeCommitSha.slice(0, 7)}</code>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          <aside className="collab-card">
            <h2>Propose a merge</h2>
            {branches.length < 2 ? (
              <div className="collab-empty">Push at least two branches to open a pull request.</div>
            ) : (
              <form className="collab-form" onSubmit={(event) => void createPullRequest(event)}>
                <label>
                  Title
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={180}
                    required
                    placeholder="What does this change do?"
                  />
                </label>
                <label>
                  Base branch
                  <select
                    value={baseBranch}
                    onChange={(event) => setBaseBranch(event.target.value)}
                  >
                    {branches.map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Compare branch
                  <select
                    value={headBranch}
                    onChange={(event) => setHeadBranch(event.target.value)}
                  >
                    {branches.map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Context
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    maxLength={20_000}
                    placeholder="Describe what changed and why…"
                  />
                </label>
                <button
                  className="collab-action"
                  disabled={saving || !baseBranch || !headBranch || baseBranch === headBranch}
                >
                  {saving ? "Saving…" : "Open pull request →"}
                </button>
              </form>
            )}
            <p className="muted review-hint">
              Merge is enabled after the latest review is an approval by someone other than the
              author. Nagar creates a merge commit and updates the base branch.
            </p>
          </aside>
        </div>
      </main>
    </HubFrame>
  );
}
