"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { HubFrame } from "./hub-frame";

export function AuthForm({ mode }: { mode: "signup" | "login" }) {
  const router = useRouter();
  const isSignup = mode === "signup";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const username = String(form.get("username") ?? "")
      .trim()
      .toLowerCase();

    try {
      const response = await fetch(`/api/auth/${isSignup ? "sign-up" : "sign-in"}/email`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isSignup ? { name, email, password } : { email, password }),
      });
      const result = (await response.json().catch(() => null)) as {
        message?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setError(result?.message ?? result?.error?.message ?? "We couldn't complete that request.");
        return;
      }

      if (isSignup) {
        const profileResponse = await fetch("/api/v1/me/profile", {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, name }),
        });
        if (!profileResponse.ok) {
          router.push("/settings/profile?finish=1");
          return;
        }
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("NagarHub couldn't reach the API. Make sure the platform services are running.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <HubFrame>
      <section className="auth-layout">
        <div className="auth-intro">
          <p className="eyebrow">
            <span>ACCOUNT</span> / NAGAR IDENTITY
          </p>
          <h1>
            {isSignup ? (
              <>
                A home for
                <br />
                your next idea.
              </>
            ) : (
              <>
                Welcome
                <br />
                back.
              </>
            )}
          </h1>
          <p>One Nagar account for your repositories, workspaces, and deployments.</p>
          <div className="auth-proof">
            <span>01</span>
            <div>
              <b>One account</b>
              <small>Connected across the Nagar platform</small>
            </div>
          </div>
          <div className="auth-proof">
            <span>02</span>
            <div>
              <b>Your work, yours</b>
              <small>Private repositories start private</small>
            </div>
          </div>
        </div>
        <form className="form-card" onSubmit={submit}>
          <p className="eyebrow">{isSignup ? "CREATE YOUR ACCOUNT" : "SIGN IN TO NAGAR"}</p>
          <h2>{isSignup ? "Get started" : "Sign in"}</h2>
          <p className="form-subtitle">
            {isSignup ? "Create your shared Nagar identity." : "Pick up where you left off."}
          </p>
          {isSignup && (
            <label>
              Display name
              <input
                name="name"
                required
                minLength={1}
                maxLength={80}
                autoComplete="name"
                placeholder="Ada Lovelace"
              />
            </label>
          )}
          {isSignup && (
            <label>
              Username
              <input
                name="username"
                required
                minLength={3}
                maxLength={39}
                pattern="[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]"
                autoComplete="username"
                placeholder="ada-lovelace"
              />
              <small>Your public profile URL, for example /ada-lovelace</small>
            </label>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder={isSignup ? "At least 12 characters" : "Your password"}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button-primary full-width" disabled={busy}>
            {busy ? "One moment…" : isSignup ? "Create account" : "Sign in"}
            <span>↗</span>
          </button>
          <p className="form-switch">
            {isSignup ? "Already have an account?" : "New to Nagar?"}{" "}
            <Link href={isSignup ? "/login" : "/signup"}>
              {isSignup ? "Sign in" : "Create an account"}
            </Link>
          </p>
          <p className="form-legal">
            By continuing, you agree to use Nagar responsibly. Local Phase 1 accounts are for
            development and testing.
          </p>
        </form>
      </section>
    </HubFrame>
  );
}
