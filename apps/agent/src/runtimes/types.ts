import type { RuntimeAvailability, RuntimeId } from "@nagar/agent-protocol";
import type { AgentConfig } from "../config.js";

export type RuntimeDetectContext = {
  config: AgentConfig;
  /** Real workspace root, when a workspace is open. */
  workspaceRoot: string | null;
};

export type RuntimePrepareContext = RuntimeDetectContext & {
  fileAbs: string;
  fileRel: string;
  /** Per-run Python interpreter override coming from the UI. */
  pythonPathOverride?: string;
};

export type RunPlan = {
  runtime: RuntimeId;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Human-readable form of the real argv (display only). */
  commandLine: string;
  /** Delete temporary artifacts after the process exits. */
  cleanup?: () => Promise<void>;
};

export interface RuntimeAdapter {
  readonly id: RuntimeId;
  readonly label: string;
  readonly extensions: string[];
  detect(context: RuntimeDetectContext): Promise<RuntimeAvailability>;
  prepare(context: RuntimePrepareContext): Promise<RunPlan>;
}

export function shellQuote(value: string): string {
  if (process.platform === "win32") {
    return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  }
  return /[^A-Za-z0-9_./:@%+=,-]/.test(value) ? `'${value.replace(/'/g, "'\\''")}'` : value;
}

export function planCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}
