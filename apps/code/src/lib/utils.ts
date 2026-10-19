export function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  )
    return "javascript";
  if (ext === "py" || ext === "pyw") return "python";
  if (ext === "json") return "json";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "css") return "css";
  if (ext === "scss" || ext === "sass") return "scss";
  if (ext === "yaml" || ext === "yml") return "yaml";
  if (ext === "toml") return "toml";
  if (ext === "sh" || ext === "bash") return "shell";
  if (ext === "rs") return "rust";
  if (ext === "go") return "go";
  if (ext === "java") return "java";
  if (ext === "sql") return "sql";
  if (ext === "xml") return "xml";
  if (ext === "svg") return "xml";
  if (ext === "dockerfile" || lower.includes("dockerfile")) return "dockerfile";
  return "plaintext";
}

export function getFileIcon(
  path: string,
  kind: "file" | "directory" = "file",
): { icon: string; color: string } {
  if (kind === "directory") return { icon: "📁", color: "#7aa2ff" };
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return { icon: "TS", color: "#3178c6" };
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) return { icon: "JS", color: "#f7df1e" };
  if (lower.endsWith(".py")) return { icon: "PY", color: "#3776ab" };
  if (lower.endsWith(".json")) return { icon: "{}", color: "#cbcb41" };
  if (lower.endsWith(".md")) return { icon: "MD", color: "#8b949e" };
  if (lower.endsWith(".html")) return { icon: "⟨⟩", color: "#e34f26" };
  if (lower.endsWith(".css") || lower.endsWith(".scss")) return { icon: "#", color: "#563d7c" };
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return { icon: "Y", color: "#f05138" };
  if (lower.endsWith(".sh")) return { icon: "$_", color: "#89e051" };
  if (lower.endsWith(".toml")) return { icon: "T", color: "#9ecbff" };
  if (lower === "dockerfile") return { icon: "⬢", color: "#2496ed" };
  if (lower.includes("package.json")) return { icon: "◉", color: "#cb3837" };
  return { icon: "◐", color: "#8b949e" };
}

export function formatPathForDisplay(path: string): string {
  if (path === "/") return "/";
  return path.replace(/^\//, "");
}

export function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): T {
  let t: ReturnType<typeof setTimeout> | null = null;
  return ((...args: never[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  }) as T;
}

export function throttle<T extends (...args: never[]) => void>(fn: T, limit: number): T {
  let inThrottle = false;
  return ((...args: never[]) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  }) as T;
}
