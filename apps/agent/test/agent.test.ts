import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AgentErrorBody, TerminalServerMessage } from "@nagar/agent-protocol";
import WebSocket from "ws";
import { resolveAgentConfig } from "../src/config.js";
import { startAgent, type AgentServer } from "../src/server.js";

const TOKEN = "test-token-0123456789abcdef";
const ORIGIN = "http://localhost:3001";

type Json = Record<string, unknown>;

let root = "";
let agent: AgentServer;
let base = "";
let wsBase = "";
let workspaceId = "";

const ESCAPE = String.fromCharCode(27);
const stripAnsi = (value: string): string =>
  value.replace(new RegExp(`${ESCAPE}\\[[0-9;]*m`, "g"), "");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function request(
  target: string,
  method: string,
  route: string,
  options: { body?: unknown; origin?: string | null; token?: string | null } = {},
): Promise<{ status: number; body: Json; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.Origin = origin;
  const token = options.token === undefined ? TOKEN : options.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(target + route, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  let body: Json = {};
  if (text) {
    try {
      body = JSON.parse(text) as Json;
    } catch {
      body = { raw: text };
    }
  }
  return { status: response.status, body, headers: response.headers };
}

function api(method: string, route: string, options: Parameters<typeof request>[3] = {}) {
  return request(base, method, route, options);
}

function errorCode(body: Json): string | undefined {
  const error = (body as AgentErrorBody).error;
  return error?.code;
}

async function connectWs(
  sessionId: string,
  options: { origin?: string; protocols?: string[] } = {},
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${wsBase}/api/terminals/${sessionId}/ws`,
      options.protocols ?? ["nagarcode-agent.v1", `nagarcode-token.${TOKEN}`],
      { headers: { Origin: options.origin ?? ORIGIN } },
    );
    const timer = setTimeout(() => reject(new Error("WebSocket open timed out")), 5000);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("unexpected-response", (_req, response) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket rejected with ${response.statusCode}`));
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function createTerminal(bodies: Json = {}): Promise<Json> {
  const response = await api("POST", "/api/terminals", {
    body: { workspaceId, cols: 100, rows: 30, ...bodies },
  });
  assert.equal(response.status, 200);
  return response.body.session as Json;
}

async function runAndWait(
  sessionId: string,
  timeoutMs = 20_000,
): Promise<{ output: string; code: number | null }> {
  const socket = await connectWs(sessionId);
  let output = "";
  let code: number | null | undefined;
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as TerminalServerMessage;
    if (message.type === "data") output += message.data;
    if (message.type === "exit") code = message.exitCode;
  });
  const deadline = Date.now() + timeoutMs;
  while (code === undefined && Date.now() < deadline) await sleep(50);
  socket.close();
  if (code === undefined) throw new Error("process did not exit in time");
  return { output: stripAnsi(output), code };
}

type Shell = {
  id: string;
  socket: WebSocket;
  text: () => string;
  waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<string>;
  send: (data: string) => void;
};

async function openShell(): Promise<Shell> {
  const session = await createTerminal();
  const socket = await connectWs(session.id as string);
  let text = "";
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as TerminalServerMessage;
    if (message.type === "data") text += message.data;
  });
  const waitFor = async (pattern: RegExp, timeoutMs = 6000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (pattern.test(text)) return text;
      await sleep(40);
    }
    throw new Error(`terminal never produced ${pattern}; got: ${text.slice(-400)}`);
  };
  await sleep(350);
  return {
    id: session.id as string,
    socket,
    text: () => text,
    waitFor,
    send: (data: string) => socket.send(JSON.stringify({ type: "input", data })),
  };
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "nagar-agent-test-"));
  await fs.mkdir(path.join(root, "nested"), { recursive: true });
  await fs.writeFile(path.join(root, "hello.js"), 'console.log("hello from js", 2 + 3);\n');
  await fs.writeFile(
    path.join(root, "hello.ts"),
    'const n: number = 42;\nconsole.log("hello ts", n);\n',
  );
  await fs.writeFile(path.join(root, "hello.py"), 'print("hello python", 6 * 7)\n');
  await fs.writeFile(path.join(root, "nested", "note.txt"), "original\n");

  const config = await resolveAgentConfig(
    {
      host: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      codeUrl: "http://localhost:3001",
      idleMinutes: 1,
    },
    {},
  );
  agent = await startAgent(config);
  base = agent.url;
  wsBase = config.host === "::1" ? `ws://[::1]:${agent.port}` : `ws://127.0.0.1:${agent.port}`;

  const opened = await api("POST", "/api/workspaces", { body: { path: root } });
  assert.equal(opened.status, 200);
  workspaceId = (opened.body.workspace as Json).id as string;
});

