"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkspaceService } from "@/lib/workspace/types";
import { createWorkspaceSearchService } from "@/lib/search/service";
import type { SearchOptions, SearchResultGroup } from "@/lib/search/types";
import { loadRecent } from "@/lib/recentFiles";

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
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceResult, setReplaceResult] = useState<string | null>(null);

  // Quick open
  const [quickQuery, setQuickQuery] = useState("");
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);

  // Go to line
  const [gotoFile, setGotoFile] = useState("");
  const [gotoLine, setGotoLine] = useState("");

  const service = useMemo(() => (workspace ? createWorkspaceSearchService(workspace) : null), [workspace]);
  const canSearch = query.trim().length > 0 && !!service;

  const doSearch = async () => {
    if (!service || !query.trim()) return;
    setSearching(true);
    setError(null);
    setReplaceResult(null);
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

  const doReplace = async () => {
    if (!service || !query.trim()) return;
    if (!replace) { setError("Enter replacement text"); return; }
    setReplaceBusy(true);
    setError(null);
    setReplaceResult(null);
    try {
      const opts: SearchOptions & { replaceText: string } = {
        query,
        replaceText: replace,
        isCaseSensitive,
        isRegex,
        isWholeWord,
        ...(include ? { includePattern: include } : {}),
        ...(exclude ? { excludePattern: exclude } : {}),
      };
      const count = await service.replace!(opts);
      setReplaceResult(`Replaced ${count} occurrence${count === 1 ? "" : "s"} across files`);
      await doSearch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReplaceBusy(false);
    }
  };

  const doReplaceInFile = async (path: string) => {
    if (!service || !query.trim() || !replace) return;
    setReplaceBusy(true);
    try {
      const content = await workspace!.readFile(path);
      if (content.includes("\0") || content.length > 500_000) { setError("Skipped binary or large file"); return; }
      let regex: RegExp;
      const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (isRegex) regex = new RegExp(query, isCaseSensitive ? "g" : "gi");
      else {
        let pat = escapeRegExp(query);
        if (isWholeWord) pat = `\\b${pat}\\b`;
        regex = new RegExp(pat, isCaseSensitive ? "g" : "gi");
      }
      const newContent = content.replace(regex, replace);
      if (newContent !== content) {
        await workspace!.writeFile(path, newContent);
        setReplaceResult(`Replaced in ${path}`);
        await doSearch();
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setReplaceBusy(false); }
  };

  useEffect(() => {
    if (!query) { setResults(null); return; }
    const t = setTimeout(() => { void doSearch(); }, 300);
    return () => clearTimeout(t);
  }, [query, isCaseSensitive, isRegex, isWholeWord, include, exclude]);

  // Load file list for quick open
  useEffect(() => {
    if (!workspace) { setAllFiles([]); return; }
    workspace.getAllFiles().then((files) => setAllFiles(files)).catch(() => setAllFiles([]));
    setRecent(loadRecent());
  }, [workspace, results]);

  // Filter quick open
  const quickResults = useMemo(() => {
    if (!quickQuery.trim()) return [];
    const q = quickQuery.toLowerCase();
    return allFiles.filter((f) => f.toLowerCase().includes(q)).slice(0, 20);
  }, [allFiles, quickQuery]);

  const filteredRecent = useMemo(() => recent.slice(0, 10), [recent]);

  const handleGoto = () => {
    const file = gotoFile.trim() || results?.[0]?.path || allFiles[0] || "";
    const lineNum = parseInt(gotoLine, 10);
    if (!file) { setError("Enter a file path for Go to Line"); return; }
    if (!lineNum || lineNum < 1) { setError("Enter a valid line number"); return; }
    onOpenFile(file, lineNum);
  };

  const totalMatches = results?.reduce((a, g) => a + g.results.length, 0) ?? 0;

  return (
    <div className="ide-search-panel">
      <div className="ide-sidebar-header">
        <h2 className="ide-sidebar-title">Search</h2>
        <span className="ide-sidebar-subtitle">Across workspace</span>
      </div>

      {/* Quick Open by file name */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--ide-border)", display: "grid", gap: 6 }}>
        <label className="ide-field-label">Open file by name</label>
        <input
          className="ide-input small"
          placeholder="Type file name… (e.g. app.ts)"
          value={quickQuery}
          onChange={(e) => setQuickQuery(e.target.value)}
        />
        {quickResults.length > 0 ? (
          <div style={{ maxHeight: 120, overflow: "auto", border: "1px solid var(--ide-border)", borderRadius: 6, background: "#0a0f0a" }}>
            {quickResults.map((p) => (
              <button key={p} className="ide-search-hit" style={{ fontSize: 11 }} onClick={() => onOpenFile(p)}>
                {p}
              </button>
            ))}
          </div>
        ) : quickQuery.trim() ? <span className="ide-muted small">No matching files</span> : null}
      </div>

      {/* Recent files */}
      {filteredRecent.length > 0 ? (
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--ide-border)", display: "grid", gap: 6 }}>
          <label className="ide-field-label">Recent files</label>
          <div style={{ display: "grid", gap: 4 }}>
            {filteredRecent.map((p) => (
              <button key={p} className="ide-secondary-btn small" style={{ textAlign: "left", fontFamily: "ui-monospace, monospace", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => onOpenFile(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Go to line */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--ide-border)", display: "grid", gap: 6 }}>
        <label className="ide-field-label">Go to line</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="ide-input small" placeholder="File (optional)" value={gotoFile} onChange={(e) => setGotoFile(e.target.value)} style={{ flex: 2 }} />
          <input className="ide-input small" placeholder="Line" value={gotoLine} onChange={(e) => setGotoLine(e.target.value)} style={{ flex: 1 }} type="number" min={1} />
          <button className="ide-secondary-btn small" onClick={handleGoto}>Go</button>
        </div>
        <span className="ide-muted small">Opens file and scrolls to line. Uses workspace content; binary/large files are skipped.</span>
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
            <button className={`ide-toggle ${isCaseSensitive ? "on" : ""}`} title="Match Case" aria-pressed={isCaseSensitive} onClick={() => setIsCaseSensitive((v) => !v)}>Aa</button>
            <button className={`ide-toggle ${isWholeWord ? "on" : ""}`} title="Match Whole Word" aria-pressed={isWholeWord} onClick={() => setIsWholeWord((v) => !v)}>W</button>
            <button className={`ide-toggle ${isRegex ? "on" : ""}`} title="Use Regular Expression" aria-pressed={isRegex} onClick={() => setIsRegex((v) => !v)}>.*</button>
          </div>
        </div>

        <div className="ide-search-field">
          <div style={{ display: "flex", gap: 6 }}>
            <input
              className="ide-input"
              placeholder="Replace"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              aria-label="Replace"
              style={{ flex: 1 }}
            />
            <button className="ide-secondary-btn small" onClick={doReplace} disabled={!canSearch || replaceBusy || !replace}>
              {replaceBusy ? "…" : "Replace All"}
            </button>
          </div>
          {replaceResult ? <div className="ide-muted small" style={{ color: "var(--ide-accent)" }}>{replaceResult}</div> : null}
        </div>

        <details className="ide-search-advanced">
          <summary>Files to include / exclude</summary>
          <input className="ide-input small" placeholder="Include — e.g. src/*, *.ts" value={include} onChange={(e) => setInclude(e.target.value)} />
          <input className="ide-input small" placeholder="Exclude — e.g. node_modules/*" value={exclude} onChange={(e) => setExclude(e.target.value)} />
        </details>

        {!workspace ? <p className="ide-muted small">Open a folder to search across real files. Demo workspace search works too.</p> : null}
        {error ? <div className="ide-error">{error}</div> : null}

        <div className="ide-search-meta">
          {searching ? <span className="ide-muted">Searching…</span> : null}
          {!searching && results ? (
            <span className="ide-muted">{totalMatches === 0 ? "No results" : `${totalMatches} result${totalMatches === 1 ? "" : "s"} in ${results.length} file${results.length === 1 ? "" : "s"}`}</span>
          ) : null}
          <button className="ide-secondary-btn small" onClick={doSearch} disabled={!canSearch || searching}>Search</button>
        </div>
      </div>

      <div className="ide-search-results">
        {!query ? (
          <div className="ide-search-empty">
            <p className="ide-muted">Type to search. Regex, case and whole-word toggles supported. Binary and large files (&gt;500 KB) are skipped.</p>
            <p className="ide-muted small">Replace runs locally on workspace files — large/binary files are handled gracefully.</p>
          </div>
        ) : results && results.length > 0 ? (
          results.map((group) => (
            <div key={group.path} className="ide-search-group">
              <div className="ide-search-group-head">
                <span className="ide-search-path">{group.path}</span>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span className="ide-search-count">{group.results.length}</span>
                  <button className="ide-secondary-btn small" title="Replace all in this file" onClick={() => void doReplaceInFile(group.path)}>Replace</button>
                </div>
              </div>
              {group.results.slice(0, 20).map((r, idx) => (
                <button
                  key={`${r.path}:${r.line}:${r.column}:${idx}`}
                  className="ide-search-hit"
                  onClick={() => onOpenFile(r.path, r.line)}
                  title={`Line ${r.line}, Col ${r.column}`}
                >
                  <span className="ide-search-line-no">{r.line}:{r.column}</span>
                  <span className="ide-search-preview">{r.preview}</span>
                </button>
              ))}
              {group.results.length > 20 ? <div className="ide-muted small" style={{ padding: "4px 10px" }}>+{group.results.length - 20} more in this file</div> : null}
            </div>
          ))
        ) : results && results.length === 0 ? (
          <div className="ide-search-empty"><p>No matches for “{query}”.</p></div>
        ) : null}
      </div>

      <div className="ide-search-foot">
        <p className="ide-muted small">
          <strong>Navigation:</strong> Click a result to open at line. Use <code>Ctrl+P</code> for quick open (via Command Palette) and <code>Ctrl+G</code> for Go to Line.
        </p>
      </div>
    </div>
  );
}
