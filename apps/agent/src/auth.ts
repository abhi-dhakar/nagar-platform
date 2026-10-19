import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { AgentErrorCode } from "@nagar/agent-protocol";
import { AGENT_WS_TOKEN_PREFIX } from "@nagar/agent-protocol";
import { AgentError } from "./errors.js";

export function createToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function assertValidToken(token: string): string {
  if (!/^[A-Za-z0-9._~-]{24,256}$/.test(token)) {
    throw new Error(
      "Agent tokens must be 24-256 characters containing only letters, digits, '.', '_', '~', or '-'.",
    );
  }
  return token;
}

export function safeEqual(a: string, b: string): boolean {
  const left = crypto.createHash("sha256").update(a, "utf8").digest();
  const right = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(left, right) && a.length === b.length;
}

export function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`Invalid origin: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Origins must use http or https: ${value}`);
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Origins cannot include credentials, paths, queries, or fragments: ${value}`);
  }
  return url.origin;
}

export const DEFAULT_CODE_ORIGINS = [
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://[::1]:3001",
];

/** Check the Host header to block DNS-rebinding tricks against a loopback agent. */
export function isAllowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true; // HTTP/1.0 clients; browser requests always send Host.
  const host = hostHeader.trim().toLowerCase();
  let hostname: string;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end === -1) return false;
    hostname = host.slice(1, end);
    const rest = host.slice(end + 1);
    if (rest !== "" && !/^:\d+$/.test(rest)) return false;
  } else {
    const lastColon = host.lastIndexOf(":");
    hostname = lastColon === -1 ? host : host.slice(0, lastColon);
    if (lastColon !== -1 && !/^\d+$/.test(host.slice(lastColon + 1))) return false;
  }
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

export type AuthFailure = { code: AgentErrorCode; message: string };

export class AuthGuard {
  private readonly token: string;
  private readonly allowedOrigins: Set<string>;
  private failures = 0;
  private failureWindowStarted = Date.now();

  constructor(token: string, allowedOrigins: string[]) {
    this.token = assertValidToken(token);
    this.allowedOrigins = new Set(allowedOrigins.map(normalizeOrigin));
  }

  get origins(): string[] {
    return [...this.allowedOrigins];
  }

  checkOrigin(origin: string | undefined): AuthFailure | null {
    // Browser requests always send Origin. Requests without one are allowed for
    // CLI/diagnostic clients, but they still need the bearer token.
    if (origin === undefined) return null;
    if (!this.allowedOrigins.has(origin)) {
      return {
        code: "FORBIDDEN_ORIGIN",
        message:
          `Browser origin ${origin} is not allowed by this agent. ` +
          `Start the agent with --allow-origin ${origin} (and restart it).`,
      };
    }
    return null;
  }

  checkHost(req: IncomingMessage): AuthFailure | null {
    if (!isAllowedHost(req.headers.host)) {
      return { code: "FORBIDDEN_HOST", message: "The Host header is not a loopback hostname." };
    }
    return null;
  }

  /** Throw a 429 after repeated token guessing from any local client. */
  checkFailureBudget(): void {
    const now = Date.now();
    if (now - this.failureWindowStarted > 60_000) {
      this.failures = 0;
      this.failureWindowStarted = now;
    }
    if (this.failures >= 30) {
      throw new AgentError(
        "TOO_MANY_REQUESTS",
        "Too many failed authentication attempts. Wait one minute and try again.",
      );
    }
  }

  private recordFailure(): void {
    const now = Date.now();
    if (now - this.failureWindowStarted > 60_000) {
      this.failureWindowStarted = now;
      this.failures = 0;
    }
    this.failures += 1;
  }

  checkBearer(header: string | undefined): boolean {
    if (!header?.startsWith("Bearer ")) {
      this.recordFailure();
      return false;
    }
    const provided = header.slice("Bearer ".length).trim();
    const ok = safeEqual(this.token, provided);
    if (!ok) this.recordFailure();
    return ok;
  }

  checkWebSocket(req: IncomingMessage): { ok: boolean; message: string } {
    if (!req.headers.origin) {
      this.recordFailure();
      return { ok: false, message: "WebSocket connections must include an Origin header." };
    }
    const originFailure = this.checkOrigin(req.headers.origin);
    if (originFailure) {
      this.recordFailure();
      return { ok: false, message: originFailure.message };
    }
    const header = req.headers["sec-websocket-protocol"];
    const protocols = (Array.isArray(header) ? header.join(",") : (header ?? ""))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const tokenProtocol = protocols.find((value) => value.startsWith(AGENT_WS_TOKEN_PREFIX));
    if (!tokenProtocol) {
      this.recordFailure();
      return { ok: false, message: "Missing the agent token WebSocket subprotocol." };
    }
    const provided = tokenProtocol.slice(AGENT_WS_TOKEN_PREFIX.length);
    if (!safeEqual(this.token, provided)) {
      this.recordFailure();
      return { ok: false, message: "Invalid agent token." };
    }
    return { ok: true, message: "" };
  }

  checkWsOrigin(origin: string | undefined): AuthFailure | null {
    if (!origin) {
      return {
        code: "FORBIDDEN_ORIGIN",
        message: "WebSocket connections must include an Origin header.",
      };
    }
    return this.checkOrigin(origin);
  }
}
