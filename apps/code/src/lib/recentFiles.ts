"use client";

const KEY = "nagarcode:recent-files:v1";
const MAX = 12;

export function loadRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string").slice(0, MAX);
    return [];
  } catch {
    return [];
  }
}

export function pushRecent(path: string): string[] {
  try {
    const current = loadRecent();
    const next = [path, ...current.filter((p) => p !== path)].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return [path];
  }
}

export function clearRecent(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
