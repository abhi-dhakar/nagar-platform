"use client";

import { useEffect, useState } from "react";

export function PreviewPanel() {
  const [port, setPort] = useState("3000");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const connect = () => {
    const p = parseInt(port, 10);
    if (isNaN(p) || p < 1 || p > 65535) {
      setError("Enter a valid port (1–65535)");
      return;
    }
    setError(null);
    setLoading(true);
    // Use localhost — preview will be served from user's machine, not sandbox
    // For e2b preview environment, we need to allow local preview via iframe; we use relative or localhost
    // Since code runs at 0.0.0.0, preview at localhost:port should be reachable if dev server is running
    const previewUrl = `http://localhost:${p}`;
    setUrl(previewUrl);
    setRefreshKey((k) => k + 1);
  };

  const openExternal = () => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
    setLoading(true);
  };

  useEffect(() => {
    if (!url) return;
    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, [refreshKey, url]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--ide-border)", display: "grid", gap: 8, background: "#0e140f" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label className="ide-field-label" style={{ minWidth: 50 }}>Port</label>
          <input
            className="ide-input small"
            placeholder="3000"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            style={{ width: 100 }}
            type="number"
            min={1}
            max={65535}
          />
          <button className="ide-primary-btn small" onClick={connect}>Connect</button>
          <button className="ide-secondary-btn small" onClick={handleRefresh} disabled={!url}>Refresh</button>
          <button className="ide-secondary-btn small" onClick={openExternal} disabled={!url}>Open in tab</button>
        </div>
        {url ? <div className="ide-muted small" style={{ fontFamily: "ui-monospace, monospace" }}>Preview: {url}</div> : null}
        {error ? <div className="ide-error" style={{ fontSize: 11 }}>{error}</div> : null}
        <p className="ide-muted small">
          Start your dev server (e.g. <code>npm run dev</code> in the terminal) then enter its port. Preview shows the real HTTP server — not every project has a web preview.
        </p>
      </div>

      <div style={{ flex: 1, overflow: "hidden", background: "#fff", display: "grid", placeItems: "center", position: "relative" }}>
        {!url ? (
          <div style={{ padding: 20, textAlign: "center", maxWidth: 500 }}>
            <h4 style={{ color: "#111", margin: "0 0 6px" }}>No preview connected</h4>
            <p className="ide-muted small" style={{ color: "#555" }}>Enter the port your app is running on. Example: if <code>npm run dev</code> says “Local: http://localhost:3000”, enter 3000.</p>
            <p className="ide-muted small" style={{ color: "#555" }}>If the server isn’t running, you’ll see a connection error below — that’s expected until you start it.</p>
          </div>
        ) : (
          <>
            <iframe
              key={refreshKey}
              src={url}
              title="Preview"
              style={{ width: "100%", height: "100%", border: 0, background: "#fff" }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
              allow="clipboard-read; clipboard-write"
              onLoad={() => setLoading(false)}
              onError={() => { setError("Could not load preview. Is the server running on that port?"); setLoading(false); }}
            />
            {loading ? (
              <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.7)", color: "#fff", padding: "4px 8px", borderRadius: 4, fontSize: 11 }}>
                Loading…
              </div>
            ) : null}
          </>
        )}
      </div>

      {url ? (
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--ide-border)", background: "#0e140f", display: "flex", gap: 8, alignItems: "center" }}>
          <span className="ide-muted small">If the preview is blank, check your server logs. X-Frame-Options may block embedding — use “Open in tab”.</span>
        </div>
      ) : null}
    </div>
  );
}
