import type { RuntimeAvailability, RuntimeId } from "@nagar/agent-protocol";

export const RUNTIME_LABELS: Record<RuntimeId, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
};

export const RUNTIME_SHORT_LABELS: Record<RuntimeId, string> = {
  javascript: "JS",
  typescript: "TS",
  python: "PY",
};

export function runtimeForPath(path: string | null | undefined): RuntimeId | null {
  if (!path) return null;
  const lower = path.toLowerCase();
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs"))
    return "javascript";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts"))
    return "typescript";
  if (lower.endsWith(".py") || lower.endsWith(".pyw")) return "python";
  return null;
}

export function runtimeAvailability(
  runtimes: RuntimeAvailability[] | undefined,
  id: RuntimeId | null,
): RuntimeAvailability | null {
  if (!id) return null;
  return runtimes?.find((runtime) => runtime.id === id) ?? null;
}

export function runtimeUnavailableMessage(
  runtime: RuntimeAvailability | null,
  id: RuntimeId | null,
): string {
  if (!id)
    return "This file type cannot be executed yet. Supported: JavaScript, TypeScript, Python.";
  if (runtime?.reason) return runtime.reason;
  if (runtime?.installHint) return runtime.installHint;
  return `${id} is not available on the local agent.`;
}

export function runtimeDisplayName(
  runtime: RuntimeAvailability | null,
  id: RuntimeId | null,
): string {
  if (runtime?.label) return runtime.label;
  if (id) return RUNTIME_LABELS[id];
  return "No runtime";
}
