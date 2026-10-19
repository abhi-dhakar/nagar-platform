"use client";

import {
  basename,
  dirname,
  normalizePath,
  WorkspaceError,
  type WorkspaceEntry,
  type WorkspaceService,
} from "./types";

type FileNode = { kind: "file"; content: string };
type DirNode = { kind: "directory"; children: Map<string, FileNode | DirNode> };
type Node = FileNode | DirNode;

function makeDemoTree(): DirNode {
  const root: DirNode = { kind: "directory", children: new Map() };

  const src: DirNode = { kind: "directory", children: new Map() };
  src.children.set("index.ts", {
    kind: "file",
    content: `// Welcome to NagarCode — your browser editor
// This is a demo workspace. Use "Open Folder" to open a real folder
// or create files here and they will persist in this session.

export function greet(name: string): string {
  return \`Hello, \${name}! Welcome to NagarCode.\`;
}

console.log(greet("developer"));

// Try:
// - Create a new file (right-click Explorer)
// - Press Ctrl+S to save
// - Press Ctrl+Shift+P for commands
// - Change theme in Settings (activity bar)
`,
  });
  src.children.set("utils.ts", {
    kind: "file",
    content: `export function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
`,
  });
  src.children.set("app.py", {
    kind: "file",
    content: `def fibonacci(n: int) -> int:
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b

print([fibonacci(i) for i in range(10)])
`,
  });

  const components: DirNode = { kind: "directory", children: new Map() };
  components.children.set("Button.tsx", {
    kind: "file",
    content: `import * as React from "react";

export function Button({
  children,
  variant = "primary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "ghost";
}) {
  return (
    <button
      className={\`btn btn-\${variant}\`}
      style={{
        padding: "8px 14px",
        borderRadius: 6,
        border: "1px solid #333",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
`,
  });

  root.children.set("src", { kind: "directory", children: src.children } as DirNode);
  (root.children.get("src") as DirNode).children.set("components", components);

  root.children.set("README.md", {
    kind: "file",
    content: `# NagarCode Demo Workspace

This is an in-memory workspace for when the File System Access API is not available or no folder is opened.

- **Open Folder** — use the Explorer header to open a real local folder (Chrome/Edge).
- **New File / New Folder** — right-click in Explorer or use the header actions.
- **Save** — Ctrl+S writes to the workspace service.

Your edits in this demo workspace are kept in memory and localStorage for the session.
`,
  });
  root.children.set("package.json", {
    kind: "file",
    content: JSON.stringify(
      {
        name: "nagarcode-demo",
        version: "0.1.0",
        scripts: { dev: "next dev", build: "next build" },
        dependencies: { next: "16.3.7", react: "19.3.0" },
      },
      null,
      2,
    ),
  });
  root.children.set(".gitignore", {
    kind: "file",
    content: "node_modules/\n.next/\ndist/\n.env\n",
  });

  return root;
}

const STORAGE_KEY = "nagarcode:memory-workspace:v1";

export class MemoryWorkspace implements WorkspaceService {
  readonly id: string;
  readonly name: string;
  readonly isNative = false;
  readonly rootHandle = null;

  private root: DirNode;

