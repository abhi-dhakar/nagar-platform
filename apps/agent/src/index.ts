#!/usr/bin/env node
import process from "node:process";
import {
  pairingUrl,
  resolveAgentConfig,
  type AgentConfig,
  type AgentConfigInput,
} from "./config.js";
import { startAgent, type AgentServer } from "./server.js";
import { AGENT_VERSION } from "./version.js";

type CliOptions = AgentConfigInput & { help?: boolean; version?: boolean };

const HELP = `
NagarCode local agent — real local files, terminals, and runtimes for NagarCode.

Usage:
  nagar-agent [options]
  pnpm agent                     (from the NagarCode repository root)

Options:
  --host <host>                  Loopback host: 127.0.0.1 (default), ::1, or localhost
  --port <port>                  Listen port (default 47821; 0 picks a free port)
  --token <token>                Fixed auth token (default: a new random token per start)
  --allow-root <dir>             Directory the browser may open (repeatable; default: home + cwd)
  --allow-origin <origin>        Extra browser origin allowed to connect (repeatable)
  --code-url <url>               NagarCode URL used in the pairing link (default http://localhost:3001)
  --node <path>                  Node.js executable used for JavaScript/TypeScript
  --python <path>                Python interpreter used for Python files
  --max-terminals <n>            Concurrent terminal/run sessions (default 8)
  --idle-minutes <n>             Close terminals left detached this long (default 30)
  --no-pty                       Force the plain-pipe terminal fallback
  --log                          Log each HTTP request (never logs the token)
  --version                      Print the version
  --help                         Show this help

Environment: NAGAR_AGENT_HOST, NAGAR_AGENT_PORT, NAGAR_AGENT_TOKEN,
NAGAR_AGENT_ALLOWED_ROOTS (path-delimited), NAGAR_AGENT_ALLOWED_ORIGINS (comma-separated),
NAGAR_CODE_URL, NAGAR_AGENT_NODE, NAGAR_AGENT_PYTHON, NAGAR_AGENT_MAX_TERMINALS,
NAGAR_AGENT_IDLE_MINUTES, NAGAR_AGENT_DISABLE_PTY, NAGAR_AGENT_LOG.

Security: the agent binds ONLY to loopback. Requests need the bearer token, a valid
Host header, and (for browsers) an allowed Origin. The token grants full access to the
opened workspaces and a real shell running as your user — keep it private.
`.trim();

function takeValue(args: string[], index: number, flag: string): { value: string; next: number } {
  const current = args[index]!;
  const equals = current.indexOf("=");
  if (equals !== -1) return { value: current.slice(equals + 1), next: index + 1 };
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return { value, next: index + 2 };
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  const roots: string[] = [];
  const origins: string[] = [];
  let index = 0;
  while (index < args.length) {
    const arg = args[index]!;
    const flag = arg.split("=")[0];
    switch (flag) {
      case "--":
        // npm/pnpm-style argument separator (`pnpm agent -- --port 0`).
        index += 1;
        break;
      case "--help":
      case "-h":
        options.help = true;
        index += 1;
        break;
      case "--version":
      case "-v":
        options.version = true;
        index += 1;
        break;
      case "--no-pty":
        options.disablePty = true;
        index += 1;
        break;
      case "--log":
        options.logRequests = true;
        index += 1;
        break;
      case "--host":
      case "--port":
      case "--token":
      case "--code-url":
      case "--node":
      case "--python":
      case "--max-terminals":
      case "--idle-minutes": {
        const { value, next } = takeValue(args, index, flag);
        index = next;
        if (flag === "--host") options.host = value;
        else if (flag === "--port") options.port = value;
        else if (flag === "--token") options.token = value;
        else if (flag === "--code-url") options.codeUrl = value;
        else if (flag === "--node") options.nodePath = value;
        else if (flag === "--python") options.pythonPath = value;
        else if (flag === "--max-terminals") options.maxTerminals = value;
        else if (flag === "--idle-minutes") options.idleMinutes = value;
        break;
      }
      case "--allow-root": {
        const { value, next } = takeValue(args, index, flag);
        roots.push(value);
        index = next;
        break;
      }
      case "--allow-origin": {
        const { value, next } = takeValue(args, index, flag);
        origins.push(value);
        index = next;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (roots.length > 0) options.allowedRoots = roots;
  if (origins.length > 0) options.allowedOrigins = origins;
  return options;
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[agent] ${error instanceof Error ? error.message : String(error)}`);
    console.error("Run `pnpm agent --help` for usage.");
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (options.version) {
    console.log(AGENT_VERSION);
    return;
  }

  let config: AgentConfig;
  try {
    config = await resolveAgentConfig(options);
  } catch (error) {
    console.error(`[agent] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  let agent: AgentServer;
  try {
    agent = await startAgent(config, (message) => console.log(`[agent] ${message}`));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") {
      console.error(
        `[agent] Port ${config.port} is already in use. Stop the other agent or start this one with --port <port>.`,
      );
    } else if (code === "EACCES") {
      console.error(`[agent] Permission denied while binding ${config.host}:${config.port}.`);
    } else {
      console.error(
        `[agent] Could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  const [runtimes, shells] = await Promise.all([
    agent.runtimes.detectAll(null),
    import("./terminals/shells.js").then((module) => module.detectShells()),
  ]);
  const screen = [
    "",
    `NagarCode local agent ${AGENT_VERSION}`,
    `  URL        ${agent.url}`,
    `  Token      ${config.token}`,
    `  Pair link  ${pairingUrl({ ...config, port: agent.port })}`,
    `  Origins    ${config.allowedOrigins.join(", ")}`,
    `  Roots      ${config.allowedRoots.join(", ")}`,
    `  Terminal   ${agent.terminals.ptyAvailable ? "PTY (node-pty)" : `pipe fallback — ${agent.terminals.ptyReason ?? "PTY unavailable"}`}`,
    `  Shells     ${shells.map((shell) => shell.id).join(", ") || "none detected"}`,
    `  Runtimes   ${runtimes.map((runtime) => `${runtime.id}: ${runtime.available ? (runtime.version ?? "available") : "unavailable"}`).join(" | ")}`,
    "",
    "Open NagarCode, click the agent status in the status bar, and paste the token (or open the pairing link).",
    "Only this computer can connect. Press Ctrl+C to stop; all terminal sessions are closed.",
    "The token grants filesystem and shell access as your user — do not share it.",
    "",
  ].join("\n");
  console.log(screen);

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) {
      console.log(`[agent] ${signal} received again; exiting immediately.`);
      process.exit(1);
    }
    closing = true;
    console.log(`[agent] ${signal} received; shutting down terminal sessions…`);
    try {
      await agent.close();
      console.log("[agent] Stopped.");
      process.exit(0);
    } catch (error) {
      console.error(
        `[agent] Shutdown error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
