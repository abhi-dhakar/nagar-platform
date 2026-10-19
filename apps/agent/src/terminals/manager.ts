import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
import type { WebSocket } from "ws";
import type {
  RuntimeId,
  ShellInfo,
  TerminalClientMessage,
  TerminalServerMessage,
  TerminalSessionInfo,
} from "@nagar/agent-protocol";
import { AgentError } from "../errors.js";
import { loadPty, type PtyProcess } from "./pty.js";
import { fallbackShellArgs, shellArgs } from "./shells.js";

const MAX_BUFFER_CHARS = 200_000;
const MAX_INPUT_CHARS = 64 * 1024;
const EXIT_RETENTION_MS = 5 * 60_000;

type Session = {
  info: TerminalSessionInfo;
  buffer: string;
  clients: Set<WebSocket>;
  pty: boolean;
  ptyProcess: PtyProcess | null;
  child: ChildProcess | null;
  cleanup: (() => Promise<void>) | undefined;
  closed: boolean;
  exited: boolean;
  killTimer: NodeJS.Timeout | null;
  reapTimer: NodeJS.Timeout | null;
  lastDetachedAt: number;
  exitedAt: number | null;
};

export type TerminalManagerOptions = {
  maxTerminals: number;
  disablePty: boolean;
  idleMinutes: number;
  onLog?: (message: string) => void;
};

export type CreateShellParams = {
  workspaceId: string;
  shell: ShellInfo;
  cwd: string;
  cwdRel: string;
  cols: number;
  rows: number;
};

export type CreateRunParams = {
  workspaceId: string;
  runtime: RuntimeId;
  runtimeLabel: string;
  filePath: string;
  command: string;
  args: string[];
  cwd: string;
  cwdRel: string;
  env: NodeJS.ProcessEnv;
  commandLine: string;
  cleanup?: () => Promise<void>;
  cols: number;
  rows: number;
};

export function normalizeTerminalSize(
  cols: unknown,
  rows: unknown,
): { cols: number; rows: number } {
  const normalizedCols = typeof cols === "number" ? cols : Number(cols ?? 80);
  const normalizedRows = typeof rows === "number" ? rows : Number(rows ?? 24);
  if (!Number.isFinite(normalizedCols) || !Number.isFinite(normalizedRows)) {
    return { cols: 80, rows: 24 };
  }
  return {
    cols: Math.max(2, Math.min(500, Math.round(normalizedCols))),
    rows: Math.max(2, Math.min(200, Math.round(normalizedRows))),
  };
}

function terminalEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "NagarCode",
    NAGARCODE_AGENT: "1",
    ...extra,
  };
}

export class TerminalManager {
  private readonly sessions = new Map<string, Session>();
  private readonly options: TerminalManagerOptions;
  private readonly idleTimer: NodeJS.Timeout;

  constructor(options: TerminalManagerOptions) {
    this.options = options;
    this.idleTimer = setInterval(() => this.reapIdle(), 60_000);
    this.idleTimer.unref?.();
  }

  get ptyAvailable(): boolean {
    return loadPty(this.options.disablePty).available;
  }

  get ptyReason(): string | undefined {
    return loadPty(this.options.disablePty).reason;
  }

