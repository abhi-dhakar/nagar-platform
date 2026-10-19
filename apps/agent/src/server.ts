import { promises as fs } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  AGENT_NAME,
  AGENT_PROTOCOL_VERSION,
  AGENT_WS_SUBPROTOCOL,
  type AgentErrorBody,
  type AgentFile,
  type AgentHealth,
  type AgentStatus,
  type BrowseResult,
  type ListEntriesResponse,
  type ListFilesResponse,
  type ListTerminalsResponse,
  type ListWorkspacesResponse,
  type RuntimesResponse,
  type RunResult,
  type TerminalServerMessage,
  type WorkspaceSummary,
} from "@nagar/agent-protocol";
import { AuthGuard } from "./auth.js";
import { findContainingRoot, type AgentConfig } from "./config.js";
import { AgentError, isAgentError } from "./errors.js";
import { assertAbsoluteDirectoryInput, normalizeWorkspacePath } from "./paths.js";
import { createRuntimeRegistry, runtimeForPath, type RuntimeRegistry } from "./runtimes/index.js";
import { detectShells, findShell } from "./terminals/shells.js";
import { TerminalManager, normalizeTerminalSize } from "./terminals/manager.js";
import { WorkspaceManager } from "./workspace.js";
import { AGENT_VERSION } from "./version.js";

type JsonObject = Record<string, unknown>;

export type AgentServer = {
  server: http.Server;
  wss: WebSocketServer;
  port: number;
  url: string;
  config: AgentConfig;
  workspaces: WorkspaceManager;
  terminals: TerminalManager;
  runtimes: RuntimeRegistry;
  close: () => Promise<void>;
};

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bodyObject(value: unknown): JsonObject {
  if (!isJsonObject(value))
    throw new AgentError("INVALID_REQUEST", "Request body must be a JSON object.");
  return value;
}

function stringField(body: JsonObject, field: string): string;
function stringField(body: JsonObject, field: string, optional: true): string | undefined;
function stringField(body: JsonObject, field: string, optional = false): string | undefined {
  const value = body[field];
  if (value === undefined) {
    if (optional) return undefined;
    throw new AgentError("INVALID_REQUEST", `Missing "${field}".`);
  }
  if (typeof value !== "string")
    throw new AgentError("INVALID_REQUEST", `"${field}" must be a string.`);
  return value;
}

