"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { HubFrame } from "./hub-frame";

type User = { name: string; username: string | null };

export function NewRepositoryForm() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [visibility, setVisibility] = useState<"PRIVATE" | "PUBLIC">("PRIVATE");
  const [initializeWithReadme, setInitializeWithReadme] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/me", { credentials: "include" })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const body = (await response.json()) as { data?: { user?: User } };
        if (active) setUser(body.data?.user ?? null);
      })
      .catch(() => setError("NagarHub couldn't reach the API."));
    return () => {
      active = false;
    };
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/repositories", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") ?? "").trim(),
          description: String(form.get("description") ?? "").trim(),
          visibility,
          initializeWithReadme,
        }),
      });
      const body = (await response.json()) as {
        data?: { repository?: { slug: string; owner: { username: string } } };
        error?: { message?: string };
      };
      if (!response.ok || !body.data?.repository) {
        setError(body.error?.message ?? "We couldn't create that repository.");
        return;
      }
      router.push(`/${body.data.repository.owner.username}/${body.data.repository.slug}`);
      router.refresh();
    } catch {
      setError("NagarHub couldn't reach the API. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <HubFrame>
      <section className="form-page">
        <p className="eyebrow">
          <span>NEW</span> / REPOSITORY
        </p>
        <h1>Create a repository</h1>
        <p className="muted">
          A repository holds your project files, commit history, and branches.
        </p>
        {user && !user.username && (
          <div className="notice">
            Set a username before you create your first repository.{" "}
            <a href="/settings/profile">Complete your profile →</a>
          </div>
        )}
        <form className="form-card wide-form" onSubmit={submit}>
          <div className="owner-field">
            <span>OWNER</span>
            <strong>{user?.username ?? user?.name ?? "Loading…"}</strong>
            <span className="slash">/</span>
            <label className="repo-name-label">
              Repository name
              <input
                name="name"
                required
                maxLength={100}
                pattern="[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?"
                placeholder="my-project"
                autoFocus
              />
            </label>
          </div>
          <label>
            Description <span className="optional-label">OPTIONAL</span>
            <textarea
              name="description"
              maxLength={350}
              rows={3}
              placeholder="What are you building?"
            />
          </label>
          <fieldset className="visibility-picker">
            <legend>Repository visibility</legend>
            <label className={`visibility-option ${visibility === "PRIVATE" ? "selected" : ""}`}>
              <input
                type="radio"
                name="visibility"
                checked={visibility === "PRIVATE"}
                onChange={() => setVisibility("PRIVATE")}
              />
              <span className="radio-glyph">◉</span>
              <span>
                <b>Private</b>
                <small>Only you can see this repository.</small>
              </span>
              <span className="choice-check">✓</span>
            </label>
            <label className={`visibility-option ${visibility === "PUBLIC" ? "selected" : ""}`}>
              <input
                type="radio"
                name="visibility"
                checked={visibility === "PUBLIC"}
                onChange={() => setVisibility("PUBLIC")}
              />
              <span className="radio-glyph">◎</span>
              <span>
                <b>Public</b>
                <small>Anyone can see and clone it.</small>
              </span>
              <span className="choice-check">✓</span>
            </label>
          </fieldset>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={initializeWithReadme}
              onChange={(event) => setInitializeWithReadme(event.target.checked)}
            />
            <span>
              <b>Initialize with a README</b>
              <small>Start with a first commit on the main branch.</small>
            </span>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button className="button-primary" disabled={busy || !user?.username}>
              {busy ? "Creating…" : "Create repository"}
              <span>↗</span>
            </button>
            <span>You'll be able to clone and push right away.</span>
          </div>
        </form>
      </section>
    </HubFrame>
  );
}
