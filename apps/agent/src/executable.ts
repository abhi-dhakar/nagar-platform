import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants, promises as fs, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ProbeResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
};

export function isExecutableFile(file: string): boolean {
  try {
    accessSync(file, fsConstants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Resolve a command name through PATH without ever invoking a shell. */
export async function findExecutable(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (!command || command.includes("\0")) return null;
  if (path.isAbsolute(command)) {
    return isExecutableFile(command) ? command : null;
  }
  if (/[/\\]/.test(command)) return null;
  const pathValue = env.PATH ?? env.Path ?? "";
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      : [""];
  const hasExtension = path.extname(command) !== "";
  for (const dir of dirs) {
    for (const extension of hasExtension ? [""] : extensions) {
      const candidate = path.join(
        dir,
        process.platform === "win32" ? `${command}${extension}` : command,
      );
      try {
        await fs.access(candidate, fsConstants.X_OK);
        const stat = await fs.stat(candidate);
        if (stat.isFile()) return candidate;
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

export async function probe(
  command: string,
  args: string[],
  timeoutMs = 5000,
): Promise<ProbeResult> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 256 * 1024,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return {
      ok: true,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
      code: 0,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
      killed?: boolean;
    };
    return {
      ok: false,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? err.message ?? ""),
      code: typeof err.code === "number" ? err.code : null,
    };
  }
}

export function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}
