import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
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

interface ExecGitOptions extends RunGitOptions {
  /** Stop reading at `maxOutputBytes` and report `truncated` instead of failing. */
  truncate?: boolean;
}

interface ExecGitResult {
  stdout: Buffer;
  truncated: boolean;
}

function execGit(args: string[], options: ExecGitOptions = {}): Promise<ExecGitResult> {
  const {
    cwd,
    input,
    env = {},
    timeoutMs = 30_000,
    maxOutputBytes = 8 * 1024 * 1024,
    truncate = false,
  } = options;

  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        // Server-side Git must behave the same on every host: ignore the operator's personal
        // Git configuration (signing keys, hooks paths, credential helpers, aliases, …).
        GIT_CONFIG_GLOBAL: devNull,
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
    let truncated = false;

    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(error);
    };
    const finishTruncated = () => {
      if (settled) return;
      settled = true;
      truncated = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolvePromise({ stdout: Buffer.concat(stdout), truncated });
    };

    const timer = setTimeout(() => finishError(new Error("Git command timed out.")), timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      const remaining = maxOutputBytes - outputBytes;
      if (chunk.length > remaining) {
        if (truncate) {
          stdout.push(chunk.subarray(0, Math.max(remaining, 0)));
          finishTruncated();
        } else {
          finishError(new Error("Git command output exceeded the configured limit."));
        }
        return;
      }
      outputBytes += chunk.length;
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
      resolvePromise({ stdout: Buffer.concat(stdout), truncated });
    });
    child.stdin.on("error", () => undefined);
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function runGit(args: string[], options: RunGitOptions = {}): Promise<Buffer> {
  return (await execGit(args, options)).stdout;
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

export interface GitBranch {
  name: string;
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  message: string;
  isDefault: boolean;
}

export interface GitCommitPage {
  commits: GitCommit[];
  hasMore: boolean;
}

export interface GitFileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "changed";
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface GitComparison {
  base: { sha: string };
  head: { sha: string };
  mergeBase: string | null;
  ahead: number;
  behind: number;
  commits: GitCommit[];
  commitsTruncated: boolean;
  files: GitFileChange[];
  filesTruncated: boolean;
  totals: { files: number; additions: number; deletions: number };
  diff: string;
  diffTruncated: boolean;
}

export type GitBlob =
  | { status: "ok"; size: number; content: string }
  | { status: "binary"; size: number }
  | { status: "too_large"; size: number }
  | { status: "not_found" };

export interface GitRefUpdate {
  ref: string;
  before: string | null;
  after: string | null;
}

/** Thrown when a pull-request merge stops on content conflicts. */
export class MergeConflictError extends Error {
  constructor(readonly files: string[]) {
    super("The branches could not be merged cleanly.");
    this.name = "MergeConflictError";
  }
}

/** Thrown when the compare branch adds nothing to the base branch. */
export class NothingToMergeError extends Error {
  constructor() {
    super("The base branch already contains every commit from the compare branch.");
    this.name = "NothingToMergeError";
  }
}

export const MAX_BLOB_PREVIEW_BYTES = 1024 * 1024;
const MAX_DIFF_BYTES = 400 * 1024;
const MAX_COMPARE_FILES = 300;
const MAX_COMPARE_COMMITS = 100;
const COMMIT_FORMAT = "%H%x00%an%x00%ae%x00%aI%x00%s";
const FULL_SHA = /^[0-9a-f]{40}$/;
const EMPTY_SHA = /^0{40}$/;

function parseCommits(output: Buffer): GitCommit[] {
  return output
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha = "", author = "", email = "", date = "", message = ""] = line.split("\0");
      return { sha, shortSha: sha.slice(0, 7), author, email, date, message };
    });
}

/**
 * Compares two ref snapshots (`refs/heads/*` and `refs/tags/*` → object id) and returns every
 * ref that was created, moved, or deleted. Pure, so the push-event logic is unit-testable.
 */
export function diffRefs(before: Map<string, string>, after: Map<string, string>): GitRefUpdate[] {
  const updates: GitRefUpdate[] = [];
  for (const [ref, sha] of after) {
    const previous = before.get(ref) ?? null;
    if (previous !== sha) updates.push({ ref, before: previous, after: sha });
  }
  for (const [ref, sha] of before) {
    if (!after.has(ref)) updates.push({ ref, before: sha, after: null });
  }
  return updates.sort((a, b) => a.ref.localeCompare(b.ref));
}

