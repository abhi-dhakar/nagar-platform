import { classifyDiffLine } from "../lib/diff";

/** A unified diff with added/removed lines highlighted. Text is never interpreted as HTML. */
export function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) return <p className="muted">No textual changes to show.</p>;
  return (
    <pre className="diff-view" aria-label="Unified diff">
      {diff.split("\n").map((line, index) => (
        <span key={index} className={`diff-line ${classifyDiffLine(line)}`}>
          {line || " "}
        </span>
      ))}
    </pre>
  );
}
