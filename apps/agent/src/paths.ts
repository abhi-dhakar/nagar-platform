import { promises as fs } from "node:fs";
import path from "node:path";
import { AgentError, mapFsError } from "./errors.js";

/**
 * All browser-facing paths are workspace-relative POSIX paths ("/src/app.ts").
 * The agent never accepts an absolute path from a workspace operation; the
 * workspace root is prepended here.
 */

export function normalizeWorkspacePath(input: unknown): string {
  if (input === undefined || input === null || input === "") return "/";
  if (typeof input !== "string") {
    throw new AgentError("INVALID_PATH", "Path must be a string");
  }
  if (input.includes("\0")) {
    throw new AgentError("INVALID_PATH", "Path contains a null byte");
  }
  // Backslashes are ambiguous across platforms; the UI and protocol use "/".
  if (input.includes("\\")) {
    throw new AgentError("INVALID_PATH", "Use forward slashes in workspace paths");
  }
  const prefixed = input.startsWith("/") ? input : `/${input}`;
  const segments = prefixed.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new AgentError("PATH_OUTSIDE_WORKSPACE", "Path may not contain '..' segments");
  }
  if (process.platform === "win32" && segments.some((segment) => /^[a-zA-Z]:/.test(segment))) {
    throw new AgentError("INVALID_PATH", "Path may not contain a drive letter");
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === "") return true;
  if (relative.startsWith(`..${path.sep}`) || relative === "..") return false;
  if (path.isAbsolute(relative)) return false;
  if (process.platform === "win32") {
    // path.relative is case-insensitive on Windows, but be explicit about drives.
    if (path.parse(root).root.toLowerCase() !== path.parse(candidate).root.toLowerCase())
      return false;
  }
  return true;
}

export function assertInside(root: string, candidate: string): void {
  if (!isInside(root, candidate)) {
    throw new AgentError("PATH_OUTSIDE_WORKSPACE", "Path escapes the opened workspace");
  }
}

export function toAbsolute(rootReal: string, workspacePath: string): string {
  const normalized = normalizeWorkspacePath(workspacePath);
  const candidate = path.resolve(rootReal, `.${normalized}`);
  assertInside(rootReal, candidate);
  return candidate;
}

/**
 * Resolve an existing path and require both the literal path and its real path
 * (after following every symlink) to stay inside the workspace root.
 */
export async function resolveExisting(rootReal: string, workspacePath: string): Promise<string> {
  const absolute = toAbsolute(rootReal, workspacePath);
  let real: string;
  try {
    real = await fs.realpath(absolute);
  } catch (error) {
    throw mapFsError(error, workspacePath);
  }
  assertInside(rootReal, real);
  return real;
}

/**
 * Resolve a path that is about to be created. The parent directory must exist;
 * its real path is checked so a symlinked directory cannot escape the root.
 */
export async function resolveForCreate(
  rootReal: string,
  workspacePath: string,
): Promise<{
  absolute: string;
  parentReal: string;
}> {
  const absolute = toAbsolute(rootReal, workspacePath);
  const parent = path.dirname(absolute);
  let parentReal: string;
  try {
    parentReal = await fs.realpath(parent);
  } catch (error) {
    throw mapFsError(error, workspacePath);
  }
  assertInside(rootReal, parentReal);
  if (parentReal === rootReal && absolute === rootReal) {
    throw new AgentError("INVALID_PATH", "Cannot operate on the workspace root");
  }
  return { absolute, parentReal };
}

/** Convert an absolute path inside a workspace to its "/a/b" browser form. */
export function toWorkspacePath(rootReal: string, absolute: string): string {
  const relative = path.relative(rootReal, absolute);
  if (!relative) return "/";
  assertInside(rootReal, absolute);
  return `/${relative.split(path.sep).join("/")}`;
}

export function isPathInside(root: string, candidate: string): boolean {
  return isInside(root, candidate);
}

export function compareRoots(a: string, b: string): boolean {
  if (process.platform === "win32") return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

export function assertAbsoluteDirectoryInput(input: unknown): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new AgentError("INVALID_REQUEST", "An absolute directory path is required");
  }
  if (input.includes("\0")) {
    throw new AgentError("INVALID_PATH", "Path contains a null byte");
  }
  const resolved = path.resolve(input.trim());
  if (!path.isAbsolute(resolved)) {
    throw new AgentError("INVALID_PATH", "The path must be absolute");
  }
  return resolved;
}

/**
 * A configured executable may be an absolute path or a command name resolved
 * through PATH. It is never passed through a shell.
 */
export function assertCommandLike(input: unknown): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new AgentError("INVALID_REQUEST", "Command must be a non-empty string");
  }
  const value = input.trim();
  if (value.includes("\0") || /[\r\n]/.test(value)) {
    throw new AgentError("INVALID_PATH", "Command contains invalid characters");
  }
  if (path.isAbsolute(value) || !/[/\\]/.test(value)) return value;
  throw new AgentError("INVALID_PATH", "Command must be absolute or a PATH lookup name");
}
