import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "GitCommandError";
  }
}

interface RunGitOptions {
  cwd?: string;
  input?: Buffer;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export function runGit(args: string[], options: RunGitOptions = {}): Promise<Buffer> {
  const { cwd, input, env = {}, timeoutMs = 30_000, maxOutputBytes = 8 * 1024 * 1024 } = options;

  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(error);
    };

    const timer = setTimeout(() => finishError(new Error("Git command timed out.")), timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        finishError(new Error("Git command output exceeded the configured limit."));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes < 64 * 1024) {
        const remaining = 64 * 1024 - stderrBytes;
        const kept = chunk.subarray(0, remaining);
        stderr.push(kept);
        stderrBytes += kept.length;
      }
    });
    child.on("error", (error) => finishError(error));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new GitCommandError("Git command failed.", code, Buffer.concat(stderr).toString("utf8")),
        );
        return;
      }
      resolvePromise(Buffer.concat(stdout));
    });
    child.stdin.on("error", () => undefined);
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export interface GitTreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink" | "submodule";
  mode: string;
  sha: string;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export class GitStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  repositoryPath(storageKey: string): string {
    if (!/^[a-f0-9-]{36}\.git$/.test(storageKey)) {
      throw new Error("Invalid Git storage key.");
    }
    return resolve(this.root, storageKey);
  }

  async createBare(storageKey: string): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const repositoryPath = this.repositoryPath(storageKey);
    await mkdir(repositoryPath, { mode: 0o700 });
    try {
      await runGit(["init", "--bare", "--initial-branch=main"], { cwd: repositoryPath });
      await runGit(["--git-dir", repositoryPath, "config", "http.receivepack", "true"]);
    } catch (error) {
      await rm(repositoryPath, { recursive: true, force: true });
      throw error;
    }
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.repositoryPath(storageKey), { recursive: true, force: true });
  }

  async initializeReadme(storageKey: string, repositoryName: string): Promise<void> {
    const workspace = await mkdtemp(join(tmpdir(), "nagar-init-"));
    try {
      await writeFile(
        join(workspace, "README.md"),
        `# ${repositoryName}\n\nA project hosted on NagarHub.\n`,
        { mode: 0o600 },
      );
      await runGit(["init", "--initial-branch=main"], { cwd: workspace });
      await runGit(["config", "user.name", "Nagar"], { cwd: workspace });
      await runGit(["config", "user.email", "noreply@nagar.dev"], { cwd: workspace });
      await runGit(["add", "README.md"], { cwd: workspace });
      await runGit(["commit", "-m", "docs: initialize repository"], { cwd: workspace });
      await runGit(["remote", "add", "origin", this.repositoryPath(storageKey)], {
        cwd: workspace,
      });
      await runGit(["push", "--set-upstream", "origin", "main"], { cwd: workspace });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  async branches(storageKey: string): Promise<string[]> {
    const output = await runGit([
      "--git-dir",
      this.repositoryPath(storageKey),
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
    ]);
    return output.toString("utf8").split("\n").filter(Boolean);
  }

  async defaultBranch(storageKey: string): Promise<string | null> {
    try {
      const output = await runGit([
        "--git-dir",
        this.repositoryPath(storageKey),
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ]);
      return output.toString("utf8").trim() || null;
    } catch {
      return null;
    }
  }

  async mergeBranches(storageKey: string, baseBranch: string, headBranch: string): Promise<string> {
    const branches = await this.branches(storageKey);
    if (
      !branches.includes(baseBranch) ||
      !branches.includes(headBranch) ||
      baseBranch === headBranch
    ) {
      throw new Error("Both pull request branches must exist and be different.");
    }
    await runGit(["check-ref-format", "--branch", baseBranch]);
    await runGit(["check-ref-format", "--branch", headBranch]);
    const workspace = await mkdtemp(join(tmpdir(), "nagar-merge-"));
    const checkout = join(workspace, "repository");
    try {
      await runGit(["clone", "--no-local", this.repositoryPath(storageKey), checkout], {
        cwd: workspace,
        timeoutMs: 60_000,
      });
      await runGit(["config", "user.name", "NagarHub"], { cwd: checkout });
      await runGit(["config", "user.email", "noreply@nagar.dev"], { cwd: checkout });
      await runGit(["checkout", "-B", baseBranch, `origin/${baseBranch}`], { cwd: checkout });
      await runGit(["merge", "--no-ff", "--no-edit", `origin/${headBranch}`], {
        cwd: checkout,
        timeoutMs: 60_000,
      });
      await runGit(["push", "origin", `HEAD:refs/heads/${baseBranch}`], {
        cwd: checkout,
        timeoutMs: 60_000,
      });
      return (await runGit(["rev-parse", "HEAD"], { cwd: checkout })).toString("utf8").trim();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  async commits(storageKey: string, branch: string, limit = 20): Promise<GitCommit[]> {
    if (!(await this.branches(storageKey)).includes(branch)) return [];
    const output = await runGit([
      "--git-dir",
      this.repositoryPath(storageKey),
      "log",
      `-n${Math.min(Math.max(limit, 1), 50)}`,
      "--format=%H%x00%an%x00%ae%x00%aI%x00%s",
      `refs/heads/${branch}`,
    ]);
    return output
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", author = "", email = "", date = "", message = ""] = line.split("\0");
        return { sha, shortSha: sha.slice(0, 7), author, email, date, message };
      });
  }

  async tree(storageKey: string, branch: string, path = ""): Promise<GitTreeEntry[]> {
    if (!(await this.branches(storageKey)).includes(branch)) return [];
    const treeish = path ? `refs/heads/${branch}:${path}` : `refs/heads/${branch}`;
    const output = await runGit([
      "--git-dir",
      this.repositoryPath(storageKey),
      "ls-tree",
      "-z",
      "--full-tree",
      treeish,
    ]);
    return output
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .flatMap((record) => {
        const separator = record.indexOf("\t");
        if (separator < 0) return [];
        const [mode = "", type = "", sha = ""] = record.slice(0, separator).split(" ");
        const name = record.slice(separator + 1);
        const kind: GitTreeEntry["kind"] =
          type === "tree"
            ? "directory"
            : mode === "120000"
              ? "symlink"
              : type === "commit"
                ? "submodule"
                : "file";
        return [{ name, path: path ? `${path}/${name}` : name, kind, mode, sha }];
      });
  }

  async textFile(storageKey: string, branch: string, path: string): Promise<string | null> {
    if (!(await this.branches(storageKey)).includes(branch)) return null;
    try {
      const output = await runGit(
        [
          "--git-dir",
          this.repositoryPath(storageKey),
          "cat-file",
          "blob",
          `refs/heads/${branch}:${path}`,
        ],
        { maxOutputBytes: 1024 * 1024 },
      );
      return output.toString("utf8");
    } catch {
      return null;
    }
  }
}