after(async () => {
  await agent?.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("health is public but the API requires the token and a trusted origin", async () => {
  const health = await request(base, "GET", "/api/health", { token: null, origin: null });
  assert.equal(health.status, 200);
  assert.equal(health.body.name, "nagarcode-agent");

  const noToken = await request(base, "GET", "/api/status", { token: null });
  assert.equal(noToken.status, 401);
  assert.equal(errorCode(noToken.body), "UNAUTHORIZED");

  const badOrigin = await request(base, "GET", "/api/status", { origin: "http://evil.example" });
  assert.equal(badOrigin.status, 403);
  assert.equal(errorCode(badOrigin.body), "FORBIDDEN_ORIGIN");

  const preflight = await request(base, "OPTIONS", "/api/status", { token: null });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
});

test("WebSocket upgrades reject untrusted origins", async () => {
  const session = await createTerminal();
  await assert.rejects(
    connectWs(session.id as string, { origin: "http://evil.example" }),
    /rejected with 403/,
  );
  await api("DELETE", `/api/terminals/${session.id as string}`);
});

test("reads and saves real files on disk", async () => {
  const read = await api(
    "GET",
    `/api/workspaces/${workspaceId}/file?path=${encodeURIComponent("/nested/note.txt")}`,
  );
  assert.equal(read.status, 200);
  assert.equal(read.body.content, "original\n");

  const saved = await api("PUT", `/api/workspaces/${workspaceId}/file`, {
    body: { path: "/nested/note.txt", content: "saved by the agent test\n" },
  });
  assert.equal(saved.status, 200);
  assert.equal(
    await fs.readFile(path.join(root, "nested", "note.txt"), "utf8"),
    "saved by the agent test\n",
  );

  const missing = await api(
    "GET",
    `/api/workspaces/${workspaceId}/file?path=${encodeURIComponent("/missing.txt")}`,
  );
  assert.equal(missing.status, 404);
  assert.equal(errorCode(missing.body), "NOT_FOUND");
});

test("creates, renames, and deletes files and folders", async () => {
  const folder = await api("POST", `/api/workspaces/${workspaceId}/folders`, {
    body: { path: "/created" },
  });
  assert.equal(folder.status, 200);
  assert.equal((await fs.stat(path.join(root, "created"))).isDirectory(), true);

  const file = await api("POST", `/api/workspaces/${workspaceId}/files`, {
    body: { path: "/created/a.txt", content: "alpha" },
  });
  assert.equal(file.status, 200);

  const renamed = await api("POST", `/api/workspaces/${workspaceId}/rename`, {
    body: { from: "/created/a.txt", to: "/created/b.txt" },
  });
  assert.equal(renamed.status, 200);
  assert.equal(await fs.readFile(path.join(root, "created", "b.txt"), "utf8"), "alpha");

  const listed = await api(
    "GET",
    `/api/workspaces/${workspaceId}/entries?path=${encodeURIComponent("/created")}`,
  );
  assert.deepEqual(
    (listed.body.entries as { name: string }[]).map((entry) => entry.name),
    ["b.txt"],
  );

  const deleted = await api(
    "DELETE",
    `/api/workspaces/${workspaceId}/entries?path=${encodeURIComponent("/created")}&recursive=1`,
  );
  assert.equal(deleted.status, 200);
  await assert.rejects(fs.stat(path.join(root, "created")), /ENOENT/);
});

test("rejects paths outside the authorized workspace", async () => {
  const traversal = await api(
    "GET",
    `/api/workspaces/${workspaceId}/file?path=${encodeURIComponent("../../etc/passwd")}`,
  );
  assert.equal(traversal.status, 403);
  assert.ok(["PATH_OUTSIDE_WORKSPACE", "INVALID_PATH"].includes(errorCode(traversal.body) ?? ""));

  const outside = await api("POST", "/api/workspaces", { body: { path: "/" } });
  assert.equal(outside.status, 403);
  assert.equal(errorCode(outside.body), "FORBIDDEN_PATH");

  const link = path.join(root, "escape-link");
  await fs.symlink("/etc/passwd", link).catch(() => undefined);
  const escaped = await api(
    "GET",
    `/api/workspaces/${workspaceId}/file?path=${encodeURIComponent("/escape-link")}`,
  );
  assert.equal(escaped.status, 403);
  await fs.unlink(link).catch(() => undefined);
});

test("runs JavaScript through a real Node.js process", async () => {
  const run = await api("POST", `/api/workspaces/${workspaceId}/runs`, {
    body: { path: "/hello.js" },
  });
  assert.equal(run.status, 200);
  const session = run.body.session as Json;
  assert.equal(session.runtime, "javascript");
  const result = await runAndWait(session.id as string);
  assert.equal(result.code, 0);
  assert.match(result.output, /hello from js 5/);
});

test("runs TypeScript through the compatible compile/transpile workflow", async () => {
  const run = await api("POST", `/api/workspaces/${workspaceId}/runs`, {
    body: { path: "/hello.ts" },
  });
  assert.equal(run.status, 200);
  const session = run.body.session as Json;
  assert.equal(session.runtime, "typescript");
  const result = await runAndWait(session.id as string);
  assert.equal(result.code, 0);
  assert.match(result.output, /hello ts 42/);
});

test("runs Python with a configured interpreter", async () => {
  const runtimes = await api("GET", `/api/runtimes?workspaceId=${workspaceId}`);
  const python = (runtimes.body.runtimes as { id: string; available: boolean }[]).find(
    (runtime) => runtime.id === "python",
  );
  assert.ok(python, "python runtime should be reported");
  assert.equal(python.available, true, "python is required for this test environment");

  const run = await api("POST", `/api/workspaces/${workspaceId}/runs`, {
    body: { path: "/hello.py", pythonPath: "" },
  });
  assert.equal(run.status, 200);
  const result = await runAndWait((run.body.session as Json).id as string);
  assert.equal(result.code, 0);
  assert.match(result.output, /hello python 42/);
});

test("streams real shell commands, exit codes, and working directory", async () => {
  const shell = await openShell();
  shell.send("pwd\r");
  await shell.waitFor(/nagar-agent-test-[^\r\n]+/);
  shell.send("echo shell-marker-5\r");
  await shell.waitFor(/shell-marker-5/);
  shell.send("exit 7\r");
  const exit = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no exit message")), 5000);
    shell.socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as TerminalServerMessage;
      if (message.type === "exit") {
        clearTimeout(timer);
        resolve(message.exitCode);
      }
    });
  });
  assert.equal(exit, 7);
  shell.socket.close();
  await api("DELETE", `/api/terminals/${shell.id}`).catch(() => undefined);
});

