"use client";

import type { SearchOptions, SearchResultGroup, SearchService } from "./types";
import type { WorkspaceService } from "../workspace/types";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
}

function matchesGlob(path: string, pattern: string): boolean {
  if (!pattern.trim()) return true;
  const globs = pattern
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (globs.length === 0) return true;
  return globs.some((g) => {
    const reStr = "^" + escapeRegExp(g).replace(/\\\*/g, ".*") + "$";
    try {
      return new RegExp(reStr).test(path) || path.includes(g.replace(/\*/g, ""));
    } catch {
      return false;
    }
  });
}

export function createWorkspaceSearchService(workspace: WorkspaceService): SearchService {
  return {
    async search(opts: SearchOptions): Promise<SearchResultGroup[]> {
      const query = opts.query;
      if (!query) return [];

      let regex: RegExp;
      try {
        if (opts.isRegex) {
          const flags = opts.isCaseSensitive ? "g" : "gi";
          regex = new RegExp(query, flags);
        } else {
          let pattern = escapeRegExp(query);
          if (opts.isWholeWord) pattern = `\\b${pattern}\\b`;
          const flags = opts.isCaseSensitive ? "g" : "gi";
          regex = new RegExp(pattern, flags);
        }
      } catch {
        return [];
      }

      const allFiles = await workspace.getAllFiles();
      const filtered = allFiles.filter((p) => {
        if (opts.includePattern && !matchesGlob(p, opts.includePattern)) return false;
        if (opts.excludePattern && matchesGlob(p, opts.excludePattern)) return false;
        return true;
      });

      const groups: SearchResultGroup[] = [];

      for (const path of filtered) {
        let content: string;
        try {
          content = await workspace.readFile(path);
        } catch {
          continue;
        }
        if (content.includes("\0")) continue;
        if (content.length > 500_000) continue;

        const lines = content.split("\n");
        const results: SearchResultGroup["results"] = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          regex.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = regex.exec(line)) !== null) {
            if (m[0].length === 0) {
              regex.lastIndex++;
              if (regex.lastIndex > line.length) break;
              continue;
            }
            results.push({
              path,
              line: i + 1,
              column: (m.index ?? 0) + 1,
              preview: line.trim().slice(0, 300),
              matchLength: m[0].length,
            });
            if (results.length > 200) break;
          }
          if (results.length > 200) break;
        }

        if (results.length > 0) {
          groups.push({ path, results });
        }
        if (groups.length > 100) break;
      }

      return groups;
    },

    async replace(opts: SearchOptions & { replaceText: string }): Promise<number> {
      const query = opts.query;
      if (!query) return 0;

      let regex: RegExp;
      try {
        if (opts.isRegex) {
          const flags = opts.isCaseSensitive ? "g" : "gi";
          regex = new RegExp(query, flags);
        } else {
          let pattern = escapeRegExp(query);
          if (opts.isWholeWord) pattern = `\\b${pattern}\\b`;
          const flags = opts.isCaseSensitive ? "g" : "gi";
          regex = new RegExp(pattern, flags);
        }
      } catch {
        throw new Error("Invalid search pattern");
      }

      const allFiles = await workspace.getAllFiles();
      const filtered = allFiles.filter((p) => {
        if (opts.includePattern && !matchesGlob(p, opts.includePattern)) return false;
        if (opts.excludePattern && matchesGlob(p, opts.excludePattern)) return false;
        return true;
      });

      let totalReplacements = 0;

      for (const path of filtered) {
        let content: string;
        try {
          content = await workspace.readFile(path);
        } catch {
          continue;
        }
        if (content.includes("\0")) continue;
        if (content.length > 500_000) continue;

        const newContent = content.replace(regex, opts.replaceText);
        if (newContent !== content) {
          const matches = (content.match(regex) || []).length;
          totalReplacements += matches;
          try {
            await workspace.writeFile(path, newContent);
          } catch {
            continue;
          }
        }
        // Guard against huge replacement sets
        if (totalReplacements > 5000) break;
      }

      return totalReplacements;
    },
  };
}
