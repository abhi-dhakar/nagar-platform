"use client";

import { useEffect, useState, useMemo } from "react";
import type { WorkspaceService } from "@/lib/workspace/types";
import { createWorkspaceSearchService } from "@/lib/search/service";
import type { SearchOptions, SearchResultGroup } from "@/lib/search/types";

export function SearchPanel({
  workspace,
  onOpenFile,
}: {
  workspace: WorkspaceService | null;
  onOpenFile: (path: string, line?: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [isWholeWord, setIsWholeWord] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [results, setResults] = useState<SearchResultGroup[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const service = useMemo(() => (workspace ? createWorkspaceSearchService(workspace) : null), [workspace]);

  const canSearch = query.trim().length > 0 && !!service;

  const doSearch = async () => {
    if (!service || !query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const opts: SearchOptions = {
        query,
        isCaseSensitive,
        isRegex,
        isWholeWord,
        ...(include ? { includePattern: include } : {}),
        ...(exclude ? { excludePattern: exclude } : {}),
      };
      const res = await service.search(opts);
      setResults(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!query) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      void doSearch();
    }, 300);
    return () => clearTimeout(t);
  }, [query, isCaseSensitive, isRegex, isWholeWord, include, exclude]);

  const totalMatches = results?.reduce((a, g) => a + g.results.length, 0) ?? 0;

  return (
    <div className="ide-search-panel">
      <div className="ide-sidebar-header">
        <h2 className="ide-sidebar-title">Search</h2>
        <span className="ide-sidebar-subtitle">Across workspace</span>
      </div>

      <div className="ide-search-form">
        <div className="ide-search-field">
          <input
            className="ide-input"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search"
          />
          <div className="ide-search-opts">
            <button
              className={`ide-toggle ${isCaseSensitive ? "on" : ""}`}
              title="Match Case"
              aria-pressed={isCaseSensitive}
              onClick={() => setIsCaseSensitive((v) => !v)}
            >
              Aa
            </button>
            <button
              className={`ide-toggle ${isWholeWord ? "on" : ""}`}
              title="Match Whole Word"
              aria-pressed={isWholeWord}
              onClick={() => setIsWholeWord((v) => !v)}
            >
              W
            </button>
            <button
              className={`ide-toggle ${isRegex ? "on" : ""}`}
              title="Use Regular Expression"
              aria-pressed={isRegex}
              onClick={() => setIsRegex((v) => !v)}
            >
              .*
            </button>
          </div>
        </div>

        <div className="ide-search-field">
          <input
            className="ide-input"
            placeholder="Replace (preview only in this phase)"
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            aria-label="Replace"
            disabled
            title="Replace is UI-only in Phase 1; no bulk replace is executed."
          />
        </div>

        <details className="ide-search-advanced">
          <summary>Files to include / exclude</summary>
          <input
            className="ide-input small"
            placeholder="Include — e.g. src/*, *.ts"
            value={include}
            onChange={(e) => setInclude(e.target.value)}
          />
          <input
            className="ide-input small"
            placeholder="Exclude — e.g. node_modules/*"
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
          />
        </details>

        {!workspace ? (
          <p className="ide-muted small">Open a folder to search across real files. Demo workspace search works too.</p>
        ) : null}

        {error ? <div className="ide-error">{error}</div> : null}

        <div className="ide-search-meta">
          {searching ? <span className="ide-muted">Searching…</span> : null}
          {!searching && results ? (
            <span className="ide-muted">
              {totalMatches === 0 ? "No results" : `${totalMatches} result${totalMatches === 1 ? "" : "s"} in ${results.length} file${results.length === 1 ? "" : "s"}`}
            </span>
          ) : null}
          <button className="ide-secondary-btn small" onClick={doSearch} disabled={!canSearch || searching}>
            Search
          </button>
        </div>
      </div>

      <div className="ide-search-results">
        {!query ? (
          <div className="ide-search-empty">
            <p className="ide-muted">Type to search. Regular expressions, case and whole-word toggles are supported.</p>
            <p className="ide-muted small">This search runs locally via the workspace service — no server is required.</p>
          </div>
        ) : results && results.length > 0 ? (
          results.map((group) => (
            <div key={group.path} className="ide-search-group">
              <div className="ide-search-group-head">
                <span className="ide-search-path">{group.path}</span>
                <span className="ide-search-count">{group.results.length}</span>
              </div>
              {group.results.slice(0, 20).map((r, idx) => (
                <button
                  key={`${r.path}:${r.line}:${r.column}:${idx}`}
                  className="ide-search-hit"
                  onClick={() => onOpenFile(r.path, r.line)}
                  title={`Line ${r.line}, Col ${r.column}`}
                >
                  <span className="ide-search-line-no">
                    {r.line}:{r.column}
                  </span>
                  <span className="ide-search-preview">{r.preview}</span>
                </button>
              ))}
              {group.results.length > 20 ? (
                <div className="ide-muted small" style={{ padding: "4px 10px" }}>
                  +{group.results.length - 20} more in this file
                </div>
              ) : null}
            </div>
          ))
        ) : results && results.length === 0 ? (
          <div className="ide-search-empty">
            <p>No matches for “{query}”.</p>
          </div>
        ) : null}
      </div>

      <div className="ide-search-foot">
        <p className="ide-muted small">
          <strong>Service interface:</strong> <code>SearchService.search(options)</code> — implemented for the active
          workspace; ready to be swapped for a worker-based index in Phase 2.
        </p>
      </div>
    </div>
  );
}
