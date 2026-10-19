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

type PythonResolution = {
  command: string | null;
  version?: string;
  reason?: string;
  /** Extra argv prepended before the script (the Windows `py` launcher). */
  prefix: string[];
};

async function resolvePython(
  config: RuntimeDetectContext["config"],
  override?: string,
): Promise<PythonResolution> {
  const configured = override?.trim() || config.pythonPath;
  const candidates = configured
    ? [configured]
    : process.platform === "win32"
      ? ["python3", "python", "py"]
      : ["python3", "python"];
  const failures: string[] = [];
  for (const candidate of candidates) {
    const command = await findExecutable(candidate);
    if (!command) {
      failures.push(`${candidate} was not found on PATH`);
      continue;
    }
    const result = await probe(command, ["--version"]);
    if (!result.ok) {
      failures.push(`${command} could not be executed`);
      continue;
    }
    const version = firstLine(result.stdout) || firstLine(result.stderr);
    const base = path.basename(command).toLowerCase();
    const prefix = base === "py" || base === "py.exe" ? ["-3"] : [];
    return { command, version, prefix };
  }
  return {
    command: null,
    prefix: [],
    reason: configured
      ? `Configured Python interpreter could not be used: ${configured} (${failures.join("; ")})`
      : `No Python interpreter was found (${failures.join("; ")}).`,
  };
}

function installHint(): string {
  if (process.platform === "win32") {
    return "Install Python 3 from https://python.org and enable “Add python.exe to PATH”, or start the agent with --python C:\\Path\\to\\python.exe.";
  }
  if (process.platform === "darwin") {
    return "Install Python 3 (for example `brew install python`) or start the agent with --python /absolute/path/to/python3.";
  }
  return "Install Python 3 with your package manager (for example `sudo apt install python3`) or start the agent with --python /absolute/path/to/python3.";
}

export const pythonAdapter: RuntimeAdapter = {
  id: "python",
  label: "Python 3",
  extensions: [".py", ".pyw"],
  async detect(context: RuntimeDetectContext): Promise<RuntimeAvailability> {
    const python = await resolvePython(context.config);
    if (!python.command) {
      return {
        id: "python",
        label: this.label,
        extensions: this.extensions,
        available: false,
        strategy: "python",
        ...(python.reason ? { reason: python.reason } : {}),
        installHint: installHint(),
      };
    }
    return {
      id: "python",
      label: this.label,
      extensions: this.extensions,
      available: true,
      ...(python.version ? { version: python.version } : {}),
      command: python.command,
      strategy: "python",
    };
  },
  async prepare(context: RuntimePrepareContext): Promise<RunPlan> {
    const python = await resolvePython(context.config, context.pythonPathOverride);
    if (!python.command) {
      throw new AgentError("RUNTIME_UNAVAILABLE", python.reason ?? "Python is unavailable");
    }
    const args = [...python.prefix, context.fileAbs];
    return {
      runtime: this.id,
      command: python.command,
      args,
      cwd: path.dirname(context.fileAbs),
      env: { ...process.env, PYTHONUNBUFFERED: "1", NAGARCODE_RUN_FILE: context.fileRel },
      commandLine: planCommandLine(python.command, args),
    };
  },
};

export { resolvePython };