test("interrupts a running process with Ctrl+C semantics", async () => {
  const shell = await openShell();
  shell.send("sleep 30\r");
  await sleep(400);
  const interrupted = await api("POST", `/api/terminals/${shell.id}/interrupt`, { body: {} });
  assert.equal(interrupted.status, 200);
  await shell.waitFor(/\^C|Interrupt|interrupt/i, 6000);
  shell.send("echo after-interrupt\r");
  await shell.waitFor(/after-interrupt/, 6000);
  shell.socket.close();
  await api("DELETE", `/api/terminals/${shell.id}`);
});

test("applies terminal resizing to the PTY", async () => {
  const session = await createTerminal({ cols: 90, rows: 25 });
  const resized = await api("PATCH", `/api/terminals/${session.id as string}`, {
    body: { cols: 120, rows: 40 },
  });
  assert.equal(resized.status, 200);
  assert.equal((resized.body.session as Json).cols, 120);
  assert.equal((resized.body.session as Json).rows, 40);

  if (session.pty === true) {
    const socket = await connectWs(session.id as string);
    let output = "";
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as TerminalServerMessage;
      if (message.type === "data") output += message.data;
    });
    await sleep(300);
    socket.send(JSON.stringify({ type: "input", data: "stty size\r" }));
    const deadline = Date.now() + 5000;
    while (!/40 120/.test(output) && Date.now() < deadline) await sleep(50);
    assert.match(output, /40 120/);
    socket.close();
  }
  await api("DELETE", `/api/terminals/${session.id as string}`);
});

