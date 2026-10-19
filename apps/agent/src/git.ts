import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { devNull } from "node:os";
import { AgentError } from "./errors.js";
import type { GitCredentials } from "@nagar/agent-protocol";

export class GitError extends AgentError {
  readonly stderr: string;
  readonly stdout: string;
  readonly exitCode: number | null;
  constructor(message: string, stderr: string, stdout: string, exitCode: number | null, code: "GIT_ERROR" | "GIT_CONFLICT" | "GIT_NOT_REPO" = "GIT_ERROR") {
    super(code, message);
    this.stderr = stderr;
    this.stdout = stdout;
    this.exitCode = exitCode;
  }
}

type RunGitOptions = {
  cwd: string;
  input?: Buffer;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
  credentials?: GitCredentials;
};

async function runGitRaw(args: string[], options: RunGitOptions): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { cwd, input, env = {}, timeoutMs = 60_000, maxOutputBytes = 4 * 1024 * 1024, credentials } = options;

  // Build credential header if provided
  const extraArgs: string[] = [];
  const credentialEnv: NodeJS.ProcessEnv = {};
  if (credentials?.username && credentials?.password) {
    // Use http.extraHeader for Basic auth without embedding in URL
    const token = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");
    extraArgs.push("-c", `http.extraHeader=Authorization: Basic ${token}`);
    // Also disable credential helper prompts
    extraArgs.push("-c", "credential.helper=");
  } else if (credentials?.username || credentials?.password) {
    throw new AgentError("INVALID_REQUEST", "Both username and password are required for Git authentication.");
  }

  // For push/pull/fetch we want to avoid interactive prompts
  const gitArgs = [...extraArgs, ...args];

  return new Promise((resolve, reject) => {
    const child = spawn("git", gitArgs, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: devNull,
        GCM_INTERACTIVE: "never",
        GIT_ASKPASS: "echo",
        ...credentialEnv,
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new GitError("Git command timed out.", "", "", null));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        // truncate but continue to kill
        stdoutChunks.push(chunk.subarray(0, maxOutputBytes - stdoutBytes + chunk.length));
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(new GitError("Git output exceeded limit.", "", "", null));
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes < 128 * 1024) {
        const kept = chunk.subarray(0, 128 * 1024 - stderrBytes);
        stderrChunks.push(kept);
        stderrBytes += kept.length;
      }
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Check if git binary missing
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new AgentError("GIT_ERROR", "Git executable not found. Install Git and ensure it is in PATH."));
        return;
      }
      reject(new GitError(err.message, "", "", null));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) {
        // Detect common cases for better error codes
        const lower = (stderr + stdout).toLowerCase();
        if (lower.includes("not a git repository") || lower.includes("not a git repo")) {
          reject(new GitError(stderr || stdout || "Not a Git repository.", stderr, stdout, code, "GIT_NOT_REPO"));
          return;
        }
        if (lower.includes("conflict") || lower.includes("merge conflict") || lower.includes("automatic merge failed")) {
          // Don't immediately classify all merges as conflict; caller will handle
          reject(new GitError(stderr || stdout || "Git command failed.", stderr, stdout, code));
          return;
        }
        if (lower.includes("authentication failed") || lower.includes("could not authenticate") || lower.includes("invalid username or password") || lower.includes("401") || lower.includes("403")) {
          reject(new GitError("Git authentication failed. Check your NagarHub email and password.", stderr, stdout, code));
          return;
        }
        reject(new GitError(stderr || stdout || "Git command failed.", stderr, stdout, code));
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    child.stdin.on("error", () => undefined);
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function ensureGitAvailable(): Promise<void> {
  try {
    await runGitRaw(["--version"], { cwd: process.cwd(), timeoutMs: 5000 });
  } catch (e) {
    if (e instanceof AgentError && e.message.includes("not found")) throw e;
    throw new AgentError("GIT_ERROR", "Git is not available on this system.");
  }
}

function parseStatusPorcelain(output: string): {
  staged: { path: string; status: string; staged: string; unstaged: string; originalPath?: string }[];
  unstaged: { path: string; status: string; staged: string; unstaged: string; originalPath?: string }[];
  untracked: string[];
  conflicted: string[];
  files: { path: string; staged: string; unstaged: string; status: string; originalPath?: string }[];
} {
  const staged: typeof files = [];
  const unstaged: typeof files = [];
  const untracked: string[] = [];
  const conflicted: string[] = [];
  const files: { path: string; staged: string; unstaged: string; status: string; originalPath?: string }[] = [];

  const lines = output.split("\n").filter(Boolean);
  for (const line of lines) {
    if (line.length < 3) continue;
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const rest = line.slice(3);
    // Handle renames: "R  old -> new"
    let filePath = rest;
    let originalPath: string | undefined;
    if (rest.includes(" -> ")) {
      const parts = rest.split(" -> ");
      originalPath = parts[0];
      filePath = parts[1] ?? rest;
    }

    const entry = { path: filePath, staged: x, unstaged: y, status: `${x}${y}`, ...(originalPath ? { originalPath } : {}) } as { path: string; staged: string; unstaged: string; status: string; originalPath?: string };

    // Track conflicted: both modified, added, deleted conflicts: UU, AA, DD etc
    const isConflict = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(`${x}${y}`);
    if (isConflict) {
      conflicted.push(filePath);
    }

    if (x === "?" && y === "?") {
      untracked.push(filePath);
      files.push(entry);
      continue;
    }

    files.push(entry);

    if (x !== " " && x !== "?") {
      staged.push(entry);
    }
    if (y !== " " && y !== "?") {
      unstaged.push(entry);
    }
  }

  return { staged, unstaged, untracked, conflicted, files };
}

export type GitStatusResult = {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: { path: string; status: string; staged: string; unstaged: string; originalPath?: string }[];
  unstaged: { path: string; status: string; staged: string; unstaged: string; originalPath?: string }[];
  untracked: string[];
  conflicted: string[];
  hasChanges: boolean;
};

export async function getGitStatus(cwd: string): Promise<GitStatusResult> {
  // Check if repo
  try {
    await runGitRaw(["rev-parse", "--git-dir"], { cwd });
  } catch (e) {
    if (e instanceof GitError && e.code === "GIT_NOT_REPO") {
      return {
        isRepo: false,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        staged: [],
        unstaged: [],
        untracked: [],
        conflicted: [],
        hasChanges: false,
      };
    }
    throw e;
  }

  const [porcelain, branchInfo, upstreamInfo] = await Promise.all([
    runGitRaw(["status", "--porcelain=v1", "-uall", "--branch"], { cwd }).catch((e) => {
      // If status fails, return empty
      if (e instanceof GitError) throw e;
      throw new AgentError("GIT_ERROR", `Failed to get Git status: ${e instanceof Error ? e.message : String(e)}`);
    }),
    runGitRaw(["branch", "--show-current"], { cwd }).then((r) => r.stdout.trim()).catch(() => ""),
    runGitRaw(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd }).then((r) => r.stdout.trim()).catch(() => null),
  ]);

  // porcelain also contains branch line like "## main...origin/main [ahead 1]"
  // But we already have branchInfo; let's parse ahead/behind from status --porcelain=v1 --branch first line
  let ahead = 0;
  let behind = 0;
  const lines = porcelain.stdout.split("\n");
  const branchLine = lines[0] ?? "";
  if (branchLine.startsWith("##")) {
    const aheadMatch = branchLine.match(/\[ahead (\d+)\]/);
    const behindMatch = branchLine.match(/\[behind (\d+)\]/);
    if (aheadMatch) ahead = parseInt(aheadMatch[1]!, 10);
    if (behindMatch) behind = parseInt(behindMatch[1]!, 10);
  }

  // Remove branch line from porcelain parsing
  const statusOutput = lines.slice(1).join("\n");
  const parsed = parseStatusPorcelain(statusOutput);

  // Also include branch line parsing for branch name: "## main...origin/main" or "## No commits yet on main"
  let branch: string | null;
  if (branchInfo && branchInfo !== "HEAD" && branchInfo !== "") {
    branch = branchInfo;
  } else {
    // Try to parse from branchLine
    // Handle "## No commits yet on main" -> capture "main"
    const noCommitMatch = branchLine.match(/^## No commits yet on (.+)$/);
    if (noCommitMatch) {
      branch = noCommitMatch[1]!.split("...")[0]!.trim();
    } else {
      const m = branchLine.match(/^## ([^. ]+)/);
      branch = m ? m[1]! : null;
    }
  }
  if (branch === "HEAD" || branch === "No") branch = null; // detached or parse failure

  return {
    isRepo: true,
    branch,
    upstream: upstreamInfo,
    ahead,
    behind,
    staged: parsed.staged,
    unstaged: parsed.unstaged,
    untracked: parsed.untracked,
    conflicted: parsed.conflicted,
    hasChanges: parsed.staged.length > 0 || parsed.unstaged.length > 0 || parsed.untracked.length > 0 || parsed.conflicted.length > 0,
  };
}

export async function gitInit(cwd: string, initialBranch = "main"): Promise<{ initialized: boolean; branch: string | null }> {
  // Check if already repo
  try {
    await runGitRaw(["rev-parse", "--git-dir"], { cwd });
    throw new AgentError("ALREADY_EXISTS", "This directory is already a Git repository.");
  } catch (e) {
    if (e instanceof AgentError && e.code === "ALREADY_EXISTS") throw e;
    if (!(e instanceof GitError) || e.code !== "GIT_NOT_REPO") throw e;
  }

  // Check if directory has content? git init works on non-empty
  await runGitRaw(["init", `--initial-branch=${initialBranch}`], { cwd });
  return { initialized: true, branch: initialBranch };
}

export async function gitAdd(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) throw new AgentError("INVALID_REQUEST", "No paths to stage.");
  // Validate paths don't escape? They are workspace-relative, already validated at API layer, but double-check
  await runGitRaw(["add", "--", ...paths], { cwd });
}

export async function gitReset(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) throw new AgentError("INVALID_REQUEST", "No paths to unstage.");
  await runGitRaw(["reset", "HEAD", "--", ...paths], { cwd });
}

