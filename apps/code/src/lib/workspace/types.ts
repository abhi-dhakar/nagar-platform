export type EntryKind = "file" | "directory";

export type WorkspaceEntry = {
  name: string;
  path: string;
  kind: EntryKind;
};

export type FileSystemDirectoryHandleLike = {
  kind: "directory";
  name: string;
  getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FileSystemFileHandleLike>;
  getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandleLike>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, FileSystemHandleLike]>;
  keys(): AsyncIterable<string>;
  values(): AsyncIterable<FileSystemHandleLike>;
  queryPermission?(opts?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(opts?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
};

export type FileSystemFileHandleLike = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
};

export type FileSystemHandleLike =
  | FileSystemDirectoryHandleLike
  | FileSystemFileHandleLike;

export type FileSystemWritableFileStreamLike = {
  write(data: string | BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
};

export interface WorkspaceService {
  readonly id: string;
  readonly name: string;
  readonly isNative: boolean;
  readonly rootHandle: FileSystemDirectoryHandleLike | null;

  list(path: string): Promise<WorkspaceEntry[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createFile(path: string, content?: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  delete(path: string, opts?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<WorkspaceEntry | null>;
  getAllFiles(): Promise<string[]>;

  // For FS Access permission handling
  ensurePermission?(mode?: "read" | "readwrite"): Promise<boolean>;
}

export type WorkspaceErrorCode =
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "PERMISSION_DENIED"
  | "NOT_SUPPORTED"
  | "UNKNOWN";

export class WorkspaceError extends Error {
  code: WorkspaceErrorCode;
  constructor(message: string, code: WorkspaceErrorCode = "UNKNOWN") {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

export function normalizePath(p: string): string {
  if (!p) return "/";
  let out = p.replace(/\\/g, "/");
  if (!out.startsWith("/")) out = "/" + out;
  out = out.replace(/\/+/g, "/");
  if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out || "/";
}

export function joinPath(base: string, name: string): string {
  if (base === "/") return `/${name}`;
  return `${normalizePath(base)}/${name}`;
}

export function dirname(path: string): string {
  const n = normalizePath(path);
  if (n === "/") return "/";
  const idx = n.lastIndexOf("/");
  if (idx === 0) return "/";
  return n.slice(0, idx);
}

export function basename(path: string): string {
  const n = normalizePath(path);
  if (n === "/") return "/";
  return n.slice(n.lastIndexOf("/") + 1);
}

export function parentPaths(path: string): string[] {
  const n = normalizePath(path);
  const parts = n.split("/").filter(Boolean);
  const out: string[] = ["/"];
  let cur = "";
  for (let i = 0; i < parts.length - 1; i++) {
    cur += "/" + parts[i];
    out.push(cur);
  }
  return out;
}
