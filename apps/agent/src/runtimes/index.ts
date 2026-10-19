import path from "node:path";
import type { RuntimeAvailability, RuntimeId } from "@nagar/agent-protocol";
import type { AgentConfig } from "../config.js";
import { AgentError } from "../errors.js";
import { nodeAdapter } from "./node.js";
import { pythonAdapter, resolvePython } from "./python.js";
import { typescriptAdapter } from "./typescript.js";
import type { RuntimeAdapter, RuntimePrepareContext, RunPlan } from "./types.js";

const adapters: RuntimeAdapter[] = [nodeAdapter, typescriptAdapter, pythonAdapter];

export function runtimeForPath(filePath: string): RuntimeId | null {
  const extension = path.extname(filePath).toLowerCase();
  const adapter = adapters.find((candidate) => candidate.extensions.includes(extension));
  return adapter?.id ?? null;
}

export type RuntimeRegistry = {
  detectAll(workspaceRoot: string | null): Promise<RuntimeAvailability[]>;
  detectOne(runtime: RuntimeId, workspaceRoot: string | null): Promise<RuntimeAvailability>;
  prepare(context: RuntimePrepareContext): Promise<RunPlan>;
  pythonOverrideAvailability(pythonPath: string | undefined): Promise<RuntimeAvailability>;
  clearCache(): void;
};

export function createRuntimeRegistry(config: AgentConfig): RuntimeRegistry {
  let cache: { key: string; at: number; value: RuntimeAvailability[] } | null = null;
  const ttlMs = 10_000;

  const detectAll = async (workspaceRoot: string | null): Promise<RuntimeAvailability[]> => {
    const key = `${workspaceRoot ?? ""}|${config.nodePath ?? ""}|${config.pythonPath ?? ""}`;
    if (cache && cache.key === key && Date.now() - cache.at < ttlMs) return cache.value;
    const value = await Promise.all(
      adapters.map((adapter) =>
        adapter.detect({ config, workspaceRoot }).catch((error): RuntimeAvailability => ({
          id: adapter.id,
          label: adapter.label,
          extensions: adapter.extensions,
          available: false,
          reason: error instanceof Error ? error.message : "Runtime detection failed.",
        })),
      ),
    );
    cache = { key, at: Date.now(), value };
    return value;
  };

  return {
    detectAll,
    async detectOne(runtime, workspaceRoot) {
      const all = await detectAll(workspaceRoot);
      return (
        all.find((item) => item.id === runtime) ?? {
          id: runtime,
          label: runtime,
          extensions: [],
          available: false,
          reason: "Unknown runtime.",
        }
      );
    },
    async prepare(context) {
      const adapter = adapters.find(
        (candidate) => candidate.id === runtimeForPath(context.fileAbs),
      );
      if (!adapter) {
        throw new AgentError(
          "UNSUPPORTED_LANGUAGE",
          `NagarCode can run JavaScript, TypeScript, and Python files in this phase. ${path.basename(context.fileAbs)} is not supported.`,
        );
      }
      const availability = await adapter.detect({ config, workspaceRoot: context.workspaceRoot });
      if (!availability.available) {
        throw new AgentError(
          "RUNTIME_UNAVAILABLE",
          availability.reason ?? `${availability.label} is unavailable.`,
          availability.installHint ? [availability.installHint] : undefined,
        );
      }
      return adapter.prepare(context);
    },
    async pythonOverrideAvailability(pythonPath) {
      if (!pythonPath?.trim()) {
        return (await detectAll(null)).find((item) => item.id === "python")!;
      }
      const resolution = await resolvePython(config, pythonPath);
      if (!resolution.command) {
        return {
          id: "python",
          label: "Python 3",
          extensions: [".py", ".pyw"],
          available: false,
          strategy: "python",
          ...(resolution.reason ? { reason: resolution.reason } : {}),
          installHint:
            "Enter an absolute path to a Python 3 executable, for example /usr/bin/python3 or C:\\Python312\\python.exe.",
        };
      }
      return {
        id: "python",
        label: "Python 3",
        extensions: [".py", ".pyw"],
        available: true,
        ...(resolution.version ? { version: resolution.version } : {}),
        command: resolution.command,
        strategy: "python",
      };
    },
    clearCache() {
      cache = null;
    },
  };
}

export type { RunPlan };
