"use client";

import {
  basename,
  normalizePath,
  WorkspaceError,
  type FileSystemDirectoryHandleLike,
  type WorkspaceEntry,
  type WorkspaceService,
} from "./types";

export class FsAccessWorkspace implements WorkspaceService {
  readonly id: string;
  readonly name: string;
  readonly isNative = true;
  readonly rootHandle: FileSystemDirectoryHandleLike;

  constructor(handle: FileSystemDirectoryHandleLike) {
    this.rootHandle = handle;
    this.name = handle.name || "Workspace";
    this.id = `fs-${handle.name}-${Date.now()}`;
  }

  async ensurePermission(mode: "read" | "readwrite" = "readwrite"): Promise<boolean> {
    const h = this.rootHandle as unknown as {
      queryPermission?: (opts: { mode: string }) => Promise<PermissionState>;
      requestPermission?: (opts: { mode: string }) => Promise<PermissionState>;
    };
    try {
      if (h.queryPermission) {
        const q = await h.queryPermission({ mode });
        if (q === "granted") return true;
      }
      if (h.requestPermission) {
        const r = await h.requestPermission({ mode });
        return r === "granted";
      }
      return true;
    } catch {
      return true;
    }
  }

  private splitPath(path: string): string[] {
    const n = normalizePath(path);
    if (n === "/") return [];
    return n.split("/").filter(Boolean);
  }