export async function startAgent(
  config: AgentConfig,
  log: (message: string) => void = () => undefined,
): Promise<AgentServer> {
  const auth = new AuthGuard(config.token, config.allowedOrigins);
  const workspaces = new WorkspaceManager(config.allowedRoots, {
    maxReadBytes: config.maxReadBytes,
    maxWriteBytes: config.maxWriteBytes,
    maxListEntries: config.maxListEntries,
    maxFiles: config.maxFiles,
  });
  const terminals = new TerminalManager({
    maxTerminals: config.maxTerminals,
    disablePty: config.disablePty,
    idleMinutes: config.idleMinutes,
    onLog: log,
  });
  const runtimes = createRuntimeRegistry(config);
  const maxBodyBytes = Math.max(config.maxWriteBytes * 2 + 64 * 1024, 256 * 1024);

  const setCors = (res: ServerResponse, origin: string | undefined): void => {
    res.setHeader("Vary", "Origin");
    if (origin && auth.checkOrigin(origin) === null) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
  };

  const sendJson = (
    res: ServerResponse,
    status: number,
    payload: unknown,
    origin?: string,
  ): void => {
    const body = JSON.stringify(payload);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(body));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    setCors(res, origin);
    res.end(body);
  };

  const sendError = (res: ServerResponse, error: unknown, origin?: string): void => {
    if (isAgentError(error)) {
      if (error.code === "TOO_MANY_REQUESTS") res.setHeader("Retry-After", "60");
      const payload: AgentErrorBody = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      };
      sendJson(res, error.statusCode, payload, origin);
      return;
    }
    console.error("[agent] unhandled request error", error);
    const payload: AgentErrorBody = {
      error: { code: "INTERNAL_ERROR", message: "The local agent hit an unexpected error." },
    };
    sendJson(res, 500, payload, origin);
  };

  const readJson = async (req: IncomingMessage): Promise<unknown> => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > maxBodyBytes) {
      throw new AgentError("PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBodyBytes} bytes.`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBodyBytes) {
        req.resume();
        throw new AgentError("PAYLOAD_TOO_LARGE", `Request body exceeds ${maxBodyBytes} bytes.`);
      }
      chunks.push(buffer);
    }
    if (total === 0) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new AgentError("INVALID_REQUEST", "Request body is not valid JSON.");
    }
  };

  const route = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    const method = req.method ?? "GET";
    const segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));

    const hostFailure = auth.checkHost(req);
    if (hostFailure) throw new AgentError(hostFailure.code, hostFailure.message);
    const originFailure = auth.checkOrigin(origin);
    if (originFailure) throw new AgentError(originFailure.code, originFailure.message);

    if (method === "OPTIONS") {
      setCors(res, origin);
      res.statusCode = 204;
      res.setHeader("Content-Length", "0");
      res.end();
      return;
    }

    if (
      method === "GET" &&
      segments.length === 2 &&
      segments[0] === "api" &&
      segments[1] === "health"
    ) {
      const health: AgentHealth = {
        ok: true,
        name: AGENT_NAME,
        version: AGENT_VERSION,
        protocolVersion: AGENT_PROTOCOL_VERSION,
      };
      sendJson(res, 200, health, origin);
      return;
    }

    auth.checkFailureBudget();
    if (!auth.checkBearer(req.headers.authorization)) {
      throw new AgentError("UNAUTHORIZED", "Missing or invalid agent token.");
    }

    // Status and runtime availability.
    if (
      method === "GET" &&
      segments.length === 2 &&
      segments[1] === "status" &&
      segments[0] === "api"
    ) {
      const current = workspaces.currentSummary();
      const [availableRuntimes, shells] = await Promise.all([
        runtimes.detectAll(current?.root ?? null),
        detectShells(),
      ]);
      const status: AgentStatus = {
        name: AGENT_NAME,
        version: AGENT_VERSION,
        protocolVersion: AGENT_PROTOCOL_VERSION,
        pid: process.pid,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        startedAt: serverStartedAt,
        ptyAvailable: terminals.ptyAvailable,
        ...(terminals.ptyReason ? { ptyReason: terminals.ptyReason } : {}),
        workspace: current,
        workspaces: workspaces.listWorkspaces(),
        allowedRoots: config.allowedRoots,
        allowedOrigins: auth.origins,
        runtimes: availableRuntimes,
        shells,
        terminals: { active: terminals.activeCount, limit: terminals.limit },
      };
      sendJson(res, 200, status, origin);
      return;
    }

    if (
      method === "GET" &&
      segments.length === 2 &&
      segments[0] === "api" &&
      segments[1] === "runtimes"
    ) {
      const workspaceId = url.searchParams.get("workspaceId");
      let workspaceRoot: string | null = null;
      if (workspaceId) workspaceRoot = workspaces.getRoot(workspaceId);
      let items = await runtimes.detectAll(workspaceRoot);
      const pythonOverride = url.searchParams.get("pythonPath") ?? undefined;
      if (pythonOverride) {
        const python = await runtimes.pythonOverrideAvailability(pythonOverride);
        items = items.map((item) => (item.id === "python" ? python : item));
      }
      const payload: RuntimesResponse = { runtimes: items };
      sendJson(res, 200, payload, origin);
      return;
    }

    // Browse directories inside the authorized roots.
    if (
      method === "GET" &&
      segments.length === 2 &&
      segments[0] === "api" &&
      segments[1] === "browse"
    ) {
      const requested = url.searchParams.get("path") ?? config.allowedRoots[0]!;
      const candidate = assertAbsoluteDirectoryInput(requested);
      let real: string;
      try {
        real = await fs.realpath(candidate);
        const stat = await fs.stat(real);
        if (!stat.isDirectory()) throw new AgentError("NOT_A_DIRECTORY", "Not a directory.");
      } catch (error) {
        if (error instanceof AgentError) throw error;
        throw new AgentError("NOT_FOUND", `Directory not found: ${requested}`);
      }
      if (!findContainingRoot(config.allowedRoots, real)) {
        throw new AgentError(
          "FORBIDDEN_PATH",
          `That directory is outside the agent's allowed roots: ${config.allowedRoots.join(", ")}`,
        );
      }
      const parentCandidate = path.dirname(real);
      const parent =
        parentCandidate !== real && findContainingRoot(config.allowedRoots, parentCandidate)
          ? parentCandidate
          : null;
      const dirents = await fs.readdir(real, { withFileTypes: true });
      const dirs = dirents
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .slice(0, 1000)
        .map((entry) => ({ name: entry.name, path: path.join(real, entry.name) }))
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
        );
      const payload: BrowseResult = { path: real, parent, roots: config.allowedRoots, dirs };
      sendJson(res, 200, payload, origin);
      return;
    }

    // Workspace collection.
    if (segments[0] === "api" && segments[1] === "workspaces") {
      if (segments.length === 2) {
        if (method === "GET") {
          const payload: ListWorkspacesResponse = { workspaces: workspaces.listWorkspaces() };
          sendJson(res, 200, payload, origin);
          return;
        }
        if (method === "POST") {
          const body = bodyObject(await readJson(req));
          const summary = await workspaces.open(body.path);
          sendJson(res, 200, { workspace: summary }, origin);
          return;
        }
      }
      const workspaceId = segments[2];
      if (!workspaceId) throw new AgentError("WORKSPACE_NOT_FOUND", "Missing workspace id.");
      const rest = segments.slice(3).join("/");

      if (method === "DELETE" && rest === "") {
        workspaces.close(workspaceId);
        terminals.closeForWorkspace(workspaceId);
        sendJson(res, 200, { ok: true }, origin);
        return;
      }

      if (method === "GET" && rest === "entries") {
        const entries = await workspaces.list(workspaceId, url.searchParams.get("path") ?? "/");
        const payload: ListEntriesResponse = { entries };
        sendJson(res, 200, payload, origin);
        return;
      }
      if (method === "GET" && rest === "file") {
        const file = await workspaces.readFile(workspaceId, url.searchParams.get("path") ?? "/");
        sendJson(res, 200, file satisfies AgentFile, origin);
        return;
      }
      if (method === "PUT" && rest === "file") {
        const body = bodyObject(await readJson(req));
        const filePath = stringField(body, "path");
        const content = stringField(body, "content");
        const entry = await workspaces.writeFile(workspaceId, filePath, content);
        sendJson(res, 200, { entry }, origin);
        return;
      }
      if (method === "POST" && rest === "files") {
        const body = bodyObject(await readJson(req));
        const filePath = stringField(body, "path");
        const content = stringField(body, "content", true) ?? "";
        const entry = await workspaces.createFile(workspaceId, filePath, content);
        sendJson(res, 200, { entry }, origin);
        return;
      }
      if (method === "POST" && rest === "folders") {
        const body = bodyObject(await readJson(req));
        const folderPath = stringField(body, "path");
        const entry = await workspaces.createFolder(workspaceId, folderPath);
        sendJson(res, 200, { entry }, origin);
        return;
      }
      if (method === "POST" && rest === "rename") {
        const body = bodyObject(await readJson(req));
        const from = stringField(body, "from");
        const to = stringField(body, "to");
        const entry = await workspaces.rename(workspaceId, from, to);
        sendJson(res, 200, { entry }, origin);
        return;
      }
      if (method === "DELETE" && rest === "entries") {
        const recursive =
          url.searchParams.get("recursive") === "1" || url.searchParams.get("recursive") === "true";
        await workspaces.delete(workspaceId, url.searchParams.get("path") ?? "/", { recursive });
        sendJson(res, 200, { ok: true }, origin);
        return;
      }
      if (method === "GET" && rest === "stat") {
        const entry = await workspaces.stat(workspaceId, url.searchParams.get("path") ?? "/");
        sendJson(res, 200, { entry }, origin);
        return;
      }
      if (method === "GET" && rest === "exists") {
        const exists = await workspaces.exists(workspaceId, url.searchParams.get("path") ?? "/");
        sendJson(res, 200, { exists }, origin);
        return;
      }
      if (method === "GET" && rest === "files") {
        const result = await workspaces.getAllFiles(workspaceId);
        const payload: ListFilesResponse = result;
        sendJson(res, 200, payload, origin);
        return;
      }
      if (method === "POST" && rest === "runs") {
        const body = bodyObject(await readJson(req));
        const filePath = stringField(body, "path");
        const normalized = normalizeWorkspacePath(filePath);
        const stat = await workspaces.stat(workspaceId, normalized);
        if (!stat) throw new AgentError("NOT_FOUND", `File not found: ${normalized}`);
        if (stat.kind !== "file")
          throw new AgentError("IS_A_DIRECTORY", `Not a file: ${normalized}`);
        const runtime = runtimeForPath(normalized);
        if (!runtime) {
          throw new AgentError(
            "UNSUPPORTED_LANGUAGE",
            "NagarCode can run .js, .mjs, .cjs, .ts, .mts, .cts, .py, and .pyw files in this phase.",
          );
        }
        const requestedRuntime = typeof body.runtime === "string" ? body.runtime : undefined;
        if (requestedRuntime && requestedRuntime !== runtime) {
          throw new AgentError(
            "INVALID_REQUEST",
            `Runtime "${requestedRuntime}" does not match ${normalized}.`,
          );
        }
        const root = workspaces.getRoot(workspaceId);
        const resolved = await workspaces.resolveExistingPath(workspaceId, normalized);
        const pythonPath = typeof body.pythonPath === "string" ? body.pythonPath : undefined;
        const plan = await runtimes.prepare({
          config,
          workspaceRoot: root,
          fileAbs: resolved.absolute,
          fileRel: resolved.rel,
          ...(pythonPath ? { pythonPathOverride: pythonPath } : {}),
        });
        const { cols, rows } = normalizeTerminalSize(
          body.cols as number | undefined,
          body.rows as number | undefined,
        );
        const labels: Record<string, string> = {
          javascript: "Node.js",
          typescript: "TypeScript",
          python: "Python",
        };
        try {
          const session = await terminals.createRun({
            workspaceId,
            runtime,
            runtimeLabel: labels[runtime] ?? runtime,
            filePath: normalized,
            command: plan.command,
            args: plan.args,
            cwd: plan.cwd,
            cwdRel: workspaces.relativePath(workspaceId, plan.cwd),
            env: plan.env,
            commandLine: plan.commandLine,
            ...(plan.cleanup ? { cleanup: plan.cleanup } : {}),
            cols,
            rows,
          });
          const payload: RunResult = { session, runtime, commandLine: plan.commandLine };
          sendJson(res, 200, payload, origin);
        } catch (error) {
          if (plan.cleanup) await plan.cleanup().catch(() => undefined);
          throw error;
        }
        return;
      }
    }

    // Terminal sessions.
    if (segments[0] === "api" && segments[1] === "terminals") {
      if (segments.length === 2) {
        if (method === "GET") {
          const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
          const payload: ListTerminalsResponse = { sessions: terminals.list(workspaceId) };
          sendJson(res, 200, payload, origin);
          return;
        }
        if (method === "POST") {
          const body = bodyObject(await readJson(req));
          const workspaceId = stringField(body, "workspaceId");
          const summary: WorkspaceSummary = workspaces.getSummary(workspaceId);
          const shellId = typeof body.shellId === "string" ? body.shellId : undefined;
          const shell = await findShell(shellId);
          if (!shell) {
            const available = (await detectShells()).map((item) => item.id);
            throw new AgentError(
              "SHELL_UNAVAILABLE",
              shellId
                ? `Shell "${shellId}" is not available. Available shells: ${available.join(", ") || "none"}.`
                : "No supported shell was found on this computer.",
            );
          }
          const cwdInput = typeof body.cwd === "string" ? body.cwd : "/";
          const cwd = await workspaces.resolveDirectory(workspaceId, cwdInput);
          const { cols, rows } = normalizeTerminalSize(
            body.cols as number | undefined,
            body.rows as number | undefined,
          );
          const session = await terminals.createShell({
            workspaceId: summary.id,
            shell,
            cwd: cwd.absolute,
            cwdRel: cwd.rel,
            cols,
            rows,
          });
          sendJson(res, 200, { session }, origin);
          return;
        }
      }
      const terminalId = segments[2];
      if (!terminalId) throw new AgentError("SESSION_NOT_FOUND", "Missing terminal id.");
      if (method === "GET" && segments.length === 3) {
        sendJson(res, 200, { session: terminals.get(terminalId) }, origin);
        return;
      }
      if (method === "DELETE" && segments.length === 3) {
        terminals.get(terminalId);
        terminals.close(terminalId);
        sendJson(res, 200, { ok: true }, origin);
        return;
      }
      if (method === "PATCH" && segments.length === 3) {
        const body = bodyObject(await readJson(req));
        const session = terminals.resize(terminalId, body.cols, body.rows);
        sendJson(res, 200, { session }, origin);
        return;
      }
      if (method === "POST" && segments.length === 4 && segments[3] === "interrupt") {
        terminals.interrupt(terminalId);
        sendJson(res, 200, { ok: true }, origin);
        return;
      }
    }

    throw new AgentError("NOT_FOUND", "Unknown agent endpoint.");
  };

  const serverStartedAt = new Date().toISOString();
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    const started = Date.now();
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    res.on("finish", () => {
      if (config.logRequests) {
        log(
          `${req.method ?? "GET"} ${req.url?.split("?")[0] ?? "/"} -> ${res.statusCode} (${Date.now() - started}ms)`,
        );
      }
    });
    void route(req, res, new URL(req.url ?? "/", "http://agent.local")).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendError(res, error, origin);
    });
  });
  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 30_000;
  server.requestTimeout = 120_000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    }
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    handleProtocols: (protocols) =>
      protocols.has(AGENT_WS_SUBPROTOCOL) ? AGENT_WS_SUBPROTOCOL : false,
  });

  const rejectUpgrade = (socket: Duplex, status: number, message: string): void => {
    if (!socket.writable) return;
    const body = JSON.stringify({ error: { code: "UNAUTHORIZED", message } });
    socket.write(
      `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : status === 404 ? "Not Found" : "Forbidden"}\r\n` +
        "Connection: close\r\nContent-Type: application/json; charset=utf-8\r\n" +
        `Content-Length: ${Buffer.byteLength(body)}\r\nCache-Control: no-store\r\n\r\n${body}`,
    );
    socket.destroy();
  };

  server.on("upgrade", (req, socket, head) => {
    const hostFailure = auth.checkHost(req);
    if (hostFailure) {
      rejectUpgrade(socket, 403, hostFailure.message);
      return;
    }
    const originFailure = auth.checkWsOrigin(req.headers.origin);
    if (originFailure) {
      rejectUpgrade(socket, 403, originFailure.message);
      return;
    }
    const authResult = auth.checkWebSocket(req);
    if (!authResult.ok) {
      rejectUpgrade(socket, 401, authResult.message);
      return;
    }
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", "http://agent.local").pathname;
    } catch {
      rejectUpgrade(socket, 400, "Bad WebSocket URL.");
      return;
    }
    const match = /^\/api\/terminals\/([^/]+)\/ws$/.exec(pathname);
    if (!match?.[1]) {
      rejectUpgrade(socket, 404, "Unknown WebSocket endpoint.");
      return;
    }
    let sessionId: string;
    try {
      sessionId = decodeURIComponent(match[1]);
      terminals.get(sessionId);
    } catch {
      rejectUpgrade(socket, 404, "Terminal session not found.");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const alive = ws as WebSocket & { isAlive?: boolean };
      alive.isAlive = true;
      ws.on("pong", () => {
        alive.isAlive = true;
      });
      try {
        terminals.attach(sessionId, ws);
      } catch {
        const message: TerminalServerMessage = {
          type: "error",
          code: "SESSION_NOT_FOUND",
          message: "That terminal session no longer exists.",
        };
        ws.send(JSON.stringify(message));
        ws.close(1011, "session missing");
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const alive = client as WebSocket & { isAlive?: boolean };
      if (alive.isAlive === false) {
        client.terminate();
        continue;
      }
      alive.isAlive = false;
      try {
        client.ping();
      } catch {
        // closed
      }
    }
  }, 30_000);
  heartbeat.unref?.();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("The agent could not determine its listening address.");
  }
  const port = address.port;
  const hostLabel = config.host === "::1" ? "[::1]" : config.host;
  const url = `http://${hostLabel}:${port}`;

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        // ignore
      }
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await terminals.shutdown();
    workspaces.closeAll();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      setTimeout(() => {
        for (const socket of sockets) socket.destroy();
        resolve();
      }, 500).unref?.();
    });
    server.closeAllConnections?.();
  };

  log(`Agent listening on ${url} (loopback only)`);
  return { server, wss, port, url, config, workspaces, terminals, runtimes, close };
}
