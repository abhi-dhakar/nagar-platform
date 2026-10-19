import { randomUUID } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import type { AgentEntry, AgentFile, WorkspaceSummary } from "@nagar/agent-protocol";
import { AgentError, mapFsError } from "./errors.js";
import {
  assertAbsoluteDirectoryInput,
  assertInside,
  compareRoots,
  isPathInside,
  normalizeWorkspacePath,
  resolveExisting,
  resolveForCreate,
  toAbsolute,
  toWorkspacePath,
} from "./paths.js";
import { findContainingRoot } from "./config.js";

export type WorkspaceLimits = {
  maxReadBytes: number;
  maxWriteBytes: number;
  maxListEntries: number;
  maxFiles: number;
};

type WorkspaceRecord = {
  summary: WorkspaceSummary;
  realRoot: string;
};

const SKIP_WALK_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "coverage",
  "out",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
]);

function directoryName(root: string): string {
  const base = path.basename(root);
  if (base) return base;
  if (process.platform === "win32") {
    const parsed = path.parse(root);
    return parsed.root.replace(/[\\/]+$/, "") || root;
  }
  return "/";
}

function entrySort(a: AgentEntry, b: AgentEntry): number {
  if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

export class WorkspaceManager {
  private readonly workspaces = new Map<string, WorkspaceRecord>();
  private readonly allowedRoots: string[];
  private readonly limits: WorkspaceLimits;
  private lastOpenedId: string | null = null;

  constructor(allowedRoots: string[], limits: WorkspaceLimits) {
    this.allowedRoots = allowedRoots;
    this.limits = limits;
  }

  listWorkspaces(): WorkspaceSummary[] {
    return [...this.workspaces.values()].map((record) => record.summary);
  }

  currentSummary(): WorkspaceSummary | null {
    if (!this.lastOpenedId) return null;
    return this.workspaces.get(this.lastOpenedId)?.summary ?? null;
  }

  getSummary(id: string): WorkspaceSummary {
    return this.getRecord(id).summary;
  }

  getRoot(id: string): string {
    return this.getRecord(id).realRoot;
  }

  private getRecord(id: string): WorkspaceRecord {
    const record = this.workspaces.get(id);
    if (!record) throw new AgentError("WORKSPACE_NOT_FOUND", "That workspace is no longer open.");
    return record;
  }

  async open(inputPath: unknown): Promise<WorkspaceSummary> {
    const candidate = assertAbsoluteDirectoryInput(inputPath);
    let realRoot: string;
    try {
      realRoot = await fs.realpath(candidate);
      const stat = await fs.stat(realRoot);
      if (!stat.isDirectory()) {
        throw new AgentError("NOT_A_DIRECTORY", `Not a directory: ${candidate}`);
      }
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw mapFsError(error, candidate);
    }
    if (!findContainingRoot(this.allowedRoots, realRoot)) {
      throw new AgentError(
        "FORBIDDEN_PATH",
        `That directory is outside the agent's allowed roots. Allowed roots: ${this.allowedRoots.join(", ")}. ` +
          "Restart the agent with --allow-root to authorize it.",
      );
    }
    for (const record of this.workspaces.values()) {
      if (compareRoots(record.realRoot, realRoot)) return record.summary;
    }
    const summary: WorkspaceSummary = {
      id: randomUUID(),
      name: directoryName(realRoot),
      root: realRoot,
      openedAt: new Date().toISOString(),
    };
    this.workspaces.set(summary.id, { summary, realRoot });
    this.lastOpenedId = summary.id;
    return summary;
  }

  close(id: string): boolean {
    const deleted = this.workspaces.delete(id);
    if (this.lastOpenedId === id) this.lastOpenedId = null;
    return deleted;
  }

  closeAll(): void {
    this.workspaces.clear();
    this.lastOpenedId = null;
  }

  private absolute(root: string, workspacePath: unknown): string {
    return toAbsolute(root, normalizeWorkspacePath(workspacePath));
  }

  async list(id: string, workspacePath: unknown): Promise<AgentEntry[]> {
    const root = this.getRoot(id);
    const rel = normalizeWorkspacePath(workspacePath);
    const absolute = await resolveExisting(root, rel);
    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch (error) {
      throw mapFsError(error, rel);
    }
    if (!stat.isDirectory()) throw new AgentError("NOT_A_DIRECTORY", `Not a directory: ${rel}`);
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(absolute, { withFileTypes: true });
    } catch (error) {
      throw mapFsError(error, rel);
    }
    if (dirents.length > this.limits.maxListEntries) {
      throw new AgentError(
        "FILE_TOO_LARGE",
        `Directory has ${dirents.length} entries; the agent limit is ${this.limits.maxListEntries}.`,
      );
    }
    const entries: AgentEntry[] = [];
    for (const dirent of dirents) {
      const childAbsolute = path.join(absolute, dirent.name);
      const childRel = rel === "/" ? `/${dirent.name}` : `${rel}/${dirent.name}`;
      let kind: AgentEntry["kind"];
      let size: number | undefined;
      let mtimeMs: number | undefined;
      try {
        if (dirent.isSymbolicLink()) {
          // Only show links whose target is itself inside the workspace.
          const real = await fs.realpath(childAbsolute);
          assertInside(root, real);
          const target = await fs.stat(real);
          if (!target.isFile() && !target.isDirectory()) continue;
          kind = target.isDirectory() ? "directory" : "file";
          size = target.size;
          mtimeMs = target.mtimeMs;
        } else if (dirent.isDirectory()) {
          kind = "directory";
        } else if (dirent.isFile()) {
          kind = "file";
          const target = await fs.stat(childAbsolute);
          size = target.size;
          mtimeMs = target.mtimeMs;
        } else {
          continue;
        }
      } catch {
        // Broken links, permission errors on individual entries, and devices are
        // omitted rather than failing the whole listing.
        continue;
      }
      entries.push({
        name: dirent.name,
        path: childRel,
        kind,
        ...(size !== undefined ? { size } : {}),
        ...(mtimeMs !== undefined ? { mtimeMs } : {}),
      });
    }
    entries.sort(entrySort);
    return entries;
  }

  async readFile(id: string, workspacePath: unknown): Promise<AgentFile> {
    const root = this.getRoot(id);
    const rel = normalizeWorkspacePath(workspacePath);
    const absolute = await resolveExisting(root, rel);
    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch (error) {
      throw mapFsError(error, rel);
    }
    if (stat.isDirectory()) throw new AgentError("IS_A_DIRECTORY", `Is a directory: ${rel}`);
    if (stat.size > this.limits.maxReadBytes) {
      throw new AgentError(
        "FILE_TOO_LARGE",
        `File is ${stat.size} bytes; the agent read limit is ${this.limits.maxReadBytes} bytes.`,
      );
    }
    let content: string;
    try {
      content = await fs.readFile(absolute, "utf8");
    } catch (error) {
      throw mapFsError(error, rel);
    }
    return { path: rel, content, size: stat.size, mtimeMs: stat.mtimeMs };
  }

  async writeFile(id: string, workspacePath: unknown, content: unknown): Promise<AgentEntry> {
    const root = this.getRoot(id);
    const rel = normalizeWorkspacePath(workspacePath);
    if (typeof content !== "string")
      throw new AgentError("INVALID_REQUEST", "File content must be a string");
    if (Buffer.byteLength(content, "utf8") > this.limits.maxWriteBytes) {
      throw new AgentError(
        "FILE_TOO_LARGE",
        `Content exceeds the agent write limit of ${this.limits.maxWriteBytes} bytes.`,
      );
    }
    const absolute = this.absolute(root, rel);
    let existing: string | null = null;
    try {
      existing = await resolveExisting(root, rel);
    } catch (error) {
      if (!(error instanceof AgentError) || error.code !== "NOT_FOUND") throw error;
      await resolveForCreate(root, rel);
    }
    if (existing) {
      const stat = await fs.stat(existing).catch((error: unknown) => {
        throw mapFsError(error, rel);
      });
      if (stat.isDirectory()) throw new AgentError("IS_A_DIRECTORY", `Is a directory: ${rel}`);
    }
    try {
      await fs.writeFile(absolute, content, "utf8");
      const stat = await fs.stat(absolute);
      return {
        name: path.basename(absolute),
        path: rel,
        kind: "file",
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    } catch (error) {
      throw mapFsError(error, rel);
    }
  }

  async createFile(id: string, workspacePath: unknown, content: unknown = ""): Promise<AgentEntry> {
    const root = this.getRoot(id);
    const rel = normalizeWorkspacePath(workspacePath);
    if (rel === "/")
      throw new AgentError("INVALID_PATH", "Cannot create a file at the workspace root");
    if (typeof content !== "string")
      throw new AgentError("INVALID_REQUEST", "File content must be a string");
    if (Buffer.byteLength(content, "utf8") > this.limits.maxWriteBytes) {
      throw new AgentError("FILE_TOO_LARGE", "Content exceeds the agent write limit.");
    }
    const absolute = this.absolute(root, rel);
    try {
      await fs.lstat(absolute);
      throw new AgentError("ALREADY_EXISTS", `Already exists: ${rel}`);
    } catch (error) {
      if (error instanceof AgentError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw mapFsError(error, rel);
    }
    await resolveForCreate(root, rel);
    try {
      await fs.writeFile(absolute, content, { encoding: "utf8", flag: "wx" });
      const stat = await fs.stat(absolute);
      return {
        name: path.basename(absolute),
        path: rel,
        kind: "file",
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    } catch (error) {
      throw mapFsError(error, rel);
    }
  }

  async createFolder(id: string, workspacePath: unknown): Promise<AgentEntry> {
    const root = this.getRoot(id);
    const rel = normalizeWorkspacePath(workspacePath);
    if (rel === "/") throw new AgentError("ALREADY_EXISTS", "The workspace root already exists");
    const absolute = this.absolute(root, rel);
    try {
      await fs.lstat(absolute);
      throw new AgentError("ALREADY_EXISTS", `Already exists: ${rel}`);
    } catch (error) {
      if (error instanceof AgentError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw mapFsError(error, rel);
    }
    await resolveForCreate(root, rel);
    try {
      await fs.mkdir(absolute);
      const stat = await fs.stat(absolute);
      return { name: path.basename(absolute), path: rel, kind: "directory", mtimeMs: stat.mtimeMs };
    } catch (error) {
      throw mapFsError(error, rel);
    }
  }

  async rename(id: string, fromInput: unknown, toInput: unknown): Promise<AgentEntry> {
    const root = this.getRoot(id);
    const from = normalizeWorkspacePath(fromInput);
    const to = normalizeWorkspacePath(toInput);
    if (from === "/" || to === "/")
      throw new AgentError("INVALID_PATH", "Cannot rename the workspace root");
    if (from === to) {
      const stat = await this.stat(id, to);
      if (!stat) throw new AgentError("NOT_FOUND", `Not found: ${from}`);
      return stat;
    }
    const source = this.absolute(root, from);
    let sourceStat;
    try {
      sourceStat = await fs.lstat(source);
    } catch (error) {
      throw mapFsError(error, from);
    }
    // A symlink is moved as a link; still verify its target is not an escape.
    if (sourceStat.isSymbolicLink()) {
      try {
        const real = await fs.realpath(source);
        assertInside(root, real);
      } catch (error) {
        if (error instanceof AgentError) throw error;
        throw mapFsError(error, from);
      }
    } else {
      assertInside(root, await fs.realpath(source));
    }
    const destination = this.absolute(root, to);
    if (isPathInside(source, destination)) {
      throw new AgentError("INVALID_REQUEST", "Cannot move a folder inside itself");
    }
    try {
      await fs.lstat(destination);
      throw new AgentError("ALREADY_EXISTS", `Already exists: ${to}`);
    } catch (error) {
      if (error instanceof AgentError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw mapFsError(error, to);
    }
    await resolveForCreate(root, to);
    try {
      await fs.rename(source, destination);
      const stat = await fs.lstat(destination);
      return {
        name: path.basename(destination),
        path: to,
        kind: stat.isDirectory() ? "directory" : "file",
        ...(stat.isFile() ? { size: stat.size } : {}),
        mtimeMs: stat.mtimeMs,
      };
    } catch (error) {
      throw mapFsError(error, from);
    }
  }

  async delete(
    id: string,
    workspacePath: unknown,
    options: { recursive?: boolean } = {},
  ): Promise<void> {
    const root = this.getRoot(id);
    const rel = normalizeWorkspacePath(workspacePath);
    if (rel === "/") throw new AgentError("INVALID_PATH", "Cannot delete the workspace root");
    const absolute = this.absolute(root, rel);
    let stat;
    try {
      stat = await fs.lstat(absolute);
    } catch (error) {
      throw mapFsError(error, rel);
    }
    if (stat.isSymbolicLink()) {
      assertInside(root, await fs.realpath(absolute).catch(() => root));
    } else if (stat.isDirectory()) {
      assertInside(root, await fs.realpath(absolute));
      if (!options.recursive) {
        throw new AgentError("IS_A_DIRECTORY", "Directory delete requires recursive=true");
      }
    }
    try {
      await fs.rm(absolute, {
        recursive: Boolean(options.recursive),
        force: false,
        maxRetries: 2,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_FS_EISDIR" && stat.isDirectory()) {
        throw new AgentError("IS_A_DIRECTORY", "Directory delete requires recursive=true");
      }
      throw mapFsError(error, rel);
    }
  }

  async stat(id: string, workspacePath: unknown): Promise<AgentEntry | null> {
    const root = this.getRoot(id);
    const rel = normalizeWorkspacePath(workspacePath);
    if (rel === "/") return { name: this.getRecord(id).summary.name, path: "/", kind: "directory" };
    let absolute: string;
    try {
      absolute = await resolveExisting(root, rel);
    } catch (error) {
      if (error instanceof AgentError && error.code === "NOT_FOUND") return null;
      throw error;
    }
    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw mapFsError(error, rel);
    }
    return {
      name: path.basename(absolute),
      path: rel,
      kind: stat.isDirectory() ? "directory" : "file",
      ...(stat.isFile() ? { size: stat.size } : {}),
      mtimeMs: stat.mtimeMs,
    };
  }

  async exists(id: string, workspacePath: unknown): Promise<boolean> {
    return (await this.stat(id, workspacePath)) !== null;
  }

  async getAllFiles(id: string): Promise<{ files: string[]; truncated: boolean }> {
    const root = this.getRoot(id);
    const files: string[] = [];
    let truncated = false;

    const walk = async (absoluteDir: string, relDir: string): Promise<void> => {
      if (truncated) return;
      let dirents: Dirent[];
      try {
        dirents = await fs.readdir(absoluteDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const dirent of dirents) {
        if (files.length >= this.limits.maxFiles) {
          truncated = true;
          return;
        }
        const childRel = relDir === "/" ? `/${dirent.name}` : `${relDir}/${dirent.name}`;
        if (dirent.isSymbolicLink()) continue;
        if (dirent.isDirectory()) {
          if (SKIP_WALK_DIRS.has(dirent.name)) continue;
          await walk(path.join(absoluteDir, dirent.name), childRel);
        } else if (dirent.isFile()) {
          files.push(childRel);
        }
      }
    };

    await walk(root, "/");
    files.sort((a, b) => a.localeCompare(b));
    return { files, truncated };
  }

  /** Resolve a workspace-relative directory for a terminal's initial cwd. */
  async resolveDirectory(
    id: string,
    workspacePath: unknown,
  ): Promise<{ absolute: string; rel: string }> {
    const root = this.getRoot(id);
    const rel = normalizeWorkspacePath(workspacePath);
    const absolute = await resolveExisting(root, rel);
    const stat = await fs.stat(absolute);
    if (!stat.isDirectory()) throw new AgentError("NOT_A_DIRECTORY", `Not a directory: ${rel}`);
    return { absolute, rel };
  }

  relativePath(id: string, absolute: string): string {
    return toWorkspacePath(this.getRoot(id), absolute);
  }

  /** Resolve a workspace-relative path that must already exist. */
  async resolveExistingPath(
    id: string,
    workspacePath: unknown,
  ): Promise<{
    absolute: string;
    rel: string;
  }> {
    const root = this.getRoot(id);
    const rel = normalizeWorkspacePath(workspacePath);
    const absolute = await resolveExisting(root, rel);
    return { absolute, rel };
  }
}