export async function gitResetHard(cwd: string): Promise<void> {
  await runGitRaw(["reset", "--hard", "HEAD"], { cwd });
}

export async function gitCheckoutDiscard(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) throw new AgentError("INVALID_REQUEST", "No paths to discard.");
  await runGitRaw(["checkout", "--", ...paths], { cwd });
}

export async function gitCommit(cwd: string, message: string, author?: { name: string; email: string }): Promise<string> {
  if (!message.trim()) throw new AgentError("INVALID_REQUEST", "Commit message cannot be empty.");
  const env: NodeJS.ProcessEnv = {};
  // If author provided, set via env and config? Use --author flag
  const args = ["commit", "-m", message];
  if (author?.name && author?.email) {
    args.push(`--author=${author.name} <${author.email}>`);
  }
  // Ensure commit doesn't fail due to missing user config
  // If not configured, set via env
  try {
    await runGitRaw(args, { cwd, env });
    // Get sha
    const shaResult = await runGitRaw(["rev-parse", "HEAD"], { cwd });
    return shaResult.stdout.trim();
  } catch (e) {
    if (e instanceof GitError) {
      const msg = e.stderr || e.stdout;
      if (msg.includes("Please tell me who you are") || msg.includes("user.name") || msg.includes("user.email")) {
        throw new AgentError("GIT_ERROR", "Git commit failed: user.name and user.email are not configured. Set them in the Source Control panel or via git config.");
      }
      if (msg.includes("nothing to commit") || msg.includes("no changes added to commit")) {
        throw new AgentError("GIT_ERROR", "Nothing to commit. Stage your changes first.");
      }
      throw new AgentError("GIT_ERROR", msg);
    }
    throw e;
  }
}