  private async traverseTo(
    path: string,
    createMissing = false,
  ): Promise<{
    parent: FileSystemDirectoryHandleLike;
    name: string | null;
    handle: FileSystemDirectoryHandleLike | null;
  }> {
    const parts = this.splitPath(path);
    if (parts.length === 0) {
      return { parent: this.rootHandle, name: null, handle: this.rootHandle };
    }
    let current: FileSystemDirectoryHandleLike = this.rootHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!;
      try {
        current = await current.getDirectoryHandle(seg, { create: createMissing });
      } catch {
        throw new WorkspaceError(`Folder not found: ${seg}`, "NOT_FOUND");
      }
    }
    const finalName = parts[parts.length - 1]!;
    return { parent: current, name: finalName, handle: null };
  }

  private async getHandleForPath(
    path: string,
  ): Promise<FileSystemDirectoryHandleLike | import("./types").FileSystemFileHandleLike | null> {
    const n = normalizePath(path);
    if (n === "/") return this.rootHandle;
    const parts = this.splitPath(n);
    let cur: FileSystemDirectoryHandleLike = this.rootHandle;
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]!;
      const isLast = i === parts.length - 1;
      // Try directory first
      try {
        const dir = await cur.getDirectoryHandle(seg);
        if (isLast) return dir;
        cur = dir;
        continue;
      } catch {
        // Not a directory, try file if last
        if (isLast) {
          try {
            const fh = await cur.getFileHandle(seg);
            return fh;
          } catch {
            return null;
          }
        }
        return null;
      }
    }
    return cur;
  }

  async list(path: string): Promise<WorkspaceEntry[]> {
    const n = normalizePath(path);
    let dir: FileSystemDirectoryHandleLike;
    if (n === "/") {
      dir = this.rootHandle;
    } else {
      const h = await this.getHandleForPath(n);
      if (!h || h.kind !== "directory") {
        throw new WorkspaceError(`Directory not found: ${path}`, "NOT_FOUND");
      }
      dir = h as FileSystemDirectoryHandleLike;
    }
    const entries: WorkspaceEntry[] = [];
    for await (const [name, handle] of dir.entries()) {
      const kind = (handle as { kind: string }).kind as "file" | "directory";
      const entryPath = n === "/" ? `/${name}` : `${n}/${name}`;
      entries.push({ name, path: entryPath, kind });
    }
    // Sort directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  async readFile(path: string): Promise<string> {
    const n = normalizePath(path);
    const h = await this.getHandleForPath(n);
    if (!h || h.kind !== "file") {
      throw new WorkspaceError(`File not found: ${path}`, "NOT_FOUND");
    }
    const file = await (h as import("./types").FileSystemFileHandleLike).getFile();
    return await file.text();
  }

  async writeFile(path: string, content: string): Promise<void> {
    const n = normalizePath(path);
    const { parent, name } = await this.traverseTo(n, false);
    if (!name) throw new WorkspaceError("Cannot write to root", "UNKNOWN");
    let fh: import("./types").FileSystemFileHandleLike;
    try {
      fh = await parent.getFileHandle(name, { create: true });
    } catch {
      throw new WorkspaceError(`Cannot create file: ${path}`, "UNKNOWN");
    }
    const writable = await fh.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async createFile(path: string, content = ""): Promise<void> {
    const n = normalizePath(path);
    if (await this.exists(n)) {
      throw new WorkspaceError(`Already exists: ${path}`, "ALREADY_EXISTS");
    }
    const { parent, name } = await this.traverseTo(n, true);
    if (!name) throw new WorkspaceError("Invalid path", "UNKNOWN");
    const fh = await parent.getFileHandle(name, { create: true });
    if (content) {
      const w = await fh.createWritable();
      await w.write(content);
      await w.close();
    } else {
      const w = await fh.createWritable();
      await w.write("");
      await w.close();
    }
  }

  async createFolder(path: string): Promise<void> {
    const n = normalizePath(path);
    if (n === "/") return;
    if (await this.exists(n)) {
      throw new WorkspaceError(`Already exists: ${path}`, "ALREADY_EXISTS");
    }
    const { parent, name } = await this.traverseTo(n, true);
    if (!name) return;
    await parent.getDirectoryHandle(name, { create: true });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const o = normalizePath(oldPath);
    const n = normalizePath(newPath);
    if (o === n) return;
    if (o === "/") throw new WorkspaceError("Cannot rename root", "UNKNOWN");
    // Read old
    const oldHandle = await this.getHandleForPath(o);
    if (!oldHandle) throw new WorkspaceError(`Not found: ${oldPath}`, "NOT_FOUND");
    if (await this.exists(n)) {
      throw new WorkspaceError(`Already exists: ${newPath}`, "ALREADY_EXISTS");
    }

    if (oldHandle.kind === "file") {
      const content = await this.readFile(o);
      await this.createFile(n, content);
      await this.delete(o);
    } else {
      // Directory: need to recursively copy
      await this.createFolder(n);
      const entries = await this.list(o);
      for (const e of entries) {
        await this.rename(e.path, `${n}/${e.name}`);
      }
      await this.delete(o, { recursive: true });
    }
  }

  async delete(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const n = normalizePath(path);
    if (n === "/") throw new WorkspaceError("Cannot delete root", "UNKNOWN");
    const { parent, name } = await this.traverseTo(n, false);
    if (!name) throw new WorkspaceError("Invalid path", "UNKNOWN");
    try {
      await parent.removeEntry(name, { recursive: opts?.recursive ?? false });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("directory not empty") || msg.includes("not empty")) {
        throw new WorkspaceError("Directory not empty. Use recursive delete.", "UNKNOWN");
      }
      throw new WorkspaceError(msg, "UNKNOWN");
    }
  }

  async exists(path: string): Promise<boolean> {
    const h = await this.getHandleForPath(normalizePath(path));
    return h !== null;
  }

  async stat(path: string): Promise<WorkspaceEntry | null> {
    const n = normalizePath(path);
    if (n === "/") {
      return { name: "/", path: "/", kind: "directory" };
    }
    const h = await this.getHandleForPath(n);
    if (!h) return null;
    return { name: basename(n), path: n, kind: h.kind as "file" | "directory" };
  }

  async getAllFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dirPath: string) => {
      let entries: WorkspaceEntry[];
      try {
        entries = await this.list(dirPath);
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.kind === "file") out.push(e.path);
        else await walk(e.path);
      }
    };
    await walk("/");
    return out;
  }
}

export async function openNativeFolder(): Promise<FsAccessWorkspace | null> {
  const w = window as unknown as {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
  };
  if (!w.showDirectoryPicker) return null;
  try {
    const handle = await w.showDirectoryPicker();
    const ws = new FsAccessWorkspace(handle);
    const ok = await ws.ensurePermission("readwrite");
    if (!ok) {
      throw new WorkspaceError("Permission denied", "PERMISSION_DENIED");
    }
    return ws;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

export function isFsAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}