  constructor(name = "Demo Workspace", initial?: DirNode) {
    this.id = `memory-${name}-${Date.now()}`;
    this.name = name;
    this.root = initial ?? makeDemoTree();
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, string>;
          if (
            parsed &&
            typeof parsed === "object" &&
            (parsed as Record<string, unknown>).__type !== "tree"
          ) {
            // flat map fallback
          }
        }
      } catch {
        // ignore
      }
    }
  }

  persist() {
    if (typeof window === "undefined") return;
    try {
      const flat = this.flatten();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(flat));
    } catch {
      // ignore quota
    }
  }

  private flatten(): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (node: DirNode, prefix: string) => {
      for (const [name, child] of node.children) {
        const p = prefix === "/" ? `/${name}` : `${prefix}/${name}`;
        if (child.kind === "file") out[p] = child.content;
        else walk(child, p);
      }
    };
    walk(this.root, "/");
    return out;
  }

  static fromFlat(name: string, flat: Record<string, string>): MemoryWorkspace {
    const root: DirNode = { kind: "directory", children: new Map() };
    for (const [path, content] of Object.entries(flat)) {
      const parts = normalizePath(path).split("/").filter(Boolean);
      let cur: DirNode = root;
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i]!;
        const isLast = i === parts.length - 1;
        if (isLast) {
          cur.children.set(seg, { kind: "file", content });
        } else {
          let next = cur.children.get(seg);
          if (!next || next.kind === "file") {
            next = { kind: "directory", children: new Map() };
            cur.children.set(seg, next);
          }
          cur = next as DirNode;
        }
      }
    }
    return new MemoryWorkspace(name, root);
  }

  private getNode(path: string): Node | null {
    const n = normalizePath(path);
    if (n === "/") return this.root;
    const parts = n.split("/").filter(Boolean);
    let cur: Node = this.root;
    for (const seg of parts) {
      if (cur.kind !== "directory") return null;
      const nxt = cur.children.get(seg);
      if (!nxt) return null;
      cur = nxt;
    }
    return cur;
  }

  private getParent(path: string): { parent: DirNode; name: string } {
    const n = normalizePath(path);
    if (n === "/") throw new WorkspaceError("Cannot operate on root", "UNKNOWN");
    const dir = dirname(n);
    const base = basename(n);
    const parentNode = this.getNode(dir);
    if (!parentNode || parentNode.kind !== "directory") {
      throw new WorkspaceError(`Parent not found: ${dir}`, "NOT_FOUND");
    }
    return { parent: parentNode, name: base };
  }

  private ensureDir(path: string) {
    const n = normalizePath(path);
    if (n === "/") return this.root;
    const parts = n.split("/").filter(Boolean);
    let cur: DirNode = this.root;
    for (const seg of parts) {
      let nxt = cur.children.get(seg);
      if (!nxt) {
        nxt = { kind: "directory", children: new Map() };
        cur.children.set(seg, nxt);
      } else if (nxt.kind === "file") {
        throw new WorkspaceError(`File exists where directory needed: ${seg}`, "ALREADY_EXISTS");
      }
      cur = nxt as DirNode;
    }
    return cur;
  }

  async list(path: string): Promise<WorkspaceEntry[]> {
    const n = normalizePath(path);
    const node = this.getNode(n);
    if (!node) throw new WorkspaceError(`Not found: ${path}`, "NOT_FOUND");
    if (node.kind !== "directory") throw new WorkspaceError(`Not a directory: ${path}`, "UNKNOWN");
    const entries: WorkspaceEntry[] = [];
    for (const [name, child] of node.children) {
      entries.push({
        name,
        path: n === "/" ? `/${name}` : `${n}/${name}`,
        kind: child.kind,
      });
    }
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  async readFile(path: string): Promise<string> {
    const node = this.getNode(normalizePath(path));
    if (!node || node.kind !== "directory") {
      if (node && node.kind === "file") return node.content;
    }
    if (!node) throw new WorkspaceError(`File not found: ${path}`, "NOT_FOUND");
    if (node.kind === "directory") throw new WorkspaceError(`Is a directory: ${path}`, "UNKNOWN");
    return (node as FileNode).content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const n = normalizePath(path);
    const node = this.getNode(n);
    if (node && node.kind === "directory") {
      throw new WorkspaceError(`Is a directory: ${path}`, "UNKNOWN");
    }
    if (node && node.kind === "file") {
      (node as FileNode).content = content;
      this.persist();
      return;
    }
    const dir = dirname(n);
    const parent = this.ensureDir(dir);
    parent.children.set(basename(n), { kind: "file", content });
    this.persist();
  }

  async createFile(path: string, content = ""): Promise<void> {
    const n = normalizePath(path);
    if (this.getNode(n)) throw new WorkspaceError(`Already exists: ${path}`, "ALREADY_EXISTS");
    const dir = dirname(n);
    this.ensureDir(dir);
    const { parent, name } = this.getParent(n);
    parent.children.set(name, { kind: "file", content });
    this.persist();
  }

  async createFolder(path: string): Promise<void> {
    const n = normalizePath(path);
    if (this.getNode(n)) throw new WorkspaceError(`Already exists: ${path}`, "ALREADY_EXISTS");
    this.ensureDir(n);
    this.persist();
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const o = normalizePath(oldPath);
    const n = normalizePath(newPath);
    if (o === n) return;
    if (o === "/") throw new WorkspaceError("Cannot rename root", "UNKNOWN");
    const node = this.getNode(o);
    if (!node) throw new WorkspaceError(`Not found: ${oldPath}`, "NOT_FOUND");
    if (this.getNode(n)) throw new WorkspaceError(`Already exists: ${newPath}`, "ALREADY_EXISTS");
    this.ensureDir(dirname(n));
    const { parent: oldParent, name: oldName } = this.getParent(o);
    const { parent: newParent, name: newName } = this.getParent(n);
    oldParent.children.delete(oldName);
    newParent.children.set(newName, node);
    this.persist();
  }

  async delete(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const n = normalizePath(path);
    if (n === "/") throw new WorkspaceError("Cannot delete root", "UNKNOWN");
    const node = this.getNode(n);
    if (!node) throw new WorkspaceError(`Not found: ${path}`, "NOT_FOUND");
    if (node.kind === "directory" && node.children.size > 0 && !opts?.recursive) {
      throw new WorkspaceError("Directory not empty", "UNKNOWN");
    }
    const { parent, name } = this.getParent(n);
    parent.children.delete(name);
    this.persist();
  }

  async exists(path: string): Promise<boolean> {
    return this.getNode(normalizePath(path)) !== null;
  }

  async stat(path: string): Promise<WorkspaceEntry | null> {
    const n = normalizePath(path);
    const node = this.getNode(n);
    if (!node) return null;
    return { name: n === "/" ? "/" : basename(n), path: n, kind: node.kind };
  }

  async getAllFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = (dir: DirNode, prefix: string) => {
      for (const [name, child] of dir.children) {
        const p = prefix === "/" ? `/${name}` : `${prefix}/${name}`;
        if (child.kind === "file") out.push(p);
        else walk(child as DirNode, p);
      }
    };
    walk(this.root, "/");
    return out;
  }

  getRoot(): DirNode {
    return this.root;
  }
}

export function createDemoWorkspace(): MemoryWorkspace {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const flat = JSON.parse(raw) as Record<string, string>;
        if (Object.keys(flat).length > 0) {
          const isFlat = Object.values(flat).every((v) => typeof v === "string");
          if (isFlat) {
            return MemoryWorkspace.fromFlat("Demo Workspace", flat);
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return new MemoryWorkspace();
}

export function createEmptyMemoryWorkspace(name = "Untitled Workspace"): MemoryWorkspace {
  const root: DirNode = { kind: "directory", children: new Map() };
  return new MemoryWorkspace(name, root);
}