function parseNumstat(
  output: Buffer,
): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const result = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  for (const record of output.toString("utf8").split("\0").filter(Boolean)) {
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const added = record.slice(0, firstTab);
    const deleted = record.slice(firstTab + 1, secondTab);
    const path = record.slice(secondTab + 1);
    const binary = added === "-" || deleted === "-";
    result.set(path, {
      additions: binary ? 0 : Number(added) || 0,
      deletions: binary ? 0 : Number(deleted) || 0,
      binary,
    });
  }
  return result;
}

function parseNameStatus(output: Buffer): Map<string, GitFileChange["status"]> {
  const result = new Map<string, GitFileChange["status"]>();
  const parts = output.toString("utf8").split("\0").filter(Boolean);
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const code = parts[index] ?? "";
    const path = parts[index + 1] ?? "";
    result.set(
      path,
      code.startsWith("A")
        ? "added"
        : code.startsWith("D")
          ? "deleted"
          : code.startsWith("M")
            ? "modified"
            : "changed",
    );
  }
  return result;
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

  private gitDir(storageKey: string): string[] {
    return ["--git-dir", this.repositoryPath(storageKey)];
  }

  async createBare(storageKey: string): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const repositoryPath = this.repositoryPath(storageKey);
    await mkdir(repositoryPath, { mode: 0o700 });
    try {
      await runGit(["init", "--bare", "--initial-branch=main"], { cwd: repositoryPath });
      await runGit([...this.gitDir(storageKey), "config", "http.receivepack", "true"]);
      // Reject malformed objects at push time instead of storing them.
      await runGit([...this.gitDir(storageKey), "config", "receive.fsckObjects", "true"]);
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
      await runGit(["config", "commit.gpgsign", "false"], { cwd: workspace });
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
      ...this.gitDir(storageKey),
      "for-each-ref",
      "--format=%(refname:lstrip=2)",
      "refs/heads",
    ]);
    return output.toString("utf8").split("\n").filter(Boolean);
  }

  /** Branches with their tip commit, default branch first and then most recently updated. */
  async branchDetails(storageKey: string): Promise<GitBranch[]> {
    const [output, defaultBranch] = await Promise.all([
      runGit([
        ...this.gitDir(storageKey),
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname:lstrip=2)%00%(objectname)%00%(authorname)%00%(committerdate:iso-strict)%00%(subject)",
        "refs/heads",
      ]),
      this.defaultBranch(storageKey),
    ]);
    const branches = output
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((line): GitBranch => {
        const [name = "", sha = "", author = "", date = "", message = ""] = line.split("\0");
        return {
          name,
          sha,
          shortSha: sha.slice(0, 7),
          author,
          date,
          message,
          isDefault: name === defaultBranch,
        };
      });
    return branches.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  async defaultBranch(storageKey: string): Promise<string | null> {
    try {
      const output = await runGit([
        ...this.gitDir(storageKey),
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

  /** Every branch and tag with its object id. */
  async refSnapshot(storageKey: string): Promise<Map<string, string>> {
    const output = await runGit([
      ...this.gitDir(storageKey),
      "for-each-ref",
      "--format=%(objectname) %(refname)",
      "refs/heads",
      "refs/tags",
    ]);
    const refs = new Map<string, string>();
    for (const line of output.toString("utf8").split("\n").filter(Boolean)) {
      const space = line.indexOf(" ");
      if (space > 0) refs.set(line.slice(space + 1), line.slice(0, space));
    }
    return refs;
  }

  /** Commits reachable from `after` but not from any of `exclude` (newest first, capped). */
  async newCommits(
    storageKey: string,
    after: string,
    exclude: string[],
    limit = 20,
  ): Promise<GitCommit[]> {
    if (!FULL_SHA.test(after) || exclude.some((sha) => !FULL_SHA.test(sha))) return [];
    const args = [
      ...this.gitDir(storageKey),
      "log",
      `-n${Math.min(Math.max(limit, 1), 50)}`,
      `--format=${COMMIT_FORMAT}`,
      after,
    ];
    if (exclude.length) args.push("--not", ...exclude);
    try {
      return parseCommits(await runGit(args));
    } catch {
      return [];
    }
  }

  async countCommits(storageKey: string, branch: string): Promise<number> {
    if (!(await this.branches(storageKey)).includes(branch)) return 0;
    const output = await runGit([
      ...this.gitDir(storageKey),
      "rev-list",
      "--count",
      `refs/heads/${branch}`,
    ]);
    return Number(output.toString("utf8").trim()) || 0;
  }

  async commitPage(
    storageKey: string,
    branch: string,
    { skip = 0, limit = 30 }: { skip?: number; limit?: number } = {},
  ): Promise<GitCommitPage> {
    if (!(await this.branches(storageKey)).includes(branch)) return { commits: [], hasMore: false };
    const pageSize = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const offset = Math.max(Math.trunc(skip), 0);
    const output = await runGit([
      ...this.gitDir(storageKey),
      "log",
      `--skip=${offset}`,
      `-n${pageSize + 1}`,
      `--format=${COMMIT_FORMAT}`,
      `refs/heads/${branch}`,
    ]);
    const commits = parseCommits(output);
    return { commits: commits.slice(0, pageSize), hasMore: commits.length > pageSize };
  }

  async commits(storageKey: string, branch: string, limit = 20): Promise<GitCommit[]> {
    return (await this.commitPage(storageKey, branch, { limit: Math.min(Math.max(limit, 1), 50) }))
      .commits;
  }

  /** The parents of a commit (`[]` for a root commit, `null` when the commit does not exist). */
  async parents(storageKey: string, sha: string): Promise<string[] | null> {
    if (!FULL_SHA.test(sha)) return null;
    try {
      const output = await runGit([
        ...this.gitDir(storageKey),
        "rev-list",
        "--parents",
        "-n",
        "1",
        sha,
      ]);
      const [, ...parents] = output.toString("utf8").trim().split(" ");
      return parents;
    } catch {
      return null;
    }
  }

  /** Resolves a branch name or a full commit id to a commit id; `null` when it does not exist. */
  async resolveCommit(storageKey: string, reference: string): Promise<string | null> {
    if (FULL_SHA.test(reference) && !EMPTY_SHA.test(reference)) {
      try {
        await runGit([...this.gitDir(storageKey), "cat-file", "-e", `${reference}^{commit}`]);
        return reference;
      } catch {
        return null;
      }
    }
    if (!(await this.branches(storageKey)).includes(reference)) return null;
    const output = await runGit([
      ...this.gitDir(storageKey),
      "rev-parse",
      "--verify",
      `refs/heads/${reference}^{commit}`,
    ]);
    return output.toString("utf8").trim() || null;
  }

  /**
   * What `head` would add to `base`: commits, per-file stats, and a unified diff against the
   * merge base (the same view a pull request shows). Output is bounded; nothing is executed.
   */
  async compare(storageKey: string, base: string, head: string): Promise<GitComparison | null> {
    const [baseSha, headSha] = await Promise.all([
      this.resolveCommit(storageKey, base),
      this.resolveCommit(storageKey, head),
    ]);
    if (!baseSha || !headSha) return null;
    const dir = this.gitDir(storageKey);

    // Unrelated histories have no merge base; that is reported as `null`, not an error.
    const mergeBase = await runGit([...dir, "merge-base", baseSha, headSha])
      .then((output) => output.toString("utf8").trim() || null)
      .catch(() => null);
    const range = `${baseSha}..${headSha}`;
    const countOf = async (spec: string) =>
      Number((await runGit([...dir, "rev-list", "--count", spec])).toString("utf8").trim()) || 0;
    const diffArgs = ["--no-ext-diff", "--no-textconv", "--no-renames"];
    const diffTarget = mergeBase ? [mergeBase, headSha] : [baseSha, headSha];

    const [ahead, behind, commitOutput, numstat, nameStatus, patch] = await Promise.all([
      countOf(`${baseSha}..${headSha}`),
      countOf(`${headSha}..${baseSha}`),
      runGit([...dir, "log", `-n${MAX_COMPARE_COMMITS + 1}`, `--format=${COMMIT_FORMAT}`, range]),
      runGit([...dir, "diff", ...diffArgs, "--numstat", "-z", ...diffTarget]),
      runGit([...dir, "diff", ...diffArgs, "--name-status", "-z", ...diffTarget]),
      execGit([...dir, "diff", ...diffArgs, "--no-color", "--unified=3", ...diffTarget], {
        maxOutputBytes: MAX_DIFF_BYTES,
        truncate: true,
        timeoutMs: 20_000,
      }),
    ]);

    const stats = parseNumstat(numstat);
    const statuses = parseNameStatus(nameStatus);
    const allFiles: GitFileChange[] = [...stats.entries()].map(([path, stat]) => ({
      path,
      status: statuses.get(path) ?? "changed",
      ...stat,
    }));
    allFiles.sort((a, b) => a.path.localeCompare(b.path));
    const commits = parseCommits(commitOutput);
    let diff = patch.stdout.toString("utf8");
    if (patch.truncated) diff = diff.slice(0, Math.max(diff.lastIndexOf("\n"), 0));

    return {
      base: { sha: baseSha },
      head: { sha: headSha },
      mergeBase,
      ahead,
      behind,
      commits: commits.slice(0, MAX_COMPARE_COMMITS),
      commitsTruncated: commits.length > MAX_COMPARE_COMMITS,
      files: allFiles.slice(0, MAX_COMPARE_FILES),
      filesTruncated: allFiles.length > MAX_COMPARE_FILES,
      totals: {
        files: allFiles.length,
        additions: allFiles.reduce((sum, file) => sum + file.additions, 0),
        deletions: allFiles.reduce((sum, file) => sum + file.deletions, 0),
      },
      diff,
      diffTruncated: patch.truncated,
    };
  }

  /**
   * Merges `headBranch` into `baseBranch` with a merge commit, in a throwaway clone.
   * Merge conflicts raise {@link MergeConflictError}; a no-op merge raises
   * {@link NothingToMergeError}. If the base branch moves while merging, the merge is retried
   * from a fresh clone a couple of times before giving up.
   */
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

    const attempts = 3;
    for (let attempt = 1; ; attempt++) {
      const workspace = await mkdtemp(join(tmpdir(), "nagar-merge-"));
      const checkout = join(workspace, "repository");
      try {
        await runGit(["clone", "--no-local", this.repositoryPath(storageKey), checkout], {
          cwd: workspace,
          timeoutMs: 60_000,
        });
        await runGit(["config", "user.name", "NagarHub"], { cwd: checkout });
        await runGit(["config", "user.email", "noreply@nagar.dev"], { cwd: checkout });
        await runGit(["config", "commit.gpgsign", "false"], { cwd: checkout });
        await runGit(["checkout", "-B", baseBranch, `origin/${baseBranch}`], { cwd: checkout });
        try {
          await runGit(["merge-base", "--is-ancestor", `origin/${headBranch}`, "HEAD"], {
            cwd: checkout,
          });
          throw new NothingToMergeError();
        } catch (error) {
          if (error instanceof NothingToMergeError) throw error;
          if (!(error instanceof GitCommandError) || error.exitCode !== 1) throw error;
        }
        try {
          await runGit(["merge", "--no-ff", "--no-edit", `origin/${headBranch}`], {
            cwd: checkout,
            timeoutMs: 60_000,
          });
        } catch (error) {
          const conflicts = await runGit(["diff", "--name-only", "--diff-filter=U"], {
            cwd: checkout,
          }).catch(() => Buffer.alloc(0));
          const files = conflicts.toString("utf8").split("\n").filter(Boolean);
          if (files.length) throw new MergeConflictError(files);
          throw error;
        }
        try {
          await runGit(["push", "origin", `HEAD:refs/heads/${baseBranch}`], {
            cwd: checkout,
            timeoutMs: 60_000,
          });
        } catch (error) {
          const moved =
            error instanceof GitCommandError &&
            /rejected|non-fast-forward|fetch first|stale info/i.test(error.stderr);
          if (moved && attempt < attempts) continue;
          throw error;
        }
        return (await runGit(["rev-parse", "HEAD"], { cwd: checkout })).toString("utf8").trim();
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    }
  }

  async tree(storageKey: string, branch: string, path = ""): Promise<GitTreeEntry[]> {
    if (!(await this.branches(storageKey)).includes(branch)) return [];
    const treeish = path ? `refs/heads/${branch}:${path}` : `refs/heads/${branch}`;
    const output = await runGit([
      ...this.gitDir(storageKey),
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

  /** A file's preview state: text content, "binary", or "too_large" (never throws for content). */
  async blob(storageKey: string, branch: string, path: string): Promise<GitBlob> {
    if (!(await this.branches(storageKey)).includes(branch)) return { status: "not_found" };
    const spec = `refs/heads/${branch}:${path}`;
    const dir = this.gitDir(storageKey);
    try {
      const type = (await runGit([...dir, "cat-file", "-t", spec])).toString("utf8").trim();
      if (type !== "blob") return { status: "not_found" };
      const size = Number((await runGit([...dir, "cat-file", "-s", spec])).toString("utf8").trim());
      if (!Number.isFinite(size)) return { status: "not_found" };
      if (size > MAX_BLOB_PREVIEW_BYTES) return { status: "too_large", size };
      const content = await runGit([...dir, "cat-file", "blob", spec], {
        maxOutputBytes: MAX_BLOB_PREVIEW_BYTES + 1,
      });
      // Same heuristic Git itself uses: a NUL byte near the start means binary.
      if (content.subarray(0, 8000).includes(0)) return { status: "binary", size };
      return { status: "ok", size, content: content.toString("utf8") };
    } catch {
      return { status: "not_found" };
    }
  }

  async textFile(storageKey: string, branch: string, path: string): Promise<string | null> {
    const blob = await this.blob(storageKey, branch, path);
    return blob.status === "ok" ? blob.content : null;
  }
}