export async function gitDiff(cwd: string, opts: { path?: string; staged?: boolean; context?: number }): Promise<string> {
  const args = ["diff", "--no-color", "--unified=3", "--no-ext-diff"];
  if (opts.staged) args.push("--staged");
  if (opts.path) args.push("--", opts.path);
  const result = await runGitRaw(args, { cwd, maxOutputBytes: 1024 * 1024 });
  // Git diff returns exit 0 even when diff exists, exit 1 if no diff? Actually git diff returns 0 always
  return result.stdout;
}

export async function gitLog(cwd: string, opts: { limit?: number; skip?: number; branch?: string }): Promise<{ commits: { sha: string; shortSha: string; author: string; email: string; date: string; message: string; parents: string[] }[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const skip = Math.max(opts.skip ?? 0, 0);
  const format = "%H%x00%an%x00%ae%x00%aI%x00%s%x00%P";
  const args = ["log", `--format=${format}`, `--skip=${skip}`, `-n${limit + 1}`];
  if (opts.branch) args.push(opts.branch);
  const result = await runGitRaw(args, { cwd });
  const lines = result.stdout.split("\n").filter(Boolean);
  const commits = lines.map((line) => {
    const [sha = "", author = "", email = "", date = "", message = "", parentsStr = ""] = line.split("\0");
    const parents = parentsStr ? parentsStr.split(" ").filter(Boolean) : [];
    return { sha, shortSha: sha.slice(0, 7), author, email, date, message, parents };
  });
  const hasMore = commits.length > limit;
  return { commits: commits.slice(0, limit), hasMore };
}

export async function gitBranches(cwd: string): Promise<{ name: string; current: boolean; upstream?: string | null; commit: string; commitMessage: string }[]> {
  const result = await runGitRaw(["for-each-ref", "--format=%(refname:short)%00%(objectname:short)%00%(objectname)%00%(upstream:short)%00%(subject)", "refs/heads"], { cwd });
  const currentBranch = await runGitRaw(["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).then((r) => r.stdout.trim()).catch(() => null);

  const lines = result.stdout.split("\n").filter(Boolean);
  return lines.map((line) => {
    const [name = "", shortSha = "", fullSha = "", upstream = "", subject = ""] = line.split("\0");
    return {
      name,
      current: name === currentBranch,
      upstream: upstream || null,
      commit: fullSha || shortSha,
      commitMessage: subject,
    };
  });
}

export async function gitCreateBranch(cwd: string, name: string, startPoint?: string): Promise<void> {
  if (!new RegExp("^[A-Za-z0-9._/-]+$").test(name) || name.includes("..") || name.startsWith("-") || name.includes("//")) {
    throw new AgentError("INVALID_REQUEST", `Invalid branch name: ${name}`);
  }
  const args = ["branch", name];
  if (startPoint) args.push(startPoint);
  await runGitRaw(args, { cwd });
}

export async function gitCheckout(cwd: string, name: string, create = false): Promise<void> {
  if (!new RegExp("^[A-Za-z0-9._/-]+$").test(name) || name.includes("..") ) {
    throw new AgentError("INVALID_REQUEST", `Invalid branch name: ${name}`);
  }
  const args = create ? ["checkout", "-b", name] : ["checkout", name];
  try {
    await runGitRaw(args, { cwd });
  } catch (e) {
    if (e instanceof GitError) {
      throw new AgentError("GIT_ERROR", e.stderr || e.stdout);
    }
    throw e;
  }
}

export async function gitDeleteBranch(cwd: string, name: string, force = false): Promise<void> {
  if (name === "main" || name === "master") {
    // Allow but warn? Check if current branch
    const current = await runGitRaw(["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).then((r) => r.stdout.trim()).catch(() => null);
    if (current === name) {
      throw new AgentError("INVALID_REQUEST", `Cannot delete the current branch "${name}". Switch to another branch first.`);
    }
  }
  const args = force ? ["branch", "-D", name] : ["branch", "-d", name];
  try {
    await runGitRaw(args, { cwd });
  } catch (e) {
    if (e instanceof GitError) {
      const msg = e.stderr || e.stdout;
      if (msg.includes("not fully merged")) {
        throw new AgentError("GIT_ERROR", `Branch "${name}" is not fully merged. Use force delete to remove it.`);
      }
      throw new AgentError("GIT_ERROR", msg);
    }
    throw e;
  }
}

export async function gitMerge(cwd: string, branch: string, message?: string): Promise<{ sha?: string; merged: boolean; conflicted?: string[]; message?: string }> {
  const args = ["merge", branch];
  if (message) args.push("-m", message);
  else args.push("--no-edit");

  try {
    await runGitRaw(args, { cwd });
    const sha = await runGitRaw(["rev-parse", "HEAD"], { cwd }).then((r) => r.stdout.trim());
    return { sha, merged: true };
  } catch (e) {
    if (e instanceof GitError) {
      const output = e.stderr + e.stdout;
      // Check for conflicts
      if (output.includes("CONFLICT") || output.includes("conflict") || output.includes("Automatic merge failed")) {
        // Get conflicted files
        const status = await getGitStatus(cwd);
        return { merged: false, conflicted: status.conflicted, message: output };
      }
      throw new AgentError("GIT_ERROR", e.stderr || e.stdout);
    }
    throw e;
  }
}

export async function gitRemotes(cwd: string): Promise<{ name: string; fetchUrl: string; pushUrl: string }[]> {
  const result = await runGitRaw(["remote", "-v"], { cwd }).catch(() => ({ stdout: "", stderr: "", exitCode: 0 }));
  const lines = result.stdout.split("\n").filter(Boolean);
  const map = new Map<string, { fetchUrl: string; pushUrl: string }>();
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const name = parts[0] ?? "";
    const url = parts[1] ?? "";
    const type = parts[2] ?? ""; // (fetch) or (push)
    if (!map.has(name)) map.set(name, { fetchUrl: "", pushUrl: "" });
    const entry = map.get(name)!;
    if (type.includes("fetch")) entry.fetchUrl = url;
    if (type.includes("push")) entry.pushUrl = url;
  }
  return [...map.entries()].map(([name, { fetchUrl, pushUrl }]) => ({ name, fetchUrl, pushUrl }));
}

export async function gitAddRemote(cwd: string, name: string, url: string): Promise<void> {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new AgentError("INVALID_REQUEST", `Invalid remote name: ${name}`);
  if (!url.trim()) throw new AgentError("INVALID_REQUEST", "Remote URL cannot be empty.");
  // Basic URL validation: allow http, https, git, ssh, file
  if (url.includes("\0") || url.includes("\n")) throw new AgentError("INVALID_REQUEST", "Invalid remote URL.");
  await runGitRaw(["remote", "add", name, url], { cwd });
}

export async function gitRemoveRemote(cwd: string, name: string): Promise<void> {
  await runGitRaw(["remote", "remove", name], { cwd });
}

export async function gitFetch(cwd: string, opts: { remote?: string; branch?: string; credentials?: GitCredentials }): Promise<string> {
  const args = ["fetch"];
  if (opts.remote) args.push(opts.remote);
  if (opts.branch) args.push(opts.branch);
  // Add verbose to get output
  args.push("--prune");
  const result = await runGitRaw(args, { cwd, ...(opts.credentials ? { credentials: opts.credentials } : {}) });
  return result.stdout + result.stderr;
}

export async function gitPull(cwd: string, opts: { remote?: string; branch?: string; credentials?: GitCredentials; rebase?: boolean }): Promise<{ output: string; conflicted?: string[] }> {
  const args = ["pull"];
  if (opts.rebase) args.push("--rebase");
  if (opts.remote) args.push(opts.remote);
  if (opts.branch) args.push(opts.branch);
  try {
    const result = await runGitRaw(args, { cwd, ...(opts.credentials ? { credentials: opts.credentials } : {}) });
    return { output: result.stdout + result.stderr };
  } catch (e) {
    if (e instanceof GitError) {
      const output = e.stderr + e.stdout;
      if (output.includes("CONFLICT") || output.includes("conflict")) {
        const status = await getGitStatus(cwd).catch(() => ({ conflicted: [] as unknown as string[] }));
        return { output, conflicted: (status as { conflicted: string[] }).conflicted ?? [] };
      }
      throw new AgentError("GIT_ERROR", output || e.message);
    }
    throw e;
  }
}

export async function gitPush(cwd: string, opts: { remote?: string; branch?: string; setUpstream?: boolean; credentials?: GitCredentials; force?: boolean }): Promise<string> {
  const args = ["push"];
  if (opts.force) args.push("--force-with-lease");
  if (opts.setUpstream) args.push("-u");
  if (opts.remote) args.push(opts.remote);
  if (opts.branch) args.push(opts.branch);
  const result = await runGitRaw(args, { cwd, ...(opts.credentials ? { credentials: opts.credentials } : {}) });
  return result.stdout + result.stderr;
}

export async function gitClone(url: string, targetPath: string, opts: { branch?: string; credentials?: GitCredentials }): Promise<void> {
  if (!url.trim()) throw new AgentError("INVALID_REQUEST", "Clone URL cannot be empty.");
  if (url.includes("\0") || url.includes("\n")) throw new AgentError("INVALID_REQUEST", "Invalid clone URL.");

  // Ensure target parent exists and is inside allowed roots - caller validates
  // Check target doesn't exist or is empty
  try {
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(targetPath);
      if (entries.length > 0) {
        throw new AgentError("ALREADY_EXISTS", `Target directory is not empty: ${targetPath}`);
      }
    } else {
      throw new AgentError("ALREADY_EXISTS", `Target path already exists and is not a directory.`);
    }
  } catch (e) {
    if (e instanceof AgentError) throw e;
    // ENOENT means doesn't exist, which is fine - we will create parent
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw new AgentError("INVALID_REQUEST", `Cannot access target directory: ${(e as Error).message}`);
    }
  }

  // Ensure parent exists
  const parent = path.dirname(targetPath);
  await fs.mkdir(parent, { recursive: true });

  const args = ["clone"];
  if (opts.branch) args.push("-b", opts.branch);
  args.push(url, targetPath);

  const cwd = parent;
  await runGitRaw(args, { cwd, ...(opts.credentials ? { credentials: opts.credentials } : {}) });
}

export async function gitConfig(cwd: string, key: string, value?: string): Promise<string | null> {
  if (value === undefined) {
    const result = await runGitRaw(["config", "--get", key], { cwd }).catch(() => null);
    if (!result) return null;
    return result.stdout.trim();
  } else {
    await runGitRaw(["config", key, value], { cwd });
    return value;
  }
}

export async function gitConfigList(cwd: string): Promise<Record<string, string>> {
  const result = await runGitRaw(["config", "--list"], { cwd }).catch(() => ({ stdout: "", stderr: "", exitCode: 0 }));
  const out: Record<string, string> = {};
  for (const line of result.stdout.split("\n").filter(Boolean)) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      out[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  return out;
}