  get activeCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) if (!session.exited) count += 1;
    return count;
  }

  get limit(): number {
    return this.options.maxTerminals;
  }

  list(workspaceId?: string): TerminalSessionInfo[] {
    return [...this.sessions.values()]
      .filter((session) => !workspaceId || session.info.workspaceId === workspaceId)
      .sort((a, b) => a.info.createdAt.localeCompare(b.info.createdAt))
      .map((session) => ({ ...session.info }));
  }

  get(id: string): TerminalSessionInfo {
    return { ...this.mustGet(id).info };
  }

  private mustGet(id: string): Session {
    const session = this.sessions.get(id);
    if (!session)
      throw new AgentError("SESSION_NOT_FOUND", "That terminal session no longer exists.");
    return session;
  }

  private createSessionInfo(
    base: Omit<
      TerminalSessionInfo,
      "id" | "createdAt" | "status" | "exitCode" | "signal" | "cols" | "rows"
    >,
    cols: number,
    rows: number,
  ): TerminalSessionInfo {
    return {
      ...base,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: "running",
      exitCode: null,
      signal: null,
      cols,
      rows,
    };
  }

  private assertCapacity(): void {
    if (this.activeCount >= this.options.maxTerminals) {
      throw new AgentError(
        "TOO_MANY_SESSIONS",
        `The agent allows ${this.options.maxTerminals} terminal sessions at once. Close one and try again.`,
      );
    }
  }

  async createShell(params: CreateShellParams): Promise<TerminalSessionInfo> {
    this.assertCapacity();
    const size = normalizeTerminalSize(params.cols, params.rows);
    const info = this.createSessionInfo(
      {
        kind: "shell",
        title: params.shell.label,
        workspaceId: params.workspaceId,
        cwd: params.cwd,
        cwdRel: params.cwdRel,
        shellId: params.shell.id,
        shellLabel: params.shell.label,
        pty: this.ptyAvailable,
        commandLine: params.shell.path,
      },
      size.cols,
      size.rows,
    );
    const session = this.register(info);
    this.spawnShell(session, params.shell);
    return { ...session.info };
  }

  async createRun(params: CreateRunParams): Promise<TerminalSessionInfo> {
    this.assertCapacity();
    const size = normalizeTerminalSize(params.cols, params.rows);
    const info = this.createSessionInfo(
      {
        kind: "run",
        title: `Run ${path.basename(params.filePath)}`,
        workspaceId: params.workspaceId,
        cwd: params.cwd,
        cwdRel: params.cwdRel,
        shellId: params.runtime,
        shellLabel: params.runtimeLabel,
        pty: this.ptyAvailable,
        runtime: params.runtime,
        filePath: params.filePath,
        commandLine: params.commandLine,
      },
      size.cols,
      size.rows,
    );
    const session = this.register(info);
    session.cleanup = params.cleanup;
    this.spawnRun(session, params);
    return { ...session.info };
  }

  private register(info: TerminalSessionInfo): Session {
    const session: Session = {
      info,
      buffer: "",
      clients: new Set(),
      pty: false,
      ptyProcess: null,
      child: null,
      cleanup: undefined,
      closed: false,
      exited: false,
      killTimer: null,
      reapTimer: null,
      lastDetachedAt: Date.now(),
      exitedAt: null,
    };
    this.sessions.set(info.id, session);
    return session;
  }

  private spawnShell(session: Session, shell: ShellInfo): void {
    const cwd = session.info.cwd;
    const env = terminalEnv();
    const loaded = loadPty(this.options.disablePty);
    if (loaded.available && loaded.module) {
      try {
        const process = loaded.module.spawn(shell.path, shellArgs(shell), {
          name: "xterm-256color",
          cols: session.info.cols,
          rows: session.info.rows,
          cwd,
          env,
        });
        session.pty = true;
        session.info.pty = true;
        session.ptyProcess = process;
        process.onData((data) => this.appendData(session, data));
        process.onExit(({ exitCode, signal }) => this.finish(session, exitCode, signal ?? null));
        return;
      } catch (error) {
        this.options.onLog?.(
          `PTY spawn failed (${error instanceof Error ? error.message : String(error)}); using pipes.`,
        );
      }
    }
    try {
      const child = spawn(shell.path, fallbackShellArgs(shell), {
        cwd,
        env,
        stdio: "pipe",
        detached: process.platform !== "win32",
        windowsHide: true,
      });
      this.attachChild(session, child);
    } catch (error) {
      this.fail(
        session,
        `Could not start ${shell.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private spawnRun(session: Session, params: CreateRunParams): void {
    const env = terminalEnv(params.env);
    const loaded = loadPty(this.options.disablePty);
    if (loaded.available && loaded.module) {
      try {
        const process = loaded.module.spawn(params.command, params.args, {
          name: "xterm-256color",
          cols: session.info.cols,
          rows: session.info.rows,
          cwd: params.cwd,
          env,
        });
        session.pty = true;
        session.info.pty = true;
        session.ptyProcess = process;
        process.onData((data) => this.appendData(session, data));
        process.onExit(({ exitCode, signal }) => this.finish(session, exitCode, signal ?? null));
        return;
      } catch (error) {
        this.options.onLog?.(
          `PTY spawn failed (${error instanceof Error ? error.message : String(error)}); using pipes.`,
        );
      }
    }
    try {
      const child = spawn(params.command, params.args, {
        cwd: params.cwd,
        env,
        stdio: "pipe",
        detached: process.platform !== "win32",
        windowsHide: true,
      });
      this.attachChild(session, child);
    } catch (error) {
      this.fail(
        session,
        `Could not start ${params.command}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private attachChild(session: Session, child: ChildProcess): void {
    session.child = child;
    const stdout = new StringDecoder("utf8");
    const stderr = new StringDecoder("utf8");
    child.stdout?.on("data", (chunk: Buffer) => this.appendData(session, stdout.write(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => this.appendData(session, stderr.write(chunk)));
    child.on("error", (error) => {
      this.fail(session, `Process error: ${error.message}`);
    });
    child.on("close", (code, signal) => {
      const remaining = stdout.end() + stderr.end();
      if (remaining) this.appendData(session, remaining);
      this.finish(session, code, signal);
    });
  }

  private appendData(session: Session, data: string): void {
    if (!data || session.closed) return;
    session.buffer += data;
    if (session.buffer.length > MAX_BUFFER_CHARS) {
      session.buffer = session.buffer.slice(-MAX_BUFFER_CHARS);
    }
    const message: TerminalServerMessage = { type: "data", data };
    const payload = JSON.stringify(message);
    for (const client of session.clients) {
      if (client.readyState === 1) {
        try {
          client.send(payload);
        } catch {
          // A dead socket is removed by its close handler.
        }
      }
    }
  }

  private fail(session: Session, message: string): void {
    this.sendToClients(session, { type: "error", code: "INTERNAL_ERROR", message });
    this.finish(session, 127, null);
  }

  private sendToClients(session: Session, message: TerminalServerMessage): void {
    const payload = JSON.stringify(message);
    for (const client of session.clients) {
      if (client.readyState === 1) {
        try {
          client.send(payload);
        } catch {
          // ignore
        }
      }
    }
  }

  private finish(session: Session, exitCode: number | null, signal: number | string | null): void {
    if (session.exited) return;
    session.exited = true;
    session.exitedAt = Date.now();
    session.info.status = "exited";
    session.info.exitCode = exitCode;
    session.info.signal =
      signal === null || signal === undefined || signal === 0 || signal === ""
        ? null
        : String(signal);
    this.clearKillTimer(session);
    if (session.cleanup) {
      const cleanup = session.cleanup;
      session.cleanup = undefined;
      void cleanup().catch(() => undefined);
    }
    const message: TerminalServerMessage = {
      type: "exit",
      exitCode: session.info.exitCode,
      signal: session.info.signal,
    };
    this.sendToClients(session, message);
    // Give the browser a moment to render the exit line, then release sockets.
    setTimeout(() => {
      for (const client of session.clients) {
        try {
          client.close(1000, "process exited");
        } catch {
          // ignore
        }
      }
      session.clients.clear();
    }, 150);
    session.reapTimer = setTimeout(() => {
      if (session.clients.size === 0) this.remove(session);
    }, EXIT_RETENTION_MS);
    session.reapTimer.unref?.();
  }

  private remove(session: Session): void {
    session.closed = true;
    this.clearKillTimer(session);
    if (session.reapTimer) clearTimeout(session.reapTimer);
    this.sessions.delete(session.info.id);
  }

  private clearKillTimer(session: Session): void {
    if (session.killTimer) {
      clearTimeout(session.killTimer);
      session.killTimer = null;
    }
  }

  attach(id: string, ws: WebSocket): void {
    const session = this.mustGet(id);
    session.clients.add(ws);
    session.lastDetachedAt = Date.now();
    const ready: TerminalServerMessage = {
      type: "ready",
      session: { ...session.info },
      replayed: session.buffer.length,
    };
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(ready));
      if (session.buffer)
        ws.send(
          JSON.stringify({ type: "data", data: session.buffer } satisfies TerminalServerMessage),
        );
      if (session.exited) {
        ws.send(
          JSON.stringify({
            type: "exit",
            exitCode: session.info.exitCode,
            signal: session.info.signal,
          } satisfies TerminalServerMessage),
        );
      }
    }
    ws.on("message", (raw) => {
      const text = raw.toString();
      if (text.length > MAX_INPUT_CHARS * 2) {
        this.sendToClients(session, {
          type: "error",
          code: "PAYLOAD_TOO_LARGE",
          message: "Terminal input message is too large.",
        });
        return;
      }
      let message: TerminalClientMessage;
      try {
        message = JSON.parse(text) as TerminalClientMessage;
      } catch {
        this.sendToClients(session, {
          type: "error",
          code: "INVALID_REQUEST",
          message: "Terminal messages must be JSON.",
        });
        return;
      }
      this.handleClientMessage(session, message);
    });
    ws.on("close", () => {
      session.clients.delete(ws);
      session.lastDetachedAt = Date.now();
    });
    ws.on("error", () => {
      session.clients.delete(ws);
      session.lastDetachedAt = Date.now();
    });
  }

  private handleClientMessage(session: Session, message: TerminalClientMessage): void {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "input": {
        if (typeof message.data !== "string") return;
        if (message.data.length > MAX_INPUT_CHARS) return;
        if (!session.pty && message.data.includes("\u0003")) {
          this.interruptSession(session);
          // eslint-disable-next-line no-control-regex -- Ctrl+C handling.
          const rest = message.data.replace(/\u0003/g, "");
          if (rest) this.writeSession(session, rest);
          return;
        }
        this.writeSession(session, message.data);
        return;
      }
      case "resize": {
        const size = normalizeTerminalSize(message.cols, message.rows);
        session.info.cols = size.cols;
        session.info.rows = size.rows;
        if (session.ptyProcess && !session.exited) {
          try {
            session.ptyProcess.resize(size.cols, size.rows);
          } catch {
            // The process may have just exited.
          }
        }
        return;
      }
      case "interrupt":
        this.interruptSession(session);
        return;
      case "ping":
        this.sendToClients(session, { type: "pong" });
        return;
      default:
        return;
    }
  }

  private writeSession(session: Session, data: string): void {
    if (session.exited) return;
    if (session.ptyProcess) {
      try {
        session.ptyProcess.write(data);
      } catch {
        // ignore writes to a just-exited process
      }
      return;
    }
    try {
      session.child?.stdin?.write(data);
    } catch {
      // ignore
    }
  }

  private interruptSession(session: Session): void {
    if (session.exited) return;
    if (session.ptyProcess) {
      try {
        session.ptyProcess.write("\u0003");
        return;
      } catch {
        // fall through to signalling
      }
    }
    if (session.child?.pid) {
      if (process.platform !== "win32") {
        try {
          process.kill(-session.child.pid, "SIGINT");
          return;
        } catch {
          // fall through
        }
      }
      try {
        session.child.kill("SIGINT");
      } catch {
        // ignore
      }
    }
  }

  resize(id: string, cols: unknown, rows: unknown): TerminalSessionInfo {
    const session = this.mustGet(id);
    const size = normalizeTerminalSize(cols, rows);
    session.info.cols = size.cols;
    session.info.rows = size.rows;
    if (session.ptyProcess && !session.exited) {
      try {
        session.ptyProcess.resize(size.cols, size.rows);
      } catch {
        // ignore
      }
    }
    return { ...session.info };
  }

  interrupt(id: string): void {
    this.interruptSession(this.mustGet(id));
  }

  close(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.closed = true;
    this.sessions.delete(id);
    this.clearKillTimer(session);
    if (session.reapTimer) clearTimeout(session.reapTimer);
    this.killProcess(session);
    for (const client of session.clients) {
      try {
        client.send(
          JSON.stringify({
            type: "error",
            code: "INTERNAL_ERROR",
            message: "Terminal session closed.",
          } satisfies TerminalServerMessage),
        );
        client.close(1000, "session closed");
      } catch {
        // ignore
      }
    }
    session.clients.clear();
  }

  closeForWorkspace(workspaceId: string): void {
    for (const session of [...this.sessions.values()]) {
      if (session.info.workspaceId === workspaceId) this.close(session.info.id);
    }
  }

  private killProcess(session: Session): void {
    if (session.ptyProcess) {
      try {
        session.ptyProcess.kill();
      } catch {
        // ignore
      }
      session.killTimer = setTimeout(() => {
        try {
          session.ptyProcess?.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 1500);
      session.killTimer.unref?.();
      return;
    }
    const child = session.child;
    if (!child?.pid) return;
    if (process.platform === "win32") {
      try {
        child.kill();
      } catch {
        // ignore
      }
      session.killTimer = setTimeout(() => {
        execFile(
          "taskkill",
          ["/pid", String(child.pid), "/T", "/F"],
          { windowsHide: true },
          () => undefined,
        );
      }, 1500);
      session.killTimer.unref?.();
      return;
    }
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    session.killTimer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }, 1500);
    session.killTimer.unref?.();
  }

  private reapIdle(): void {
    const cutoff = Date.now() - this.options.idleMinutes * 60_000;
    for (const session of [...this.sessions.values()]) {
      if (session.exited) {
        if (
          session.clients.size === 0 &&
          session.exitedAt !== null &&
          Date.now() - session.exitedAt > EXIT_RETENTION_MS
        ) {
          this.remove(session);
        }
        continue;
      }
      if (session.clients.size === 0 && session.lastDetachedAt < cutoff) {
        this.options.onLog?.(`Closing idle terminal ${session.info.id}.`);
        this.close(session.info.id);
      }
    }
  }

  async shutdown(): Promise<void> {
    clearInterval(this.idleTimer);
    for (const session of [...this.sessions.values()]) {
      this.close(session.info.id);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