test("shuts down cleanly and disconnects live terminal clients", async () => {
  const config = await resolveAgentConfig(
    {
      host: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      codeUrl: "http://localhost:3001",
      idleMinutes: 1,
    },
    {},
  );
  const secondary = await startAgent(config);
  const opened = await request(secondary.url, "POST", "/api/workspaces", { body: { path: root } });
  const id = (opened.body.workspace as Json).id as string;
  const created = await request(secondary.url, "POST", "/api/terminals", {
    body: { workspaceId: id, cols: 80, rows: 24 },
  });
  const socketBase = `ws://127.0.0.1:${secondary.port}`;
  const socket = new WebSocket(
    `${socketBase}/api/terminals/${(created.body.session as Json).id as string}/ws`,
    ["nagarcode-agent.v1", `nagarcode-token.${TOKEN}`],
    { headers: { Origin: ORIGIN } },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("secondary WebSocket did not open")), 5000);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  const closed = new Promise<number>((resolve) => socket.once("close", (code) => resolve(code)));

  await secondary.close();
  const closeCode = await Promise.race([
    closed,
    sleep(3000).then(() => {
      throw new Error("terminal WebSocket stayed open after agent shutdown");
    }),
  ]);
  assert.equal(typeof closeCode, "number");
  await assert.rejects(fetch(`${secondary.url}/api/health`), /fetch failed|ECONNREFUSED/);
});

test("reports unavailable interpreters and refuses to run them", async () => {
  const config = await resolveAgentConfig(
    {
      host: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      codeUrl: "http://localhost:3001",
      nodePath: "/definitely/missing/node",
      pythonPath: "/definitely/missing/python",
      idleMinutes: 1,
    },
    {},
  );
  const unavailable = await startAgent(config);
  try {
    const status = await request(unavailable.url, "GET", "/api/status");
    const runtimes = status.body.runtimes as { id: string; available: boolean; reason?: string }[];
    const js = runtimes.find((runtime) => runtime.id === "javascript");
    const python = runtimes.find((runtime) => runtime.id === "python");
    assert.equal(js?.available, false);
    assert.match(js?.reason ?? "", /node|Node|not found|unavailable/i);
    assert.equal(python?.available, false);
    assert.ok((python?.reason ?? "").length > 0);

    const opened = await request(unavailable.url, "POST", "/api/workspaces", {
      body: { path: root },
    });
    const id = (opened.body.workspace as Json).id as string;
    const jsRun = await request(unavailable.url, "POST", `/api/workspaces/${id}/runs`, {
      body: { path: "/hello.js" },
    });
    assert.equal(jsRun.status, 422);
    assert.equal(errorCode(jsRun.body), "RUNTIME_UNAVAILABLE");

    const pyRun = await request(unavailable.url, "POST", `/api/workspaces/${id}/runs`, {
      body: { path: "/hello.py" },
    });
    assert.equal(pyRun.status, 422);
    assert.equal(errorCode(pyRun.body), "RUNTIME_UNAVAILABLE");
  } finally {
    await unavailable.close();
  }
});
