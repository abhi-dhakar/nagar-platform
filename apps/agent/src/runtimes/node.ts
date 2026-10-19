import path from "node:path";
import type { RuntimeAvailability } from "@nagar/agent-protocol";
import { findExecutable, firstLine, probe } from "../executable.js";
import { AgentError } from "../errors.js";
import type {
  RunPlan,
  RuntimeAdapter,
  RuntimeDetectContext,
  RuntimePrepareContext,
} from "./types.js";
import { planCommandLine } from "./types.js";

export async function resolveNode(config: RuntimeDetectContext["config"]): Promise<{
  command: string | null;
  version?: string;
  reason?: string;
}> {
  const configured = config.nodePath;
  const command = await findExecutable(configured ?? "node");
  if (!command) {
    return {
      command: null,
      reason: configured
        ? `Configured Node.js executable was not found: ${configured}`
        : "Node.js was not found on PATH.",
    };
  }
  const result = await probe(command, ["--version"]);
  if (!result.ok) {
    return {
      command: null,
      reason: `Node.js at ${command} could not be executed (${firstLine(result.stderr) || "unknown error"}).`,
    };
  }
  const version = firstLine(result.stdout) || firstLine(result.stderr);
  return { command, version };
}

export const nodeAdapter: RuntimeAdapter = {
  id: "javascript",
  label: "JavaScript (Node.js)",
  extensions: [".js", ".mjs", ".cjs"],
  async detect(context: RuntimeDetectContext): Promise<RuntimeAvailability> {
    const node = await resolveNode(context.config);
    if (!node.command) {
      return {
        id: "javascript",
        label: this.label,
        extensions: this.extensions,
        available: false,
        strategy: "node",
        ...(node.reason ? { reason: node.reason } : {}),
        installHint:
          "Install Node.js 20.9 or newer (https://nodejs.org) and make sure `node` is on PATH, " +
          "or start the agent with --node /absolute/path/to/node.",
      };
    }
    return {
      id: "javascript",
      label: this.label,
      extensions: this.extensions,
      available: true,
      ...(node.version ? { version: node.version } : {}),
      command: node.command,
      strategy: "node",
    };
  },
  async prepare(context: RuntimePrepareContext): Promise<RunPlan> {
    const node = await resolveNode(context.config);
    if (!node.command) {
      throw new AgentError("RUNTIME_UNAVAILABLE", node.reason ?? "Node.js is unavailable");
    }
    const cwd = path.dirname(context.fileAbs);
    return {
      runtime: this.id,
      command: node.command,
      args: [context.fileAbs],
      cwd,
      env: { ...process.env, NAGARCODE_RUN_FILE: context.fileRel },
      commandLine: planCommandLine(node.command, [context.fileAbs]),
    };
  },
};
