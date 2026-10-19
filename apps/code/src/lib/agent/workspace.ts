"use client";

import type { WorkspaceSummary } from "@nagar/agent-protocol";
import {
  basename,
  normalizePath,
  WorkspaceError,
  type WorkspaceEntry,
  type WorkspaceService,
} from "../workspace/types";
import { AgentClient, AgentClientError } from "./client";

function mapError(error: unknown, action: string): WorkspaceError {
  if (error instanceof AgentClientError) {
    switch (error.code) {
      case "NOT_FOUND":
        return new WorkspaceError(error.message, "NOT_FOUND");
      case "ALREADY_EXISTS":
        return new WorkspaceError(error.message, "ALREADY_EXISTS");
      case "PERMISSION_DENIED":
      case "FORBIDDEN_PATH":
      case "PATH_OUTSIDE_WORKSPACE":
        return new WorkspaceError(error.message, "PERMISSION_DENIED");
      case "FILE_TOO_LARGE":
      case "PAYLOAD_TOO_LARGE":
        return new WorkspaceError(error.message, "UNKNOWN");
      case "AGENT_UNREACHABLE":
        return new WorkspaceError(
          `${error.message} — the local agent is unreachable. Start it and reconnect.`,
          "UNKNOWN",
        );
      case "UNAUTHORIZED":
        return new WorkspaceError(
          `${error.message} — the agent token was rejected. Reconnect with the current token.`,
          "UNKNOWN",
        );
      default:
        return new WorkspaceError(error.message, "UNKNOWN");
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return new WorkspaceError(`Could not ${action}: ${message}`, "UNKNOWN");
}

/**
 * WorkspaceService backed by the loopback agent. The rest of the IDE keeps
 * using the same interface as the File System Access and in-memory backends.
 */
export class AgentWorkspace implements WorkspaceService {
  readonly id: string;
  readonly name: string;
  readonly isNative = true;
  readonly rootHandle = null;
  readonly backend = "agent" as const;
  readonly root: string;
  readonly summary: WorkspaceSummary;
  private readonly client: AgentClient;

  constructor(client: AgentClient, summary: WorkspaceSummary) {
    this.client = client;
    this.summary = summary;
    this.id = `agent-${summary.id}`;
    this.name = summary.name;
    this.root = summary.root;
  }

  async list(path: string): Promise<WorkspaceEntry[]> {
    const normalized = normalizePath(path);
    try {
      const entries = await this.client.listEntries(this.summary.id, normalized);
      return entries.map((entry) => ({ name: entry.name, path: entry.path, kind: entry.kind }));
    } catch (error) {
      throw mapError(error, `list ${normalized}`);
    }
  }

  async readFile(path: string): Promise<string> {
    try {
      const file = await this.client.readFile(this.summary.id, normalizePath(path));
      return file.content;
    } catch (error) {
      throw mapError(error, `read ${path}`);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    try {
      await this.client.writeFile(this.summary.id, normalizePath(path), content);
    } catch (error) {
      throw mapError(error, `save ${path}`);
    }
  }

  async createFile(path: string, content = ""): Promise<void> {
    try {
      await this.client.createFile(this.summary.id, normalizePath(path), content);
    } catch (error) {
      throw mapError(error, `create ${path}`);
    }
  }

  async createFolder(path: string): Promise<void> {
    try {
      await this.client.createFolder(this.summary.id, normalizePath(path));
    } catch (error) {
      throw mapError(error, `create folder ${path}`);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    try {
      await this.client.rename(this.summary.id, normalizePath(oldPath), normalizePath(newPath));
    } catch (error) {
      throw mapError(error, `rename ${oldPath}`);
    }
  }

  async delete(path: string, opts?: { recursive?: boolean }): Promise<void> {
    try {
      await this.client.deleteEntry(this.summary.id, normalizePath(path), opts?.recursive ?? false);
    } catch (error) {
      throw mapError(error, `delete ${path}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      return await this.client.exists(this.summary.id, normalizePath(path));
    } catch (error) {
      throw mapError(error, `check ${path}`);
    }
  }

  async stat(path: string): Promise<WorkspaceEntry | null> {
    const normalized = normalizePath(path);
    if (normalized === "/") return { name: this.summary.name, path: "/", kind: "directory" };
    try {
      const entry = await this.client.stat(this.summary.id, normalized);
      if (!entry) return null;
      return { name: entry.name || basename(normalized), path: entry.path, kind: entry.kind };
    } catch (error) {
      throw mapError(error, `stat ${normalized}`);
    }
  }

  async getAllFiles(): Promise<string[]> {
    try {
      const result = await this.client.getAllFiles(this.summary.id);
      return result.files;
    } catch (error) {
      throw mapError(error, "list workspace files");
    }
  }

  async ensurePermission(): Promise<boolean> {
    return true;
  }
}
