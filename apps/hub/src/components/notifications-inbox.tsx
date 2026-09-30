"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { HubFrame } from "./hub-frame";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  readAt: string | null;
  createdAt: string;
};
export function NotificationsInbox() {
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/notifications", { credentials: "include" });
      const payload = (await response.json()) as {
        data?: { notifications: Notification[] };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? "Couldn't load your inbox.");
      setItems(payload.data.notifications);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id?: string) {
    const url = id
      ? `/api/v1/notifications/${encodeURIComponent(id)}/read`
      : "/api/v1/notifications/read-all";
    const response = await fetch(url, { method: id ? "PATCH" : "POST", credentials: "include" });
    if (!response.ok) {
      setError("Couldn't update notification status.");
      return;
    }
    await load();
  }

  return (
    <HubFrame>
      <main className="collab-page">
        <div className="collab-header">
          <div>
            <p className="eyebrow">NAGARHUB / INBOX</p>
            <h1>Your notifications.</h1>
            <p className="muted">Issues, reviews, access changes, and organization updates.</p>
          </div>
          <button
            className="collab-action"
            disabled={!items.some((item) => !item.readAt)}
            onClick={() => void markRead()}
          >
            Mark all read
          </button>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <section className="collab-card">
          <h2>
            Recent activity{" "}
            <span className="collab-chip">
              {items.filter((item) => !item.readAt).length} unread
            </span>
          </h2>
          {loading ? (
            <div className="collab-empty">Loading inbox…</div>
          ) : items.length === 0 ? (
            <div className="collab-empty">
              You're all caught up. New collaboration activity will show up here.
            </div>
          ) : (
            items.map((item) => (
              <div className={`notification-row ${item.readAt ? "" : "unread"}`} key={item.id}>
                <Link
                  href={item.url}
                  onClick={() => {
                    if (!item.readAt) void markRead(item.id);
                  }}
                >
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </Link>
                <div className="notification-meta">
                  <span>{item.type.replaceAll("_", " ")}</span>
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                  {!item.readAt && (
                    <button
                      className="button-secondary collab-action"
                      onClick={() => void markRead(item.id)}
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </section>
      </main>
    </HubFrame>
  );
}
