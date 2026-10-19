import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENT_WS_SUBPROTOCOL, AGENT_WS_TOKEN_PREFIX } from "@nagar/agent-protocol";
import { assertValidToken, createToken, DEFAULT_CODE_ORIGINS, normalizeOrigin } from "./auth.js";
import { assertAbsoluteDirectoryInput, assertCommandLike, isPathInside } from "./paths.js";

export type AgentHost = "127.0.0.1" | "::1" | "localhost";

export type AgentConfig = {
  host: AgentHost;
  port: number;
  token: string;
  allowedOrigins: string[];
  allowedRoots: string[];
  codeUrl: string;
  nodePath: string | undefined;
  pythonPath: string | undefined;
  maxTerminals: number;
  maxReadBytes: number;
  maxWriteBytes: number;
  maxListEntries: number;
  maxFiles: number;
  disablePty: boolean;
  idleMinutes: number;
  logRequests: boolean;
};

export type AgentConfigInput = {
  host?: string;
  port?: number | string;
  token?: string;
  allowedOrigins?: string[];
  allowedRoots?: string[];
  codeUrl?: string;
  nodePath?: string;
  pythonPath?: string;
  maxTerminals?: number | string;
  maxReadBytes?: number | string;
  maxWriteBytes?: number | string;
  maxListEntries?: number | string;
  maxFiles?: number | string;
  disablePty?: boolean;
  idleMinutes?: number | string;
  logRequests?: boolean;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function parseInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(String(value));
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

async function existingDirectory(input: string, label: string): Promise<string> {
  const resolved = assertAbsoluteDirectoryInput(input);
  let real: string;
  try {
    real = await fs.realpath(resolved);
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`${label} is not an accessible directory: ${resolved}`);
  }
  return real;
}

export async function resolveAgentConfig(
  input: AgentConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentConfig> {
  const host = (input.host ?? env.NAGAR_AGENT_HOST ?? "127.0.0.1").toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `The agent only binds to loopback interfaces (127.0.0.1, ::1, localhost); refused host "${host}".`,
    );
  }

  const port = parseInteger(input.port ?? env.NAGAR_AGENT_PORT, 47821, 0, 65535, "Port");

  const token = assertValidToken(input.token ?? env.NAGAR_AGENT_TOKEN ?? createToken());

  const codeUrlRaw = input.codeUrl ?? env.NAGAR_CODE_URL ?? "http://localhost:3001";
  let codeUrl: string;
  try {
    const parsed = new URL(codeUrlRaw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new Error("bad protocol");
    codeUrl = parsed.origin;
  } catch {
    throw new Error(`NagarCode URL is invalid: ${codeUrlRaw}`);
  }

  const extraOrigins = [
    ...(input.allowedOrigins ?? []),
    ...(env.NAGAR_AGENT_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];
  const allowedOrigins = [
    ...new Set(
      [...DEFAULT_CODE_ORIGINS, codeUrl, ...extraOrigins].map((origin) => normalizeOrigin(origin)),
    ),
  ];

  const rootInputs =
    input.allowedRoots && input.allowedRoots.length > 0
      ? input.allowedRoots
      : (env.NAGAR_AGENT_ALLOWED_ROOTS ?? "")
          .split(path.delimiter)
          .map((value) => value.trim())
          .filter(Boolean);
  const defaultRoots = [os.homedir(), process.cwd()];
  const resolvedRoots: string[] = [];
  for (const root of rootInputs.length > 0 ? rootInputs : defaultRoots) {
    const real = await existingDirectory(root, "Allowed root");
    if (!resolvedRoots.some((existing) => existing.toLowerCase() === real.toLowerCase())) {
      resolvedRoots.push(real);
    }
  }
  if (resolvedRoots.length === 0) {
    throw new Error("At least one allowed root is required.");
  }

  const nodePath = input.nodePath ?? env.NAGAR_AGENT_NODE;
  const pythonPath = input.pythonPath ?? env.NAGAR_AGENT_PYTHON;

  return {
    host: host as AgentHost,
    port,
    token,
    allowedOrigins,
    allowedRoots: resolvedRoots,
    codeUrl,
    nodePath: nodePath?.trim() ? assertCommandLike(nodePath) : undefined,
    pythonPath: pythonPath?.trim() ? assertCommandLike(pythonPath) : undefined,
    maxTerminals: parseInteger(
      input.maxTerminals ?? env.NAGAR_AGENT_MAX_TERMINALS,
      8,
      1,
      32,
      "maxTerminals",
    ),
    maxReadBytes: parseInteger(
      input.maxReadBytes ?? env.NAGAR_AGENT_MAX_READ_BYTES,
      8 * 1024 * 1024,
      1024,
      128 * 1024 * 1024,
      "maxReadBytes",
    ),
    maxWriteBytes: parseInteger(
      input.maxWriteBytes ?? env.NAGAR_AGENT_MAX_WRITE_BYTES,
      8 * 1024 * 1024,
      1024,
      128 * 1024 * 1024,
      "maxWriteBytes",
    ),
    maxListEntries: parseInteger(
      input.maxListEntries ?? env.NAGAR_AGENT_MAX_LIST_ENTRIES,
      5000,
      10,
      100_000,
      "maxListEntries",
    ),
    maxFiles: parseInteger(
      input.maxFiles ?? env.NAGAR_AGENT_MAX_FILES,
      5000,
      10,
      100_000,
      "maxFiles",
    ),
    disablePty: input.disablePty ?? env.NAGAR_AGENT_DISABLE_PTY === "1",
    idleMinutes: parseInteger(
      input.idleMinutes ?? env.NAGAR_AGENT_IDLE_MINUTES,
      30,
      1,
      24 * 60,
      "idleMinutes",
    ),
    logRequests: input.logRequests ?? env.NAGAR_AGENT_LOG === "1",
  };
}

export function findContainingRoot(roots: string[], realPath: string): string | null {
  return roots.find((root) => isPathInside(root, realPath)) ?? null;
}

export function pairingUrl(
  config: Pick<AgentConfig, "codeUrl" | "host" | "port" | "token">,
): string {
  const host = config.host === "::1" ? "[::1]" : config.host;
  const agentUrl = `http://${host}:${config.port}`;
  const params = new URLSearchParams({ agent: agentUrl, token: config.token });
  return `${config.codeUrl}/#${params.toString()}`;
}

export function websocketProtocols(token: string): string[] {
  return [AGENT_WS_SUBPROTOCOL, `${AGENT_WS_TOKEN_PREFIX}${token}`];
}
