import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TypeScript from "typescript";
import type { RuntimeAvailability } from "@nagar/agent-protocol";
import { AgentError } from "../errors.js";
import type {
  RunPlan,
  RuntimeAdapter,
  RuntimeDetectContext,
  RuntimePrepareContext,
} from "./types.js";
import { planCommandLine } from "./types.js";
import { resolveNode } from "./node.js";

const require = createRequire(import.meta.url);

function loadTypeScript(): typeof TypeScript | null {
  try {
    return require("typescript") as typeof TypeScript;
  } catch {
    return null;
  }
}

type Runner = { strategy: "tsx" | "ts-node"; script: string };

async function findWorkspaceRunner(workspaceRoot: string | null): Promise<Runner | null> {
  if (!workspaceRoot) return null;
  const candidates: { strategy: Runner["strategy"]; file: string }[] = [
    { strategy: "tsx", file: path.join(workspaceRoot, "node_modules", "tsx", "dist", "cli.mjs") },
    {
      strategy: "ts-node",
      file: path.join(workspaceRoot, "node_modules", "ts-node", "dist", "bin.js"),
    },
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate.file);
      if (stat.isFile()) return { strategy: candidate.strategy, script: candidate.file };
    } catch {
      // try next runner
    }
  }
  return null;
}

async function moduleKindForFile(file: string, workspaceRoot: string): Promise<"esm" | "cjs"> {
  let directory = path.dirname(file);
  for (let depth = 0; depth < 40; depth += 1) {
    const packageJson = path.join(directory, "package.json");
    try {
      const raw = await fs.readFile(packageJson, "utf8");
      const parsed = JSON.parse(raw) as { type?: unknown };
      return parsed.type === "module" ? "esm" : "cjs";
    } catch {
      // keep walking
    }
    if (directory === workspaceRoot) break;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    if (!parent.startsWith(workspaceRoot) && parent !== workspaceRoot) break;
    directory = parent;
  }
  return "cjs";
}

function formatDiagnostics(
  ts: typeof TypeScript,
  diagnostics: readonly TypeScript.Diagnostic[],
): string[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .slice(0, 20)
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (diagnostic.file && diagnostic.start !== undefined) {
        const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        return `TS${diagnostic.code} (${path.basename(diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1}): ${message}`;
      }
      return `TS${diagnostic.code}: ${message}`;
    });
}

export const typescriptAdapter: RuntimeAdapter = {
  id: "typescript",
  label: "TypeScript",
  extensions: [".ts", ".mts", ".cts"],
  async detect(context: RuntimeDetectContext): Promise<RuntimeAvailability> {
    const node = await resolveNode(context.config);
    if (!node.command) {
      return {
        id: "typescript",
        label: this.label,
        extensions: this.extensions,
        available: false,
        strategy: "typescript",
        reason: "Node.js is required to execute TypeScript.",
        installHint: "Install Node.js 20.9 or newer, then try again.",
      };
    }
    const runner = await findWorkspaceRunner(context.workspaceRoot);
    if (runner) {
      return {
        id: "typescript",
        label: this.label,
        extensions: this.extensions,
        available: true,
        ...(node.version ? { version: node.version } : {}),
        command: runner.script,
        strategy: runner.strategy,
        reason: `Using this workspace's ${runner.strategy} runner.`,
      };
    }
    const ts = loadTypeScript();
    if (!ts) {
      return {
        id: "typescript",
        label: this.label,
        extensions: this.extensions,
        available: false,
        strategy: "transpile",
        reason: "The agent's TypeScript compiler dependency is missing.",
        installHint: "Reinstall the agent dependencies (pnpm install).",
      };
    }
    return {
      id: "typescript",
      label: this.label,
      extensions: this.extensions,
      available: true,
      version: `typescript ${ts.version}`,
      command: node.command,
      strategy: "transpile",
      reason:
        "No tsx/ts-node found in this workspace, so the agent transpiles the active file for Node. " +
        "Relative TypeScript imports need tsx/ts-node; install one in the project for full project support.",
    };
  },
  async prepare(context: RuntimePrepareContext): Promise<RunPlan> {
    const node = await resolveNode(context.config);
    if (!node.command) {
      throw new AgentError("RUNTIME_UNAVAILABLE", "Node.js is required to execute TypeScript.");
    }
    let stat;
    try {
      stat = await fs.stat(context.fileAbs);
    } catch {
      throw new AgentError("NOT_FOUND", `File not found: ${context.fileRel}`);
    }
    if (!stat.isFile()) throw new AgentError("IS_A_DIRECTORY", `Not a file: ${context.fileRel}`);

    const runner = await findWorkspaceRunner(context.workspaceRoot);
    if (runner) {
      const args = [runner.script, context.fileAbs];
      return {
        runtime: this.id,
        command: node.command,
        args,
        cwd: path.dirname(context.fileAbs),
        env: { ...process.env, NAGARCODE_RUN_FILE: context.fileRel },
        commandLine: planCommandLine(node.command, args),
      };
    }

    const ts = loadTypeScript();
    if (!ts) {
      throw new AgentError(
        "RUNTIME_UNAVAILABLE",
        "The agent's TypeScript compiler is missing. Install workspace dependencies or reinstall the agent.",
      );
    }
    let source: string;
    try {
      source = await fs.readFile(context.fileAbs, "utf8");
    } catch {
      throw new AgentError("NOT_FOUND", `Could not read ${context.fileRel}`);
    }

    const moduleKind = await moduleKindForFile(
      context.fileAbs,
      context.workspaceRoot ?? path.dirname(context.fileAbs),
    );
    const transpiled = ts.transpileModule(source, {
      fileName: context.fileAbs,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: moduleKind === "esm" ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
        inlineSourceMap: true,
        sourceMap: false,
        removeComments: false,
      },
    });
    const errors = formatDiagnostics(ts, transpiled.diagnostics ?? []);
    if (errors.length > 0) {
      throw new AgentError("COMPILE_ERROR", "TypeScript compilation failed.", errors);
    }

    const extension = moduleKind === "esm" ? "mjs" : "cjs";
    const tempFile = path.join(
      path.dirname(context.fileAbs),
      `.${path.basename(context.fileAbs)}.nagar-run-${randomUUID().slice(0, 8)}.${extension}`,
    );
    try {
      await fs.writeFile(tempFile, transpiled.outputText, { encoding: "utf8", flag: "wx" });
    } catch {
      throw new AgentError(
        "PERMISSION_DENIED",
        `Could not write a temporary run file next to ${context.fileRel}.`,
      );
    }
    const args = [tempFile];
    return {
      runtime: this.id,
      command: node.command,
      args,
      cwd: path.dirname(context.fileAbs),
      env: { ...process.env, NAGARCODE_RUN_FILE: context.fileRel, NAGARCODE_TS_TRANSPILED: "1" },
      commandLine: planCommandLine(node.command, args),
      cleanup: async () => {
        await fs.rm(tempFile, { force: true }).catch(() => undefined);
      },
    };
  },
};
