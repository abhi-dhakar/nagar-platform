import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type PtyExit = { exitCode: number; signal?: number };

export type PtyProcess = {
  pid: number;
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: PtyExit) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
};

export type PtyModule = {
  spawn(
    file: string,
    args: string[] | string,
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      useConpty?: boolean;
    },
  ): PtyProcess;
};

type LoadedPty = {
  available: boolean;
  module: PtyModule | null;
  reason: string | undefined;
};

let loaded: LoadedPty | null = null;

export function loadPty(disabled: boolean): LoadedPty {
  if (loaded)
    return disabled
      ? { ...loaded, available: false, reason: "PTY support disabled by configuration." }
      : loaded;
  if (disabled) {
    loaded = { available: false, module: null, reason: "PTY support disabled by configuration." };
    return loaded;
  }
  try {
    const pty = require("@homebridge/node-pty-prebuilt-multiarch") as PtyModule;
    if (typeof pty?.spawn !== "function") throw new Error("module did not export spawn()");
    loaded = { available: true, module: pty, reason: undefined };
  } catch (error) {
    loaded = {
      available: false,
      module: null,
      reason:
        "The optional node-pty native module could not be loaded; terminals fall back to plain pipes " +
        `(no terminal resizing or job control). ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return loaded;
}

export function clearPtyCache(): void {
  loaded = null;
}
