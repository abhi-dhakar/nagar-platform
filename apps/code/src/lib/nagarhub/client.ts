"use client";

import type { ApiResponse, NagarHubRepository, NagarHubRepositoryDetails, NagarHubUser } from "./types";

const DEFAULT_HUB_URL = typeof window !== "undefined" && window.location.hostname.endsWith("e2b.app")
  ? window.location.origin.replace(/3001.*/, "4000")
  : "http://localhost:4000";

function getStoredHubUrl(): string {
  if (typeof window === "undefined") return DEFAULT_HUB_URL;
  try {
    const stored = localStorage.getItem("nagarhub.url");
    if (stored) return stored.replace(/\/+$/, "");
  } catch {
    // ignore storage errors
  }
  // If we're on localhost:3001, use API directly; if on e2b preview, use same logic
  return DEFAULT_HUB_URL;
}

export function setStoredHubUrl(url: string): void {
  const normalized = url.trim().replace(/\/+$/, "");
  if (!normalized) return;
  try {
    localStorage.setItem("nagarhub.url", normalized);
  } catch {
    // ignore storage errors
  }
}

export function getHubBaseUrl(): string {
  return getStoredHubUrl();
}

export function getApiBase(): string {
  const base = getHubBaseUrl();
  // If user configured Hub URL as http://localhost:3000, API is under /api
  // If configured as http://localhost:4000, it's also /api
  // We'll always use base + /api/v1
  return `${base.replace(/\/+$/, "")}/api/v1`;
}

export function getAuthBase(): string {
  const base = getHubBaseUrl();
  return `${base.replace(/\/+$/, "")}/api/auth`;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const base = getApiBase();
  const url = `${base}${path}`;
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(options.headers as Record<string, string>),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const failure = json as ApiResponse<unknown>;
    if (failure && typeof failure === "object" && "success" in failure && !failure.success) {
      throw Object.assign(new Error(failure.error.message), { code: failure.error.code, status: res.status });
    }
    throw Object.assign(new Error(`NagarHub request failed: ${res.status}`), { status: res.status });
  }
  const success = json as ApiResponse<T>;
  if (success && typeof success === "object" && "success" in success && success.success) {
    return success.data;
  }
  // Some auth endpoints return raw user object without envelope
  return json as T;
}

export async function signIn(email: string, password: string): Promise<void> {
  const base = getAuthBase();
  const res = await fetch(`${base}/sign-in/email`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
    const msg = json?.message ?? json?.error?.message ?? `Sign-in failed (${res.status})`;
    const err = new Error(msg) as Error & { status?: number; code?: string };
    err.status = res.status;
    throw err;
  }
}

export async function signUp(data: { name: string; email: string; password: string; username: string }): Promise<void> {
  const base = getAuthBase();
  const res = await fetch(`${base}/sign-up/email`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: data.name, email: data.email, password: data.password }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
    const msg = json?.message ?? json?.error?.message ?? `Sign-up failed (${res.status})`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  // Set username via profile
  const profileRes = await fetch(`${getApiBase()}/me/profile`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: data.username, name: data.name }),
  });
  if (!profileRes.ok) {
    const json = (await profileRes.json().catch(() => null)) as ApiResponse<unknown>;
    if (json && !json.success) {
      throw new Error(json.error.message);
    }
    throw new Error(`Failed to set username (${profileRes.status})`);
  }
}

export async function signOut(): Promise<void> {
  const base = getAuthBase();
  await fetch(`${base}/sign-out`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
  });
}

export async function getMe(): Promise<NagarHubUser> {
  const data = await apiFetch<{ user: NagarHubUser }>("/me");
  return data.user;
}

export async function listRepositories(): Promise<NagarHubRepository[]> {
  const data = await apiFetch<{ repositories: NagarHubRepository[] }>("/repositories");
  return data.repositories;
}

export async function createRepository(data: { name: string; description?: string; visibility: "PUBLIC" | "PRIVATE"; initializeWithReadme?: boolean }): Promise<NagarHubRepositoryDetails> {
  const result = await apiFetch<{ repository: NagarHubRepositoryDetails }>("/repositories", {
    method: "POST",
    body: JSON.stringify({ ...data }),
  });
  return result.repository;
}

export async function getRepository(namespace: string, slug: string): Promise<NagarHubRepositoryDetails> {
  const data = await apiFetch<{ repository: NagarHubRepositoryDetails }>(`/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}`);
  return data.repository;
}

export async function createOrgRepository(orgSlug: string, data: { name: string; description?: string; visibility: "PUBLIC" | "PRIVATE" }): Promise<NagarHubRepository> {
  const result = await apiFetch<{ repository: NagarHubRepository }>(`/organizations/${encodeURIComponent(orgSlug)}/repositories`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return result.repository;
}

export class NagarHubClientError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, opts?: { code?: string; status?: number }) {
    super(message);
    this.name = "NagarHubClientError";
    if (opts?.code) this.code = opts.code;
    if (opts?.status !== undefined) this.status = opts.status;
  }
}
