"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { HubFrame } from "./hub-frame";

type User = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  bio: string | null;
};

export function ProfileForm() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setIsFinishing(new URLSearchParams(window.location.search).get("finish") === "1");
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
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/me/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: String(form.get("username") ?? "").trim(),
          name: String(form.get("name") ?? "").trim(),
          bio: String(form.get("bio") ?? "").trim(),
        }),
      });
      const body = (await response.json()) as {
        data?: { user?: User };
        error?: { message?: string };
      };
      if (!response.ok || !body.data?.user) {
        setError(body.error?.message ?? "Profile couldn't be saved.");
        return;
      }
      setUser(body.data.user);
      setMessage("Your profile is saved.");
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
          <span>SETTINGS</span> / PUBLIC PROFILE
        </p>
        <h1>Make it yours.</h1>
        <p className="muted">Your profile connects your work across NagarHub.</p>
        <form key={user?.id ?? "profile-loading"} className="form-card wide-form" onSubmit={submit}>
          {isFinishing && (
            <div className="notice">
              Your account is ready. Choose a username to finish setting up NagarHub.
            </div>
          )}
          <label>
            Display name
            <input
              name="name"
              required
              minLength={1}
              maxLength={80}
              defaultValue={user?.name ?? ""}
              placeholder="Ada Lovelace"
            />
          </label>
          <label>
            Username
            <input
              name="username"
              required
              minLength={3}
              maxLength={39}
              pattern="[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]"
              defaultValue={user?.username ?? ""}
              placeholder="ada-lovelace"
            />
            <small>
              Letters, numbers, and hyphens. Your profile: nagar.dev/{user?.username ?? "username"}
            </small>
          </label>
          <label>
            Bio <span className="optional-label">OPTIONAL</span>
            <textarea
              name="bio"
              maxLength={280}
              rows={4}
              defaultValue={user?.bio ?? ""}
              placeholder="A little about what you build…"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="form-success" role="status">
              {message}
            </p>
          )}
          <div className="form-actions">
            <button className="button-primary" disabled={busy || !user}>
              {busy ? "Saving…" : "Save profile"}
              <span>↗</span>
            </button>
            {user?.username && <Link href={`/${user.username}`}>View public profile →</Link>}
          </div>
        </form>
      </section>
    </HubFrame>
  );
}
