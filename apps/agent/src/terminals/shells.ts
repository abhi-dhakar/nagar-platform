import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import type { ShellInfo } from "@nagar/agent-protocol";
import { findExecutable } from "../executable.js";

const POSIX_CANDIDATES = [
  "/bin/bash",
  "/usr/bin/bash",
  "/bin/zsh",
  "/usr/bin/zsh",
  "/bin/sh",
  "/usr/bin/sh",
  "/usr/local/bin/fish",
  "/usr/bin/fish",
];

const LABELS: Record<string, string> = {
  bash: "Bash",
  zsh: "Zsh",
  sh: "sh",
  fish: "Fish",
  dash: "dash",
  pwsh: "PowerShell 7",
  powershell: "Windows PowerShell",
  cmd: "Command Prompt",
};

function labelFor(base: string): string {
  const key = base.replace(/\.exe$/i, "").toLowerCase();
  return LABELS[key] ?? base;
}

async function executable(file: string): Promise<boolean> {
  try {
    await fs.access(file, fsConstants.X_OK);
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function windowsShells(): Promise<ShellInfo[]> {
  const candidates: { path: string | null; id: string; family: ShellInfo["family"] }[] = [];
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  candidates.push({ path: await findExecutable("pwsh.exe"), id: "pwsh", family: "powershell" });
  candidates.push({
    path: path.join(programFiles, "PowerShell", "7", "pwsh.exe"),
    id: "pwsh",
    family: "powershell",
  });
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  candidates.push({
    path: path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    id: "powershell",
    family: "powershell",
  });
  candidates.push({
    path: await findExecutable("powershell.exe"),
    id: "powershell",
    family: "powershell",
  });
  candidates.push({ path: path.join(systemRoot, "System32", "cmd.exe"), id: "cmd", family: "cmd" });
  candidates.push({ path: await findExecutable("cmd.exe"), id: "cmd", family: "cmd" });

  const shells: ShellInfo[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.path) continue;
    if (!(await executable(candidate.path))) continue;
    const key = candidate.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    shells.push({
      id: candidate.id,
      label: labelFor(candidate.id),
      path: candidate.path,
      family: candidate.family,
    });
  }
  return shells;
}

async function posixShells(): Promise<ShellInfo[]> {
  const candidates: string[] = [];
  if (process.env.SHELL) candidates.push(process.env.SHELL);
  candidates.push(...POSIX_CANDIDATES);
  for (const name of ["bash", "zsh", "fish", "sh"]) {
    const found = await findExecutable(name);
    if (found) candidates.push(found);
  }
  const shells: ShellInfo[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    let real: string;
    try {
      real = await fs.realpath(candidate);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    if (!(await executable(real))) continue;
    seen.add(real);
    const id = path.basename(real);
    shells.push({ id, label: labelFor(id), path: real, family: "posix" });
  }
  return shells;
}

let cache: { at: number; value: ShellInfo[] } | null = null;

export async function detectShells(): Promise<ShellInfo[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const value = process.platform === "win32" ? await windowsShells() : await posixShells();
  cache = { at: Date.now(), value };
  return value;
}

export async function findShell(id: string | undefined): Promise<ShellInfo | null> {
  const shells = await detectShells();
  if (shells.length === 0) return null;
  if (!id) return shells[0] ?? null;
  return shells.find((shell) => shell.id.toLowerCase() === id.toLowerCase()) ?? null;
}

export function shellArgs(shell: ShellInfo): string[] {
  if (shell.family === "powershell") return ["-NoLogo"];
  if (shell.family === "cmd") return [];
  return [];
}

export function fallbackShellArgs(shell: ShellInfo): string[] {
  if (shell.family === "posix") return ["-i"];
  if (shell.family === "powershell") return ["-NoLogo", "-NoExit"];
  return ["/Q"];
}

export function clearShellCache(): void {
  cache = null;
}
