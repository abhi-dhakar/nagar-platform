import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe } from "node:test";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";

/**
 * Integration tests drive the real API (Fastify + Better Auth + Prisma) against a real
 * PostgreSQL database and the real `git` binary, over real HTTP. They need a migrated database
 * (`pnpm db:deploy`). Without one they skip with a clear reason; set NAGAR_REQUIRE_DB_TESTS=1
 * (CI does) to turn a missing database into a failure instead of a skip.
 */

export const PASSWORD = "correct-horse-battery-staple";
/** Short random tag so repeated runs never collide on emails, usernames, or slugs. */
export const RUN = randomBytes(3).toString("hex");
export const WEB_ORIGIN = "http://localhost:3000";

export async function unavailableReason(): Promise<string | null> {
  try {
    const { prisma } = await import("@nagar/database");
    await prisma.$queryRaw`SELECT 1`;
    await prisma.user.count({ take: 1 });
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n").pop() : String(error);
    return `PostgreSQL is not reachable or not migrated (${detail}). Start it (pnpm infra:up) and run pnpm db:deploy.`;
  }
}

export function redisReachable(): Promise<boolean> {
  const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return new Promise((resolve) => {
    const socket = createConnection({ host: url.hostname, port: Number(url.port) || 6379 });
    socket.setTimeout(1500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    const fail = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once("error", fail);
    socket.once("timeout", fail);
  });
}

export async function integrationSuite(name: string, define: (harness: Harness) => void) {
  const reason = await unavailableReason();
  if (reason && process.env.NAGAR_REQUIRE_DB_TESTS === "1") {
    throw new Error(`NAGAR_REQUIRE_DB_TESTS=1 but ${reason}`);
  }
  const harness = new Harness();
  describe(name, { skip: reason ?? false }, () => define(harness));
}

export interface ApiResult {
  status: number;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
  headers: Headers;
}

export class ApiClient {
  readonly jar = new Map<string, string>();
  email = "";
  username = "";

  constructor(
    private readonly baseUrl: string,
    readonly label: string,
  ) {}

  async request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ApiResult> {
    const sent: Record<string, string> = { origin: WEB_ORIGIN, ...headers };
    if (body !== undefined) sent["content-type"] = "application/json";
    if (this.jar.size) {
      sent.cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: sent,
      redirect: "manual",
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";")[0] ?? "";
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (!value || /max-age=0/i.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: response.status, json, text, headers: response.headers };
  }

  get = (path: string) => this.request("GET", path);
  post = (path: string, body: unknown = {}) => this.request("POST", path, body);
  patch = (path: string, body: unknown = {}) => this.request("PATCH", path, body);
  delete = (path: string) => this.request("DELETE", path);
}

const execFileAsync = promisify(execFile);

export interface GitResult {
  ok: boolean;
  out: string;
  err: string;
}

export class Harness {
  baseUrl = "";
  app!: FastifyInstance;
  gitRoot = "";
  scratch = "";
  private readonly emails: string[] = [];
  private readonly slugs: string[] = [];
  private cloneCount = 0;

  async start(): Promise<void> {
    this.gitRoot = await mkdtemp(join(tmpdir(), "nagar-it-git-"));
    this.scratch = mkdtempSync(join(tmpdir(), "nagar-it-work-"));
    mkdirSync(join(this.scratch, "home"), { recursive: true });
    writeFileSync(join(this.scratch, "home", ".gitconfig"), "");
    // Must be set before the app module is first imported: it fixes the Git storage root.
    process.env.NAGAR_GIT_ROOT = this.gitRoot;
    // Better Auth switches its CSRF/origin protection off when NODE_ENV is "test", so run the
    // app the way a developer would and silence the request log instead.
    process.env.NODE_ENV = "development";
    process.env.LOG_LEVEL ??= "silent";
    const { createApiServer } = await import("../../src/app.js");
    this.app = await createApiServer();
    await this.app.listen({ port: 0, host: "127.0.0.1" });
    this.baseUrl = `http://127.0.0.1:${(this.app.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    try {
      const { prisma } = await import("@nagar/database");
      // Deleting users cascades to their repositories, memberships, issues, reviews, and
      // notifications; organizations are removed explicitly for completeness.
      await prisma.organization.deleteMany({ where: { slug: { in: this.slugs } } });
      await prisma.user.deleteMany({ where: { email: { in: this.emails } } });
    } finally {
      await this.app?.close();
      await rm(this.gitRoot, { recursive: true, force: true });
      await rm(this.scratch, { recursive: true, force: true });
    }
  }

  /** A uniquely named organization slug that is cleaned up when the suite ends. */
  orgSlug(label: string): string {
    const slug = `${label}-${RUN}`;
    this.slugs.push(slug);
    return slug;
  }

  anonymous(): ApiClient {
    return new ApiClient(this.baseUrl, "anonymous");
  }

  /** Registers a fresh account, signs it in, and gives it a username. */
  async user(label: string): Promise<ApiClient> {
    const client = new ApiClient(this.baseUrl, label);
    client.email = `${label}-${RUN}@example.test`;
    client.username = `${label}-${RUN}`;
    this.emails.push(client.email);
    const signUp = await client.post("/api/auth/sign-up/email", {
      name: `${label[0]?.toUpperCase()}${label.slice(1)} Tester`,
      email: client.email,
      password: PASSWORD,
    });
    if (signUp.status !== 200) throw new Error(`sign-up failed: ${signUp.status} ${signUp.text}`);
    const profile = await client.patch("/api/v1/me/profile", { username: client.username });
    if (profile.status !== 200)
      throw new Error(`username failed: ${profile.status} ${profile.text}`);
    return client;
  }

  /** A signed-up account that has NOT chosen a username yet. */
  async userWithoutUsername(label: string): Promise<ApiClient> {
    const client = new ApiClient(this.baseUrl, label);
    client.email = `${label}-${RUN}@example.test`;
    this.emails.push(client.email);
    const signUp = await client.post("/api/auth/sign-up/email", {
      name: label,
      email: client.email,
      password: PASSWORD,
    });
    if (signUp.status !== 200) throw new Error(`sign-up failed: ${signUp.status}`);
    return client;
  }

  /**
   * Runs Git without blocking the event loop: the API under test lives in this same process, so
   * a synchronous child process would starve the server it is talking to.
   */
  async git(args: string[], options: { cwd?: string } = {}): Promise<GitResult> {
    try {
      const { stdout, stderr } = await execFileAsync("git", args, {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 60_000,
        env: {
          PATH: process.env.PATH,
          HOME: join(this.scratch, "home"),
          GIT_CONFIG_GLOBAL: join(this.scratch, "home", ".gitconfig"),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_AUTHOR_NAME: "Integration Test",
          GIT_AUTHOR_EMAIL: "it@example.test",
          GIT_COMMITTER_NAME: "Integration Test",
          GIT_COMMITTER_EMAIL: "it@example.test",
        },
      });
      return { ok: true, out: stdout.trim(), err: stderr.trim() };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        out: (failed.stdout ?? "").trim(),
        err: (failed.stderr ?? failed.message ?? "").trim(),
      };
    }
  }

  remote(namespace: string, slug: string, as?: { email: string }, password = PASSWORD): string {
    const host = this.baseUrl.replace("http://", "");
    const credentials = as
      ? `${encodeURIComponent(as.email)}:${encodeURIComponent(password)}@`
      : "";
    return `http://${credentials}${host}/git/${namespace}/${slug}.git`;
  }

  async clone(
    namespace: string,
    slug: string,
    as?: { email: string },
    password = PASSWORD,
  ): Promise<GitResult & { dir: string }> {
    const dir = join(this.scratch, `clone-${++this.cloneCount}`);
    return { ...(await this.git(["clone", this.remote(namespace, slug, as, password), dir])), dir };
  }

  async commit(dir: string, file: string, contents: string | Buffer, message: string) {
    const target = join(dir, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
    await this.git(["add", "--all"], { cwd: dir });
    return this.git(["commit", "-m", message], { cwd: dir });
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check` returns a truthy value (for work the API does after replying). */
export async function eventually<T>(check: () => Promise<T | false | null | undefined>, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("Condition was not met in time.");
    await sleep(50);
  }
}
