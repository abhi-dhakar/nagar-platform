export type DiffLineKind = "file" | "hunk" | "add" | "del" | "meta" | "context";

/**
 * Classifies one line of a unified diff for display. Purely presentational: the text itself is
 * always rendered as plain text by React, never as HTML.
 */
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("diff --git ")) return "file";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (
    line.startsWith("index ") ||
    line.startsWith("new file mode") ||
    line.startsWith("deleted file mode") ||
    line.startsWith("old mode") ||
    line.startsWith("new mode") ||
    line.startsWith("similarity index") ||
    line.startsWith("Binary files ") ||
    line.startsWith("\\ No newline")
  )
    return "meta";
  return "context";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
